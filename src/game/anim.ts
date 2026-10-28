// Animation instances (SDAnim.c, docs/re/architecture.md 4.7, formats.md 8.2): one per animated record, bound to a rig (.blk).
//   start()   = FUN_0043b6a3 (clip, start frame)    advance() = FUN_0043b76a (returns 1 on a loop wrap, 2 when a one-shot ends)
//   clip / frame = FUN_0043b72b / FUN_0043b73f      seek() = FUN_0043b64d
// There is no cross-fade: starting a clip jumps to its first frame. The pose is evaluated like FUN_0043ba7a: between two frames the
// bones are slerped only when the fractional frame is >= 0.1 (constant 0x8920cc), otherwise the exact frame is shown.
import { sampleBlk } from '../formats/anim.ts';
import type { Blk, BlkClip } from '../formats/anim.ts';

/** clip flag 0x10: loops */
export const CLIP_LOOP = 0x10;
/** interpolation snap (0x8920cc = 0.1f) */
export const POSE_SNAP = 0.1;

export class AnimInstance {
  readonly rig: Blk;
  /** current clip number (+0x0c) = chunk index of the .blk, clip 0 is the skeleton pose */
  clip = 0;
  /** current frame (+0x10) */
  frame = 0;
  /** instance flag 2: no interpolation between frames */
  noInterp = false;
  /** frame at the previous simulation tick (render interpolation), and the clip it belonged to */
  prevFrame = 0; prevClip = 0;
  private bones: Float32Array;

  constructor(rig: Blk) {
    this.rig = rig;
    this.bones = new Float32Array((rig.skeleton?.boneCount ?? 0) * 16);
  }

  get clips(): BlkClip[] { return this.rig.clips; }
  get clipData(): BlkClip | null { return this.rig.clips[this.clip] ?? null; }
  get frameCount(): number { return this.clipData?.frameCount ?? 0; }

  /** FUN_0043b6a3: false when the clip number is out of range (the clip index is left unchanged then) */
  start(clip: number, startFrame = 0): boolean {
    if (clip < 0 || clip >= this.rig.clips.length) return false;
    this.clip = clip;
    const c = this.rig.clips[clip];
    if (c && startFrame >= 0 && startFrame <= c.frameCount) { this.frame = startFrame; return true; }
    return false;
  }

  /** FUN_0043b64d */
  seek(frame: number): boolean {
    const c = this.clipData;
    if (!c || frame < 0 || frame > c.frameCount) return false;
    this.frame = frame;
    return true;
  }

  /** FUN_0043b76a: advance by rate * dt (dt = 1.0 at the fixed 30 Hz step). 0 = running, 1 = looped, 2 = one-shot finished */
  advance(rate: number, dt = 1): number {
    const c = this.clipData;
    if (!c) return 0;
    this.prevFrame = this.frame; this.prevClip = this.clip;
    this.frame += rate * dt;
    let n = c.frameCount;
    if (n < 1) n = 1;
    let res = 0;
    if ((c.flags & CLIP_LOOP) === 0) {
      if (n - 1 < this.frame) {
        if (n <= 1) this.frame = 0;
        else while (n - 1 < this.frame) this.frame -= n - 1;
        res = 2;
      }
    } else if (n <= this.frame) {
      while (n <= this.frame) this.frame -= n;
      res = 1;
    }
    return res;
  }

  /** remember the state at the start of a tick (call before the simulation changes it) */
  beginTick() { this.prevFrame = this.frame; this.prevClip = this.clip; }

  /** bone matrices (column-major, WebGL ready, see sampleBlk) of the current pose; `alpha` interpolates between the previous tick and now */
  pose(alpha = 1): Float32Array | null {
    const sk = this.rig.skeleton;
    const c = this.clipData;
    if (!sk || !c || c.boneCount !== sk.boneCount) return null;
    let f = this.frame;
    if (alpha < 1 && this.prevClip === this.clip && c.frameCount > 1) {
      // between ticks: move along the clip by the same fraction (handles the wrap of looping clips)
      let d = this.frame - this.prevFrame;
      if (d < 0) d += (c.flags & CLIP_LOOP) ? c.frameCount : c.frameCount - 1;
      f = this.prevFrame + d * alpha;
    }
    return sampleBlk(sk, c, f, (c.flags & CLIP_LOOP) !== 0, this.bones, this.noInterp ? 1e9 : POSE_SNAP);
  }
}
