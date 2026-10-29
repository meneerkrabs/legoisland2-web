// Section 4 "Camera en tekenen", part 1: the original's free-fly camera, ported store by store from the executable (pure logic, no DOM, importable in node).
//
//   FUN_0088fd70(view, camera)   the camera (asm 0x88fd70 .. 0x88fff0), wrapper FUN_00890000 = FUN_0088fd70(local, &DAT_009da5e8)
//   FUN_0043a340                 Euler angles -> 4x4 matrix (asm 0x43a340): the "cos" / "sin" calls are FUN_0085d374 / FUN_0085d1c4 (the decompile's fVar1 .. fVar6)
//   FUN_0043a9e5                 4x4 matrix product (asm 0x43a9e5)
//   FUN_0043cc5c                 the view basis of the camera (-> FUN_004165a5 look-at): the 9 floats camera[9..17] (see `viewBasis`)
// Call sites in the original (all compiled out: the three flags are never written, the fourth is a local that is only ever 0): 0x6be13d z20DSP (DAT_05d5c0bc), 0x6f37c6 z21FSH (DAT_05d5c3d4),
// 0x706e0e z22BIP (DAT_05d5cbd8), 0x656b47 z15SSH. The state lives at DAT_00982d28.. (position, pitch, yaw, matrix); its start values are .data of the executable and are read at run time:
// position (9, 9, 1), pitch 0.14, yaw 0.83 (docs/re/unused.md 6.5).
//
// The original runs with the x87 in 24 bit precision (Direct3D 7 leaves it so), so every result of an operation is a float32: every `fr(...)` is one operation (or a store) of the
// original, in the order of the machine code. The port reproduces the emulator's result bit for bit except for the CRT's sin / cos (`Math.sin` of the same double rounded to a float32:
// identical in every tick the test (tools/tests/devcorner-camera.mjs) runs).
import { B } from '../game/input.ts';

const fr = Math.fround;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
/** the executable (src/formats/exe.ts `Pe`): only `u32(va)` is needed */
export interface ExeWords { u32(va: number): number }
const rf = (pe: ExeWords, va: number): number => { U32[0] = pe.u32(va); return F32[0]; };

/** the addresses the function reads (virtual addresses of the NL build) */
export const FREE = {
  /** _DAT_0089202c: 0.0 */ ZERO: 0x89202c,
  /** _DAT_00892030: 0.01, the turn / pitch step */ STEP: 0x892030,
  /** _DAT_00892070: 5.0, the angle and move scale */ SCALE: 0x892070,
  /** _DAT_00892064: the look-at's smallest length (FUN_004165a5) */ EPS: 0x892064,
  /** DAT_00982d28 / 2c / 30: the position */ POS: 0x982d28,
  /** DAT_00982d38: pitch, DAT_00982d3c: yaw */ PITCH: 0x982d38, YAW: 0x982d3c,
  /** DAT_00982d48 .. 0x982d87: the 4x4 matrix the function builds (row 0 = side, row 1 = up, row 2 = view direction) */ MAT: 0x982d48,
  /** DAT_0098383c: the pad word, DAT_008b1718: dt */ PAD: 0x98383c, DT: 0x8b1718,
  /** DAT_009da5e8: the camera record */ CAM: 0x9da5e8,
} as const;

/** the constants of the function, read from the executable */
export interface FreeConsts { zero: number; step: number; scale: number; eps: number }
export function readConsts(pe: ExeWords): FreeConsts {
  return { zero: rf(pe, FREE.ZERO), step: rf(pe, FREE.STEP), scale: rf(pe, FREE.SCALE), eps: rf(pe, FREE.EPS) };
}

/** FUN_0043a340(out, x, y, z): the Euler matrix, row major 16 floats; `c = FUN_0085d374` (cos), `s = FUN_0085d1c4` (sin) */
export function eulerMatrix(out: Float32Array | number[], x: number, y: number, z: number) {
  const f1 = fr(Math.cos(x)), f2 = fr(Math.sin(x)), f3 = fr(Math.cos(y)), f4 = fr(Math.sin(y)), f5 = fr(Math.cos(z)), f6 = fr(Math.sin(z));
  out[0] = fr(f5 * f3);
  out[1] = fr(f6 * f3);
  out[2] = -f4;
  out[4] = fr(fr(fr(f5 * f4) * f2) - fr(f6 * f1));
  out[5] = fr(fr(fr(f6 * f4) * f2) + fr(f5 * f1));
  out[6] = fr(f3 * f2);
  out[8] = fr(fr(fr(f5 * f4) * f1) + fr(f6 * f2));
  out[9] = fr(fr(fr(f6 * f4) * f1) - fr(f5 * f2));
  out[10] = fr(f3 * f1);
  out[12] = 0; out[13] = 0; out[14] = 0; out[11] = 0; out[7] = 0; out[3] = 0; out[15] = 1;
  return out;
}

