// PE image access + zone table extraction from the game executable ("LEGO eiland 2.exe", NL retail).
// The per-zone tables that tell the engine which mesh is placed where with which textures are NOT
// stored in the data archives but compiled into the executable as straight-line code (see formats.md).
// This module finds and symbolically executes that code (x86.ts) and returns plain tables.
import { interpret } from './x86.ts';
import { buildMatrix } from './matrix.ts';
export { buildMatrix };
import type { Ev, Val, Image as X86Image, CallEv } from './x86.ts';

export interface Section { name: string; va: number; vsize: number; roff: number; rsize: number }

export class Pe implements X86Image {
  readonly data: Uint8Array;
  readonly base: number;
  readonly sections: Section[] = [];
  readonly text: Section;
  constructor(data: Uint8Array) {
    this.data = data;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] !== 0x4d || data[1] !== 0x5a) throw new Error('not a PE file');
    const pe = dv.getUint32(0x3c, true);
    const n = dv.getUint16(pe + 6, true);
    const opt = dv.getUint16(pe + 20, true);
    this.base = dv.getUint32(pe + 24 + 28, true);
    let at = pe + 24 + opt;
    for (let i = 0; i < n; i++, at += 40) {
      let name = '';
      for (let k = 0; k < 8 && data[at + k]; k++) name += String.fromCharCode(data[at + k]);
      this.sections.push({ name, va: this.base + dv.getUint32(at + 12, true), vsize: dv.getUint32(at + 8, true), roff: dv.getUint32(at + 20, true), rsize: dv.getUint32(at + 16, true) });
    }
    this.text = this.sections.find((s) => s.name === '.text')!;
  }
  offset(va: number): number {
    for (const s of this.sections) if (va >= s.va && va < s.va + Math.max(s.vsize, s.rsize)) { const r = va - s.va; return r < s.rsize ? s.roff + r : -1; }
    return -1;
  }
  at(va: number): number { const o = this.offset(va); return o < 0 ? (undefined as unknown as number) : this.data[o]; }
  slice(va: number, len: number): Uint8Array | null { const o = this.offset(va); return o < 0 ? null : this.data.subarray(o, o + len + 16); }
  u32(va: number): number { const o = this.offset(va); return o < 0 ? 0 : (this.data[o] | (this.data[o + 1] << 8) | (this.data[o + 2] << 16) | (this.data[o + 3] << 24)) >>> 0; }
  cstr(va: number, max = 260): string {
    const o = this.offset(va);
    if (o < 0) return '';
    let s = '';
    for (let i = 0; i < max && this.data[o + i]; i++) s += String.fromCharCode(this.data[o + i]);
    return s;
  }
  /** all virtual addresses of NUL-terminated strings that contain `needle` (case-insensitive) */
  findStrings(needle: string): number[] {
    const out: number[] = [];
    const nd = needle.toLowerCase();
    const d = this.data;
    const first = nd.charCodeAt(0);
    for (const s of this.sections) {
      for (let i = s.roff; i < s.roff + s.rsize - nd.length; i++) {
        const c = d[i] | 0x20;
        if (c !== first && d[i] !== first) continue;
        let ok = true;
        for (let k = 0; k < nd.length; k++) { let b = d[i + k]; if (b >= 65 && b <= 90) b += 32; if (b !== nd.charCodeAt(k)) { ok = false; break; } }
        if (!ok) continue;
        // walk back to the string start
        let st = i;
        while (st > s.roff && d[st - 1] >= 0x20 && d[st - 1] < 0x7f) st--;
        out.push(s.va + (st - s.roff));
      }
    }
    return [...new Set(out)];
  }
  /** call targets (E8) inside .text that begin with a frame prologue: the function starts we can trust */
  functionStarts(): number[] {
    const d = this.data, t = this.text;
    const set = new Set<number>();
    for (let o = t.roff; o < t.roff + t.rsize - 5; o++) {
      if (d[o] !== 0xe8) continue;
      const rel = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24);
      const tgt = (t.va + (o - t.roff) + 5 + rel) >>> 0;
      if (tgt < t.va || tgt >= t.va + t.rsize) continue;
      const to = t.roff + (tgt - t.va);
      if (d[to] === 0x55 && d[to + 1] === 0x8b && d[to + 2] === 0xec) set.add(tgt);
    }
    return [...set].sort((a, b) => a - b);
  }
  /** virtual addresses of `push imm32` instructions that push `va` */
  pushXrefs(va: number): number[] {
    const out: number[] = [];
    const d = this.data, t = this.text;
    for (let o = t.roff; o < t.roff + t.rsize - 5; o++) {
      if (d[o] === 0x68 && (d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24)) >>> 0 === va) out.push(t.va + (o - t.roff));
    }
    return out;
  }
}

