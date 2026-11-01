// FX_Bricks data (ms\FX_Bricks: Bricks.c, BrickRead.c, TBrickModel.c; docs/re/m4/wp9-bricks.md, formats.md section 10): the brick library of the
// `Bricks` archive (`brickset.txt` + `lods/<brick>_lod<n>.msh`) and the brick models of the `BrickMorph` archive, loaded the way the game's loaders do:
//   FUN_00447f20  the four name dictionaries (22 colours, 267 bricks, 30 groups AUTO09..PART19, 3 centre modes): read from the executable's code at run time
//   FUN_0044a5e0  brickset.txt (`%s %i %i %i %f %f %f`), up to three LOD meshes per brick (FUN_0044ddd0), missing LODs copied from the others, the
//                 number of vertices drawn in the first colour (the rest = glass panes etc. in the second colour)
//   FUN_0044d570  a brick model: 3 header lines (NAME / MODELTYPE / CENTRE AUTO|BASEDON|VECTOR x y z), then `group brick x y z rx ry rz colour [colour2]`
//                 lines (upper-cased, `sscanf("%s %s %f %f %f %f %f %f %s %s")` = 9 or 10 fields) and `NEWLAYER`; `//` lines are comments
//   FUN_0044e720  one brick: grid units x,z * 0.8, y * 0.96, degrees -> radians, rotation y + pi (wrapped), colour names -> palette indices
//   FUN_0044dba0  the brick positions normalised to the model's bounding box (the morph pairing uses them)
// The simulation (src/fx/bricks) uses `BrickModelData` / `BrickType`; the meshes are only needed to draw.
import type { Archive } from './archive.ts';
import type { Pe } from './exe.ts';
import { parseMsh } from './msh.ts';

// ------------------------------------------------------------------------------------------ dictionaries (FUN_00447f20)

/** FUN_00447f20 (the dictionary set-up) and FUN_0045bff4 (TDict add) */
export const FN_BRICK_DICTS = 0x447f20, FN_BRICK_DICTS_END = 0x449920, FN_DICT_ADD = 0x45bff4;
/** the dictionary handles' globals: DAT_05d124d0 colours (0x16), DAT_05cb58c4 bricks (0x10b), DAT_05d124cc groups (0x1e), DAT_05d124d4 centre modes (3) */
const DICT_GLOBALS = { colours: 0x05d124d0, bricks: 0x05cb58c4, groups: 0x05d124cc, centres: 0x05d124d4 } as const;
/** the number of brick slots of the library table DAT_05d124e8 (0x10b x 0x48 bytes) */
export const BRICK_SLOTS = 0x10b;

export interface BrickDicts {
  /** upper-case name -> value (FUN_0045c144 compares without case) */
  colours: Map<string, number>; bricks: Map<string, number>; groups: Map<string, number>; centres: Map<string, number>;
}
const dictCache = new WeakMap<Pe, BrickDicts>();
/**
 * The four dictionaries of FUN_00447f20, read from its code: every `push value; push offset name; push reg; call FUN_0045bff4` whose `reg` was loaded
 * from one of the four handle globals (`mov reg, [global]`).
 */
