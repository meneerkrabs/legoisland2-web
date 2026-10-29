// Exact float32 arithmetic of the original for the mini-game zones (z27TRX, z28HAT): the executable runs the x87 in 24-bit precision (Direct3D 7 leaves single precision, control word 0x7f),
// so every + - * / and sqrt result is rounded to float32 and a C `float` variable / field is a float32 in memory. sin / cos / atan2 stay double until the next operation.
// The matrix builders are FUN_0043a5e4 / FUN_0043a4a1 (decompile: every product and sum rounded in the order of the expression).
export const fr = Math.fround;

/** the rotation part of FUN_0043a4a1 / FUN_0043a5e4 into `m` (row-major, row-vector, 16 floats); angles are float32 values */
export function eulerRotation(m: Float32Array, rx: number, ry: number, rz: number) {
  const c1 = fr(Math.cos(rx)), s2 = fr(Math.sin(rx)), c3 = fr(Math.cos(ry)), s4 = fr(Math.sin(ry)), c5 = fr(Math.cos(rz)), s6 = fr(Math.sin(rz));
  m[0] = fr(c5 * c3); m[1] = fr(s6 * c3); m[2] = -s4;
  m[4] = fr(fr(fr(c5 * s4) * s2) - fr(s6 * c1));
  m[5] = fr(fr(c5 * c1) + fr(fr(s6 * s4) * s2));
  m[6] = fr(c3 * s2);
  m[8] = fr(fr(s6 * s2) + fr(fr(c5 * s4) * c1));
  m[9] = fr(fr(fr(s6 * s4) * c1) - fr(c5 * s2));
  m[10] = fr(c3 * c1);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
}
/** FUN_0043a5e4(m, rx, ry, rz, x, y, z) */
export function eulerMatrix(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number) {
  eulerRotation(m, fr(rx), fr(ry), fr(rz));
  m[12] = fr(x); m[13] = fr(y); m[14] = fr(z);
}

/** FUN_0043cec0: normalise in place (the sum of squares adds x, y, then z; 1 / sqrt, every step float32); nothing happens for the zero vector */
export function normalise3(v: number[]) {
  const l2 = fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]));
  if (l2 !== 0) {
    const k = fr(1 / fr(Math.sqrt(l2)));
    v[0] = fr(k * v[0]); v[1] = fr(k * v[1]); v[2] = fr(k * v[2]);
  }
}
/** FUN_0043cfee: out = d - 2 (d . n) n, in the original's float32 order */
export function reflect3(d: ArrayLike<number>, n: ArrayLike<number>): [number, number, number] {
  const dot = fr(fr(fr(d[0] * n[0]) + fr(d[1] * n[1])) + fr(d[2] * n[2]));
  return [fr(fr(fr(n[0] * -2) * dot) + d[0]), fr(fr(fr(n[1] * -2) * dot) + d[1]), fr(fr(fr(n[2] * -2) * dot) + d[2])];
}
/** FUN_0043ad29: rotate the columns 0 / 2 of the 3x3 part about Y */
export function rotateY(m: Float32Array, angle: number) {
  angle = fr(angle);
  const c = fr(Math.cos(angle)), s = fr(Math.sin(angle));
  for (const [a, b] of [[0, 2], [4, 6], [8, 10]]) { const f = m[a]; m[a] = fr(fr(s * m[b]) + fr(c * m[a])); m[b] = fr(fr(c * m[b]) + fr(-s * f)); }
}
/** FUN_0043ab72: out = v * m (row vector, translation added) */
export function toWorld(m: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
  return [0, 1, 2].map((j) => fr(fr(fr(fr(v[0] * m[j]) + fr(v[1] * m[4 + j])) + fr(v[2] * m[8 + j])) + m[12 + j])) as [number, number, number];
}
/** FUN_0043a9e5(out, a, b): out = b * a */
export function mulMatrices(b: ArrayLike<number>, a: ArrayLike<number>): Float32Array {
  const r = new Float32Array(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) r[row * 4 + col] = fr(fr(fr(b[row * 4] * a[col]) + fr(b[row * 4 + 1] * a[4 + col])) + fr(b[row * 4 + 2] * a[8 + col]));
  for (let col = 0; col < 3; col++) r[12 + col] = fr(r[12 + col] + a[12 + col]);
  r[15] = 1;
  return r;
}
/** FUN_0043a742(m, rx, ry, rz, x, y, z, sx, sy, sz): the rotation scaled column by column, the translation */
export function eulerScaledMatrix(rx: number, ry: number, rz: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): Float32Array {
  const m = new Float32Array(16);
  eulerMatrix(m, rx, ry, rz, x, y, z);
  const s = [fr(sx), fr(sy), fr(sz)];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[row * 4 + col] = fr(m[row * 4 + col] * s[col]);
  return m;
}
