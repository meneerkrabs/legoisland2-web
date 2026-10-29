// The track spline of z20DSP: GSMS "SplineBase.cpp" (docs/re/m6/z20DSP.md section 3). FUN_006bf7cc loads `matanim/car1.man`, takes the translation of every frame
// except the first (FUN_0043ecd0 negates x) and hands the points to FUN_00447680 -> FUN_00445340 -> FUN_00445140 (type 0 curve) + FUN_004458b0 -> FUN_00447280
// (the per-point tangent / plane table). Evaluations: FUN_00445680(path, t, a, b, mode): mode 0 = position (vtable +8 = 0x446fd0), 1 = frame (0x4466f0), 2 =
// frame + second derivative direction (0x446af0). `nearest` = FUN_004478f0 / FUN_00447550. The curve is a uniform cubic B-spline over the points (the basis matrix
// rows (-1 3 -3 1) (3 -6 3 0) (-3 0 3 0) (1 4 1 0) times 0x892288 = 1/6 are on the stack of the three functions), parameter t in 0..1 -> u = t * count.
const f32 = Math.fround;
/** DAT_00892288 = 0x3e2aaaab: the basis matrix is stored (on the stack of every evaluation) as its integer rows times this float, each product rounded */
const SIXTH = f32(1 / 6);
/** K[i] = float(M[i] * DAT_00892288): M rows (-1 3 -3 1) (3 -6 3 0) (-3 0 3 0) (1 4 1 0), element 4 r + c */
const K = [-1, 3, -3, 1, 3, -6, 3, 0, -3, 0, 3, 0, 1, 4, 1, 0].map((m) => f32(m * SIXTH));
/** _DAT_00892200 = 3.0, _DAT_0089228c = 6.0 (floats) */
const THREE = 3, SIX = 6;

export interface Frame {
  /** row 0: horizontal right vector R = normalise((Tz, 0, -Tx)) */
  r: [number, number, number];
  /** row 1: up U = T x R */
  u: [number, number, number];
  /** row 2: unit tangent T */
  t: [number, number, number];
  /** row 3: position */
  p: [number, number, number];
  /** mode 2 only: direction of the second derivative (normalised, 0 when it vanishes) */
  d2: [number, number, number];
}

/** FUN_0043cec0 (24-bit x87): v / |v| with l = ((x x + y y) + z z) stored as a float, k = float(1 / float(sqrt(l))), v = float(k v); a zero length leaves v alone */
function norm3(v: [number, number, number]) {
  const l = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]));
  if (l !== 0) { const k = f32(1 / f32(Math.sqrt(l))); v[0] = f32(k * v[0]); v[1] = f32(k * v[1]); v[2] = f32(k * v[2]); }
  return v;
}

/** the four control points of a window and the fraction: FUN_00446fd0 / 004466f0 / 00446af0 prologues (index = ftol(float(n) * t), clamps to 0..n-1, f = float(u - index)) */
interface Win { im: number; i0: number; i1: number; i2: number; f: number }

export class TrackSpline {
  /** control points, x y z per point (float32) */
  readonly pts: Float32Array;
  /** number of points (the original's `count`, +0x14) */
  readonly n: number;
  /** per point: tangent (x, y, z) and tangent . point (FUN_00447280), the planes `nearest` uses */
  readonly planes: Float32Array;
  /** `nearest` state: +0x24 (the second index is beyond count - 4), +0x28 / +0x2c (the two nearest points) */
  nearEnd = false; nearA = 0; nearB = 0;

  constructor(points: ArrayLike<number>) {
    this.pts = Float32Array.from(points);
    this.n = (this.pts.length / 3) | 0;
    this.planes = new Float32Array(this.n * 4);
    this.build();
  }

  /** indices of the points i-1, i, i+1, i+2 (the asm clamps the first below at 0, the other three at n - 1; `i` is clamped before the fraction is taken) and the fraction */
  private window(t: number): Win {
    const n = this.n;
    const u = f32(f32(n) * f32(t));
    let i = Math.trunc(u);             // __ftol (FUN_0085c920)
    let im = i - 1, i1 = i + 1, i2 = i + 2;
    if (im < 0) im = 0;
    if (i >= n) i = n - 1;
    if (i1 >= n) i1 = n - 1;
    if (i2 >= n) i2 = n - 1;
    return { im, i0: i, i1, i2, f: f32(u - i) };
  }

  /** the position weights w[i-1], w[i], w[i+1], w[i+2]: ((f K[a] + f2 K[b]) + f3 K[c]) + K[d] with f2 = float(f f), f3 = float(f2 f) */
  private static posWeights(f: number): [number, number, number, number] {
    const f2 = f32(f * f), f3 = f32(f2 * f);
    const w = (a: number, b: number, c: number, d: number) => f32(f32(f32(f32(f * K[a]) + f32(f2 * K[b])) + f32(f3 * K[c])) + K[d]);
    return [w(8, 4, 0, 12), w(9, 5, 1, 13), w(10, 6, 2, 14), w(11, 7, 3, 15)];
  }

