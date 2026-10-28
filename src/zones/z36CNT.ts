// z36CNT, the centrifuge (G-force training, LEGO Island 2 zone 24, story node 59): Pepper sits in the chair of a spinning arm and presses left / right in the
// rhythm of the lights. Registers the zone's two behaviours (the TRAI controller FUN_007b20a8 and Bob's controller FUN_007b2836, by constructor address) and its
// zone game (the loop around them FUN_007af067 / FUN_007aef49 / FUN_007afff6 / FUN_007b0085). The rules live in ./z36cnt/sim.ts (DOM-free), the placement of the
// machine in ./z36cnt/pose.ts. docs/re/m3/z36CNT.md.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { NODE_CONTINUE } from '../game/controller.ts';
import type { BehaviourNode } from '../game/controller.ts';
import type { GameRecord } from '../game/record.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { AnimInstance } from '../game/anim.ts';
import { V } from '../game/vars.ts';
import { buildMatrix } from '../formats/matrix.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { GameAudio } from '../audio/index.ts';
import { CentrifugeSim, REC, REC_NAMES, SND, MEDAL_SILVER, MEDAL_GOLD, readFrameTable, TWO_PI, HALF_PI, PI } from './z36cnt/sim.ts';
import type { CntHost } from './z36cnt/sim.ts';
import { layoutFrom, poseAt, ghostCount, ghostStep, ghostAlpha, armShadows, SHADOW_TYPE } from './z36cnt/pose.ts';
import { f32 } from './z36cnt/util.ts';

/** constructors the zone's set-up attaches (FUN_007afbc0): the machine on TRAI (record 18), Bob on TBOB (record 0) */
export const CTOR_TRAI = 0x7b20a8, CTOR_TBOB = 0x7b2836;

/** the visor attachment's resting place on the helmet: translation of the matrix FUN_007b20a8 hands to FUN_0043e910(model, 5, ...) (0x3b449ba6, 0x3f3a5e35, 0x3d178d50) */
const VISOR_POS: [number, number, number] = [f32(0x3b449ba6), f32(0x3f3a5e35), f32(0x3d178d50)];
const VISOR_SLOT = 5;
/** camera set-up of FUN_007afbc0: target = TRAI + (0, 3.9, 0) (0x89294c), eye = target + (0, 15, 30) (0x892074, 0x892038) */
const CAM_TARGET_UP = 3.9, CAM_EYE_UP = 15, CAM_EYE_BACK = 30;
/** the monitor's texture frame while no game runs (FUN_00443120(.., 6, 2, 0x62)) and the list index of its wib in FLOR's texture list */
const MONITOR_IDLE_FRAME = 0x62, MONITOR_LIST_INDEX = 6;
/** HUD gauge textures of Overlays/z36CNT (FUN_007af9b0 fills the state at 0x5d4e0b8): segments 0-3 = 3, 4-7 = 2, 8-11 = 1, marker 0, icon 4 */
const GAUGE_SEGMENTS = [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1];

/** the two nodes only carry the gate and call into the sim the zone game binds to them (the sim needs the set-up's records, which exist only after setupZone) */
export class CntNode implements BehaviourNode {
  readonly kind: string;
  var = V.NS_ON; mask = 0; value = 0;
  stamp = 0xfffffffe;
  run: ((w: World, pressed: number) => void) | null = null;
  constructor(kind: string) { this.kind = kind; }
  update(w: World): number { this.run?.(w, w.input.pressed); return NODE_CONTINUE; }
  destroy() { this.onDestroy?.(); }
  onDestroy: (() => void) | null = null;
}
registerCtor(CTOR_TRAI, () => new CntNode('TRAI'));
registerCtor(CTOR_TBOB, () => new CntNode('TBOB'));