// --------------------------------------------------------------------------------------------------
// Build profile: addresses of the engine helpers that the set-up code calls. They are identified by the
// way they are used (see docs); for the NL retail build (6459444 bytes) they are:
export interface Profile {
  recordsGlobal: number;   // base pointer of the object record array (stride recordStride)
  recordStride: number;
  modelsGlobal: number;    // array of model structs (0x18 bytes)
  fnModelAt: number;       // (array, i) -> array + i*0x18
  fnModelInit: number;     // (model, partCount)
  fnSetPart: number;       // (model, part, mesh, texList, ?, lodDistance, flag)
  fnCopyName: number;      // (dst, src, 4) strncpy-like
  fnMatrix: number;        // (m, rx, ry, rz, px, py, pz)
  fnMatrixScale: number;   // (m, rx, ry, rz, px, py, pz, sx, sy, sz)
  fnAttach: number;        // (parentModel, childModel, bone, slot)
}
export const PROFILE_NL: Profile = {
  recordsGlobal: 0x983804, recordStride: 0x68, modelsGlobal: 0x98380c,
  fnModelAt: 0x43eaf0, fnModelInit: 0x43e870, fnSetPart: 0x43ec10, fnCopyName: 0x85c0b0, fnMatrix: 0x43a5e4, fnMatrixScale: 0x43a742, fnAttach: 0x43e930,
};

export interface ModelPart { mesh: number; texList: number; lod: number; flag: number }
export interface Attachment { slot: number; bone: number; child: Model }
/** A model = up to 5 level-of-detail parts (part.lod = switch-in distance) plus child models attached to skeleton bones */
export interface Model { array: string; index: number; parts: ModelPart[]; attach: Attachment[] }
export interface PlacedRecord {
  index: number;
  name: string;
  /** index into models (key array:index) */
  model: Model | null;
  /** collision slot (into colPaths) or -1 */
  col: number;
  flags: number;
  /** 4x4 row-major (D3D row-vector convention): rows 0..2 rotation(*scale), row 3 translation */
  matrix: Float32Array;
  rot: [number, number, number];
  pos: [number, number, number];
  scale: [number, number, number];
}
export interface ZoneScene {
  zone: string;
  loaderAt: number;
  builderAt: number;
  /** slot -> path as written in the executable (e.g. "_data\\z02LGI\\Meshes\\SeaBed.Msh") */
  meshPaths: (string | null)[];
  colPaths: (string | null)[];
  /** texture-id lists (index into the list table); -1 = no texture */
  texLists: (number[] | null)[];
  models: Model[];
  records: PlacedRecord[];
  warnings: string[];
}

const f32buf = new DataView(new ArrayBuffer(4));
function asFloat(v: Val | undefined): number {
  if (!v || v.k !== 'imm') return NaN;
  f32buf.setUint32(0, v.v, true);
  return f32buf.getFloat32(0, true);
}
/** Find the function (call-target with prologue) that contains `va`, and the next function start. */
function containing(starts: number[], va: number): { start: number; end: number } {
  let lo = 0, hi = starts.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= va) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return { start: starts[ans], end: ans + 1 < starts.length ? starts[ans + 1] : starts[ans] + 0x100000 };
}

