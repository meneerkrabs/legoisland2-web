// z10RGB: the state the zone's nodes share (the original's globals DAT_05d5b2xx .. DAT_05d5bbxx / DAT_0090bbxx .. DAT_0090bcxx and the structs the nodes
// keep in their own memory) and the small helpers of the math the ports use. The nodes are `pepper.ts` (PepSwitc + PeppHit), `enemy.ts` (cedric + cannon),
// `game.ts` (rgbgame) and the ball pool `balls.ts`. Pure TypeScript, no DOM.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { K, REC, REC_NAMES, PHASE, VAR } from './consts.ts';

/** a source of uniform numbers in [0, 1) (the original's rand() / 32767; tests inject a seeded one) */
export interface Rng { next(): number }
export class MathRng implements Rng { next() { return Math.random(); } }
/** a small deterministic generator for tests */
export class Lcg implements Rng {
  private s: number;
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
}

/** the sounds the zone plays, by name (the zone game maps them to sound-table ids, tests record them) */
export interface SoundSink {
  /** FUN_004435a0: a 2D sound (refreshed every tick for loops) */
  play(name: string): void;
  /** FUN_004433f0: a 3D sound at a position */
  at(name: string, pos: ArrayLike<number>): void;
  /** FUN_004435b0 / FUN_004434b0 */
  stop(name: string): void;
}
export const SILENT: SoundSink = { play() { /* */ }, at() { /* */ }, stop() { /* */ } };

/** the HUD fields the zone writes (DAT_05d4e0b8 .. 05d4e138, DAT_05d4dd44) */
export interface HudState {
  /** DAT_05d4e0b8: the gauge is drawn */
  gauge: boolean;
  /** DAT_05d4e0c0: the gauge's icon texture (-1 none; 6 normal, 4 reloading, 5 / 7 ready) */
  icon: number;
  min: number; max: number; value: number;
  /** DAT_05d4dd44: the right text (cleared by the zone) */
  rightText: string;
}

/** one cannonball of the pool (stride 0xa8 at DAT_05d5b428): record, state 0 free / 1 reserved / 2 flying / 3 splash / 4 done */
export class Ball {
  idx: number;
  rec: GameRecord;
  /** +4 */
  state = 0;
  /** +8 +0xc +0x10: the launch vector speed * (fx, 1, fz) */
  dir: [number, number, number] = [0, 0, 0];
  /** +0x20 .. +0x28: the step of the last tick */
  vel: [number, number, number] = [0, 0, 0];
  /** +0x2c: where it was launched */
  start: [number, number, number] = [0, 0, 0];
  /** +0x38 cos, +0x3c sin of the launch pitch */
  cos = 0; sin = 0;
  /** +0x40: flight time in ticks */
  t = 0;
  /** +0x44: the record it hit (a cannon, Pepper, LAND / BUNS); null = flying */
  hit: GameRecord | null = null;
  /** +0x48: ticks of the splash */
  count = 0;
  constructor(idx: number, rec: GameRecord) { this.idx = idx; this.rec = rec; }
}

/** one of Pepper's four cannons (struct of 0x3c bytes in the PepSwitc node, at +0x70 + 0x3c i) */
export interface PepperCannon {
  rec: GameRecord;
  /** +0x1c: the position the cannon stands at (restored when the player leaves it) */
  pos: [number, number, number];
  /** +0x28: the euler angles at the start (restored when the player leaves it) */
  euler: [number, number, number];
  /** +0x34: ticks until it can fire again (0 = ready) */
  timer: number;
  /** +0x38: 1 until the player has entered it once (the first entry points the barrel down) */
  fresh: number;
}

/** Cedric's perches (the node's 9 structs of 0x18 bytes at +0x18) */
export interface Perch { rec: GameRecord; pos: [number, number, number]; bit: number }

