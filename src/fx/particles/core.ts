// Particle engine core (FX_Particle.c / CParticle*.cpp of LE2.EXE, docs/re/particles.md): flat records, the shared random / trigonometry tables.
//
// Fidelity rules of the whole module:
//   * Every record of the original (appearance 0xe8 bytes, movement 0x144, emitter 0xb4, emitter block 0x350, particle 0x308, source 0x620) is a flat
//     little-endian byte buffer with the ORIGINAL byte offsets (layout.ts); block copies of the original (`rep movsd` of 0x3a / 0x51 / 0x2d / 0xd4 dwords) are
//     `TypedArray.set` calls, so runtime fields travel with them exactly.
//   * x87 arithmetic: the game runs the FPU at 53-bit precision (`__controlfp(_PC_53)`, docs/re/m4/emu.md), i.e. doubles, and rounds to float32 at every
//     `fst`/`fstp` to a float field: `Math.fround` at stores (typed arrays do it implicitly), plain double arithmetic in between, in the order of the
//     original's instructions. NOTE: the decompile's expression order is not the instruction order: every function was checked against the assembly and
//     differentially tested against the original code running in the x86 interpreter (tools/tests/particles-oracle.mjs).
//   * `__ftol` truncates toward zero (`Math.trunc`).
//   * Random numbers: the engine draws from a 4096 entry table of floats (`FUN_00454460` fills it with `rand() / 32767`), advanced with a shared circular
//     index; the C runtime `rand()` is used for the table, a few sign decisions and the colour mirror. Both go through the injectable `RandFn`.

/** RNG: the C runtime `rand()` of the original (0..32767). Replaced by the shared WP-TIME generator when it exists (`ParticleEngine.setRand`). */
export type RandFn = () => number;

/** RNG: MSVC `rand()` (LCG 214013 / 2531011, bits 16..30), seeded like `srand(seed)`. Default until the shared game RNG (WP-TIME) is injected. */
export function msvcRand(seed = 1): RandFn {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; };
}

/** a flat record: bytes with float / int / byte views (little endian, like the original) */
export class Rec {
  readonly buf: ArrayBuffer;
  readonly f: Float32Array;
  readonly i: Int32Array;
  readonly u8: Uint8Array;
  readonly size: number;
  constructor(size: number, buf?: ArrayBuffer, off = 0) {
    this.size = size;
    this.buf = buf ?? new ArrayBuffer(size);
    this.f = new Float32Array(this.buf, off, size >> 2);
    this.i = new Int32Array(this.buf, off, size >> 2);
    this.u8 = new Uint8Array(this.buf, off, size);
  }
  /** a zero-copy view of `n` bytes at byte offset `off` of this record */
  view(off: number, n: number): Rec { return new Rec(n, this.buf, this.u8.byteOffset + off); }
  /** copy the whole record `src` over this one (same size) */
  copyFrom(src: Rec): void { this.u8.set(src.u8.subarray(0, this.size)); }
  /** the C string at the start of the record (name) */
  get name(): string {
    let s = '';
    for (let p = 0; p < this.size && this.u8[p] !== 0; p++) s += String.fromCharCode(this.u8[p]);
    return s;
  }
  /** strcpy of `s` (with its NUL) to the start of the record */
  setName(s: string): void {
    for (let p = 0; p < s.length && p < this.size - 1; p++) this.u8[p] = s.charCodeAt(p);
    this.u8[Math.min(s.length, this.size - 1)] = 0;
  }
  clone(): Rec { const r = new Rec(this.size); r.u8.set(this.u8); return r; }
}

/** the engine's shared mutable state (the globals DAT_05d3b0f0 / DAT_05d3b4f0 / DAT_05d3b8f0 / DAT_05d478f0 of the original) */
export class PState {
  /** the three tables are consecutive in the original's memory (sin 0x5d3b0f0, cos 0x5d3b4f0, random 0x5d3b8f0): an index just past the end of a table reads the next one */
  readonly mem = new Float32Array(256 + 256 + 4096);
  /** DAT_05d3b0f0 / DAT_05d3b4f0: 256 entry sin / cos table starting at 225 degrees */
  readonly sin = this.mem.subarray(0, 256);
  readonly cos = this.mem.subarray(256, 512);
  /** DAT_05d3b8f0: 4096 random floats */
  readonly table = this.mem.subarray(512, 4608);
  /** DAT_05d478f0: the index into the random table (persists over engine instances: static in the original) */
  idx = 0;
  rand: RandFn;
  constructor(rand: RandFn) { this.rand = rand; }
  /** `idx = (idx + 1) & 0xfff; table[idx]` : the next random float 0..1 */
  rnd(): number { this.idx = (this.idx + 1) & 0xfff; return this.table[this.idx]; }
  /** FUN_004388ae(x): `rand() / 32767 * x` (0 for x <= 0), as the x87 value (both operations round to 24 bit) */
  crtRand(x: number): number { return x <= 0 ? 0 : f32(f32(this.rand() / 32767) * x); }
}

const f32 = Math.fround;

/**
 * the result of a 24-bit precision x87 operation (control word 0x7f): the mantissa is rounded to 24 bits but the exponent range stays the extended one, so a result below
 * the float range is NOT yet a denormal; the `fstp` store that follows rounds again (a Float32Array store does that). `Math.fround` alone would round once, straight to the
 * denormal grid, and differ in the last bit for tiny values (a velocity decaying under air resistance reaches them).
 */
export function r24(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (a >= 1.1754943508222875e-38 && a <= 3.4028234663852886e38) return Math.fround(v);
  const t = v * 536870913, hi = t - (t - v);   // Veltkamp split: the 24 high bits
  return hi;
}

/** FUN_00454460: fill the random table (4096 x `FUN_004388ae(1.0)` = `rand() / 32767 * 1.0`), the sin / cos table (angle 3.926991 + i * 0.024543693 accumulated at full precision) and advance the index by 6 * 255. */
export function initTables(s: PState): void {
  for (let i = 0; i < 4096; i++) s.table[i] = f32(f32(s.rand() / 32767) * 1.0);
  let a = f32(3.926991);                                  // 0x407b53d2 (5 pi / 4)
  const step = f32(0.024543693);                          // 0x3cc90fdb (2 pi / 256)
  for (let i = 0; i < 256; i++) {
    s.sin[i] = Math.sin(a);
    s.cos[i] = Math.cos(a);
    a = f32(a + step);                                    // the x87 runs at 24 bit (control word 0x7f, D3D7): the register sum rounds to float32
  }
  for (let i = 0; i < 255; i++) s.idx = (s.idx + 6) & 0xfff;
}

/** u / v tables of the sprite sheet (DAT_008b8510 / DAT_008b8534: 9 entries each). Both have a typo in the original's data: entry 5 of the u table and entry 3 of the v table are 0.6125 */
export const U_TABLE = new Float32Array([0, 0.125, 0.25, 0.375, 0.5, 0.6125, 0.75, 0.875, 1.0, 1.0]);
/** v table: 1.0 down to 0.0 in steps of 0.125 (entry 3 = 0.6125 instead of 0.625). Both tables are read one entry past their end by sprite index 64 (the neighbouring dwords of the original's data). */
export const V_TABLE = new Float32Array([1.0, 0.875, 0.75, 0.6125, 0.5, 0.375, 0.25, 0.125, 0.0, 2.7262854502715166e+29]);

/** __ftol */
export const ftol = (x: number): number => Math.trunc(x) | 0;
