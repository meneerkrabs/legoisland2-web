// The island's random numbers: the original's C runtime `rand()` (0..32767) and FUN_004388ae(max) = (float)rand() / 32767.0f * max, both operations rounded to a float32 (24-bit x87), 0 for max <= 0 (no draw).
// The generator is injectable: the node tests pass a deterministic one (a source of numbers v in [0, 1): rand() = floor(v * 32768)); WP-TIME replaces it by the shared MSVC LCG
// (`rand()` seeded with time() at start-up, T2 in docs/re/gaps.md). Without an injected source `Math.random` is looked up at every draw (the tests also replace it).
let source: (() => number) | null = null;
/** tests / WP-TIME: a source of numbers in [0, 1) (null = Math.random) */
export function setIslandRandom(f: (() => number) | null) { source = f; }
/** the C runtime's rand(): 0 .. 32767 */
export const randInt = (): number => Math.floor((source ?? Math.random)() * 32768) & 0x7fff;
const fr = Math.fround;
/** FUN_004388ae(max): `(float)rand() / 32767.0f * max` (every operation a float32); max <= 0 gives 0 without a draw */
export const rand = (max: number): number => (max <= 0 ? 0 : fr(fr(randInt() / 32767) * fr(max)));
/** `__ftol(FUN_004388ae(max))` */
export const randTrunc = (max: number): number => Math.trunc(rand(max));