export function brickDictionaries(pe: Pe): BrickDicts {
  const hit = dictCache.get(pe);
  if (hit) return hit;
  const d: BrickDicts = { colours: new Map(), bricks: new Map(), groups: new Map(), centres: new Map() };
  const byGlobal = new Map<number, Map<string, number>>([[DICT_GLOBALS.colours, d.colours], [DICT_GLOBALS.bricks, d.bricks], [DICT_GLOBALS.groups, d.groups], [DICT_GLOBALS.centres, d.centres]]);
  const u8 = (a: number) => pe.u32(a) & 0xff;
  const regGlobal: (number | null)[] = new Array(8).fill(null);   // eax..edi -> the global it was loaded from
  const stack: { kind: 'imm' | 'reg'; v: number }[] = [];
  let a = FN_BRICK_DICTS;
  while (a < FN_BRICK_DICTS_END) {
    const op = u8(a);
    if (op === 0xa1) { regGlobal[0] = pe.u32(a + 1); a += 5; continue; }                                    // mov eax, [abs]
    if (op === 0x8b && (u8(a + 1) & 0xc7) === 0x05) { regGlobal[(u8(a + 1) >> 3) & 7] = pe.u32(a + 2); a += 6; continue; }   // mov r32, [abs]
    if (op === 0xa3) { a += 5; continue; }                                                                   // mov [abs], eax
    if (op === 0x6a) { stack.push({ kind: 'imm', v: (u8(a + 1) << 24) >> 24 }); a += 2; continue; }        // push imm8
    if (op === 0x68) { stack.push({ kind: 'imm', v: pe.u32(a + 1) }); a += 5; continue; }                  // push imm32
    if (op >= 0x50 && op <= 0x57) { stack.push({ kind: 'reg', v: op - 0x50 }); a += 1; continue; }          // push r32
    if (op === 0x83 && u8(a + 1) === 0xc4) { a += 3; continue; }                                            // add esp, imm8
    if (op === 0xe8) {                                                                                       // call rel32
      const t = (a + 5 + (pe.u32(a + 1) | 0)) >>> 0;
      if (t === FN_DICT_ADD && stack.length >= 3) {
        const h = stack[stack.length - 1], name = stack[stack.length - 2], value = stack[stack.length - 3];
        const g = h.kind === 'reg' ? regGlobal[h.v] : null;
        const m = g !== null ? byGlobal.get(g) : undefined;
        if (m && name.kind === 'imm' && value.kind === 'imm') {
          const s = pe.cstr(name.v).toUpperCase();
          if (!m.has(s)) m.set(s, value.v);
        }
      }
      stack.length = 0;
      a += 5; continue;
    }
    if (op === 0xc3) break;
    a += 1;   // anything else (not in this straight-line function): step on
  }
  dictCache.set(pe, d);
  return d;
}

/** DAT_00981980: the 32 palette cells of the brick texture (u, v per colour index; Effects.c FUN_00886be0 reads `table + colour * 8`) */
export const BRICK_PALETTE_VA = 0x981980;
/** the palette cell of colour `c` (read from the executable; an unknown colour (-1) reads the 8 bytes before the table, as the original does) */
export function brickPaletteUv(pe: Pe, c: number): [number, number] {
  const f = (va: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, pe.u32(va), true); return b.getFloat32(0, true); };
  return [f(BRICK_PALETTE_VA + c * 8), f(BRICK_PALETTE_VA + c * 8 + 4)];
}

// ------------------------------------------------------------------------------------------ the brick library (FUN_0044a5e0)

/** grid -> world units: x, z * 0.8 (DAT_00892084), y * 0.96 (DAT_008922a8) */
export const GRID_XZ = Math.fround(0.8), GRID_Y = Math.fround(0.96);
const DEG = new Float32Array(new Uint32Array([0x3c8efa35]).buffer)[0];   // DAT_008922d0 = 0x3c8efa35 (pi / 180 as a float32: 0.01745329238; the decompile's decimal 0.0174533 is another float)
const PI = Math.fround(Math.PI), TWO_PI = Math.fround(2 * Math.PI);

export interface BrickLod {
  /** x, y, z per vertex (the mesh's own coordinates) */
  positions: Float32Array;
  normals: Float32Array;
  /** triangle list with absolute vertex indices (FUN_0044ddd0 adds each GRPL group's first vertex) */
  indices: Uint16Array;
  vertexCount: number;
}
export interface BrickType {
  index: number;
  name: string;
  /** the three ints of brickset.txt (rotation symmetry classes: 1 = half turn, 2 = quarter turn; the first one is used by the un-spin action) */
  sym: [number, number, number];
  /** pivot offset (brickset.txt x * 0.8, y * 0.96, z * 0.8) */
  offset: [number, number, number];
  /** bit n = `lods/<name>_lod<n>.msh` exists */
  lodMask: number;
  /** the mesh drawn at LOD 0..2 after the copies of FUN_0044a5e0 (null: no mesh at all); filled on demand by `brickLod` */
  lodFile: (number | null)[];
  /** the last N vertices of every LOD are drawn in the second colour (FUN_0044a5e0's switch; 0 for most bricks) */
  secondColour: number;
  /** per LOD: a first-colour count the loader writes over the computed one (TABLE_PATCHES), else null */
  splitPatch: (number | null)[];
}

