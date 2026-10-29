// Small helpers of the zone's code (the Brick Dive set of FUN_005bxxxx functions): angles, the shape rotation, the segment / sphere test, the free-running clock.
import { C } from './consts.ts';

const fr = Math.fround;

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
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return fr(fr(z * z) + fr(y * y) + fr(x * x));
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
    out.push([fr((c * p[1] + s * p[0]) * 1), -fr((c * p[0] - s * p[1]) * 1), p[2]]);
  }
  return out;
}

/**
 * FUN_0043d159(p0, p1, centre, radius): the parameter t of the segment p0 -> p1 where it meets the sphere. The quadratic |p0 + t d - c|^2 = r^2; with a positive
 * discriminant the result is the smaller root when it lies in [0, larger root], else the larger root; -1 when the line misses the sphere. Callers accept 0 < t <= 1.
 */
export function segmentSphere(p0: ArrayLike<number>, p1: ArrayLike<number>, c: ArrayLike<number>, r: number): number {
  const ox = p0[0] - c[0], oy = p0[1] - c[1], oz = p0[2] - c[2];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const a = dz * dz + dy * dy + dx * dx;
  const inv = 1 / (2 * a);
  let b = dz * oz + dy * oy + dx * ox;
  b = b + b;
  const disc = b * b - a * ((oz * oz + oy * oy + ox * ox) - r * r) * 4;
  let t = -1;
  if (disc > 0) {
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) * inv, t2 = (-b + sq) * inv;
    t = t2;
    if (t1 >= 0 && t1 <= t2) t = t1;
  }
  return t;
}

/** FUN_0043cec0: normalise in place (a zero vector stays zero) */
export function normalize3(v: number[]): number[] {
  const l = v[2] * v[2] + v[1] * v[1] + v[0] * v[0];
  if (l !== 0) { const k = 1 / Math.sqrt(l); v[0] *= k; v[1] *= k; v[2] *= k; }
  return v;
}

/**
 * The zone's own "random" source (FUN_005baf8f / FUN_005baffd): a clock that advances by the tick's seconds each frame of mode 2 and wraps above 1.0,
 * and `pick(n)` turns its phase into an index: thresholds K/n, 2K/n, 4K/n ... with K = 0.95 (_DAT_008924e4); the first one the phase is below, else 0.
 * (FUN_004388ae(x) elsewhere is the C runtime's rand() scaled to [0, x): `Rng`.)
 */
export class ZoneClock {
  /** DAT_05d5ab04: seconds of the last tick, DAT_05d5ab08: the phase */
  dt: number = C.TICK_SECONDS;
  phase = 0;
  /** FUN_005baf8f, once per frame of mode 2 */
  tick() {
    this.dt = fr(C.ONE * 1 * C.TICK_SECONDS);
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

/** FUN_004388ae(x): rand() / 32767 * x (the C runtime's generator: a seedable stand-in with the same range) */
export class Rng {
  private s: number;
  constructor(seed = 12345) { this.s = seed >>> 0; }
  next(): number { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return ((this.s >>> 16) & 0x7fff) / 32767; }
  /** a float in [0, x] */
  float(x: number): number { return x <= 0 ? 0 : this.next() * x; }
  /** `ftol(FUN_004388ae(x))` */
  int(x: number): number { return Math.trunc(this.float(x)); }
}
