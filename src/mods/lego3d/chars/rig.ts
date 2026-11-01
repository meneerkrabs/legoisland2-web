// The MFIG skeleton's reference pose (the bind pose all LEGO 3D geometry is fitted in) as 17 row-major 4x4 matrices from the pack, and conversions world <-> bone space.
import { inv3, rowMul, type V3 } from './geo.ts';

export class Rig {
  readonly bones: Float32Array;
  private inv = new Map<number, number[]>();
  constructor(bind: ArrayLike<number>) { this.bones = Float32Array.from(bind); }
  get count() { return this.bones.length / 16; }
  private rot(b: number): number[] {
    let r = this.inv.get(b);
    if (!r) { const M = this.bones.subarray(b * 16, b * 16 + 16); r = inv3([M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]); this.inv.set(b, r); }
    return r;
  }
  /** world point -> the local space of bone b (so that bones[b] applied to it gives the point back) */
  local(b: number, p: V3): V3 { const M = this.bones; return rowMul([p[0] - M[b * 16 + 12], p[1] - M[b * 16 + 13], p[2] - M[b * 16 + 14]], this.rot(b)); }
  /**
   * The local normal that the game's skinning turns into `n` in the reference pose: the game rotates the ONE stored normal of a vertex by every influence's bone and sums them weighted
   * (skinNormals), so with bones of different rest rotations the blend of a normal stored relative to the primary bone alone points elsewhere. M = sum w_k R_k (the bones' 3x3 parts); the stored
   * normal is n M^-1, normalised (the direction is what counts: the port renormalises). Falls back to the primary bone's frame.
   */
  normal(bones: ArrayLike<number>, w: ArrayLike<number>, n: V3): V3 {
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < bones.length; k++) { const B = this.bones, o = bones[k] * 16; M[0] += w[k] * B[o]; M[1] += w[k] * B[o + 1]; M[2] += w[k] * B[o + 2]; M[3] += w[k] * B[o + 4]; M[4] += w[k] * B[o + 5]; M[5] += w[k] * B[o + 6]; M[6] += w[k] * B[o + 8]; M[7] += w[k] * B[o + 9]; M[8] += w[k] * B[o + 10]; }
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    if (Math.abs(det) < 1e-3) return this.dir(bones[0], n);
    const r = rowMul(n, inv3(M)), l = Math.hypot(r[0], r[1], r[2]) || 1;
    return [r[0] / l, r[1] / l, r[2] / l];
  }
  /** world direction -> bone space */
  dir(b: number, d: V3): V3 { return rowMul(d, this.rot(b)); }
}