/** FUN_0044a5e0: bricks whose last N vertices are drawn in the second colour (window / door panes); key = brick index - 0x10 (the switch variable) */
const SECOND_COLOUR_VERTICES: Record<number, number> = {
  0x00: 24, 0xdc: 24,
  0x12: 16, 0x79: 16, 0xcf: 16, 0xd2: 16, 0xdb: 16,
  0x13: 8, 0x16: 8, 0x7d: 8, 0xd3: 8, 0xd4: 8, 0xd6: 8, 0xd7: 8, 0xd8: 8, 0xda: 8, 0xde: 8, 0xee: 8,
  0x14: 32, 0xd1: 32, 0xd5: 32,
  0x15: 48,
  0xcc: 72,
};
/** FUN_0044a5e0 @0x44a9cb..0x44aa8a: fixed counts written into the library table DAT_05d124e8 afterwards (address, value) */
const TABLE_PATCHES: [number, number][] = [
  [0x05d161d0, 0x30], [0x05d16214, 0x78], [0x05d16216, 0x78], [0x05d16cc8, 0x30], [0x05d16218, 0x3c], [0x05d161ce, 0x3c], [0x05d1490c, 0x10],
  [0x05d12bce, 0x46], [0x05d16cc6, 0x46], [0x05d1490e, 0x18], [0x05d14910, 0x0e], [0x05d160ac, 0xac], [0x05d160ae, 0x90], [0x05d160b0, 0x6f],
  [0x05d1601c, 0x4a6], [0x05d1601e, 800], [0x05d16020, 0x2a3], [0x05d161cc, 0x48], [0x05d12bcc, 0x5a], [0x05d12bd0, 0x28], [0x05d16d0c, 0xfc],
  [0x05d16d0e, 0x96], [0x05d16d10, 0x48], [0x05d16cc4, 0x81],
];
const TABLE_BASE = 0x05d124e8, TABLE_STRIDE = 0x48;

/** one line of brickset.txt as `sscanf("%s %i %i %i %f %f %f")` reads it (7 fields or nothing) */
export function parseBrickSetLine(line: string): { name: string; sym: [number, number, number]; offset: [number, number, number] } | null {
  const t = line.trim().split(/\s+/);
  if (t.length < 7) return null;
  const i = t.slice(1, 4).map((x) => parseInt(x, 10)), f = t.slice(4, 7).map((x) => Math.fround(Number.parseFloat(x)));   // (`%f` stores a float: the x 0.8 / y 0.96 scaling then multiplies float32 values, FUN_0044a5e0)
  if (i.some((x) => !Number.isFinite(x)) || f.some((x) => !Number.isFinite(x))) return null;
  return { name: t[0], sym: [i[0], i[1], i[2]], offset: [f[0], f[1], f[2]] };
}

/** a LOD mesh file the way FUN_0044ddd0 keeps it (positions, normals, one absolute index list) */
export function readBrickLod(data: Uint8Array): BrickLod {
  const m = parseMsh(data);
  const idx = new Uint16Array(m.indices.length);
  for (const g of m.groups) for (let i = 0; i < g.indexCount; i++) idx[g.firstIndex + i] = m.indices[g.firstIndex + i] + g.firstVertex;
  return { positions: m.positions, normals: m.normals, indices: idx, vertexCount: m.vertexCount };
}

/** the brick library: brickset.txt and the LOD meshes (loaded when first drawn) */
export class BrickLibrary {
  readonly pe: Pe;
  readonly dicts: BrickDicts;
  /** index = brick dictionary value (0 .. 0x10a); null = not in brickset.txt */
  readonly types: (BrickType | null)[] = new Array(BRICK_SLOTS).fill(null);
  readonly bricks: Archive;
  readonly morph: Archive | null;
  private lods = new Map<string, BrickLod | null>();
  private models = new Map<string, BrickModelData | null>();
  /** LEGO 3D mod only: first-colour vertex counts of replaced LOD meshes (`lego3d/bricksplit.json` of the Bricks archive: { "<brick>_<lod file>": n }); null = the member does not exist (the original's rule applies) */
  private lego3dSplit: Record<string, number> | null = null;

