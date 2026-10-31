// "LEGO 3D" mod option (docs/re/lego3d.md section 4.4): real stud geometry on the game's stud plates. ONLY active when the enabled mods carry `lego3d/studs.json` in the zone's archive (made by
// tools/lego3d/studs.mjs from the texture mapping of the plate meshes); the original game never loads this module's data and draws nothing extra.
// The studs are drawn like the game draws its brick effects (src/fx/bricks/draw.ts): vertices transformed on the CPU, lit with the game's own light set (specular variant), the palette cell of the
// brick colour as texture, state preset 5, 4096-vertex batches. Per frame one stud mesh per (plate record, level of detail) is rotated and lit; every stud then only copies it to its position (the
// lighting of a directional light does not depend on the position of the vertex, only the specular half vector does, and that is the camera's, as in the original's batch code).
import type { Renderer, BatchGpu } from '../../render/index.ts';
import { prepareLights, lightShiny } from '../../render/meshlight.ts';
import { transformDirGame } from '../../render/math.ts';
import { brickPaletteUv } from '../../formats/bricks.ts';
import type { BrickLibrary } from '../../formats/bricks.ts';
import type { Archive } from '../../formats/archive.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NO_DRAW } from '../../game/record.ts';
import { BRICK_PRESET, BATCH_VERTICES, BATCH_INDICES } from '../../fx/bricks/draw.ts';

interface StudMesh { positions: number[]; normals: number[]; indices: number[] }
export interface StudSet { rec: number; name: string; mesh: string; group?: number; colour: string; pitch: number; studs: number[] }
export interface StudData { version: number; hi: StudMesh; lo: StudMesh; sets: StudSet[] }

/** full studs (16 sides) within `HI` units of the camera, 8-sided studs within `LO`, none beyond (the painted studs of the plate texture show there) */
export const STUD_HI = 8, STUD_LO = 22;
/** at most this many studs are put into one frame */
const MAX_STUDS = 1500;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** the stud data of the mod, or null (no mod / no studs: nothing is drawn, nothing is read) */
export function loadLegoStuds(archive: Archive): StudData | null {
  try {
    const e = archive.find('lego3d/studs.json');
    if (!e) return null;
    const d = JSON.parse(new TextDecoder().decode(archive.read(e))) as StudData;
    return d.version === 1 && Array.isArray(d.sets) ? d : null;
  } catch { return null; }
}

interface Cpu { pos: Float32Array; uv: Float32Array; col: Uint8Array; spec: Uint8Array; idx: Uint16Array; nv: number; ni: number }
interface State { gpu: BatchGpu; cpu: Cpu; stats: { studs: number; verts: number; flushes: number } }
const states = new WeakMap<Renderer, State>();
const stateOf = (r: Renderer): State => {
  let s = states.get(r);
  if (!s) { s = { gpu: r.createBatch(BATCH_VERTICES, BATCH_INDICES), cpu: { pos: new Float32Array(BATCH_VERTICES * 3), uv: new Float32Array(BATCH_VERTICES * 2), col: new Uint8Array(BATCH_VERTICES * 4), spec: new Uint8Array(BATCH_VERTICES * 4), idx: new Uint16Array(BATCH_INDICES), nv: 0, ni: 0 }, stats: { studs: 0, verts: 0, flushes: 0 } }; states.set(r, s); }
  return s;
};
/** statistics of the last frame (tests, the browser scenes): studs drawn, vertices, batch draws */
export function legoStudStats(r: Renderer) { return states.get(r)?.stats ?? null; }

