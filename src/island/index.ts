// Importing this file registers every behaviour constructor of the island (registerCtor by the constructor's address, src/game/setup.ts) and gives the
// island zone game (src/zones/z02LGI) and the node tests one entry point.
import './npc/index.ts';
import './trigger/index.ts';
import './pizza/index.ts';
import './vehicles/index.ts';
import './ambient/index.ts';
export { ctxOf, tryCtx, installCtx } from './ctx.ts';
export type { IslandCtx } from './ctx.ts';
export { ArgView, recIndexOfPtr } from './args.ts';
