// FUN_0043a5e4 with the original's float32 arithmetic (WP-VERIFY, docs/re/m6/z01BPK.md "Differential test").
// `buildMatrix` (matrix.ts) takes the sines / cosines as doubles; the executable stores all six as float32 locals (FUN_0085d374 = cos, FUN_0085d1c4 = sin, each result `(float)`)
// and then evaluates the products in the x87 stack (53 bit) with one rounding to float32 per stored element. The difference is up to a few float32 ulps per element, enough to flip
// the exact comparisons of the game code that read the matrix (`forward . d >= 6.8`, `rec.m[10] < 0.95`). Same layout as `buildMatrix` (rotation only, no scale).
const f32 = Math.fround;

/** FUN_0043a5e4(m, rx, ry, rz, x, y, z): the angles are float32 arguments (round them before the call when they come from a double) */
export function buildMatrixF32(rx: number, ry: number, rz: number, px: number, py: number, pz: number): Float32Array {
  const c1 = f32(Math.cos(rx)), s1 = f32(Math.sin(rx)), c3 = f32(Math.cos(ry)), s3 = f32(Math.sin(ry)), c5 = f32(Math.cos(rz)), s5 = f32(Math.sin(rz));
  const m = new Float32Array(16);
  m[0] = c5 * c3; m[1] = s5 * c3; m[2] = -s3;
  m[4] = c5 * s3 * s1 - s5 * c1; m[5] = c5 * c1 + s5 * s3 * s1; m[6] = c3 * s1;
  m[8] = s5 * s1 + c5 * s3 * c1; m[9] = s5 * s3 * c1 - c5 * s1; m[10] = c3 * c1;
  m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
