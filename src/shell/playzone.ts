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
import { CutsceneHost } from './cutscene-host.ts';
import type { Shell, LiveGame } from './shell.ts';
import type { ZoneInfo } from './tables.ts';
import { loadingScreen } from './frontend.ts';
import { loadMessages, ZONE_FILES } from '../ui/strings.ts';
import type { MessageTable } from '../ui/strings.ts';
import { zoneGameFor, zoneSetupFor } from './zonegame.ts';
import type { ZoneGame, ZoneGameCtx, Subtitle } from './zonegame.ts';
import { drawHelp, drawIntroScreen, drawBannerScreen, drawSubtitle } from './helpscreen.ts';
import type { PanelEnv, ScreenLine } from './helpscreen.ts';
import { zoneIntroFor } from './zoneintro.ts';
import { keyCodeName } from './dik.ts';

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
  const cfg: LoopConfig = { ...configFor(info) };
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
  // a zone's own set-up hooks (zonegame.ts registerZoneSetup): the island runs its set-up in the x86 emulation against the live game variables
  const setupHooks = zoneSetupFor(zoneName);
  const profile = profileFor(zoneName, sh.pe, scene, undefined, setupHooks?.profileOptions?.(sh, archive) ?? {});
  setupHooks?.beforeSetup?.(sh, world, profile, archive, scene);
  const from = sh.zones[sh.vars.get(V.PREV_SUBGAME)]?.archive ?? '';    // the zone the player comes from (the island starts at the house door when arriving from z03PPH)
  const loaded: Loaded = setupZone(scene, archive, profile, { world, pe: sh.pe, subgame: info.index, from });
  setupHooks?.afterSetup?.(sh, world, loaded, archive);
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
  let strings: MessageTable | null = null;
  try { strings = (ZONE_FILES[zoneName]?.length ?? 0) > 0 ? loadMessages(await sh.data.archive('messages'), ZONE_FILES[zoneName]) : null; } catch { /* no zone texts */ }

  const player = loaded.pepper;
  /** the cutscene manager of the zone (FUN_0045c310 .. 0045c456): zones with scripts declare their slots in their factory */
  const cutscene = new CutsceneHost(sh, world, archive, gr, hud ?? new Hud(null), setupHooks?.cutsceneOptions?.(sh, world, loaded) ?? {});
  const live: LiveGame = {
    capture: () => ({ pos: [player.x, player.y, player.z], yaw: player.ry, camera: Float32Array.from(world.camera.c), entities: setupHooks?.saveEntities?.(world) }),
    restore: (save) => restore(save),
    cutsceneRunning: () => cutscene.active(),
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
    setupHooks?.restoreSave?.(world, loaded, save);   // the zone's part of FUN_00419e82 (the island: Pepper's vehicle, WP15)
  }
  sh.live = live;
  if (pending) restore(pending);

  // ---- the ported gameplay of the zone (zonegame.ts), if any
  const subs: Subtitle[] = [];
  /** what the intro / help / banner panels need: the menu texture set, the PRESS / BESTURING texts and the key names of the player's current bindings (FUN_004384c9) */
  const panelEnv: PanelEnv = {
    set: sh.menuSet,
    press: sh.msgs.label('!PRESS'),
    title: sh.msgs.label('!FECONTRL'),
    keyName: (bit) => { const b = sh.input.bindings.find((x) => x.bit === bit); return b ? keyCodeName(0x10000 | b.dik, sh.keyNames) : '---'; },
    menuText: (id) => sh.msgs.tables[0]?.raw(id) ?? null,
  };
  const subtitleTicks = (t: string) => 30 + 2 * t.length;
  /** FUN_00439bf8 + FUN_00435a11 for the lines `a` (and `b`) of `table` */
  const sayFrom = (table: MessageTable | null, a: string | null, b?: string | null): boolean => {
    if (subs.length > 0 || sh.audio.ga?.speech.idle === false) return false;   // FUN_00435a11 starts only when no speech is active (muted: no `ga`, the timed subtitle stands in)
    const lines = [a, b].filter((x): x is string => !!x);
    const idx = lines.map((id) => table?.voice(id) ?? -1);
    if (idx[0] !== undefined && idx[0] >= 0) sh.audio.ga?.speech.say(idx[0], idx[1] ?? -1);
    for (const id of lines) { const t = table?.text(id) ?? id; subs.push({ id, text: t, ticksLeft: subtitleTicks(t) }); }
    return true;
  };
  const ctx: ZoneGameCtx = {
    sh, info, cfg, world, loaded, archive, scene, gr, hud, vars: sh.vars, strings, std: sh.std, attempt: sh.zoneAttempts.get(info.index) ?? 0,
    say: (a, b) => sayFrom(strings, a, b),
    sayFrom,
    speechIdle: () => subs.length === 0 && (sh.audio.ga?.speech.idle ?? true),
    stopSpeech() { subs.length = 0; sh.audio.ga?.speech.stop(); },
    subtitle: () => subs[0] ?? null,
    text(ui, id, x, y, o = {}) {
      const table = o.table === 'std' ? sh.std : o.table === 'menu' ? null : strings;
      const t = table ? table.text(id) : sh.msgs.label(`!${id}`);
      ui.text(o.font ?? 1, t, x, y, { colour: o.colour ?? 0, maxChars: o.maxChars ?? 30, shadow: o.shadow });
    },
    sfx: (id) => world.playSound(id),
    panelEnv: () => panelEnv,
    help: (ui, n, table) => drawHelp(ui, sh.menuSet, table === undefined ? strings : table, n, panelEnv),
    line: (id, y, wrap = 36, table) => ({ text: (table === 'std' ? sh.std : strings)?.text(id) ?? id, y, wrap }),
    banner: (ui, spec) => drawBannerScreen(ui, panelEnv, spec, sh.std),
    cutscene,
  };
  sh.zoneAttempts.set(info.index, ctx.attempt + 1);
  const gameFactory = zoneGameFor(zoneName);
  const game: ZoneGame | null = gameFactory ? await gameFactory(ctx) : null;
  if (game) {
    Object.assign(cfg, game.config ?? {});
    if (game.config?.intro === undefined) cfg.intro = !!game.introId;
    if (game.config?.help === undefined) cfg.help = !!game.helpControls;
  }
  // zones without a port: the intro brief and the controls help the executable gives each mini-game (zoneintro.ts); a ported zone brings its own (introId / helpControls)
  const stubIntro = !game && info.kind !== 1 && !ROOMS.has(zoneName) ? zoneIntroFor(zoneName) : undefined;
  if (stubIntro) { cfg.intro = stubIntro.lines.length > 0; cfg.help = stubIntro.helpControls > 0; }
  const helpControls = game ? game.helpControls ?? 0 : stubIntro?.helpControls ?? 0;
  /** the lines of the intro panel (mode 1): a port's `introLines`, else its `introId` at y 120 (FUN_00465d39), else the table of the stub */
  const introLines = (): ScreenLine[] => {
    const ids = game ? game.introLines ?? (game.introId ? [{ id: game.introId, y: zoneIntroFor(zoneName)?.lines.find((l) => l.id === game.introId)?.y ?? 120, wrap: 30 }] : []) : stubIntro?.lines ?? [];
    return ids.map((l) => ({ text: strings?.text(l.id) ?? l.id, y: l.y, wrap: l.wrap ?? 30 }));
  };
  // the brief is spoken when the loop starts (FUN_00439bf8 + FUN_00435a11 before the mode loop), a button press stops it
  if (cfg.intro) {
    const sp = game ? (game.introLines?.map((l) => l.id) ?? (game.introId ? [game.introId] : [])) : stubIntro?.speech ?? stubIntro?.lines.map((l) => l.id) ?? [];
    if (sp.length > 0 && !game?.introHold && game?.introPanel !== false) ctx.say(sp[0], sp[1]);
  }

  const m = new LoopMachine(cfg);
  let gameOver = 0;
  let aids = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'F9') { aids = 1; e.preventDefault(); } else if (e.code === 'F10') { aids = 2; e.preventDefault(); }
  };
  addEventListener('keydown', onKey);
  sh.attachMenuKeys();
  let bannerOpen = false;
  let wasHolding = !!game?.introHold?.();
  let resultResult = 0;
  let fly = { yaw: player.ry, pitch: 0 };

  const hint = game ? '' : cfg.hub ? 'F9: verhaalstap voltooien (stub)' : ROOMS.has(zoneName) ? 'F9: terug naar de vorige plek (stub)' : 'F9: spel voltooien, F10: mislukken (stub)';
  const hintIf = () => (sh.story.zoneOf() === info.index || (zoneName === 'z02LGI' && sh.story.zoneOf() !== 0 && sh.zones[sh.story.zoneOf()]?.archive === 'z02LGI'));

  /** the stub aids */
  const useAids = () => {
    if (aids === 0 || game) return;
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
    if (m.mode === MODE.BANNER && game?.tickInBanner) { world.tick(); game.bannerTick?.(); }   // zones whose loop also updates in the end banner (z41MAP)
    if (m.mode === MODE.PLAY) {
      game?.beforeTick?.();
      if (loaded.hasPlayer || game) world.tick(); else flyTick();
      if (game && !gameOver) { const r = game.update(); if (r) gameOver = r; }
      { const lr = game?.leaveRequest?.(); if (lr) m.leave(lr); }
      if (cfg.hub || !ROOMS.has(zoneName)) storyAdvanced = sh.story.frame() === 6;
      if (!storyAdvanced && game?.storyTick) { const e = game.storyTick(); if (e !== undefined && e !== EXIT.RUNNING) m.leave(e); }
      varChanged = sh.vars.get(V.NS_NEXT_SUBGAME) !== sh.vars.get(V.CURRENT_SUBGAME);
    }
    if (island) hud?.updateIsland(sh.vars);   // FUN_004b908d: every frame of the island loop, whatever the mode
    if (m.mode === MODE.PLAY && gameOver) bannerOpen = true;
    if (m.mode === MODE.BANNER && !bannerOpen) bannerOpen = true;
    if (m.mode === MODE.RESULT) game?.resultTick?.();
    if (m.mode === MODE.RESULT && !game?.resultHold?.()) {
      const dlg = game?.dialog;   // a zone's own dialog (z04IFC's exit question): page and answers come from the zone
      if (!sh.menu.isOpen) sh.menu.open(dlg ? dlg.page : gameOver === 1 ? 0x10 : 0x13, 0, false);   // FUN_0041c092: kind (success != 1) + 1 -> page 16 (continue / retry) or 19 (retry / abort)
      const r = sh.menu.step(pressed, sh.pointer);
      if (r !== 0 && dlg) { sh.menu.close(); const ok = r === MR.RESUME; dlg.done(ok); resultResult = ok ? 1 : 99; }
      else if (r !== 0) { sh.menu.close(); resultResult = r === MR.RESUME ? (gameOver === 1 ? 1 : -3) : r === MR.RESTART ? -2 : -3; }
    }
    const prev = m.mode;
    if (m.mode === MODE.INTRO) game?.introTick?.();
    const holding = m.mode === MODE.INTRO && !!game?.introHold?.();
    if (m.mode === MODE.INTRO && wasHolding && !holding && game?.introId) ctx.say(game.introId);   // the brief after the cutscene (z40aPO)
    wasHolding = holding;
    if (m.mode === MODE.BANNER && !game?.tickInBanner) game?.bannerTick?.();
    if (subs.length > 0 && --subs[0].ticksLeft <= 0) subs.shift();
    // a zone whose mode 1 has no panel (the island) leaves it on any button (DAT_00983840 != 0)
    const anyButton = (m.mode === MODE.INTRO && game?.introPanel === false && (pressed & ~B.ESC) !== 0) || (m.mode === MODE.BANNER && game?.skipBanner?.() === true) ? B.ENTER : 0;   // skipBanner: z01BPK's banner is left at once without points
    m.tick({ pressed: ((game?.blockPause?.() ? pressed & ~B.ESC : pressed) | anyButton) & (holding ? B.ESC : ~0), pauseResult, resultResult, gameOver, storyAdvanced, varChanged, dialog: m.mode === MODE.PLAY && !!game?.dialog?.wanted(), help2: m.mode === MODE.PLAY && !!game?.wantsHelp2?.() });
    if (resultResult === 99) resultResult = 0;   // a zone dialog's "back to play" answer is used once
    game?.everyTick?.(m.mode);
    if (m.mode !== prev && m.mode === MODE.PAUSE && prev !== MODE.PAUSE) sh.menu.open(PAUSE_PAGE[cfg.pauseKind], cfg.pauseMask, true);
    if (m.mode !== prev && (prev === MODE.INTRO || prev === MODE.HELP)) ctx.stopSpeech();
    if (m.mode !== prev && game) {
      if (m.mode === MODE.PLAY && (prev === MODE.INTRO || prev === MODE.HELP || prev === MODE.INIT)) game.onStart?.();
      if (m.mode === MODE.BANNER) game.onBanner?.(gameOver);
      if (prev === MODE.HELP2 && m.mode === MODE.PLAY) game.onHelp2End?.();
    }
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
    game?.beforeRender?.(a);
    gr.render(a, dt);
    sh.ui.begin(sh.canvas.width, sh.canvas.height);
    if (hud && m.mode !== MODE.PAUSE) hud.draw(sh.ui, dt * 30);
    if (game && m.mode !== MODE.PAUSE) game.draw2d?.(sh.ui, dt, m.mode);
    // mode 1: the one-line brief (FUN_00439c6f(zone table, font, id, 1, 0, 320, 120, 30)), mode 9: the controls help
    if (m.mode === MODE.INTRO && !game?.introHold?.() && game?.introPanel !== false) drawIntroScreen(sh.ui, panelEnv, introLines());
    if (m.mode === MODE.HELP && helpControls) drawHelp(sh.ui, sh.menuSet, strings, helpControls, panelEnv);
    // spoken lines of the game while playing (a mini-game of the original shows no subtitle for them, only the cutscenes do: the cutscene style of FUN_0045d47f)
    if (subs.length > 0 && sh.options.subtitlesOn && m.mode === MODE.PLAY) drawSubtitle(sh.ui, subs[0].text);
    if (m.mode === MODE.PAUSE || (m.mode === MODE.RESULT && !game?.resultHold?.())) sh.menu.draw(sh.ui, sh.menuSet);
    // mode 4, the end banner (FUN_00465d39): the medal text (STD.str) at y = 150, or the failure text
    if (m.mode === MODE.BANNER && game?.drawBanner) game.drawBanner(sh.ui, gameOver);
    else if (m.mode === MODE.BANNER) drawBannerScreen(sh.ui, panelEnv, { lines: [{ text: gameOver === 1 ? sh.std.text('SGGOLD') : sh.msgs.label('!EndGame3M0'), y: 150, wrap: 30 }] }, sh.std);
    sh.ui.text(0, hint, 320, 474, { colour: 9, align: 'centre', shadow: false });
    sh.ui.fade(m.fade);
    sh.ui.flush();
  };
  Object.assign(window as unknown as Record<string, unknown>, { __zone: { info, loaded, world, machine: m, gr, hud, sh, game, ctx } });

  await sh.runLoop(tick, render);
  removeEventListener('keydown', onKey);
  game?.destroy?.();
  cutscene.abort();
  ctx.stopSpeech();
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
  return game?.exitNext?.(exit) ?? nextAfterExit(sh, info, cfg, exit);
}
