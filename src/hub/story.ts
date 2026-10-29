// The hub story handler protocol (M5), generalised from the island's FUN_004b7040 (src/zones/z02LGI/story.ts): the hub's GameLoop calls
// `handler(&next, &prev, node)` after the story FSM frame (FUN_00423bad) whenever var 0x58 (FSM_CURRENT_STATE) differs from the node it last handled, and the
// set-up calls it once with an uninitialised `prev` (docs/re/m4/emu.md: the "just advanced" branches never run at set-up). While a cutscene runs it should do
// nothing and leave `ref.prev` alone, so it runs again next frame. Returns the loop's exit state: `EXIT.RUNNING` (1) = stay, 2 = leave with the zone in `ref.next`.
import type { HubContext } from './ctx.ts';

/** `*prev` (the node the handler last handled) and `*next` (the zone it asks for when it returns 2) */
export interface StoryRef { prev: number; next: number }

/** what a hub's story handler touches (the engine calls every hub handler makes; the island's `StoryEnv` plus a flag for the set-up call) */
export interface HubStoryEnv {
  /** the call the set-up itself makes (its record flag / variable writes were made by the emulation: `vars` and flags are read-only then) */
  readonly setupCall: boolean;
  readonly ictx: HubContext;
  /** FUN_0045c432 (always false during the set-up call) */
  cutsceneActive(): boolean;
  vars: { get(i: number): number; set(i: number, v: number): void; or(i: number, v: number): void; andNot(i: number, v: number): void };
  /** record flags word (+0x60) */
  flags(rec: number): number;
  setFlags(rec: number, v: number): void;
  /** FUN_00423ff6 + FUN_0088d296 (free both tables), FUN_00423fe0(path) (npc table) / FUN_0088d280(path) (hologram table): `addr` = VA of the path string */
  freeTexts(): void;
  npcText(addr: number): void;
  holText(addr: number): void;
  /** the objective setters: FUN_00424270 / FUN_00424230 / FUN_0042419f / FUN_004242b9 */
  objRecord(rec: number, r: number): void;
  objPair(a: number, b: number, r: number): void;
  objFour(a: number, b: number, c: number, d: number): void;
  objNode(node: number, r: number): void;
  /** FUN_0088d2bc: the hologram's 90-frame alert */
  holoAlert(): void;
}

/** a hub's story handler port: `(env, ref, node) -> exit state` (EXIT.RUNNING = stay) */
export type HubStoryHandler = (env: HubStoryEnv, ref: StoryRef, node: number) => number;

/** the live environment of a running hub (`setupCall`: the set-up's own call, which must not write: the emulation already did) */
export function liveHubStoryEnv(ictx: HubContext, setupCall = false): HubStoryEnv {
  const w = ictx.world, g = ictx.goal;
  return {
    setupCall, ictx,
    cutsceneActive: () => !setupCall && ictx.cutsceneActive(),
    vars: setupCall ? { get: (i) => w.vars.get(i), set: () => {}, or: () => {}, andNot: () => {} } : w.vars,
    flags: (r) => (w.records[r]?.flags ?? 0) & 0xffff,
    setFlags: (r, v) => { const rec = w.records[r]; if (rec && !setupCall) rec.flags = (rec.flags & ~0xffff) | (v & 0xffff); },
    freeTexts: () => { ictx.setText('npc', null); ictx.setText('hol', null); },
    npcText: (a) => ictx.setText('npc', ictx.pe.cstr(a)),
    holText: (a) => ictx.setText('hol', ictx.pe.cstr(a)),
    objRecord: (r, rad) => g.record(r, rad),
    objPair: (a, b, rad) => g.pair(a, b, rad),
    objFour: (a, b, c, d) => g.four(a, b, c, d),
    objNode: (n, rad) => g.pathNode(n, rad),
    holoAlert: () => { if (!setupCall) g.alertHolo(); },
  };
}
