// The zone game of z09JST (Jousting) for the generic zone runner (src/shell/playzone.ts). The rules are the duel node (duel.ts, run by the `JSTGame` behaviour node like
// FUN_005ce506); this adds what FUN_005cd33d / FUN_005ce27f / FUN_005d3f30 / FUN_005d2814 / FUN_005d4070 / FUN_005d4467 do around it: set-up of the animations, the HUD
// (two counters, the score and the charge gauge), the aim marker, the round popups, the end banner and the sounds.
import type { Ui2D } from '../../ui/renderer2d.ts';
import { GATE_OFF, GATE_ON, ZoneParticles } from '../../fx/particles/zone.ts';
import { installCtx } from '../../island/ctx.ts';
import type { IslandCtx } from '../../island/ctx.ts';
import type { GameRecord } from '../../game/record.ts';
import { MODE } from '../../shell/loopmachine.ts';
import { frustumPlanes, projectPoint, visibleFlags } from '../../fx/particles/sprites.ts';
import { reticleLines, reticleMode } from './marker.ts';
import { drawIntroScreen } from '../../shell/helpscreen.ts';
import type { ScreenLine } from '../../shell/helpscreen.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import { Gear, JstGameNode, startDuel, applyRestart, rememberRestart } from './rig.ts';
import { JoustDuel } from './duel.ts';
import { startTickClock } from '../common/tickrand.ts';
import { REC, SAY } from './consts.ts';
import { JoustSound } from './sound.ts';
import { finalLines, popupLines } from './screens.ts';
import type { PanelLine } from './screens.ts';

