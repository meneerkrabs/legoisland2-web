// The zone runner of every zone but the front end: the zone's own scene is loaded and set up from the executable (src/game/setup.ts: records, flags, box colliders,
// the behaviour attaches), the zone's game (zonegame.ts: every one of the 29 zones registers one) supplies the gameplay of mode 2, and everything around it is the per-zone loop
// template of the original (loopmachine.ts, docs/re/architecture.md 2.3): fade in / out, intro, controls help, pause menu, result menus, exit mapping to the next zone (the
// pause menu: continue / load / save / options / Pepper's house / quit to the front end; the story FSM; var 5 = NEXT_SUBGAME), HUD, music, saving.
// (The walk-around stub for zones without a port, with its F9 / F10 aids and intro tables, is gone: gaps.md U9.)
import { extractRenderParams } from '../formats/zoneparams.ts';
import { lightSetFromLgt } from '../render/index.ts';
import { parseLgt } from '../formats/lights.ts';
import { GameRenderer } from '../game/render.ts';
import { World } from '../game/world.ts';
import { profileFor, setupZone } from '../game/setup.ts';
import type { Loaded } from '../game/setup.ts';
import { B } from '../game/input.ts';
import { debugAids } from '../game/debug.ts';
import { V } from '../game/vars.ts';
import { UiTextureSet } from '../ui/renderer2d.ts';
import { LoopMachine, MODE, EXIT, HUB_CONFIG, MINIGAME_CONFIG } from './loopmachine.ts';
import type { LoopConfig } from './loopmachine.ts';
import { MR } from './menuui.ts';
import { Hud } from './hud.ts';
import { CutsceneHost } from './cutscene-host.ts';
import type { Shell, LiveGame } from './shell.ts';
import { captureWorld, restoreWorld, restoreBricks } from './saveworld.ts';
import type { ZoneInfo } from './tables.ts';
import { startLoading, stopLoading } from './loading.ts';
import { loadMessages, ZONE_FILES } from '../ui/strings.ts';
import type { MessageTable } from '../ui/strings.ts';
import { zoneGameFor, zoneSetupFor } from './zonegame.ts';
import type { ZoneGame, ZoneGameCtx, Subtitle, SubtitleMode } from './zonegame.ts';
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

/** the zone that was left with the restart exit (the next `runPlayZone` of it fades in with the restart fog) */
let restartedZone: string | null = null;

