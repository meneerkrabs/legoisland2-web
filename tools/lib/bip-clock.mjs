// z22BIP oracle harness helpers: the port reads the SHARED C runtime (src/game/crt.ts: rand / srand / GetTickCount, src/zones/common/tickrand.ts: the zone clock) while the original runs its own
// copy in the x86 interpreter. A scenario pins both sides to the same stand-ins: the generator is re-seeded with 1 (the CRT's initial seed, the emulator's memory image) and GetTickCount - base
// (FUN_00435c91) follows the world's tick count (a tick = dt * 1000 / 30 ms, base 0), which is what the emulator's hook returns.
import { setTickCountSource, srand } from '../../src/game/crt.ts';
import { startTickClock } from '../../src/zones/common/tickrand.ts';

/** pin the port's clock to `w.tickCount * w.dt * 1000 / 30` ms (the oracle hook's stand-in) and re-seed the generator with 1 */
export function pinBipClock(w) {
  setTickCountSource(() => 0); startTickClock();
  setTickCountSource(() => Math.trunc(w.tickCount * w.dt * 1000 / 30));
  srand(1);
}
export function unpinBipClock() { setTickCountSource(null); }
