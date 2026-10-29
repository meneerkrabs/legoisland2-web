// The path object of z22BIP (the "spline" of the engine's GSMS library, DAT_05cb58a8 / DAT_05d5cc14): a uniform cubic B-spline through the translations of
// `matanim/bippath.man` (60 control points, x negated like FUN_0043ecd0), built by FUN_00707da6 (the point array has 4 more entries than the file: the two
// extrapolated end points and the two runway ends) and registered through FUN_00447680 -> FUN_00445340 -> FUN_00445140 (type 0, vtable 0x892268) -> FUN_00447280.
//   evaluate  at t  : FUN_00446af0 (vtable +0, position + a frame), FUN_004466f0 (vtable +4, position only: the same as src/shell/cutscene.ts `CameraSpline`)
//   nearest point   : FUN_00447550 (called through FUN_004458d0 / FUN_004478d0 / FUN_00447800 / FUN_00445970 with the plane's position)
// Pure TypeScript, no DOM.
import { buildMatrix } from '../../formats/matrix.ts';
import type { Man } from '../../formats/anim.ts';
import { normalise3 } from '../exact.ts';

const f = Math.fround;
/** the basis words of FUN_00446af0 (its stack frame, offsets 0x3c .. 0x78): the cubic B-spline rows times 1/6 (the float 0x892288), each product a float32 */
const BASIS = [-1, 3, -3, 1, 3, -6, 3, 0, -3, 0, 3, 0, 1, 4, 1, 0].map((v) => f(v * f(1 / 6)));
const [b3c, b40, b44, b48, b4c, b50, b54, b58, b5c, b60, b64, b68, b6c, b70, b74, b78] = BASIS;
/** the same words by index (FUN_004466f0 keeps them at stack offset 0x34 + 4 k) */
const [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15] = BASIS;

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
      this.planes[i * 4 + 3] = f(f(f(z * pts[i * 3 + 2]) + f(y * pts[i * 3 + 1])) + f(x * pts[i * 3]));       // 24-bit x87: z, y, then x
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

  /**
   * FUN_00446af0 (vtable +0, through FUN_00445680 mode 2): position and a frame: right = norm(Tz, 0, -Tx), up = norm(T x right), forward = norm(dP/du), `normal` = norm(d2P/du2).
   * Transliterated from the code with the x87 in 24-bit mode (control word 0x7f: every + - * result is a float32, the terms are added in the order of the instructions). `bAAAA` are
   * the basis words at stack offset 0xAAAA of the original: the rows (-1 3 -3 1) (3 -6 3 0) (-3 0 3 0) (1 4 1 0) times 1/6 (0x892288) stored as float32.
   */
  frame(t: number): Frame {
    const n = this.n, p = this.pts;
    const fl = f(n * f(t));                                   // fild n; fmul t
    let i = Math.trunc(fl);                                   // __ftol of a copy
    let a = i - 1, b = i + 1, c = i + 2;
    if (a < 0) a = 0;
    if (i >= n) i = n - 1;
    if (b >= n) b = n - 1;
    if (c >= n) c = n - 1;
    const u = f(fl - i), u2 = f(u * u), u3 = f(u2 * u);
    const Pa = a * 3, Pi = i * 3, Pb = b * 3, Pc = c * 3;
    // the position weights: slots 0x10 (control a), 0x14 (i), 0x20 (b) and the x87 stack (c)
    const w10 = f(f(f(f(u * b5c) + f(u2 * b4c)) + f(u3 * b3c)) + b6c);
    const w20 = f(f(f(f(u * b64) + f(u2 * b54)) + f(u3 * b44)) + b74);
    const w14 = f(f(f(f(u * b60) + f(u2 * b50)) + f(u3 * b40)) + b70);
    const w3 = f(f(f(f(u * b68) + f(u2 * b58)) + f(u3 * b48)) + b78);
    const Px = f(f(f(f(w20 * p[Pb]) + f(w14 * p[Pi])) + f(w10 * p[Pa])) + f(w3 * p[Pc]));
    const Py = f(f(f(f(w3 * p[Pc + 1]) + f(w14 * p[Pi + 1])) + f(w10 * p[Pa + 1])) + f(w20 * p[Pb + 1]));
    const Pz = f(f(f(f(w20 * p[Pb + 2]) + f(w3 * p[Pc + 2])) + f(w14 * p[Pi + 2])) + f(w10 * p[Pa + 2]));
    // the first derivative weights (2u, 3u^2)
    const tu = f(u + u), t3 = f(u2 * 3);
    const d14 = f(f(f(tu * b4c) + f(t3 * b3c)) + b5c);        // control a
    const d10 = f(f(f(tu * b58) + f(t3 * b48)) + b68);        // control c
    const d18 = f(f(f(tu * b54) + f(t3 * b44)) + b64);        // control b
    const dd = f(f(f(tu * b50) + f(t3 * b40)) + b60);         // control i
    const T = [
      f(f(f(f(d14 * p[Pa]) + f(d18 * p[Pb])) + f(d10 * p[Pc])) + f(dd * p[Pi])),
      f(f(f(f(dd * p[Pi + 1]) + f(d10 * p[Pc + 1])) + f(d14 * p[Pa + 1])) + f(d18 * p[Pb + 1])),
      f(f(f(f(dd * p[Pi + 2]) + f(d10 * p[Pc + 2])) + f(d14 * p[Pa + 2])) + f(d18 * p[Pb + 2])),
    ];
    normalise3(T);
    const V = [f(0 - f(T[2] * -1)), 0, f(f(T[0] * -1) - 0)];
    normalise3(V);
    const U = [f(f(V[2] * T[1]) - f(V[1] * T[2])), f(f(V[0] * T[2]) - f(V[2] * T[0])), f(f(V[1] * T[0]) - f(V[0] * T[1]))];
    normalise3(U);
    const m = new Float32Array(16);
    m[0] = V[0]; m[1] = V[1]; m[2] = V[2];
    m[4] = U[0]; m[5] = U[1]; m[6] = U[2];
    m[8] = T[0]; m[9] = T[1]; m[10] = T[2];
    m[12] = Px; m[13] = Py; m[14] = Pz; m[15] = 1;
    // the second derivative (6u and the constants 2 * b)
    const s6 = f(u * 6);
    const N0 = f(f(s6 * b40) + 2 * b50), N1 = f(f(s6 * b3c) + 2 * b4c), N2 = f(f(s6 * b48) + 2 * b58), N3 = f(f(s6 * b44) + 2 * b54);
    const N = [
      f(f(f(f(N3 * p[Pb]) + f(N0 * p[Pi])) + f(N2 * p[Pc])) + f(N1 * p[Pa])),
      f(f(f(f(N1 * p[Pa + 1]) + f(N3 * p[Pb + 1])) + f(N2 * p[Pc + 1])) + f(N0 * p[Pi + 1])),
      f(f(f(f(N2 * p[Pc + 2]) + f(N0 * p[Pi + 2])) + f(N3 * p[Pb + 2])) + f(N1 * p[Pa + 2])),
    ];
    normalise3(N);
    return { m, normal: [N[0], N[1], N[2]] };
  }

  /**
   * FUN_004466f0 (vtable +4, through FUN_00445660; the plane's "course ahead" and the crash recovery): the same frame matrix as `frame`, without the second output, but built with a
   * different order of the additions (transliterated like `frame`; 24-bit x87). Row 3 = position; m[15] is not written by the original (1 here).
   */
  frameB(t: number): Float32Array {
    const n = this.n, p = this.pts;
    const fl = f(n * f(t));
    let i = Math.trunc(fl);
    let a = i - 1, b = i + 1, c = i + 2;
    if (a < 0) a = 0;
    if (i >= n) i = n - 1;
    if (b >= n) b = n - 1;
    if (c >= n) c = n - 1;
    const u = f(fl - i), u2 = f(u * u), u3 = f(u2 * u);
    const Pa = a * 3, Pi = i * 3, Pb = b * 3, Pc = c * 3;
    const W30 = f(f(f(f(u * b9) + f(u2 * b5)) + f(u3 * b1)) + b13);     // control i
    const W14 = f(f(f(f(u * b11) + f(u2 * b7)) + f(u3 * b3)) + b15);    // control c
    const W10 = f(f(f(f(u * b8) + f(u2 * b4)) + f(u3 * b0)) + b12);     // control a
    const W3 = f(f(f(f(u * b10) + f(u2 * b6)) + f(u3 * b2)) + b14);     // control b
    const Px = f(f(f(f(W10 * p[Pa]) + f(W14 * p[Pc])) + f(W3 * p[Pb])) + f(W30 * p[Pi]));
    const Py = f(f(f(f(W3 * p[Pb + 1]) + f(W10 * p[Pa + 1])) + f(W14 * p[Pc + 1])) + f(W30 * p[Pi + 1]));
    const Pz = f(f(f(f(W30 * p[Pi + 2]) + f(W3 * p[Pb + 2])) + f(W10 * p[Pa + 2])) + f(W14 * p[Pc + 2]));
    const tu = f(u + u), t3 = f(u2 * 3);
    const D10 = f(f(f(tu * b5) + f(t3 * b1)) + b9);       // control i
    const D14 = f(f(f(tu * b4) + f(t3 * b0)) + b8);       // control a
    const D0c = f(f(f(tu * b7) + f(t3 * b3)) + b11);      // control c
    const D3 = f(f(f(tu * b6) + f(t3 * b2)) + b10);       // control b
    const T = [
      f(f(f(f(D0c * p[Pc]) + f(D3 * p[Pb])) + f(D10 * p[Pi])) + f(D14 * p[Pa])),
      f(f(f(f(D3 * p[Pb + 1]) + f(D14 * p[Pa + 1])) + f(D10 * p[Pi + 1])) + f(D0c * p[Pc + 1])),
      f(f(f(f(D0c * p[Pc + 2]) + f(D3 * p[Pb + 2])) + f(D14 * p[Pa + 2])) + f(D10 * p[Pi + 2])),
    ];
    normalise3(T);
    const V = [f(0 - f(T[2] * -1)), 0, f(f(T[0] * -1) - 0)];
    normalise3(V);
    const U = [f(f(V[2] * T[1]) - f(V[1] * T[2])), f(f(V[0] * T[2]) - f(V[2] * T[0])), f(f(V[1] * T[0]) - f(V[0] * T[1]))];
    normalise3(U);
    const m = new Float32Array(16);
    m[0] = V[0]; m[1] = V[1]; m[2] = V[2];
    m[4] = U[0]; m[5] = U[1]; m[6] = U[2];
    m[8] = T[0]; m[9] = T[1]; m[10] = T[2];
    m[12] = Px; m[13] = Py; m[14] = Pz; m[15] = 1;
    return m;
  }

  /**
   * FUN_00447550: the two nearest control points of `pos` (squared distances; ties keep the earlier point), the lower index first and the second forced to be
   * the next one; progress = ((A . pos - A.w) / ((B . pos - B.w) * -1 + (A . pos - A.w)) + idxA) / n; the "past the end" flag = n - 4 < idxB.
   * Returns the progress (FUN_004478d0 / FUN_004458d0: the value of the x87 stack top, i.e. NOT rounded to float32; `progress` holds the float32 copy).
   */
  nearest(pos: ArrayLike<number>): number {
    const n = this.n, p = this.pts;
    const px = f(pos[0]), py = f(pos[1]), pz = f(pos[2]);
    let best = FAR, second = FAR, ia = this.idxA, ib = this.idxB;
    for (let i = 0; i < n; i++) {
      // 24-bit x87: each difference and product / sum is a float32; the squares are added z, y, then x
      const dx = f(p[i * 3] - px), dy = f(p[i * 3 + 1] - py), dz = f(p[i * 3 + 2] - pz);
      const d2 = f(f(f(dz * dz) + f(dy * dy)) + f(dx * dx));
      if (best <= d2) { if (d2 < second) { ib = i; second = d2; } }
      else { ib = ia; ia = i; second = best; best = d2; }
    }
    if (ib < ia) { const s = ia; ia = ib; ib = s; }
    if (ib !== ia + 1) ib = ia + 1;
    this.idxA = ia; this.idxB = ib;
    const A = this.planes.subarray(ia * 4, ia * 4 + 4), B = this.planes.subarray(ib * 4, ib * 4 + 4);
    const fa = f(f(f(f(A[1] * py) + f(A[2] * pz)) + f(A[0] * px)) - A[3]);
    const fb = f(f(f(f(B[1] * py) + f(B[2] * pz)) + f(B[0] * px)) - B[3]);
    this.atEnd = n - 4 < ib;
    const t = f(f(f(fa / f(f(fb * -1) + fa)) + ia) / n);
    this.progress = t;
    return t;                 // `fst dword [+0x1c]` keeps the register: a float32 value in 24-bit mode
  }
}

/** a matrix with the engine's Euler builder (FUN_0043a5e4), re-exported for the nodes */
export const eulerMatrix = buildMatrix;
