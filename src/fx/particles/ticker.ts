// The per-sim-step advance of the particle engines (FUN_00442930 -> FUN_0044e8e0 runs once per pass of the original's main loop, i.e. once per drawn frame; the port's sim step IS that
// frame: fixed 60 Hz, no interpolation). A zone's `ZoneParticles` registers its `afterTick` here when it is created; the world's loop calls `tickParticles(world)` exactly once per
// `World.tick()`, right after it and BEFORE `advanceDt()` (the engine reads the step's own `world.dt` and `world.frame`). The render hook (`GameRenderer.particles`) only draws.
// Kept free of imports so that src/game/world.ts can use it without a cycle.
const live = new WeakMap<object, Set<() => void>>();

/** register an engine's step for `world`; returns the function that removes it again */
export function addParticleTicker(world: object, step: () => void): () => void {
  let set = live.get(world);
  if (!set) { set = new Set(); live.set(world, set); }
  set.add(step);
  return () => { set.delete(step); };
}

/** run every registered engine step of `world` once (call once per sim step) */
export function tickParticles(world: object): void {
  const set = live.get(world);
  if (set) for (const step of set) step();
}
