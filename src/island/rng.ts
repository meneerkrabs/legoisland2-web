// The island's random numbers: the original's C runtime `rand()` (0..32767) and FUN_004388ae(max) = (float)rand() / 32767.0f * max, both operations rounded to a float32 (24-bit x87), 0 for max <= 0 (no draw).
// The generator is injectable: the node tests pass a deterministic one (a source of numbers v in [0, 1): rand() = floor(v * 32768)); without an injected source the draws come from the shared MSVC LCG
// (src/game/crt.ts `rand()`, seeded with time() at start-up and by the zones that call srand, T2 in docs/re/gaps.md): the one global generator of the original (DAT_00964aa4).
import { rand as crtRand, randF } from '../game/crt.ts';
let source: (() => number) | null = null;
/** tests: a source of numbers in [0, 1) (null = the shared C runtime generator, src/game/crt.ts) */
export function setIslandRandom(f: (() => number) | null) { source = f; }
/** the injected source (null = the shared C runtime generator, src/game/crt.ts): tests restore what they replaced */
export const getIslandRandom = () => source;
/** the C runtime's rand(): 0 .. 32767 */
export const randInt = (): number => (source ? Math.floor(source() * 32768) & 0x7fff : crtRand());
const fr = Math.fround;
/** FUN_004388ae(max): `(float)rand() / 32767.0f * max` (every operation a float32); max <= 0 gives 0 without a draw */
export const rand = (max: number): number => (max <= 0 ? 0 : source ? fr(fr(randInt() / 32767) * fr(max)) : randF(max));
/** `__ftol(FUN_004388ae(max))` */
export const randTrunc = (max: number): number => Math.trunc(rand(max));
