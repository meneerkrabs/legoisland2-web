// FX_Bricks simulation: one brick (TBrick.c) and its action list (Bricks.c), ported 1:1 from the decompile (docs/re/m4/wp9-bricks.md).
// A brick (0x180-byte block of FUN_0044d170) keeps three Euler rotations with per-rebuild rates, its pivot offset, its place in the model and a
// displacement; FUN_0044d330 rebuilds its local matrix when it is dirty:
//     local = R(A) . T(pivot) . R(C) . T(pos) . R(B) . T(offset)        (row vectors: applied left to right; A / B / C advance by their rates first)
// An action (64-byte pool block of FUN_0044aca0: type +0, state +4 (0 new, 1 running, 2 done), next +8, brick +0x10, delay +0x14 in seconds) is prepended
// to the brick's list; FUN_0044c180 runs the list (head first) and returns the minimum state of the actions that count.
import { buildMatrix } from '../../formats/matrix.ts';
import type { BrickModelBrick, BrickType } from '../../formats/bricks.ts';

/** DAT_008922ac: seconds per tick of the action delays (0.0333333) */
export const DELAY_STEP = Math.fround(0.0333333);
/** DAT_008922b0: the fly-out duration factor (0.0333333) */
const DURATION_STEP = Math.fround(0.0333333);
/** DAT_008922b8: the acceleration step of action 12 (0.0333) */
const ACCEL_STEP = Math.fround(0.0333);
const PI = Math.fround(Math.PI), TWO_PI = Math.fround(2 * Math.PI), HALF_PI = Math.fround(Math.PI / 2), THREE_HALF_PI = Math.fround(4.71239);

export type Vec3 = [number, number, number];

/** the services the actions need (sounds by the original's handle global, FUN_004388ae) */
export interface SimEnv {
  /** FUN_004388ae(max): rand() / 32767 * max */
  rand(max: number): number;
  /** FUN_004433f0(handle, pos): a 3D sound by the handle global (DAT_05d58200 ...) */
  sound(handle: number, pos: Vec3): void;
  /** DAT_008b1718 */
  dt: number;
  /** DAT_05d3701c: the click counter of action 6 */
  clicks: number;
}

/** FUN_0044d170 + FUN_0044e720: a brick of a model instance */
export class Brick {
  readonly type: BrickType | null;
  /** +0xe4 */
  readonly typeIndex: number;
  /** +0x54: the action list, head first */
  actions: Action[] = [];
  /** +0x58: the brick of the other model it morphs from / to */
  partner: Brick | null = null;
  /** +0x5c: local matrix (model space) */
  readonly local = new Float32Array(16);
  /** +0x9c: world matrix of the last draw pass */
  readonly world = new Float32Array(16);
  /** +0xdc dirty, +0xdd active, +0xde visible, +0xdf moving */
  dirty = true; active = false; visible = false; moving = false;
  /** +0xe8 / +0xec palette colours (FUN_0044d170 default 7 = yellow) */
  colour = 7; colour2 = 7;
  /** +0xf0 layer, +0xf2 LOD of the last draw, +0xf3 group */
  layer = 0; lod = 0; group = 0;
  /** +0x36: the symmetry class of the un-spin (brickset.txt first int) */
  sym = 0;
  /** +0x3c: pivot offset */
  readonly pivot: Vec3 = [0, 0, 0];
  /** +0xf4 / +0x100: rotation A and its rate; +0x10c / +0x118: B; +0x124 / +0x130: C (the brick's orientation) */
  readonly rotA: Vec3 = [0, 0, 0]; readonly rateA: Vec3 = [0, 0, 0];
  readonly rotB: Vec3 = [0, 0, 0]; readonly rateB: Vec3 = [0, 0, 0];
  readonly rotC: Vec3 = [0, 0, 0]; readonly rateC: Vec3 = [0, 0, 0];
  /** +0x13c: place in the model; +0x148: the translation before R(B) (the "home"); +0x154: normalised place; +0x160: displacement */
  readonly pos: Vec3 = [0, 0, 0];
  readonly home: Vec3 = [0, 0, 0];
  readonly norm: Vec3 = [0, 0, 0];
  readonly offset: Vec3 = [0, 0, 0];
  /** +0x178: pairing distance (FLT_MAX) */
  dist = 3.4028235e38;

