// Language packs: the port's code and every verified address belong to the Dutch executable, so another edition's language is taken as a PACK of data: the files of that
// edition that carry language (message tables, fonts, the speech, one voice sound) are laid over the Dutch game's file tree under the Dutch names. docs/re/language.md has the
// comparison of the Dutch and the English disc (member by member) and the evidence for every rule below.
//
// What the English disc (LEGO Island 2: The Brickster's Revenge, Windows, 2001) differs in, out of 3029 Dutch / 3126 English files of the cabinet's Game group:
//   _data/messages.bod+bob   the `.str` tables: `<AREA>/English/X.str` (and Danish / French / German folders) instead of `<AREA>/Data/X.str`
//   _data/Fonts.bod+bob      Balloon12 / Balloon24: 114 glyphs instead of 124 (the Dutch font has ten extra accented ones)
//   _data/sounds/speech/English/*.mp3   1793 clips instead of `speech/Data/*.mp3` (1698): same ids (the speech table of both executables is identical but three entries)
//   _data/sounds/z07CSI/cedric defeat.wav   a voice
// Everything else (all 29 zone archives, Overlays, menu, GENERICBITS, ..., 1210 of 1211 other sounds, the four movies) is byte-identical.
import { normalizePath } from '../files.ts';
import type { GameFiles, MediaFile } from '../files.ts';
import type { LoadState } from '../engine/bytesource.ts';

export type Lang = 'nl' | 'en';

export interface LangPack {
  id: Lang;
  /** the name in the language selector */
  label: string;
  /** the folder name this edition's executable puts where the Dutch one has `Data` (`messages/<AREA>/<dir>/`, `sounds/speech/<dir>/`) */
  dir: string;
  /** the discs on archive.org with the language's files, in the order they are tried (same layout as the Dutch ISOs: `LEGO Island 2/data1.hdr`, `data1.cab`, `data2.cab`) */
  items: { item: string; iso: string; size: number }[];
  /** `[Dutch speech id, id in this edition]`: ids of the Dutch speech table whose clip has another name here (the executables' tables differ in exactly these entries) */
  speechAliases: [string, string][];
  /** installed-layout paths (any case) besides the message tables, fonts and speech that are taken from the pack */
  members: string[];
}

export const EN_PACK: LangPack = {
  id: 'en',
  label: 'English',
  dir: 'English',
  // LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng / LegoIsland2-Windows.iso, md5 09e8b4d3b3a9c472e2177a61e92f1e41 (the 2001 retail disc, cabinet dated 2001-03-04)
  items: [{ item: 'LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng', iso: 'LegoIsland2-Windows.iso', size: 445495296 }],
  // the English executable's table (VA 0x968148, 1732 entries) is the Dutch one (VA 0x979098) with these three entries renamed: the clips are the same slots (MAN_1 .. MAN_3)
  speechAliases: [['MAN_1b', 'MAN_1c'], ['MAN_2b', 'MAN_2c'], ['MAN_3b', 'MAN_3c']],
  members: ['_data/messages.bod', '_data/messages.bob', '_data/Fonts.bod', '_data/Fonts.bob', '_data/sounds/z07CSI/cedric defeat.wav'],
};

export const LANG_PACKS: Record<'en', LangPack> = { en: EN_PACK };

/** what the cabinet holds under the language folder of the Dutch layout: `_data/sounds/speech/Data/<id>.mp3` */
const speechDir = (dir: string) => `_data/sounds/speech/${dir}/`;
const DUTCH_SPEECH = '_data/sounds/speech/Data/';

/** The files every start of a game in the language needs: fetched ahead (the first clips of a new game's island intro, as for the Dutch data). */
export function langWarmPaths(pack: LangPack): string[] {
  return [...pack.members.filter((m) => /\.bo[bd]$/i.test(m)), ...['LECSIN01', 'LECSIN02', 'LECSIN03'].map((n) => `${speechDir(pack.dir)}${n}.mp3`)];
}

/** Whether a file listing (installed layout of a cabinet's Game group) is the pack's edition: its speech folder is there. */
export function isPackEdition(paths: Iterable<string>, pack: LangPack): boolean {
  const d = normalizePath(speechDir(pack.dir));
  for (const p of paths) if (normalizePath(p).startsWith(d)) return true;
  return false;
}

export interface Redirect {
  /** the path under which the game asks for the file (Dutch layout, original case) */
  path: string;
  /** the path in the pack's own file tree */
  src: string;
}

/**
 * The files of the pack under their Dutch names, keyed by the normalized Dutch path. `langPaths` = the pack edition's installed-layout file list.
 * Message tables / fonts / the voice sound keep their path, `speech/<dir>/X.mp3` becomes `speech/Data/X.mp3`, and each alias adds the Dutch id of a renamed clip.
 */
