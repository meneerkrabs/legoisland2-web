// The original runs the x87 in 24-bit precision (Direct3D 7 leaves single precision, control word 0x7f): every + - * / and sqrt rounds to float32 (sin / cos / atan2 results are doubles
// until the next operation, and every store into a float field rounds). These helpers replay that for the zone ports (WP-VERIFY); see tools/lib/m7-*-emu.mjs.
export const f32 = Math.fround;
export const mulf = (a: number, b: number) => f32(a * b);
export const addf = (a: number, b: number) => f32(a + b);
export const subf = (a: number, b: number) => f32(a - b);
export const PI32 = f32(Math.PI), TWO_PI32 = f32(2 * Math.PI);
/** the wrap of the original: `if (a >= -pi) { if (a > pi) a -= 2 pi } else a += 2 pi` with float constants and float operations */
export const wrapAngle32 = (a: number) => (a >= -PI32 ? (a > PI32 ? subf(a, TWO_PI32) : a) : addf(a, TWO_PI32));
/** FUN_0043a4a1: the 3x3 part of the Euler matrix (translation untouched by the caller) */
export function eulerExact(rx: number, ry: number, rz: number): Float32Array {
  const c1 = f32(Math.cos(rx)), s2 = f32(Math.sin(rx)), c3 = f32(Math.cos(ry)), s4 = f32(Math.sin(ry)), c5 = f32(Math.cos(rz)), s6 = f32(Math.sin(rz));
  const m = new Float32Array(16);
  m[0] = mulf(c5, c3); m[1] = mulf(s6, c3); m[2] = -s4;
  m[4] = subf(mulf(mulf(c5, s4), s2), mulf(s6, c1)); m[5] = addf(mulf(c5, c1), mulf(mulf(s6, s4), s2)); m[6] = mulf(c3, s2);
  m[8] = addf(mulf(s6, s2), mulf(mulf(c5, s4), c1)); m[9] = subf(mulf(mulf(s6, s4), c1), mulf(c5, s2)); m[10] = mulf(c3, c1);
  m[15] = 1;
  return m;
}
/** write the 3x3 of `eulerExact` into a record matrix (FUN_0043a4a1(rec + 0xc, rx, ry, rz)) */
export function setRotationExact(m: Float32Array, rx: number, ry: number, rz: number) {
  const t = eulerExact(rx, ry, rz);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] = t[i];
}
/** FUN_0042216f: the controller distance of the engine pass: squared distance to the focus record without y, every difference and product rounded to float32 (`ctrl.distSq` of the port is a double) */
export function dist32(rec: { x: number; z: number }, focus: { x: number; z: number } | null): number {
  if (!focus) return 0;
  const dx = subf(focus.x, rec.x), dz = subf(focus.z, rec.z);
  return addf(addf(mulf(dx, dx), 0), mulf(dz, dz));
}
/** FUN_0043ab72(out, M, v): v * M (translation row included), the asm order ((v0 m + v1 m) + v2 m) + t */
export function toWorldExact(m: ArrayLike<number>, v: ArrayLike<number>): number[] {
  return [0, 1, 2].map((c) => addf(addf(addf(mulf(v[0], m[c]), mulf(v[1], m[4 + c])), mulf(v[2], m[8 + c])), m[12 + c]));
}
/**
 * The camera / focus easing of the house nodes (FUN_0054042d, FUN_005414b0, FUN_00541c98): the difference to the target is normalised (FUN_0043cec0) and scaled by dist * factor; below `snap` the
 * position jumps to the target. Float32 throughout. Returns true when it moved (not snapped).
 */
export function easeToward(cur: number[], tgt: ArrayLike<number>, factor: number, snap: number): boolean {
  const d = [subf(tgt[0], cur[0]), subf(tgt[1], cur[1]), subf(tgt[2], cur[2])];
  const l2 = addf(addf(mulf(d[0], d[0]), mulf(d[1], d[1])), mulf(d[2], d[2]));
  const len = f32(Math.sqrt(l2));
  let n = d;
  if (l2 !== 0) { const k = f32(1 / f32(Math.sqrt(l2))); n = d.map((v) => mulf(k, v)); }
  if (snap <= len) {
    const s = mulf(len, factor);
    for (let i = 0; i < 3; i++) cur[i] = addf(mulf(n[i], s), cur[i]);
    return true;
  }
  for (let i = 0; i < 3; i++) cur[i] = tgt[i];
  return false;
}
