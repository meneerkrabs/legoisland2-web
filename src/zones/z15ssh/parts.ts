// z15SSH: the sub-object matrices of a record's mesh (FUN_0043ea60(rec + 4, i): matrix i of the render instance = the mesh's MATL entry i; FUN_0043ea40 counts
// them) and the small matrix helpers of the zone code. The PEPP mesh (the buggy) has 8: 0..3 the wheels, 4 the turret, 5 / 6 the two seats, 7 identity; the
// CRTn meshes (the Brickbots' carts) have 6, part 5 = the seat. Same idea as the island's src/island/trigger/parts.ts (which needs the island context), kept
// per zone so the zone does not depend on it. The renderer reads the live matrices through `GameRenderer.partMatrices`.
import { parseMsh } from '../../formats/msh.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import type { Archive } from '../../formats/archive.ts';
import type { GameRecord } from '../../game/record.ts';
import type { ZoneScene } from '../../formats/exe.ts';
import { eulerMatrix, rotateVector, matThen } from '../common/matrix.ts';

export class PartStore {
  private readonly base = new Map<GameRecord, Float32Array[] | null>();
  readonly live = new Map<GameRecord, Map<number, Float32Array>>();
  private readonly archive: Archive;
  private readonly scene: ZoneScene;
  constructor(archive: Archive, scene: ZoneScene) { this.archive = archive; this.scene = scene; }

  /** the MATL matrices of the record's first mesh (LOD 0) */
  baseOf(rec: GameRecord): Float32Array[] | null {
    if (this.base.has(rec)) return this.base.get(rec)!;
    let out: Float32Array[] | null = null;
    const part = rec.model?.parts.find(Boolean);
    const path = part ? this.scene.meshPaths[part.mesh] : null;
    if (path) {
      const e = this.archive.find(path.split('\\').slice(2).join('/'));
      if (e) {
        try {
          const msh = parseMsh(this.archive.read(e));
          if (msh.matl) {
            out = [];
            for (let i = 0; i < msh.matl.length / 9; i++) { const f = msh.matl.subarray(i * 9, i * 9 + 9); out.push(buildMatrix(f[3], f[4], f[5], f[0], f[1], f[2], f[6], f[7], f[8])); }
          }
        } catch { out = null; }
      }
    }
    this.base.set(rec, out);
    return out;
  }
  count(rec: GameRecord): number { return this.baseOf(rec)?.length ?? 0; }
  /** FUN_0043ea60(rec + 4, i): the live matrix i (created from the MATL entry), null when out of range */
  get(rec: GameRecord, i: number): Float32Array | null {
    const base = this.baseOf(rec);
    if (!base || i < 0 || i >= base.length) return null;
    let m = this.live.get(rec);
    if (!m) { m = new Map(); this.live.set(rec, m); }
    let a = m.get(i);
    if (!a) { a = base[i].slice(); m.set(i, a); }
    return a;
  }
  /** the renderer's hook: the matrices a node changed (record -> MATL index -> matrix) */
  overrides = (rec: GameRecord): ReadonlyMap<number, Float32Array> | undefined => this.live.get(rec);
}

/** FUN_0043a9e5(out, a, b): out = b * a (row vectors: b first) */
export const then = (b: Float32Array, a: Float32Array, out = new Float32Array(16)): Float32Array => matThen(b, a, out);

/** FUN_0043abe6(out, M, v): the vector rotated by the matrix's 3 x 3 part (v * M, no translation); each component is summed z, y, x (+ 0.0) in double and stored as float32 */
export function rotate(m: ArrayLike<number>, v: ArrayLike<number>, out: [number, number, number] = [0, 0, 0]): [number, number, number] { return rotateVector(m, v, out) as [number, number, number]; }

/** FUN_0043a340(m, rx, ry, rz): the rotation matrix of the three Euler angles (translation 0) */
export const rotation = (rx: number, ry: number, rz: number): Float32Array => eulerMatrix(rx, ry, rz, 0, 0, 0);

/** FUN_0043a5e4(m, rx, ry, rz, x, y, z) */
export function setEulerPos(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number) { eulerMatrix(rx, ry, rz, x, y, z, m as Float32Array<ArrayBuffer>); }
