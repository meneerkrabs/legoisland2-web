// Restored feature 'page' (docs/re/restore-plan.md item 15 / R-A7, docs/re/restore.md): the fisherman hands over the page, lines ADCSOA13 / ADCSOA14 ("Ik dacht wel dat je de bladzijde kon gebruiken, daarom heb ik hem met mijn hengel
// eruit gevist." / "Alsjeblieft Pepper, hier is de volgende bladzijde!") as a new cutscene `adv04b` in z21FSH.
// STATUS: the SCRIPT is built and tested (tools/tests/restore-page.mjs); the WIRING is NOT done (it needs the z21FSH win / loss trigger and the z13CAI hand-over, both owned by other workers: see docs/re/restore.md "page").
// ORIGINAL: the two lines (AI/Data/ADV04.str ids 1471 / 1472, both mp3 exist, in the speech table) and every actor / command word used below (all occur in adv04.txt / adv11.txt of the same zone).
// RECONSTRUCTION: the script itself (nothing in the data says when it plays: the staging is copied from the end of adv04), the speaker (the fisherman `fshm`: the voice is the same low voice as ADCSOA11 / 12) and the trigger.
import type { Feature } from '../feature.ts';
import { compileCutscene } from '../../formats/cutscene.ts';

/** the new script's name and zone: declared as one more slot of z21FSH (FSH_CUTSCENES in src/zones/z21FSH.ts) */
export const PAGE_SCRIPT = { zone: 'z21FSH', script: 'adv04b', strings: 'ADV04', area: 'ai' } as const;

/** the script text (tab separated like the game's own scripts; blocks 0 / 5 / 10 / 20, 11 commands) */
export const ADV04B_TEXT = [
  '[HEADER]', 'CSMSCRIPTVERSION\t0', 'SCRIPTENAME\t\tFishermanHandsPage', '', '[SCRIPT]',
  '0\t0.0\t\tcmra\tsetposition\tactor\tfshm\tfront',
  '0\t0.0\t\tpepp\tfollow\t\tfshm\t5',
  '0\t0.0\t\tfshm\tfollow\t\tpepp\t5',
  '0\t0.0\t\tfshm\tsetanim\t\txidle',
  '',
  '5\t0.0\t\tfshm\tsetanim\t\txtalk',
  '5\t0.0\t\tfshm\tSayText\t\tADCSOA13\t10',
  '',
  '10\t0.0\t\tcmra\tsetposition\tactor\tpepp\tfront',
  '10\t0.0\t\tpepp\tsetanim\t\txwave\t15',
  '10\t0.0\t\tfshm\tSayText\t\tADCSOA14\t20',
  '',
  '20\t0.0\t\tpepp\tsetanim\t\txidle',
  '20\t0.0\t\tfshm\tsetanim\t\txidle',
  '',
].join('\n');

/** the compiled `.cut` bytes of `adv04b` (the same compiler as the game's own scripts: src/formats/cutscene.ts) */
export function adv04bCut(): Uint8Array { return compileCutscene(ADV04B_TEXT, { splineStart: 12 }); }

/** `restoreHooks.script`-style lookup for a script the archive does not have: bytes for `adv04b` of z21FSH, else undefined (to be called by `declare()` once it accepts a script the archive lacks) */
export function extraCut(zone: string, name: string): Uint8Array | undefined {
  return zone.toLowerCase() === PAGE_SCRIPT.zone.toLowerCase() && name.toLowerCase() === PAGE_SCRIPT.script ? adv04bCut() : undefined;
}

export const feature: Feature = { id: 'page' };
