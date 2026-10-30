// The save game sections that belong to engine singletons rather than to records: the waypoint walker table, the decor blob, the brick effect slots. The module that owns the state
// registers its part when it is loaded (`registerSavePart`); a missing part saves the empty / default content and loads nothing. All parts get the world they run in.
import type { World } from '../game/world.ts';

/** FUN_00462d8b's output: the 60 raw walker structs (0x84 bytes each, 0x1ef0) and the record tag of each walker (0x3c dwords) */
export interface WalkerBlob { walkers: Uint8Array; tags: Uint32Array }

export interface SaveParts {
  /** the waypoint walker table (FUN_00462d8b writer / FUN_00462e75 loader, src/game/walker.ts) */
  walkers?: { capture(w: World): WalkerBlob; apply(w: World, b: WalkerBlob): void };
  /** the decor blob, 0x1c0 x {set, variant} (FUN_00421f56 = FUN_00421eb3 refresh + copy / FUN_00421f7b copy, src/island/decor.ts) */
  decor?: { capture(w: World): Uint8Array; apply(w: World, blob: Uint8Array): void };
  /** the brick effect slots (FUN_00447c90 / FUN_00449a10 writer, FUN_00447ca0 / FUN_00449be0 loader, src/fx/bricks): 64 entries, null = unused slot */
  bricks?: { capture(w: World): (Uint8Array | null)[]; apply(w: World, slots: (Uint8Array | null)[]): void };
}

export const saveParts: SaveParts = {};
export function registerSavePart<K extends keyof SaveParts>(k: K, v: NonNullable<SaveParts[K]>) { saveParts[k] = v; }
