// WP-TIME item 2: the flowing-water hook (constructor 0x426f55, draw hook FUN_00426e9a -> FUN_0043ebe0 -> FUN_0088350d mode 0) runs NATIVELY in the x86 interpreter on a fabricated vertex buffer
// (both vertex formats, 0x242 / 0x2c2) next to the port's `scrollUvs` (src/render/uvscroll.ts, what GameRenderer applies to the CPU UVs of the mesh each pass): the vertices must match bit for bit
// after every pass (float32 add per vertex, u then v, no dt factor, no wrapping), and the hook must hand the transform + the draw call to the engine with the record's matrix and the mesh's mode.
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { scrollUvs } from '../../src/render/uvscroll.ts';
import { loadExe } from '../lib/engine-load.mjs';

const BASE = 0x30000000;
const bits = (f) => { const a = new Float32Array([f]); return new Uint32Array(a.buffer)[0]; };
const fl = (u) => { const a = new Uint32Array([u >>> 0]); return new Float32Array(a.buffer)[0]; };

export default {
  name: 'wp-time-water-uv',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    for (const [fvf, stride, uOff, vOff] of [[0x242, 0x20, 0x10, 0x14], [0x2c2, 0x24, 0x14, 0x18]]) {
      const cpu = createGameCpu(pe), mem = cpu.mem;
      mem.addRegion({ lo: BASE, hi: BASE + 0x100000, name: 'heap' });
      const N = 200;
      // object graph the hook walks: record R (+4 model M, +0xc matrix), M +0x10 = entries A (0x14 each: +8 mesh object W, +0xc draw mode), W = the vertex buffer wrapper:
      // +0 .. unused, +4 vertex buffer interface (non-zero), +0xc = info P (+0 vertex count, +4 D3D buffer, +8 format, +0xc lock pointer), +0x70 = 0
      const R = BASE, M = BASE + 0x100, A = BASE + 0x200, W = BASE + 0x300, P = BASE + 0x400, VB = BASE + 0x500, VT = BASE + 0x600, NODE = BASE + 0x700, DATA = BASE + 0x1000;
      mem.w32(R + 4, M); mem.w32(M + 0x10, A); mem.w32(A + 8, W); mem.w32(A + 0xc, 3);
      mem.w32(W + 4, VB); mem.w32(W + 0xc, P); mem.w32(W + 0x70, 0);
      mem.w32(P, N); mem.w32(P + 4, VB); mem.w32(P + 8, fvf);
      mem.w32(VB, VT); const LOCK = BASE + 0x800, UNLOCK = BASE + 0x810;   // (hook addresses must be mapped: the decoder reads them)
      mem.w32(VT + 0xc, LOCK); mem.w32(VT + 0x10, UNLOCK);
      let locks = 0, unlocks = 0, draws = [], mats = [];
      cpu.hooks.set(LOCK, (c) => { locks++; mem.w32(c.arg(2), DATA); return 16; });   // Lock(this, flags, &ptr, &size)
      cpu.hooks.set(UNLOCK, () => { unlocks++; return 4; });
      cpu.hooks.set(0x416885, (c) => { mats.push(c.arg(0)); });                          // FUN_00416885: SetTransform
      cpu.hooks.set(0x88aca2, (c) => { draws.push([c.ecx, c.arg(0), c.arg(1)]); return 8; });   // FUN_0088aca2: the draw (this, mode, 0)
      mem.w32(R + 0xc, 0x12345678);   // (the matrix pointer is passed as R + 0xc: its address, not its content)

      // vertex data: positions, normals, colour and UVs of several magnitudes; the port's CPU copy of the UVs
      let seed = 12345;
      const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
      const uvs = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const a = DATA + i * stride;
        for (let k = 0; k < 4; k++) mem.wf32(a + 4 * k, rnd() * 100 - 50);
        const mag = [1, 8, 300, 4000][i & 3];
        uvs[i * 2] = Math.fround((rnd() - 0.25) * mag); uvs[i * 2 + 1] = Math.fround((rnd() - 0.25) * mag);
        mem.wf32(a + uOff, uvs[i * 2]); mem.wf32(a + vOff, uvs[i * 2 + 1]);
      }
      // the node: du at +0x18, dv at +0x14 (the constructor stores param_2[1] / param_2[0]); LAVA {0.0025, 0}, FALL {0.01, 0} and a diagonal one
      for (const [dv, du] of [[Math.fround(0.0025), 0], [Math.fround(0.01), 0], [Math.fround(0.0137), Math.fround(-0.0071)]]) {
        mem.wf32(NODE + 0x14, dv); mem.wf32(NODE + 0x18, du);
        for (let pass = 0; pass < 300; pass++) {
          mats.length = 0; draws.length = 0;
          const l0 = locks, u0 = unlocks;
          cpu.call(0x426e9a, [R, NODE]);
          scrollUvs(uvs, du, dv);
          ok(locks === l0 + 1 && unlocks === u0 + 1, `fvf ${fvf.toString(16)}: one lock / unlock per hook call`);
          ok(mats.length === 1 && mats[0] === R + 0xc && draws.length === 1 && draws[0][0] === W && draws[0][1] === 3 && draws[0][2] === 0, `fvf ${fvf.toString(16)}: the hook draws mesh W with mode 3 at the record's matrix`);
          if (pass % 50 === 0 || pass === 299) {
            let bad = 0;
            for (let i = 0; i < N; i++) {
              const a = DATA + i * stride;
              if (mem.u32(a + uOff) !== bits(uvs[i * 2]) || mem.u32(a + vOff) !== bits(uvs[i * 2 + 1])) bad++;
              if (mem.u32(a + uOff - 4) === undefined) bad++;
            }
            ok(bad === 0, `fvf ${fvf.toString(16)} du ${du} dv ${dv} pass ${pass}: ${bad} vertices differ from the port's scrollUvs`);
          }
        }
        // after all passes: every vertex bit for bit, and the non-UV fields untouched
        let bad = 0;
        for (let i = 0; i < N; i++) { const a = DATA + i * stride; if (mem.u32(a + uOff) !== bits(uvs[i * 2]) || mem.u32(a + vOff) !== bits(uvs[i * 2 + 1])) bad++; }
        ok(bad === 0, `fvf ${fvf.toString(16)} final ${bad} vertices differ`);
      }
      // the coordinates are not wrapped (the old port wrapped its GPU offset at 1024)
      ok(Math.max(...uvs) > 2048, 'no wrapping');
      notes.push(`fvf 0x${fvf.toString(16)}: ${900} hook calls, ${N} vertices, bit-exact`);
      // the grid is float32 after all: rounding of tiny steps on big coordinates is part of the result
      const big = new Float32Array([100000, 100000]); scrollUvs(big, 0.0025, 0.0025);
      ok(big[0] === 100000 && fl(bits(big[0])) === big[0], 'a step below the float32 resolution of a large coordinate is lost, like the original');
    }
    return { checked, failures, notes };
  },
};
