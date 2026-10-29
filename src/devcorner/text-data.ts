// Ontwikkelaarshoek, section 9 "Teksten": the pure analysis of the message tables (runs in node; the DOM part is teksten.ts, the loading text-load.ts).
// Method = docs/re/unused.md 8.6 / 8.7, computed from the game files at run time:
//  - every `.str` of the `messages` archive is parsed like the original's loader (FUN_00439126, src/ui/strings.ts `parseMessageFile`);
//  - a line is REFERENCED ("getoond") when its tag is (a) an exact string of the EXE (a literal the code or a table holds; the speech-id strings of the speech table are
//    left out: the table lists every id, so they say nothing: only an occurrence outside the table's string pool counts; menu labels `!ID` / `@prefix!ID` count as `ID`),
//    (b) said by a cutscene (`SayText` in a compiled `.cut`), or (c) matches a runtime pattern: `CONTROL%i` (a format string of the EXE), `LEV<zone code>`, NPC lines
//    `<4 characters><A|B|C|D>` in the conversation tables (`*FSM<n>.str`: A/C first lines, B/D follow-ups, FUN_00424e37 / audio.md 6.4), `HOLO<letter>` (the hologram hints)
//    and `IFC<code><nn>` (the info centre's `!IFC<code>` + `%02d`; UNCERTAIN, the format is only partly visible);
//  - SHADOWED duplicates: the table is stable-sorted and searched with the original's binary search (`MessageTable.find` = FUN_004396a0), per file: the entry that
//    `find` does not return can never be shown;
//  - voice: the 4 characters after the ':' are the index into the EXE's speech table (FUN_00439bf8).
// Not exact / UNCERTAIN: (1) a tag that is only reached through data tables of the zones (not visible as an EXE string) would be reported "nooit getoond" (the research of
// unused.md has the same limit); (2) shadow detection looks at the duplicates of ONE file (the zone loader merges only a few files: brp.str + brp2.str, the menu's three
// tables), duplicates between merged files are not looked at; (3) the NPC pattern accepts every 4-character prefix.
import { parseMessageFile, MessageTable, expandMessage } from '../ui/strings.ts';
import type { MsgEntry } from '../ui/strings.ts';
import type { Archive } from '../formats/archive.ts';
import type { Pe } from '../formats/exe.ts';
import { parseCutscene } from '../formats/cutscene.ts';

/** one `.str` line */
export interface StrEntry extends MsgEntry {
  /** path as shown: `FE/Data/FRONTEND.str` (messages archive) or `z38PAR/Messages/English/PARSTR.str` (zone archive) */
  file: string;
  /** area folder of the messages archive (FE, LI, CI, AI, OG) or '' */
  area: string;
  /** file name without the extension */
  name: string;
  /** 1-based number of the entry in its file (order of the original's loader) */
  line: number;
  /** index into the speech table (the 4 character field), -1 = text only */
  voice: number;
  /** an English leftover inside a zone archive (not part of the game's tables) */
  english: boolean;
}

export interface StrFile { path: string; area: string; name: string; size: number; count: number }

/** the speech index of a 4 character field (FUN_00439bf8: `atoi`, -1 when it does not start with a digit) */
export function voiceOfField(field: string): number {
  const c = field.charCodeAt(0);
  return field.length > 0 && c >= 0x30 && c <= 0x39 ? parseInt(field, 10) : -1;
}

function entriesOf(path: string, data: Uint8Array, english: boolean): StrEntry[] {
  const m = /^(?:([A-Za-z]{2})\/Data\/)?(?:.*\/)?([^/]+?)\.str$/i.exec(path);
  const area = m?.[1]?.toUpperCase() ?? '';
  const name = m?.[2] ?? path;
  // a `.txt` (z27TRX english.txt) has no 4 character voice field: its whole value is the text
  const plain = /\.txt$/i.test(path);
  return parseMessageFile(data).map((e, i) => (plain ? { tag: e.tag, field: '', text: e.field + e.text, file: path, area, name, line: i + 1, voice: -1, english } : { ...e, file: path, area, name, line: i + 1, voice: voiceOfField(e.field), english }));
}

