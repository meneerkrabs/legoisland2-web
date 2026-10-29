// The matrix / vector helpers of the original engine that the particle code calls (Math3D, FUN_0043xxxx). Row-major 4x4 float32 matrices, row vectors
// (v' = v * M), arguments passed as (array, byte offset / element offset). Each function is a transliteration of the decompile (docs/re/particles.md):
// products and sums are evaluated in double precision (the game's x87 runs at 53 bits) and rounded to float32 when stored.
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
  const fVar1 = f32(Math.cos(rx)), fVar2 = f32(Math.sin(rx));   // FUN_0085d374 = cos, FUN_0085d1c4 = sin
  const fVar3 = f32(Math.cos(ry)), fVar4 = f32(Math.sin(ry));
  const fVar5 = f32(Math.cos(rz)), fVar6 = f32(Math.sin(rz));
  m[o] = fVar5 * fVar3;
  m[o + 1] = fVar6 * fVar3;
  m[o + 2] = -fVar4;
  m[o + 4] = fVar5 * fVar4 * fVar2 - fVar6 * fVar1;
  m[o + 5] = fVar5 * fVar1 + fVar6 * fVar4 * fVar2;
  m[o + 6] = fVar3 * fVar2;
  m[o + 8] = fVar6 * fVar2 + fVar5 * fVar4 * fVar1;
  m[o + 9] = fVar6 * fVar4 * fVar1 - fVar5 * fVar2;
  m[o + 10] = fVar3 * fVar1;
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
  for (let row = 0; row < 3; row++) {
    const b0 = B[row * 4], b1 = B[row * 4 + 1], b2 = B[row * 4 + 2];
    r[row * 4] = b2 * A[8] + b1 * A[4] + b0 * A[0];
    r[row * 4 + 1] = b2 * A[9] + b1 * A[5] + b0 * A[1];
    r[row * 4 + 2] = b2 * A[10] + b1 * A[6] + b0 * A[2];
    r[row * 4 + 3] = 0;
  }
  const b0 = B[12], b1 = B[13], b2 = B[14];
  r[14] = b2 * A[10] + b1 * A[6] + b0 * A[2] + A[14];
  r[12] = b2 * A[8] + b1 * A[4] + b0 * A[0] + A[12];
  r[13] = b2 * A[9] + b1 * A[5] + b0 * A[1] + A[13];
  r[15] = 1;
  for (let i = 0; i < 16; i++) out[oo + i] = r[i];
}

/** FUN_0043ab72(out, m, v): v * m (point: translation added); `out` may alias `v` */
export function transformPoint(out: Float32Array, oo: number, m: Float32Array, mo: number, v: Float32Array, vo: number): void {
  const x = v[vo], y = v[vo + 1], z = v[vo + 2];
  const r2 = z * m[mo + 10] + y * m[mo + 6] + x * m[mo + 2] + m[mo + 14];
  const r0 = z * m[mo + 8] + y * m[mo + 4] + x * m[mo] + m[mo + 12];
  const r1 = z * m[mo + 9] + y * m[mo + 5] + x * m[mo + 1] + m[mo + 13];
  out[oo + 2] = r2; out[oo] = r0; out[oo + 1] = r1;
}

/** FUN_0043abe6(out, m, v): v * m without translation (`+ 0.0` of the original) */
export function transformDir(out: Float32Array, oo: number, m: Float32Array, mo: number, v: Float32Array, vo: number): void {
  const x = v[vo], y = v[vo + 1], z = v[vo + 2];
  const r2 = z * m[mo + 10] + y * m[mo + 6] + x * m[mo + 2] + 0;
  const r0 = z * m[mo + 8] + y * m[mo + 4] + x * m[mo] + 0;
  const r1 = z * m[mo + 9] + y * m[mo + 5] + x * m[mo + 1] + 0;
  out[oo + 2] = r2; out[oo] = r0; out[oo + 1] = r1;
}

/** FUN_0043ad29(m, a): post-rotates the matrix columns 0 / 2 (rotation about the Y axis of the rows' x / z components) */
export function matRotY(m: Float32Array, o: number, a: number): void {
  const fVar1 = f32(Math.cos(a)), fVar2 = f32(Math.sin(a));
  const fVar3 = m[o], fVar4 = m[o + 4], fVar5 = m[o + 8];
  m[o] = fVar2 * m[o + 2] + fVar1 * m[o];
  m[o + 4] = fVar2 * m[o + 6] + fVar1 * m[o + 4];
  m[o + 8] = fVar2 * m[o + 10] + fVar1 * m[o + 8];
  m[o + 2] = fVar1 * m[o + 2] + -fVar2 * fVar3;
  m[o + 6] = fVar1 * m[o + 6] + -fVar2 * fVar4;
  m[o + 10] = fVar1 * m[o + 10] + -fVar2 * fVar5;
}

/** FUN_0043af16(m, a): the same about columns 0 / 1 */
export function matRotZ(m: Float32Array, o: number, a: number): void {
  const fVar1 = f32(Math.cos(a)), fVar2 = f32(Math.sin(a));
  const fVar3 = m[o], fVar4 = m[o + 4], fVar5 = m[o + 8];
  m[o] = fVar2 * m[o + 1] + fVar1 * m[o];
  m[o + 4] = fVar2 * m[o + 5] + fVar1 * m[o + 4];
  m[o + 8] = fVar2 * m[o + 9] + fVar1 * m[o + 8];
  m[o + 1] = fVar1 * m[o + 1] + -fVar2 * fVar3;
  m[o + 5] = fVar1 * m[o + 5] + -fVar2 * fVar4;
  m[o + 9] = fVar1 * m[o + 9] + -fVar2 * fVar5;
}

/** FUN_0043cec0(v): normalise in place (`1.0 / sqrt(len2)` as float32 factor); a zero vector stays */
export function vecNormalize(v: Float32Array, o: number): void {
  const len2 = f32(v[o + 2] * v[o + 2] + v[o + 1] * v[o + 1] + v[o] * v[o]);
  if (len2 !== 0) {
    const k = f32(1.0 / Math.sqrt(len2));
    v[o] = k * v[o]; v[o + 1] = k * v[o + 1]; v[o + 2] = k * v[o + 2];
  }
}

/** FUN_0043cfee(out, d, n): reflection `d - 2 (d.n) n`; every step of the original is stored as float32 (dot, n * -2, (n * -2) * dot) before the final add */
export function vecReflect(out: Float32Array, oo: number, d: Float32Array, dO: number, n: Float32Array, nO: number): void {
  const dot = f32(d[dO] * n[nO] + d[dO + 1] * n[nO + 1] + d[dO + 2] * n[nO + 2]);
  const t0 = f32(f32(n[nO] * -2) * dot), t1 = f32(f32(n[nO + 1] * -2) * dot), t2 = f32(f32(n[nO + 2] * -2) * dot);
  out[oo] = t0 + d[dO]; out[oo + 1] = t1 + d[dO + 1]; out[oo + 2] = t2 + d[dO + 2];
}