/** FUN_0043a9e5(dst, a, b): dst = b x a with the compiled order of the sums (row r, column c: (b[r][0] a[0][c] + b[r][1] a[1][c]) + b[r][2] a[2][c], the translation row adds a[3][c]) */
export function matMul(dst: Float32Array | number[], a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      dst[r * 4 + c] = fr(fr(fr(b[r * 4] * a[c]) + fr(b[r * 4 + 1] * a[4 + c])) + fr(b[r * 4 + 2] * a[8 + c]));
    }
    dst[r * 4 + 3] = 0;
  }
  for (let c = 0; c < 3; c++) dst[12 + c] = fr(fr(fr(fr(b[12] * a[c]) + fr(b[13] * a[4 + c])) + fr(b[14] * a[8 + c])) + a[12 + c]);
  dst[15] = 1;
  return dst;
}

/**
 * FUN_0043cc5c(view, camera) -> FUN_004165a5 (look-at, left-handed): forward z = normalise(target - eye), y = normalise(up - (up . z) z), x = y cross z; the basis goes to camera[9..11] (x), [12..14]
 * (y), [15..17] (z) (the original copies the view matrix's columns to camera +0x24 .., +0x30 .., +0x3c ..). Every operation is a float32 (same as `ExactChaseCamera.updateView` of
 * tools/lib/m7-camera-exact.ts, which is bit-exact against the executable); `c` is the 18 floats of the camera (`ChaseCamera.c`). When the target is closer than `eps` the original returns
 * an error before it touches the basis: the old basis stays.
 */
export function viewBasis(c: Float64Array | Float32Array | number[], eps: number) {
  const z0x = fr(c[3] - c[0]), z0y = fr(c[4] - c[1]), z0z = fr(c[5] - c[2]);
  let len = fr(Math.sqrt(fr(fr(fr(z0x * z0x) + fr(z0y * z0y)) + fr(z0z * z0z))));
  if (!(eps <= len)) return;
  const z = [fr(z0x / len), fr(z0y / len), fr(z0z / len)];
  const up = [c[6], c[7], c[8]];
  const dot = fr(fr(fr(up[0] * z[0]) + fr(up[1] * z[1])) + fr(up[2] * z[2]));
  let y = [fr(up[0] - fr(dot * z[0])), fr(up[1] - fr(dot * z[1])), fr(up[2] - fr(dot * z[2]))];
  const L = (v: number[]) => fr(Math.sqrt(fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]))));
  len = L(y);
  if (len < eps) {
    y = [fr(0 - fr(z[1] * z[0])), fr(1 - fr(z[1] * z[1])), fr(0 - fr(z[1] * z[2]))];
    len = L(y);
    if (len < eps) {
      y = [fr(0 - fr(z[2] * z[0])), fr(0 - fr(z[2] * z[1])), fr(1 - fr(z[2] * z[2]))];
      len = L(y);
      if (len < eps) return;
    }
  }
  y = [fr(y[0] / len), fr(y[1] / len), fr(y[2] / len)];
  const x = [fr(fr(y[1] * z[2]) - fr(y[2] * z[1])), fr(fr(y[2] * z[0]) - fr(y[0] * z[2])), fr(fr(y[0] * z[1]) - fr(y[1] * z[0]))];
  c[9] = x[0]; c[10] = x[1]; c[11] = x[2];
  c[12] = y[0]; c[13] = y[1]; c[14] = y[2];
  c[15] = z[0]; c[16] = z[1]; c[17] = z[2];
}

/** the state DAT_00982d28 .. 0x982d87 */
export class FreeCam {
  /** DAT_00982d28 / 2c / 30 */ pos = [0, 0, 0];
  /** DAT_00982d38 */ pitch = 0;
  /** DAT_00982d3c */ yaw = 0;
  /** DAT_00982d48: 16 floats */ mat = new Float32Array(16);
  readonly k: FreeConsts;
  private readonly pe: ExeWords;
  constructor(pe: ExeWords) { this.pe = pe; this.k = readConsts(pe); this.reset(); }

  /** the start state of the executable's .data: position (9, 9, 1), pitch 0.14, yaw 0.83 and the matrix as it stands in the file (identity) */
  reset() {
    const pe = this.pe;
    this.pos = [rf(pe, FREE.POS), rf(pe, FREE.POS + 4), rf(pe, FREE.POS + 8)];
    this.pitch = rf(pe, FREE.PITCH);
    this.yaw = rf(pe, FREE.YAW);
    for (let i = 0; i < 16; i++) this.mat[i] = rf(pe, FREE.MAT + 4 * i);
  }