  /** the tangent weights: ((2 f K[a] + 3 f2 K[b]) + K[c]) */
  private static tanWeights(f: number): [number, number, number, number] {
    const f2 = f32(f * f), f2f = f32(f + f), s = f32(f2 * THREE);
    const w = (a: number, b: number, c: number) => f32(f32(f32(f2f * K[a]) + f32(s * K[b])) + K[c]);
    return [w(4, 0, 8), w(5, 1, 9), w(6, 2, 10), w(7, 3, 11)];
  }

  /** the second derivative weights: float(6 f K[a]) + float(K[b] + K[b]) (mode 2) */
  private static secWeights(f: number): [number, number, number, number] {
    const f6 = f32(f * SIX);
    const w = (a: number, b: number) => f32(f32(f6 * K[a]) + f32(K[b] + K[b]));
    return [w(0, 4), w(1, 5), w(2, 6), w(3, 7)];
  }

  /** mode 0 (0x446fd0): position at t. Sum orders of the asm: x (i+1, i, i-1, i+2), y and z (i+1, i-1, i+2, i) */
  position(t: number): [number, number, number] {
    const win = this.window(t), w = TrackSpline.posWeights(win.f), P = this.pts;
    const im = win.im * 3, i0 = win.i0 * 3, i1 = win.i1 * 3, i2 = win.i2 * 3;
    const x = f32(f32(f32(f32(w[2] * P[i1]) + f32(w[1] * P[i0])) + f32(w[0] * P[im])) + f32(w[3] * P[i2]));
    const y = f32(f32(f32(f32(w[2] * P[i1 + 1]) + f32(w[0] * P[im + 1])) + f32(w[3] * P[i2 + 1])) + f32(w[1] * P[i0 + 1]));
    const z = f32(f32(f32(f32(w[2] * P[i1 + 2]) + f32(w[0] * P[im + 2])) + f32(w[3] * P[i2 + 2])) + f32(w[1] * P[i0 + 2]));
    return [x, y, z];
  }

  /** mode 1 (0x4466f0) / mode 2 (0x446af0, `second` = true): the frame at t */
  frame(t: number, second = false): Frame {
    const win = this.window(t), P = this.pts;
    const im = win.im * 3, i0 = win.i0 * 3, i1 = win.i1 * 3, i2 = win.i2 * 3;
    const w = TrackSpline.posWeights(win.f), v = TrackSpline.tanWeights(win.f);
    let p: [number, number, number], T: [number, number, number];
    if (!second) {
      // 0x4466f0: the position sums run x (i-1, i+2, i+1, i), y (i+1, i-1, i+2, i), z (i, i+1, i-1, i+2); the tangent x (i+2, i+1, i, i-1), y (i+1, i-1, i, i+2), z (i+2, i+1, i-1, i)
      p = [
        f32(f32(f32(f32(w[0] * P[im]) + f32(w[3] * P[i2])) + f32(w[2] * P[i1])) + f32(w[1] * P[i0])),
        f32(f32(f32(f32(w[2] * P[i1 + 1]) + f32(w[0] * P[im + 1])) + f32(w[3] * P[i2 + 1])) + f32(w[1] * P[i0 + 1])),
        f32(f32(f32(f32(w[1] * P[i0 + 2]) + f32(w[2] * P[i1 + 2])) + f32(w[0] * P[im + 2])) + f32(w[3] * P[i2 + 2]))];
      T = [
        f32(f32(f32(f32(v[3] * P[i2]) + f32(v[2] * P[i1])) + f32(v[1] * P[i0])) + f32(v[0] * P[im])),
        f32(f32(f32(f32(v[2] * P[i1 + 1]) + f32(v[0] * P[im + 1])) + f32(v[1] * P[i0 + 1])) + f32(v[3] * P[i2 + 1])),
        f32(f32(f32(f32(v[3] * P[i2 + 2]) + f32(v[2] * P[i1 + 2])) + f32(v[0] * P[im + 2])) + f32(v[1] * P[i0 + 2]))];
    } else {
      // 0x446af0: the position sums run x (i+1, i, i-1, i+2), y (i+2, i, i-1, i+1), z (i+1, i+2, i, i-1); the tangent x (i-1, i+1, i+2, i), y (i, i+2, i-1, i+1), z (i, i+2, i-1, i+1)
      p = [
        f32(f32(f32(f32(w[2] * P[i1]) + f32(w[1] * P[i0])) + f32(w[0] * P[im])) + f32(w[3] * P[i2])),
        f32(f32(f32(f32(w[3] * P[i2 + 1]) + f32(w[1] * P[i0 + 1])) + f32(w[0] * P[im + 1])) + f32(w[2] * P[i1 + 1])),
        f32(f32(f32(f32(w[2] * P[i1 + 2]) + f32(w[3] * P[i2 + 2])) + f32(w[1] * P[i0 + 2])) + f32(w[0] * P[im + 2]))];
      T = [
        f32(f32(f32(f32(v[0] * P[im]) + f32(v[2] * P[i1])) + f32(v[3] * P[i2])) + f32(v[1] * P[i0])),
        f32(f32(f32(f32(v[1] * P[i0 + 1]) + f32(v[3] * P[i2 + 1])) + f32(v[0] * P[im + 1])) + f32(v[2] * P[i1 + 1])),
        f32(f32(f32(f32(v[1] * P[i0 + 2]) + f32(v[3] * P[i2 + 2])) + f32(v[0] * P[im + 2])) + f32(v[2] * P[i1 + 2]))];
    }
    norm3(T);
    // R = normalise((0 - (-Tz), 0, -Tx - 0)), U = normalise(T x R)
    const R = norm3([f32(0 - f32(T[2] * -1)), 0, f32(f32(T[0] * -1) - 0)]);
    const U: [number, number, number] = [f32(f32(T[1] * R[2]) - f32(T[2] * R[1])), f32(f32(T[2] * R[0]) - f32(T[0] * R[2])), f32(f32(T[0] * R[1]) - f32(T[1] * R[0]))];
    norm3(U);
    let d2: [number, number, number] = [0, 0, 0];
    if (second) {
      const s = TrackSpline.secWeights(win.f);
      d2 = [
        f32(f32(f32(f32(s[2] * P[i1]) + f32(s[1] * P[i0])) + f32(s[3] * P[i2])) + f32(s[0] * P[im])),
        f32(f32(f32(f32(s[0] * P[im + 1]) + f32(s[2] * P[i1 + 1])) + f32(s[3] * P[i2 + 1])) + f32(s[1] * P[i0 + 1])),
        f32(f32(f32(f32(s[3] * P[i2 + 2]) + f32(s[1] * P[i0 + 2])) + f32(s[2] * P[i1 + 2])) + f32(s[0] * P[im + 2]))];
      norm3(d2);
    }
    return { r: R, u: U, t: T, p, d2 };
  }

