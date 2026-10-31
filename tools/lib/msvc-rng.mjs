// A seeded stand-in of the original's C runtime generator for the differential tests of the mini-games that need TWO independent generators with one seed (the original side
// run in the x86 interpreter and the port side, each with its own state). The port itself draws from the one shared generator src/game/crt.ts (rand / randF; the tests of the
// shared generator itself compare it with the original's native rand, m7-z09JST-cover "random numbers"). This class is only the test's per-side source:
//   FUN_0085daf0 (rand): seed = seed * 0x343fd + 0x269ec3; return (seed >> 16) & 0x7fff
//   FUN_004388ae (x):    x <= 0 ? 0 : (float)rand() / 32767.0f * x   (24-bit x87: every step a float32)
export class MsvcRng {
  constructor(seed = 1) { this.seed = seed >>> 0; }
  /** rand(): 0 .. 32767 */
  next() { this.seed = (Math.imul(this.seed, 0x343fd) + 0x269ec3) >>> 0; return (this.seed >>> 16) & 0x7fff; }
  /** FUN_004388ae(range) */
  range(range) { return range <= 0 ? 0 : Math.fround(Math.fround(this.next() / 32767) * Math.fround(range)); }
}
