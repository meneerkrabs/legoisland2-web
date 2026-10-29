// The zone game of z08BKD for the generic zone runner (src/shell/playzone.ts): what the loop FUN_005b8368 does around the nodes: the intro / help screens, the HUD
// (the five brick icons, the page icon, the oxygen gauge), the 3D sound listener, the end of the game (all bricks / out of time), the banner and the variables.
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import type { Medal } from '../../shell/helpscreen.ts';
import type { SoundBackend } from '../parachute/sound.ts';
import { VAR } from './consts.ts';
import { medalOfScore } from './state.ts';
import { prepareBkd, snapshot } from './run.ts';
import type { BkdRun } from './run.ts';

/** the HUD textures of Overlays/z08BKD (FUN_005b9fca): 1 gauge icon, 2 gauge segment, 4 brick icon, 5 page icon */
export const HUD_TEX = { GAUGE_ICON: 1, SEGMENT: 2, BRICK: 4, PAGE: 5 } as const;
/** the gauge's tint (0xff77ffff) */
export const GAUGE_TINT = 0xff77ffff;

/** the end of the game (FUN_005b7f60): not all bricks: CASGBD04, only the hi-score; else bronze / silver / gold with CASGBD03 / 02 / 01, trophy 1 / 2 / 3 when the hi-score rises */
export function finish(vars: { get(i: number): number; set(i: number, v: number): void }, success: boolean, score: number): { text: string; medal: Medal; line: string } {
  const text = String(score).padStart(5, ' ');     // sprintf("%5d")
  if (!success) {
    if (vars.get(VAR.HISCORE) < score) vars.set(VAR.HISCORE, score);
    return { text, medal: 0, line: 'CASGBD04' };
  }
  const m = medalOfScore(score);
  if (vars.get(VAR.HISCORE) < score) { vars.set(VAR.TROPHY, m); vars.set(VAR.HISCORE, score); }
  return { text, medal: m, line: m === 3 ? 'CASGBD01' : m === 2 ? 'CASGBD02' : 'CASGBD03' };
}

export function createBkdGame(ctx: ZoneGameCtx): ZoneGame {
  const { world, gr, hud, vars, sh } = ctx;
  const ga = sh.audio.ga;
  const run: BkdRun = prepareBkd(world, ctx.archive, ctx.scene, {
    backend: (ga?.sfx ?? null) as unknown as SoundBackend | null,
    speak: (id) => { ctx.say(id); },
    attach: (rec, slot, bone, child) => gr.setAttach(rec, slot, bone, child),
  });
  const { state } = run;
  let done = 0, banner: { text: string; medal: Medal; line: string } | null = null;

  // the HUD (FUN_005b9fca / FUN_0045f9d2): the page icon at the left corner, five brick icons in the left column, the oxygen gauge at the right
  hud.visible = false;
  hud.left = { tex: HUD_TEX.PAGE, tint: state.pageTint };
  hud.right = { tex: -1, tint: 0xffffffff };
  hud.column = state.brickTint.map((tint) => ({ tex: HUD_TEX.BRICK, tint }));
  hud.gauge = { value: state.gauge, min: 0, max: 100, segments: Array(12).fill(HUD_TEX.SEGMENT), marker: -1, icon: HUD_TEX.GAUGE_ICON, tint: GAUGE_TINT };
  const syncHud = () => {
    hud.left = { tex: HUD_TEX.PAGE, tint: state.pageTint };
    state.brickTint.forEach((t, i) => { hud.column[i].tint = t; });
    hud.gauge!.value = state.gauge;
  };

  /** FUN_005b8319: the listener is the camera's target (the diver), looking along the view */
  const listen = () => {
    const c = world.camera.c;
    ga?.sfx.setListener({ x: c[3], y: c[4], z: c[5] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };
  listen();

  const game: ZoneGame & { run: BkdRun } = {
    run,
    introId: 'CASGBD13',   // (switches the brief on; the panel itself comes from `introLines`)
    introLines: [{ id: 'CASGBD13', y: 0x32, wrap: 30 }, { id: 'CASGBD14', y: 200, wrap: 30 }],
    helpControls: 5,
    onStart() { hud.visible = true; },
    beforeTick() { run.beforeTick(); },
    update() {
      run.afterTick();
      syncHud();
      listen();
      const r = run.result();
      if (r && !done) done = r;
      return r || undefined;
    },
    onBanner(result) {
      // FUN_005b7f60: stop the speech, the score text, the medal / failure line (spoken), the variables
      hud.visible = false;
      run.sound.stopAll();
      ctx.stopSpeech();
      banner = finish(vars, result === 1, state.score());
      ctx.say(banner.line);
    },
    draw2d(_ui: Ui2D, _dt: number, mode: number) { void mode; },
    drawBanner(ui: Ui2D) {
      const b = banner ?? finish({ get: () => 0, set: () => undefined }, done === 1, state.score());
      ctx.banner(ui, { score: { text: b.text, y: 0x32 }, medal: b.medal, medalY: 100, lines: [ctx.line(b.line, 0x96, 30)] });
    },
    destroy() { run.sound.stopAll(); hud.gauge = null; hud.column = []; hud.visible = true; },
    debug() {
      const sn = snapshot(run);
      return { ...sn, bricks: sn.bricks, brickList: sn.brickList, done, hiscore: vars.get(VAR.HISCORE), trophy: vars.get(VAR.TROPHY), gotPage: vars.get(VAR.GOT_PAGE) };
    },
  };
  return game;
}