export async function runPlayZone(sh: Shell, info: ZoneInfo): Promise<number> {
  const zoneName = info.archive!;
  startLoading(sh);
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
  world.dt = sh.dt; world.invDt = Math.fround(1 / sh.dt);   // DAT_008b1718 is a global: the previous loop's last value (src/game/world.ts `advanceDt`)
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
  gr.restarted = restartedZone === zoneName; restartedZone = null;   // after a restart the first fade-in shows the restart fog
  if (debugAids()) { const vp = new URLSearchParams(location.search).get('viewplane'); if (vp !== null) { gr.viewPlaneTextured = true; if (/^\d+$/.test(vp)) gr.viewPlaneTexture = Number(vp); } }   // debug: `?viewplane=[texture]` starts with the textured view plane on (src/render/viewplane.ts)
  const offOpt = sh.onOption(() => { gr.slider = sh.options.drawDistance; });
  // HUD textures: Overlays/<zone>
  let hud: Hud | null = null;
  try {
    const ov = await sh.data.archive('Overlays');
    hud = new Hud(UiTextureSet.load(sh.gl.gl, ov, zoneName));
  } catch { hud = new Hud(null); }
  const island = zoneName === 'z02LGI';
  await sh.audio.enterZone(zoneName);   // the zone's sounds and music key are loaded before the loop starts (docs/re/audio.md 11)
  let strings: MessageTable | null = null;
  try { strings = (ZONE_FILES[zoneName]?.length ?? 0) > 0 ? loadMessages(await sh.data.archive('messages'), ZONE_FILES[zoneName]) : null; } catch { /* no zone texts */ }

  const player = loaded.pepper;
  /** the cutscene manager of the zone (FUN_0045c310 .. 0045c456): zones with scripts declare their slots in their factory */
  const cutscene = new CutsceneHost(sh, world, archive, gr, hud ?? new Hud(null), setupHooks?.cutsceneOptions?.(sh, world, loaded) ?? {});
  const live: LiveGame = {
    capture: () => captureWorld(world),
    restore: (save) => restore(save),
    cutsceneRunning: () => cutscene.active(),
  };
  /** a load waiting for this zone: the brick effects need the zone game's brick library (installed by the factory below), everything else is applied right after the set-up like FUN_0041adb5 does */
  let bricksPending: import('./save.ts').SaveGame | null = null;
  function restore(save: import('./save.ts').SaveGame, deferBricks = false) {
    // FUN_00419e82 after the variables (src/shell/saveworld.ts): walkers, camera + frame counter, object records, decor, entity records (position / angles / flags / node blobs), bricks
    let whole = false;
    try { whole = restoreWorld(world, save, { bricks: !deferBricks }); } catch (e) { console.warn('save load', e); }   // (the original's reader just returns 0 where a step fails)
    if (deferBricks && whole) bricksPending = save;
    const c = world.camera.c;
    if (!c.slice(0, 6).every(Number.isFinite) || !(c[0] || c[1] || c[2])) { world.camera.init(player); }   // a file without a camera (older port saves)
  }
  sh.live = live;
  if (pending) restore(pending, true);

  // ---- the ported gameplay of the zone (zonegame.ts), if any
  const subs: Subtitle[] = [];
  /** what the intro / help / banner panels need: the menu texture set, the PRESS / BESTURING texts and the key names of the player's current bindings (FUN_004384c9) */
  const panelEnv: PanelEnv = {
    set: sh.menuSet,
    press: sh.msgs.label('!PRESS'),
    title: sh.msgs.label('!FECONTRL'),
    keyName: (bit) => { const b = sh.input.bindings.find((x) => x.bit === bit); return b ? keyCodeName(b.code, sh.keyNames) : '--'; },   // FUN_004384c9 + 1 (FUN_00460f31): `---` + 1
    menuText: (id) => sh.msgs.tables[0]?.raw(id) ?? null,
  };
  /** FUN_0045d47f's four subtitle lines (DAT_05d4df1c ..) as the talking NPCs use them: written at the conversation start, shown until `clearSubtitle` (null = empty) */
  let held: string | null = null;
  /** the time a voice of a `held` / `none` line would take while muted (no `ga`): the timed subtitle of the shell's lines stands in for it there, these lines have none */
  let mutedVoice = 0;
  /** the length of a timed subtitle in the game's time unit (1/30 s): 1 s + 2 / 30 s per character */
  const subtitleTicks = (t: string) => 30 + 2 * t.length;
  /** port only: read the speech of these lines of `table` into memory in the background (src/audio/speech.ts `prefetch`): what the zone is going to say, before it says it */
  const prefetchSpeech = (ids: Iterable<string>, table: MessageTable | null, opts: { decode?: boolean } = {}) => {
    if (!table) return;
    const idx: number[] = [];
    for (const id of ids) { const v = table.voice(id); if (v >= 0) idx.push(v); }
    sh.audio.prefetchSpeech(idx, opts);
  };
  // the mini-games say a handful of lines out of their own table (intro, hit / miss calls, the result): read them all ahead, in speech order, while the zone loads (the hubs and the island say
  // lines of their story tables / cutscenes instead: those are read ahead by the nodes and the cutscene host)
  if (strings) {
    const voiced = strings.entries.map((e) => ({ tag: e.tag, v: strings!.voice(e.tag) })).filter((x) => x.v >= 0).sort((x, y) => x.v - y.v);
    if (voiced.length > 0 && voiced.length <= 60) prefetchSpeech(voiced.map((x) => x.tag), strings);
  }
  /** FUN_00439bf8 + FUN_00435a11 for the lines `a` (and `b`) of `table`; `subtitle`: zonegame.ts `SubtitleMode` */
  const sayFrom = (table: MessageTable | null, a: string | null, b?: string | null, voice = true, subtitle: SubtitleMode = 'timed'): boolean => {
    const lines = [a, b].filter((x): x is string => !!x);
    // FUN_004254a5: the text of a line (FUN_00439bf8; the tag itself = no such line: empty, strcmp) copied, the second appended (FUN_0085b570 / FUN_0085b580), then FUN_0045d47f, whatever the speech channel does
    if (subtitle === 'held') held = lines.map((id) => { const t = table?.text(id) ?? id; return t === id ? '' : t; }).join('');
    if (subtitle !== 'timed' && !voice) return true;
    if (subs.length > 0 || mutedVoice > 0 || sh.audio.ga?.speech.idle === false) return false;   // FUN_00435a11 starts only when no speech is active (muted: no `ga`, the timed subtitle stands in)
    const idx = lines.map((id) => table?.voice(id) ?? -1);
    if (voice && idx[0] !== undefined && idx[0] >= 0) sh.audio.ga?.speech.say(idx[0], idx[1] ?? -1);
    if (subtitle === 'timed') for (const id of lines) { const t = table?.text(id) ?? id; subs.push({ id, text: t, ticksLeft: subtitleTicks(t) }); }
    else if (!sh.audio.ga) mutedVoice = lines.reduce((n, id) => n + subtitleTicks(table?.text(id) ?? id), 0);
    return true;
  };
  const ctx: ZoneGameCtx = {
    sh, info, cfg, world, loaded, archive, scene, gr, hud, vars: sh.vars, strings, std: sh.std, attempt: sh.zoneAttempts.get(info.index) ?? 0,
    say: (a, b) => sayFrom(strings, a, b),
    sayFrom,
    speechIdle: () => subs.length === 0 && mutedVoice <= 0 && (sh.audio.ga?.speech.idle ?? true),
    speechWaiting: () => sh.audio.speechWaiting,
    prefetchSpeech: (ids, table = strings, opts) => prefetchSpeech(ids, table, opts),
    stopSpeech() { subs.length = 0; mutedVoice = 0; sh.audio.ga?.speech.stop(); },   // (FUN_00435b07 leaves the four subtitle lines alone)
    clearSubtitle() { held = null; },
    // (port: a subtitle is shown from the moment its audio starts: while the line's data is still on its way the text waits with it, see SpeechEngine.waiting)
    subtitle: () => (sh.audio.speechWaiting ? null : held ? { id: '', text: held, ticksLeft: Infinity } : subs[0] ?? null),
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
  if (!gameFactory) throw new Error(`zone ${zoneName} has no zone game (src/zones/index.ts registers one per zone)`);
  const game: ZoneGame = await gameFactory(ctx);
  if (bricksPending) { restoreBricks(world, bricksPending); bricksPending = null; }
  Object.assign(cfg, game.config ?? {});
  if (game.config?.intro === undefined) cfg.intro = !!game.introId;
  if (game.config?.help === undefined) cfg.help = !!game.helpControls;
  const helpControls = game.helpControls ?? 0;
  /** the lines of the intro panel (mode 1): the zone's `introLines`, else its `introId` at y 120 (FUN_00465d39) or the y the executable's table (zoneintro.ts) has for that id */
  const introLines = (): ScreenLine[] => {
    const ids = game.introLines ?? (game.introId ? [{ id: game.introId, y: zoneIntroFor(zoneName)?.lines.find((l) => l.id === game.introId)?.y ?? 120, wrap: 30 }] : []);
    return ids.map((l) => ({ text: strings?.text(l.id) ?? l.id, y: l.y, wrap: l.wrap ?? 30 }));
  };
  // the brief is spoken when the loop starts (FUN_00439bf8 + FUN_00435a11 before the mode loop), a button press stops it
  if (cfg.intro) {
    const sp = game.introLines?.map((l) => l.id) ?? (game.introId ? [game.introId] : []);
    if (sp.length > 0 && !game.introHold && game.introPanel !== false) ctx.say(sp[0], sp[1]);
  }

  const m = new LoopMachine(cfg);
  // the Ontwikkelaarshoek (src/devcorner): debug mode only, `dev` is null otherwise and every `dev?.` below does nothing
  const dev = debugAids() ? (await import('../devcorner/index.ts')).attachZone({ sh, info, world, gr, loaded, machine: m, game, ctx, cutscene, archive, hud }) : null;
  let gameOver = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'F8' && !dev) { gr.viewPlaneTextured = !gr.viewPlaneTextured; e.preventDefault(); }   // debug: the original's never-run textured view plane (z10RGB / z22BIP)
  };
  if (debugAids()) addEventListener('keydown', onKey);   // not in the original: only with the debug option
  sh.attachMenuKeys();
  let bannerOpen = false;
  let wasHolding = !!game?.introHold?.();
  let resultResult = 0;
  const tick = (): boolean => {
    sh.input.update();
    if (dev?.tick()) return m.done;   // the corner is open and pauses the game
    const pressed = sh.input.pressed;
    let pauseResult = 0;
    if (m.mode === MODE.PAUSE) {
      if (!sh.menu.isOpen) sh.menu.open(PAUSE_PAGE[cfg.pauseKind], cfg.pauseMask, true);
      const r = sh.menu.step(pressed, sh.pointer);
      if (r !== 0) { sh.menu.close(); pauseResult = r === MR.RESUME ? 1 : r === MR.QUIT ? -1 : r === MR.RESTART ? -2 : r === MR.ABANDON ? -3 : 1; }
    }
    let storyAdvanced = false, varChanged = false;
    if (m.mode === MODE.BANNER && game?.tickInBanner) { world.tick(); game.bannerTick?.(); }   // zones whose loop also updates in the end banner (z41MAP)
    if (m.mode === MODE.PLAY) {
      game?.beforeTick?.();
      world.tick();
      if (!gameOver) { const r = game.update(); if (r) gameOver = r; }
      { const lr = game?.leaveRequest?.(); if (lr) m.leave(lr); }
      if ((cfg.hub || !ROOMS.has(zoneName)) && !game?.noStoryFrame) storyAdvanced = sh.story.frame() === 6;
      if (!storyAdvanced && game?.storyTick) { const e = game.storyTick(); if (e !== undefined && e !== EXIT.RUNNING) m.leave(e); }
      varChanged = sh.vars.get(V.NS_NEXT_SUBGAME) !== sh.vars.get(V.CURRENT_SUBGAME);
      if (dev) { dev.afterSim(); if (dev.storyLeave()) storyAdvanced = true; }   // free camera / autoplay (F8) of the corner
    }
    if (island) hud?.updateIsland(sh.vars, world.dt);   // FUN_004b908d: every frame of the island loop, whatever the mode
    if (m.mode === MODE.PLAY && gameOver) bannerOpen = true;
    if (m.mode === MODE.BANNER && !bannerOpen) bannerOpen = true;
    if (m.mode === MODE.RESULT) game?.resultTick?.();
    if (m.mode === MODE.RESULT && !game?.resultHold?.()) {
      const dlg = game?.dialog;   // a zone's own dialog (z04IFC's exit question): page and answers come from the zone
      if (!sh.menu.isOpen) sh.menu.open(dlg ? dlg.page : gameOver === 1 ? 0x10 : 0x13, 0, false);   // FUN_0041c092: kind (success != 1) + 1 -> page 16 (continue / retry) or 19 (retry / abort)
      const r = sh.menu.step(pressed, sh.pointer);
      if (r !== 0 && dlg) { sh.menu.close(); const ok = r === MR.RESUME; dlg.done(ok); resultResult = ok ? 1 : 99; }
      else if (r !== 0) { sh.menu.close(); sh.vars.set(0xb, 0); resultResult = r === MR.RESUME ? (gameOver === 1 ? 1 : -3) : r === MR.RESTART ? -2 : -3; }
    }
    const prev = m.mode;
    if (m.mode === MODE.INTRO) game?.introTick?.();
    const holding = m.mode === MODE.INTRO && !!game?.introHold?.();
    if (m.mode === MODE.INTRO && wasHolding && !holding && game?.introId) ctx.say(game.introId);   // the brief after the cutscene (z40aPO)
    wasHolding = holding;
    if (m.mode === MODE.BANNER && !game?.tickInBanner) game?.bannerTick?.();
    // the timed subtitle / muted-voice stand-ins count in the game's time unit (1/30 s: `30 + 2 * length` of them), each sim step takes `DAT_008b1718` of it
    if (subs.length > 0 && !sh.audio.speechWaiting && (subs[0].ticksLeft -= world.dt) <= 0) subs.shift();   // (port: the subtitle time runs from the audio's start)
    if (mutedVoice > 0) mutedVoice -= world.dt;
    // a zone whose mode 1 has no panel (the island) leaves it on any button (DAT_00983840 != 0)
    // M5 audit: the mini-game loops leave the intro / help screens on ANY pressed button (`DAT_00983840 != 0`: the arrows, Z / X / C and the `<>` key count too), not only on Enter / Space / Shift / Alt / Ctrl; the same for the end banner (mode 4), whose three exceptions (z05WAB, z38PAR, z40aPO) test the HELD buttons through `skipBanner`
    const anyButton = ((m.mode === MODE.INTRO || m.mode === MODE.HELP || m.mode === MODE.HELP2) && (pressed & ~B.ESC) !== 0) || (m.mode === MODE.BANNER && ((pressed & ~B.ESC) !== 0 || game?.skipBanner?.() === true)) ? B.ENTER : 0;   // skipBanner: z01BPK's banner is left at once without points
    m.tick({ dt: world.dt, pressed: ((game?.blockPause?.() ? pressed & ~B.ESC : pressed) | anyButton) & (holding ? B.ESC : ~0), pauseResult, resultResult, gameOver, storyAdvanced, varChanged, dialog: m.mode === MODE.PLAY && !!game?.dialog?.wanted(), help2: m.mode === MODE.PLAY && !!game?.wantsHelp2?.(), skipInit: m.mode === MODE.INIT && game?.skipInit?.() === true });
    if (resultResult === 99) resultResult = 0;   // a zone dialog's "back to play" answer is used once
    game?.everyTick?.(m.mode);
    if (m.mode !== prev && m.mode === MODE.PAUSE && prev !== MODE.PAUSE) sh.menu.open(PAUSE_PAGE[cfg.pauseKind], cfg.pauseMask, true);
    if (m.mode !== prev && (prev === MODE.INTRO || prev === MODE.HELP)) ctx.stopSpeech();
    if (m.mode !== prev) sh.audio.modeChange(prev, m.mode);   // the music's moments (leaving the intro / the controls help: FUN_004432c0)
    if (m.mode !== prev && game) {
      if (m.mode === MODE.PLAY && (prev === MODE.INTRO || prev === MODE.HELP || prev === MODE.INIT)) game.onStart?.();
      if (m.mode === MODE.BANNER) game.onBanner?.(gameOver);
      if (prev === MODE.HELP2 && m.mode === MODE.PLAY) game.onHelp2End?.();
    }
    if (prev === MODE.PAUSE && m.mode !== MODE.PAUSE) sh.menu.close();
    if (prev === MODE.RESULT && m.mode !== MODE.RESULT) sh.menu.close();
    if (hud && m.mode !== MODE.PAUSE) hud.step(sh.ui, world.dt);   // FUN_0045f771: the letterbox bars grow once per drawn frame of the original = once per sim step, `rate * DAT_008b1718`
    sh.audio.frame(world.camera.c, world.dt);   // FUN_004434d0 (the 3D listener = the camera) + FUN_00435a5e (the speech state machine), once per frame
    game?.beforeRender?.(1);   // (the zone's per-frame view settings, fov / near, are those of this pass's frustum)
    gr.stepView();   // the draw pass of this loop pass: the frustum the nodes of the next pass read (FUN_00444370), per sim step, not per browser frame
    return m.done;
  };

  const render = (_alpha: number, dt: number) => {
    const a = 1;   // no interpolation: the loop passes alpha = 1 and a faster display draws the last step again
    game?.beforeRender?.(a);
    gr.loopMode = m.mode;   // the fade-in has the set-up helpers' fog, the play call takes over when it completes (src/game/fogphases.ts)
    gr.render(a, dt);
    sh.ui.begin(sh.canvas.width, sh.canvas.height);
    if (hud && m.mode !== MODE.PAUSE) hud.draw(sh.ui);
    if (game && (m.mode !== MODE.PAUSE || game.draw2dInPause)) game.draw2d?.(sh.ui, dt, m.mode);
    // mode 1: the one-line brief (FUN_00439c6f(zone table, font, id, 1, 0, 320, 120, 30)), mode 9: the controls help
    if (m.mode === MODE.INTRO && !game?.introHold?.() && game?.introPanel !== false) drawIntroScreen(sh.ui, panelEnv, introLines());
    if (m.mode === MODE.HELP && helpControls) drawHelp(sh.ui, sh.menuSet, strings, helpControls, panelEnv);
    // spoken lines of the game while playing (a mini-game of the original shows no subtitle for them, only the cutscenes do: the cutscene style of FUN_0045d47f)
    if (subs.length > 0 && !sh.audio.speechWaiting && sh.options.subtitlesOn && m.mode === MODE.PLAY && !held) drawSubtitle(sh.ui, subs[0].text);
    // the talking NPCs' four lines (FUN_00460003 draws whatever FUN_0045d47f wrote; the subtitle option was asked when they were written)
    if (held && m.mode === MODE.PLAY) drawSubtitle(sh.ui, held);
    if (m.mode === MODE.PAUSE || (m.mode === MODE.RESULT && !game?.resultHold?.())) sh.menu.draw(sh.ui, sh.menuSet);
    // mode 4, the end banner (FUN_00465d39): the medal text (STD.str) at y = 150, or the failure text
    if (m.mode === MODE.BANNER && game?.drawBanner) game.drawBanner(sh.ui, gameOver);
    else if (m.mode === MODE.BANNER) drawBannerScreen(sh.ui, panelEnv, { lines: [{ text: gameOver === 1 ? sh.std.text('SGGOLD') : sh.msgs.label('!EndGame3M0'), y: 150, wrap: 30 }] }, sh.std);
    sh.ui.fade(m.fade);
    sh.ui.flush();
  };
  Object.assign(window as unknown as Record<string, unknown>, { __zone: { info, loaded, world, machine: m, gr, hud, sh, game, ctx } });

  stopLoading();   // the loading card is presented until the loop takes over
  await sh.runLoop(tick, render, world, zoneName === 'z03PPH');
  sh.dt = world.dt;
  removeEventListener('keydown', onKey);
  const devExit = dev?.exit ?? null;
  dev?.destroy();
  game?.destroy?.();
  cutscene.abort();
  ctx.stopSpeech();
  sh.detachMenuKeys();
  offOpt();
  sh.menu.close();
  const exit = m.exit;
  restartedZone = exit === EXIT.RESTART ? zoneName : null;
  world.destroy();
  sh.live = null;
  // the outro movie at the end of the story (FUN_0081fd64: result 2 and the zone was not started from the menu): the story has advanced to the island
  // (FUN_00404d14 runs before the movie), the movie only restores audio / movie state: no credits (they are a menu item only; gaps.md U2, settled from the decompile)
  if (zoneName === 'z42BRP' && exit === EXIT.FINISHED && sh.vars.get(0xb) === 0) await sh.runMovie('outroFmv');
  if (devExit !== null) return devExit;   // the corner left the zone (Springen / Records)
  return game?.exitNext?.(exit) ?? nextAfterExit(sh, info, cfg, exit);
}
