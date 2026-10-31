// Animation instances (SDAnim.c, docs/re/architecture.md 4.7, formats.md 8.2): one per animated record, bound to a rig (.blk).
//   start()   = FUN_0043b6a3 (clip, start frame)    advance() = FUN_0043b76a (returns 1 on a loop wrap, 2 when a one-shot ends)
//   clip / frame = FUN_0043b72b / FUN_0043b73f      seek() = FUN_0043b64d
// There is no cross-fade: starting a clip jumps to its first frame. The pose is evaluated like FUN_0043ba7a: between two frames the
// bones are slerped only when the fractional frame is >= 0.1 (constant 0x8920cc), otherwise the exact frame is shown. `advance` / `advanceTo` and the pose (formats/anim.ts `sampleBlk`) are
// bit-exact against the emulated original at dt 1 and 0.5 (tools/tests/m7-pose-emu.mjs). Every `advance` adds `rate * DAT_008b1718` (FUN_0043b76a multiplies by the global itself): pass `w.dt`.
import { sampleBlk } from '../formats/anim.ts';
import type { Blk, BlkClip } from '../formats/anim.ts';

const fr = Math.fround;
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
  /** (clip, frame) at the start of this simulation step / before the last advance: what the last draw posed (readers of the draw's bone buffer, FUN_0043bc58: z28HAT `poseOfLastDraw`); the render no longer interpolates */
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

  /**
   * FUN_0043b76a: advance by rate * dt (dt = 1.0 at the fixed 30 Hz step). 0 = running, 1 = looped, 2 = one-shot finished. The frame is a float32 in the original:
   * frame = float32(float32(rate * dt) + frame) (every x87 operation rounds to a float32), every wrap step is a float32 store (rate and dt are float32 arguments / globals).
   */
  advance(rate: number, dt = 1): number {
    const c = this.clipData;
    if (!c) return 0;
    this.prevFrame = this.frame; this.prevClip = this.clip;
    this.frame = fr(fr(fr(rate) * fr(dt)) + this.frame);
    let n = c.frameCount;
    if (n < 1) n = 1;
    let res = 0;
    if ((c.flags & CLIP_LOOP) === 0) {
      if (n - 1 < this.frame) {
        if (n <= 1) this.frame = 0;
        else while (n - 1 < this.frame) this.frame = fr(this.frame - (n - 1));
        res = 2;
      }
    } else if (n <= this.frame) {
      while (n <= this.frame) this.frame = fr(this.frame - n);
      res = 1;
    }
    return res;
  }

  /**
   * FUN_0043b874(anim, rate, mode): advance by rate * dt like `advance`, but a one-shot (mode & 0x10 == 0) stops AT the clip's frame count (not the last frame) and returns 2 there, a looping one
   * (mode & 0x10) wraps by the frame count and returns 1. 0 = running (and for an instance without clip data).
   */
  advanceTo(rate: number, dt = 1, mode = 0): number {
    const c = this.clipData;
    if (!c) return 0;
    this.prevFrame = this.frame; this.prevClip = this.clip;
    this.frame = fr(fr(fr(rate) * fr(dt)) + this.frame);
    const n = fr(c.frameCount);
    if ((mode & CLIP_LOOP) === 0) {
      if (n < this.frame) { this.frame = n; return 2; }
    } else if (n <= this.frame) {
      do this.frame = fr(this.frame - n); while (n <= this.frame);
      return 1;
    }
    return 0;
  }

  /** remember the state at the start of a tick (call before the simulation changes it) */
  beginTick() { this.prevFrame = this.frame; this.prevClip = this.clip; }

  /**
   * bone matrices of the current pose (the game's row-major matrices, which read as column-major WebGL matrices are their transpose: `sampleBlk`). The original draws the pose of the
   * current (clip, frame) and does not interpolate between steps; `_alpha` is only kept for the callers that still pass the loop's factor (always 1).
   */
  pose(_alpha = 1): Float32Array | null {
    const sk = this.rig.skeleton;
    const c = this.clipData;
    if (!sk || !c || c.boneCount !== sk.boneCount) return null;
    return sampleBlk(sk, c, this.frame, (c.flags & CLIP_LOOP) !== 0, this.bones, this.noInterp ? 1e9 : POSE_SNAP);
  }
}
