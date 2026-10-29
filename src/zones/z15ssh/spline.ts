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

const fr = Math.fround;
// The x87 runs in 24-bit precision (Direct3D 7, control word 0x7f): every +, -, *, / and sqrt result is rounded to a float32 (docs/re/engine-m1.md "Differential test").
const ad = (x: number, y: number) => fr(x + y), sb = (x: number, y: number) => fr(x - y), ml = (x: number, y: number) => fr(x * y), dv = (x: number, y: number) => fr(x / y);
/** FUN_0043cec0(v): normalise in place with float32 stores: len2 = f32(x*x + y*y + z*z) (summed in that order), k = f32(1 / sqrt(len2)), v = f32(k * v); a zero length changes nothing */
const norm = (v: [number, number, number]) => {
  const l = ad(ad(ml(v[0], v[0]), ml(v[1], v[1])), ml(v[2], v[2]));
  if (l !== 0) { const k = dv(1, fr(Math.sqrt(l))); v[0] = ml(k, v[0]); v[1] = ml(k, v[1]); v[2] = ml(k, v[2]); }
  return v;
};
/**
 * The basis matrix of vtable[1] (0x4466f0 / 0x446af0): the rows (f^3, f^2, f, 1) of [-1 3 -3 1; 3 -6 3 0; -3 0 3 0; 1 4 1 0] each scaled by _DAT_00892288 (0x3e2aaaab, 1/6 as a
 * float32) and stored as float32 (the loop at 0x446789). Everything below follows the order of the x87 operations of the original, so that the float32 stores (the weights,
 * the tangent, the frame) land at the same places: the points are absolute coordinates up to 8000, the sums cancel, and a different order gives errors around 1e-5.
 */
