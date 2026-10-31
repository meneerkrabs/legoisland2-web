// WP-TIME: the animation evaluation of the original (FUN_0043ba7a -> FUN_0043e815 / FUN_0043e59e slerp, FUN_0043e43d quaternion -> matrix, FUN_0043b987 bone matrices with FUN_0043a9e5) runs natively in the x86
// emulation (x87 at 24 bit) on rigs laid out in emulated memory exactly like the loader FUN_0043b1ff leaves them (rig = { chunk count, chunk pointers }, chunk = { flags, bones, frames, frames x (3 + 4 bones) floats
// [, bones x { offset xyz, parent }] }), with the instance FUN_0043b4e2 creates (the original function itself builds it). Only the allocator is hosted.
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

const HEAP = 0x20000000, HEAP_SIZE = 0x4000000;

export function createPoseEmu(ctx) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createGameCpu(pe);
  const mem = cpu.mem;
  mem.addRegion({ lo: HEAP, hi: HEAP + HEAP_SIZE, name: 'heap' });
  let heap = HEAP;
  const mark = () => heap;
  const alloc = (size) => { const p = heap; heap = (heap + Math.max(4, size) + 15) & ~15; if (heap > HEAP + HEAP_SIZE) throw new Error('pose emu: heap exhausted'); return p; };
  cpu.hooks.set(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
  cpu.hooks.set(0x433d60, () => {});
  // the native code: the matrix helpers, the animation module, the CRT (floor / ftol / sin / acos)
  cpu.exec = [[0x43a000, 0x43b100], [0x43b100, 0x43ec00], [0x858d30, 0x873e00], [0x890290, 0x890400]];
  cpu.fallback = (a) => (c) => { throw new Error(`pose emu: unhooked call to 0x${a.toString(16)} from 0x${c.retAddr.toString(16)}`); };
  cpu.invalidate();
  const ident = alloc(64);
  for (let i = 0; i < 16; i++) mem.wf32(ident + 4 * i, i % 5 === 0 ? 1 : 0);
  const base = mark();
  const E = { cpu, mem, alloc, ident, reset: () => { heap = base; } };
  /** lay a parsed Blk out like the loader and create the instance with the original FUN_0043b4e2(rig, 1); returns { inst, rig } */
  E.load = (blk) => {
    const rig = alloc(4 + 4 * blk.clips.length);
    mem.w32(rig, blk.clips.length);
    blk.clips.forEach((c, i) => {
      const stride = 3 + 4 * c.boneCount;
      const hasTable = c.kind === 'ASKL';
      const size = 12 + c.frameCount * stride * 4 + (hasTable ? c.boneCount * 16 : 0);
      const p = alloc(size + 64);
      mem.w32(p, c.flags); mem.w32(p + 4, c.boneCount); mem.w32(p + 8, c.frameCount);
      for (let k = 0; k < c.frameCount * stride; k++) mem.wf32(p + 12 + 4 * k, c.data[k]);
      if (hasTable) {
        const t = p + 12 + c.frameCount * stride * 4;
        for (let k = 0; k < c.boneCount; k++) {
          mem.wf32(t + 16 * k, blk.skeleton.offsets[3 * k]); mem.wf32(t + 16 * k + 4, blk.skeleton.offsets[3 * k + 1]); mem.wf32(t + 16 * k + 8, blk.skeleton.offsets[3 * k + 2]);
          mem.w32(t + 16 * k + 12, blk.skeleton.parents[k]);
        }
      }
      mem.w32(rig + 4 + 4 * i, p);
    });
    cpu.steps = 0;
    const inst = cpu.call(0x43b4e2, [rig, 1], { maxSteps: 1e6 });
    if (!inst) throw new Error('pose emu: FUN_0043b4e2 failed');
    return { rig, inst, blk };
  };
  /** FUN_0043ba7a(inst, identity) at (clip, frame, flags): the bone matrices (16 floats per bone) of the instance's pose buffer */
  E.pose = (L, clip, frame, noInterp) => {
    const { inst, rig, blk } = L;
    mem.w32(inst + 8, mem.u32(rig + 4 + 4 * clip)); mem.w32(inst + 0xc, clip);
    mem.wf32(inst + 0x10, frame);
    mem.w32(inst + 4, noInterp ? 3 : 1);
    cpu.steps = 0; cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0;
    cpu.call(0x43ba7a, [inst, ident], { maxSteps: 5e6 });
    const buf = mem.u32(inst + 0x20), n = blk.skeleton.boneCount;
    const out = new Float32Array(n * 16);
    for (let i = 0; i < n * 16; i++) out[i] = mem.f32(buf + 4 * i);
    return out;
  };
  /** FUN_0043b76a (advance, `to` false) / FUN_0043b874 (advance to the count, `to` true) on the instance at (clip, frame) with DAT_008b1718 = dt: { result, frame } */
  const fbits = (() => { const f = new Float32Array(1), u = new Uint32Array(f.buffer); return (v) => { f[0] = v; return u[0]; }; })();
  E.advance = (L, clip, frame, rate, dt, to = false, mode = 0) => {
    const { inst, rig } = L;
    mem.w32(inst + 8, mem.u32(rig + 4 + 4 * clip)); mem.w32(inst + 0xc, clip);
    mem.wf32(inst + 0x10, frame);
    mem.wf32(0x8b1718, dt); mem.wf32(0x8b171c, 1 / dt);
    cpu.steps = 0; cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0;
    const res = cpu.call(to ? 0x43b874 : 0x43b76a, to ? [inst, fbits(rate), mode] : [inst, fbits(rate)], { maxSteps: 1e6 }) | 0;
    return { result: res, frame: mem.f32(inst + 0x10) };
  };
  return E;
}
