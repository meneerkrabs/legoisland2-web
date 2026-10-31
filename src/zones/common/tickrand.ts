// The original's random numbers (FUN_004388ae / FUN_00435c91), shared by the zones that draw `ftol(FUN_004388ae(x)) % n`.
//   FUN_004388ae(x) = x <= 0 ? 0 : rand() / 32767 * x      (rand() = the C runtime's 15 bit generator, FUN_0085daf0)
//   FUN_00435c91()  = GetTickCount() - base                (milliseconds since the game's clock base, DAT_009dab64)
import type { RandFn } from '../../fx/particles/core.ts';
import { rand as crtRand, getTickCount } from '../../game/crt.ts';

/** the C runtime `rand()` (0..32767) behind these draws (the shared generator src/game/crt.ts); the node tests inject a scripted one (`setRandSource` there, or `setTickRandSource` here) */
let source: RandFn = crtRand;
export function setTickRandSource(f: RandFn | null) { source = f ?? crtRand; }

/** FUN_004388ae(x) in double precision (the x87 result before the caller's store / __ftol) */
export function rand(x: number, rnd: RandFn = source): number { return x <= 0 ? 0 : (rnd() / 32767) * x; }

/** DAT_009dab64: the clock base, set by FUN_00435c81 (`DAT_009dab64 = GetTickCount()`) at the start of every zone's run (see `startTickClock`) */
let clockBase = getTickCount();
/** FUN_00435c81: restart the zone clock; call it where the original's zone entry does (z05WAB, z16PYA, z17WAS, z22BIP, ...) */
export function startTickClock(): void { clockBase = getTickCount(); }

/** FUN_00435c91: `GetTickCount() - DAT_009dab64`, the REAL milliseconds since the zone's start (the original reads the wall clock, so do we: it only scales random picks;
 *  tests pin it with `setTickCountSource` of src/game/crt.ts). The argument is unused (the old signature took the world to derive a 30 Hz stand-in). */
export const msClock = (_w?: unknown): number => (getTickCount() - clockBase) | 0;

/** `ftol(FUN_004388ae((float) GetTickCount-ish)) % n` (also `& 3` / `& 7` for n = 4 / 8: the value is never negative) */
export function tickPick(ms: number, n: number, rnd: RandFn = source): number { return Math.trunc(rand(Math.fround(ms), rnd)) % n; }

/** a [0, 1) draw (`rand() / 32768`) from the C runtime generator behind the game's FUN_004388ae / rand() call sites: the default `rand` of zones whose nodes take an injectable one; call sites that need `rand() / 32767` use `randF` / `randD` of src/game/crt.ts */
export function gameRandom(rnd: RandFn = source): number { return rnd() / 32768; }