  constructor(src: BrickModelBrick, type: BrickType | null) {
    this.type = type; this.typeIndex = src.type;
    if (type) { this.pivot[0] = type.offset[0]; this.pivot[1] = type.offset[1]; this.pivot[2] = type.offset[2]; this.sym = type.sym[0]; }
    this.pos[0] = src.pos[0]; this.pos[1] = src.pos[1]; this.pos[2] = src.pos[2];
    this.rotC[0] = src.rot[0]; this.rotC[1] = src.rot[1]; this.rotC[2] = src.rot[2];
    this.colour = src.colour; this.colour2 = src.colour2; this.layer = src.layer; this.group = src.group;
    this.norm[0] = src.norm[0]; this.norm[1] = src.norm[1]; this.norm[2] = src.norm[2];
    // FUN_0044d570 after the centre: dirty, home = pivot + pos, rebuild
    this.dirty = true;
    for (let k = 0; k < 3; k++) this.home[k] = Math.fround(this.pivot[k] + this.pos[k]);
    this.rebuild();
  }

  /** the local translation (+0x8c) */
  get tx() { return this.local[12]; } get ty() { return this.local[13]; } get tz() { return this.local[14]; }

  /** FUN_0044d330 */
  rebuild() {
    if (!this.dirty) return;
    const m = this.local;
    m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
    rotate(m, this.rotA, this.rateA);
    translate(m, this.pivot);
    rotate(m, this.rotC, this.rateC);
    translate(m, this.pos);
    rotate(m, this.rotB, this.rateB);
    this.home[0] = m[12]; this.home[1] = m[13]; this.home[2] = m[14];
    translate(m, this.offset);
    this.dirty = false;
  }

  /** FUN_0044d3c0 / FUN_0044d3f0 */
  setPos(x: number, y: number, z: number) { this.dirty = true; this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; }
  setRot(x: number, y: number, z: number) { this.dirty = true; this.rotC[0] = x; this.rotC[1] = y; this.rotC[2] = z; }
}

const wrap = (a: number) => (a <= PI ? (a < -PI ? Math.fround(a + TWO_PI) : a) : Math.fround(a - TWO_PI));
const scratchR = new Float32Array(16), scratchO = new Float32Array(16);
/** FUN_0044d1d0: angles += rates (wrapped to -pi..pi), m = m . R(angles) */
function rotate(m: Float32Array, a: Vec3, r: Vec3) {
  a[0] = wrap(Math.fround(r[0] + a[0])); a[1] = wrap(Math.fround(r[1] + a[1])); a[2] = wrap(Math.fround(r[2] + a[2]));
  scratchR.set(buildMatrix(a[0], a[1], a[2], 0, 0, 0));
  mulInto(scratchO, m, scratchR);
  m.set(scratchO);
}
/** FUN_0044d2f0: translation row += v */
function translate(m: Float32Array, v: Vec3) { m[12] = Math.fround(m[12] + v[0]); m[13] = Math.fround(m[13] + v[1]); m[14] = Math.fround(m[14] + v[2]); }
/** out = a . b (row vectors) */
export function mulInto(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
}
/** FUN_0043cec0: normalise in place (a zero vector stays zero here; the original divides by zero) */
function normalise(v: Vec3) { const l = Math.hypot(v[0], v[1], v[2]); if (l > 0) { v[0] /= l; v[1] /= l; v[2] /= l; } }

// ------------------------------------------------------------------------------------------------ actions

export const ACT = { DELAY: 1, SPIN_A: 3, UNSPIN_A: 4, FLY_OUT: 5, FLY_HOME: 6, SPIN_B: 7, UNSPIN_B: 8, SWAP: 9, FLOAT_AWAY: 0xc } as const;

export interface Action {
  type: number;
  /** +4: 0 new, 1 running, 2 done */
  state: number;
  brick: Brick;
  /** +0x14: seconds before it starts */
  delay: number;
  /** type-specific fields (offsets in the comments of the creators) */
  b18?: number; b19?: number;
  v: number[];
  first?: boolean;
  other?: Brick | null;
}
const push = (b: Brick, a: Action) => { b.actions.unshift(a); return a; };

