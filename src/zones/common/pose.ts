// The bone of a posed record in world space as the original's FUN_0043bc58(model, bone) + FUN_0043a9e5(dst, record + 0xc, bone) read it: FUN_0043bc58 returns the matrix in the
// animation's buffer that the LAST DRAW evaluated, i.e. the (clip, frame) the animation had at the end of the previous tick; nothing in an update pass re-poses it.
import { sampleBlk } from '../../formats/anim.ts';
import { CLIP_LOOP, POSE_SNAP } from '../../game/anim.ts';
import type { AnimInstance } from '../../game/anim.ts';
import type { GameRecord } from '../../game/record.ts';

const f32 = Math.fround;

/** FUN_0043a9e5(dst, a, b): every x87 step rounded to float32 in the machine code's order (also in src/zones/z07CSI/common.ts `composeBone32`) */
export function composeBone32(dst: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, bo = 0): Float32Array {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      let v = f32(f32(f32(b[bo + r * 4] * a[c]) + f32(b[bo + r * 4 + 1] * a[4 + c])) + f32(b[bo + r * 4 + 2] * a[8 + c]));
      if (r === 3) v = f32(v + a[12 + c]);
      dst[r * 4 + c] = v;
    }
    dst[r * 4 + 3] = r === 3 ? 1 : 0;
  }
  return dst;
}

/** the bone matrices of `anim` posed at (clip, frame) with the identity root (model space): what the draw of that state leaves in the animation's buffer */
export function poseAt(anim: AnimInstance, clip: number, frame: number): Float32Array | null {
  const sk = anim.rig.skeleton, c = anim.rig.clips[clip];
  if (!sk || !c || c.boneCount !== sk.boneCount) return null;
  return sampleBlk(sk, c, frame, (c.flags & CLIP_LOOP) !== 0, undefined, anim.noInterp ? 1e9 : POSE_SNAP);
}

/** `dst` = the world matrix of `bone` of `rec` for the pose (clip, frame) the last draw left; without a pose the record's own matrix (the island's `boneWorld` convention) */
export function boneOfPose(dst: Float32Array, rec: GameRecord, clip: number, frame: number, bone: number): Float32Array {
  const a = rec.anim as AnimInstance | undefined;
  const p = a ? poseAt(a, clip, frame) : null;
  if (!p || p.length < bone * 16 + 16) { dst.set(rec.m); return dst; }
  return composeBone32(dst, rec.m, p, bone * 16);
}
