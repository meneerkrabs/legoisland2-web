// The track spline of z20DSP: GSMS "SplineBase.cpp" (docs/re/m6/z20DSP.md section 3). FUN_006bf7cc loads `matanim/car1.man`, takes the translation of every frame
// except the first (FUN_0043ecd0 negates x) and hands the points to FUN_00447680 -> FUN_00445340 -> FUN_00445140 (type 0 curve) + FUN_004458b0 -> FUN_00447280
// (the per-point tangent / plane table). Evaluations: FUN_00445680(path, t, a, b, mode): mode 0 = position (vtable +8 = 0x446fd0), 1 = frame (0x4466f0), 2 =
// frame + second derivative direction (0x446af0). `nearest` = FUN_004478f0 / FUN_00447550. The curve is a uniform cubic B-spline over the points (the basis matrix
// rows (-1 3 -3 1) (3 -6 3 0) (-3 0 3 0) (1 4 1 0) times 0x892288 = 1/6 are on the stack of the three functions), parameter t in 0..1 -> u = t * count.
const SIXTH = 1 / 6;   // DAT_00892288 = 0x3e2aaaab

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

const f32 = Math.fround;

function norm3(v: [number, number, number]) {
  // FUN_0043cec0: scale by 1 / sqrt(len^2) unless the squared length is exactly 0
  const l2 = f32(f32(v[2] * v[2]) + f32(v[1] * v[1]) + f32(v[0] * v[0]));
  if (l2 !== 0) { const k = f32(1 / Math.sqrt(l2)); v[0] = f32(k * v[0]); v[1] = f32(k * v[1]); v[2] = f32(k * v[2]); }
  return v;
}

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

  /** the index window of the four control points for u: [i-1, i, i+1, i+2] clamped to 0..n-1, and the fraction f = u - i (the clamped i) */
  private window(t: number): { i0: number; i1: number; i2: number; i3: number; f: number } {
    const n = this.n;
    const u = f32(f32(n) * f32(t));
    let i = Math.trunc(u);             // __ftol
    let i0 = i - 1, i2 = i + 1, i3 = i + 2;
    if (i0 < 0) i0 = 0;
    if (i >= n) i = n - 1;
    if (i2 >= n) i2 = n - 1;
    if (i3 >= n) i3 = n - 1;
    return { i0, i1: i, i2, i3, f: f32(u - i) };
  }

  /** the four weights of the control points for the polynomial basis (f^3, f^2, f, 1) or its derivatives */
  private weights(f: number, order: 0 | 1 | 2): [number, number, number, number] {
    // M rows (x 1/6): a = (-1 3 -3 1), b = (3 -6 3 0), c = (-3 0 3 0), d = (1 4 1 0); weight_k = f^3 a_k + f^2 b_k + f c_k + d_k
    const A = [-1, 3, -3, 1], Bm = [3, -6, 3, 0], C = [-3, 0, 3, 0], D = [1, 4, 1, 0];
    const f2 = f * f, f3 = f2 * f;
    const w: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const v = order === 0 ? f3 * A[k] + f2 * Bm[k] + f * C[k] + D[k] : order === 1 ? 3 * f2 * A[k] + 2 * f * Bm[k] + C[k] : 6 * f * A[k] + 2 * Bm[k];
      w[k] = v * SIXTH;
    }
    return w;
  }

  private combine(win: { i0: number; i1: number; i2: number; i3: number }, w: [number, number, number, number]): [number, number, number] {
    const P = this.pts, idx = [win.i0, win.i1, win.i2, win.i3];
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += w[k] * P[idx[k] * 3 + c]; out[c] = f32(s); }
    return out;
  }

  /** mode 0 (0x446fd0): position at t */
  position(t: number): [number, number, number] {
    const win = this.window(t);
    return this.combine(win, this.weights(win.f, 0));
  }

  /** mode 1 (0x4466f0) / mode 2 (0x446af0, `second` = true): the frame at t */
  frame(t: number, second = false): Frame {
    const win = this.window(t);
    const T = norm3(this.combine(win, this.weights(win.f, 1)));
    // R = normalise(0 - (-Tz) ... : (Tz, 0, -Tx) as the asm builds it), U = T x R
    const R = norm3([T[2], 0, f32(-T[0])]);
    const U: [number, number, number] = [f32(f32(T[1] * R[2]) - f32(T[2] * R[1])), f32(f32(T[2] * R[0]) - f32(T[0] * R[2])), f32(f32(T[0] * R[1]) - f32(T[1] * R[0]))];
    norm3(U);
    const p = this.combine(win, this.weights(win.f, 0));
    const d2: [number, number, number] = second ? norm3(this.combine(win, this.weights(win.f, 2))) : [0, 0, 0];
    return { r: R, u: U, t: T, p, d2 };
  }

  /** FUN_00447280: the tangent / plane table, one entry per point at t = i / n */
  private build() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const fr = this.frame(f32(i) / f32(n));
      const o = i * 4;
      this.planes[o] = fr.t[0]; this.planes[o + 1] = fr.t[1]; this.planes[o + 2] = fr.t[2];
      this.planes[o + 3] = f32(f32(fr.t[0] * this.pts[i * 3]) + f32(fr.t[1] * this.pts[i * 3 + 1]) + f32(fr.t[2] * this.pts[i * 3 + 2]));
    }
  }

  /** FUN_00447550 (FUN_004478f0 = nearest to a position): the parameter of the point on the path closest to p */
  nearest(p: ArrayLike<number>): number {
    const n = this.n, P = this.pts;
    let best = 1e8, runner = 1e8;                // fVar1 / local_8, both start at DAT_0089229c = 1e8
    let a = this.nearA, b = this.nearB;          // +0x28 / +0x2c keep their values between calls
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - p[0], dy = P[i * 3 + 1] - p[1], dz = P[i * 3 + 2] - p[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (best <= d) {
        if (d < runner) { b = i; runner = d; }
      } else { b = a; a = i; runner = best; best = d; }
    }
    if (b < a) { const t = a; a = b; b = t; }
    if (b !== a + 1) b = a + 1;
    this.nearA = a; this.nearB = b;
    this.nearEnd = b > n - 4;
    const pl = this.planes, o0 = a * 4, o1 = b * 4;
    const d0 = pl[o0] * p[0] + pl[o0 + 2] * p[2] + pl[o0 + 1] * p[1] - pl[o0 + 3];
    const d1 = pl[o1] * p[0] + pl[o1 + 2] * p[2] + pl[o1 + 1] * p[1] - pl[o1 + 3];
    return f32((d0 / (d1 * -1 + d0) + a) / n);
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
