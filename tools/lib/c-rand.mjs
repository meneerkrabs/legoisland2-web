// The original's FUN_004388ae(max) on a scripted source (WP-ISLAND-FIX): the C runtime's rand() is the integer floor(v * 32768) (0 .. 32767) of the source value v in [0, 1), the result is
// `(float)rand() / 32767.0f * max` with both operations rounded to a float32 (24-bit x87) and 0 without a draw for max <= 0. The port's src/island/rng.ts computes the same from the same source.
const fr = Math.fround;
export const cRandInt = (v) => Math.floor(v * 32768) & 0x7fff;
export const cRand = (v, max) => (max <= 0 ? 0 : fr(fr(cRandInt(v) / 32767) * fr(max)));
