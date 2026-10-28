// The default zone runner: a zone whose gameplay is not ported yet runs as a STUB. The zone's own scene is loaded and set up from the executable
// (src/game/setup.ts: records, flags, box colliders, the behaviour attaches the port knows), Pepper walks around it with the M1 walk / swim code and the
// camera, and the zone leaves through the same exits as the original: the pause menu (Esc: continue / load / save / options / Pepper's house / quit to the front
// end), the story FSM (hubs and mini-games leave when the FSM's node is complete) and var 5 (NEXT_SUBGAME).
// What the ported zone loops of M3+ replace: the `update` of mode 2. Everything around it (fade in / out, intro, pause menu, result menus, exit mapping to the
// next zone, HUD, music, saving) is the per-zone loop template (loopmachine.ts, docs/re/architecture.md 2.3) that those zones reuse through `runZone`.
//
// Stub aids (not in the original, shown at the bottom of the screen): F9 completes the story step the current zone is waiting for (in a mini-game: finishes it
// successfully, in a hub / room that the story is not waiting on: goes back to the zone the player came from), F10 fails a mini-game.
import { extractRenderParams } from '../formats/zoneparams.ts';
import { lightSetFromLgt } from '../render/index.ts';
import { parseLgt } from '../formats/lights.ts';
import { GameRenderer } from '../game/render.ts';
import { World } from '../game/world.ts';
import { profileFor, setupZone } from '../game/setup.ts';
import type { Loaded } from '../game/setup.ts';
import { B } from '../game/input.ts';
import { V } from '../game/vars.ts';
import { UiTextureSet } from '../ui/renderer2d.ts';
import { LoopMachine, MODE, EXIT, HUB_CONFIG, MINIGAME_CONFIG } from './loopmachine.ts';
import type { LoopConfig } from './loopmachine.ts';
import { MR } from './menuui.ts';
import { Hud } from './hud.ts';
import type { Shell, LiveGame } from './shell.ts';
import type { ZoneInfo } from './tables.ts';
import { loadingScreen } from './frontend.ts';
import { loadMessages, ZONE_FILES } from '../ui/strings.ts';

/** zones that are rooms (Pepper's house, the Information Center): pause page 29, loops call FUN_0041bd3d(&mode, 0x40, 5) */
const ROOMS = new Set(['z03PPH', 'z04IFC']);
export function configFor(info: ZoneInfo): LoopConfig {
  if (info.kind === 1) return HUB_CONFIG;
  if (ROOMS.has(info.archive ?? '')) return { hub: false, pauseKind: 2, pauseMask: 0x40, intro: false, help: false, results: false };
  return { ...MINIGAME_CONFIG, intro: false };
}

/** the pause menu page of a loop config (FUN_0041bd3d: kind 0 -> page 5, 1 -> page 0x12, other -> page 0x1d) */
export const PAUSE_PAGE = [5, 0x12, 0x1d] as const;

export interface ZoneHooks {
  /** run once after the zone was loaded */
  init?(): void;
  /** one simulation tick of mode 2; returns the mini-game's result (0 running, 1 success, 2 failed) or undefined */
  update(): number | undefined;
  /** draw the 2D layer of mode 2 / pause (HUD) */
  draw2d(ui: Shell['ui'], dt: number): void;
  /** the 3D render */
  render3d(alpha: number, dt: number): void;
}

/** exit state -> next zone, FUN_00404d14 for mini-games (docs/re/architecture.md 2.2 / 2.3) */
export function nextAfterExit(sh: Shell, info: ZoneInfo, cfg: LoopConfig, exit: number): number {
  if (exit === EXIT.QUIT) return -1;
  if (exit === EXIT.RESTART) return info.index;
  if (cfg.hub || ROOMS.has(info.archive ?? '')) {
    if (exit === EXIT.STORY) return sh.story.zoneOf();
    if (exit === EXIT.VAR5) return sh.vars.get(V.NS_NEXT_SUBGAME);
    return -1;
  }
  // mini-game: every exit but 0 and 3 goes through FUN_00404d14(&next, exit == 2, success)
  return sh.story.miniGameExit(exit === EXIT.FINISHED, exit === EXIT.FINISHED);
}