/** FUN_0044ad30: wait `delay`, then set the brick's visibility (`vis`); with `waitNext` it waits for the next action of the list unless the brick has a partner */
export function addDelay(b: Brick, delay: number, vis: number, waitNext: number) {
  return push(b, { type: ACT.DELAY, state: 0, brick: b, delay, b18: vis, b19: waitNext, v: [] });
}
/** FUN_0044b2d0 (spin A, type 3) / FUN_0044bd00 (spin B, type 7): rates move towards p[0..2] by an acceleration p[3..5] + random (p[6..8]) */
export function addSpin(b: Brick, delay: number, p: ArrayLike<number>, env: SimEnv, kind: 3 | 7) {
  const acc0 = Math.fround(-p[6] + p[3] + env.rand(Math.fround(p[6] + p[6])));
  const acc1 = Math.fround(-p[7] + env.rand(p[7]) + p[4]);
  const acc2 = Math.fround(-p[8] + env.rand(p[8]) + p[5]);
  // v: +0x18..0x20 target rates, +0x24..0x2c accelerations
  return push(b, { type: kind, state: 0, brick: b, delay, first: false, v: [p[0], p[1], p[2], acc0, acc1, acc2] });
}
/** FUN_0044b5b0 (un-spin A, type 4) / FUN_0044bfe0 (un-spin B, type 8) */
export function addUnspin(b: Brick, delay: number, kind: 4 | 8) { return push(b, { type: kind, state: 0, brick: b, delay, first: false, v: [] }); }
/** FUN_0044ae10: fly out from the centre p[20..22] at p[0] per tick for p[1] / p[0] ticks (type 5); clears the displacement */
export function addFlyOut(b: Brick, delay: number, p: ArrayLike<number>) {
  b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0;
  const d: Vec3 = [Math.fround(b.tx - p[0x14]), Math.fround(b.ty - p[0x15]), Math.fround(b.tz - p[0x16])];
  normalise(d);
  // v: +0x24..0x2c velocity, +0x1c remaining time
  return push(b, { type: ACT.FLY_OUT, state: 0, brick: b, delay, b18: 0, v: [d[0] * p[0], d[1] * p[0], d[2] * p[0], Math.fround((p[1] / p[0]) * DURATION_STEP)] });
}
/** FUN_0044aff0: fly back home at `speed` per tick (type 6) */
export function addFlyHome(b: Brick, delay: number, speed: number) {
  // v: +0x20 speed, +0x24..0x2c velocity
  return push(b, { type: ACT.FLY_HOME, state: 0, brick: b, delay, b18: 0, v: [speed, 0, 0, 0] });
}
/** FUN_0044b8c0: take over the partner's place and spin when the partner's first action is done (type 9) */
export function addSwap(b: Brick, delay: number, other: Brick | null) { return push(b, { type: ACT.SWAP, state: 0, brick: b, delay, other, v: [] }); }
/** FUN_0044bb70: accelerate by acc[0..2] until the displacement's squared length exceeds `limit` (type 12) */
export function addFloatAway(b: Brick, delay: number, acc: ArrayLike<number>, limit: number) {
  // v: +0x24 limit, +0x28..0x30 velocity, +0x34..0x3c acceleration
  return push(b, { type: ACT.FLOAT_AWAY, state: 0, brick: b, delay, v: [limit, 0, 0, 0, acc[0], acc[1], acc[2]] });
}

/** the common start of every update: false while the brick is not active or the delay runs */
function started(a: Action, env: SimEnv): boolean {
  if (!a.brick.active) return false;
  const step = Math.fround(env.dt * DELAY_STEP);
  if (step <= a.delay) { a.delay = Math.fround(a.delay - step); return false; }
  a.state = 1;
  return true;
}
/** the first run of a spin / un-spin: newer spins of `kind` with no delay of this list (behind it) are cancelled */
function dedupe(a: Action, kind: number) {
  if (a.first) return;
  const list = a.brick.actions;
  for (let i = list.indexOf(a) + 1; i < list.length; i++) { const x = list[i]; if (x.type === kind && x.delay === 0) x.state = 2; }
  a.first = true;
}

