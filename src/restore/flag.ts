// The optional mode "Herstelde inhoud" (restored content): the switch and the hook table. docs/re/restore-plan.md section 4 (R0), docs/re/restore.md (what is original and what is reconstructed).
//
// THIS FILE IS THE ONLY PART OF src/restore/ THAT SHARED FILES IMPORT STATICALLY, and it is tiny: `restoredOn()` / `restoredFeature(id)` and the object `restoreHooks`, whose members are all
// `undefined` until `loadRestore()` has run. `loadRestore()` imports the real implementation (`./index.ts`, a separate chunk: with the option off nothing of src/restore/** is ever requested)
// and fills the hooks. The shared files only get additive one-liners of the form `restoreHooks.x?.(...)`; with the option off every one of them does nothing, so the game is exactly the original.
import { currentPrefs } from '../display.ts';
import type { Archive } from '../formats/archive.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { SoundTableEntry } from '../formats/sound.ts';

/** every individually switchable feature: id -> label of the option page ("Herstelde inhoud" folded list) */
export const RESTORE_FEATURES = [
  { id: 'lgi11', label: 'Rattenvanger-scene: Nick arresteert de radio (LGI11)' },
  { id: 'battery', label: 'Batterijen voor de radio (zijmissie)' },
  { id: 'arrow', label: 'Richtingspijl naar het doel' },
  { id: 'tips', label: 'Tips van Darren' },
  { id: 'cutlines', label: 'Geschrapte filmregels op het eiland (Valerie, rattenvanger ...)' },
  { id: 'hubcuts', label: 'Geschrapte filmregels in de werelden (kasteel, Dr. Pepper ...)' },
  { id: 'voicefix', label: 'Stemfouten gerepareerd' },
  { id: 'voiceswap', label: 'Andere stemmen voor de agenten Nick en Lick' },
  { id: 'joke', label: 'Grappenreeks in het kasteel (drie regels)' },
  { id: 'cues', label: 'Geluiden die in het origineel stil bleven' },
  { id: 'popups', label: 'Ongebruikte meldingen in de minispellen' },
  { id: 'looks', label: 'Extra voertuiguiterlijken' },
  { id: 'swimmer', label: 'Zwemmende Brikimal' },
  { id: 'cave', label: 'Ontwikkelaarsgrot zonder cheatcode' },
  { id: 'holo', label: 'Verborgen hologramtips' },
  { id: 'page', label: 'Visser geeft de bladzijde', unfinished: true },   // script exists, not wired (docs/re/restore.md)
  { id: 'hubnpc', label: 'Verborgen figuren in het kasteel', unfinished: true },   // not built (R-A11)
] as const;
export type RestoreFeatureId = typeof RESTORE_FEATURES[number]['id'];

/** the hook table: every member stays `undefined` with the option off (tests: `tools/tests/restore-off.mjs`) */
export interface RestoreHooks {
  /** cutscene-host `declare()`: replacement `.cut` bytes for a script (rule P, scripts.ts), undefined = the archive's own */
  script?: (arc: Archive, zone: string, name: string) => Uint8Array | undefined;
  /** the message tables (island / hub `table()`, cutscene-host `declare()`): `path` = `LI/Data/lifsm1.str`; returns the table to use */
  messages?: (path: string, table: MessageTable) => MessageTable;
  /** `GameAudio.create`: append the names of the orphan speech files to the speech table (index = the number in a `.str` voice field) */
  extraSpeech?: (speech: string[]) => void;
  /** `IslandContext.say` / `HubContext.say`: handle (rewrite, chain) a request; returns the result, or undefined = the normal path. `speak` is the normal path */
  say?: (table: MessageTable, id: string, id2: string | undefined, speak: (table: MessageTable, id: string, id2?: string) => boolean) => boolean | undefined;
  /** `IslandContext.startCutscene`: start something else / more (the LGI11 chain); `start` is the normal path; undefined = the normal path */
  startCutscene?: (slot: number, start: (slot: number) => boolean) => boolean | undefined;
  /** `IslandContext.cutsceneActive`: true while a chained cutscene is pending; `active` is the normal answer */
  cutsceneActive?: (active: boolean) => boolean;
  /** the island zone game's construction / every update tick: `game` is the `IslandGame` (src/zones/z02LGI/index.ts) */
  islandStart?: (game: unknown) => void;
  islandTick?: (game: unknown) => void;
  /** `readAudioTables`: change entries of the sound table (flowers silent -> the real files) */
  soundPatch?: (sounds: SoundTableEntry[]) => void;
  /** a named cue at an event of a zone (one guarded call per zone, `cues.ts`); `ctx` has the zone's `sfx(id)` etc. */
  cue?: (name: string, ctx?: unknown) => void;
}
export const restoreHooks: RestoreHooks = {};

// test aid: force the option without a browser (`null` = ask the preferences)
let forced: { on: boolean; off: string[] } | null = null;
export function forceRestored(on: boolean | null, off: string[] = []) { forced = on === null ? null : { on, off }; }

/** is the option "Herstelde inhoud" on (the preferences are read when asked: they do not change during a session) */
export function restoredOn(): boolean {
  if (forced) return forced.on;
  try { return currentPrefs().restored; } catch { return false; }
}
/** is one feature on: the option is on and the player did not switch it off */
export function restoredFeature(id: RestoreFeatureId): boolean {
  if (!restoredOn()) return false;
  if (forced) return !forced.off.includes(id);
  try { return !currentPrefs().restoredOff.includes(id); } catch { return false; }
}

/** called once at game start (main.ts `start`) before anything that has a hook: loads `./index.ts` (dynamic, a separate chunk) only when the option is on */
export async function loadRestore(): Promise<boolean> {
  if (!restoredOn()) return false;
  const m = await import('./index.ts');
  m.installRestore();
  return true;
}