  /**
   * FUN_0088fd70(view, camera): one call. `pad` = DAT_0098383c (Left 1, Right 2, Up 4, Down 8, Ctrl 0x10), `dt` = DAT_008b1718, `c` = the camera (18 floats: eye [0..2], target [3..5], up [6..8],
   * basis [9..17]). Without Ctrl: Left / Right turn (yaw -= / += dt * 0.01), Up / Down move along the view direction (row 2 of the matrix of the previous call: the matrix is rebuilt
   * at the END of the call); with Ctrl: Left / Right move sideways (row 0), Up / Down change the pitch (-= / += dt * 0.01). The angles reach the matrix times 5, the move is
   * dt * (dt * 5) per call.
   */
  step(pad: number, dt: number, c: Float64Array | Float32Array | number[]) {
    const K = this.k, m = this.mat, p = this.pos;
    dt = fr(dt);
    const dStep = fr(dt * K.step);
    let lx = 0, ly = 0;                   // local_8c / local_88
    let fx = K.zero;                      // fVar2 (the x87 register that is kept across the tests)
    const ctrl = (pad & B.CTRL) !== 0;
    if (pad & B.LEFT) {
      if (!ctrl) this.yaw = fr(this.yaw - dStep);
      else { lx = -m[1]; ly = -m[2]; fx = -m[0]; }
    }
    if (pad & B.RIGHT) {
      if (!ctrl) this.yaw = fr(dStep + this.yaw);
      else { fx = fr(fx + m[0]); lx = fr(m[1] + lx); ly = fr(m[2] + ly); }
    }
    if (pad & B.UP) {
      if (!ctrl) { fx = fr(fx + m[8]); lx = fr(m[9] + lx); ly = fr(m[10] + ly); }
      else this.pitch = fr(this.pitch - dStep);
    }
    if (pad & B.DOWN) {
      if (!ctrl) { fx = fr(fx - m[8]); lx = fr(lx - m[9]); ly = fr(ly - m[10]); }
      else this.pitch = fr(dStep + this.pitch);
    }
    const f3 = fr(dt * K.scale);
    const dx = fr(fx * f3);
    lx = fr(f3 * lx); ly = fr(f3 * ly);
    p[0] = fr(fr(dt * dx) + p[0]);
    p[1] = fr(fr(dt * lx) + p[1]);
    p[2] = fr(fr(dt * ly) + p[2]);
    const yawM = new Float32Array(16), pitchM = new Float32Array(16);
    eulerMatrix(yawM, 0, fr(this.yaw * K.scale), 0);          // FUN_0043a340(local_40, 0, yaw * 5, 0)
    eulerMatrix(pitchM, fr(this.pitch * K.scale), 0, 0);      // FUN_0043a340(local_80, pitch * 5, 0, 0)
    matMul(m, yawM, pitchM);                                  // FUN_0043a9e5(&DAT_00982d48, local_40, local_80)
    c[0] = p[0]; c[1] = p[1]; c[2] = p[2];
    c[3] = fr(m[8] + c[0]); c[4] = fr(m[9] + c[1]); c[5] = fr(m[10] + c[2]);   // target = eye + row 2
    c[6] = m[4]; c[7] = m[5]; c[8] = m[6];                                      // up = row 1
    viewBasis(c, K.eps);
  }

  /** a snapshot of the state (the test compares it with DAT_00982d28 .. in the emulator) */
  snapshot() { return { pos: [...this.pos], pitch: this.pitch, yaw: this.yaw, mat: Array.from(this.mat) }; }

  /** extension: continue from a camera (eye, target): the state that makes the next call look the same way is not recoverable exactly (the matrix is rebuilt from pitch and yaw), so the position is taken over and pitch / yaw are searched */
  takeOver(eye: ArrayLike<number>, target: ArrayLike<number>) {
    this.pos = [fr(eye[0]), fr(eye[1]), fr(eye[2])];
    const fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const l = Math.hypot(fx, fy, fz) || 1;
    // grid search over (pitch, yaw) for the row 2 of the matrix that points the same way (the original's convention is not a plain yaw / pitch pair, see docs)
    let best = 1e9, bp = this.pitch, by = this.yaw;
    const M = new Float32Array(16), Y = new Float32Array(16), P = new Float32Array(16);
    const K = this.k;
    const test = (pitch: number, yaw: number) => {
      eulerMatrix(Y, 0, fr(yaw * K.scale), 0); eulerMatrix(P, fr(pitch * K.scale), 0, 0); matMul(M, Y, P);
      const e = (M[8] - fx / l) ** 2 + (M[9] - fy / l) ** 2 + (M[10] - fz / l) ** 2;
      if (e < best) { best = e; bp = pitch; by = yaw; }
    };
    const N = 96, span = Math.PI * 2 / K.scale;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) test((i / N) * span, (j / N) * span);
    let step = span / N;
    for (let it = 0; it < 40; it++, step *= 0.7) {
      const cp = bp, cy = by;
      for (const dp of [-step, 0, step]) for (const dy of [-step, 0, step]) test(cp + dp, cy + dy);
    }
    this.pitch = fr(bp); this.yaw = fr(by);
    eulerMatrix(Y, 0, fr(this.yaw * K.scale), 0); eulerMatrix(P, fr(this.pitch * K.scale), 0, 0); matMul(this.mat, Y, P);
  }
}