export function extractZone(pe: Pe, zone: string, profile: Profile = PROFILE_NL, starts?: number[]): ZoneScene {
  const warnings: string[] = [];
  if (profile === PROFILE_NL && pe.data.length !== 6459444) warnings.push(`executable is ${pe.data.length} bytes, the NL retail build is 6459444: the helper addresses in PROFILE_NL may not match`);
  starts ??= pe.functionStarts();
  // 1. loader: the function that references the zone's mesh path strings
  const strs = pe.findStrings(`_data\\${zone}\\meshes\\`).filter((s) => /\.msh$/i.test(pe.cstr(s)));
  if (!strs.length) throw new Error(`no mesh strings for zone ${zone} in the executable`);
  let loader = 0;
  for (const s of strs) { const x = pe.pushXrefs(s); if (x.length) { loader = containing(starts, x[0]).start; break; } }
  if (!loader) throw new Error(`no code references the mesh strings of ${zone}`);
  const loaderEnd = containing(starts, loader).end;
  // 2. builder: the function placed right before the loader (models + object records)
  const bi = starts.indexOf(loader);
  const builder = bi > 0 ? starts[bi - 1] : 0;
  const lev = interpret(pe, loader, loaderEnd);
  const bev = interpret(pe, builder, loader);

  // call ids restart per interpret() run: keep separate maps
  const mapOf = (evs: Ev[]) => { const m = new Map<number, CallEv>(); for (const e of evs) if (e.type === 'call') m.set(e.id, e); return m; };
  const lcalls = mapOf(lev);

  const meshPaths: (string | null)[] = [], colPaths: (string | null)[] = [], texLists: (number[] | null)[] = [];
  let meshTable = 0, colTable = 0, listTable = 0;
  const strOfArg = (a: Val | undefined): string | null => (a && a.k === 'imm' ? pe.cstr(a.v) : null);
  for (const e of lev) {
    if (e.type !== 'store' || !e.value || e.value.k !== 'ret' || !e.base) continue;
    const c = lcalls.get(e.value.id);
    if (!c) continue;
    const baseG = e.base.k === 'glob' ? e.base.a : e.base.k === 'gptr' ? e.base.a : 0;
    if (!baseG) continue;
    const s0 = strOfArg(c.args[0]);
    const slot = e.off >> 2;
    if (s0 && /\.msh$/i.test(s0)) { meshTable ||= baseG; if (baseG === meshTable) meshPaths[slot] = s0; }
    else if (s0 && /\.col$/i.test(s0)) { colTable ||= baseG; if (baseG === colTable) colPaths[slot] = s0; }
    else if (c.args.length === 2 && c.args[0]?.k === 'imm' && c.args[1]?.k === 'lea' && c.args[0].v <= 4096) {
      listTable ||= baseG;
      if (baseG === listTable) {
        const n = (c.args[0] as { v: number }).v, lo = (c.args[1] as { o: number }).o, ids: number[] = [];
        for (let i = 0; i < n; i++) { const v = c.locals?.get(lo + i * 4); ids.push(v === undefined ? -2 : v === 0xffffffff ? -1 : v); }
        texLists[slot] = ids;
      }
    }
  }
  // 3. builder: models and records
  const models = new Map<string, Model>();
  const modelOfRet = new Map<number, Model>();
  const arrKey = (v: Val | undefined): string => {
    if (!v) return '?';
    if (v.k === 'glob') return `g${v.a.toString(16)}`;
    if (v.k === 'load' && v.base.k === 'glob') return `g${v.base.a.toString(16)}+${v.o}`;
    return '?';
  };
  const recGlobal = profile.recordsGlobal;
  const recNames = new Map<number, string>(), recModel = new Map<number, Model>(), recCol = new Map<number, number>(), recFlags = new Map<number, number>();
  const recMat = new Map<number, { rot: number[]; pos: number[]; scale: number[] }>();
  const slotOf = (v: Val | undefined, table: number): number => (v && v.k === 'load' && v.base.k === 'glob' && v.base.a === table ? v.o >> 2 : v && v.k === 'glob' && v.a === table ? 0 : -1);
  const recIdx = (off: number, field: number) => (off - field) / profile.recordStride;
  for (const e of bev) {
    if (e.type === 'call') {
      const t = e.target;
      if (t === profile.fnModelAt) {
        const idx = e.args[1] && e.args[1].k === 'imm' ? e.args[1].v : -1;
        const key = `${arrKey(e.args[0])}:${idx}`;
        let m = models.get(key);
        if (!m) { m = { array: arrKey(e.args[0]), index: idx, parts: [], attach: [] }; models.set(key, m); }
        modelOfRet.set(e.id, m);
      } else if (t === profile.fnSetPart) {
        const mv = e.args[0];
        let m: Model | undefined;
        if (mv && mv.k === 'ret') m = modelOfRet.get(mv.id);
        else if (mv && mv.k === 'load' && mv.base.k === 'glob' && mv.base.a === recGlobal) m = recModel.get(recIdx(mv.o, 4));
        if (!m) { warnings.push(`setPart at ${e.at.toString(16)}: unknown model`); continue; }
        const part = e.args[1]?.k === 'imm' ? e.args[1].v : -1;
        const mesh = slotOf(e.args[2], meshTable);
        const texList = slotOf(e.args[3], listTable);
        m.parts[part] = { mesh, texList, lod: asFloat(e.args[5]) || 0, flag: e.args[6]?.k === 'imm' ? e.args[6].v : 0 };
      } else if (t === profile.fnAttach) {
        const pv = e.args[0], cv = e.args[1];
        let parent: Model | undefined, child: Model | undefined;
        if (pv && pv.k === 'ret') parent = modelOfRet.get(pv.id);
        else if (pv && pv.k === 'load' && pv.base.k === 'glob' && pv.base.a === recGlobal) parent = recModel.get(recIdx(pv.o, 4));
        if (cv && cv.k === 'ret') child = modelOfRet.get(cv.id);
        const bone = e.args[2]?.k === 'imm' ? e.args[2].v : -1, slot = e.args[3]?.k === 'imm' ? e.args[3].v : -1;
        if (parent && child) parent.attach[slot] = { slot, bone, child };
        else warnings.push(`attach at ${e.at.toString(16)}: unresolved parent/child`);
      } else if (t === profile.fnCopyName) {
        const d = e.args[0], s = strOfArg(e.args[1]);
        if (d && d.k === 'gptr' && d.a === recGlobal && s !== null) recNames.set(d.o / profile.recordStride, pe.cstr((e.args[1] as { v: number }).v, 4).slice(0, 4));
        else if (d && d.k === 'glob' && d.a === recGlobal && s !== null) recNames.set(0, pe.cstr((e.args[1] as { v: number }).v, 4).slice(0, 4));
      } else if (t === profile.fnMatrix || t === profile.fnMatrixScale) {
        const d = e.args[0];
        if (d && (d.k === 'gptr' || d.k === 'glob') && d.a === recGlobal) {
          const off = d.k === 'gptr' ? d.o : 0;
          const f = e.args.slice(1).map(asFloat);
          recMat.set(recIdx(off, 0xc), { rot: f.slice(0, 3), pos: f.slice(3, 6), scale: t === profile.fnMatrixScale ? f.slice(6, 9) : [1, 1, 1] });
        }
      }
    } else if (e.type === 'store' && e.base && (e.base.k === 'glob' && e.base.a === recGlobal)) {
      const rec = Math.floor(e.off / profile.recordStride), field = e.off - rec * profile.recordStride;
      const v = e.value;
      if (field === 4 && v && v.k === 'ret') { const m = modelOfRet.get(v.id); if (m) recModel.set(rec, m); }
      else if (field === 0x58) recCol.set(rec, slotOf(v, colTable));
      else if (field === 0x60 && v && v.k === 'imm') recFlags.set(rec, v.v);
    }
  }
  const records: PlacedRecord[] = [];
  const maxRec = Math.max(-1, ...recNames.keys(), ...recMat.keys());
  for (let i = 0; i <= maxRec; i++) {
    const mt = recMat.get(i);
    const rot = (mt?.rot ?? [0, 0, 0]) as [number, number, number], pos = (mt?.pos ?? [0, 0, 0]) as [number, number, number], scale = (mt?.scale ?? [1, 1, 1]) as [number, number, number];
    records.push({ index: i, name: recNames.get(i) ?? '', model: recModel.get(i) ?? null, col: recCol.get(i) ?? -1, flags: recFlags.get(i) ?? 0, matrix: buildMatrix(rot[0], rot[1], rot[2], pos[0], pos[1], pos[2], scale[0], scale[1], scale[2]), rot, pos, scale });
  }
  return { zone, loaderAt: loader, builderAt: builder, meshPaths, colPaths, texLists, models: [...models.values()], records, warnings };
}
