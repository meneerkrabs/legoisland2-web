// The zone game of z09JST (Jousting) for the generic zone runner (src/shell/playzone.ts). The rules are the duel node (duel.ts, run by the `JSTGame` behaviour node like
// FUN_005ce506); this adds what FUN_005cd33d / FUN_005ce27f / FUN_005d3f30 / FUN_005d2814 / FUN_005d4070 / FUN_005d4467 do around it: set-up of the animations, the HUD
// (two counters, the score and the charge gauge), the aim marker, the round popups, the end banner and the sounds.
import type { Ui2D } from '../../ui/renderer2d.ts';
import { GATE_OFF, GATE_ON, ZoneParticles } from '../../fx/particles/zone.ts';
import { MODE } from '../../shell/loopmachine.ts';
import { drawIntroScreen } from '../../shell/helpscreen.ts';
import type { ScreenLine } from '../../shell/helpscreen.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import { Gear, JstGameNode, startDuel, applyRestart, rememberRestart } from './rig.ts';
import { JoustDuel } from './duel.ts';
import { REC, SAY } from './consts.ts';
import { JoustSound } from './sound.ts';
import { finalLines, popupLines } from './screens.ts';
import type { PanelLine } from './screens.ts';

/** the 2D layer is the 640x480 virtual grid (the overlays and the aim marker are laid out in it) */
const W = 640, H = 480;

/** project a world point with the camera of the world (left-handed look-at, vertical field of view `fov`, 4:3) to the 640x480 grid; null behind the camera */
export function project(c: ArrayLike<number>, fov: number, p: ArrayLike<number>): [number, number] | null {
  let fx = c[3] - c[0], fy = c[4] - c[1], fz = c[5] - c[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let rx = fz, rz = -fx;
  const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
  const z = dx * fx + dy * fy + dz * fz;
  if (z <= 0.1) return null;
  const x = dx * rx + dz * rz, y = dx * ux + dy * uy + dz * uz;
  const t = Math.tan(fov / 2);
  return [(W / 2) * (1 + x / z / (t * (W / H))), (H / 2) * (1 - y / z / t)];
}

/** the 16 line segments of the two markers of FUN_005d2814 around (cx, cy): half size `s`, the short part `s / 3` of every side (the fixed corner marks 20, the aim marker 30) */
export function markerSegments(cx: number, cy: number, s: number): [number, number, number, number][] {
  const t = s / 3;
  return [
    [cx - s, cy - t, cx - s, cy - s], [cx - s, cy - s, cx - t, cy - s], [cx + t, cy - s, cx + s, cy - s], [cx + s, cy - s, cx + s, cy - t],
    [cx + s, cy + t, cx + s, cy + s], [cx + s, cy + s, cx + t, cy + s], [cx - t, cy + s, cx - s, cy + s], [cx - s, cy + s, cx - s, cy + t],
  ];
}

export async function createJstGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, gr, hud, archive } = ctx;
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

  /** the aim marker (FUN_005d2814): fixed corner marks at the shield of the dark knight (white), the aim point = that + the aim offset (yellow, red inside radius sqrt(40)) */
  const drawReticle = (ui: Ui2D) => {
    // the renderer shows the state between the last two ticks: the marker uses the same interpolated camera, record matrix and pose
    const d = recs[REC.DRKK], cam = world.camera;
    const c = [0, 1, 2, 3, 4, 5].map((i) => cam.prev[i] + (cam.c[i] - cam.prev[i]) * alpha);
    const pose = d.anim?.pose(alpha);
    const l = pose && pose.length >= 17 * 16 ? [pose[16 * 16 + 12], pose[16 * 16 + 13], pose[16 * 16 + 14]] : [0, 0, 0];
    const m = d.m.map((v, i) => d.prev[i] + (v - d.prev[i]) * alpha);
    const w = [l[0] * m[0] + l[1] * m[4] + l[2] * m[8] + m[12], l[0] * m[1] + l[1] * m[5] + l[2] * m[9] + m[13], l[0] * m[2] + l[1] * m[6] + l[2] * m[10] + m[14]];
    const p = project(c, gr.fov, w);
    if (!p) return;
    const seg = (s: [number, number, number, number], argb: number) => {
      const x0 = Math.min(s[0], s[2]) - 1, x1 = Math.max(s[0], s[2]) + 1, y0 = Math.min(s[1], s[3]) - 1, y1 = Math.max(s[1], s[3]) + 1;
      ui.fillRect([x0, y0, x1, y1], argb);
    };
    for (const s of markerSegments(p[0], p[1], 20)) seg(s, 0xffffffff);
    const col = duel.aimX * duel.aimX + duel.aimY * duel.aimY < 40 ? 0xffff0000 : 0xffffff00;
    for (const s of markerSegments(p[0] + duel.aimX, p[1] + duel.aimY, 30)) seg(s, col);
  };

  /** FUN_005d4467: the end panel (score, medal, the knights' verdict) */
  const finalBanner = (ui: Ui2D) => {
    const lines = finalLines({ medal: duel.medal, score: duel.score }).map(toScreen);
    drawIntroScreen(ui, ctx.panelEnv(), lines);
  };

  /** the HUD (FUN_0046055f) is drawn after the zone's popups: while a popup is up the runner's own HUD draw is switched off and `draw2d` draws it on top */
  let playing = false;
  let alpha = 1;
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
    beforeRender(a) {
      alpha = a;
      sound.listener(world.camera.c, [world.camera.c[3], world.camera.c[4], world.camera.c[5]]);
      hud.visible = playing && duel.state !== 0x21;
    },
    draw2d(ui, dt, mode) {
      if (mode === MODE.PLAY) {
        if (duel.reticle && duel.ticks > 0) drawReticle(ui);
        if (duel.state === 0x21) {
          drawIntroScreen(ui, ctx.panelEnv(), popupLines(duel).map(toScreen));
          hud.visible = true; hud.draw(ui, dt * 30); hud.visible = false;
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