const BASIS = [-1, 3, -3, 1, 3, -6, 3, 0, -3, 0, 3, 0, 1, 4, 1, 0].map((v) => fr(v * fr(new Float32Array(new Uint32Array([0x3e2aaaab]).buffer)[0])));

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
      this.eval(fr(i / n), f);                    // FUN_00447280: the argument is float32(i / n) (fidiv + fstp dword)
      this.table[i * 4] = f.fwd[0]; this.table[i * 4 + 1] = f.fwd[1]; this.table[i * 4 + 2] = f.fwd[2];
      // the dot product is summed z, y, x (0x447305 .. 0x44731b) and stored as float32
      this.table[i * 4 + 3] = ad(ad(ml(f.fwd[2], pts[i * 3 + 2]), ml(f.fwd[1], pts[i * 3 + 1])), ml(f.fwd[0], pts[i * 3]));
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

  /**
   * vtable[1] (0x4466f0, FUN_00445680 with mode 1): t is a float32 argument, u = n t, segment i = ftol(u) (clamped), points i-1 .. i+2 clamped; the weights w0 / w1 / w3 and the
   * derivative weights d0 / d1 / d3 are stored as float32, w2 / d2 stay in the register (double); the tangent D is stored as float32, normalised (FUN_0043cec0), right =
   * normalise(Fz, 0, -Fx), up = normalise(R x F) with the products in double and float32 stores; the frame is written as float32 (the position too).
   */
  eval(t: number, out: PathFrame): PathFrame {
    const n = this.n, p = this.pts, M = BASIS;
    const u = ml(n, t);
    let i = Math.trunc(u);
    let i0 = i - 1, i1 = i + 1, i2 = i + 2;
    if (i0 < 0) i0 = 0;
    if (i >= n) i = n - 1;
    if (i1 >= n) i1 = n - 1;
    if (i2 >= n) i2 = n - 1;
    const f = sb(u, i);
    const f2 = ml(f, f), f3 = ml(f2, f);
    const w1 = ad(ad(ad(ml(f, M[9]), ml(f2, M[5])), ml(f3, M[1])), M[13]);
    const w3 = ad(ad(ad(ml(f, M[11]), ml(f2, M[7])), ml(f3, M[3])), M[15]);
    const w0 = ad(ad(ad(ml(f, M[8]), ml(f2, M[4])), ml(f3, M[0])), M[12]);
    const w2 = ad(ad(ad(ml(f, M[10]), ml(f2, M[6])), ml(f3, M[2])), M[14]);
    const a = i0 * 3, b = i * 3, c = i1 * 3, d = i2 * 3;           // p0 (ecx), p1 (eax), p2 (edx), p3 (esi)
    out.pos[0] = ad(ad(ad(ml(w0, p[a]), ml(w3, p[d])), ml(w2, p[c])), ml(w1, p[b]));
    out.pos[1] = ad(ad(ad(ml(w2, p[c + 1]), ml(w0, p[a + 1])), ml(w3, p[d + 1])), ml(w1, p[b + 1]));
    out.pos[2] = ad(ad(ad(ml(w1, p[b + 2]), ml(w2, p[c + 2])), ml(w0, p[a + 2])), ml(w3, p[d + 2]));
    const f2x = ad(f, f), T3 = ml(f2, 3);
    const d1 = ad(ad(ml(f2x, M[5]), ml(T3, M[1])), M[9]);
    const d0 = ad(ad(ml(f2x, M[4]), ml(T3, M[0])), M[8]);
    const d3 = ad(ad(ml(f2x, M[7]), ml(T3, M[3])), M[11]);
    const d2 = ad(ad(ml(f2x, M[6]), ml(T3, M[2])), M[10]);
    const F: [number, number, number] = [
      ad(ad(ad(ml(d3, p[d]), ml(d2, p[c])), ml(d1, p[b])), ml(d0, p[a])),
      ad(ad(ad(ml(d2, p[c + 1]), ml(d0, p[a + 1])), ml(d1, p[b + 1])), ml(d3, p[d + 1])),
      ad(ad(ad(ml(d3, p[d + 2]), ml(d2, p[c + 2])), ml(d0, p[a + 2])), ml(d1, p[b + 2])),
    ];
    norm(F);
    // right = (0 - (-Fz), 0, -Fx - 0) normalised (0x4469cd .. 0x446a02); up = normalise(R x F) with float32 stores (0x446a07 .. 0x446a57)
    const R: [number, number, number] = [0 - (-F[2]), 0, -F[0] - 0];
    norm(R);
    const U: [number, number, number] = [sb(ml(R[2], F[1]), ml(R[1], F[2])), sb(ml(R[0], F[2]), ml(R[2], F[0])), sb(ml(R[1], F[0]), ml(R[0], F[1]))];
    norm(U);
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
      const dx = sb(p[i * 3], pos[0]), dy = sb(p[i * 3 + 1], pos[1]), dz = sb(p[i * 3 + 2], pos[2]);
      // 0x447588 .. 0x447598: dx, dy, dz stay in the register (exact), d2 = dx*dx + (dy*dy + dz*dz) stored as float32
      const d2 = ad(ml(dx, dx), ad(ml(dy, dy), ml(dz, dz)));
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
    // the signed plane distances stay in the register: (y + z) + x - dot, in this order (0x447618 .. 0x44764f)
    const dLo = sb(ad(ad(ml(tb[lo * 4 + 1], pos[1]), ml(tb[lo * 4 + 2], pos[2])), ml(tb[lo * 4], pos[0])), tb[lo * 4 + 3]);
    const dHi = sb(ad(ad(ml(tb[hi * 4 + 1], pos[1]), ml(tb[hi * 4 + 2], pos[2])), ml(tb[hi * 4], pos[0])), tb[hi * 4 + 3]);
    this.atEnd = n - END_MARGIN < hi;
    this.lo = lo; this.hi = hi;
    return dv(ad(dv(dLo, ad(ml(dHi, -1), dLo)), lo), n);
  }
}

/** FUN_00447800(rec): `project` of the record's position (+0x3c) on the path, the end flag */
export function atPathEnd(path: PathSpline, x: number, y: number, z: number): boolean { path.project([x, y, z]); return path.atEnd; }