  constructor(pe: Pe, bricks: Archive, morph: Archive | null) {
    this.pe = pe; this.bricks = bricks; this.morph = morph;
    this.dicts = brickDictionaries(pe);
    const e = bricks.find('brickset.txt');
    const text = e ? new TextDecoder('latin1').decode(bricks.read(e)) : '';
    const sp = bricks.find('lego3d/bricksplit.json');
    if (sp) { try { this.lego3dSplit = JSON.parse(new TextDecoder().decode(bricks.read(sp))) as Record<string, number>; } catch { this.lego3dSplit = null; } }
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseBrickSetLine(line);
      if (!p) continue;
      const k = this.dicts.bricks.get(p.name.toUpperCase());
      if (k === undefined || k < 0 || k >= BRICK_SLOTS) continue;
      let mask = 0;
      for (let l = 0; l < 3; l++) if (bricks.find(this.lodPath(p.name, l))) mask |= 1 << l;
      // FUN_0044a5e0's switch on the LOD mask: a missing LOD takes the mesh (and the counts) of another one
      const file: (number | null)[] = [mask & 1 ? 0 : null, mask & 2 ? 1 : null, mask & 4 ? 2 : null];
      const cp = (to: number, from: number) => { file[to] = file[from]; };
      switch (mask) {
        case 1: cp(1, 0); cp(2, 0); break;
        case 2: cp(0, 1); cp(2, 1); break;
        case 3: cp(2, 1); break;
        case 4: cp(0, 2); cp(1, 2); break;
        case 5: cp(1, 2); break;
        case 6: cp(0, 1); break;
      }
      this.types[k] = {
        index: k, name: p.name, sym: p.sym,
        offset: [Math.fround(p.offset[0] * GRID_XZ), Math.fround(p.offset[1] * GRID_Y), Math.fround(p.offset[2] * GRID_XZ)],
        lodMask: mask, lodFile: file, secondColour: SECOND_COLOUR_VERTICES[k - 0x10] ?? 0, splitPatch: [null, null, null],
      };
    }
    for (const [va, v] of TABLE_PATCHES) {
      const o = va - TABLE_BASE, k = Math.floor(o / TABLE_STRIDE), f = o % TABLE_STRIDE;
      const t = this.types[k];
      if (t && f >= 0x24 && f < 0x2a) t.splitPatch[(f - 0x24) >> 1] = v;   // the patched fields are the first-colour counts (+0x24 + 2 lod)
    }
  }

  private lodPath(name: string, l: number) { return `lods/${name}_lod${l}.msh`; }
  /** a LOD mesh file of a brick (cached; null when missing) */
  lod(name: string, l: number): BrickLod | null {
    const key = `${name.toLowerCase()}_${l}`;
    if (this.lods.has(key)) return this.lods.get(key)!;
    let m: BrickLod | null = null;
    const e = this.bricks.find(this.lodPath(name, l));
    if (e) { try { m = readBrickLod(this.bricks.read(e)); } catch { m = null; } }
    this.lods.set(key, m);
    return m;
  }
  /** the mesh drawn for brick type `t` at LOD `l` (after the copies) */
  meshOf(t: BrickType, l: number): BrickLod | null {
    const f = t.lodFile[l];
    return f === null || f === undefined ? null : this.lod(t.name, f);
  }

  /** FUN_0044d420's split argument: the number of vertices of LOD `l` drawn in the first colour */
  splitOf(t: BrickType, l: number): number {
    const f = t.lodFile[l];
    if (this.lego3dSplit && f !== null && f !== undefined) { const v = this.lego3dSplit[`${t.name.toLowerCase()}_${f}`]; if (typeof v === 'number') return v; }   // a replaced mesh (LEGO 3D): its own first-colour count
    const p = t.splitPatch[l];
    if (p !== null && p !== undefined) return p;
    return (this.meshOf(t, l)?.vertexCount ?? 0) - t.secondColour;
  }

  /** `BrickMorph/<file>` parsed with FUN_0044d570 (cached; every effect instance builds its own bricks from it) */
  model(file: string): BrickModelData | null {
    const key = file.toLowerCase();
    if (this.models.has(key)) return this.models.get(key)!;
    let m: BrickModelData | null = null;
    const e = this.morph?.find(file);
    if (e) m = loadBrickModel(new TextDecoder('latin1').decode(this.morph!.read(e)), this);
    this.models.set(key, m);
    return m;
  }
}

