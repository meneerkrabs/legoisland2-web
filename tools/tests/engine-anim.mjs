import { AnimInstance, POSE_SNAP } from '../../src/game/anim.ts';
import { parseBlk, sampleBlk } from '../../src/formats/anim.ts';

// Animation player (src/game/anim.ts = SDAnim.c FUN_0043b6a3 start / FUN_0043b76a advance / FUN_0043ba7a pose) on the real MFIG.blk rigs.
export default {
  name: 'engine-anim',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
    for (const zone of ['z02LGI', 'z03PPH']) {
      const arch = ctx.archives.find((a) => a.name === zone);
      const blk = parseBlk(arch.read('anim/MFIG.blk'));
      const inst = new AnimInstance(blk);
      const loops = blk.clips.filter((c) => c.flags & 0x10).length;
      notes.push(`${zone} MFIG.blk: ${blk.clips.length} clips (${loops} loop clips)`);
      // start(): valid / invalid clip numbers, the start frame range
      ok(inst.start(58, 0) && inst.clip === 58 && inst.frame === 0, 'start(58)');
      ok(!inst.start(blk.clips.length, 0) && inst.clip === 58, 'start(out of range) must fail and keep the clip');
      ok(!inst.start(-1, 0), 'start(-1) must fail');
      ok(inst.start(36, 5) && inst.frame === 5, 'start with a start frame');
      ok(!inst.start(36, 9999) && inst.clip === 36, 'start frame beyond the clip: clip is set but the frame is not');
      // a one-shot clip (flags without 0x10): advance 1/tick, stops by wrapping at frames-1 and reports 2
      const oneShot = blk.clips.find((c, i) => i > 0 && !(c.flags & 0x10) && c.frameCount > 5);
      inst.start(oneShot.index, 0);
      let res = 0, ticks = 0;
      while (res !== 2 && ticks < 1000) { res = inst.advance(1.0, 1); ticks++; }
      // the frame passes frames-1 on tick `frames`: the clip reports 2 and the frame wraps by frames-1
      ok(res === 2 && ticks === oneShot.frameCount, `one-shot clip ${oneShot.index} (${oneShot.frameCount} frames) ended after ${ticks} ticks`);
      ok(inst.frame < 1.0 + 1e-9, `after the end the frame wraps (${inst.frame})`);
      // a looping clip wraps at frameCount and reports 1
      const loop = blk.clips.find((c, i) => i > 0 && (c.flags & 0x10) && c.frameCount > 5);
      if (loop) {
        inst.start(loop.index, 0);
        let r = 0, n = 0;
        while (r !== 1 && n < 1000) { r = inst.advance(1.0, 1); n++; }
        ok(r === 1 && n === loop.frameCount && near(inst.frame, 0), `loop clip ${loop.index}: wrapped after ${n} ticks (frames ${loop.frameCount}), frame ${inst.frame}`);
      }
      // rates: 1.25 per tick for runs, 0.666 for the idle
      inst.start(36, 0); inst.advance(1.25, 1); ok(near(inst.frame, 1.25), 'rate 1.25');
      inst.start(58, 0); inst.advance(0.666, 1); ok(near(inst.frame, 0.666), 'rate 0.666');
      inst.start(58, 0); inst.advance(1.0, 0.5); ok(near(inst.frame, 0.5), 'advance scales with dt');
      // seek
      ok(inst.seek(3) && inst.frame === 3 && !inst.seek(-1) && !inst.seek(1e6), 'seek range');
      // pose = sampleBlk with the 0.1 snap: exact frames give the stored rotation, fractions < 0.1 snap to the frame, >= 0.1 interpolate
      const clip = blk.clips[36];
      for (const f of [0, 3, 7.05, 7.5, 12.099, 12.5, 19.3]) {
        inst.start(36, 0); inst.seek(f);
        const p = Array.from(inst.pose());
        const q = Array.from(sampleBlk(blk.skeleton, clip, f, (clip.flags & 0x10) !== 0, undefined, POSE_SNAP));
        ok(p.length === q.length && p.every((v, i) => near(v, q[i])), `pose(frame ${f}) differs from sampleBlk`);
      }
      // frame 7.05 (< 0.1) equals frame 7 exactly; frame 7.5 differs from frame 7
      inst.start(36, 0); inst.seek(7); const a = Array.from(inst.pose()); inst.seek(7.05); const b = Array.from(inst.pose()); inst.seek(7.5); const c = Array.from(inst.pose());
      ok(a.every((v, i) => near(v, b[i], 1e-9)), 'fraction 0.05 snaps to the exact frame');
      ok(a.some((v, i) => !near(v, c[i], 1e-4)), 'fraction 0.5 interpolates');
      // render interpolation: alpha between the previous tick and now
      inst.start(13, 0); inst.beginTick(); inst.advance(1, 1);
      const half = Array.from(inst.pose(0.5)), exact = Array.from(sampleBlk(blk.skeleton, blk.clips[13], 0.5, true, undefined, POSE_SNAP));
      ok(half.every((v, i) => near(v, exact[i])), 'pose(alpha 0.5) is the pose at frame 0.5');
      // bone count of the walk clips equals the skeleton's
      for (const i of [8, 13, 36, 58, 1, 87]) ok(blk.clips[i] && blk.clips[i].boneCount === blk.skeleton.boneCount, `clip ${i} bone count`);
    }
    return { checked, failures, notes };
  },
};
