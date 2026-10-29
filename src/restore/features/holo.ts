// Restored feature 'holo' (item 14 of docs/re/restore-plan.md, docs/re/restore.md): hologram hints that the original's duplicate tags shadow.
//
// ORIGINAL: the hologram (src/island/trigger/holo.ts, hOLO.c) speaks `HOLOA`, `HOLOB` ... of the story's hint table with `say(table, id)`. Two of the original tables carry TWO `HOLOA` lines; the original's
//   sort + binary search (src/ui/strings.ts, FUN_004396a0) returns the LATER duplicate, so the earlier one never plays (verified by tools/tests/restore-holo.mjs):
//   * `LI/Data/LIHOL9.str` (nodes 32..51): `HOLOA:681` ("pages back", LEHMRP01) is shadowed by `HOLOA:682` ("bring the helicopter to Adventure island", LETIPC01; `HOLOB:683` follows it);
//   * `LI/Data/LIHOL6.str` (node 8): `HOLOA:177` (the warning that `HOLOB..E` 178..181 continue) is shadowed by `HOLOA:182`.
//   `LIHOL16.str` (`HOLOA:685`) is selected by no story band and STAYS unused (nothing in the story fits it).
// RECONSTRUCTION (the state tests, invented; no game text is stored here, the lines are the table's own entries):
//   * LIHOL9: 681 while the pages are in hand and Pepper is on foot: NUM_PAGES (var 0xa5) >= 2 (the era-2 total, HUD `n/2`) and PEPPER_CONTROL (var 0x5e) bit 0 (walking); otherwise 682 (the shipped line).
//   * LIHOL6: the first time the hint is asked (`HOLOA`) per session it is 177 (so that the B..E follow-ups read as its continuation); every later `HOLOA` is 182 (the shipped line).
import type { Feature } from '../feature.ts';
import { MessageTable } from '../../ui/strings.ts';
import type { MsgEntry } from '../../ui/strings.ts';
import { captureIsland, islandVar } from '../islandenv.ts';

/** speech indices of the shadowed (earlier) and the shipped (later) duplicate `HOLOA` of a table: the game's own constants */
export const HOLO_TABLES: Readonly<Record<number, { band: string; early: number }>> = {
  682: { band: 'LIHOL9', early: 681 },
  182: { band: 'LIHOL6', early: 177 },
};
export const VAR_NUM_PAGES = 0xa5, VAR_PEPPER_CONTROL = 0x5e;
let seen6 = false;
export function resetHolo() { seen6 = false; }

const voiceOf = (e: MsgEntry) => parseInt(e.field, 10);
type Speak = (table: MessageTable, id: string, id2?: string) => boolean;

/** should the shadowed (earlier) line play now */
function wantEarly(band: string): boolean {
  if (band === 'LIHOL9') {
    const pages = islandVar(VAR_NUM_PAGES), ctl = islandVar(VAR_PEPPER_CONTROL);
    return pages !== undefined && ctl !== undefined && pages >= 2 && (ctl & 1) !== 0;
  }
  return !seen6;   // LIHOL6
}

export function sayHolo(table: MessageTable, id: string, speak: Speak): boolean | undefined {
  if (id !== 'HOLOA') return undefined;
  const dup = table.entries.filter((e) => e.tag === 'HOLOA');
  if (dup.length !== 2) return undefined;
  const info = HOLO_TABLES[table.voice('HOLOA')];     // the table's own winner = the later duplicate
  if (!info || voiceOf(dup[0]) !== info.early) return undefined;
  if (!wantEarly(info.band)) return undefined;
  // a one-line table with the shadowed entry under the tag the hologram asked for: voice and text are the entry's own
  const ok = speak(new MessageTable([[dup[0]]]), 'HOLOA');
  if (ok && info.band === 'LIHOL6') seen6 = true;
  return ok;
}

export const feature: Feature = {
  id: 'holo',
  say: (table, id, _id2, speak) => sayHolo(table, id, speak),
  islandStart: (g) => captureIsland(g),
};
