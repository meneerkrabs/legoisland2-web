// z20DSP "Desert Speedster" (Adventure Island's oasis race / time trial): docs/re/m6/z20DSP.md. The player drives the Speedster (record 38) from the start line to the oasis
// along a 8.7 km track spline (matanim/car1.man) while cows fall, rocks roll, a whirlwind and flying saucers get in the way; TURB bricks give a speed boost, TIME bricks
// freeze the clock; the clock counts 2:30 down on the HUD, the medal comes from the finish time (< 90 s gold, < 120 s silver, < 150 s bronze).
// Registers the constructors of the zone's behaviours (src/zones/z20dsp/*) and the zone game: the camera, the HUD, the result panel, the sounds.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame } from '../shell/zonegame.ts';
import { MODE } from '../shell/loopmachine.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import { DspShared, REC, SND, VAR, STATE, SOUNDS_2D, SOUNDS_3D, HUD_TEX } from './z20dsp/shared.ts';
import type { DspSounds } from './z20dsp/shared.ts';
import { prepareDsp } from './z20dsp/prepare.ts';
import { SpeedsterNode, CTOR_SPEEDSTR } from './z20dsp/speedster.ts';
import { FallingNode, TurboNode, BerthaNode, SpinNode, SaucerNode, ScrConeNode, WhirlwindNode, PropNode, CTOR } from './z20dsp/props.ts';
import { medalFromVar, resultLines } from './z20dsp/rules.ts';
import { startDspEmitters } from './z20dsp/emitters.ts';
import { ZoneParticles } from '../fx/particles/zone.ts';
import { startTickClock } from './common/tickrand.ts';

/** the state of one run (the original's globals): a new one is made by the Speedster's constructor, i.e. every time the zone starts */
let shared = new DspShared();
registerCtor(CTOR_SPEEDSTR, () => { shared = new DspShared(); return new SpeedsterNode(shared); });
const prop = <T extends PropNode>(n: T): T => { n.shared = shared; return n; };
registerCtor(CTOR.FALLING, () => prop(new FallingNode()));
registerCtor(CTOR.TURBO, () => prop(new TurboNode()));
registerCtor(CTOR.BERTHA, () => prop(new BerthaNode()));
registerCtor(CTOR.SPIN, (a) => prop(new SpinNode(a.record === REC.SPN[1] ? 3.1415927410125732 : 0)));
registerCtor(CTOR.SAUCER, (a) => prop(new SaucerNode(a.record)));
registerCtor(CTOR.SCRCONE, (a) => prop(new ScrConeNode(REC.SCR[(REC.CON as readonly number[]).indexOf(a.record)] ?? 29)));
registerCtor(CTOR.WHIRLWIND, () => prop(new WhirlwindNode()));

