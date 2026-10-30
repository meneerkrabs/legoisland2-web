// The matrix / vector helpers of the original engine that the particle code calls (Math3D, FUN_0043xxxx). Row-major 4x4 float32 matrices, row vectors
// (v' = v * M), arguments passed as (array, byte offset / element offset). Each function is a transliteration of the decompile (docs/re/particles.md):
// the game's x87 runs in 24-bit precision (Direct3D 7, control word 0x7f; docs/re/engine-m1.md 8.1): every + - * / and sqrt result is rounded to float32 in the order of the
// machine code (three term sums add x, y, z; the decompile lists them the other way round), sin / cos stay doubles until the next operation.
const f32 = Math.fround;

/** FUN_0043ac78: identity (writes 16 floats at `o`) */
export function matIdentity(m: Float32Array, o = 0): void {
  m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
  m[o + 12] = 0; m[o + 13] = 0; m[o + 14] = 0; m[o + 15] = 1;
}

/** FUN_0043a5e4(m, rx, ry, rz, px, py, pz): rotation from Euler angles + translation (the arguments are float32 values) */
export function matEuler(m: Float32Array, o: number, rx: number, ry: number, rz: number, px: number, py: number, pz: number): void {
  const c1 = f32(Math.cos(rx)), s2 = f32(Math.sin(rx));   // FUN_0085d374 = cos, FUN_0085d1c4 = sin
  const c3 = f32(Math.cos(ry)), s4 = f32(Math.sin(ry));
  const c5 = f32(Math.cos(rz)), s6 = f32(Math.sin(rz));
  m[o] = f32(c5 * c3);
  m[o + 1] = f32(s6 * c3);
  m[o + 2] = -s4;
  m[o + 4] = f32(f32(f32(c5 * s4) * s2) - f32(s6 * c1));
  m[o + 5] = f32(f32(c5 * c1) + f32(f32(s6 * s4) * s2));
  m[o + 6] = f32(c3 * s2);
  m[o + 8] = f32(f32(s6 * s2) + f32(f32(c5 * s4) * c1));
  m[o + 9] = f32(f32(f32(s6 * s4) * c1) - f32(c5 * s2));
  m[o + 10] = f32(c3 * c1);
  m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz;
  m[o + 11] = 0; m[o + 7] = 0; m[o + 3] = 0; m[o + 15] = 1;
}

/** FUN_0043a340(m, rx, ry, rz): FUN_0043a5e4 without translation */
export function matEuler0(m: Float32Array, o: number, rx: number, ry: number, rz: number): void {
  matEuler(m, o, rx, ry, rz, 0, 0, 0);
}

/** FUN_0043a9e5(out, a, b): out = b * a (row vectors: `b` is applied first), translation row included */
export function matMul(out: Float32Array, oo: number, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
  // (reads everything before writing: the original reads into locals first, `out` may alias an input)
  const A = a.slice(ao, ao + 16), B = b.slice(bo, bo + 16);
  const r = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) r[row * 4 + col] = f32(f32(f32(B[row * 4] * A[col]) + f32(B[row * 4 + 1] * A[4 + col])) + f32(B[row * 4 + 2] * A[8 + col]));
    r[row * 4 + 3] = 0;
  }
  for (let col = 0; col < 3; col++) r[12 + col] = f32(r[12 + col] + A[12 + col]);
  r[15] = 1;
  for (let i = 0; i < 16; i++) out[oo + i] = r[i];
}

/** FUN_0043ab72(out, m, v): v * m (point: translation added); `out` may alias `v` */
export function transformPoint(out: Float32Array, oo: number, m: Float32Array, mo: number, v: Float32Array, vo: number): void {
  const x = v[vo], y = v[vo + 1], z = v[vo + 2];
  const r = [0, 1, 2].map((j) => f32(f32(f32(f32(x * m[mo + j]) + f32(y * m[mo + 4 + j])) + f32(z * m[mo + 8 + j])) + m[mo + 12 + j]));
  out[oo] = r[0]; out[oo + 1] = r[1]; out[oo + 2] = r[2];
}

/** FUN_0043abe6(out, m, v): v * m without translation (`+ 0.0` of the original) */
export function transformDir(out: Float32Array, oo: number, m: Float32Array, mo: number, v: Float32Array, vo: number): void {
  const x = v[vo], y = v[vo + 1], z = v[vo + 2];
  const r = [0, 1, 2].map((j) => f32(f32(f32(f32(x * m[mo + j]) + f32(y * m[mo + 4 + j])) + f32(z * m[mo + 8 + j])) + 0));
  out[oo] = r[0]; out[oo + 1] = r[1]; out[oo + 2] = r[2];
}

/** FUN_0043ad29(m, a): post-rotates the matrix columns 0 / 2 (rotation about the Y axis of the rows' x / z components) */
export function matRotY(m: Float32Array, o: number, a: number): void {
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  for (const [i, j] of [[0, 2], [4, 6], [8, 10]]) { const f = m[o + i]; m[o + i] = f32(f32(s * m[o + j]) + f32(c * m[o + i])); m[o + j] = f32(f32(c * m[o + j]) + f32(-s * f)); }
}

/** FUN_0043af16(m, a): the same about columns 0 / 1 */
export function matRotZ(m: Float32Array, o: number, a: number): void {
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  for (const [i, j] of [[0, 1], [4, 5], [8, 9]]) { const f = m[o + i]; m[o + i] = f32(f32(s * m[o + j]) + f32(c * m[o + i])); m[o + j] = f32(f32(c * m[o + j]) + f32(-s * f)); }
}

/** FUN_0043cec0(v): normalise in place (`1.0 / sqrt(len2)` as float32 factor); a zero vector stays */
export function vecNormalize(v: Float32Array, o: number): void {
  const len2 = f32(f32(f32(v[o] * v[o]) + f32(v[o + 1] * v[o + 1])) + f32(v[o + 2] * v[o + 2]));
  if (len2 !== 0) {
    const k = f32(1.0 / f32(Math.sqrt(len2)));
    v[o] = f32(k * v[o]); v[o + 1] = f32(k * v[o + 1]); v[o + 2] = f32(k * v[o + 2]);
  }
}

/** FUN_0043cfee(out, d, n): reflection `d - 2 (d.n) n`; every step of the original is stored as float32 (dot, n * -2, (n * -2) * dot) before the final add */
export function vecReflect(out: Float32Array, oo: number, d: Float32Array, dO: number, n: Float32Array, nO: number): void {
  const dot = f32(f32(f32(d[dO] * n[nO]) + f32(d[dO + 1] * n[nO + 1])) + f32(d[dO + 2] * n[nO + 2]));
  const t0 = f32(f32(n[nO] * -2) * dot), t1 = f32(f32(n[nO + 1] * -2) * dot), t2 = f32(f32(n[nO + 2] * -2) * dot);
  out[oo] = f32(t0 + d[dO]); out[oo + 1] = f32(t1 + d[dO + 1]); out[oo + 2] = f32(t2 + d[dO + 2]);
}
