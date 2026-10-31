// FX_Bricks simulation: one brick (TBrick.c) and its action list (Bricks.c), ported 1:1 from the decompile (docs/re/m4/wp9-bricks.md).
// A brick (0x180-byte block of FUN_0044d170) keeps three Euler rotations with per-rebuild rates, its pivot offset, its place in the model and a
// displacement; FUN_0044d330 rebuilds its local matrix when it is dirty:
//     local = R(A) . T(pivot) . R(C) . T(pos) . R(B) . T(offset)        (row vectors: applied left to right; A / B / C advance by their rates first)
// An action (64-byte pool block of FUN_0044aca0: type +0, state +4 (0 new, 1 running, 2 done), next +8, brick +0x10, delay +0x14 in seconds) is prepended
// to the brick's list; FUN_0044c180 runs the list (head first) and returns the minimum state of the actions that count.
//
// Arithmetic: the executable runs the x87 at 24-bit precision (docs/re/gaps.md "x87 control word"), so every + - * / sqrt result is a float32. The vectors of a brick and the fields
// of an action are Float32Arrays (a store rounds, like a float field), and every operation of the original's expression is rounded on its own (`ml` / `ad` / `sb` / `sq` of
// zones/common/f32.ts) in the order of the ASSEMBLY (the decompile prints some three-term sums in the other order: each site was checked against the instructions). The step of
// the world clock `env.dt` is DAT_008b1718 (1.0 for the first five frames, then 0.5): every action multiplies by it per tick, nothing assumes 30 ticks / s.
import type { BrickModelBrick, BrickType } from '../../formats/bricks.ts';
import { normalise3 } from '../../zones/exact.ts';
import { ad, fr, ml, sb, sq } from '../../zones/common/f32.ts';
import { eulerMatrix, matThen } from '../../zones/common/matrix.ts';

/** a float32 constant of the executable by its bits (the decompile prints rounded decimals: 0x3d088889 is 1/30 = 0.0333333350718, not fround(0.0333333)) */
const F32 = (bits: number) => new Float32Array(new Uint32Array([bits]).buffer)[0];
/** DAT_008922ac: seconds per tick of the action delays (1/30) */
export const DELAY_STEP = F32(0x3d088889);
/** DAT_008922b0: the fly-out duration factor (1/30) */
const DURATION_STEP = F32(0x3d088889);
/** DAT_008922b8: the acceleration step of action 12 (0.0333) */
const ACCEL_STEP = F32(0x3d086595);
/** DAT_0089207c pi, DAT_00892098 -pi, DAT_00892094 2 pi, DAT_00892220 pi / 2, DAT_008922b4 3 pi / 2 (4.71238899) */
const PI = F32(0x40490fdb), NEG_PI = F32(0xc0490fdb), TWO_PI = F32(0x40c90fdb), HALF_PI = F32(0x3fc90fdb), THREE_HALF_PI = F32(0x4096cbe4);
/** the original's action pool (FUN_0044ac70: 0x40-byte blocks from DAT_05d17008 to DAT_05d36fd4, the last one terminates the free list): 2048 blocks, FUN_0044aca0 returns null when none is left */
export const ACTION_POOL = 2048;

export type Vec3 = [number, number, number];

/** the action pool (FUN_0044aca0 takes a block, FUN_0044ace0 / FUN_0044ad00 give them back: only the count matters here) */
export class ActionPool {
  used = 0;
  /** FUN_0044aca0: false when the pool is empty (the creator then does nothing) */
  take(): boolean { if (this.used >= ACTION_POOL) return false; this.used++; return true; }
  /** FUN_0044ad00 on a list of `n` actions */
  release(n: number): void { this.used = Math.max(0, this.used - n); }
}

