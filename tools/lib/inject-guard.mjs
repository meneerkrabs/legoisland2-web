// Test isolation: the single-process runner (tools/test-formats.mjs) runs every test in the same module graph, so a source a test injects into the shared C runtime
// (src/game/crt.ts rand / time / GetTickCount), the island's `rand` (src/island/rng.ts; `setAmbientRandom` is the same setter) or the zones' tick random
// (src/zones/common/tickrand.ts) must not outlive it. `guarded(test)` resets all of them when the test ends, however it ends.
import { setRandSource, setTimeSource, setTickCountSource } from '../../src/game/crt.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { setTickRandSource } from '../../src/zones/common/tickrand.ts';

export function resetInjected() {
  setRandSource(null); setTimeSource(null); setTickCountSource(null); setIslandRandom(null); setTickRandSource(null);
}

/** { name, run } -> the same test with the injected sources (and a replaced `Math.random`) reset before and after it runs */
export function guarded(test) {
  return {
    ...test,
    async run(ctx) {
      const realRandom = Math.random;
      resetInjected();
      try { return await test.run(ctx); } finally { resetInjected(); Math.random = realRandom; }
    },
  };
}
