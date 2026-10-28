// Small text / config formats: message `.str` tag files, `TEXT` texture option lists (`.opt`/`.txl`), `MATL` (`.mtl`),
// `SRCL` (`.src`), `.gob` object descriptors, brick model text (`BrickMorph/*.txt`, `Bricks/brickset.txt`) and the
// documentation `.txt` files. Documented in docs/re/fragments/script-text.md.
import { Reader, latin1 } from './reader.ts';

const lines = (text: string) => text.split(/\r\n|\r|\n/);

// ------------------------------------------------------------------------------------------ tag files (.str)

export interface TagEntry {
  tag: string;
  /** everything after the ':' up to the end of line */
  value: string;
  line: number;
}
/**
 * Generic tag file reader (loader FUN_00439126 @0x00439126): a line starts a tag when its first byte is >= 0x20 and not '#';
 * the tag ends at the first ':'; the value is the rest of the line. A tag that meets a control char before ':' is dropped.
 * (The game then bubble-sorts the tags with strcmp and binary-searches them in FUN_004396a0.)
 */
export function parseTagFile(data: Uint8Array | string): TagEntry[] {
  const text = typeof data === 'string' ? data : latin1(data);
  const out: TagEntry[] = [];
  lines(text).forEach((l, i) => {
    if (l.length === 0 || l.charCodeAt(0) < 0x20 || l[0] === '#') return;
    const c = l.indexOf(':');
    if (c < 0) return;
    out.push({ tag: l.slice(0, c), value: l.slice(c + 1), line: i + 1 });
  });
  return out;
}

export interface StrEntry {
  /** message id, e.g. `LECSPP02`; the prefix tells the speaker/kind (see doc) */
  tag: string;
  /** the 4-char field after ':' as a number: sound / voice sample id (-1 = none) */
  soundId: number;
  /** message text as stored (escapes unprocessed) */
  text: string;
  line: number;
}
/** `.str`: `TAG:` + 4-char right-padded decimal id field + text (FUN_004396a0 returns value+4 as text). */
export function parseStr(data: Uint8Array | string): StrEntry[] {
  return parseTagFile(data).map((e) => {
    const idf = e.value.slice(0, 4);
    const m = /^(-?\d+) *$/.exec(idf);
    if (!m) throw new Error(`line ${e.line}: bad id field "${idf}" for ${e.tag}`);
    return { tag: e.tag, soundId: parseInt(m[1], 10), text: e.value.slice(4), line: e.line };
  });
}

/**
 * Message text post-processing of FUN_004397b9: `\n` `\t` `\\` escapes, `$$` `%%` `&&` literal escapes; other `$x`/`%x`/`&x`
 * (3 chars incl. the sigil) are parameter placeholders (none occur in the shipped data); bytes >= 0xE0 are folded to upper case (-0x20).
 */
export function decodeMessage(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c > 0xdf) c -= 0x20;
    const ch = String.fromCharCode(c);
    if (ch === '\\') {
      const n = s[++i];
      if (n === 'n') out += '\n'; else if (n === 't') out += '\t'; else if (n === '\\') out += '\\';
    } else if ((ch === '$' || ch === '%' || ch === '&') && s[i + 1] === ch) { out += ch; i++; }
    else out += ch;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ TEXT (.opt / .txl)

export interface TextOptions {
  /** declared texture count */
  count: number;
  /** one flag byte per texture (may be shorter than `count`, see doc) */
  flags: Uint8Array;
}
/** Flag bits (FUN_004100a1): 1 = wrap U (else clamp), 2 = wrap V (else clamp), 0x80 = keep full resolution; bit 4 stored, use unknown. */
export const TEXT_FLAG_WRAP_U = 1, TEXT_FLAG_WRAP_V = 2, TEXT_FLAG_FULLRES = 0x80;
export function parseTextOptions(data: Uint8Array): TextOptions {
  const r = new Reader(data);
  r.expectTag('TEXT');
  const count = r.u32();
  const flags = data.subarray(8).slice();
  return { count, flags };
}
/** Texture file name of entry `i` in a directory (`Text000.tga`, `Text012.tga`, `Text123.tga`): FUN_00442e80. */
export function textureName(i: number): string { return `Text${String(i).padStart(3, '0')}.tga`; }

// ------------------------------------------------------------------------------------------ MATL / SRCL

