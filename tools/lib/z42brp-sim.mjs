// z42BRP: node helpers for scripted games: load the zone world and drive it tick by tick with logical buttons. The snapshot / restore and the roof bot are in
// src/zones/z42BRP/bot.ts (shared with the headless browser runs). Used by tools/tests/m6-z42BRP.mjs and tools/lib/z42brp-planner.mjs.
import { loadZone } from './engine-load.mjs';
import { prepareWorld } from '../../src/zones/z42BRP/nodes.ts';
import { statefulRng } from '../../src/zones/z42BRP/bot.ts';
export { BTN, tick, capture, restore, silently, Phase2Bot, statefulRng } from '../../src/zones/z42BRP/bot.ts';

/** a fresh zone world (phase 1), nodes initialised, deterministic random numbers */
export function newGame(ctx, { seed = 1, subgame = 29 } = {}) {
  const L = loadZone(ctx, 'z42BRP', { subgame });
  const w = L.world;
  w.externalInput = true;
  const S = prepareWorld(w, L.archive);
  S.env.rng = statefulRng(seed);
  return { L, w, S, archive: L.archive };
}
