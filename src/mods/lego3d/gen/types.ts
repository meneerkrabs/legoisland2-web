// What a LEGO 3D generator gets and gives (docs/re/lego3d.md section 8). A generator reads the player's own archive (and the data pack) and puts replacement members
// into `env.out` (path relative to the archive root, '/' separators, any case: the archive layer is case-insensitive). Nothing of the game is ever written anywhere but into
// the run-time archive layer (`Archive.override`) and the local cache of the result.
import type { Archive } from '../../../formats/archive.ts';
import type { Pack } from '../pack.ts';

export interface GenEnv {
  pack: Pack;
  /** the archive's name as the game calls it: `z02LGI`, `Bricks`, ... */
  name: string;
  /** the player's archive (with the mods' own replacements already in it) */
  archive: Archive;
  /** members generated so far for this archive (earlier generators): later ones see them through `read` */
  out: Map<string, Uint8Array>;
  /** current bytes of a member: generated first, else the archive's; null when there is none */
  read(member: string): Uint8Array | null;
  /** another archive of the game (Bricks, Overlays ...), null if it is not available */
  other(name: string): Promise<Archive | null>;
  /** put a replacement member (case-insensitive path); remembers which generator wrote it */
  put(member: string, bytes: Uint8Array): void;
  /** counters for the report (`meshes`, `triangles-before`, `triangles-after`, ...): summed per generator */
  stats: Record<string, number>;
  log(msg: string): void;
  /** debugging switches from `?lego3d=` (e.g. ["chars", "-studs"]) */
  options: Set<string>;
}

export interface Generator {
  id: string;
  /** false: nothing to do for this archive (cheap check on the name / the pack's tables) */
  applies(name: string, pack: Pack): boolean;
  run(env: GenEnv): Promise<void>;
}
