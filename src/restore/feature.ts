// A restored feature (one entry of RESTORE_FEATURES in flag.ts) contributes to the hooks through this record; `index.ts` composes the enabled ones into `restoreHooks`.
// Each feature lives in its own file `features/<id>.ts` and exports `feature`. Mark in every file what is ORIGINAL (data / code of the game, reused) and what is RECONSTRUCTION (invented),
// and keep the same table in docs/re/restore.md.
import type { MsgEntry, MessageTable } from '../ui/strings.ts';
import type { SoundTableEntry } from '../formats/sound.ts';
import type { RestoreFeatureId } from './flag.ts';
import type { ScriptPatch } from './scripts.ts';

export interface Feature {
  id: RestoreFeatureId;
  /** rule P script patches (scripts.ts) */
  scripts?: ScriptPatch[];
  /** overlay lines per message file (`LI/Data/lifsm1.str`, case-insensitive path); evaluated lazily (orphan indices are known by then) */
  messages?: Record<string, () => MsgEntry[]>;
  /** `say` rewrite / chain (flag.ts `RestoreHooks.say`); the first enabled feature that returns a value wins */
  say?: (table: MessageTable, id: string, id2: string | undefined, speak: (table: MessageTable, id: string, id2?: string) => boolean) => boolean | undefined;
  startCutscene?: (slot: number, start: (slot: number) => boolean) => boolean | undefined;
  /** true while the feature keeps a chained cutscene pending */
  cutscenePending?: () => boolean;
  /** the island zone game (`IslandGame`, src/zones/z02LGI/index.ts) */
  islandStart?: (game: unknown) => void;
  islandTick?: (game: unknown) => void;
  soundPatch?: (sounds: SoundTableEntry[]) => void;
  /** named cues of the zones (cues.ts): `ctx` is whatever the zone passes (at least `{ sfx(id) }`) */
  cue?: (name: string, ctx?: unknown) => void;
}
