import { createPoseEmu } from '../lib/m7-pose-emu.mjs';
import { parseBlk, sampleBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';

// WP-TIME: the animation pose (src/formats/anim.ts `sampleBlk`, used by AnimInstance.pose and every gameplay reader of a bone) against the original's FUN_0043ba7a (frame selection, translation lerp, slerp
// FUN_0043e59e, quaternion matrix FUN_0043e43d, bone chain FUN_0043b987 / FUN_0043a9e5) run natively in the x86 emulation at the game's 24 bit x87 mode (tools/lib/m7-pose-emu.mjs). Every .blk of the data
// (136 files), several clips each, frames at integers, below 0.1 (exact frame), above (interpolated), at the last frame (the wrap to frame 0), and with the instance flag 2 (no interpolation).
// Tolerance 0: every float of every bone compared bit for bit (a NaN only equals a NaN).
const rng = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return f; };
const fr = Math.fround;
const bits = (() => { const f = new Float32Array(1), u = new Uint32Array(f.buffer); return (v) => { f[0] = v; return u[0]; }; })();

export default {
  name: 'm7-pose-emu',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0, poses = 0, files = 0, interp = 0, snapped = 0, wraps = 0;
    const E = createPoseEmu(ctx);
    const r = rng(7);
    const maxd = { v: 0 };
    for (const { archive, entry, data } of ctx.entries(/\.blk$/i)) {
      let blk;
      try { blk = parseBlk(data); } catch { continue; }
      if (!blk.skeleton || blk.clips.length === 0) continue;
      files++;
      E.reset(); const L = E.load(blk);
      const bones = blk.skeleton.boneCount;
      const usable = blk.clips.map((c, i) => [c, i]).filter(([c]) => c.boneCount === bones);
      const picks = [usable[0], usable[usable.length - 1]];
      for (let k = 0; k < 4 && usable.length > 2; k++) picks.push(usable[1 + Math.floor(r() * (usable.length - 2))]);
      for (const [c, ci] of picks) {
        if (!c) continue;
        const n = c.frameCount;
        const frames = [0, fr(n - 1), fr(n - 1 + 0.5), fr(n - 0.25)];
        for (let k = 0; k < 4; k++) { const base = Math.floor(r() * n); frames.push(fr(base), fr(base + 0.05 + r() * 0.04), fr(base + 0.1), fr(base + r())); }
        for (const f of frames) {
          if (f >= n) continue;       // FUN_0043b76a never leaves a frame at or beyond the count (a one-shot stops at count - 1)
          for (const noInterp of [false, true]) {
            const orig = E.pose(L, ci, f, noInterp);
            const mine = sampleBlk(blk.skeleton, c, f, (c.flags & 0x10) !== 0, undefined, noInterp ? 1e9 : fr(0.1));
            poses++;
            const frac = fr(f - Math.floor(f));
            if (noInterp) snapped++; else if (frac >= fr(0.1)) { interp++; if (Math.floor(f) >= n - 1) wraps++; } else snapped++;
            let bad = -1;
            for (let i = 0; i < bones * 16; i++) { checked++; if (bits(orig[i]) !== bits(mine[i]) && !(Number.isNaN(orig[i]) && Number.isNaN(mine[i]))) { bad = i; break; } }
            if (bad >= 0) { failures.push(`${archive.name}/${entry.path} clip ${ci} frame ${f}${noInterp ? ' (flag 2)' : ''}: bone ${Math.floor(bad / 16)} element ${bad % 16}: original ${orig[bad]}, port ${mine[bad]}`); if (failures.length > 12) return { checked, failures, notes }; }
          }
        }
      }
    }
    // ---- the frame advance (FUN_0043b76a: rate * DAT_008b1718 added to the float32 frame, the loop wrap / the one-shot stop; FUN_0043b874: a one-shot stops AT the count) at dt 1, 0.5 and other steps
    let adv = 0, advWraps = 0, advEnds = 0;
    {
      let nfiles = 0;
      for (const { archive, entry, data } of ctx.entries(/\.blk$/i)) {
        let blk;
        try { blk = parseBlk(data); } catch { continue; }
        if (!blk.skeleton || blk.clips.length < 3 || (nfiles++ % 3)) continue;
        E.reset(); const L = E.load(blk);
        const inst = new AnimInstance(blk);
        for (let ci = 0; ci < blk.clips.length; ci += Math.max(1, Math.floor(blk.clips.length / 6))) {
          const c = blk.clips[ci];
          for (const dt of [1, 0.5, fr(0.5), 2, fr(0.7)]) {
            for (let k = 0; k < 12; k++) {
              const rate = [1, 0.5, fr(r() * 3), 2, 0.125 * 8][k % 5];
              const frame = fr(r() * c.frameCount);
              for (const to of [false, true]) {
                const mode = (k & 1) ? 0x10 : 0;
                const o = E.advance(L, ci, frame, rate, dt, to, mode);
                inst.clip = ci; inst.frame = frame;
                const res = to ? inst.advanceTo(rate, dt, mode) : inst.advance(rate, dt);
                adv++;
                if (res === 1) advWraps++; if (res === 2) advEnds++;
                checked += 2;
                if (res !== o.result || bits(inst.frame) !== bits(o.frame)) { failures.push(`${archive.name}/${entry.path} clip ${ci} frame ${frame} rate ${rate} dt ${dt}${to ? ' advanceTo mode ' + mode : ''}: original result ${o.result} frame ${o.frame}, port ${res} ${inst.frame}`); if (failures.length > 12) return { checked, failures, notes }; }
              }
            }
          }
        }
      }
    }
    notes.push(`advance / advanceTo: ${adv} steps (dt 1, 0.5, 0.7, 2; ${advWraps} loops, ${advEnds} ends) equal to FUN_0043b76a / FUN_0043b874 in result and frame bits`);
    notes.push(`${files} rigs, ${poses} poses (${interp} interpolated, ${wraps} of them between the last frame and frame 0, ${snapped} exact frames), tolerance 0 (bit for bit) on ${checked} floats`);
    return { checked, failures, notes };
  },
};
