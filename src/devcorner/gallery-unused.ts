// Galleries of the developer corner (sections 6 and 7): "never loaded / unlisted" computed AT RUN TIME from the user's own data, the same way as the research of
// docs/re/unused.md section 7 (scripts tools/research/unused/named.mjs, zones.mjs, tex.mjs). Pure and node-testable: no DOM, no game data in the repo.
//
// Method (unused.md 7, "Unused means no literal name in the EXE and no table entry"):
//   a. every printable string (>= 3 chars, 0x20..0x7e) of the executable, lower case, '\' -> '/', one blob;
//   b. the zone loader tables of the 30 zones (`extractZone`: the mesh / collision paths the loader really loads, the texture-id lists, the models and their parts);
//   c. every archive member is matched in the order of named.mjs: loader table -> literal path ("/<archive>/<dir>/<file>") -> literal file name (not for the data
//      kinds msh/col/man/...) -> stem as a substring of any string (stem >= 3 chars); zone textures `TextNNN` are matched by id (texture lists), not by name.
// The substring rule is generous (a stem that merely occurs inside some longer string counts as named), exactly like the research; the totals therefore are a LOWER bound
// of what no code reaches.
import type { Pe, ZoneScene, Model } from '../formats/exe.ts';
import { extractZone } from '../formats/exe.ts';

/** what the galleries need of an archive: its member list (the .bod directory is enough) */
export interface Listing { name: string; entries: readonly { path: string; size: number }[] }

/** the 30 zone archives with loader tables (src/viewer/data.ts ZONES) */
export const ZONE_NAMES = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC', 'z60FRE'];
/** every archive of the game that can hold meshes / textures (zones + the shared ones) */
export const OTHER_NAMES = ['Bricks', 'BrickMorph', 'GENERICBITS', 'Shadow', 'SwapText', 'menu', 'Overlays', 'Fonts', 'messages'];

// ----------------------------------------------------------------------------------------------------------------- the executable's strings

/**
 * exestr.py: all printable runs of >= 3 characters (0x20..0x7e) of the executable, lower case, '\' as '/', de-duplicated. The research matched against one big string
 * ("\n" before, between and after the strings); a substring search over 0.8 MB costs 1.5 ms, so this keeps a trigram index (candidate lines, then a real check): the same
 * answers about 50 times faster, which matters for the thousands of members the galleries test in the browser.
 */
export class ExeStrings {
  readonly lines: string[];
  private set: Set<string>;
  private tri = new Map<number, number[]>();
  constructor(data: Uint8Array) {
    const set = new Set<string>();
    let start = -1;
    const n = data.length;
    const flush = (end: number) => {
      if (start >= 0 && end - start >= 3) {
        let s = '';
        for (let i = start; i < end; i += 8192) s += String.fromCharCode.apply(null, data.subarray(i, Math.min(end, i + 8192)) as unknown as number[]);
        set.add(s.toLowerCase().replace(/\\/g, '/'));
      }
      start = -1;
    };
    for (let i = 0; i < n; i++) {
      const c = data[i];
      if (c >= 0x20 && c <= 0x7e) { if (start < 0) start = i; } else flush(i);
    }
    flush(n);
    this.set = set;
    this.lines = [...set];
    for (let id = 0; id < this.lines.length; id++) {
      const l = this.lines[id];
      for (let i = 0; i + 3 <= l.length; i++) {
        const k = ExeStrings.key(l, i);
        const arr = this.tri.get(k);
        if (!arr) this.tri.set(k, [id]); else if (arr[arr.length - 1] !== id) arr.push(id);
      }
    }
  }
  private static key(s: string, i: number): number { return ((s.charCodeAt(i) & 127) << 14) | ((s.charCodeAt(i + 1) & 127) << 7) | (s.charCodeAt(i + 2) & 127); }
  /** a string of the executable equals `s` (lower case) */
  has(s: string): boolean { return this.set.has(s); }
  /** the shortest posting list among the trigrams of `sub` (null: a trigram occurs nowhere, so nothing contains `sub`) */
  private candidates(sub: string): number[] | null {
    let best: number[] | null = null;
    for (let i = 0; i + 3 <= sub.length; i++) {
      const a = this.tri.get(ExeStrings.key(sub, i));
      if (!a) return null;
      if (!best || a.length < best.length) best = a;
    }
    return best;
  }
  /** some string contains `sub` (lower case, >= 3 chars) */
  includes(sub: string): boolean {
    if (sub.length < 3) return this.lines.some((l) => l.includes(sub));
    const c = this.candidates(sub);
    if (!c) return false;
    for (const id of c) if (this.lines[id].includes(sub)) return true;
    return false;
  }
  /** some string ends with `suffix` (lower case, >= 3 chars) */
  endsWith(suffix: string): boolean {
    const c = this.candidates(suffix);
    if (!c) return false;
    for (const id of c) if (this.lines[id].endsWith(suffix)) return true;
    return false;
  }
}

