// z09JST "Jousting": the duel node `JSTGame` (constructor FUN_005d1f64 = `JoustDuel` constructor, update FUN_005ce506 = `JoustDuel.update`), pure TypeScript (no DOM) so the
// tests can drive it with scripted keys on the real zone's records. The original keeps the state in the node struct (the offsets are noted as `+0x..` in the comments),
// the managers of the two riders in globals (DAT_05d5b284 = player, DAT_05d5b288 = dark knight), the sounds in `DAT_05d5b0xx` handles and the camera in the engine's
// camera struct (DAT_009da5e8: eye xyz, target xyz).
//
// The round, in the original's words: wait for a key (state 1), the bugle players start the tournament (2), the player builds up power by pressing LEFT / RIGHT in
// turns (3) and releases the horse with SPACE, which needs a charge over 18 or the dark knight laughs and throws the player off (4, 5, 6, 7); the knights ride
// at each other (8, 9) while the player steers the lance (the aim point wobbles, arrows move it 1 unit per tick, it drifts without keys); at the moment they meet the aim
// decides: inside radius sqrt(40) the player scores (0xb), outside sqrt(60) the dark knight does (0xc), in between nobody (0xe); then one of the 4 reaction clips plays
// (0xf .. 0x20), the round popup is shown (0x21) and the next round starts (0x22) until one side has 3 points (0x23).
import type { GameRecord } from '../../game/record.ts';
import { sampleBlk } from '../../formats/anim.ts';
import { CLIP_LOOP, POSE_SNAP } from '../../game/anim.ts';
import type { AnimInstance } from '../../game/anim.ts';
import { composeBone } from '../../island/emitters.ts';
import { MfigMan } from './mfig.ts';
import { REC, K, START, SAY, VAR, S2D, S3D, hexf, f32 } from './consts.ts';

/** the states of the node (+0x4c) */
export const ST = {
  START: 0, WAIT: 1, BUGLE: 2, CHARGE: 3, SLOW: 4, WALK: 5, GRAB: 6, THROWN: 7, RUN_UP: 8, RIDE: 9,
  HIT: 0xb, HURT: 0xc, GLANCE: 0xe, END_ROUND: 0x1f, POPUP: 0x21, NEXT: 0x22, FINAL: 0x23,
} as const;

export interface DuelSound {
  play2D(id: number): void;
  stop2D(id: number): void;
  play3D(id: number, pos: ArrayLike<number>): void;
  /** FUN_00443600: playback rate in Hz of a 2D sound */
  rate(id: number, hz: number): void;
}
export interface DuelRng {
  /** FUN_004388ae(range): rand() / 32767 * range */
  range(range: number): number;
}
/** a seeded MSVC rand() (FUN_0085daf0) */
export class MsvcRng implements DuelRng {
  seed: number;
  // RNG: the original seeds the CRT with the clock (srand(time)); tests pass a fixed seed
  constructor(seed = (Date.now() & 0xffffffff) >>> 0) { this.seed = seed >>> 0; }
  next(): number { this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0; return (this.seed >>> 16) & 0x7fff; }
  range(range: number): number { return range <= 0 ? 0 : (this.next() / 32767) * range; }
}

export interface DuelHost {
  readonly recs: readonly GameRecord[];
  snd: DuelSound;
  /** FUN_00435b07 + FUN_00439bf8 + FUN_00435a11: stop the speech, speak the message ids (a / b) of the zone table */
  say(a: string, b?: string): void;
  stopSpeech(): void;
  vars: { get(i: number): number; set(i: number, v: number): void };
  /** the engine's camera struct (eye 0..2, target 3..5) */
  cam: { [i: number]: number };
  /** FUN_0043e970 / FUN_0043e930 on the model of a knight (slot 7 = the lance, 9 = the shield) */
  gear(rec: number, slot: number, on: boolean): void;
  /** the clip tables of the two managers (executable, 0x90b7c4 / 0x90b8f4) and the eight rows of FUN_005d4add (0x905a80: x y z yaw) */
  tables: { player: number[][]; enemy: number[][]; end: number[][] };
  /** the camera spline's control points (0x90b740, count at 0x90b73c) and the offsets added to the last one (0x90b730) */
  spline: { points: number[][]; end: number[]; follow: number[]; blend: number };
  rng: DuelRng;
  /** the zone's particle engine (null without one): the eight `orsemud1.par` emitters of the constructor, handled by index 0..7 (FUN_0044ea60 / FUN_00442a00 on handles +0x1c .. +0x38 of the node) */
  fx?: DuelFx | null;
}
/** the particle calls of the duel */
export interface DuelFx {
  /** FUN_0044ea60(handle[i], var, 1, 1): on = (2, 1, 1), off = (1, 1, 1) */
  gate(i: number, on: boolean): void;
  /** FUN_00442a00(handle[i], &matrix) */
  matrix(i: number, m: Float32Array): void;
}
/** the mud emitters' bones of a horse (FUN_0043bc58(anim, bone)): 0x17, 0x1b, 0xb, 0xe = the four hooves; emitters 0..3 follow HORS (record 12), 4..7 DRKH (record 29) */
export const MUD_BONES = [0x17, 0x1b, 0xb, 0xe] as const;

/** the B-spline of the camera (GSMS path object, vtable 0x892268 slot 8 = 0x446fd0): uniform cubic B-spline over the control points, u = t * count */
export function bspline(pts: readonly (readonly number[])[], t: number): number[] {
  const n = pts.length;
  const u = Math.fround(n * t);
  let i = Math.trunc(u);
  let i0 = i - 1; if (i0 < 0) i0 = 0;
  let i1 = i + 1, i2 = i + 2;
  if (i >= n) i = n - 1;
  if (i1 >= n) i1 = n - 1;
  if (i2 >= n) i2 = n - 1;
  const f = u - i, f2 = f * f, f3 = f2 * f;
  const s = 1 / 6;
  const b0 = (-f3 + 3 * f2 - 3 * f + 1) * s, b1 = (3 * f3 - 6 * f2 + 4) * s, b2 = (-3 * f3 + 3 * f2 + 3 * f + 1) * s, b3 = f3 * s;
  return [0, 1, 2].map((k) => Math.fround(b0 * pts[i0][k] + b1 * pts[i][k] + b2 * pts[i1][k] + b3 * pts[i2][k]));
}

const ftol = Math.trunc;

