// Message tables of the game (`messages` archive, `<AREA>/Data/<NAME>.str`) with the lookup semantics of the original
// (SDText.c: loader FUN_00439126, sort FUN_00439573, binary search FUN_004396a0, text expansion FUN_004397b9 / FUN_00439788,
// voice field FUN_00439bf8, menu label resolution FUN_0041c270). Pure TypeScript, runs in node. Documented in docs/re/ui-m2.md.
import type { Archive } from '../formats/archive.ts';

/** One loaded `.str` line. `field` = the 4 characters after the ':' (voice sample id, `"-1  "` or `"775 "`), `text` = the rest of the line (escapes unprocessed). */
export interface MsgEntry { tag: string; field: string; text: string }

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/**
 * Loader FUN_00439126 (state machine on the raw bytes, text is Latin-1): state 0 = between lines (bytes < 0x20 ignored), `#` starts a comment line, any
 * other byte >= 0x20 starts a tag; a tag ends at the first ':'; a control byte before the ':' drops the tag; after the ':' the value runs up to the first
 * byte < 0x20 (CR, or a TAB!). Entries are returned in file order (unsorted).
 */
export function parseMessageFile(data: Uint8Array): MsgEntry[] {
  const out: MsgEntry[] = [];
  let state = 0, tagStart = 0, valStart = 0, tag = '';
  const str = (a: number, b: number) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(data[i]); return s; };
  for (let i = 0; i <= data.length; i++) {
    const c = i < data.length ? data[i] : 0; // the original buffer is NUL terminated
    if (state === 0) {
      if (c === 0x23) state = 2;
      else if (c > 0x1f) { state = 1; tagStart = i; }
    } else if (state === 1) {
      if (c === 0x3a) { tag = str(tagStart, i); valStart = i + 1; state = 3; }
      else if (c < 0x20) state = 0;
    } else if (state === 3) {
      if (c < 0x20) {
        const v = str(valStart, i);
        out.push({ tag, field: v.slice(0, 4), text: v.slice(4) });
        state = 0;
      }
    } else if (c < 0x20) state = 0; // comment
  }
  return out;
}

/** C `strcmp` on Latin-1 strings (unsigned byte compare). */
function strcmp(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; }
  return a.length - b.length;
}

/**
 * Text post-processing of FUN_004397b9: bytes >= 0xE0 are folded to upper case (-0x20, only the font's capital accents exist); `\n \t \\` escapes (any other
 * `\x` produces nothing); `$$ %% &&` = the literal sigil; otherwise `$` `%` `&` start a 3 character placeholder `<sigil><any><digit n>` replaced by argument n
 * (`$` = string, `%` = decimal, `&` = lower-case hex; FUN_00439a80; `<sigil>x<sigil>` = literal sigil). Processing ends at the end of the string.
 */
export function expandMessage(raw: string, args: readonly (string | number)[] = []): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    let c = raw.charCodeAt(i);
    if (c < 0x20) break;
    if (c > 0xdf) c -= 0x20;
    const ch = String.fromCharCode(c);
    if (ch === '$' || ch === '%' || ch === '&') {
      if (raw[i + 1] === ch) { out += ch; i += 2; continue; }
      const third = raw[i + 2] ?? '\0';
      i += 3;
      if (third === ch) { out += ch; continue; }
      const n = third.charCodeAt(0) - 0x30;
      const a = n >= 0 && n < args.length ? args[n] : '';
      out += ch === '$' ? String(a) : ch === '%' ? String(Math.trunc(Number(a) || 0)) : (Math.trunc(Number(a) || 0) >>> 0).toString(16);
    } else if (ch === '\\') {
      const n = raw[i + 1];
      i += 2;
      if (n === 'n') out += '\n'; else if (n === 't') out += '\t'; else if (n === '\\') out += '\\';
    } else { out += ch; i++; }
  }
  return out;
}

/**
 * A sorted tag table (one or more `.str` files merged). `find` is FUN_004396a0 including its binary search (duplicate tags: whichever entry it hits first),
 * `text` is FUN_00439788: a missing id returns **the id itself** (expanded like any text).
 */
export class MessageTable {
  /** sorted like the game (bubble sort with strcmp: stable) */
  readonly entries: MsgEntry[];
  constructor(sources: (Uint8Array | MsgEntry[])[]) {
    const all: MsgEntry[] = [];
    for (const s of sources) all.push(...(s instanceof Uint8Array ? parseMessageFile(s) : s));
    this.entries = all.map((e, i) => [e, i] as const).sort((a, b) => strcmp(a[0].tag, b[0].tag) || a[1] - b[1]).map((x) => x[0]);
  }
  get size() { return this.entries.length; }

  /** FUN_004396a0: the original's binary search (the array is followed by a NULL sentinel). */
  find(id: string): MsgEntry | null {
    const e = this.entries;
    let base = 0, n = e.length;
    do {
      const mid = Math.trunc(n / 2);
      const p = base + mid;
      if (p >= e.length) return null;
      const d = strcmp(e[p].tag, id);
      if (d === 0) return e[p];
      if (d < 1) { base = p + 1; n -= mid + 1; } else n = mid - 1;
    } while (n > -1);
    return null;
  }
  has(id: string): boolean { return this.find(id) !== null; }
  /** expanded text; a missing id returns the id (FUN_00439788) */
  text(id: string, ...args: (string | number)[]): string {
    const e = this.find(id);
    return expandMessage(e ? e.text : id, args);
  }
  /** raw text of the line, null when missing */
  raw(id: string): string | null { return this.find(id)?.text ?? null; }
  /** FUN_00439bf8: voice sample id (index of the speech table), -1 when the 4 character field does not start with a digit or the id is missing */
  voice(id: string): number {
    const e = this.find(id);
    if (!e || e.field.length === 0 || !isDigit(e.field.charCodeAt(0))) return -1;
    return parseInt(e.field, 10);
  }
}