// ----------------------------------------------------------------------------------------------------------------- zone tables

/** the parts of a zone's loader tables the galleries use (all keys lower case, paths relative to the archive: "meshes/boulder1.msh") */
export interface ZoneTables {
  zone: string;
  /** every mesh path the loader loads (table entry) */
  meshAll: string[];
  colAll: string[];
  /** meshes some model part (or attached child) uses */
  meshInModels: string[];
  /** every texture id in any texture list */
  texInLists: number[];
  /** mesh -> texture lists of the parts that use it (one id array per part) */
  meshTex: Record<string, number[][]>;
  nModels: number;
}

const relOf = (p: string | null | undefined): string | null => (p ? p.split('\\').slice(2).join('/').toLowerCase() : null);

export function zoneTablesOf(s: ZoneScene): ZoneTables {
  const meshAll = new Set(s.meshPaths.map(relOf).filter((x): x is string => !!x));
  const colAll = new Set(s.colPaths.map(relOf).filter((x): x is string => !!x));
  const inModels = new Set<string>();
  const meshTex: Record<string, number[][]> = {};
  const parts = (m: Model) => {
    for (const p of m.parts) {
      if (!p) continue;
      const mp = relOf(s.meshPaths[p.mesh]);
      if (!mp) continue;
      inModels.add(mp);
      const tl = s.texLists[p.texList];
      if (tl && tl.some((t) => t >= 0)) (meshTex[mp] ??= []).push(tl);
    }
  };
  for (const m of s.models) { parts(m); for (const a of m.attach) if (a) parts(a.child); }
  const texIn = new Set<number>();
  for (const l of s.texLists) if (l) for (const t of l) if (t >= 0) texIn.add(t);
  return { zone: s.zone, meshAll: [...meshAll], colAll: [...colAll], meshInModels: [...inModels], texInLists: [...texIn], meshTex, nModels: s.models.length };
}

