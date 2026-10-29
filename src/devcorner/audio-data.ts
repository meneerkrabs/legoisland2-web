// Ontwikkelaarshoek, section 8 "Geluid en muziek": the pure data side (node-testable). Method of docs/re/unused.md 7.5 / 7.6 (scripts snd.mjs, dm.mjs, orphans.mjs),
// computed from the game files at run time:
//  - the loose sound files below `_data/sounds`: a file is "ongebruikt" when its full path or its base name is no string of the EXE (strings = runs of >= 3 printable
//    characters, lower-cased, `\` -> `/`, doubled separators folded: `snd.mjs`). 66 wavs + 2 .mid expected;
//  - music: a `.sgt` is "ongebruikt" when neither its path nor its base name occurs in the EXE strings (10 expected); a `.sty` when no used `.sgt` names it (its name as UTF-16 or
//    Latin-1 text inside the segment) and the EXE does not name it (14 expected). `dm.mjs` has the same rules, incl. its substring test of the joined string text;
//  - speech: the EXE's speech table (src/audio/tables.ts), the mp3 files of `sounds/speech/Data`: orphans = files with no table entry (67 expected), table ids without a file (4).
// The SND_* names (the registry of the dead initialiser FUN_00877550, 902 names) come from `readExeSoundTable`, which reads them from the `push id; push name; call
// FUN_0045bff4` sequences of that function at run time: they are the id labels of the sound list.
import type { SoundTableEntry } from '../formats/sound.ts';

/** distinct printable strings (runs of >= 3 characters 0x20..0x7e) of the EXE, like `exestr.py` */
export function exeStrings(exe: Uint8Array): string[] {
  const out = new Set<string>();
  const td = new TextDecoder('latin1');
  let st = -1;
  for (let i = 0; i <= exe.length; i++) {
    const b = i < exe.length ? exe[i] : 0;
    if (b >= 0x20 && b <= 0x7e) { if (st < 0) st = i; continue; }
    if (st >= 0 && i - st >= 3) out.add(td.decode(exe.subarray(st, i)));
    st = -1;
  }
  return [...out];
}