/** Load and merge `.str` files of the `messages` archive (paths like `FE/Data/FRONTEND.str`, case-insensitive); a missing file throws. */
export function loadMessages(archive: Archive, paths: readonly string[]): MessageTable {
  return new MessageTable(paths.map((p) => {
    const e = archive.find(p);
    if (!e) throw new Error(`messages: no ${p}`);
    return archive.read(e);
  }));
}

// ---------------------------------------------------------------------------------------------------- which files the game loads

/** `_data/messages/FE/Data/frontend.str`: the menu table (FUN_0041b40e, default table of every menu context, also LOADING / INSERTCD of the loading card) */
export const FRONTEND_FILES = ['FE/Data/FRONTEND.str'] as const;
/** pause menu captions (PAUSE, CONTINUE, SAVE, memory card texts, LEVPPH, FOG); loaded by FUN_0041b40e as the second fallback table */
export const PAUSE_FILES = ['FE/Data/PAUSE.str'] as const;
/** level names `LEVxxx` and info-centre strings `IFCxxx` (FUN_0041b40e third fallback table; FUN_004042d3 loads it too at start-up) */
export const IFC_FILES = ['FE/Data/IFC.str'] as const;
/** global table `DAT_00983a14` loaded by FUN_00404dc9 (SGGOLD / SGSILVER / SGBRONZE / PHOTOS) */
export const STD_FILES = ['FE/Data/STD.str'] as const;
/** credits screen (FUN_00471bfa): ids `FRECR00..`, label `!FRECRnn` resolved with FUN_00471bd2 */
export const CREDITS_FILES = ['FE/Data/CREDITS.str'] as const;
/** installer browser texts (`BROWSE01..07`), not used by the game itself */
export const BROWSER_FILES = ['FE/Data/BROWSER.str'] as const;
/** the three tables of a menu context in lookup order (FUN_0041c270): frontend, then pause, then ifc */
export const MENU_FILES = [FRONTEND_FILES, PAUSE_FILES, IFC_FILES] as const;

/**
 * Per-zone speech / subtitle table loaded by the zone's set-up function (FUN_00439126 call sites, path literal in the EXE).
 * Zones not listed here (z02LGI, z03PPH, z04IFC, ...) take their `SayText` ids from the cutscene script's own `<AREA>/Data/<script>.str`.
 */
export const ZONE_FILES: Readonly<Record<string, readonly string[]>> = {
  z05WAB: ['LI/Data/wab.str'],
  z08BKD: ['CI/Data/bkd.str'],
  z09JST: ['CI/Data/jst.str'],
  z10RGB: ['CI/Data/rgb.str'],
  z15SSH: ['AI/Data/ssh.str'],
  z17WAS: ['AI/Data/was.str'],
  z18MMP: ['AI/Data/mmp.str'],
  z20DSP: ['AI/Data/dsp.str'],
  z21FSH: ['AI/Data/fsh.str'],
  z22BIP: ['AI/Data/bip.str'],
  z27TRX: ['AI/Data/trx.str'],
  z28HAT: ['AI/Data/hat.str'],
  z36CNT: ['LI/Data/cnt.str'],
  z38PAR: ['LI/Data/parstr.str'],
  z40aPO: ['OG/Data/apo.str'],
  z41MAP: ['OG/Data/map.str'],
  z42BRP: ['OG/Data/brp.str', 'OG/Data/brp2.str'],
};

/** Cutscene `<name>` -> `messages/<AREA>/Data/<name>.str` is found by searching the five area folders. */
export const STR_AREAS = ['FE', 'LI', 'CI', 'AI', 'OG'] as const;
export function findStrPath(archive: Archive, name: string): string | null {
  for (const a of STR_AREAS) { const p = `${a}/Data/${name}.str`; if (archive.has(p)) return p; }
  return null;
}

/**
 * The text of a menu label (FUN_0041c270): `!ID` = message id looked up in the context's table, then PAUSE, then IFC (a table is skipped when it
 * only returns the id back, compared case-insensitively); `@prefix!ID` = the same lookup, printed as `"%s%s"` (text, prefix); anything else is literal.
 */
export class MenuStrings {
  readonly tables: readonly MessageTable[];
  constructor(...tables: MessageTable[]) { this.tables = tables; }
  private lookup(id: string): string {
    let t = id;
    for (const tab of this.tables) {
      t = tab.text(id);
      if (t.toLowerCase() !== id.toLowerCase()) return t;
    }
    return t;
  }
  label(label: string): string {
    if (label[0] === '@') {
      const bang = label.indexOf('!', 1);
      if (bang < 0) return label;
      return this.lookup(label.slice(bang + 1)) + label.slice(1, bang);
    }
    if (label[0] === '!') return this.lookup(label.slice(1));
    return label;
  }
  /** true when the `!ID` of a label resolves in any of the tables (not just echoed back) */
  resolves(label: string): boolean {
    const id = label[0] === '@' ? label.slice(label.indexOf('!', 1) + 1) : label[0] === '!' ? label.slice(1) : '';
    return id !== '' && this.tables.some((t) => t.has(id));
  }
}

/** Convenience: the menu tables of FUN_0041b40e (frontend, pause, ifc) as a `MenuStrings`. */
export function loadMenuStrings(archive: Archive): MenuStrings {
  return new MenuStrings(...MENU_FILES.map((f) => loadMessages(archive, f)));
}