/** the rotation part of a record's matrix applied to a vector (FUN_0043abe6) */
export function rotate(m: ArrayLike<number>, v: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] {
  out[0] = v[0] * m[0] + v[1] * m[4] + v[2] * m[8];
  out[1] = v[0] * m[1] + v[1] * m[5] + v[2] * m[9];
  out[2] = v[0] * m[2] + v[1] * m[6] + v[2] * m[10];
  return out;
}
const PI = Math.PI, TWO_PI = 2 * Math.PI;
/** the zone's angle wrap: -pi .. pi (`if (-pi <= a) { if (pi < a) a -= 2 pi } else a += 2 pi`) */
export function wrapPi(a: number): number { return -PI <= a ? (PI < a ? a - TWO_PI : a) : a + TWO_PI; }
/** FUN_00433450: the yaw error of a record (its +0x50) against the direction to `target` (atan2(dx, dz)), wrapped */
export function yawError(rec: GameRecord, target: ArrayLike<number>): number { return wrapPi(rec.ry - Math.atan2(target[0] - rec.x, target[2] - rec.z)); }

export class RgbState {
  rng: Rng;
  sound: SoundSink = SILENT;
  /** FUN_00439bf8 + FUN_00435a11: speak a line of the zone's table; false while another is playing */
  say: (id: string) => boolean = () => true;
  /** the particle emitters of the original (not ported: the hook only records what would be started) */
  fx: (name: string, pos?: ArrayLike<number>) => void = () => { /* */ };
  /** the field of view the camera uses (the original's DAT_0089df2c): 1.0, 0.21 inside a cannon */
  fov = 1;
  /** Cedric's hop table (DAT_00911f78, 9 x 9) */
  hop: number[][] = [];
  hud: HudState = { gauge: false, icon: -1, min: 0, max: 12, value: 0, rightText: '' };

  // ---- the world
  w!: World;
  bound = false;
  pepper!: GameRecord;
  land!: GameRecord;
  buns!: GameRecord;
  cedric!: GameRecord;
  enemy: GameRecord[] = [];
  balls: Ball[] = [];
  cannons: PepperCannon[] = [];
  perches: Perch[] = [];

  // ---- globals of the loop and the nodes
  /** DAT_05d5b338 */
  phase: number = PHASE.INIT;
  /** DAT_05d5b29c: the end of the game for the loop (1 won, 2 lost) */
  resultMode = 0;
  /** DAT_05d5b348 (float) / DAT_05d5b340 (int): ticks since the start of the run */
  tickF = 0; ticks = 0;
  /** _DAT_05d5b344: the tick at which the score starts to fall */
  baseTick = 0;
  /** DAT_05d5b320 .. 28 */
  bridge: [number, number, number] = [K.BRIDGE[0], K.BRIDGE[1], K.BRIDGE[2]];
  /** DAT_0090bc40 */
  shotSpeed: number = K.SHOT_SPEED;
  /** DAT_0090bc44 / DAT_0090bc45 */
  cannonsLeft: number = K.CANNONS;
  lives: number = K.LIVES;
  /** _DAT_0090bc48 */
  g: number = K.G;
  /** DAT_0090bc4c: 0 for a while after a hit (the blinking) */
  vulnerable = true;
  /** DAT_0090bc50 (short) */
  score: number = K.SCORE0;
  /** _DAT_0090bdf8 */
  blink = -1;
  /** DAT_05d5b334: the cannon of Pepper the player sits in (index into `cannons`), -1 none */
  pepperCannon = -1;
  /** DAT_05d5b2b8: the cannon last selected (kept after leaving it: the hit code reads it) */
  selected = -1;
  /** DAT_05d5b330: the enemy cannon Cedric stands on (index 0..8) */
  cedricAt = -1;
  /** DAT_05d5b33c: Cedric's cannon fires at the player */
  cedricFire = false;
  /** DAT_05d5b300 .. 08: the point Cedric's cannon shoots at; DAT_05d5b310 .. 18: Pepper's position at the start of the cannons' update */
  target: [number, number, number] = [0, 0, 0];
  pepperPos: [number, number, number] = [0, 0, 0];
  /** DAT_0090bb70 / DAT_0090bb74: the mode variable this and the previous tick */
  modeNow = 1; modePrev = 1;
  /** DAT_05d5b290 etc.: the speech flags (DAT_05d5b418: phase 2 line said, DAT_05d5b41c: banner line said, DAT_05d5bb00: first hit line said) */
  saidPhase2 = false; saidBanner = false; saidFirstHit = false;
  /** the camera and the zoom of the walk, saved when a cannon is entered (node +0x24 .. +0x6c) */
  camBackup = new Float64Array(18);
  savedFov = 1;
  /** node +0x15 of rgbgame: the result variables were written */
  resultWritten = false;
  /** node +0x184 of PepSwitc: the "ready" bell played for this reload */
  bell = false;
  /** the ball the player fired last (node +0x160), -1 none */
  curBall = -1;
  /** ticks since the cannon was entered (the camera jump into the barrel is not interpolated) */
  aimTicks = 0;
  /** the tick the player's mode word changed (diagnostics) */
  events: string[] = [];

