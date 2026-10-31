// z39ASB tests: a scripted rand() (MSVC LCG with a private seed, 0 .. 32767) behind the belt's `BeltRng` (the game draws from the shared generator, src/game/crt.ts)
import { BeltRng } from '../../src/zones/z39ASB/belt.ts';

export const msvcSource = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; }; };
export const seededRng = (seed) => new BeltRng(msvcSource(seed));
