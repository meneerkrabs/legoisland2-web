// Message-table overlays of the restored content. RECONSTRUCTION helpers (no game data): an overlay replaces the entries of the same tag and adds new ones; the result is an ordinary
// `MessageTable` (the original's sort + binary search, src/ui/strings.ts), so everything that reads texts / voice ids keeps working unchanged.
import { MessageTable } from '../ui/strings.ts';
import type { MsgEntry } from '../ui/strings.ts';
import { ORPHAN_LINES } from './lines.nl.ts';

/** length of the executable's speech table (`readExeSpeechTable`): the orphan files get the indices behind it (checked by tools/tests/restore-core.mjs) */
export const SPEECH_BASE = 1732;

/** the orphan speech files in index order: index = SPEECH_BASE + position (the names are identifiers; the subtitle texts are lines.nl.ts) */
export const ORPHAN_NAMES: readonly string[] = Object.keys(ORPHAN_LINES);
const ORPHAN_INDEX = new Map(ORPHAN_NAMES.map((n, i) => [n.toUpperCase(), SPEECH_BASE + i]));

/** the speech index of an orphan file (upper-case name without `.mp3`), -1 when it is not an orphan */
export function orphanIndex(name: string): number { return ORPHAN_INDEX.get(name.toUpperCase()) ?? -1; }

/** `extraSpeech` hook: the table gets the orphan names behind its original entries (padded when the table is shorter than expected) */
export function extendSpeech(speech: string[]) {
  while (speech.length < SPEECH_BASE) speech.push('');
  if (speech.length === SPEECH_BASE) for (const n of ORPHAN_NAMES) speech.push(n);
}

/** an overlay line: `tag` -> speech clip `clip` (an orphan: its own index; else the speech table index `idx`) and a text. `text` defaults to the orphan's subtitle (lines.nl.ts) */
export function line(tag: string, clip: string | number, text?: string): MsgEntry {
  const idx = typeof clip === 'number' ? clip : orphanIndex(clip);
  if (idx < 0) throw new Error(`restore: ${clip} is not an orphan speech file`);
  const t = text ?? (typeof clip === 'string' ? ORPHAN_LINES[clip.toUpperCase()] : undefined);
  if (t === undefined) throw new Error(`restore: no text for ${tag}`);
  return { tag, field: String(idx).padEnd(4, ' ').slice(0, 4), text: t };
}

/** a table with `entries` laid over `table` (same tag replaced) */
export function overlay(table: MessageTable, entries: readonly MsgEntry[]): MessageTable {
  if (entries.length === 0) return table;
  const tags = new Set(entries.map((e) => e.tag));
  return new MessageTable([table.entries.filter((e) => !tags.has(e.tag)), entries.slice()]);
}