/** the zone's sounds: slots of the sound table loaded up front, loops are re-triggered every tick like the original does (play on a playing slot refreshes the volume) */
export class CntSound {
  private slots = new Map<number, unknown>();
  private ga: GameAudio | null;
  constructor(ga: GameAudio | null) { this.ga = ga; }
  async preload(ids: number[]) {
    const ga = this.ga;
    if (!ga) return;
    await Promise.all(ids.map(async (id) => { try { this.slots.set(id, await ga.sfx.load2D(id)); } catch { /* silent */ } }));
  }
  private slot(id: number) { return this.slots.get(id) as Awaited<ReturnType<GameAudio['sfx']['load2D']>> | undefined; }
  play(id: number) { const s = this.slot(id); if (s) try { this.ga!.sfx.play2D(s); } catch { /* silent */ } }
  stop(id: number) { const s = this.slot(id); if (s) try { this.ga!.sfx.stop(s); } catch { /* silent */ } }
  rate(id: number, hz: number) { const s = this.slot(id); if (s) try { this.ga!.sfx.setRate(s, hz); } catch { /* silent */ } }
}

registerZoneGame('z36CNT', async (ctx: ZoneGameCtx): Promise<ZoneGame> => {
  const { world, loaded, gr, hud, sh } = ctx;
  const recs = world.records;
  for (let i = 0; i < REC_NAMES.length; i++) if (recs[i]?.name !== REC_NAMES[i]) console.warn(`z36CNT: record ${i} is ${recs[i]?.name}, expected ${REC_NAMES[i]}`);
  const pepper = recs[REC.PEPP];
  const bobRec = recs[REC.TBOB];
  const trai = recs[REC.TRAI];

  // the player is the machine's passenger: no walking, no chase camera (the set-up's stub chain is removed)
  pepper.ctrl = null;
  pepper.flags |= RF_NO_COLLIDE;
  const rig = loaded.rigs.get('MFIG') ?? null;
  if (rig && !pepper.anim) pepper.anim = new AnimInstance(rig);
  if (rig && !bobRec.anim) bobRec.anim = new AnimInstance(rig);
  // the blob shadow belongs to the walk code (PEPPERSSHADOW = -1 hides it); restored on exit
  const shadowVar = world.vars.get(V.PEPPERSSHADOW);
  world.vars.set(V.PEPPERSSHADOW, -1);

  // FUN_007afbc0: FUN_0040cd1a(0x3f19999a) = the zoom factor / vertical field of view 0.6 rad (default 1.0), then the fixed camera in front of the machine
  gr.fov = f32(0x3f19999a);
  const cam = world.camera, c = cam.c;
  c[0] = trai.x; c[1] = trai.y + CAM_TARGET_UP + CAM_EYE_UP; c[2] = trai.z + CAM_EYE_BACK;
  c[3] = c[0]; c[4] = trai.y + CAM_TARGET_UP; c[5] = trai.z;
  c[6] = 0; c[7] = 1; c[8] = 0;
  cam.updateView(); cam.savePrev();

  // FUN_007afbc0 hides TRAI / CHAI / WEIG (flags = 0): the hook FUN_007b1a1b draws them itself with its own matrices. The port draws them as ordinary records
  // (placed by `placeParts`), which is the hook's j = 0 copy
  for (const i of [REC.CHAI, REC.WEIG, REC.TRAI]) recs[i].flags |= RF_ENABLED;

  const layout = layoutFrom([trai.x, trai.y, trai.z], [recs[REC.CHAI].x, recs[REC.CHAI].y, recs[REC.CHAI].z], [recs[REC.WEIG].x, recs[REC.WEIG].y, recs[REC.WEIG].z]);
  const snd = new CntSound(sh.audio.ga);
  await snd.preload(Object.values(SND));

  const show = (i: number, on: boolean) => { const r = recs[i]; if (on) r.flags |= RF_ENABLED; else r.flags &= ~RF_ENABLED; };
  const visorMatrix = buildMatrix(0, 0, 0, VISOR_POS[0], VISOR_POS[1], VISOR_POS[2]);
  gr.attachLocal.set(pepper, new Map([[VISOR_SLOT, visorMatrix]]));
  const bobAnim = bobRec.anim ?? new AnimInstance({ clips: [], skeleton: null } as never);
  const pepAnim = pepper.anim ?? new AnimInstance({ clips: [], skeleton: null } as never);
  const host: CntHost = {
    pep: pepAnim, bob: bobAnim, show,
    play: (id) => snd.play(id), stop: (id) => snd.stop(id), rate: (id, hz) => snd.rate(id, hz),
    say: (id) => { ctx.say(id); },
    getVar: (i) => world.vars.get(i), setVar: (i, v) => world.vars.set(i, v),
    rand: () => Math.random(),
    visor: (a) => { visorMatrix.set(buildMatrix(a, 0, 0, VISOR_POS[0], VISOR_POS[1], VISOR_POS[2])); },
  };
  const sim = new CentrifugeSim(host, readFrameTable((va) => sh.pe.u32(va)));

  // arm angle / power of the previous tick for the render interpolation
  let prevAngle = 0, prevPower = 0;
  const traiNode = trai.ctrl?.find<CntNode>('TRAI');
  const bobNode = bobRec.ctrl?.find<CntNode>('TBOB');
  if (traiNode) { traiNode.run = (_w, pressed) => { prevAngle = sim.angle; prevPower = sim.power; sim.step(pressed); placeParts(1); }; traiNode.onDestroy = () => sim.destroy(); }
  else console.warn('z36CNT: the TRAI controller was not attached');
  if (bobNode) bobNode.run = () => sim.bobStep();
  else console.warn('z36CNT: the Bob controller was not attached');

  // the monitor texture (FLOR's list entry 6): the frames of the .wib are picked by the sim
  const floor = ctx.scene.records[REC.FLOR];
  const monitorTex = ctx.scene.texLists[floor.model?.parts[0]?.texList ?? -1]?.[MONITOR_LIST_INDEX] ?? -1;
  const setMonitor = (frame: number) => { if (monitorTex >= 0) gr.renderer.setTextureFrame(ctx.archive, monitorTex, 2, frame); };

  /** the records of the machine at the arm angle between the last two ticks (FUN_007b1a1b), with the motion blur copies */
  function placeParts(alpha: number) {
    let da = sim.angle - prevAngle;
    if (da < -PI) da += TWO_PI; else if (da > PI) da -= TWO_PI;
    const angle = prevAngle + da * alpha;
    const power = prevPower + (sim.power - prevPower) * alpha;
    const tilt = power * HALF_PI;
    const set = (r: GameRecord, m: Float32Array) => { r.m.set(m); r.prev.set(m); };
    const p = poseAt(layout, angle, tilt);
    set(recs[REC.TRAI], p.arm); set(recs[REC.WEIG], p.weight); set(recs[REC.CHAI], p.chair); set(pepper, p.pepper);
    gr.extraShadows = armShadows(p.arm).map((pts) => ({ type: SHADOW_TYPE, pts }));
    gr.ghosts.clear();
    const n = ghostCount(power, world.camera.vehicle);
    if (n > 1) {
      const step = ghostStep(power);
      const lists = new Map<GameRecord, { m: Float32Array; alpha: number }[]>();
      for (const r of [recs[REC.TRAI], recs[REC.WEIG], recs[REC.CHAI], pepper]) lists.set(r, []);
      for (let j = n - 1; j >= 1; j--) {
        const q = poseAt(layout, angle, tilt, j * step);
        const a = ghostAlpha(j, n) / 255;
        lists.get(recs[REC.TRAI])!.push({ m: q.arm, alpha: a }); lists.get(recs[REC.WEIG])!.push({ m: q.weight, alpha: a });
        lists.get(recs[REC.CHAI])!.push({ m: q.chair, alpha: a }); lists.get(pepper)!.push({ m: q.pepper, alpha: a });
      }
      for (const [r, l] of lists) gr.ghosts.set(r, l);
    }
  }
  placeParts(1);

  const hudOn = (on: boolean) => { hud.visible = on; };
  hudOn(false);
  hud.gauge = { value: 0, min: 0, max: 1, segments: GAUGE_SEGMENTS, marker: 0, icon: 4 };

  const medalOf = () => (!sim.medalOk ? 0 : sim.shownScore < MEDAL_GOLD ? (sim.shownScore < MEDAL_SILVER ? 1 : 2) : 3);

  const game: ZoneGame = {
    introId: 'LESGCE01',
    helpControls: 4,
    // the update pass of the original's loop runs in modes 1, 2 and 4 (FUN_007af067): the intro and the banner tick the world too (the runner does it for mode 4)
    introTick() { world.tick(); },
    tickInBanner: true,
    update() { return sim.result || undefined; },
    onBanner() {
      // FUN_007b0085: the speech of the result (a line pair for "no medal" and gold, one line for bronze / silver)
      ctx.stopSpeech();
      const m = medalOf();
      if (m === 0) ctx.say('LESGCE06', 'LESGCE07');
      else if (m === 1) ctx.say('LESGCE05');
      else if (m === 2) ctx.say('LESGCE04');
      else ctx.say('LESGCE02', 'LESGCE03');
    },
    beforeRender(alpha) { placeParts(alpha); },
    draw2d(ui: Ui2D, dt: number, mode: number) {
      if (mode === 0 || mode === 1) setMonitor(MONITOR_IDLE_FRAME);
      if (mode === 2) {
        // FUN_007aef49: the timer (seconds, right), the score (centre), the gauge, the klaxon at full power
        setMonitor(sim.hudFrame);
        hud.rightText = String(Math.trunc(Math.trunc(sim.hudTime) / 30));
        hud.centreText = String(sim.shownScore);
        hud.gauge!.value = sim.hudPower;
        hudOn(true); hud.draw(ui, dt * 30); hudOn(false);
        if (sim.hudPower === 1) snd.play(SND.KLAXON); else snd.stop(SND.KLAXON);
      } else {
        snd.stop(SND.KLAXON);
      }
    },
    drawBanner(ui: Ui2D) {
      // FUN_007b0085 on the panel of FUN_00460a3d(0x16, 0x14, 0): the score at y = 100, the medal (STD.str) at 150, the lines (wrap 30) at 200 / 320 (no medal),
      // 200 (bronze / silver) or 200 / 380 (gold)
      const m = medalOf();
      const L = (id: string, y: number) => ctx.line(id, y, 30);
      const lines = m === 0 ? [L('LESGCE06', 200), L('LESGCE07', 320)] : m === 1 ? [L('LESGCE05', 200)] : m === 2 ? [L('LESGCE04', 200)] : [L('LESGCE02', 200), L('LESGCE03', 380)];
      ctx.banner(ui, { score: { text: String(sim.shownScore), y: 100 }, medal: m, lines });
    },
    destroy() {
      sim.destroy();
      snd.stop(SND.KLAXON);
      world.vars.set(V.PEPPERSSHADOW, shadowVar);
      gr.attachLocal.clear(); gr.ghosts.clear(); gr.extraShadows = [];
      hud.gauge = null; hud.visible = true;
    },
    debug() {
      return {
        state: sim.state, clip: sim.clip, angle: sim.angle, power: sim.power, score: sim.score, shown: sim.shownScore, streak: sim.streak, time: sim.time,
        zone: sim.zoneOf(), launch: sim.launch, result: sim.result, medalOk: sim.medalOk, bonus: sim.bonus, hiscore: world.vars.get(0x9b), trophy: world.vars.get(0x86),
        latchL: sim.latchL, latchR: sim.latchR, inWindow: sim.inWindow, hit: sim.hit, mon: { ...sim.mon }, bobState: sim.bobState,
      };
    },
  };
  Object.assign(game, { sim });   // for tests / the debug console (window.__zone.game.sim)
  return game;
});
