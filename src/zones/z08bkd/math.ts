// Small helpers of the zone's code (the Brick Dive set of FUN_005bxxxx functions): angles, the shape rotation, the segment / sphere test, the free-running clock.
import { C } from './consts.ts';

import { fr, ad, sb, ml, dv, sq } from '../common/f32.ts';
import { randF } from '../../game/crt.ts';

/** FUN_005bb164: an angle wrapped into [0, 2 pi) (two loops, like the original) */
export function wrapAngle(a: number): number {
  while (C.TWO_PI <= a) a = fr(a - C.TWO_PI);
  while (a < 0) a = fr(a + C.TWO_PI);
  return a;
}

export interface AngleDelta { /** +1 / -1 / 0: the direction of the shorter way */ dir: number; /** distance / pi, 1 when equal */ frac: number; /** the shorter angle distance */ dist: number }
/**
 * FUN_005bb05d(a, b, &frac, &dist): which way to turn from `b` to reach... (the original names: param_1 = target angle, param_2 = current angle): a == b gives (0, frac 1, dist 0);
 * a <= b: the gap d = b - a (<= pi: dir -1, else 2 pi - d: dir +1); a > b: d = a - b (<= pi: dir +1, else 2 pi - d: dir -1); frac = dist / pi.
 */
export function angleDelta(a: number, b: number): AngleDelta {
  if (a === b) return { dir: 0, frac: 1, dist: 0 };
  let d: number, dir: number;
  if (a <= b) { d = fr(b - a); dir = -1; } else { d = fr(a - b); dir = 1; }
  if (d > C.PI) { d = fr(C.TWO_PI - d); dir = -dir; }
  return { dir, frac: fr(d / C.PI), dist: d };
}

/** FUN_005bbb02 / the inline sums of squares: squared distance of two points */
export function dist2(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const x = sb(a[0], b[0]), y = sb(a[1], b[1]), z = sb(a[2], b[2]);
  return ad(ad(ml(z, z), ml(y, y)), ml(x, x));
}

/**
 * FUN_005ba8b0(out, shape, n, angle): rotate the n shape points about z (the shape's y axis points along the heading): with c = cos(angle), s = sin(angle):
 * x' = (c y + s x) * 1, y' = -((c x - s y) * 1), z' = z. The caller adds the position.
 */
export function rotateShape(shape: readonly (readonly number[])[], n: number, angle: number): number[][] {
  const c = fr(Math.cos(angle)), s = fr(Math.sin(angle));
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p = shape[i];
    out.push([ml(ad(ml(c, p[1]), ml(s, p[0])), 1), -ml(sb(ml(c, p[0]), ml(s, p[1])), 1), p[2]]);
  }
  return out;
}

/**
 * FUN_0043d159(p0, p1, centre, radius): the parameter t of the segment p0 -> p1 where it meets the sphere. The quadratic |p0 + t d - c|^2 = r^2; with a positive
 * discriminant the result is the smaller root when it lies in [0, larger root], else the larger root; -1 when the line misses the sphere. Callers accept 0 < t <= 1.
 */
export function segmentSphere(p0: ArrayLike<number>, p1: ArrayLike<number>, c: ArrayLike<number>, r: number): number {
  // asm 0x43d159 .. 0x43d2ab: every named quantity is a float32 local; sums run x, y, z; the quadratic's discriminant is b^2 - a c 4
  const ox = sb(p0[0], c[0]), oy = sb(p0[1], c[1]), oz = sb(p0[2], c[2]);
  const dx = sb(p1[0], p0[0]), dy = sb(p1[1], p0[1]), dz = sb(p1[2], p0[2]);
  const a = ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz));
  const inv = dv(1, ml(2, a));
  const b = ml(2, ad(ad(ml(dx, ox), ml(dy, oy)), ml(dz, oz)));
  const cc = sb(ad(ad(ml(ox, ox), ml(oy, oy)), ml(oz, oz)), ml(r, r));
  const disc = sb(ml(b, b), ml(ml(a, cc), 4));
  if (!(0 < disc)) return -1;
  const rt = sq(disc);
  const t1 = ml(sb(-b, rt), inv), t2 = ml(ad(-b, rt), inv);
  return t1 >= 0 && t1 <= t2 ? t1 : t2;
}

/**
 * FUN_0043cec0: normalise in place. The vector lives in float32 memory in the original: len2 = f32((x*x + y*y) + z*z), k = f32(1 / sqrt(len2)), v = f32(k * v); a zero
 * length changes nothing. (Near +-1 the result matters: asin of a normalised component turns a 6e-8 difference into 3e-4.)
 */
export function normalize3(v: number[]): number[] {
  v[0] = fr(v[0]); v[1] = fr(v[1]); v[2] = fr(v[2]);
  const l = ad(ad(ml(v[0], v[0]), ml(v[1], v[1])), ml(v[2], v[2]));
  if (l !== 0) { const k = dv(1, sq(l)); v[0] = ml(k, v[0]); v[1] = ml(k, v[1]); v[2] = ml(k, v[2]); }
  return v;
}

/**
 * The zone's own "random" source (FUN_005baf8f / FUN_005baffd): a clock that advances by the tick's seconds each frame of mode 2 and wraps above 1.0,
 * and `pick(n)` turns its phase into an index: thresholds K/n, 2K/n, 4K/n ... with K = 0.95 (_DAT_008924e4); the first one the phase is below, else 0.
 * (FUN_004388ae(x) elsewhere is the C runtime's rand() scaled to [0, x]: `Rng`.)
 */
export class ZoneClock {
  /** DAT_05d5ab04: seconds of the last tick, DAT_05d5ab08: the phase */
  dt: number = C.TICK_SECONDS;
  phase = 0;
  /** FUN_005baf8f, once per frame of mode 2 */
  tick(stepDt = 1) {
    this.dt = ml(ml(C.ONE, stepDt), C.TICK_SECONDS);     // _DAT_00892020 * DAT_008b1718 * _DAT_008922ac
    this.phase = fr(this.phase + this.dt);
    while (C.ONE < this.phase) this.phase = fr(this.phase - C.ONE);
  }
  /** FUN_005baffd(count) */
  pick(count: number): number {
    let t = fr(C.POINT_NINETY_FIVE / count);
    for (let i = 0; i < count; i++) {
      if (this.phase < t) return i;
      t = fr(t + t);
    }
    return 0;
  }
}

/**
 * FUN_004388ae(x) on the shared CRT generator (src/game/crt.ts): `(float) rand() / 32767.0f * x` in float32 steps, 0 for x <= 0 (no draw), the result can equal x.
 * The zone draws `ftol(FUN_004388ae(x))` for the diver's wave and the shock sound; tests script rand() with `setRandSource` of crt.ts.
 */
export class Rng {
  /** FUN_004388ae(x) */
  float(x: number): number { return randF(x); }
  /** `ftol(FUN_004388ae(x))` */
  int(x: number): number { return Math.trunc(this.float(x)); }
}