export async function createJstGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, gr, hud, archive } = ctx;
  startTickClock();                                          // FUN_00435c81 (the zone's start, LE2.c:126202): the base of FUN_00435c91, which scales the reaction variant's random pick
  // the shore foam's texture wobble (SeaAmin 0x4b1212 is attached here too: FUN_0043ebe0(model, 0, &0, &v) adds v to the V coordinates of every group): the node reaches the renderer through the island context's `uvScroll`
  installCtx(world, { world: world, shared: {}, uvScroll(rec: GameRecord, du: number, dv: number) { const n = ctx.gr.groupCount(rec); for (let g = 0; g < n; g++) ctx.gr.scrollGroup(rec, g, du, dv); } } as unknown as IslandCtx);
  const recs = world.records;
  const ga = ctx.sh.audio.ga;
  const sound = new JoustSound(ga);
  void sound.load();
  const { duel, node, gear } = startDuel({ world, archive, pe: ctx.sh.pe, sound, say: (a, b) => { ctx.say(a, b ?? null); }, stopSpeech: () => ctx.stopSpeech(), onGear: () => gr.refreshViews() });
  // FUN_005d1f64: the constructor's emitters: `botexpl01` (FUN_004429e0 = a stub that hands out the invalid handle: nothing to start) and eight `orsemud1` mud clouds at the hooves of the two
  // horses (parent matrix = the horse's record, offset 0; odd / even ones rotated -pi/2 about x or not; the second one starts ON), every one switched off again at the end of the constructor
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const horse = [recs[REC.HORS].m, recs[REC.DRKH].m];
    const rot: [number, number, number][] = [[-Math.PI / 2, 0, 0], [0, 0, 0], [-Math.PI / 2, 0, 0], [0, 0, 0]];
    const h: number[] = [];
    for (let i = 0; i < 8; i++) h.push(fx.start('orsemud1.par', horse[i >> 2], [0, 0, 0], rot[i & 3], i === 1 ? GATE_ON : GATE_OFF));
    for (const k of h) fx.off(k);
    duel.host.fx = { gate: (i, on) => (on ? fx.on(h[i]) : fx.off(h[i])), matrix: (i, m) => fx.setMatrix(h[i], m) };
  }
  applyRestart(duel, ctx.attempt);                          // the original restarts in place: the spectator level survives
  gr.fov = 1.0;

  hud.visible = false;
  hud.left = { tex: 10, tint: 0xffffffff };                  // DAT_05d4dd14 = 10 (the dark knight's counter), DAT_05d4dd38 = 9 (the player's)
  hud.right = { tex: 9, tint: 0xffffffff };
  hud.gauge = { value: 0, min: 0, max: 60, segments: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], marker: 0, icon: 8 };
  const syncHud = () => {
    hud.leftText = String(duel.shown.hitsE);
    hud.rightText = String(duel.shown.hitsP);
    hud.centreText = String(duel.shown.score);
    if (hud.gauge) hud.gauge.value = duel.gauge;
  };
  syncHud();

  const toScreen = (l: PanelLine): ScreenLine => ({ text: l.table === 'raw' ? l.text : l.table === 'std' ? ctx.std.text(l.text) : (ctx.strings?.text(l.text) ?? l.text), y: l.y, wrap: l.wrap });

  /**
   * the aim marker (FUN_005d2814, the dark knight's draw hook): the origin of the world matrix of the last mesh the record drew (the shield attachment; `GameRenderer.lastWorld`) is checked with
   * ComputeSphereVisibility (radius 1.0: drawn only when completely inside the frustum) and projected to a point of the back buffer; the 16 lines (marker.ts) are in PIXELS of that back buffer
   * (the original's display mode; here the 4:3 area of the canvas, `ui.view`), then scaled to the 640x480 grid of the 2D layer
   */
  gr.trackWorld.add(recs[REC.DRKK]);
  const drawReticle = (ui: Ui2D) => {
    const wm = gr.lastWorld.get(recs[REC.DRKK]);
    if (!wm) return;
    const vp = gr.lastViewProj, v = ui.view;
    if (visibleFlags(frustumPlanes(vp, planes), wm[12], wm[13], wm[14], 1.0) !== 0) return;       // FUN_00416d1a returns (flags == 0)
    projectPoint(vp, wm[12], wm[13], wm[14], v.w, v.h, scr, 0);
    const k = 640 / v.w, ky = 480 / v.h;
    for (const l of reticleLines(scr[0], scr[1], duel.aimX, duel.aimY)) {
      const x0 = Math.min(l.x0, l.x1) * k, x1 = (Math.max(l.x0, l.x1) + 1) * k, y0 = Math.min(l.y0, l.y1) * ky, y1 = (Math.max(l.y0, l.y1) + 1) * ky;     // a 1 pixel line
      ui.fillRect([x0, y0, x1, y1], l.color);
    }
  };
  const planes = new Float32Array(24), scr = new Float32Array(4);

  /** FUN_005d4467: the end panel (score, medal, the knights' verdict) */
  const finalBanner = (ui: Ui2D) => {
    const lines = finalLines({ medal: duel.medal, score: duel.score }).map(toScreen);
    drawIntroScreen(ui, ctx.panelEnv(), lines);
  };

  /** the HUD (FUN_0046055f) is drawn after the zone's popups: while a popup is up the runner's own HUD draw is switched off and `draw2d` draws it on top */
  let playing = false;
  const game: ZoneGame & { duel: JoustDuel; node: JstGameNode | null; sound: JoustSound; gear: Gear } = {
    duel, node, sound, gear,
    introId: SAY.INTRO,
    helpControls: 7,
    tickInBanner: true,
    onStart() { playing = true; hud.visible = true; },
    update() {
      // without the attach (a world built without the extraction) the game drives the duel itself
      if (!node) { duel.dt = world.dt; duel.update(world.input.held, world.input.pressed); }
      syncHud();
      sound.listener(world.camera.c, [world.camera.c[3], world.camera.c[4], world.camera.c[5]]);
      return duel.result || undefined;
    },
    onBanner() { playing = false; hud.visible = false; },
    bannerTick() { syncHud(); },
    beforeRender() {
      sound.listener(world.camera.c, [world.camera.c[3], world.camera.c[4], world.camera.c[5]]);
      hud.visible = playing && duel.state !== 0x21;
    },
    draw2d(ui, _dt, mode) {
      if (reticleMode(mode) && duel.reticle) drawReticle(ui);        // every loop mode but the pause menu and the controls help (DAT_05d5ad04 != 3 / 9)
      if (mode === MODE.PLAY) {
        if (duel.state === 0x21) {
          drawIntroScreen(ui, ctx.panelEnv(), popupLines(duel).map(toScreen));
          hud.visible = true; hud.draw(ui, world.dt); hud.visible = false;
        }
      }
    },
    drawBanner(ui) { finalBanner(ui); },
    destroy() {
      rememberRestart(duel);
      sound.stopAll();
      gear.restore();
      hud.gauge = null; hud.visible = true; hud.leftText = ''; hud.rightText = ''; hud.centreText = ''; hud.left = { tex: -1, tint: 0xffffffff }; hud.right = { tex: -1, tint: 0xffffffff };
    },
    debug() {
      const d = duel;
      return {
        state: d.state, ticks: d.ticks, speed: d.speed, gauge: d.gauge, ready: d.ready, hitsP: d.hitsP, hitsE: d.hitsE, score: d.score, medal: d.medal, result: d.result, aim: [d.aimX, d.aimY], aimSq: d.aimSq,
        level: d.level, variant: d.variant, camMode: d.camMode, popup: d.popup, p: [...d.pPos], e: [...d.ePos], nodeRan: node?.ran ?? -1,
        trophy: world.vars.get(0xcb), hiscore: world.vars.get(0x18),
      };
    },
  };
  return game;
}
