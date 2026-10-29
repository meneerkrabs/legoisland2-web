// The camp gate's doors (GATE record, mesh gate.msh with three sub-object matrices: 0 the frame, 1 and 2 the door leaves hinged at x = +-15.2): the matrices the renderer draws
// the door groups with (GameRenderer.partMatrices) and GateNode rotates (FUN_0043ea60(model, 1 / 2) + FUN_0043a4a1).
import type { Archive } from '../../formats/archive.ts';
import type { ZoneScene } from '../../formats/exe.ts';
import { parseMsh } from '../../formats/msh.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import type { GameRecord } from '../../game/record.ts';
import type { GateNode } from './props.ts';

/** the static sub-object matrices of the record's first mesh (MATL: position, Euler angles, scale per entry), null when it has none */
export function meshParts(scene: ZoneScene, archive: Archive, rec: GameRecord): Float32Array[] | null {
  const part = rec.model?.parts.find(Boolean);
  const path = part ? scene.meshPaths[part.mesh] : null;
  if (!path) return null;
  const e = archive.find(path.split('\\').slice(2).join('/'));
  if (!e) return null;
  try {
    const msh = parseMsh(archive.read(e));
    if (!msh.matl) return null;
    const out: Float32Array[] = [];
    for (let i = 0; i < msh.matl.length / 9; i++) { const f = msh.matl.subarray(i * 9, i * 9 + 9); out.push(buildMatrix(f[3], f[4], f[5], f[0], f[1], f[2], f[6], f[7], f[8])); }
    return out;
  } catch { return null; }
}

/** give the gate node its two live door matrices; returns the map the renderer needs (MATL index -> matrix) */
export function bindGate(node: GateNode, parts: Float32Array[] | null): Map<number, Float32Array> {
  const map = new Map<number, Float32Array>();
  if (parts && parts.length > 2) {
    node.door1 = parts[1].slice(); node.door2 = parts[2].slice();
    map.set(1, node.door1); map.set(2, node.door2);
  }
  return map;
}