export class JoustDuel {
  readonly host: DuelHost;
  readonly r: readonly GameRecord[];
  readonly player: MfigMan;
  readonly enemy: MfigMan;
  /** +0x60 / +0x6c: the player's place and Euler angles, +0x78 / +0x84: the dark knight's (the managers read them) */
  readonly pPos = [0, 0, 0]; readonly pRot = [0, 0, 0];
  readonly ePos = [0, 0, 0]; readonly eRot = [0, 0, 0];
  /** +0x4c state, +0x3c steered this tick, +0x40 end-camera angle, +0x44 spectator level (1 / 2 / 3 while they cheer), +0x48 reaction variant */
  state = 0; steer = 0; ang = 0; level = 0; variant = 0;
  /** +0x50 charge over 18, +0x51 aim marker shown, +0x54 camera spline made */
  ready = false; reticle = false; splineMade = false;
  /** +0x58 / +0x5c: points of the player / of the dark knight */
  hitsP = 0; hitsE = 0;
  /** +0x90 follow point on the player, +0x9c bone of the dark knight, +0xa8 smoothed eye, +0xb4 smoothed target (camera of mode 0) */
  camA = [0, 0, 0]; camB = [0, 0, 0]; camEye = [0, 0, 0]; camTgt = [0, 0, 0];
  /** +0xc0 / +0xc4 animation rates, +0xc8 charge, +0xcc speed of the knights, +0xd0 which key is next, +0xd4 charge per press, +0xd8 decay */
  r0 = 0.5; r1 = 0.5; speed = 0; rider = 0; toggle = 0; step = 1; decay = 0.2;
  /** +0xdc / +0xe0: camera spline rate and position */
  splineRate = 0; splineT = 0;
  /** +0xec / +0xf0: the aim offset, +0xf4: its squared length, +0xf8 / +0xfc / +0x10c: speed bonus, precision bonus, points of the round, +0x108 total score */
  aimX = 0; aimY = 0; aimSq = 0; bonusSpeed = 0; precision = 0; roundPts = 0; score = 0;
  /** +0x100 camera mode, +0x110 medal, +0x114 aim speed, +0x118 the state the round popup describes */
  camMode = 0; medal = 0; aimStep = 1; popup = 0;
  /** DAT_05d4e138: the HUD gauge value, DAT_05d5ae9c: the result (0 running, 1 won, 2 lost) */
  gauge = 0; result = 0;
  /** DAT_05d5aea0 (state 0x23 reached) */
  finalShown = false;
  /** what the HUD texts show (FUN_005d1e1b: sprintf of the score +0x108 / +0x5c / +0x58, run by the constructor and at the end of every round: state 0x1f) */
  shown = { score: 0, hitsE: 0, hitsP: 0 };
  /** the frame step DAT_008b1718 (1 at the 30 Hz step, 0.5 at 60 Hz; the `JSTGame` node sets it from `world.dt` every tick): scales every per-tick movement and the animation advances like the original */
  dt = 1;
  /** ticks run */
  ticks = 0;
  /** diagnostics: every state change "from>to" (tests) */
  log: string[] | null = null;
  /** an effect the original starts with a particle emitter (FUN_0044ea60: botexpl01 / orsemud1): the port has no particles, the event is only reported */
  onEffect: ((name: string) => void) | null = null;
  /** DAT_05d5aea8 .. 05d5b068: the eight static matrices the mud emitters follow (zero until the first update, like the BSS) */
  readonly fxMats: Float32Array[] = Array.from({ length: 8 }, () => new Float32Array(16));
  /** the clip / frame of the two horses at the start of the tick = the state the last draw posed (FUN_0043bc58 reads the buffer of that draw: nothing in the update re-poses a horse) */
  private horsePose: ({ clip: number; frame: number } | null)[] = [null, null];

  constructor(host: DuelHost) {
    this.host = host;
    this.r = host.recs;
    this.player = new MfigMan(host.tables.player, this.pPos, this.pRot);
    this.enemy = new MfigMan(host.tables.enemy, this.ePos, this.eRot);
    this.hitsP = 0; this.hitsE = 0; this.aimStep = K.ONE; this.score = 0;
    // FUN_005d1f64: the two groups (FUN_005f3b61(mgr, n, records, 4)): the player = [HORS, GSAD, CLOK, JKIT], the dark knight = [DRKH, RSAD, DRKK]
    this.player.bind([this.r[REC.HORS], this.r[REC.GSAD], this.r[REC.CLOK], this.r[REC.JKIT]], 4);
    this.enemy.bind([this.r[REC.DRKH], this.r[REC.RSAD], this.r[REC.DRKK]], 4);
    this.refreshHud();
    this.roundReset();
  }

  /** FUN_005d1e1b */
  refreshHud() { this.shown = { score: this.score, hitsE: this.hitsE, hitsP: this.hitsP }; }

  private set(s: number) { if (this.log) this.log.push(`${this.state.toString(16)}>${s.toString(16)}`); this.state = s; }

  // ------------------------------------------------------------------------------------------------------------------------------ round set-up
  /** FUN_005d4860 */
  roundReset() {
    this.state = 0; this.steer = 0; this.ang = 0;
    START.player.pos.forEach((v, i) => { this.pPos[i] = hexf(v); });
    START.player.euler.forEach((v, i) => { this.pRot[i] = hexf(v); });
    START.enemy.pos.forEach((v, i) => { this.ePos[i] = hexf(v); });
    START.enemy.euler.forEach((v, i) => { this.eRot[i] = hexf(v); });
    this.host.gear(REC.DRKK, 7, true); this.host.gear(REC.DRKK, 9, true);     // FUN_0043e930(DRKK model, model 4 / 6, bone 0xe / 0x10, slot 7 / 9)
    this.player.setClips(0); this.enemy.setClips(0);
    this.player.advance(0, 1); this.enemy.advance(0, 1);
    this.initCamera();                                                          // FUN_005f2dd9
    this.reticle = true;
    this.r0 = K.HALF; this.r1 = K.HALF; this.speed = 0; this.toggle = 0; this.step = K.ONE; this.decay = f32(0.2);
    this.aimX = 0; this.aimY = 0; this.camMode = 0; this.finalShown = false; this.splineMade = false; this.ready = false;
  }

  // ------------------------------------------------------------------------------------------------------------------------------ camera
  private set3(dst: number[], a: ArrayLike<number>) { dst[0] = f32(a[0]); dst[1] = f32(a[1]); dst[2] = f32(a[2]); }

