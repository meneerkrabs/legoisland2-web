// The hub framework entry point (M5, docs/re/m5/foundation.md): importing this registers every behaviour constructor of the shared island node families
// (src/island: Turn2Pep, MeetPepp, SGMFIG, Human1, StartCSM, buildings, Pizza, SGwalk, sgswim, PepSwitc ... by constructor address) and exports the hub
// context / game / registration. A hub module is then:
//   import '../../hub/index.ts';
//   registerHub({ archive: 'z07CSI', story: csiStory, frame: csiHud, ... });
import '../island/index.ts';
export { HubContext } from './ctx.ts';
export { HubGame, registerHub, hubOf, hubSlotSpecs } from './game.ts';
export type { HubSpec, HubArrival, HubArrivalEnv } from './game.ts';
export { liveHubStoryEnv } from './story.ts';
export type { HubStoryEnv, HubStoryHandler, StoryRef } from './story.ts';
export { ctxOf, tryCtx } from '../island/ctx.ts';
export type { IslandCtx } from '../island/ctx.ts';
export { emulatedArrival, applyEmulatedArrival } from './arrival.ts';
export type { EmulatedArrival } from './arrival.ts';
export { replaySetupState } from './setupstate.ts';
