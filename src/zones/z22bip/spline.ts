// The path object of z22BIP (the "spline" of the engine's GSMS library, DAT_05cb58a8 / DAT_05d5cc14): a uniform cubic B-spline through the translations of
// `matanim/bippath.man` (60 control points, x negated like FUN_0043ecd0), built by FUN_00707da6 (the point array has 4 more entries than the file: the two
// extrapolated end points and the two runway ends) and registered through FUN_00447680 -> FUN_00445340 -> FUN_00445140 (type 0, vtable 0x892268) -> FUN_00447280.
//   evaluate  at t  : FUN_00446af0 (vtable +0, position + a frame), FUN_004466f0 (vtable +4, position only: the same as src/shell/cutscene.ts `CameraSpline`)
//   nearest point   : FUN_00447550 (called through FUN_004458d0 / FUN_004478d0 / FUN_00447800 / FUN_00445970 with the plane's position)
// Pure TypeScript, no DOM.
import { buildMatrix } from '../../formats/matrix.ts';
import type { Man } from '../../formats/anim.ts';

const f = Math.fround;

/** FUN_00707da6 builds the control points: [0] first record, [1] = (first + second) * 0.5, [2 ..] the records, [n + 2] = (last + runway end) * 0.5, [n + 3] = the second `.src` point of Runwayend (0x89204c = 0.5) */
export const SPLINE_EXTRA = 4;
/** 0x89229c: the "far away" start value of the nearest-point search (float 1e8) */
const FAR = 1e8;

export interface Frame {
  /** row-vector 4x4 (rows: right, up, forward, position) as FUN_00446af0 writes it; row 3 = position */
  m: Float32Array;
  /** the second output of FUN_00446af0 (`local_10` of the callers): the normalised second derivative of the curve (the direction it bends to) */
  normal: [number, number, number];
}

export class BipSpline {
  /** +0x14 / +0x08: number of control points */
  readonly n: number;
  /** +0x18: the control points (x, y, z) */
  readonly pts: Float32Array;
  /** +0x04: one "plane" per point (FUN_00447280): (position of the curve at i / n, that position dotted with control point i) */
  readonly planes: Float32Array;
  /** +0x28 / +0x2c: the two nearest control points of the last query (the lower index first, the second forced to be the next one) */
  idxA = 0; idxB = 1;
  /** +0x24: the last query found the point past the end (index B > n - 4) */
  atEnd = false;
  /** +0x1c: the progress t (0..1) of the last query */
  progress = 0;

  /**
   * FUN_00707da6: the control points = [0] Runwaystart.src vector 0, [1] the mean of [0] and [2], [2 .. m + 1] the `.man` record translations (x negated: the
   * matrix FUN_0043a742 got -x), [m + 2] the mean of [m + 1] and [m + 3], [m + 3] Runwayend.src vector 2 (the 0x89204c = 0.5 factor)
   */
  static fromMan(man: Man, runwayStart: readonly number[], runwayEnd: readonly number[]): BipSpline {
    const m = man.declaredFrames;       // local_8 = the second header word (FUN_0043ecd0 reads tracks x declared records)
    const t = man.tracks[0];
    const n = m + SPLINE_EXTRA;
    const p = new Float32Array(n * 3);
    for (let k = 0; k < 3; k++) p[k] = runwayStart[k];
    for (let i = 0; i < m; i++) { const r = Math.min(i, man.frameCount - 1); p[(i + 2) * 3] = -t[r * 9 + 3]; p[(i + 2) * 3 + 1] = t[r * 9 + 4]; p[(i + 2) * 3 + 2] = t[r * 9 + 5]; }
    for (let k = 0; k < 3; k++) p[(m + 3) * 3 + k] = runwayEnd[k];
    for (let k = 0; k < 3; k++) { p[3 + k] = f(f(p[k] + p[6 + k]) * 0.5); p[(m + 2) * 3 + k] = f(f(p[(m + 1) * 3 + k] + p[(m + 3) * 3 + k]) * 0.5); }
    return new BipSpline(p, n);
  }

  constructor(pts: Float32Array, n: number) {
    this.n = n; this.pts = pts;
    this.planes = new Float32Array(n * 4);
    // FUN_00447280: planes[i] = (forward T of the frame at t = i / n, T . control[i]): the plane through the control point, perpendicular to the path
    for (let i = 0; i < n; i++) {
      const m = this.frame(f(i / n)).m;
      const x = m[8], y = m[9], z = m[10];
      this.planes[i * 4] = x; this.planes[i * 4 + 1] = y; this.planes[i * 4 + 2] = z;
      this.planes[i * 4 + 3] = f(x * pts[i * 3] + y * pts[i * 3 + 1] + z * pts[i * 3 + 2]);
    }
  }