  /** FUN_005f2dd9: the follow point behind the player's knight, the dark knight's bone 10, and the camera at the first of them */
  initCamera() {
    this.set3(this.camA, this.r[REC.JKIT].toWorld(this.host.spline.follow));
    this.camEye = [...this.camA];
    const b = this.enemy.boneWorld(10);
    if (b) this.set3(this.camB, b);
    this.camTgt = [...this.camB];
    const c = this.host.cam;
    c[3] = this.camTgt[0]; c[4] = this.camTgt[1]; c[5] = this.camTgt[2];
    c[0] = this.camEye[0]; c[1] = this.camEye[1]; c[2] = this.camEye[2];
  }

  /** FUN_005f2bfc: the camera takes the smoothed values of the last tick, then they move a quarter of the way to the new follow points */
  private smooth() {
    const c = this.host.cam, e = this.camEye, t = this.camTgt, a = this.camA, b = this.camB;
    c[3] = t[0]; c[4] = t[1]; c[5] = t[2];
    c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
    for (let k = 0; k < 3; k++) {
      e[k] = f32((a[k] - e[k]) * 0.25 + e[k]);
      t[k] = f32((b[k] - t[k]) * 0.25 + t[k]);
    }
  }

  /**
   * camera modes 5 and 10: FUN_0043bc58(anim, 0) is bone 0 of the pose the last draw left in the animation's buffer. The default draw (FUN_00444480 -> FUN_004440f0) poses with the
   * identity root (PTR_DAT_008b5830 = DAT_008b57f0), so the matrix is in MODEL space. The code overwrites its translation x with the knight's world x + `dx`, doubles the y and takes
   * the target as (x, y, z) of that matrix: z stays the model-space z of the pelvis (about 0), not a world coordinate (reproduced as it is).
   */
  private bone0Target(riderRec: GameRecord, mgr: MfigMan, dx: number): [number, number, number] {
    const l = mgr.boneLocal(0) ?? [0, 0, 0];
    return [riderRec.x + dx, l[1] + l[1], l[2]];
  }