export interface MtlFile { count: number }
/** `.mtl` (`MATL`): only the empty list (count 0, 8 bytes) occurs in the shipped data. */
export function parseMtl(data: Uint8Array): MtlFile {
  const r = new Reader(data);
  r.expectTag('MATL');
  const count = r.u32();
  if (count !== 0 || r.remaining !== 0) throw new Error(`non-empty MATL (count ${count}, ${r.remaining} bytes left)`);
  return { count };
}
export interface SrcPoint { position: [number, number, number]; direction: [number, number, number] }
/** `.src` (`SRCL`): list of sources (count, then 24 bytes each: position xyz, direction xyz). */
export function parseSrc(data: Uint8Array): SrcPoint[] {
  const r = new Reader(data);
  r.expectTag('SRCL');
  const n = r.u32();
  const out: SrcPoint[] = [];
  for (let i = 0; i < n; i++) out.push({ position: [r.f32(), r.f32(), r.f32()], direction: [r.f32(), r.f32(), r.f32()] });
  if (r.remaining !== 0) throw new Error('trailing bytes');
  return out;
}

// ------------------------------------------------------------------------------------------ GOB

export interface Gob {
  zone: string;
  name: string;
  pos: [number, number, number];
  rot: [number, number, number];
  lods: { index: number; mesh: string; distance: number }[];
  groups: { index: number; texture: string }[];
  col?: string;
}
/** `.gob` game-object descriptor (text): `GOB <zone> <name>`, pos, rot, LODs/LOD, Groups/Group, Col. */
export function parseGob(text: string): Gob {
  const g: Gob = { zone: '', name: '', pos: [0, 0, 0], rot: [0, 0, 0], lods: [], groups: [] };
  let sawGob = false;
  for (const l of lines(text)) {
    const t = l.trim().split(/\s+/);
    if (t[0] === '') continue;
    switch (t[0]) {
      case 'GOB': g.zone = t[1]; g.name = t[2]; sawGob = true; break;
      case 'pos': g.pos = [+t[1], +t[2], +t[3]]; break;
      case 'rot': g.rot = [+t[1], +t[2], +t[3]]; break;
      case 'LODs': break;
      case 'LOD': g.lods.push({ index: +t[1], mesh: t[2], distance: +t[3] }); break;
      case 'Groups': break;
      case 'Group': g.groups.push({ index: +t[1], texture: t.slice(2).join(' ') }); break;
      case 'Col': g.col = t[1]; break;
      default: throw new Error(`unknown GOB line "${l}"`);
    }
  }
  if (!sawGob) throw new Error('missing GOB line');
  return g;
}

// ------------------------------------------------------------------------------------------ bricks