// ------------------------------------------------------------------------------------------ brick models (FUN_0044d570 / FUN_0044e720 / FUN_0044dba0)

export interface BrickModelBrick {
  /** brick library index (FUN_0045c144 of the brick dictionary) */
  type: number;
  /** +0x13c: position (grid scaled, plus the model's centre) */
  pos: [number, number, number];
  /** +0x124: rotation in radians (y + pi, wrapped to -pi..pi) */
  rot: [number, number, number];
  /** +0xe8 / +0xec: palette indices (-1 = unknown / none) */
  colour: number; colour2: number;
  /** +0xf0: NEWLAYER count before the brick */
  layer: number;
  /** +0xf3: group (AUTO09..AUTO00 = 0..9, PART00..PART19 = 10..29, anything else 255) */
  group: number;
  /** +0x154: position normalised to the model's bounds (0..1 per axis; 0 on a flat axis) */
  norm: [number, number, number];
  /** the 1-based source line */
  line: number;
}
export interface BrickModelData {
  name: string;
  /** 0 AUTO, 1 BASEDON, 2 VECTOR (the CENTRE dictionary), -1 unknown */
  centreMode: number;
  /** +0x58: the centre added to every brick (VECTOR: given, grid scaled; AUTO: computed) */
  centre: [number, number, number];
  /** the bricks in FILE order (the original's list runs the other way: its head is the last brick of the file) */
  bricks: BrickModelBrick[];
  /** +0x68: NEWLAYER count */
  layers: number;
  /** +0x6c..+0x74: 1 / bounding box size per axis (0 when flat); +0x78: their squared length */
  invExtent: [number, number, number]; invExtentSq: number;
}

/** sscanf's %f on one token: a C float prefix, or null when the conversion fails */
function scanFloat(tok: string | undefined): number | null {
  if (tok === undefined) return null;
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(tok);
  return m ? Math.fround(parseFloat(m[0])) : null;
}
const wrapPi = (a: number) => (a > PI ? Math.fround(a - TWO_PI) : a < -PI ? Math.fround(a + TWO_PI) : a);