  /** FUN_005f2f0b(mode) */
  camera(mode: number) {
    const c = this.host.cam, d = this.dt;
    const R = this.r;
    switch (mode) {
      case 0: {
        this.splineMade = false;                                              // FUN_004455e0 (the spline is freed)
        this.set3(this.camA, R[REC.JKIT].toWorld(this.host.spline.follow));
        this.camA[1] = K.TWENTY;
        this.camA[2] = f32(this.camA[2] - K.THREE_TWO);
        this.camA[2] = f32(this.gauge / K.FIFTEEN + this.camA[2]);
        const b = this.enemy.boneWorld(10);
        if (b) this.set3(this.camB, b);
        this.smooth();
        break;
      }
      case 1: {
        const Pm = this.player.master, Em = this.enemy.master;
        if (!this.splineMade) {
          this.splineT = 0;
          const half = f32((this.ePos[0] - this.pPos[0]) * 0.5);
          this.splineRate = f32(K.ONE / (half / this.rider));
          const dx = f32((Pm.x - Em.x) * 0.5), dy = f32((Pm.y - Em.y) * 0.5), dz = f32((Pm.z - Em.z) * 0.5);
          const e = this.host.spline.end;
          this.host.spline.points[this.host.spline.points.length - 1] = [f32(dx + e[0]), f32(dy + e[1]), f32(dz + e[2])];
          this.splineMade = true;
        } else {
          const p = bspline(this.host.spline.points, this.splineT);
          c[0] = p[0]; c[1] = p[1]; c[2] = p[2];
          const k = this.host.spline.blend;
          c[3] = f32(Pm.x - f32((Pm.x - Em.x) * k)); c[4] = f32(Pm.y - f32((Pm.y - Em.y) * k)); c[5] = f32(Pm.z - f32((Pm.z - Em.z) * k));
          c[4] = f32(c[4] + K.CAM1_UP);
          if (this.splineT < K.ONE) this.splineT = f32(this.splineRate * d + this.splineT);
        }
        break;
      }
      case 3: case 4: { const e = R[REC.DRKK]; c[3] = e.x; c[4] = e.y; c[5] = e.z; break; }
      case 5: { const t = this.bone0Target(R[REC.JKIT], this.player, K.SIXTY_FOUR); c[3] = f32(t[0]); c[4] = f32(t[1]); c[5] = f32(t[2]); break; }
      case 6: {
        const j = R[REC.JKIT];
        c[3] = j.x; c[5] = j.z; c[4] = f32(j.y + K.EIGHT);
        c[1] = hexf(0x41c66666);
        if (c[0] < K.CAM6_MAX_X) c[0] = f32(this.speed * K.RATE * d + c[0]);
        break;
      }
      case 7: { const e = R[REC.DRKK]; c[3] = e.x; c[5] = e.z; c[4] = f32(e.y + K.EIGHT); break; }
      case 8: if (c[0] < K.CAM8_MAX_X) c[0] = f32(K.POINT55 * d + c[0]); break;
      case 9: {
        const j = R[REC.JKIT];
        c[3] = j.x; c[5] = j.z; c[4] = f32(j.y + K.EIGHT);
        c[2] = -68;
        if (c[0] < K.CAM9_MAX_X) c[0] = f32(this.speed * K.RATE * d + c[0]);
        break;
      }
      case 10: {
        const t = this.bone0Target(R[REC.DRKK], this.enemy, K.TWO_HUNDRED); c[3] = f32(t[0]); c[4] = f32(t[1]); c[5] = f32(t[2]);
        if (c[2] < K.CAM10_MIN_Z) { c[2] = f32(K.POINT3 * d + c[2]); c[0] = f32(c[0] - K.POINT3 * d); }
        break;
      }
      case 0xb: {
        const e = R[REC.DRKK];
        c[3] = e.x; c[5] = e.z; c[4] = f32(e.y + K.FOUR);
        c[1] = hexf(0x41c66666);
        if (K.FIFTY < c[0]) c[0] = f32(c[0] - this.speed * K.RATE * d * K.HALF);
        break;
      }
      case 0xc: { const j = R[REC.JKIT]; c[3] = j.x; c[5] = j.z; c[4] = f32(j.y + K.EIGHT); break; }
      case 0xd:
        if (K.SIXTY < c[0]) { c[0] = f32(c[0] - K.POINT55 * d); c[2] = f32(K.POINT6 * d + c[2]); }
        break;
      case 0xe: {
        c[0] = 120; c[1] = K.TWENTY; c[2] = -82;
        const l = R[REC.LKNG];
        c[3] = l.x; c[5] = l.z; c[4] = f32(l.y - K.SIXTEEN);
        const s = Math.sin(this.ang), co = Math.cos(this.ang);
        c[3] = f32(s * c[3] + c[3]);
        c[5] = f32(c[5] - co * c[5]);
        break;
      }
      case 0xf: { const q = R[REC.BQUN]; c[3] = q.x; c[4] = q.y; c[5] = q.z; break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------ helpers
  /** FUN_005ce454: a random idle sound of the horses: rand(500): < 3 / 189..190 / 360..361 / >= 498 (at the player's / the dark knight's place) */
  private ambient() {
    const v = ftol(this.host.rng.range(500));
    const s = this.host.snd;
    if (v < 0x1f2) {
      if (v < 3) s.play3D(S3D.HORSE1_2, this.pPos);
      else if (v < 0xbd || v > 0xbe) { if (v > 0x167 && v < 0x16a) s.play3D(S3D.HORSE2_2, this.ePos); }
      else s.play3D(S3D.HORSE2_1, this.ePos);
    } else s.play3D(S3D.HORSE1_1, this.pPos);
  }

  /** FUN_005d1ab6: the dark knight's footsteps while he walks (clip 0x5e, frames 5 and 15) */
  private footsteps() {
    const k = this.r[REC.DRKK], a = k.anim;
    if (!a) return;
    const f = ftol(a.frame);
    if (a.clip === 0x5e) {
      if (f === 5) this.host.snd.play3D(S3D.BLKWALK1, [k.x, k.y, k.z]);
      else if (f === 0xf) this.host.snd.play3D(S3D.BLKWALK2, [k.x, k.y, k.z]);
    }
  }

  /** FUN_005d1b41: the hoofbeats of the ride by speed class and frame of the horse's gallop */
  private hooves(f: number) {
    const s = this.host.snd, sp = this.speed;
    const set = sp <= K.FORTY ? (sp <= K.THIRTY ? S3D.HOOF_SLOW : S3D.HOOF_MID) : S3D.HOOF_FAST;
    if (f < 12) {
      if (f < 11) {
        if (f < 10) { if (f > 3 && f < 7) s.play3D(set[0], this.pPos); }
        else s.play3D(set[1], this.pPos);
      } else s.play3D(set[2], this.pPos);
    } else s.play3D(set[3], this.pPos);
  }

  /** FUN_005d1d1c: the horse in the charge phase: scrubbed with the charge below 18, played above */
  private chargeAnim() {
    if (this.speed <= K.EIGHTEEN) {
      this.ready = false;
      if (this.player.clip[0] === 0xd) {
        const { res } = this.player.advance(this.r1, 0);
        if (res === 2) { this.player.setClips(6); this.player.seek(this.gauge); }
      } else this.player.seek(this.gauge);
    } else {
      this.ready = true;
      if (this.player.clip[0] === 4) this.player.setClips(7);
      else this.player.advance(this.r1, 0);
    }
  }

  /** FUN_005d4698: the end of the tournament: speech, medal, the best score / trophy variables */
  private finish() {
    const h = this.host;
    h.stopSpeech();
    let medal = 0;
    if (this.hitsP === 3) {
      if (this.hitsE === 0) { medal = 3; h.say('CASGJO01', 'CASGJO02'); }
      else if (this.hitsE === 1) { medal = 2; h.say('CASGJO03'); }
      else if (this.hitsE === 2) { medal = 1; h.say('CASGJO04'); }
    } else h.say('CASGJO05', 'CASGJO06');
    this.medal = medal;
    if (h.vars.get(VAR.HISCORE) < this.score) h.vars.set(VAR.HISCORE, this.score);
    if (h.vars.get(VAR.TROPHY) < medal) h.vars.set(VAR.TROPHY, medal);
  }

  private clipOf(rec: number, clip: number, frame: number) { this.r[rec].anim?.start(clip, frame); }

  /** FUN_005ce3a0: a spectator turns towards (x, z) */
  private face(rec: GameRecord, x: number, z: number) {
    const a = Math.atan2(rec.x - x, rec.z - z);
    rec.setEuler(rec.rx, f32(K.PI + a), rec.rz, rec.x, rec.y, rec.z);
  }

  /** the reaction states move the two groups apart by charge / 32 per tick */
  private moveTogether() {
    const d = f32(this.speed * K.RATE * this.dt);
    this.pPos[0] = f32(this.pPos[0] + d);
    this.ePos[0] = f32(this.ePos[0] - d);
  }

  // ------------------------------------------------------------------------------------------------------------------------------ the update
  /**
   * FUN_005ce506: one tick (`held` = DAT_0098383c, `pressed` = DAT_00983840; `stickX` / `stickY` = DAT_0098384c / DAT_00983850, the analogue stick in -128..127 that moves the aim point
   * while no key is held; the port's input mapper has no stick yet, the node passes 0)
   */
  update(held: number, pressed: number, stickX = 0, stickY = 0) {
    const h = this.host, snd = h.snd, R = this.r;
    this.ticks++;
    // crows: rand(200): 0 / 1 = the second crow, 199 / 200 = the first
    const crow = ftol(h.rng.range(200));
    if (crow < 199) { if (crow < 2) snd.play2D(S2D.CROW_B); } else snd.play2D(S2D.CROW_A);
    snd.play2D(S2D.WIND);
    const drkk = R[REC.DRKK], jkit = R[REC.JKIT], hors = R[REC.HORS];
    const dt = this.dt;
    this.player.dt = dt; this.enemy.dt = dt;
    this.horsePose = [REC.HORS, REC.DRKH].map((i) => { const a = R[i].anim; return a ? { clip: a.clip, frame: a.frame } : null; });
    const st = this.state;
    switch (st) {
      case 0: this.set(1); break;
      case 1:
        this.ambient();
        if (held !== 0) { this.set(2); this.speed = 0; this.ready = false; this.reticle = true; }
        break;
      case 2: {
        const b1 = R[REC.BUG1].anim, b2 = R[REC.BUG2].anim;
        const f = ftol(b1?.frame ?? 0);
        b1?.advance(1.0, dt);
        const res = b2 ? b2.advance(1.0, dt) : 1;
        if (K.FORTY <= f && f <= K.FIFTY) snd.play2D(S2D.FANFARE_SHORT);
        this.ambient();
        if (res !== 0) {
          this.set(3);
          snd.stop2D(S2D.FANFARE_SHORT);
          this.player.setClips(6); this.enemy.setClips(2);
          this.toggle = (held & 1) !== 0 ? 1 : 0;
        }
        break;
      }
      case 3: {
        if (this.speed === K.ZERO) this.ambient();
        this.aimX = 0; this.aimY = 0; this.steer = 0;
        // FUN_005d2782: the pitch of the power loop follows the gauge
        snd.rate(S2D.WINDUP, ftol((ftol(this.gauge) * 0x5bcc) / 0x3c) + 0x5fb4);
        snd.play2D(S2D.WINDUP);
        if ((pressed & 0x80) === 0) {
          if (this.toggle === 0) { if (pressed & 2) { this.toggle = 1; this.speed = f32(this.speed + this.step); } }
          else if (pressed & 1) { this.toggle = 0; this.speed = f32(this.speed + this.step); }
          this.decay = f32(this.speed * K.DECAY);
          this.speed = f32(this.speed - this.decay * dt);
          if (this.speed < K.ZERO) this.speed = 0;
          if (K.SIXTY < this.speed) this.speed = K.SIXTY;
          this.gauge = this.speed;
          this.enemy.advance(this.r1, 0);
          this.r1 = f32(this.speed * K.RATE);
          this.chargeAnim();
        } else {
          snd.stop2D(S2D.WINDUP);
          if (!this.ready) { this.set(4); this.popup = 4; }
          else { this.set(8); this.enemy.setClips(4); this.player.setClips(8); }
        }
        break;
      }
      case 4: {
        this.reticle = false;
        const { t } = this.player.advance(-this.r1, 0);
        this.gauge = t;
        if (t <= K.ZERO) {
          this.player.seek(0);
          drkk.anim?.start(0x5e, 0);
          h.gear(REC.DRKK, 7, false); h.gear(REC.DRKK, 9, false);
          this.gauge = 0;
          this.set(5);
        }
        break;
      }
      case 5: {
        const nx = f32(drkk.x - K.ONE * dt);
        drkk.x = nx;
        this.footsteps();
        if (nx <= f32(hors.x + K.X_OFF)) {
          drkk.anim?.start(0xbe, 0);
          this.player.setClips(10);
          this.set(6);
        } else drkk.anim?.advance(1.0, dt);
        break;
      }
      case 6: {
        const dz = drkk.z, hz = hors.z;
        drkk.anim?.advance(1.0, dt);
        const { t, res } = this.player.advance(1.0, 0);
        if (res === 2) {
          const ja = jkit.anim;
          if (ja) ja.seek(ja.frameCount - K.ONE);
          this.onEffect?.('botexpl01');
          this.set(7);
          snd.play2D(S2D.LAND);
        }
        if (K.FIVE < t && t < K.TWENTY) {
          const tz = f32(hz + K.Z_OFF);
          drkk.z = tz < dz ? f32(dz - K.CAM_DECAY * dt) : tz;
        }
        if (ftol(t) === 0x1b) snd.play2D(S2D.GRAB);
        if (ftol(t) === 0x46) snd.play2D(S2D.THROW);
        if (K.SEVENTY < t) {
          this.camTgt[1] = drkk.y; this.camTgt[0] = f32((t - K.SEVENTY) * K.ONE + drkk.x); this.camTgt[2] = f32(-(t - K.SEVENTY) * K.THREE + drkk.z);
        }
        break;
      }
      case 7:
        this.camTgt[1] = drkk.y; this.camTgt[0] = f32(drkk.x + (109 - K.SEVENTY) * K.ONE); this.camTgt[2] = f32(drkk.z - (109 - K.SEVENTY) * K.THREE);
        this.set(0x1f);
        break;
      case 8: {
        this.enemy.advance(this.r0, 0);
        const { res } = this.player.advance(this.r1, 0);
        if (res === 2) {
          this.player.setClips(4); this.enemy.setClips(4);
          this.set(9);
          snd.play3D(S3D.HORSE1_NEIGH, this.pPos); snd.play3D(S3D.HORSE2_NEIGH, this.ePos);
          this.onEffect?.('orsemud1');
          this.mud(true);
          this.rider = f32(this.speed * K.RIDER);
        }
        break;
      }
      case 9: this.ride(held, stickX, stickY); break;
      case 0xb: this.hit(); break;
      case 0xc: this.hurt(); break;
      case 0xd:
        h.say(SAY.BOTH_MISS[0]);
        this.player.setClips(4); this.enemy.setClips(4);
        this.r0 = K.ONE; this.player.setMode(1); this.r1 = K.ONE; this.enemy.setMode(1);
        this.set(0x20); this.camMode = 0xf;
        break;
      case 0xe:
        h.say(SAY.BOTH_MISS[0]);
        snd.play3D(S3D.BK_HIT_PEPP, this.pPos); snd.play3D(S3D.PEPP_HIT_BK, this.ePos); snd.play3D(S3D.HORSE1_NEIGH, this.pPos); snd.play3D(S3D.HORSE2_NEIGH, this.ePos);
        snd.play2D(S2D.CROWD_FALL);
        this.level = 3;
        this.clipOf(REC.LKNG, 0x48, 4); this.clipOf(REC.LQUN, 0x48, 5); this.clipOf(REC.BKNG, 0x48, 1); this.clipOf(REC.BQUN, 0x48, 6);
        this.clipOf(REC.BSD1, 0x48, 8); this.clipOf(REC.BSD2, 0x48, 3); this.clipOf(REC.LSD1, 0x48, 0); this.clipOf(REC.LSD2, 0x48, 6);
        this.player.setClips(5); this.enemy.setClips(5);
        this.r0 = K.ONE; this.r1 = K.ONE;
        this.player.setMode(0); this.enemy.setMode(0);
        this.set(0x20); this.camMode = 0xf;
        break;
      case 0xf: {
        const { t } = this.player.advance(this.r1, 0);
        if (ftol(t) === 10) snd.play2D(S2D.ONLANCE);
        let lc = f32(t + K.EIGHT);
        if (K.TWELVE <= lc) lc = f32(lc - K.TWELVE);
        this.enemy.seek(lc);
        if (K.X224 < this.pPos[0]) {
          snd.play3D(S3D.HORSE1_NEIGH, this.pPos);
          this.player.setClips(2); this.enemy.setClips(0x10);
          this.set(0x10);
        }
        const d = f32(this.speed * K.RATE * dt);
        drkk.x = f32(drkk.x + d);
        this.pPos[0] = f32(this.pPos[0] + d); this.ePos[0] = f32(this.ePos[0] - d);
        break;
      }
      case 0x10: {
        let { res } = this.enemy.advance(this.r0, 1);
        if (res === 2) { const a = drkk.anim; if (a) a.seek(a.frameCount - K.ONE); }
        ({ res } = this.player.advance(this.r1, 1));
        if (res === 2) this.set(0x1f);
        if (ftol(drkk.anim?.frame ?? 0) === 10) snd.play2D(S2D.OFFLANCE);
        break;
      }
      case 0x11: {
        this.player.advance(this.r1, 0);
        const { res } = this.enemy.advance(this.r1, 1);
        if (res === 2) { const a = drkk.anim; if (a) a.seek(a.frameCount - K.ONE); this.set(0x1f); }
        if (ftol(drkk.anim?.frame ?? 0) === 0x40) snd.play3D(S3D.BK_FALLEN, this.ePos);
        if (this.pPos[0] < K.X224) this.moveTogether();
        break;
      }
      case 0x12: {
        this.player.advance(this.r1, 0);
        const { res } = this.enemy.advance(this.r1, 1);
        if (res === 2) { const a = drkk.anim; if (a) a.seek(a.frameCount - K.ONE); }
        if (K.X224 < this.pPos[0]) this.set(0x1f);
        const d = f32(this.speed * K.RATE * dt);
        drkk.x = f32(drkk.x - d);
        this.moveTogether();
        break;
      }
      case 0x13: {
        this.player.advance(this.r1, 0);
        if (ftol(drkk.anim?.frame ?? 0) === 0x14) snd.play3D(S3D.BK_FALLEN, this.ePos);
        const { res } = this.enemy.advance(this.r1, 1);
        if (res === 2) {
          const a = drkk.anim; if (a) a.seek(a.frameCount - K.ONE);
          drkk.x = f32(drkk.x + K.THIRTY);
          this.enemy.setClips(0xe);
          this.camMode = 0xd;
          this.set(0x14);
        }
        if (this.pPos[0] < K.X224) this.moveTogether();
        break;
      }
      case 0x14:
        this.enemy.advance(f32(this.r0 + K.ONE), 1);
        if (drkk.x <= K.SEVENTY) this.set(0x1f);
        else drkk.x = f32(drkk.x - K.HALF * dt);
        break;
      case 0x15: if (drkk.anim && drkk.anim.advance(1.0, dt) !== 0) this.set(0x1f); break;
      case 0x16: {
        const { t } = this.enemy.advance(this.r1, 0);
        if (ftol(t) === 10) snd.play2D(S2D.ONLANCE);
        let lc = f32(t + K.EIGHT);
        if (K.TWELVE <= lc) lc = f32(lc - K.TWELVE);
        this.player.seek(lc);
        if (K.X224 < this.pPos[0]) {
          this.player.setClips(0x10); this.enemy.setClips(2);
          snd.play3D(S3D.HORSE2_NEIGH, this.ePos);
          this.set(0x17);
        }
        const d = f32(this.speed * K.RATE * dt);
        jkit.x = f32(jkit.x - d);
        this.moveTogether();
        break;
      }
      case 0x17: {
        let { res } = this.player.advance(this.r0, 1);
        if (res === 2) { const a = jkit.anim; if (a) a.seek(a.frameCount - K.ONE); }
        ({ res } = this.enemy.advance(this.r0, 1));
        if (res === 2) this.set(0x1f);
        if (ftol(jkit.anim?.frame ?? 0) === 10) snd.play2D(S2D.OFFLANCE);
        break;
      }
      case 0x18: {
        this.enemy.advance(this.r1, 0);
        const { res } = this.player.advance(this.r1, 1);
        if (res === 2) { const a = jkit.anim; if (a) a.seek(a.frameCount - K.ONE); this.set(0x1f); }
        if (ftol(jkit.anim?.frame ?? 0) === 0x40) snd.play3D(S3D.PEPP_FALLEN, this.pPos);
        if (this.pPos[0] < K.X224) this.moveTogether();
        break;
      }
      case 0x19: {
        this.enemy.advance(this.r1, 0);
        const { res } = this.player.advance(this.r1, 1);
        if (res === 2) { const a = jkit.anim; if (a) a.seek(a.frameCount - K.ONE); }
        if (K.X224 < this.pPos[0]) this.set(0x1f);
        const d = f32(this.speed * K.RATE * dt);
        jkit.x = f32(jkit.x + d);
        this.moveTogether();
        break;
      }
      case 0x1a: {
        this.enemy.advance(this.r1, 0);
        if (ftol(jkit.anim?.frame ?? 0) === 0x14) snd.play3D(S3D.PEPP_FALLEN, this.pPos);
        const { res } = this.player.advance(this.r1, 1);
        if (res === 2) {
          const a = jkit.anim; if (a) a.seek(a.frameCount - K.ONE);
          jkit.x = f32(jkit.x - K.THIRTY);
          this.player.setClips(0xe);
          this.camMode = 8;
          this.set(0x1b);
        }
        if (this.pPos[0] < K.X224) this.moveTogether();
        break;
      }
      case 0x1b:
        this.player.advance(f32(this.r0 + K.ONE), 1);
        if (K.ONE_EIGHTY <= jkit.x) this.set(0x1f);
        else jkit.x = f32(K.HALF * dt + jkit.x);
        break;
      case 0x1c: if (jkit.anim && jkit.anim.advance(1.0, dt) !== 0) this.set(0x1f); break;
      case 0x1d: {
        this.moveTogether();
        this.player.advance(this.r0, 0);
        if (ftol(jkit.anim?.frame ?? 0) === 0x14) snd.play3D(S3D.BK_FALLEN, this.ePos);
        const { res } = this.enemy.advance(this.r0, 0);
        if (res === 2) this.set(0x20);
        break;
      }
      case 0x1f:
        this.onEffect?.('emitters-off');
        this.mud(false);
        this.refreshHud();
        this.gauge = 0;
        this.set(0x21);
        break;
      case 0x20:
        this.moveTogether();
        this.player.advance(this.r0, 0); this.enemy.advance(this.r0, 0);
        if (K.X190 < this.pPos[0]) this.set(0x1f);
        break;
      case 0x21:
        // FUN_005d4070 draws the round popup (the zone game's draw2d); any new button press goes on
        if (pressed !== 0) this.set(0x22);
        break;
      case 0x22: this.nextRound(); break;
      case 0x23:
        this.finalShown = true;
        this.ang = f32(K.CAM_E_STEP * dt + this.ang);
        this.player.advance(K.ONE, 1); this.enemy.advance(K.ONE, 1);
        break;
      default: break;
    }
    // the spectators turn to the two knights (FUN_005ce3a0 x 8), then the camera of the current mode
    for (const i of [REC.LKNG, REC.LQUN, REC.LSD1, REC.LSD2]) this.face(R[i], jkit.x, jkit.z);
    for (const i of [REC.BKNG, REC.BQUN, REC.BSD1, REC.BSD2]) this.face(R[i], drkk.x, drkk.z);
    this.placeMud();
    this.camera(this.camMode);
  }

  /** the hooves' emitters follow the bones of the two horses: dest = FUN_0043a9e5(record matrix, FUN_0043bc58(horse, bone)), then FUN_00442a00(handle, dest), eight times at the end of the update */
  private placeMud() {
    [REC.HORS, REC.DRKH].forEach((ri, k) => {
      const rec = this.r[ri], a = rec.anim, snap = this.horsePose[k];
      MUD_BONES.forEach((bone, j) => {
        const i = k * 4 + j, dst = this.fxMats[i];
        const p = a && snap ? poseAt(a, snap.clip, snap.frame) : null;
        if (p && p.length >= bone * 16 + 16) composeBone(dst, rec.m, p, bone * 16);
        else dst.set(rec.m);        // no pose in the animation's buffer: the record's own matrix (island `boneWorld` convention)
        this.host.fx?.matrix(i, dst);
      });
    });
  }
  /** all eight mud emitters on / off (FUN_0044ea60 x 8 in one go) */
  private mud(on: boolean) { for (let i = 0; i < 8; i++) this.host.fx?.gate(i, on); }

  // ------------------------------------------------------------------------------------------------------------------------------ the ride and its outcomes
  private ride(held: number, stickX: number, stickY: number) {
    const snd = this.host.snd, dt = this.dt;
    snd.play2D(S2D.CROWD_CHARGE);
    this.camMode = 1;
    const l28 = f32(this.speed * K.SIXTEENTH * dt + K.ONE);
    const s = f32(l28 / K.WOBBLE_DIV);
    const wob = (axis: 'aimX' | 'aimY') => {
      let r = f32(s - this.host.rng.range(f32(s + s)));
      if (K.ZERO < r && K.TWENTY < this[axis]) r = f32(r - this[axis] / K.PULL_DIV);
      if (r < K.ZERO && this[axis] < K.TWENTY) r = f32(r - this[axis] / K.PULL_DIV);
      this[axis] = f32(r + this[axis]);
    };
    wob('aimX'); wob('aimY');
    // keys; the stick is read only while no key is held (dead zone +-20, no dt in the original's stick path)
    if (held === 0) {
      if (stickX < -20 || stickX > 20) this.aimX = f32(f32(stickX / K.STICK_DIV) * this.aimStep + this.aimX);
      if (stickY < -20 || stickY > 20) this.aimY = f32(f32(stickY / K.STICK_DIV) * this.aimStep + this.aimY);
    } else {
      if (held & 4) { this.steer = 1; this.aimY = f32(this.aimY - this.aimStep * dt); }
      if (held & 8) { this.steer = 1; this.aimY = f32(this.aimStep * dt + this.aimY); }
      if (held & 1) { this.steer = 1; this.aimX = f32(this.aimX - this.aimStep * dt); }
      if (held & 2) { this.steer = 1; this.aimX = f32(this.aimStep * dt + this.aimX); }
    }
    if (this.steer === 0) {
      this.aimX = f32(this.aimStep * dt + this.aimX);
      this.aimY = f32(this.aimY - this.aimStep * dt);
    }
    const { t } = this.player.advance(this.r0, 0);
    this.hooves(ftol(t));
    this.enemy.advance(this.r1, 0);
    this.pPos[0] = f32(this.rider * dt + this.pPos[0]);
    this.ePos[0] = f32(this.ePos[0] - this.rider * dt);
    if (K.CLASH_GAP < this.pPos[0] - this.ePos[0]) {
      snd.stop2D(S2D.CROWD_CHARGE);
      this.reticle = false;
      this.aimSq = f32(f32(this.aimX * this.aimX) + f32(this.aimY * this.aimY));
      if (K.FORTY <= this.aimSq) this.set(this.aimSq <= K.SIXTY ? 0xe : 0xc);
      else this.set(0xb);
      // the variant: rand(ms since the start) & 3 (FUN_00435c91 = GetTickCount - base)
      this.variant = ftol(this.host.rng.range(ftol(this.ticks * 1000 * dt / 30))) & 3;
      this.popup = this.state;
    }
  }

  /** state 0xb: the player's lance hits the dark knight's shield */
  private hit() {
    const h = this.host, snd = h.snd, R = this.r;
    this.level = 1;
    snd.play2D(S2D.CROWD_BK_FALLEN);
    snd.play3D(S3D.PEPP_HIT_BK, this.ePos); snd.play3D(S3D.HORSE2_NEIGH, this.ePos);
    this.clipOf(REC.LSD1, 0x9f, 2); this.clipOf(REC.LSD2, 0x9f, 7); this.clipOf(REC.LKNG, 0x9f, 6); this.clipOf(REC.LQUN, 0x9f, 3);
    this.clipOf(REC.BKNG, 0xd9, 11); this.clipOf(REC.BQUN, 0xd9, 1); this.clipOf(REC.BSD1, 0xd9, 7); this.clipOf(REC.BSD2, 0xd9, 14);
    this.hitsP++;
    this.r1 = K.ONE;
    this.enemy.setMode(0);
    this.bonusSpeed = ftol(this.speed + this.speed);
    this.precision = ftol(K.FORTY - this.aimSq);
    if (this.precision < 0) this.precision = 0;
    if (this.precision === 0) this.precision = 1;
    this.roundPts = this.bonusSpeed * this.precision;
    this.score += this.roundPts;
    const d = R[REC.DRKK];
    switch (this.variant) {
      case 0:
        h.say(SAY.PLAYER_HIT[0]); this.camMode = 9;
        d.x = f32(d.x - K.P4_3); d.y = f32(d.y + K.POINT3); d.z = f32(d.z - K.TWO_HALF);
        this.player.setClips(4); this.enemy.setClips(0xf);
        this.set(0xf);
        break;
      case 1:
        h.say(SAY.PLAYER_HIT[1]); this.camMode = 10;
        this.enemy.setClips(0xc); this.player.setClips(4);
        this.set(0x11);
        break;
      case 2:
        h.say(SAY.PLAYER_HIT[2]); this.camMode = 0xb;
        this.enemy.setClips(0xd); this.player.setClips(4);
        this.set(0x12);
        break;
      default:
        h.say(SAY.PLAYER_HIT[3]); this.camMode = 0xc;
        this.enemy.setClips(5); this.player.setClips(4);
        this.set(0x13);
    }
    snd.play3D(S3D.PEPP_LANCE_TWANG, [d.x, d.y, d.z]);
  }

  /** state 0xc: the dark knight's lance throws the player off */
  private hurt() {
    const h = this.host, snd = h.snd, R = this.r;
    this.level = 2;
    this.clipOf(REC.LSD1, 0xd9, 9); this.clipOf(REC.LSD2, 0xd9, 3); this.clipOf(REC.LKNG, 0xd9, 16); this.clipOf(REC.LQUN, 0xd9, 5);
    this.clipOf(REC.BKNG, 0x9f, 6); this.clipOf(REC.BQUN, 0x9f, 1); this.clipOf(REC.BSD1, 0x9f, 3); this.clipOf(REC.BSD2, 0x9f, 0);
    this.hitsE++;
    this.player.setMode(0);
    snd.play2D(S2D.CROWD_FALL);
    snd.play3D(S3D.BK_HIT_PEPP, this.pPos); snd.play3D(S3D.HORSE1_NEIGH, this.pPos);
    this.bonusSpeed = 0; this.precision = 0; this.roundPts = 0;
    const j = R[REC.JKIT];
    switch (this.variant) {
      case 0:
        h.say(SAY.ENEMY_HIT[0]); this.r0 = K.ONE; this.camMode = 3;
        j.x = f32(j.x + K.P3_8); j.y = f32(j.y - K.P1_3); j.z = f32(j.z + K.THREE);
        this.player.setClips(0xb); this.enemy.setClips(4);
        this.set(0x16);
        break;
      case 1:
        h.say(SAY.ENEMY_HIT[1]); this.camMode = 5;
        this.player.setClips(0xc); this.enemy.setClips(4);
        this.set(0x18);
        break;
      case 2:
        h.say(SAY.ENEMY_HIT[2]); this.camMode = 6;
        this.player.setClips(0xd); this.enemy.setClips(4);
        this.set(0x19);
        break;
      default:
        h.say(SAY.ENEMY_HIT[3]); this.camMode = 7;
        this.player.setClips(5); this.enemy.setClips(4);
        this.set(0x1a);
    }
    snd.play3D(S3D.BK_HIT_PEPP, [j.x, j.y, j.z]);
  }

  /** state 0x22: the round is over: the next round, or the end of the tournament at 3 points */
  private nextRound() {
    if (this.hitsP < 3) {
      if (this.hitsE < 3) {
        this.enemy.setMode(1); this.player.setMode(1);
        this.player.setClips(0); this.enemy.setClips(0);
        this.level = 0;
        this.clipOf(REC.BUG1, 0x86, 0); this.clipOf(REC.BUG2, 0x86, 0);
        this.clipOf(REC.LKNG, 0x43, 0); this.clipOf(REC.LQUN, 0x43, 0);
        for (const i of [REC.BKNG, REC.BQUN, REC.BSD1, REC.BSD2, REC.LSD1, REC.LSD2]) this.clipOf(i, 0x3a, 0);
        this.roundReset();
      } else this.finalPose(false);
    } else this.finalPose(true);
  }

  /**
   * the end of the tournament (the two branches of state 0x22): result, speech / variables, the angle of the end camera, the sounds of the crowd, both groups on their own,
   * the tableau (FUN_005d4add's rows: x y z yaw of the player's knight, the player, the dark knight, the dark knight's group) and the loser's gear taken away
   */
  private finalPose(won: boolean) {
    const row = this.host.tables.end, snd = this.host.snd;
    const base = won ? 0 : 4;
    this.result = won ? 1 : 2;
    this.finish();
    this.ang = won ? hexf(0x3fc90f94) : hexf(0x40b66666);
    this.set(0x23);
    if (won) { snd.play2D(S2D.CROWD_WIN); snd.play2D(S2D.FANFARE_MED); } else snd.play2D(S2D.CROWD_LOSE);
    this.player.setMode(0); this.enemy.setMode(0);
    this.player.setClips(won ? 0x11 : 0x12); this.enemy.setClips(won ? 0x12 : 0x11);
    this.camMode = 0xe;
    const E = row[base + 3], D = row[base + 2], P = row[base + 1], J = row[base];
    this.ePos[0] = E[0]; this.ePos[1] = E[1]; this.ePos[2] = E[2]; this.eRot[0] = 0; this.eRot[1] = E[3]; this.eRot[2] = 0;
    this.r[REC.DRKK].setEuler(0, D[3], 0, D[0], D[1], D[2]);
    this.pPos[0] = P[0]; this.pPos[1] = P[1]; this.pPos[2] = P[2]; this.pRot[0] = 0; this.pRot[1] = P[3]; this.pRot[2] = 0;
    this.r[REC.JKIT].setEuler(0, J[3], 0, J[0], J[1], J[2]);
    if (won) { this.host.gear(REC.DRKK, 7, false); this.host.gear(REC.DRKK, 9, false); }
    else { this.host.gear(REC.JKIT, 7, false); this.host.gear(REC.JKIT, 9, false); }
  }
}

/** the bone matrices of `anim` posed at (clip, frame) with the identity root (model space): what the draw of that state leaves in the animation's buffer */
function poseAt(anim: AnimInstance, clip: number, frame: number): Float32Array | null {
  const sk = anim.rig.skeleton, c = anim.rig.clips[clip];
  if (!sk || !c || c.boneCount !== sk.boneCount) return null;
  return sampleBlk(sk, c, frame, (c.flags & CLIP_LOOP) !== 0, undefined, anim.noInterp ? 1e9 : POSE_SNAP);
}