/** the services the actions need (sounds by the original's handle global, FUN_004388ae) */
export interface SimEnv {
  /** FUN_004388ae(max): (float)rand() / 32767.0f * max (the CRT port, src/game/crt.ts `randF`) */
  rand(max: number): number;
  /** FUN_004433f0(handle, pos): a 3D sound by the handle global (DAT_05d58200 ...) */
  sound(handle: number, pos: Vec3): void;
  /** DAT_008b1718 */
  dt: number;
  /** DAT_05d3701c: the click counter of action 6 */
  clicks: number;
  /** the action pool (DAT_05d17000) */
  pool: ActionPool;
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
  readonly pivot = new Float32Array(3);
  /** +0xf4 / +0x100: rotation A and its rate; +0x10c / +0x118: B; +0x124 / +0x130: C (the brick's orientation) */
  readonly rotA = new Float32Array(3); readonly rateA = new Float32Array(3);
  readonly rotB = new Float32Array(3); readonly rateB = new Float32Array(3);
  readonly rotC = new Float32Array(3); readonly rateC = new Float32Array(3);
  /** +0x13c: place in the model; +0x148: the translation before R(B) (the "home"); +0x154: normalised place; +0x160: displacement */
  readonly pos = new Float32Array(3);
  readonly home = new Float32Array(3);
  readonly norm = new Float32Array(3);
  readonly offset = new Float32Array(3);
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
    for (let k = 0; k < 3; k++) this.home[k] = ad(this.pivot[k], this.pos[k]);
    this.rebuild();
  }

  /** the local translation (+0x8c) */
  get tx() { return this.local[12]; } get ty() { return this.local[13]; } get tz() { return this.local[14]; }

  /** FUN_0044d330 */
  rebuild() {
    if (!this.dirty) return;
    const m = this.local;
    m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;      // FUN_0043ac78
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

/** the wrap of FUN_0044d1d0: `if (a <= pi) { if (a < -pi) a += 2 pi } else a -= 2 pi` (float32 operations) */
const wrap = (a: number) => (a <= PI ? (a < NEG_PI ? ad(a, TWO_PI) : a) : sb(a, TWO_PI));
const scratchR: Float32Array<ArrayBuffer> = new Float32Array(16);
/** FUN_0044d1d0: angles += rates (wrapped to -pi..pi), m = m . R(angles) (FUN_0043a340 builds R, FUN_0043a9e5(m, R, copy of m) multiplies) */
function rotate(m: Float32Array<ArrayBuffer>, a: Float32Array, r: Float32Array) {
  a[0] = wrap(ad(r[0], a[0])); a[1] = wrap(ad(r[1], a[1])); a[2] = wrap(ad(r[2], a[2]));
  eulerMatrix(a[0], a[1], a[2], 0, 0, 0, scratchR);
  matThen(m, scratchR, m);
}
/** FUN_0044d2f0: translation row += v */
function translate(m: Float32Array, v: ArrayLike<number>) { m[12] = ad(v[0], m[12]); m[13] = ad(v[1], m[13]); m[14] = ad(v[2], m[14]); }
/** out = a . b (row vectors; FUN_0043a9e5(out, b, a)) */
export function mulInto(out: Float32Array<ArrayBuffer>, a: ArrayLike<number>, b: ArrayLike<number>) { matThen(a, b, out); }
/** FUN_0043cec0: normalise in place (a zero vector stays as it is) */
const normalise = (v: Vec3) => normalise3(v);

// ------------------------------------------------------------------------------------------------ actions

export const ACT = { DELAY: 1, SPIN_A: 3, UNSPIN_A: 4, FLY_OUT: 5, FLY_HOME: 6, SPIN_B: 7, UNSPIN_B: 8, SWAP: 9, FLOAT_AWAY: 0xc } as const;

export interface Action {
  type: number;
  /** +4: 0 new, 1 running, 2 done */
  state: number;
  brick: Brick;
  /** +0x14: seconds before it starts (float32) */
  delay: number;
  /** type-specific fields (offsets in the comments of the creators), float32 */
  b18?: number; b19?: number;
  v: Float32Array;
  first?: boolean;
  other?: Brick | null;
}
const push = (b: Brick, a: Action) => { b.actions.unshift(a); return a; };
/** FUN_0044ad00(&brick->actions): the list goes back to the pool */
export function freeActions(env: SimEnv, b: Brick) { env.pool.release(b.actions.length); b.actions = []; }

/** FUN_0044ad30: wait `delay`, then set the brick's visibility (`vis`); with `waitNext` it waits for the next action of the list unless the brick has a partner */
export function addDelay(env: SimEnv, b: Brick, delay: number, vis: number, waitNext: number) {
  if (!env.pool.take()) return null;
  return push(b, { type: ACT.DELAY, state: 0, brick: b, delay: fr(delay), b18: vis, b19: waitNext, v: new Float32Array(0) });
}
/** FUN_0044b2d0 (spin A, type 3) / FUN_0044bd00 (spin B, type 7): rates move towards p[0..2] by an acceleration p[3..5] + random (p[6..8]) */
export function addSpin(b: Brick, delay: number, p: ArrayLike<number>, env: SimEnv, kind: 3 | 7) {
  if (!env.pool.take()) return null;
  const p6 = fr(p[6]), p7 = fr(p[7]), p8 = fr(p[8]);
  // (-p6 + p3) + rand(p6 + p6), (-p7 + rand(p7)) + p4, (-p8 + rand(p8)) + p5: the draws in this order, each sum rounded on its own
  const acc0 = ad(ad(-p6, fr(p[3])), env.rand(ad(p6, p6)));
  const acc1 = ad(ad(-p7, env.rand(p7)), fr(p[4]));
  const acc2 = ad(ad(-p8, env.rand(p8)), fr(p[5]));
  // v: +0x18..0x20 target rates, +0x24..0x2c accelerations
  return push(b, { type: kind, state: 0, brick: b, delay: fr(delay), first: false, v: Float32Array.of(p[0], p[1], p[2], acc0, acc1, acc2) });
}
/** FUN_0044b5b0 (un-spin A, type 4) / FUN_0044bfe0 (un-spin B, type 8) */
export function addUnspin(env: SimEnv, b: Brick, delay: number, kind: 4 | 8) {
  if (!env.pool.take()) return null;
  return push(b, { type: kind, state: 0, brick: b, delay: fr(delay), first: false, v: new Float32Array(0) });
}
/** FUN_0044ae10: fly out from the centre p[20..22] at p[0] per tick for p[1] / p[0] ticks (type 5); clears the displacement */
export function addFlyOut(env: SimEnv, b: Brick, delay: number, p: ArrayLike<number>) {
  if (!env.pool.take()) return null;
  b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0;
  const d: Vec3 = [sb(b.tx, fr(p[0x14])), sb(b.ty, fr(p[0x15])), sb(b.tz, fr(p[0x16]))];
  normalise(d);
  const speed = fr(p[0]);
  // v: +0x24..0x2c velocity, +0x1c remaining time
  return push(b, { type: ACT.FLY_OUT, state: 0, brick: b, delay: fr(delay), b18: 0, v: Float32Array.of(ml(d[0], speed), ml(d[1], speed), ml(d[2], speed), ml(fr(fr(p[1]) / speed), DURATION_STEP)) });
}
/** FUN_0044aff0: fly back home at `speed` per tick (type 6) */
export function addFlyHome(env: SimEnv, b: Brick, delay: number, speed: number) {
  if (!env.pool.take()) return null;
  // v: +0x20 speed, +0x24..0x2c velocity
  return push(b, { type: ACT.FLY_HOME, state: 0, brick: b, delay: fr(delay), b18: 0, v: Float32Array.of(speed, 0, 0, 0) });
}
/** FUN_0044b8c0: take over the partner's place and spin when the partner's first action is done (type 9) */
export function addSwap(env: SimEnv, b: Brick, delay: number, other: Brick | null) {
  if (!env.pool.take()) return null;
  return push(b, { type: ACT.SWAP, state: 0, brick: b, delay: fr(delay), other, v: new Float32Array(0) });
}
/** FUN_0044bb70: accelerate by acc[0..2] until the displacement's squared length exceeds `limit` (type 12) */
export function addFloatAway(env: SimEnv, b: Brick, delay: number, acc: ArrayLike<number>, limit: number) {
  if (!env.pool.take()) return null;
  // v: +0x24 limit, +0x28..0x30 velocity, +0x34..0x3c acceleration
  return push(b, { type: ACT.FLOAT_AWAY, state: 0, brick: b, delay: fr(delay), v: Float32Array.of(limit, 0, 0, 0, acc[0], acc[1], acc[2]) });
}

/** the common start of every update: false while the brick is not active or the delay runs */
function started(a: Action, env: SimEnv): boolean {
  if (!a.brick.active) return false;
  const step = ml(env.dt, DELAY_STEP);
  // (`fcomp; test ah, 0x41; jne`: C0 | C3 also holds for an unordered compare, so a NaN delay waits for ever like `<=` does: `!(step > delay)`)
  if (!(step > a.delay)) { a.delay = sb(a.delay, step); return false; }
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
/** FUN_0044b3c0 / FUN_0044bdf0: the rates approach the targets (each axis: `rate + acc * dt`, clamped at the target) */
function runSpin(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  dedupe(a, a.type);
  const r = a.type === ACT.SPIN_A ? a.brick.rateA : a.brick.rateB;
  for (let k = 0; k < 3; k++) {
    const t = a.v[k], acc = a.v[3 + k];
    if (t < 0) { if (t < r[k]) { let f = ad(ml(acc, env.dt), r[k]); if (f < t) f = t; r[k] = f; } }
    else if (r[k] < t) { let f = ad(ml(acc, env.dt), r[k]); if (t < f) f = t; r[k] = f; }
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
    if (b.sym === 1) { if (f < 0) f = ad(f, PI); }
    else if (b.sym === 2) {
      f = ad(f, PI);
      if (f < THREE_HALF_PI) { if (f < PI) { if (HALF_PI <= f) f = sb(f, HALF_PI); } else f = sb(f, PI); }
      else f = sb(f, THREE_HALF_PI);
    } else f = Math.abs(sb(ad(b.rotA[k], PI), PI));
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
    if (b.rateB[k] < Math.abs(sb(ad(b.rotB[k], PI), PI))) a.state = 1;
    else { b.rateB[k] = 0; b.rotB[k] = 0; }
  }
  return a.state;
}
/** FUN_0044aee0 */
function runFlyOut(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick;
  a.v[3] = sb(a.v[3], ml(env.dt, DELAY_STEP));
  if (a.v[3] <= 0 && a.b18) { b.moving = false; a.state = 2; return 2; }
  // the displacement: `dt * v + offset` per axis (the products of y and z are formed first, the sums go x, y, z)
  const sy = ml(env.dt, a.v[1]), sz = ml(env.dt, a.v[2]);
  b.offset[0] = ad(ml(env.dt, a.v[0]), b.offset[0]);
  b.offset[1] = ad(sy, b.offset[1]);
  b.offset[2] = ad(sz, b.offset[2]);
  b.dirty = true; b.moving = true; a.b18 = 1;
  return a.state;
}
/** FUN_0044b040: back home; a click sound (one of four, in turn) when it snaps in */
function runFlyHome(a: Action, env: SimEnv): number {
  if (!started(a, env)) return a.state;
  const b = a.brick;
  if (!a.b18) {
    b.offset[0] = sb(b.tx, b.home[0]); b.offset[1] = sb(b.ty, b.home[1]); b.offset[2] = sb(b.tz, b.home[2]);
    b.rebuild();
    const d: Vec3 = [b.offset[0], b.offset[1], b.offset[2]];
    normalise(d);
    const s = -a.v[0];
    a.v[1] = ml(s, d[0]); a.v[2] = ml(s, d[1]); a.v[3] = ml(s, d[2]);
    b.moving = true; b.visible = true; a.b18 = 1;
  }
  const sx = ml(env.dt, a.v[1]), sy = ml(env.dt, a.v[2]), sz = ml(env.dt, a.v[3]);
  // |step| < |offset|: the squares add up x, y, z for the offset and z, y, x for the step (the instruction order), every operation rounded, the roots too
  const stepLen = sq(ad(ad(ml(sz, sz), ml(sy, sy)), ml(sx, sx)));
  const offLen = sq(ad(ad(ml(b.offset[0], b.offset[0]), ml(b.offset[1], b.offset[1])), ml(b.offset[2], b.offset[2])));
  if (stepLen < offLen) {
    b.offset[0] = ad(sx, b.offset[0]); b.offset[1] = ad(sy, b.offset[1]); b.offset[2] = ad(sz, b.offset[2]);
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
    b.offset[0] = sb(o.tx, b.home[0]); b.offset[1] = sb(o.ty, b.home[1]); b.offset[2] = sb(o.tz, b.home[2]);
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
  const b = a.brick, k = ml(env.dt, ACCEL_STEP);
  // the products k * acc are stored first, then added to the velocity; the velocity then to the displacement
  const px = ml(k, a.v[4]), py = ml(k, a.v[5]), pz = ml(k, a.v[6]);
  a.v[1] = ad(px, a.v[1]); a.v[2] = ad(py, a.v[2]); a.v[3] = ad(pz, a.v[3]);
  b.offset[0] = ad(a.v[1], b.offset[0]); b.offset[1] = ad(b.offset[1], a.v[2]); b.offset[2] = ad(b.offset[2], a.v[3]);
  b.moving = true;
  const x = b.offset[0], y = b.offset[1], z = b.offset[2];
  const d2 = ad(ad(ml(z, z), ml(y, y)), ml(x, x));
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