/** every `.str` of the messages archive (`messages` = 162 files / 2,370 lines per unused.md; computed here) */
export function parseAllStr(archive: Archive): { entries: StrEntry[]; files: StrFile[] } {
  const entries: StrEntry[] = [], files: StrFile[] = [];
  for (const e of archive.entries) {
    if (!/\.str$/i.test(e.path)) continue;
    const list = entriesOf(e.path, archive.read(e), false);
    entries.push(...list);
    files.push({ path: e.path, area: list[0]?.area ?? /^([A-Za-z]{2})\//.exec(e.path)?.[1]?.toUpperCase() ?? '', name: /([^/]+?)\.str$/i.exec(e.path)![1], size: e.size, count: list.length });
  }
  return { entries, files };
}

/** the English leftovers of the zone archives (unused.md 8.6): `.str` files and `english.txt` below a `messages/english` folder; entries carry `english: true` */
export function parseEnglish(archiveName: string, archive: Archive): StrEntry[] {
  const out: StrEntry[] = [];
  for (const e of archive.entries) {
    if (!/(^|\/)messages\/english\/.+\.(str|txt)$/i.test(e.path)) continue;
    out.push(...entriesOf(`${archiveName}/${e.path}`, archive.read(e), true));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the EXE side

/** the EXE's printable strings (runs of >= 3 characters 0x20..0x7e, like `exestr.py` of unused.md) with their file offsets, and the offsets of the speech table's string pool */
export interface ExeText {
  strings: Map<string, number[]>;
  /** file offsets of the strings the speech table (0x979098) points at */
  pool: Set<number>;
  /** the speech id strings of the table (index = speech index) */
  speech: string[];
}

export function exeTextIndex(pe: Pe): ExeText {
  const d = pe.data, strings = new Map<string, number[]>();
  const td = new TextDecoder('latin1');
  let st = -1;
  for (let i = 0; i <= d.length; i++) {
    const b = i < d.length ? d[i] : 0;
    if (b >= 0x20 && b <= 0x7e) { if (st < 0) st = i; continue; }
    if (st >= 0 && i - st >= 3) {
      const s = td.decode(d.subarray(st, i));
      const l = strings.get(s);
      if (l) l.push(st); else strings.set(s, [st]);
    }
    st = -1;
  }
  const pool = new Set<number>(), speech: string[] = [];
  for (let va = 0x979098; ; va += 4) {
    const p = pe.u32(va);
    const o = pe.offset(p);
    if (!(p > 0x890000 && p < 0x9a0000) || o < 0) break;
    pool.add(o);
    speech.push(pe.cstr(p));
  }
  return { strings, pool, speech };
}

/**
 * the tags the EXE names itself: `literal` = exact strings with an occurrence outside the speech pool (plus the `ID` of `!ID` / `@prefix!ID` labels), `pooled` = strings that
 * only occur as the speech table's own entry (unused.md counts these as named as well: weak evidence, the code can say a clip by its index)
 */
export function exeTagSets(ex: ExeText): { literal: Set<string>; pooled: Set<string> } {
  const literal = new Set<string>(), pooled = new Set<string>();
  for (const [s, offs] of ex.strings) {
    const lit = offs.some((o) => !ex.pool.has(o));
    const into = lit ? literal : pooled;
    into.add(s);
    if (s[0] === '!') into.add(s.slice(1));
    else if (s[0] === '@') { const i = s.indexOf('!'); if (i > 0) into.add(s.slice(i + 1)); }
  }
  return { literal, pooled };
}

/** the ids said by `SayText` in compiled cutscenes */
export function saytextIds(cuts: Iterable<Uint8Array>, onError?: (e: unknown) => void): Set<string> {
  const out = new Set<string>();
  for (const c of cuts) {
    try { for (const k of parseCutscene(c).commands) if (k.textId) out.add(k.textId); } catch (e) { onError?.(e); }
  }
  return out;
}

/** the archives with compiled cutscenes (`<zone>/cutscene/*.cut`, 87 files); a test checks the list against all archives */
export const CUTSCENE_ARCHIVES = ['z02LGI', 'z07CSI', 'z14OSD', 'z16PYA', 'z21FSH', 'z23DIP', 'z28HAT', 'z40OGL', 'z42BRP'] as const;
/** the compiled cutscenes of an archive (`name` = file name without `.cut`) */
export function cutsOf(archive: Archive): { name: string; data: Uint8Array }[] {
  return archive.entries.filter((e) => /\.cut$/i.test(e.path)).map((e) => ({ name: /([^/]+?)\.cut$/i.exec(e.path)![1], data: archive.read(e) }));
}

// ---------------------------------------------------------------------------------------------------------------- analysis

export type RefKind = 'exe' | 'tabel' | 'cutscene' | 'control' | 'level' | 'npc' | 'holo' | 'ifc';
export const REF_LABEL: Record<RefKind, string> = {
  exe: 'naam staat als tekst in de EXE', tabel: 'staat alleen in de spraaktabel van de EXE (zwak)', cutscene: 'gezegd in een cutscene', control: 'CONTROL%i (EXE-formaat)', level: 'LEV<zonecode>', npc: 'NPC-regel (record + A/B/C/D)', holo: 'hologramtip HOLO<letter>', ifc: 'infocentrum IFC<code><nn> (bij benadering)',
};

export interface AnalysedEntry extends StrEntry {
  /** why the line counts as shown; null = never shown ("nooit getoond") */
  ref: RefKind | null;
  /** 8.7 "opgenomen maar nooit gezegd": the line belongs to a cutscene's text table, has a clip, and no cutscene says it (the zone announcers are said by speech index from code: not judged) */
  unsaid: boolean;
  /** the table never returns this line: another line of the same file has the same tag and wins */
  shadowed: boolean;
  winner: StrEntry | null;
  /** the speech id of the voice field (`speech[voice]`), '' without voice / outside the table */
  clip: string;
  /** the clip's mp3 exists */
  clipFile: boolean;
}

export interface AnalyseCtx {
  /** exact EXE strings outside the speech pool (see `exeTagSets`) */
  exe: Set<string>;
  /** strings that only occur as the speech table's own entries */
  pooled: Set<string>;
  /** lower-case names of the compiled cutscenes: `<name>.str` is that cutscene's text table */
  cutNames: Set<string>;
  saytext: Set<string>;
  /** the EXE's speech table */
  speech: string[];
  /** lower-case names (without `.mp3`) of the files in `sounds/speech/Data` */
  mp3: Set<string>;
  /** 3 letter zone codes (`LEV<code>`) */
  zoneCodes: readonly string[];
  /** the EXE has the `CONTROL%i` format */
  controlFormat: boolean;
}

export function refOf(e: StrEntry, c: AnalyseCtx): RefKind | null {
  const g = e.tag;
  if (c.exe.has(g)) return 'exe';
  if (c.saytext.has(g)) return 'cutscene';
  if (c.controlFormat && /^CONTROL\d+$/.test(g)) return 'control';
  if (g.startsWith('LEV') && c.zoneCodes.includes(g.slice(3))) return 'level';
  if (/^HOLO[A-Z]$/.test(g)) return 'holo';
  if (/FSM\d*$/i.test(e.name) && /^[A-Z0-9]{4}[A-D]$/.test(g)) return 'npc';
  if (/^IFC[A-Z0-9]{3,4}\d\d$/.test(g)) return 'ifc';
  if (c.pooled.has(g)) return 'tabel';
  return null;
}

export interface TextAnalysis {
  entries: AnalysedEntry[];
  /** entries by speech index */
  byVoice: Map<number, AnalysedEntry[]>;
  stats: {
    total: number; files: number; neverShown: number; unsaid: number; shadowed: number; english: number; withVoice: number; withoutVoice: number;
    voiceClipMissing: number; distinctVoices: number;
  };
}

export function analyseTexts(list: readonly StrEntry[], c: AnalyseCtx): TextAnalysis {
  // shadowed duplicates: per file, the stable-sorted table and the original's binary search
  const byFile = new Map<string, StrEntry[]>();
  for (const e of list) { const l = byFile.get(e.file); if (l) l.push(e); else byFile.set(e.file, [e]); }
  const winner = new Map<StrEntry, StrEntry>();   // shadowed entry -> the entry find() returns
  for (const l of byFile.values()) {
    const dup = new Map<string, number>();
    for (const e of l) dup.set(e.tag, (dup.get(e.tag) ?? 0) + 1);
    if (![...dup.values()].some((n) => n > 1)) continue;
    const t = new MessageTable([l]);
    for (const e of l) {
      if ((dup.get(e.tag) ?? 0) < 2) continue;
      const w = t.find(e.tag) as StrEntry | null;   // the table holds the very objects of `l`
      if (w && w !== e) winner.set(e, w);
    }
  }
  const entries: AnalysedEntry[] = list.map((e) => {
    const clip = e.voice >= 0 && e.voice < c.speech.length ? c.speech[e.voice] : '';
    const w = winner.get(e) ?? null;
    const ref = e.english ? null : refOf(e, c);
    const clipFile = clip !== '' && c.mp3.has(clip.toLowerCase());
    const unsaid = !e.english && (ref === null || ref === 'tabel') && clipFile && c.cutNames.has(e.name.toLowerCase());
    return { ...e, ref, unsaid, shadowed: w !== null, winner: w, clip, clipFile };
  });
  const byVoice = new Map<number, AnalysedEntry[]>();
  for (const e of entries) if (e.voice >= 0) { const l = byVoice.get(e.voice); if (l) l.push(e); else byVoice.set(e.voice, [e]); }
  const main = entries.filter((e) => !e.english);
  return {
    entries, byVoice,
    stats: {
      total: main.length, files: new Set(main.map((e) => e.file)).size, neverShown: main.filter((e) => e.ref === null).length, unsaid: main.filter((e) => e.unsaid).length, shadowed: main.filter((e) => e.shadowed).length,
      english: entries.length - main.length, withVoice: main.filter((e) => e.voice >= 0).length, withoutVoice: main.filter((e) => e.voice < 0).length,
      voiceClipMissing: main.filter((e) => e.voice >= 0 && !e.clipFile).length, distinctVoices: new Set(main.filter((e) => e.voice >= 0).map((e) => e.voice)).size,
    },
  };
}

/** the text of an entry as the game shows it (escapes, accents, placeholders left as typed) */
export const shownText = (e: StrEntry): string => expandMessage(e.text);

/**
 * "recorded but never said" (unused.md 8.7): the line sits in a cutscene's text table, has a voice clip (file present) and no cutscene says it. The research found 13
 * (the two `UNUSED` lines of CSIFSM4 are counted separately); the computed list is compared with this table by the test.
 */
export const RESEARCH_NEVER_SAID: readonly (readonly [id: string, where: string])[] = [
  ['ADCSOA13', 'ADV04: de hengel-regel, nooit in het script'],
  ['ADCSOA14', 'ADV04: "hier is de volgende bladzijde", nooit in het script'],
  ['CACSAR02', 'nergens gezegd (CSI01)'],
  ['CACSBR11', 'in csi02.txt:116 / csi02a.txt:114 uitgecommentarieerd (//60 LSD1 saytext)'],
  ['CACSBP17', 'alleen in csi04psx.txt (PlayStation-bron)'],
  ['CACSCS08', 'nergens gezegd'],
  ['LECSBE22', 'alleen lgi04psx.txt (PlayStation-bron)'],
  ['LECSBE23', 'alleen lgi04psx.txt (PlayStation-bron)'],
  ['LECSBK24', 'in lgi09.txt:484 uitgecommentarieerd'],
  ['LECSRS06', 'batterijen: lgi10.txt, uitgecommentarieerd (//50 djab saytext)'],
  ['LECSRS07', 'batterijen: lgi10.txt, uitgecommentarieerd (//60 djab saytext)'],
  ['LECSRS08', 'batterijen: lgi10.txt, uitgecommentarieerd (//70 djab saytext)'],
  ['LEINVS04', 'nergens gezegd'],
];

/** the computed "recorded but never said" lines (8.7) */
export function neverSaid(a: TextAnalysis): AnalysedEntry[] { return a.entries.filter((e) => e.unsaid); }
