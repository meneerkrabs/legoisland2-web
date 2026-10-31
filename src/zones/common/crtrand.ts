// The original's random numbers with an injectable rand() source, for zone state objects that keep their own `env.rng` (tests inject a scripted source, the game the shared CRT
// generator src/game/crt.ts): FUN_004388ae(x) exactly as the x87 at 24-bit precision runs it, and the `ftol(FUN_004388ae((float) ms)) % n` pick of the sites that scale
// rand() by the milliseconds since the zone's start (FUN_00435c91).
import { rand as crtRand } from '../../game/crt.ts';

/** the C runtime's rand(): 0 .. 32767 (FUN_0085daf0) */
export type RandSource = () => number;
export { crtRand };

const fr = Math.fround;
/** FUN_004388ae(x): `x <= 0 ? 0 : (float) rand() / 32767.0f * x`, each operation rounded to float32 (the result is stored as a float); x <= 0 draws nothing */
export function randFrom(rnd: RandSource, x: number): number { return x <= 0 ? 0 : fr(fr(rnd() / 32767) * fr(x)); }
/** `ftol(FUN_004388ae((float) ms)) % n` (also `& 1` / `& 3` for n = 2 / 4: the value is never negative); `ms` = FUN_00435c91's result (an int, passed on as a float) */
export function pickFrom(rnd: RandSource, ms: number, n: number): number { return Math.trunc(randFrom(rnd, ms)) % n; }