  /** FUN_00447280: the tangent / plane table, one entry per point at t = float(i) / n: the unit tangent and ((Tz pz + Ty py) + Tx px) */
  private build() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const fr = this.frame(f32(i / n));
      const o = i * 4, q = i * 3;
      this.planes[o] = fr.t[0]; this.planes[o + 1] = fr.t[1]; this.planes[o + 2] = fr.t[2];
      this.planes[o + 3] = f32(f32(f32(fr.t[2] * this.pts[q + 2]) + f32(fr.t[1] * this.pts[q + 1])) + f32(fr.t[0] * this.pts[q]));
    }
  }

  /** FUN_00447550 (FUN_004478f0 = nearest to a position): the parameter of the point on the path closest to p; d = (dz^2 + dy^2) + dx^2 stored as a float */
  nearest(p: ArrayLike<number>): number {
    const n = this.n, P = this.pts;
    let best = 1e8, runner = 1e8;                // the FPU stack's `best` and local_8, both start at DAT_0089229c = 1e8
    let a = this.nearA, b = this.nearB;          // +0x28 / +0x2c keep their values between calls
    for (let i = 0; i < n; i++) {
      const dx = f32(P[i * 3] - p[0]), dy = f32(P[i * 3 + 1] - p[1]), dz = f32(P[i * 3 + 2] - p[2]);
      const d = f32(f32(f32(dz * dz) + f32(dy * dy)) + f32(dx * dx));
      if (!(d < best)) {
        if (d < runner) { b = i; runner = d; }
      } else { b = a; a = i; runner = best; best = d; }
    }
    if (b < a) { const t = a; a = b; b = t; }
    if (b !== a + 1) b = a + 1;
    this.nearA = a; this.nearB = b;
    this.nearEnd = b > n - 4;
    const pl = this.planes, o0 = a * 4, o1 = b * 4;
    // ((Ty py + Tz pz) + Tx px) - w, per plane
    const dist = (o: number) => f32(f32(f32(f32(pl[o + 1] * p[1]) + f32(pl[o + 2] * p[2])) + f32(pl[o] * p[0])) - pl[o + 3]);
    const d0 = dist(o0), d1 = dist(o1);
    return f32(f32(f32(d0 / f32(f32(d1 * -1) + d0)) + a) / n);
  }
}

/** the track of z20DSP from `matanim/car1.man`: the translation of frames 1..count-1 with x negated (FUN_0043ecd0: `-tx`), FUN_006bf7cc */
export function trackPoints(man: { frameCount: number; declaredFrames: number; tracks: Float32Array[] }): Float32Array {
  const d = man.tracks[0];
  const count = man.declaredFrames;   // the loader's `count` (header word 2); car1.man stores every frame
  const n = Math.min(count, man.frameCount) - 1;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = i + 1;
    out[i * 3] = -d[f * 9 + 3]; out[i * 3 + 1] = d[f * 9 + 4]; out[i * 3 + 2] = d[f * 9 + 5];
  }
  return out;
}