/** extract the tables of all zones (sync: ~3 s; the browser version in gallery-load.ts yields between zones) */
export function allZoneTables(pe: Pe, zones: readonly string[] = ZONE_NAMES): Record<string, ZoneTables> {
  const starts = pe.functionStarts();
  const out: Record<string, ZoneTables> = {};
  for (const z of zones) out[z] = zoneTablesOf(extractZone(pe, z, undefined, starts));
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- the matcher (named.mjs)

const setCache = new WeakMap<readonly string[], Set<string>>();
/** a set view of a table's array (cached: the matcher asks thousands of times) */
const setOf = (a: readonly string[]): Set<string> => { let s = setCache.get(a); if (!s) { s = new Set(a); setCache.set(a, s); } return s; };

const NO_NAME_FALLBACK = new Set(['msh', 'col', 'man', 'blk', 'wpt', 'way', 'par', 'app', 'emi', 'mov', 'swl', 'cam', 'cut']);
export type How = 'loader' | 'brickset' | 'exact-path' | 'exact-name' | 'stem-substr' | 'texid' | '';
export interface Member {
  archive: string;
  /** member path inside the archive, original case ("meshes/ferry.msh") */
  path: string;
  size: number;
  ext: string;
  /** lower-case file name without extension */
  stem: string;
  base: string;
  dir: string;
}
export function memberOf(archive: string, e: { path: string; size: number }): Member {
  const parts = e.path.split('/');
  const file = parts[parts.length - 1];
  const dot = file.lastIndexOf('.');
  return { archive, path: e.path, size: e.size, ext: dot >= 0 ? file.slice(dot + 1).toLowerCase() : '', stem: (dot >= 0 ? file.slice(0, dot) : file).toLowerCase(), base: file.toLowerCase(), dir: parts.slice(0, -1).join('/').toLowerCase() };
}

/**
 * named.mjs: true = the executable (or a loader table) names the member; null = a zone texture `TextNNN` (matched by id elsewhere); false = never named.
 * `brickNames` = the names of Bricks/brickset.txt (lower case), only used for Bricks/lods.
 */
export function namedBy(blob: ExeStrings, tables: ZoneTables | undefined, m: Member, brickNames?: ReadonlySet<string>): { named: boolean | null; how: How } {
  const key = `${m.dir ? m.dir + '/' : ''}${m.base}`;
  if ((m.ext === 'msh' || m.ext === 'col') && tables && setOf(m.ext === 'msh' ? tables.meshAll : tables.colAll).has(key)) return { named: true, how: 'loader' };
  if (m.archive === 'Bricks' && m.dir === 'lods' && brickNames?.has(m.stem.replace(/_lod\d+$/, ''))) return { named: true, how: 'brickset' };
  if (blob.endsWith(`/${m.archive.toLowerCase()}/${key}`)) return { named: true, how: 'exact-path' };
  if (!NO_NAME_FALLBACK.has(m.ext) && blob.endsWith(`/${m.base}`)) return { named: true, how: 'exact-name' };
  if ((m.ext === 'tga' || m.ext === 'wib') && /^text\d+$/.test(m.stem)) return { named: null, how: 'texid' };
  if (m.stem.length >= 3 && blob.includes(m.stem)) return { named: true, how: 'stem-substr' };
  return { named: false, how: '' };
}

// ----------------------------------------------------------------------------------------------------------------- models

export interface ModelEntry {
  /** archive (zone) the mesh is in */
  archive: string;
  /** member path ("meshes/ferry.msh") */
  path: string;
  /** display name ("ferry") */
  name: string;
  size: number;
  /** a collision file with the same stem exists */
  col: string | null;
  /** the zone's loader tables name it, but no model part uses it ("geladen maar niet gebruikt"; filled for loaded meshes only) */
  group: 'never' | 'unwired';
}

export interface ModelLists {
  /** meshes no string and no table names (research: 805) */
  never: ModelEntry[];
  /** collision files never named (research: 787) */
  neverCol: { archive: string; path: string }[];
  /** loaded by the zone loader but not part of any model, per zone (research: z60FRE 359, z41MAP 9, z23DIP 1) */
  unwired: ModelEntry[];
  /** collision files never named whose mesh IS loaded (z28HAT 41 and z21FSH 45: the collision files of loaded characters) */
  colOnly: { archive: string; path: string; name: string; size: number }[];
  /** per zone: how many meshes the loader table has */
  loaded: Record<string, number>;
}

/** all never-named meshes / collision files of the archives and the loaded-but-unwired meshes of the zones */
export function computeModels(blob: ExeStrings, tables: Record<string, ZoneTables>, listings: readonly Listing[]): ModelLists {
  const never: ModelEntry[] = [], neverCol: { archive: string; path: string }[] = [], unwired: ModelEntry[] = [];
  const loaded: Record<string, number> = {};
  for (const a of listings) {
    const t = tables[a.name];
    if (t) loaded[a.name] = t.meshAll.length;
    const colOf = new Map<string, string>();
    for (const e of a.entries) { const m = memberOf(a.name, e); if (m.ext === 'col') colOf.set(m.stem, e.path); }
    for (const e of a.entries) {
      const m = memberOf(a.name, e);
      if (m.archive === 'Bricks') continue;   // the brick LODs are the brick gallery (computeBricks)
      if (m.ext === 'msh') {
        const r = namedBy(blob, t, m);
        if (r.named !== true) never.push({ archive: a.name, path: e.path, name: m.stem, size: e.size, col: colOf.get(m.stem) ?? null, group: 'never' });
        else if (t && r.how === 'loader' && !setOf(t.meshInModels).has(`${m.dir}/${m.base}`)) unwired.push({ archive: a.name, path: e.path, name: m.stem, size: e.size, col: colOf.get(m.stem) ?? null, group: 'unwired' });
      } else if (m.ext === 'col') {
        if (namedBy(blob, t, m).named !== true) neverCol.push({ archive: a.name, path: e.path });
      }
    }
  }
  const mine = new Set(never.map((e) => `${e.archive}/${e.name}`));
  const colOnly: ModelLists['colOnly'] = [];
  for (const c of neverCol) {
    const m = memberOf(c.archive, { path: c.path, size: 0 });
    if (!mine.has(`${c.archive}/${m.stem}`)) colOnly.push({ archive: c.archive, path: c.path, name: m.stem, size: listings.find((l) => l.name === c.archive)?.entries.find((e) => e.path === c.path)?.size ?? 0 });
  }
  return { never, neverCol, unwired, colOnly, loaded };
}

/** a mesh of another zone's tables with the same file name: its texture lists (the unused mesh can borrow them), best (most ids) first */
export function borrowTextures(tables: Record<string, ZoneTables>, ownZone: string, base: string): { zone: string; texList: number[] }[] {
  const out: { zone: string; texList: number[] }[] = [];
  const want = `meshes/${base.toLowerCase()}`;
  for (const [z, t] of Object.entries(tables)) {
    if (z === ownZone) continue;
    for (const l of t.meshTex[want] ?? []) out.push({ zone: z, texList: l });
  }
  return out.sort((a, b) => b.texList.filter((x) => x >= 0).length - a.texList.filter((x) => x >= 0).length);
}

// ----------------------------------------------------------------------------------------------------------------- textures

export interface TexEntry {
  archive: string;
  path: string;
  /** texture id of a zone texture, -1 for the others */
  id: number;
  label: string;
  size: number;
  ext: string;
}
export interface TextureLists {
  /** zone textures in no texture list (research: 151) */
  unlisted: TexEntry[];
  /** .tga members no EXE string names (research: 105) */
  leftovers: TexEntry[];
  /** zone textures in a list, per zone (for the grid's header) */
  total: Record<string, number>;
}

export function computeTextures(blob: ExeStrings, tables: Record<string, ZoneTables>, listings: readonly Listing[]): TextureLists {
  const unlisted: TexEntry[] = [], leftovers: TexEntry[] = [], total: Record<string, number> = {};
  for (const a of listings) {
    const t = tables[a.name];
    const listed = t ? new Set(t.texInLists) : null;
    for (const e of a.entries) {
      const m = memberOf(a.name, e);
      if (m.ext !== 'tga' && m.ext !== 'wib') continue;
      if (t && m.dir === 'textures' && /^text\d+$/.test(m.stem)) {
        const id = +m.stem.slice(4);
        total[a.name] = (total[a.name] ?? 0) + 1;
        if (!listed!.has(id)) unlisted.push({ archive: a.name, path: e.path, id, label: `${a.name} ${m.stem.slice(4)}`, size: e.size, ext: m.ext });
        continue;
      }
      if (m.ext !== 'tga') continue;
      const r = namedBy(blob, t, m);
      if (r.named === false) leftovers.push({ archive: a.name, path: e.path, id: -1, label: `${a.name}/${e.path}`, size: e.size, ext: m.ext });
    }
  }
  return { unlisted, leftovers, total };
}

/** the zone's own texture set: texture groups the unused sheets live in, per zone (display order for the grid) */
export function groupCount<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

// ----------------------------------------------------------------------------------------------------------------- brick models

/** the brick-model files (BrickMorph/*.txt) that no executable string names exactly (research: 5 of the 96 never loaded; test01.txt IS named) */
export function neverLoadedBrickModels(blob: ExeStrings, morph: Listing): string[] {
  const out: string[] = [];
  for (const e of morph.entries) {
    if (!/\.txt$/i.test(e.path)) continue;
    if (!blob.has(e.path.toLowerCase())) out.push(e.path);
  }
  return out;
}

/** a Pe-less helper for tests: names of brickset.txt in lower case */
export function brickSetNames(text: string): Set<string> {
  return new Set(text.split(/\r?\n/).filter((l) => l && !l.startsWith('//')).map((l) => l.split(/\s+/)[0].toLowerCase()));
}

/**
 * the bricks of brickset.txt that no brick-model file (BrickMorph/*.txt) uses (research: 47 of 257; 210 used by the 96 files). `lib` = a BrickLibrary
 * (src/formats/bricks.ts: the dictionaries are read from the executable, the models parsed the way FUN_0044d570 does).
 */
export function computeBricks(lib: { types: readonly ({ index: number; name: string } | null)[]; morph: { entries: readonly { path: string }[] } | null; model(file: string): { bricks: { type: number }[] } | null }): { used: Set<number>; unused: { index: number; name: string }[]; total: number; modelFiles: number } {
  const used = new Set<number>();
  let modelFiles = 0;
  for (const e of lib.morph?.entries ?? []) {
    if (!/\.txt$/i.test(e.path)) continue;
    const m = lib.model(e.path);
    if (!m) continue;
    modelFiles++;
    for (const b of m.bricks) used.add(b.type);
  }
  const unused: { index: number; name: string }[] = [];
  let total = 0;
  for (const t of lib.types) if (t) { total++; if (!used.has(t.index)) unused.push({ index: t.index, name: t.name }); }
  unused.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { used, unused, total, modelFiles };
}
