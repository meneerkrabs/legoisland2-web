// The original's random numbers (FUN_004388ae / FUN_00435c91), shared by the zones that draw `ftol(FUN_004388ae(x)) % n`.
//   FUN_004388ae(x) = x <= 0 ? 0 : rand() / 32767 * x      (rand() = the C runtime's 15 bit generator, FUN_0085daf0)
//   FUN_00435c91()  = GetTickCount() - base                (milliseconds since the game's clock base, DAT_009dab64)
import { msvcRand, type RandFn } from '../../fx/particles/core.ts';

/** RNG: the C runtime `rand()` (0..32767) behind these draws; the node tests inject a scripted one, WP-TIME the shared generator */
let source: RandFn = msvcRand((Date.now() / 1000) | 0);
export function setTickRandSource(f: RandFn | null) { source = f ?? msvcRand((Date.now() / 1000) | 0); }

/** FUN_004388ae(x) in double precision (the x87 result before the caller's store / __ftol) */
export function rand(x: number, rnd: RandFn = source): number { return x <= 0 ? 0 : (rnd() / 32767) * x; }

/** FUN_00435c91 with the port's clock: ms since the zone's start (the tick counter at 30 Hz * dt) */
export const msClock = (w: { tickCount: number; dt: number }): number => Math.trunc((w.tickCount * w.dt * 1000) / 30);

/** `ftol(FUN_004388ae((float) GetTickCount-ish)) % n` (also `& 3` / `& 7` for n = 4 / 8: the value is never negative) */
export function tickPick(ms: number, n: number, rnd: RandFn = source): number { return Math.trunc(rand(Math.fround(ms), rnd)) % n; }

/** RNG: a [0, 1) draw from the C runtime generator behind the game's FUN_004388ae / rand() call sites (the default `rand` of zones whose nodes take an injectable one) */
export function gameRandom(rnd: RandFn = source): number { return rnd() / 32768; }