  /** FUN_004466f0: the position at t (uniform cubic B-spline, the indices clamped like FUN_00446af0) */
  sample(t: number, out: [number, number, number] | number[] = [0, 0, 0]): number[] {
    const n = this.n, fl = n * t;
    let i = Math.trunc(fl);
    let a = i - 1, b = i + 1, c = i + 2;
    if (a < 0) a = 0;
    if (i >= n) i = n - 1;
    if (b >= n) b = n - 1;
    if (c >= n) c = n - 1;
    const u = fl - i, u2 = u * u, u3 = u2 * u;
    const w0 = (-u3 + 3 * u2 - 3 * u + 1) / 6, w1 = (3 * u3 - 6 * u2 + 4) / 6, w2 = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6, w3 = u3 / 6;
    const p = this.pts;
    for (let k = 0; k < 3; k++) out[k] = w0 * p[a * 3 + k] + w1 * p[i * 3 + k] + w2 * p[b * 3 + k] + w3 * p[c * 3 + k];
    return out;
  }

  /** FUN_00446af0 (vtable +0, through FUN_00445680 mode 2): position and a frame: right = norm(Tz, 0, -Tx), up = norm(T x right), forward = norm(dP/du) */
  frame(t: number): Frame {
    const n = this.n, fl = n * t;
    let i = Math.trunc(fl);
    let a = i - 1, b = i + 1, c = i + 2;
    if (a < 0) a = 0;
    if (i >= n) i = n - 1;
    if (b >= n) b = n - 1;
    if (c >= n) c = n - 1;
    const u = fl - i, u2 = u * u;
    // derivative weights d/du of the basis: (3u^2 m0 + 2u m1 + m2) per column
    const d0 = (-3 * u2 + 6 * u - 3) / 6, d1 = (9 * u2 - 12 * u) / 6, d2 = (-9 * u2 + 6 * u + 3) / 6, d3 = (3 * u2) / 6;
    const p = this.pts;
    const P: [number, number, number] = [0, 0, 0];
    this.sample(t, P);
    const T = [0, 0, 0], N = [0, 0, 0];
    for (let k = 0; k < 3; k++) T[k] = d0 * p[a * 3 + k] + d1 * p[i * 3 + k] + d2 * p[b * 3 + k] + d3 * p[c * 3 + k];
    // second derivative: (1 - u, 3u - 2, 1 - 3u, u)
    for (let k = 0; k < 3; k++) N[k] = (1 - u) * p[a * 3 + k] + (3 * u - 2) * p[i * 3 + k] + (1 - 3 * u) * p[b * 3 + k] + u * p[c * 3 + k];
    const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); if (l > 0) { v[0] /= l; v[1] /= l; v[2] /= l; } return v; };
    norm(T); norm(N);
    const V = norm([T[2], 0, -T[0]]);
    const U = norm([T[1] * V[2] - T[2] * V[1], T[2] * V[0] - T[0] * V[2], T[0] * V[1] - T[1] * V[0]]);
    const m = new Float32Array(16);
    m[0] = V[0]; m[1] = V[1]; m[2] = V[2];
    m[4] = U[0]; m[5] = U[1]; m[6] = U[2];
    m[8] = T[0]; m[9] = T[1]; m[10] = T[2];
    m[12] = P[0]; m[13] = P[1]; m[14] = P[2]; m[15] = 1;
    return { m, normal: [N[0], N[1], N[2]] };
  }

  /**
   * FUN_00447550: the two nearest control points of `pos` (squared distances; ties keep the earlier point), the lower index first and the second forced to be
   * the next one; progress = ((A . pos - A.w) / ((B . pos - B.w) * -1 + (A . pos - A.w)) + idxA) / n; the "past the end" flag = n - 4 < idxB.
   * Returns the progress (FUN_004478d0 / FUN_004458d0: the value of the x87 stack top).
   */
  nearest(pos: ArrayLike<number>): number {
    const n = this.n, p = this.pts;
    let best = FAR, second = FAR, ia = this.idxA, ib = this.idxB;
    for (let i = 0; i < n; i++) {
      const dx = p[i * 3] - pos[0], dy = p[i * 3 + 1] - pos[1], dz = p[i * 3 + 2] - pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (best <= d2) { if (d2 < second) { ib = i; second = d2; } }
      else { ib = ia; ia = i; second = best; best = d2; }
    }
    if (ib < ia) { const s = ia; ia = ib; ib = s; }
    if (ib !== ia + 1) ib = ia + 1;
    this.idxA = ia; this.idxB = ib;
    const A = this.planes.subarray(ia * 4, ia * 4 + 4), B = this.planes.subarray(ib * 4, ib * 4 + 4);
    const fa = (A[0] * pos[0] + A[2] * pos[2] + A[1] * pos[1]) - A[3];
    const fb = (B[0] * pos[0] + B[2] * pos[2] + B[1] * pos[1]) - B[3];
    this.atEnd = n - 4 < ib;
    this.progress = f((fa / (fb * -1 + fa) + ia) / n);
    return this.progress;
  }
}

/** a matrix with the engine's Euler builder (FUN_0043a5e4), re-exported for the nodes */
export const eulerMatrix = buildMatrix;