/** one oriented, lit stud mesh of a record at a level of detail: positions relative to the stud's base, the colours the game's lighting gives them this frame */
interface Template { nv: number; ni: number; pos: Float32Array; col: Uint8Array; spec: Uint8Array; idx: Uint16Array }
function template(m: StudMesh, rotate: ArrayLike<number>, pitch: number, prep: ReturnType<typeof prepareLights>): Template {
  const nv = m.positions.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Uint8Array(nv * 4), spec = new Uint8Array(nv * 4);
  const p = new Float32Array(3), o = new Float32Array(3);
  for (let i = 0; i < nv; i++) {
    p[0] = m.positions[i * 3] * pitch; p[1] = m.positions[i * 3 + 1] * pitch; p[2] = m.positions[i * 3 + 2] * pitch; transformDirGame(rotate, p, o);
    pos[i * 3] = o[0]; pos[i * 3 + 1] = o[1]; pos[i * 3 + 2] = o[2];
    p[0] = m.normals[i * 3]; p[1] = m.normals[i * 3 + 1]; p[2] = m.normals[i * 3 + 2]; transformDirGame(rotate, p, o);
    nrm[i * 3] = o[0]; nrm[i * 3 + 1] = o[1]; nrm[i * 3 + 2] = o[2];
  }
  lightShiny(prep, nv, nrm, col, spec, false);
  return { nv, ni: m.indices.length, pos, col, spec, idx: Uint16Array.from(m.indices) };
}

/** draws the studs of the stud-plate records that are enabled; returns the number of studs */
export function drawLegoStuds(r: Renderer, lib: BrickLibrary, data: StudData, records: readonly GameRecord[]): number {
  const s = stateOf(r), c = s.cpu, eye = r.eye;
  if (!eye) return 0;
  s.stats = { studs: 0, verts: 0, flushes: 0 };
  c.nv = 0; c.ni = 0;
  const prep = prepareLights(r.lights, IDENTITY, eye);
  const tex = r.texture(lib.bricks, 0, '');
  const flush = () => { if (c.nv) { r.drawBatch(s.gpu, c.nv, c.ni, c.pos, c.uv, c.col, c.spec, c.idx, tex, BRICK_PRESET); s.stats.flushes++; } c.nv = 0; c.ni = 0; };
  const byIndex = new Map<number, GameRecord>();
  for (const rec of records) byIndex.set(rec.index, rec);
  const hi2 = STUD_HI * STUD_HI, lo2 = STUD_LO * STUD_LO;
  for (const set of data.sets) {
    const rec = byIndex.get(set.rec);
    if (!rec || rec.name !== set.name || (rec.flags & RF_ENABLED) === 0 || (rec.flags & RF_NO_DRAW) !== 0) continue;
    const m = rec.m;
    // cheap reject of the whole record: its first stud is far beyond the far level
    const cidx = lib.dicts.colours.get(set.colour.toUpperCase());
    if (cidx === undefined) continue;
    const uv = brickPaletteUv(lib.pe, cidx);
    let tHi: Template | null = null, tLo: Template | null = null;
    for (let k = 0; k < set.studs.length && s.stats.studs < MAX_STUDS; k += 3) {
      const x = set.studs[k], y = set.studs[k + 1], z = set.studs[k + 2];
      const wx = x * m[0] + y * m[4] + z * m[8] + m[12], wy = x * m[1] + y * m[5] + z * m[9] + m[13], wz = x * m[2] + y * m[6] + z * m[10] + m[14];
      const d2 = (wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2;
      if (d2 > lo2) continue;
      let t: Template;
      if (d2 <= hi2) t = tHi ??= template(data.hi, m, set.pitch, prep); else t = tLo ??= template(data.lo, m, set.pitch, prep);
      if (BATCH_VERTICES - t.nv <= c.nv || BATCH_INDICES - t.ni <= c.ni) flush();
      const o = c.nv;
      for (let i = 0; i < t.nv; i++) {
        c.pos[(o + i) * 3] = t.pos[i * 3] + wx; c.pos[(o + i) * 3 + 1] = t.pos[i * 3 + 1] + wy; c.pos[(o + i) * 3 + 2] = t.pos[i * 3 + 2] + wz;
        c.uv[(o + i) * 2] = uv[0]; c.uv[(o + i) * 2 + 1] = uv[1];
      }
      c.col.set(t.col, o * 4); c.spec.set(t.spec, o * 4);
      for (let i = 0; i < t.ni; i++) c.idx[c.ni + i] = t.idx[i] + o;
      c.nv += t.nv; c.ni += t.ni; s.stats.studs++; s.stats.verts += t.nv;
    }
  }
  flush();
  (globalThis as { __legoStuds?: unknown }).__legoStuds = s.stats;   // for the headless scenes (tools/lego3d/steps/pilot.mjs)
  return s.stats.studs;
}