export async function runPlayZone(sh: Shell, info: ZoneInfo): Promise<number> {
  const zoneName = info.archive!;
  await loadingScreen(sh);
  const cfg = configFor(info);
  const archive = await sh.data.archive(zoneName);
  const scene = await sh.data.zoneScene(zoneName);
  const fog = extractRenderParams(sh.pe, scene.builderAt);
  let lights = null;
  const lgt = archive.find('lights/lights.lgt');
  if (lgt) { try { lights = lightSetFromLgt(parseLgt(archive.read(lgt))); } catch (e) { console.warn('lgt', e); } }
  let shadowArchive = null;
  try { shadowArchive = await sh.data.archive('Shadow'); } catch { /* no blob shadow */ }

  const world = new World();
  world.vars = sh.vars;
  world.externalInput = true;
  world.input = sh.input;
  world.sfx = sh.audio;
  const profile = profileFor(zoneName, sh.pe, scene);
  const from = sh.zones[sh.vars.get(V.PREV_SUBGAME)]?.archive ?? '';    // the zone the player comes from (the island starts at the house door when arriving from z03PPH)
  const loaded: Loaded = setupZone(scene, archive, profile, { world, pe: sh.pe, subgame: info.index, from });
  const pending = sh.applyPendingLoad();
  const gr = new GameRenderer(sh.gl, sh.data, archive, scene, loaded, fog, lights, shadowArchive);
  gr.slider = sh.options.drawDistance;
  const offOpt = sh.onOption(() => { gr.slider = sh.options.drawDistance; });
  // HUD textures: Overlays/<zone>
  let hud: Hud | null = null;
  try {
    const ov = await sh.data.archive('Overlays');
    hud = new Hud(UiTextureSet.load(sh.gl.gl, ov, zoneName));
  } catch { hud = new Hud(null); }
  const island = zoneName === 'z02LGI';
  sh.audio.enterZone(zoneName, { walking: true });
  let strings = null;
  try { strings = loadMessages(await sh.data.archive('messages'), ZONE_FILES[zoneName] ?? []); } catch { /* no zone texts */ }
  void strings;

  const player = loaded.pepper;
  const live: LiveGame = {
    capture: () => ({ pos: [player.x, player.y, player.z], yaw: player.ry, camera: Float32Array.from(world.camera.c) }),
    restore: (save) => restore(save),
    cutsceneRunning: () => false,
  };
  function restore(save: import('./save.ts').SaveGame) {
    const tag = (n: string) => (n.charCodeAt(0) | (n.charCodeAt(1) << 8) | (n.charCodeAt(2) << 16) | (n.charCodeAt(3) << 24)) >>> 0;
    const e = save.entities.find((x) => x.tag === tag('PEPP'));
    if (e) {
      player.x = e.pos[0]; player.y = e.pos[1]; player.z = e.pos[2]; player.ry = e.euler[1];
      player.rebuildYaw(); player.prev.set(player.m);
      const cam = new Float32Array(save.camera.buffer.slice(save.camera.byteOffset, save.camera.byteOffset + 0x48));
      const c = world.camera.c;
      if (cam.slice(0, 6).every(Number.isFinite) && (cam[0] || cam[1] || cam[2])) { for (let i = 0; i < 6; i++) c[i] = cam[i]; world.camera.updateView(); world.camera.savePrev(); } else world.camera.init(player);
    }
  }
  sh.live = live;
  if (pending) restore(pending);

  const m = new LoopMachine(cfg);
  let gameOver = 0;
  let aids = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'F9') { aids = 1; e.preventDefault(); } else if (e.code === 'F10') { aids = 2; e.preventDefault(); }
  };
  addEventListener('keydown', onKey);
  sh.attachMenuKeys();
  let bannerOpen = false;
  let resultResult = 0;
  let fly = { yaw: player.ry, pitch: 0 };

  const hint = cfg.hub ? 'F9: verhaalstap voltooien (stub)' : ROOMS.has(zoneName) ? 'F9: terug naar de vorige plek (stub)' : 'F9: spel voltooien, F10: mislukken (stub)';
  const hintIf = () => (sh.story.zoneOf() === info.index || (zoneName === 'z02LGI' && sh.story.zoneOf() !== 0 && sh.zones[sh.story.zoneOf()]?.archive === 'z02LGI'));

  /** the stub aids */
  const useAids = () => {
    if (aids === 0) return;
    const a = aids; aids = 0;
    if (a === 1) {
      if (hintIf()) {
        if (cfg.hub || ROOMS.has(zoneName)) {
          // complete the node the story waits for: the FSM advances itself in the next frame check (FUN_00423bad)
          const nd = sh.nodes[sh.story.node];
          if (nd) sh.vars.set(nd.var, (sh.vars.get(nd.var) & ~nd.mask) | nd.value);
        } else gameOver = 1;
      } else {
        const prev = sh.vars.get(V.PREV_SUBGAME);
        sh.vars.set(V.NS_NEXT_SUBGAME, prev !== info.index && prev > 0 ? prev : sh.story.zoneOf());
      }
    } else if (a === 2 && !cfg.hub && !ROOMS.has(zoneName)) gameOver = 2;
  };

  const tick = (): boolean => {
    sh.input.update();
    const pressed = sh.input.pressed;
    let pauseResult = 0;
    useAids();
    if (m.mode === MODE.PAUSE) {
      if (!sh.menu.isOpen) sh.menu.open(PAUSE_PAGE[cfg.pauseKind], cfg.pauseMask, true);
      const r = sh.menu.step(pressed, sh.pointer);
      if (r !== 0) { sh.menu.close(); pauseResult = r === MR.RESUME ? 1 : r === MR.QUIT ? -1 : r === MR.RESTART ? -2 : r === MR.ABANDON ? -3 : 1; }
    }
    let storyAdvanced = false, varChanged = false;
    if (m.mode === MODE.PLAY) {
      if (loaded.hasPlayer) world.tick(); else flyTick();
      if (island) hud?.updateIsland(sh.vars);
      if (cfg.hub || !ROOMS.has(zoneName)) storyAdvanced = sh.story.frame() === 6;
      varChanged = sh.vars.get(V.NS_NEXT_SUBGAME) !== sh.vars.get(V.CURRENT_SUBGAME);
    }
    if (m.mode === MODE.PLAY && gameOver) bannerOpen = true;
    if (m.mode === MODE.BANNER && !bannerOpen) bannerOpen = true;
    if (m.mode === MODE.RESULT) {
      if (!sh.menu.isOpen) sh.menu.open(gameOver === 1 ? 0x10 : 0x13, 0, false);   // FUN_0041c092: kind (success != 1) + 1 -> page 16 (continue / retry) or 19 (retry / abort)
      const r = sh.menu.step(pressed, sh.pointer);
      if (r !== 0) { sh.menu.close(); resultResult = r === MR.RESUME ? (gameOver === 1 ? 1 : -3) : r === MR.RESTART ? -2 : -3; }
    }
    const prev = m.mode;
    m.tick({ pressed, pauseResult, resultResult, gameOver, storyAdvanced, varChanged });
    if (m.mode !== prev && m.mode === MODE.PAUSE && prev !== MODE.PAUSE) sh.menu.open(PAUSE_PAGE[cfg.pauseKind], cfg.pauseMask, true);
    if (prev === MODE.PAUSE && m.mode !== MODE.PAUSE) sh.menu.close();
    if (prev === MODE.RESULT && m.mode !== MODE.RESULT) sh.menu.close();
    return m.done;
  };

  /** zones without a player: a free camera (arrow keys fly, Alt / Ctrl up / down) */
  function flyTick() {
    const h = sh.input.held;
    if (h & B.LEFT) fly.yaw -= 0.04; if (h & B.RIGHT) fly.yaw += 0.04;
    const sp = (h & B.SHIFT) ? 3 : 1;
    const fx = Math.sin(fly.yaw), fz = Math.cos(fly.yaw);
    if (h & B.UP) { player.x += fx * sp; player.z += fz * sp; }
    if (h & B.DOWN) { player.x -= fx * sp; player.z -= fz * sp; }
    if (h & B.ALT) player.y += sp; if (h & B.CTRL) player.y -= sp;
    for (const r of world.records) r.savePrev();
    world.camera.savePrev();
    const c = world.camera.c;
    c[0] = player.x; c[1] = player.y + 20; c[2] = player.z; c[3] = player.x + fx * 20; c[4] = player.y + 20; c[5] = player.z + fz * 20;
    world.camera.updateView();
    world.tickCount++;
  }
  if (!loaded.hasPlayer) { player.y = 30; }

  const render = (alpha: number, dt: number) => {
    const a = m.mode === MODE.PLAY || m.mode === MODE.FADE_OUT || m.mode === MODE.FADE_IN ? alpha : 1;
    gr.render(a, dt);
    sh.ui.begin(sh.canvas.width, sh.canvas.height);
    if (hud && m.mode !== MODE.PAUSE) hud.draw(sh.ui, dt * 30);
    if (m.mode === MODE.PAUSE || m.mode === MODE.RESULT) sh.menu.draw(sh.ui, sh.menuSet);
    // mode 4, the end banner (FUN_00465d39): the medal text (STD.str) at y = 150, or the failure text
    if (m.mode === MODE.BANNER) sh.ui.text(1, gameOver === 1 ? sh.std.text('SGGOLD') : sh.msgs.label('!EndGame3M0'), 320, 150, { colour: 0, align: 'centre', maxChars: 30 });
    sh.ui.text(0, hint, 320, 474, { colour: 9, align: 'centre', shadow: false });
    sh.ui.fade(m.fade);
    sh.ui.flush();
  };
  Object.assign(window as unknown as Record<string, unknown>, { __zone: { info, loaded, world, machine: m, gr, hud, sh } });

  await sh.runLoop(tick, render);
  removeEventListener('keydown', onKey);
  sh.detachMenuKeys();
  offOpt();
  sh.menu.close();
  const exit = m.exit;
  world.destroy();
  sh.live = null;
  // the outro movie at the end of the story (FUN_0081fd64: result 2 and the zone was not started from the menu); the port shows the credits after it
  if (zoneName === 'z42BRP' && exit === EXIT.FINISHED && sh.vars.get(0xb) === 0) {
    await sh.runMovie('outroFmv');
    const next = nextAfterExit(sh, info, cfg, exit);
    sh.creditsThen = next;
    return 0;   // the front end stage shows the credits, then continues with `next`
  }
  return nextAfterExit(sh, info, cfg, exit);
}