export interface BrickPlacement {
  /** layer index (count of `newlayer` lines before this brick) */
  layer: number;
  /** morph group (`AUTO00`..`AUTO09`, `PART00`..`PART19`) */
  group: string;
  brick: string;
  /** stud-grid units: x, z * 0.8 and y * 0.96 give world units (FUN_0044d570) */
  pos: [number, number, number];
  /** degrees about x, y, z */
  rot: [number, number, number];
  colour: string;
  colour2?: string;
  line: number;
}
export interface BrickModel {
  name: string;
  modelType: string;
  /** `AUTO` (centre from bounds), `BASEDON` or `VECTOR` */
  centreMode: string;
  centre?: [number, number, number];
  layers: number;
  bricks: BrickPlacement[];
  /** placements in the old `x y z BRICK_ORIENT_nnn colour` syntax (only house04.txt): the game's sscanf rejects these lines, so they are not loaded */
  legacy: BrickPlacement[];
  /** other lines the game's sscanf would reject (fewer than 9 fields): silently ignored by the loader */
  skipped: { line: number; text: string }[];
}
/** `BrickMorph/<name>NN.txt` (loader FUN_0044d570): 3 header lines, then brick lines and `newlayer`; `//` lines are comments. */
export function parseBrickModel(text: string): BrickModel {
  const L = lines(text);
  const hdr = (i: number) => L[i].trim().split(/\s+/);
  const h0 = hdr(0), h1 = hdr(1), h2 = hdr(2);
  // The game reads these three lines positionally and never checks the keywords (dinghy05.txt has a stray "auto01" glued to NAME).
  if (L.length < 3 || h2.length < 2) throw new Error('bad brick model header');
  const m: BrickModel = { name: h0[1] ?? '', modelType: h1[1] ?? '', centreMode: (h2[1] ?? '').toUpperCase(), layers: 0, bricks: [], legacy: [], skipped: [] };
  if (m.centreMode === 'VECTOR') m.centre = [+h2[2], +h2[3], +h2[4]];
  else if (m.centreMode !== 'AUTO' && m.centreMode !== 'BASEDON') throw new Error(`bad CENTRE mode ${m.centreMode}`);
  for (let i = 3; i < L.length; i++) {
    const t = L[i].trim();
    if (t === '' || t.startsWith('//')) continue;
    const tok = t.split(/\s+/);
    if (tok.length === 1) {
      if (tok[0].toLowerCase() === 'newlayer') m.layers++; else m.skipped.push({ line: i + 1, text: t });
      continue;
    }
    if (tok.length >= 7 && /^BRICK_ORIENT_\d+$/i.test(tok[5])) {
      const n3 = tok.slice(2, 5).map(Number);
      if (n3.every(Number.isFinite)) {
        m.legacy.push({ layer: m.layers, group: tok[0].toUpperCase(), brick: tok[1], pos: [n3[0], n3[1], n3[2]], rot: [0, parseInt(tok[5].slice(13), 10), 0], colour: tok[6], colour2: tok[7], line: i + 1 });
        continue;
      }
    }
    const nums = tok.slice(2, 8).map(Number);
    if (tok.length < 9 || nums.some((x) => !Number.isFinite(x))) { m.skipped.push({ line: i + 1, text: t }); continue; }
    m.bricks.push({ layer: m.layers, group: tok[0].toUpperCase(), brick: tok[1], pos: [nums[0], nums[1], nums[2]], rot: [nums[3], nums[4], nums[5]], colour: tok[8], colour2: tok[9], line: i + 1 });
  }
  return m;
}

export interface BrickSetEntry {
  name: string;
  /** three symmetry ints (0..2) */
  symmetry: [number, number, number];
  /** pivot offset in stud-grid units (x, z * 0.8; y * 0.96) */
  offset: [number, number, number];
}
/** `Bricks/brickset.txt` (FUN_00440xxx near 0x0044e...): `name sym1 sym2 sym3 ox oy oz`, `//` comments. */
export function parseBrickSet(text: string): BrickSetEntry[] {
  const out: BrickSetEntry[] = [];
  lines(text).forEach((l, i) => {
    const t = l.trim();
    if (t === '' || t.startsWith('//')) return;
    const k = t.split(/\s+/);
    if (k.length !== 7) throw new Error(`line ${i + 1}: expected 7 fields, got ${k.length}`);
    const n = k.slice(1).map(Number);
    if (n.some((x) => !Number.isFinite(x))) throw new Error(`line ${i + 1}: bad number`);
    out.push({ name: k[0], symmetry: [n[0], n[1], n[2]], offset: [n[3], n[4], n[5]] });
  });
  return out;
}

// ------------------------------------------------------------------------------------------ docs

/** `Overlays/<ZONE>/WhatsWhat.txt`: artist notes `Name --> textNNN`. */
export function parseWhatsWhat(text: string): { name: string; texture: string }[] {
  const out: { name: string; texture: string }[] = [];
  for (const l of lines(text)) {
    const m = /^\s*(\S.*?)\s*-+>\s*(\S+)\s*$/.exec(l);
    if (m) out.push({ name: m[1], texture: m[2] });
  }
  return out;
}

export type TxtKind = 'cutscene' | 'brickmorph' | 'brickset' | 'whatswhat' | 'messages' | 'notes' | 'empty';
/** Classify a `.txt` archive member by archive name and path. */
export function classifyTxt(archive: string, path: string, size: number): TxtKind {
  const p = path.toLowerCase();
  if (size === 0) return 'empty';
  if (/(^|\/)cutscene\//.test(p)) return 'cutscene';
  if (archive.toLowerCase() === 'brickmorph') return 'brickmorph';
  if (archive.toLowerCase() === 'bricks' && p === 'brickset.txt') return 'brickset';
  if (p.endsWith('whatswhat.txt')) return 'whatswhat';
  if (p.endsWith('english.txt')) return 'messages';
  return 'notes';
}