export function packRedirects(langPaths: Iterable<string>, pack: LangPack): Map<string, Redirect> {
  const out = new Map<string, Redirect>();
  const from = normalizePath(speechDir(pack.dir));
  const members = new Set(pack.members.map(normalizePath));
  const bySpeech = new Map<string, string>();
  for (const src of langPaths) {
    const n = normalizePath(src);
    if (n.startsWith(from)) {
      const name = src.replace(/\\/g, '/').split('/').pop()!;
      if (!/\.mp3$/i.test(name)) continue;
      out.set(normalizePath(DUTCH_SPEECH + name), { path: DUTCH_SPEECH + name, src });
      bySpeech.set(name.toLowerCase(), src);
    } else if (members.has(n)) out.set(n, { path: src.replace(/\\/g, '/'), src });
  }
  for (const [nl, en] of pack.speechAliases) {
    const src = bySpeech.get(`${en}.mp3`.toLowerCase());
    if (src && !out.has(normalizePath(`${DUTCH_SPEECH}${nl}.mp3`))) out.set(normalizePath(`${DUTCH_SPEECH}${nl}.mp3`), { path: `${DUTCH_SPEECH}${nl}.mp3`, src });
  }
  return out;
}

/**
 * The directory file of the pack's `messages` archive with its language folders renamed to the Dutch `Data` (`fe/English/X.str` -> `fe/Data/X.str`), so every path the Dutch
 * executable's tables and the port's `ui/strings.ts` ask for (`FE/Data/FRONTEND.str`, `LI/Data/lifsm3.str`, ...) finds the pack's text. The names are NUL-terminated strings in front of
 * the 16-byte records (formats/archive.ts); "Data" is shorter than "English", so the name is overwritten in place and every record offset stays valid. The pack's other language folders
 * (Danish / French / German on the English disc) stay where they are: nothing asks for them.
 */
export function renameLanguageDir(bod: Uint8Array, dir: string, to = 'Data'): Uint8Array {
  if (to.length > dir.length) throw new Error('renameLanguageDir: the new name must not be longer');
  const out = bod.slice();
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const namesLen = dv.getUint32(out.length - 16, true);
  const want = dir.toLowerCase();
  let at = 0;
  while (at < namesLen) {
    let end = at;
    while (end < namesLen && out[end] !== 0) end++;
    let s = '';
    for (let i = at; i < end; i++) s += String.fromCharCode(out[i]);
    if (s.toLowerCase() === want) {
      for (let i = 0; i < to.length; i++) out[at + i] = to.charCodeAt(i);
      for (let i = to.length; i <= dir.length; i++) out[at + i] = 0;
    }
    at = end + 1;
  }
  return out;
}

/**
 * The Dutch game's files with a language pack laid over them. Paths, sizes and listings answer in the Dutch layout; a read of one of the pack's members returns the pack's file
 * (the message tables with their folders renamed). Speech clips the pack does not have are not there either (no Dutch voice in an English game); the movies are the base's (the
 * four movies of both discs are the same files). The code (`LEGO eiland 2.exe`) always comes from the base.
 */
export class LanguageFiles implements GameFiles {
  readonly pack: LangPack;
  private base: GameFiles;
  private lang: GameFiles;
  private map: Map<string, Redirect>;
  private patched = new Map<string, Promise<Uint8Array>>();

  constructor(base: GameFiles, lang: GameFiles, pack: LangPack) {
    this.base = base;
    this.lang = lang;
    this.pack = pack;
    this.map = packRedirects(lang.list(), pack);
  }

  /** how many files of the pack are laid over the base (tests, the start screen) */
  get replaced(): number { return this.map.size; }

  get source() { return this.base.source; }
  get route() { return this.base.route; }
  get loading(): LoadState | null { return this.base.loading; }

  private hidden(n: string) { return n.startsWith(normalizePath(DUTCH_SPEECH)) && !this.map.has(n); }

  list() {
    const base = this.base.list().filter((p) => !this.hidden(normalizePath(p)));
    const have = new Set(base.map(normalizePath));
    for (const [k, r] of this.map) if (!have.has(k)) base.push(r.path);
    return base;
  }
  has(path: string) {
    const n = normalizePath(path);
    return this.map.has(n) || (!this.hidden(n) && this.base.has(path));
  }
  size(path: string) {
    const r = this.map.get(normalizePath(path));
    return r ? this.lang.size(r.src) : this.hidden(normalizePath(path)) ? -1 : this.base.size(path);
  }
  totalSize() { return this.base.totalSize(); }
  loaded(path: string) {
    const r = this.map.get(normalizePath(path));
    return r ? this.lang.loaded(r.src) : this.base.loaded(path);
  }
  ready(paths: Iterable<string>) {
    const mine: string[] = [], rest: string[] = [];
    for (const p of paths) {
      const r = this.map.get(normalizePath(p));
      if (r) mine.push(r.src); else if (!this.hidden(normalizePath(p))) rest.push(p);
    }
    return Promise.all([mine.length ? this.lang.ready(mine) : undefined, rest.length ? this.base.ready(rest) : undefined]).then(() => undefined);
  }
  movie(name: string): Promise<MediaFile | null> { return this.base.movie(name); }

  read(path: string): Promise<Uint8Array> {
    const n = normalizePath(path);
    const r = this.map.get(n);
    if (!r) return this.hidden(n) ? Promise.reject(new Error(`Bestand niet gevonden: ${path}`)) : this.base.read(path);
    if (n === '_data/messages.bod') {
      let p = this.patched.get(n);
      if (!p) this.patched.set(n, p = this.lang.read(r.src).then((b) => renameLanguageDir(b, this.pack.dir)));
      return p;
    }
    return this.lang.read(r.src);
  }
}
