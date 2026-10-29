// The original's x87 runs in 24-bit precision (Direct3D 7 sets control word 0x7f; docs/re/engine-m1.md "Differential test"): every +, -, *, / and sqrt result is rounded to a
// float32. With float32 operands the double result rounded once to float32 is exactly that (the double rounding of + - * / sqrt is innocuous for a 24-bit target).
// sin, cos, atan2 (the CRT's, FUN_0085d1c4 ...) keep their double result until the next operation rounds it.
export const fr = Math.fround;
/**
 * One x87 result at 24-bit precision control: the mantissa is rounded to 24 bits, the exponent range stays the extended one (a result below 2^-126 is NOT a float32 denormal yet: only the store
 * into a float variable rounds it that way; same as `p24` of src/formats/x86emu.ts). Equal to Math.fround in the float32 range.
 */
export const r24 = (v: number): number => {
  if (v === 0 || !Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (a >= 1.1754943508222875e-38 && a <= 3.4028234663852886e38) return Math.fround(v);
  const t = v * 536870913;
  return t - (t - v);       // Veltkamp split: the 24 high bits
};
export const ad = (x: number, y: number): number => r24(x + y);
export const sb = (x: number, y: number): number => r24(x - y);
export const ml = (x: number, y: number): number => r24(x * y);
export const dv = (x: number, y: number): number => r24(x / y);
export const sq = (x: number): number => r24(Math.sqrt(x));
/**
 * The CRT's asin (0x85e7b4): fld1 / fadd, fld1 / fsub, fmulp, fsqrt (each rounded to float32 in 24-bit mode), then fpatan(x, sqrt((1 + x)(1 - x))) in double; the
 * result stays a double until the next operation or store. |x| = 1 loads the constant pi/2.
 */
export const asin24 = (x: number): number => {
  const a = Math.abs(x);
  if (a === 1) return x < 0 ? -Math.PI / 2 : Math.PI / 2;
  if (!(a < 1)) return NaN;
  return Math.atan2(x, sq(ml(ad(1, x), sb(1, x))));
};
const BITS_F = new Float32Array(1), BITS_U = new Uint32Array(BITS_F.buffer);
/** the float32 with these IEEE bits: constants of the exe quoted as `0x3f860a63` in the decompile */
export const fromBits = (u: number): number => { BITS_U[0] = u; return BITS_F[0]; };