/** FUN_0044d570 (+ FUN_0044e720 per brick, FUN_0044dba0) */
export function loadBrickModel(text: string, lib: { dicts: BrickDicts; types: readonly (BrickType | null)[] }): BrickModelData {
  const L = text.split(/\r\n|\r|\n/);
  const words = (i: number) => (L[i] ?? '').trim().split(/\s+/).filter(Boolean);
  const name = words(0)[1] ?? '';
  // line 3: `%s %s` -> centre mode (dictionary), VECTOR: `%s %s %f %f %f` scaled
  const h = words(2);
  const centreMode = lib.dicts.centres.get((h[1] ?? '').toUpperCase()) ?? -1;
  const centre: [number, number, number] = [0, 0, 0];
  if (centreMode === 2) {
    const x = scanFloat(h[2]) ?? 0, y = scanFloat(h[3]) ?? 0, z = scanFloat(h[4]) ?? 0;
    centre[0] = Math.fround(x * GRID_XZ); centre[1] = Math.fround(y * GRID_Y); centre[2] = Math.fround(z * GRID_XZ);
  }
  const bricks: BrickModelBrick[] = [];
  let layer = 0;
  // AUTO: the original tracks min / max of x and z only (y keeps the first brick's value)
  let haveMin = false, haveMax = false;
  const mn = [0, 0, 0], mx = [0, 0, 0];
  for (let i = 3; i < L.length; i++) {
    const raw = L[i];
    if (raw.startsWith('//')) continue;
    const line = raw.toUpperCase();
    const t = line.trim().split(/\s+/).filter(Boolean);
    // count of successful conversions of "%s %s %f %f %f %f %f %f %s %s"
    let n = 0;
    const f: number[] = [];
    if (t.length >= 1) n = 1;
    if (t.length >= 2) {
      n = 2;
      for (let k = 2; k < 8; k++) { const v = scanFloat(t[k]); if (v === null) break; f.push(v); n++; }
      if (n === 8 && t.length >= 9) { n = 9; if (t.length >= 10) n = 10; }
    }
    if (n === 1) { if (line.startsWith('NEWLAYER')) layer++; continue; }
    if (n !== 9 && n !== 10) continue;
    const type = lib.dicts.bricks.get(t[1]);
    if (type === undefined || type < 0) continue;   // FUN_0044e720 returns 0 for an unknown brick name
    const pos: [number, number, number] = [Math.fround(f[0] * GRID_XZ), Math.fround(f[1] * GRID_Y), Math.fround(f[2] * GRID_XZ)];
    const rot: [number, number, number] = [Math.fround(f[3] * DEG), Math.fround(f[4] * DEG), Math.fround(f[5] * DEG)];
    rot[1] = wrapPi(Math.fround(rot[1] + PI));
    const colour = lib.dicts.colours.get(t[8]) ?? -1;
    const colour2 = n === 10 ? lib.dicts.colours.get(t[9]) ?? -1 : -1;
    const group = lib.dicts.groups.get(t[0]) ?? 255;
    bricks.push({ type, pos, rot, colour, colour2, layer, group: group & 0xff, norm: [0, 0, 0], line: i + 1 });
    if (centreMode === 0) {
      if (!haveMin) { haveMin = true; mn[0] = pos[0]; mn[1] = pos[1]; mn[2] = pos[2]; }
      if (!haveMax) { haveMax = true; mx[0] = pos[0]; mx[1] = pos[1]; mx[2] = pos[2]; }
      if (pos[0] <= mn[0]) mn[0] = pos[0];
      if (pos[2] <= mn[2]) mn[2] = pos[2];
      if (mx[0] <= pos[0]) mx[0] = pos[0];
      if (mx[2] <= pos[2]) mx[2] = pos[2];
    }
  }
  if (centreMode === 0) {
    // centre = max - (max - min) * 0.5 per axis, every operation a float32 (the x87 runs at 24 bit); y keeps the first brick's value (max = min)
    for (let k = 0; k < 3; k++) centre[k] = Math.fround(mx[k] - Math.fround(Math.fround(mx[k] - mn[k]) * 0.5));
  }
  for (const b of bricks) for (let k = 0; k < 3; k++) b.pos[k] = Math.fround(b.pos[k] + centre[k]);
  // FUN_0044dba0: bounds (max starts at 0, min at FLT_MAX) and the normalised positions
  const lo = [3.4028235e38, 3.4028235e38, 3.4028235e38], hi = [0, 0, 0];
  for (const b of bricks) for (let k = 0; k < 3; k++) { if (b.pos[k] <= lo[k]) lo[k] = b.pos[k]; if (hi[k] <= b.pos[k]) hi[k] = b.pos[k]; }
  // (the x87 runs at 24-bit precision: the extent, its reciprocal, the offset from the minimum and the product are each a float32; docs/re/gaps.md "x87 control word")
  const fr = Math.fround;
  const ext = [fr(hi[0] - lo[0]), fr(hi[1] - lo[1]), fr(hi[2] - lo[2])];
  const inv: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (ext[k] > 0) {
      inv[k] = fr(1 / ext[k]);
      for (const b of bricks) b.norm[k] = fr(inv[k] * fr(b.pos[k] - lo[k]));
    }
  }
  return { name, centreMode, centre, bricks, layers: layer, invExtent: inv, invExtentSq: fr(fr(fr(inv[0] * inv[0]) + fr(inv[1] * inv[1])) + fr(inv[2] * inv[2])) };   // (x, y, z: the instruction order of FUN_0044dba0's last store; the decompile lists z, y, x)
}