registerZoneGame('z20DSP', async (ctx) => {
  const { world, loaded, archive, vars, sh, hud, scene, gr } = ctx;
  startTickClock();                                   // FUN_006bde34 (the zone's run) calls FUN_00435c81: the sound picks scale rand() by the ms since here
  const pep = loaded.pepper;
  const { speed, camera } = prepareDsp(shared, world, loaded, archive, scene, sh.pe);
  gr.poseRange = 1e9;                                 // the skinned props are visible from far away: always use their own rig
  shared.say = (id) => ctx.say(id);

  // ---- the particle emitters (FUN_00442900("Z20DSP") + FUN_006bf633, then FUN_0044e8d0): the Speedster moves their matrices (speedster.ts)
  const fxp = await ZoneParticles.create(ctx);
  if (fxp) {
    shared.fx = {
      start: (name, m, pos, rot, gate) => fxp.start(name, m, pos, rot, gate),
      setMatrix: (h, m) => fxp.setMatrix(h, m),
      stop: (h) => fxp.stop(h),
    };
    startDspEmitters(shared, world);
    fxp.finish();
  }

  // ---- sounds: 2D ones through the world's sink, the positional ones through GameAudio's 3D slots (the listener = the camera)
  const ga = sh.audio.ga;
  const slots3 = new Map<number, SoundSlot>();
  sh.audio.preload(SOUNDS_2D);
  if (ga) for (const id of SOUNDS_3D) ga.sfx.load3D(id).then((s) => slots3.set(id, s)).catch(() => { /* silent (RROCK1 / 2 are PSX-only: no file) */ });
  const sounds: DspSounds = {
    play: (id) => ctx.sfx(id),
    stop: (id) => sh.audio.stop(id),
    rate: (id, hz) => sh.audio.rate(id, hz),
    play3D: (id, x, y, z) => { const s = slots3.get(id); if (s && ga) { try { ga.sfx.play3D(s, { x, y, z }); } catch { /* silent */ } } },
    stop3D: (id) => { const s = slots3.get(id); if (s && ga) { try { ga.sfx.stop(s); } catch { /* silent */ } } },
  };
  shared.sounds = sounds;
  const listener = () => {
    if (!ga) return;
    const c = world.camera.c;
    const f = [c[3] - c[0], c[4] - c[1], c[5] - c[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    ga.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 });
  };

  // ---- the loop's own state: var 0xff = 0 and the idle engine, the camera
  sounds.play(SND.IDLE);

  // ---- the HUD (FUN_006bfa9c): clock icon on the left, the status icon on the right, the speed gauge
  hud.left = { tex: HUD_TEX.CLOCK, tint: 0xff7f7f7f };
  hud.right = { tex: -1, tint: 0xffffffff };
  hud.leftText = shared.clockText;
  hud.gauge = { value: 0, min: 0, max: 1, segments: [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1], marker: -1, icon: HUD_TEX.GAUGE_ICON };
  let blinkOn = 1, blinkN = 0;                                          // DAT_0092acfc (1) / DAT_05d5c0ac
  const syncHud = () => {
    hud.leftText = shared.clockText;
    hud.left.tint = 0xff000000 | shared.tintLeft;
    hud.gauge!.value = shared.gauge;
  };
  /** FUN_006bd55d: the right icon (countdown, wrong way, turbo, bonus) before the controller update */
  const rightIcon = () => {
    let icon = -1;
    const st = vars.get(VAR.STATE);
    if (st === STATE.COUNT3) icon = HUD_TEX.COUNT_3; else if (st === STATE.COUNT2) icon = HUD_TEX.COUNT_2;
    else if (st === STATE.GO) { icon = HUD_TEX.COUNT_1; sounds.stop(SND.IDLE); }
    if (vars.get(VAR.WRONG_WAY) !== 0) icon = HUD_TEX.WRONG_WAY;
    if (vars.get(VAR.TURBO) !== 0) icon = HUD_TEX.TURBO;
    let right = icon;
    if (vars.get(VAR.BONUS) !== 0) right = HUD_TEX.BONUS;
    if (right !== -1 && right !== 8 && right !== 9 && right !== 10) {
      if (++blinkN === 4) { blinkOn ^= 1; blinkN = 0; }
      if (blinkOn === 0) right = -1;
    }
    hud.right = { tex: right, tint: 0xffffffff };
  };
  syncHud();
  hud.visible = false;                                                  // FUN_0046055f runs in mode 2 only

  let bannerDone = false;
  const game: ZoneGame = {
    config: { intro: true, help: true },
    introId: 'ADSGDS12',
    helpControls: 5,
    tickInBanner: true,
    onStart() { hud.visible = true; },
    beforeTick() { rightIcon(); },
    update() {
      syncHud();
      return vars.get(VAR.STATE) === STATE.DONE ? (vars.get(VAR.RESULT) !== 0 ? 1 : 2) : 0;
    },
    everyTick(mode) {
      // FUN_00417597(0xff, 2) at the intro's button: the chase camera runs during the help page
      if (mode === MODE.HELP && vars.get(VAR.STATE) < STATE.COUNT3) vars.set(VAR.STATE, STATE.COUNT3);
      camera.step(world, shared);
      listener();
      if (vars.get(VAR.STATE) < STATE.GO) sounds.play(SND.IDLE);        // FUN_004435a0(idle) once in the original; a sound that was still loading would be dropped, so keep asking (no restart while it plays)
    },
    onBanner() {
      hud.visible = false;
      ctx.stopSpeech();
      const l = resultLines(medalFromVar(vars.get(VAR.RESULT)));
      ctx.say(l[0], l[1]);
      bannerDone = true;
    },
    drawBanner(ui) {
      const m = medalFromVar(vars.get(VAR.RESULT));
      const lines = resultLines(m);
      const text = (id: string) => ctx.strings?.text(id) ?? id;
      ctx.banner(ui, m === 0
        ? { score: { text: String(shared.score), y: 50 }, lines: [{ text: text(lines[0]), y: 120, wrap: 30 }, { text: text(lines[1]!), y: 300, wrap: 30 }] }
        : { score: { text: String(shared.score), y: 50 }, medal: m, medalY: 100, lines: [{ text: text(lines[0]), y: 150, wrap: 30 }] });
    },
    destroy() { sounds.stop(SND.ENGINE); sounds.stop(SND.IDLE); },
    debug() {
      return {
        state: vars.get(VAR.STATE), clock: shared.clock, clockText: shared.clockText, speed: speed.fwdSpeed, t: speed.pathT, pos: [pep.x, pep.y, pep.z], yaw: pep.ry,
        grounded: speed.grounded, result: vars.get(VAR.RESULT), score: shared.score, turbo: speed.turbo, bonus: speed.bonus, shrunk: speed.shrunk, spin: speed.spin,
        lastHit: speed.lastHit, hits: speed.hits, bannerDone, gauge: shared.gauge, replay: shared.replay.count,
      };
    },
  };
  // test / debug aids (window.__zone.game.dsp): put the car on the track, the heading to a point ahead on it
  (game as unknown as { dsp: unknown }).dsp = {
    /** the car on the track at path parameter t (terrain height, heading along the track, standing still) */
    teleport(t: number) {
      const f = shared.track.frame(t);
      const land = world.records[REC.LAND];
      const h = land ? world.col.rayRecord(land, [f.p[0], f.p[1] + 30, f.p[2]], [0, -300, 0], 3, 0.01, 0.01) : null;
      pep.x = f.p[0]; pep.y = (h ? h.point[1] : f.p[1]) + 0.5; pep.z = f.p[2]; pep.ry = Math.atan2(f.t[0], f.t[2]);
      speed.vx = speed.vy = speed.vz = 0; speed.fwdSpeed = 0; speed.turn = 0; speed.stuck = 0; speed.grounded = 1;
      pep.savePrev();
    },
    /** the heading from the car to the track point `look` ahead of its path parameter */
    want(look = 0.004) {
      const p = shared.track.position(Math.min(0.999, speed.pathT + look));
      return Math.atan2(p[0] - pep.x, p[2] - pep.z);
    },
    setClock(ticks: number) { speed.clock = ticks; shared.clock = ticks; },
    shared, speed,
  };
  return game;
});
