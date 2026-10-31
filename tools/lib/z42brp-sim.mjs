// z42BRP: node helpers for scripted games: load the zone world and drive it tick by tick with logical buttons. The snapshot / restore and the roof bot are in
// src/zones/z42BRP/bot.ts (shared with the headless browser runs). Used by tools/tests/m6-z42BRP.mjs and tools/lib/z42brp-planner.mjs.
import { loadZone } from './engine-load.mjs';
import { prepareWorld } from '../../src/zones/z42BRP/nodes.ts';
import { statefulRng, tick as tickBot } from '../../src/zones/z42BRP/bot.ts';
export { BTN, capture, restore, silently, Phase2Bot, statefulRng } from '../../src/zones/z42BRP/bot.ts';

/**
 * one tick holding `mask`; a world made with `dt: 'real'` also runs the loop's step rule after the tick (World.advanceDt = FUN_00443e40: dt 1 for the first five frames, then 0.5),
 * like the shell's loop does in the game
 */
export function tick(w, mask = 0) { tickBot(w, mask); if (w.__realDt) w.advanceDt(); }

/** a fresh zone world (phase 1), nodes initialised, deterministic random numbers (the scripted rand() source `statefulRng`); `dt` = world.dt (0.5 = the 60 Hz step the game runs at after its first five frames; 'real' = the game's own rule: 1 for the first five frames, then 0.5, `tick` advances it) */
export function newGame(ctx, { seed = 1, subgame = 29, dt = 1 } = {}) {
  const L = loadZone(ctx, 'z42BRP', { subgame });
  const w = L.world;
  w.externalInput = true;
  w.__realDt = dt === 'real';
  w.dt = w.__realDt ? 1 : dt;
  const S = prepareWorld(w, L.archive);
  S.env.rng = statefulRng(seed);
  return { L, w, S, archive: L.archive };
}
