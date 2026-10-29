// Restored feature 'joke' (item 8 of docs/re/restore-plan.md, docs/re/restore.md): the three-line joke of the castle's tournament crowd.
//
// ORIGINAL: `CI/Data/CSIFSM4.str` (the castle hub's NPC lines) has, for the figures `BAR2` and `BAR4`, the chain `BAR2C` ("Hoe lang is lang?", 1292) - `UNUSED` (1293, "Hoe lang is een touwtje?") - `BAR2D` (1294) and
//   `BAR4C` / `UNUSED` (1303) / `BAR4D` (1304): a three-line joke that does not fit the conversation's two slots (`say(a, b)`, src/island/npc/sgmfig.ts: `<NAME>A+B`, then `<NAME>C+D`), so the middle line was renamed
//   `UNUSED` and left (1293 and 1303 are the same clip `CAJOBB12`). The audio and the text exist.
// RECONSTRUCTION (mechanics only): the second talk with such a figure says C and the middle line together (two clips are what one `say` carries), and `D` follows on the next request. The follow-up uses the NPC code's
//   own retry: a `say` that returns false makes SGMFIG keep the pair as `pending` and ask again when the speech is idle (sgmfig.ts `converse`), so no tick hook is needed (it also works in the hubs, where
//   `islandTick` does not run). State per figure: 0 = nothing said, 1 = C + middle said (D due). A request for the figure's `A` line starts over (a skipped conversation).
import type { Feature } from '../feature.ts';
import { MessageTable } from '../../ui/strings.ts';
import type { MsgEntry } from '../../ui/strings.ts';

/** the figure -> speech index of its `UNUSED` middle line (the game's own constants: checked against the table's voice field) */
export const MIDDLE: Readonly<Record<string, number>> = { BAR2: 1293, BAR4: 1303 };
const stage = new Map<string, number>();
export function resetJoke() { stage.clear(); }
export const jokeStage = (name: string) => stage.get(name) ?? 0;

type Speak = (table: MessageTable, id: string, id2?: string) => boolean;
/** the table's own entry of the middle line (tag `UNUSED`, the given speech index) */
const middleOf = (table: MessageTable, idx: number): MsgEntry | undefined => table.entries.find((e) => e.tag === 'UNUSED' && parseInt(e.field, 10) === idx);

export function sayJoke(table: MessageTable, id: string, id2: string | undefined, speak: Speak): boolean | undefined {
  const m = /^(BAR[24])([ACD])$/.exec(id);
  if (!m) return undefined;
  const name = m[1], idx = MIDDLE[name];
  if (m[2] === 'A') { stage.set(name, 0); return undefined; }   // a new conversation: start over; the line itself is the original's
  const mid = middleOf(table, idx);
  const c = table.find(`${name}C`), d = table.find(`${name}D`);
  if (!mid || !c || !d) return undefined;                        // not the table that holds the joke
  if (m[2] === 'C' && jokeStage(name) === 0) {
    // C + the middle line in one `say` (a private table: the entries are the game's own, the middle one under a fresh tag); false = "asked again when idle" (the NPC's pending retry)
    const ok = speak(new MessageTable([[c, { ...mid, tag: `${name}M` }]]), `${name}C`, `${name}M`);
    if (ok) stage.set(name, 1);
    return false;
  }
  if (m[2] === 'C' && jokeStage(name) === 1) {
    // the retried pair (C, D): D alone, the joke's end
    const ok = speak(table, `${name}D`);
    if (ok) stage.set(name, 0);
    return ok;
  }
  return undefined;
}

export const feature: Feature = {
  id: 'joke',
  say: (table, id, id2, speak) => sayJoke(table, id, id2, speak),
};
