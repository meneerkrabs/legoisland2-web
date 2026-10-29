// z15SSH: the engine's "path" objects (GSMS_MI.c `FUN_004476b0`, SplineBase.cpp): a uniform cubic B-spline through the translations of a `.man` file with a
// nearest-point projection. The zone loads six of them (FUN_00659d94: cartpos1 x2, CARBUT x2, SNAKEPOSL, SNAKEPOSR).
//   FUN_004476b0(path)      loads the `.man` (FUN_0043ecd0: the x of each frame's translation is negated), keeps the points, builds the object (FUN_00445340 ->
//                           FUN_00445140 -> FUN_00447340, vtable 0x892268), then FUN_00447280 fills the plane table
//   vtable[1] 0x4466f0      evaluates the curve at t: position, tangent (forward), right, up
//   FUN_00447550            projects a point on the curve (`project`): nearest control point, plane interpolation
//   FUN_004458f0 / 00447800 `project` + the end flag [obj + 0x24]
//   FUN_00447bf0(rec, path) puts the record's rotation on the curve's frame at the projected parameter (position kept) and writes the yaw / pitch (+0x50 / +0x4c)
import { parseMan } from '../../formats/anim.ts';

/** the end flag: the second nearest control point lies in the last three (`N - 4 < second`) */
export const END_MARGIN = 4;
/** _DAT_0089229c: the start value of the nearest-point search */
export const FAR = 1e8;

/** the frame vtable[1] writes (rows of the 4x4: right +0x00, up +0x10, forward +0x20, position +0x30) */
export interface PathFrame { pos: [number, number, number]; right: [number, number, number]; up: [number, number, number]; fwd: [number, number, number] }

const norm = (v: [number, number, number]) => {
  const l = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (l !== 0) { const k = 1 / Math.sqrt(l); v[0] *= k; v[1] *= k; v[2] *= k; }
  return v;
};

export class PathSpline {
  /** the control points (x, y, z) of the `.man` frames (x negated) */
  readonly pts: Float32Array;
  /** number of control points = the header's frame count (obj + 8 / + 0x14) */
  readonly n: number;
  /** FUN_00447280's table: per control point i the tangent at t = i / n (x, y, z) and its dot product with the control point (obj + 4, 16 bytes each) */
  private readonly table: Float32Array;
  /** obj + 0x24: the end flag of the last `project` */
  atEnd = false;
  /** obj + 0x28 / + 0x2c: the segment of the last `project` and the one after it */
  lo = 0; hi = 1;

  constructor(pts: Float32Array, n: number) {
    this.pts = pts; this.n = n;
    this.table = new Float32Array(n * 4);
    const f: PathFrame = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
    for (let i = 0; i < n; i++) {
      this.eval(i / n, f);
      this.table[i * 4] = f.fwd[0]; this.table[i * 4 + 1] = f.fwd[1]; this.table[i * 4 + 2] = f.fwd[2];
      this.table[i * 4 + 3] = f.fwd[0] * pts[i * 3] + f.fwd[1] * pts[i * 3 + 1] + f.fwd[2] * pts[i * 3 + 2];
    }
  }