/** the EXE's strings in the form `snd.mjs` / `dm.mjs` compare: lower case, `/` separators, doubled separators folded */
export interface ExeNames {
  /** sound / music file names with their path as written (`_data/sounds/...`) */
  full: Set<string>;
  /** the base names of those */
  base: Set<string>;
  /** all strings joined with newlines (the substring test of `dm.mjs`) */
  joined: string;
}
export function exeNames(strings: readonly string[]): ExeNames {
  const norm = strings.map((s) => s.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/'));
  const full = new Set<string>(), base = new Set<string>();
  for (const s of norm) if (/\.(wav|mp3|sty|sgt|dls|mid|midi)\b/.test(s)) { full.add(s); base.add(s.split('/').pop()!); }
  return { full, base, joined: norm.join('\n') };
}

/** a file below `_data/sounds` */
export interface SoundFile {
  /** installed-layout path as listed (`_data/sounds/z02LGI/Bunny.WAV`) */
  path: string;
  /** relative to `_data/sounds` (`z02LGI/Bunny.WAV`) */
  rel: string;
  /** first folder (`CUTSCENE`, `z02LGI`, `DirectMusic`, `speech`) */
  group: string;
  /** folder below the group (`Menu`, `MidiAmbient`) or '' ; for DirectMusic the music folder (`ad1`) */
  sub: string;
  name: string;
  ext: string;
  size: number;
}

const SOUNDS = '_data/sounds/';
export function soundFiles(list: readonly string[], sizeOf: (path: string) => number): SoundFile[] {
  const out: SoundFile[] = [];
  for (const path of list) {
    const lo = path.toLowerCase();
    if (!lo.startsWith(SOUNDS)) continue;
    const rel = path.slice(SOUNDS.length);
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const ext = /\.([^./]+)$/.exec(name)?.[1].toLowerCase() ?? '';
    out.push({ path, rel, group: parts.length > 1 ? parts[0] : '', sub: parts.length > 2 ? parts[1] : '', name, ext, size: sizeOf(path) });
  }
  return out;
}

/** snd.mjs: how the EXE names a loose sound file: by path, by base name only, or not at all (null = "ongebruikt") */
export function namedBy(f: SoundFile, n: ExeNames): 'pad' | 'bestandsnaam' | null {
  const rl = f.rel.toLowerCase();
  if (n.full.has(SOUNDS + rl)) return 'pad';
  if (n.base.has(rl.split('/').pop()!)) return 'bestandsnaam';
  return null;
}

/** loose sounds: .wav and the two .mid outside the music folder tree's own segments; `ongebruikt` per `namedBy` */
export interface LooseSound extends SoundFile {
  unused: boolean;
  how: 'pad' | 'bestandsnaam' | null;
  /** SND_* names (id) whose table path is this file */
  snd: { id: number; name: string }[];
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.?\//, '').toLowerCase();

/** path -> the sound-table entries that use it (the table's paths: `_Data\\sounds\\\\z02LGI\\Silence.wav`; a missing `.wav` is added like `readTolerant` does) */
export function soundTableIndex(table: readonly SoundTableEntry[]): Map<string, SoundTableEntry[]> {
  const m = new Map<string, SoundTableEntry[]>();
  for (const e of table) {
    if (!e.name && !e.path) continue;
    let p = normPath(e.path);
    if (!/\.[a-z0-9]{2,4}$/.test(p)) p += '.wav';
    const l = m.get(p);
    if (l) l.push(e); else m.set(p, [e]);
  }
  return m;
}

export function looseSounds(files: readonly SoundFile[], n: ExeNames, table: readonly SoundTableEntry[]): LooseSound[] {
  const idx = soundTableIndex(table);
  const out: LooseSound[] = [];
  for (const f of files) {
    if (f.group === 'speech' || (f.group === 'DirectMusic' && f.ext !== 'mid')) continue;
    if (f.ext !== 'wav' && f.ext !== 'mid' && f.ext !== 'midi') continue;
    const how = namedBy(f, n);
    out.push({ ...f, unused: how === null, how, snd: (idx.get(normPath(f.path)) ?? []).map((e) => ({ id: e.id, name: e.name })) });
  }
  return out.sort((a, b) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase()));
}

/** the sound table as a list (902 rows): id, SND_ name, file present */
export interface SoundTableRow { id: number; name: string; path: string; rel: string; exists: boolean; volume: number; loop: number; rate: number; undefinedPath: boolean }
export function soundTableRows(table: readonly SoundTableEntry[], has: (path: string) => boolean): SoundTableRow[] {
  return table.map((e) => {
    const undefinedPath = /^(UNDEFINED|_Data\\sounds\\PSX ONLY)/i.test(e.path);
    let p = normPath(e.path);
    if (!/\.[a-z0-9]{2,4}$/.test(p)) p += '.wav';
    return { id: e.id, name: e.name, path: e.path, rel: p.replace(/^_data\/sounds\//, ''), exists: !undefinedPath && has(p), volume: e.volume, loop: e.loopCount, rate: e.rate, undefinedPath };
  });
}

// ---------------------------------------------------------------------------------------------------------------- music

export interface MusicFile extends SoundFile {
  /** the music folder below DirectMusic (`ad1`, `z02LGI`) */
  dir: string;
  unused: boolean;
}

/** the .sgt and .sty files below `DirectMusic`; `read` gives the bytes of a used segment (the style names are looked up in them) */
export async function musicFiles(files: readonly SoundFile[], n: ExeNames, read: (path: string) => Promise<Uint8Array>): Promise<{ sgt: MusicFile[]; sty: MusicFile[]; unusedSgt: number; unusedSty: number }> {
  const dm = files.filter((f) => f.group === 'DirectMusic' && (f.ext === 'sgt' || f.ext === 'sty'));
  const sgtF = dm.filter((f) => f.ext === 'sgt'), styF = dm.filter((f) => f.ext === 'sty');
  const rel = (f: SoundFile) => f.rel.replace(/^DirectMusic\//, '');
  const sgtNamed = (f: SoundFile) => n.joined.includes(f.name.toLowerCase()) || n.joined.includes(f.rel.toLowerCase());   // dm.mjs: substring tests (a segment named by a longer string counts as named)
  const used = new Set<string>();
  const latin = new TextDecoder('latin1');
  for (const g of sgtF) {
    if (!sgtNamed(g)) continue;
    let b: Uint8Array;
    try { b = await read(g.path); } catch { continue; }
    if (b.length === 0) continue;
    const text = latin.decode(b);   // a style name is in the segment as UTF-16 (`A\0d\0v\0`) or as Latin-1 text
    for (const t of styF) {
      if (used.has(t.name.toLowerCase())) continue;
      const nm = t.name.replace(/\.sty$/i, '');
      if (text.includes(nm) || text.includes([...nm].map((c) => `${c}\0`).join(''))) used.add(t.name.toLowerCase());
    }
  }
  const mk = (f: SoundFile, unused: boolean): MusicFile => ({ ...f, dir: rel(f).split('/')[0], unused });
  const sgt = sgtF.map((f) => mk(f, !sgtNamed(f)));
  const sty = styF.map((f) => mk(f, !used.has(f.name.toLowerCase()) && !n.joined.includes(f.name.toLowerCase())));
  const by = (a: MusicFile, b: MusicFile) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase());
  return { sgt: sgt.sort(by), sty: sty.sort(by), unusedSgt: sgt.filter((x) => x.unused).length, unusedSty: sty.filter((x) => x.unused).length };
}

// ---------------------------------------------------------------------------------------------------------------- speech

/** what a line of the message tables says for one speech index (filled from the text analysis when it is there) */
export interface SpeechUse { file: string; tag: string; text: string; shown?: boolean }

export interface SpeechRow {
  kind: 'tabel' | 'wees';
  /** index into the speech table, -1 for an orphan */
  index: number;
  /** the id as the table (or the file name) spells it */
  id: string;
  /** file name in `speech/Data` (original case) or '' when missing */
  file: string;
  exists: boolean;
  /** the table lists the same id at another (earlier) index too */
  dupOf: number;
}

/**
 * all rows of the speech list: one per table index (1,732 indices = 1,635 distinct ids in this build) followed by the orphan clips (mp3 files with no table entry).
 * `mp3` = the names of the files in `_data/sounds/speech/Data` (with `.mp3`).
 */
export function speechRows(table: readonly string[], mp3: readonly string[]): { rows: SpeechRow[]; missing: string[]; orphans: string[] } {
  const byStem = new Map<string, string>();
  for (const f of mp3) byStem.set(f.replace(/\.mp3$/i, '').toLowerCase(), f);
  const first = new Map<string, number>();
  const rows: SpeechRow[] = [];
  const missing: string[] = [];
  table.forEach((id, i) => {
    const k = id.toLowerCase();
    const file = byStem.get(k) ?? '';
    const dup = first.get(k);
    if (dup === undefined) { first.set(k, i); if (!file) missing.push(id); }
    rows.push({ kind: 'tabel', index: i, id, file, exists: file !== '', dupOf: dup ?? -1 });
  });
  const orphans: string[] = [];
  for (const [stem, f] of byStem) if (!first.has(stem)) orphans.push(f.replace(/\.mp3$/i, ''));
  orphans.sort((a, b) => a.localeCompare(b));
  for (const o of orphans) rows.push({ kind: 'wees', index: -1, id: o, file: byStem.get(o.toLowerCase())!, exists: true, dupOf: -1 });
  return { rows, missing, orphans };
}