/** FUN_0044ad80 */
function runDelay(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick, list = b.actions, nx = list[list.indexOf(a) + 1];
  if (!b.partner && a.b19 && nx && nx.state !== 2) return 1;
  b.visible = !!a.b18;
  a.state = 2;
  return 2;
}
/** FUN_0044b3c0 / FUN_0044bdf0: the rates approach the targets */
function runSpin(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  dedupe(a, a.type);
  const r = a.type === ACT.SPIN_A ? a.brick.rateA : a.brick.rateB;
  for (let k = 0; k < 3; k++) {
    const t = a.v[k], acc = a.v[3 + k];
    if (t < 0) { if (t < r[k]) { let f = Math.fround(acc * env.dt + r[k]); if (f < t) f = t; r[k] = f; } }
    else if (r[k] < t) { let f = Math.fround(acc * env.dt + r[k]); if (t < f) f = t; r[k] = f; }
  }
  a.brick.dirty = true;
  return a.state;
}
/** FUN_0044b600: spin A stops at an angle the brick's symmetry makes look like 0 */
function runUnspinA(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  dedupe(a, ACT.SPIN_A);
  const b = a.brick;
  a.state = 2;
  for (let k = 0; k < 3; k++) {
    let f = b.rotA[k];
    if (b.sym === 1) { if (f < 0) f = Math.fround(f + PI); }
    else if (b.sym === 2) {
      f = Math.fround(f + PI);
      if (f < THREE_HALF_PI) { if (f < PI) { if (HALF_PI <= f) f = Math.fround(f - HALF_PI); } else f = Math.fround(f - PI); }
      else f = Math.fround(f - THREE_HALF_PI);
    } else f = Math.abs(Math.fround(Math.fround(b.rotA[k] + PI) - PI));
    if (b.rateA[k] < f) { b.dirty = true; a.state = 1; }
    else { b.rateA[k] = 0; b.rotA[k] = 0; b.dirty = true; }
  }
  return a.state;
}
/** FUN_0044c030: the same for spin B (no symmetry) */
function runUnspinB(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  dedupe(a, ACT.SPIN_B);
  const b = a.brick;
  a.state = 2;
  b.dirty = true;
  for (let k = 0; k < 3; k++) {
    if (b.rateB[k] < Math.abs(Math.fround(Math.fround(b.rotB[k] + PI) - PI))) a.state = 1;
    else { b.rateB[k] = 0; b.rotB[k] = 0; }
  }
  return a.state;
}
/** FUN_0044aee0 */
function runFlyOut(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick;
  a.v[3] = Math.fround(a.v[3] - Math.fround(env.dt * DELAY_STEP));
  if (a.v[3] <= 0 && a.b18) { b.moving = false; a.state = 2; return 2; }
  b.offset[0] = Math.fround(env.dt * a.v[0] + b.offset[0]);
  b.offset[1] = Math.fround(env.dt * a.v[1] + b.offset[1]);
  b.offset[2] = Math.fround(env.dt * a.v[2] + b.offset[2]);
  b.dirty = true; b.moving = true; a.b18 = 1;
  return a.state;
}
/** FUN_0044b040: back home; a click sound (one of four, in turn) when it snaps in */
function runFlyHome(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick;
  if (!a.b18) {
    b.offset[0] = Math.fround(b.tx - b.home[0]); b.offset[1] = Math.fround(b.ty - b.home[1]); b.offset[2] = Math.fround(b.tz - b.home[2]);
    b.rebuild();
    const d: Vec3 = [b.offset[0], b.offset[1], b.offset[2]];
    normalise(d);
    const s = -a.v[0];
    a.v[1] = s * d[0]; a.v[2] = s * d[1]; a.v[3] = s * d[2];
    b.moving = true; b.visible = true; a.b18 = 1;
  }
  const sx = env.dt * a.v[1], sy = env.dt * a.v[2], sz = env.dt * a.v[3];
  if (Math.sqrt(sx * sx + sy * sy + sz * sz) < Math.sqrt(b.offset[2] * b.offset[2] + b.offset[1] * b.offset[1] + b.offset[0] * b.offset[0])) {
    b.offset[0] = Math.fround(sx + b.offset[0]); b.offset[1] = Math.fround(sy + b.offset[1]); b.offset[2] = Math.fround(sz + b.offset[2]);
    b.dirty = true;
    return a.state;
  }
  env.clicks++;
  const k = env.clicks & 3;
  env.sound(CLICK_SOUNDS[k], [b.world[12], b.world[13], b.world[14]]);
  b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0;
  a.state = 2; b.moving = false; b.dirty = true;
  return 2;
}
/** the click sounds of FUN_0044b040 by DAT_05d3701c & 3: DAT_05d58200, DAT_05d581f4, DAT_05d581f8, DAT_05d581fc */
export const CLICK_SOUNDS = [0x05d58200, 0x05d581f4, 0x05d581f8, 0x05d581fc];
/** FUN_0044b910: `recPause` = record flag 0x2000 (waits), `swapped` = the slot's flag +0x1725 */
function runSwap(a: Action, recPause: boolean, swapped: { v: boolean }): number {
  if (recPause) return a.state;
  const o = a.other ?? null;
  if (o) {
    if ((o.actions[0]?.state ?? 2) !== 2) return a.state;
    for (const x of o.actions) x.state = 2;
  }
  swapped.v = true;
  const b = a.brick;
  b.visible = true;
  if (o) {
    o.visible = false;
    b.offset[0] = Math.fround(o.tx - b.home[0]); b.offset[1] = Math.fround(o.ty - b.home[1]); b.offset[2] = Math.fround(o.tz - b.home[2]);
    for (let k = 0; k < 3; k++) { b.rotA[k] = o.rotA[k]; b.rateA[k] = o.rateA[k]; b.rotB[k] = o.rotB[k]; b.rateB[k] = o.rateB[k]; }
    b.dirty = false; b.active = true; b.moving = true;
    a.state = 2;
    return 2;
  }
  b.active = true; b.moving = false;
  b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0;
  a.state = 2;
  return 2;
}
/** FUN_0044bbe0 */
function runFloatAway(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick, k = Math.fround(env.dt * ACCEL_STEP);
  a.v[1] = Math.fround(k * a.v[4] + a.v[1]); a.v[2] = Math.fround(k * a.v[5] + a.v[2]); a.v[3] = Math.fround(k * a.v[6] + a.v[3]);
  b.offset[0] = Math.fround(a.v[1] + b.offset[0]); b.offset[1] = Math.fround(b.offset[1] + a.v[2]); b.offset[2] = Math.fround(b.offset[2] + a.v[3]);
  b.moving = true;
  const d2 = b.offset[0] * b.offset[0] + b.offset[1] * b.offset[1] + b.offset[2] * b.offset[2];
  return d2 <= a.v[0] ? a.state : 2;
}

/** FUN_0044c180: run a brick's list; the minimum state of the actions that report one (3 / 7 / 9 do not) */
export function runActions(b: Brick, env: SimEnv, recPause: boolean, swapped: { v: boolean }): number {
  let r = 2;
  // the list can only shrink between ticks (FUN_0044ad00 frees it); iterate a snapshot like the linked list
  for (const a of b.actions.slice()) {
    if (a.state === 2) continue;
    let x: number | null = null;
    switch (a.type) {
      case ACT.DELAY: x = runDelay(a, env); break;
      case ACT.SPIN_A: runSpin(a, env); break;
      case ACT.UNSPIN_A: x = runUnspinA(a, env); break;
      case ACT.FLY_OUT: x = runFlyOut(a, env); break;
      case ACT.FLY_HOME: x = runFlyHome(a, env); break;
      case ACT.SPIN_B: runSpin(a, env); break;
      case ACT.UNSPIN_B: x = runUnspinB(a, env); break;
      case ACT.SWAP: runSwap(a, recPause, swapped); break;
      case ACT.FLOAT_AWAY: x = runFloatAway(a, env); break;
    }
    if (x !== null && x <= r) r = x;
  }
  return r;
}