  constructor(rng: Rng = new MathRng()) { this.rng = rng; }

  /** FUN_004388ae(x) */
  rand(x: number): number { return this.rng.next() * x; }

  /** a record the zone looks up by index, with a name check (a different build of the data would have other indices) */
  static check(records: GameRecord[]): string[] {
    const bad: string[] = [];
    for (const [i, n] of Object.entries(REC_NAMES)) if (records[+i]?.name !== n) bad.push(`record ${i} is ${records[+i]?.name}, expected ${n}`);
    for (let i = 0; i < K.CANNONS; i++) if (records[REC.CC[i]]?.name !== `CC0${i}`) bad.push(`record ${REC.CC[i]} is ${records[REC.CC[i]]?.name}, expected CC0${i}`);
    for (let i = 0; i < 4; i++) if (records[REC.CP[i]]?.name !== `CP0${i}`) bad.push(`record ${REC.CP[i]} is ${records[REC.CP[i]]?.name}, expected CP0${i}`);
    for (let i = 0; i < REC.CB_COUNT; i++) {
      const n = `CB0${i}`;
      if (!records.some((r) => r.name === n)) bad.push(`no record ${n}`);
    }
    return bad;
  }

  /** resolve the records (first update / the zone game's set-up) */
  bind(w: World) {
    if (this.bound && this.w === w) return;
    this.w = w;
    const R = w.records;
    this.pepper = R[REC.PEPP]; this.land = R[REC.LAND]; this.buns = R[REC.BUNS]; this.cedric = R[REC.CEDR];
    this.enemy = REC.CC.map((i) => R[i]);
    this.balls = Array.from({ length: REC.CB_COUNT }, (_, i) => new Ball(i, R.find((r) => r.name === `CB0${i}`)!));
    this.bound = true;
  }

  get mode() { return this.w.vars.get(VAR.MODE); }
  setMode(m: number) { this.w.vars.set(VAR.MODE, m); }
  /** the player is inside one of the cannons */
  get inCannon() { return this.pepperCannon >= 0; }

  /** FUN_005f7cec: the hi-score and the trophy of the finished game (only raised) */
  writeResult(): void {
    const v = this.w.vars;
    const trophy = v.get(VAR.TROPHY_RGB);
    if (v.get(VAR.HISCORE_RGB) < this.score) v.set(VAR.HISCORE_RGB, this.score);
    if (this.score < K.GOLD) {
      if (this.score < K.SILVER) { if (trophy < 1) v.set(VAR.TROPHY_RGB, 1); } else if (trophy < 2) v.set(VAR.TROPHY_RGB, 2);
    } else v.set(VAR.TROPHY_RGB, 3);
  }
}