  /** FUN_004476b0: the `.man` bytes -> path (the island's swifts read the same file format: a missing last frame repeats the previous one) */
  static fromMan(data: Uint8Array): PathSpline {
    const man = parseMan(data);
    const n = man.declaredFrames, tr = man.tracks[0];
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = Math.min(i, man.frameCount - 1) * 9;
      pts[i * 3] = -tr[f + 3]; pts[i * 3 + 1] = tr[f + 4]; pts[i * 3 + 2] = tr[f + 5];
    }
    return new PathSpline(pts, n);
  }

  /** vtable[1] (0x4466f0, FUN_00445680 with mode 1): u = n t, segment i = trunc(u) (clamped), points i-1 .. i+2 clamped; the tangent is the derivative, normalised */
  eval(t: number, out: PathFrame): PathFrame {
    const n = this.n, p = this.pts;
    const u = n * t;
    let i = Math.trunc(u);
    const i0 = Math.max(i - 1, 0);
    if (i >= n) i = n - 1;
    const i2 = Math.min(i + 1, n - 1), i3 = Math.min(i + 2, n - 1);
    const f = u - i, f2 = f * f, f3 = f2 * f;
    // basis rows f^3 / f^2 / f / 1 of the matrix [-1 3 -3 1; 3 -6 3 0; -3 0 3 0; 1 4 1 0] / 6
    const w0 = (-f3 + 3 * f2 - 3 * f + 1) / 6, w1 = (3 * f3 - 6 * f2 + 4) / 6, w2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, w3 = f3 / 6;
    const d0 = (-3 * f2 + 6 * f - 3) / 6, d1 = (9 * f2 - 12 * f) / 6, d2 = (-9 * f2 + 6 * f + 3) / 6, d3 = (3 * f2) / 6;
    const D: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out.pos[k] = w0 * p[i0 * 3 + k] + w1 * p[i * 3 + k] + w2 * p[i2 * 3 + k] + w3 * p[i3 * 3 + k];
      D[k] = d0 * p[i0 * 3 + k] + d1 * p[i * 3 + k] + d2 * p[i2 * 3 + k] + d3 * p[i3 * 3 + k];
    }
    const F = norm(D);
    // right = normalise(F.z, 0, -F.x), up = normalise(right x F)
    const R = norm([F[2], 0, -F[0]]);
    const U = norm([R[2] * F[1] - R[1] * F[2], R[0] * F[2] - R[2] * F[0], R[1] * F[0] - R[0] * F[1]]);
    out.fwd[0] = F[0]; out.fwd[1] = F[1]; out.fwd[2] = F[2];
    out.right[0] = R[0]; out.right[1] = R[1]; out.right[2] = R[2];
    out.up[0] = U[0]; out.up[1] = U[1]; out.up[2] = U[2];
    return out;
  }

  /**
   * FUN_00447550(pos): the parameter t of the curve point nearest to `pos` (and the end flag). The two nearest control points (the search keeps the best and the
   * second best, `< ` ties as in the original), ordered, the second forced to `lo + 1`; t = (lo + d_lo / (d_lo - d_hi)) / n with d = the signed distance of pos
   * from the plane through control point `lo` / `hi` whose normal is the curve's tangent there.
   */
  project(pos: ArrayLike<number>): number {
    const n = this.n, p = this.pts, tb = this.table;
    let best = this.lo, second = this.hi;     // obj + 0x28 / + 0x2c: only their garbage start matters, and the search overwrites both
    let bestD = FAR, secondD = 1e8;
    for (let i = 0; i < n; i++) {
      const dx = p[i * 3] - pos[0], dy = p[i * 3 + 1] - pos[1], dz = p[i * 3 + 2] - pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (bestD <= d2) {
        if (d2 < secondD) { second = i; secondD = d2; }
      } else {
        const old = best; best = i; second = old;
        secondD = bestD; bestD = d2;
      }
    }
    let lo = best, hi = second;
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    if (hi !== lo + 1) hi = lo + 1;
    if (hi >= n) { this.atEnd = true; this.lo = lo; this.hi = hi; return lo / n; }   // (port) the original reads one table row past the end here
    const dLo = tb[lo * 4] * pos[0] + tb[lo * 4 + 2] * pos[2] + tb[lo * 4 + 1] * pos[1] - tb[lo * 4 + 3];
    const dHi = tb[hi * 4] * pos[0] + tb[hi * 4 + 2] * pos[2] + tb[hi * 4 + 1] * pos[1] - tb[hi * 4 + 3];
    this.atEnd = n - END_MARGIN < hi;
    this.lo = lo; this.hi = hi;
    return (dLo / (dHi * -1 + dLo) + lo) / n;
  }
}

/** FUN_00447800(rec): `project` of the record's position (+0x3c) on the path, the end flag */
export function atPathEnd(path: PathSpline, x: number, y: number, z: number): boolean { path.project([x, y, z]); return path.atEnd; }
