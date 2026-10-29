// Sub-object matrices of a record's mesh (WP4, docs/re/m4/wp4-triggers.md "Mesh parts"). FUN_0043ea40(rec+4) / FUN_0043ea60(rec+4, i) give the number of
// sub-object matrices of the record's render instance and a pointer to matrix i (0x40 bytes each). They are the mesh's MATL entries (a .Msh group is drawn
// with world' = matl[gtom[g]] * world, src/formats/msh.ts groupMatrices); doors (FUN_0053594e), swinging parts (FUN_00536256) and the island switch node
// (LGI_FSM, FUN_004b7c78) rotate them in place with FUN_0043a4a1 / FUN_0043a5e4.
//
// The port keeps one LIVE copy per (record, index), created from the mesh's MATL the first time a node asks for it, in `world.ext` (key PARTS_KEY).
// RENDERER CONTRACT (src/game/render.ts, the lead's): when `partOverrides(w, rec)` has an entry for MATL index i, every group of the record's mesh (any
// LOD: all LODs of the island buildings have the same MATL count) whose gtom index is i is drawn with that matrix instead of the static groupMatrices one.
import { parseMsh } from '../../formats/msh.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../ctx.ts';

export const PARTS_KEY = 'island.parts';
interface PartStore { live: Map<GameRecord, Map<number, Float32Array>>; base: Map<GameRecord, Float32Array[] | null> }

function store(w: World): PartStore {
  let s = w.ext.get(PARTS_KEY) as PartStore | undefined;
  if (!s) { s = { live: new Map(), base: new Map() }; w.ext.set(PARTS_KEY, s); }
  return s;
}

/** the MATL matrices of the record's level-of-detail 0 mesh (the static pose), null when the mesh is unknown (no `ctx.scene`) or has no MATL */
export function baseParts(w: World, rec: GameRecord): Float32Array[] | null {
  const s = store(w);
  if (s.base.has(rec)) return s.base.get(rec)!;
  let out: Float32Array[] | null = null;
  const c = tryCtx(w);
  const part = rec.model?.parts.find(Boolean);
  const path = part && c?.scene ? c.scene.meshPaths[part.mesh] : null;
  if (path && c) {
    const member = path.split('\\').slice(2).join('/');
    const e = c.archive.find(member);
    if (e) {
      try {
        const msh = parseMsh(c.archive.read(e));
        if (msh.matl) {
          out = [];
          const n = msh.matl.length / 9;
          for (let i = 0; i < n; i++) { const f = msh.matl.subarray(i * 9, i * 9 + 9); out.push(buildMatrix(f[3], f[4], f[5], f[0], f[1], f[2], f[6], f[7], f[8])); }
        }
      } catch { out = null; }
    }
  }
  s.base.set(rec, out);
  return out;
}
// (the renderer's static group matrices, msh.ts groupMatrices, are exactly baseParts()[gtom[g]])

/** FUN_0043ea40: number of sub-object matrices (0 when unknown) */
export function partCount(w: World, rec: GameRecord): number { return baseParts(w, rec)?.length ?? 0; }

/** FUN_0043ea60(rec+4, i): the live matrix i (row-major, translation in 12..14), null when out of range (the original returns 0) */
export function partMatrix(w: World, rec: GameRecord, i: number): Float32Array | null {
  const base = baseParts(w, rec);
  if (!base || i < 0 || i >= base.length) return null;
  const s = store(w);
  let m = s.live.get(rec);
  if (!m) { m = new Map(); s.live.set(rec, m); }
  let a = m.get(i);
  if (!a) { a = base[i].slice(); m.set(i, a); }
  return a;
}

/** FUN_0043a4a1(m, rx, ry, rz): rotation part rebuilt from Euler angles (no scale), translation kept */
export function setRotation(m: Float32Array, rx: number, ry: number, rz: number) {
  const r = buildMatrix(rx, ry, rz, m[12], m[13], m[14]);
  m.set(r);
}
/** FUN_0043a5e4(m, rx, ry, rz, x, y, z) */
export function setEulerPos(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number) { m.set(buildMatrix(rx, ry, rz, x, y, z)); }

/** for the renderer: the live sub-object matrices of a record (MATL index -> matrix), undefined when no node touched any */
export function partOverrides(w: World, rec: GameRecord): ReadonlyMap<number, Float32Array> | undefined { return store(w).live.get(rec); }
