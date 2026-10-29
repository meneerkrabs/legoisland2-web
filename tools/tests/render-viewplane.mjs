// The view plane (src/render/viewplane.ts) against the ORIGINAL FUN_0087f01e run on the x86 emulator with a fake Direct3D device (WP-RENDER R6): the vertices, colours and indices
// of the coloured polygon the original hands to DrawIndexedPrimitive, for random cameras above and below the plane; plus the dead-code claims about the textured pass.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { viewPlaneMesh, viewPlaneTexturedMesh, VIEWPLANE_TEX_PRESET } from '../../src/render/viewplane.ts';
import { decode } from '../../src/formats/x86.ts';
import { lookDirLH } from '../../src/render/math.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const HEAP = 0x20000000, DEV = HEAP + 0x100, VT = HEAP + 0x200, FAKE = 0x40000000;

export default {
  name: 'render-viewplane',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    // --- the claims about the textured pass: DAT_05d5faac is written only by FUN_0087f854, which nothing references
    {
      const starts = pe.functionStarts();
      let callers = 0;
      for (let fi = 0; fi < starts.length; fi++) {
        const e = fi + 1 < starts.length ? starts[fi + 1] : starts[fi] + 0x1000;
        for (let at = starts[fi]; at < e;) {
          const ins = decode(pe.slice(at, 16) ?? new Uint8Array(16), 0, at);
          if (!ins || ins.len <= 0) break;
          if ((ins.op === 0xe8 || ins.op === 0xe9) && (ins.rel === 0x87f854 || ins.rel === 0x444510 || (ins.rel === 0x87f8ca && at !== 0x44451a))) callers++;   // (FUN_00444510 -> FUN_0087f8ca is the wrapper itself)
          at += ins.len;
        }
      }
      ok(callers === 0, `FUN_0087f854 / FUN_0087f8ca / FUN_00444510 are called ${callers} times (the textured pass is dead code)`);
      // no pointer to them in the image either
      let ptrs = 0;
      for (const s of pe.sections) {
        if (s.name === '.text') continue;
        const d = pe.slice(s.va, Math.min(s.rsize, s.vsize));
        if (!d) continue;
        for (let i = 0; i + 4 <= d.length; i += 4) { const v = (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0; if (v === 0x87f854 || v === 0x87f8ca || v === 0x444510) ptrs++; }
      }
      ok(ptrs === 0, `${ptrs} pointers to the textured-pass functions`);
    }
    // --- the coloured pass
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call): every operation rounds to a float mantissa
    const mem = cpu.mem;
    mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
    mem.addRegion({ lo: FAKE, hi: FAKE + 0x1000, name: 'fake' });
    mem.w32(0x983a38, DEV); mem.w32(DEV, VT);
    let view = new Float32Array(16);
    const draws = [];
    const slot = (off, argBytes, fn) => { const a = FAKE + off; mem.w32(VT + off, a); cpu.hooks.set(a, (c) => { fn(c); return argBytes; }); };
    slot(0x2c, 12, () => {});
    slot(0x30, 12, (c) => { if (c.arg(1) === 2) for (let i = 0; i < 16; i++) mem.wf32(c.arg(2) + i * 4, view[i]); c.eax = 0; });
    slot(0x50, 12, () => { cpu.eax = 0; });
    slot(0x8c, 12, () => {});
    slot(0x68, 32, (c) => { draws.push({ fvf: c.arg(2), verts: c.arg(3), count: c.arg(4), idx: c.arg(5), nIdx: c.arg(6) }); c.eax = 0; });
    cpu.hooks.set(0x41273a, () => {});          // texture list
    cpu.hooks.set(0x87eaf3, () => {});          // the debug dump to c:\Debug.obj
    cpu.hooks.set(0x41204a, () => 4);           // SetTexture(stage, 0): thiscall, one argument
    const texCalls = [], stateCalls = [];
    cpu.hooks.set(0x412243, (c) => { texCalls.push([c.arg(0), c.arg(1)]); return 8; });   // FUN_00412243(stage, texture index) on the zone's texture list
    cpu.hooks.set(0x4092fd, (c) => { stateCalls.push(c.arg(0)); return 0; });             // (cdecl: the caller pops)
    cpu.hooks.set(0x416d1a, () => 0);           // the per-vertex visibility query of the textured pass (its result is unused)             // the state block selection FUN_004092fd(n)
    const rand = rng(99);
    let worstPos = 0, worstCol = 0, nDraw = 0, nBehind = 0;
    for (let trial = 0; trial < 80; trial++) {
      const eye = [rand() * 60 - 30, trial % 4 === 3 ? -200 - 5 - rand() * 80 : rand() * 40 - 20, rand() * 60 - 30].map(Math.fround);
      const yaw = rand() * 6.28, pitch = (rand() - 0.5) * 1.6;
      const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const target = [eye[0] + fwd[0] * 10, eye[1] + fwd[1] * 10, eye[2] + fwd[2] * 10].map(Math.fround);
      view = lookDirLH(eye, fwd);
      const level = trial % 3 === 0 ? 0 : trial % 3 === 1 ? -106 : eye[1] + (rand() * 30 - 5);   // (only the dead textured pass uses it)
      for (let k = 0; k < 3; k++) { mem.wf32(0x986e18 + k * 4, eye[k]); mem.wf32(0x986d78 + k * 4, target[k]); }
      mem.wf32(0x986d88, 0); mem.wf32(0x986d8c, 1); mem.wf32(0x986d90, 0);
      // the camera parameters FUN_0087efc6 reads (fov, near, far): defaults of the data section; the far plane is temporarily 2000
      draws.length = 0;
      cpu.call(0x87f01e, [new Uint32Array(new Float32Array([level]).buffer)[0]]);
      const mesh = viewPlaneMesh({ eye, fwd: [view[2], view[6], view[10]], up: [0, 1, 0], target, level: Math.fround(level) });
      if (!mesh) { ok(draws.length === 0, `trial ${trial}: the original drew ${draws.length} polygons, the port none`); continue; }
      ok(draws.length === 1, `trial ${trial}: ${draws.length} draws (port ${mesh.count} vertices)`);
      if (draws.length !== 1) continue;
      const d = draws[0];
      ok(d.fvf === 0x42 && d.count === mesh.count && d.nIdx === (mesh.count - 2) * 3, `trial ${trial}: fvf ${d.fvf.toString(16)} count ${d.count} indices ${d.nIdx} vs ${mesh.count}`);
      if (d.count !== mesh.count) continue;
      nDraw++;
      for (let i = 0; i < d.count; i++) {
        for (let k = 0; k < 3; k++) {
          const a = mem.f32(d.verts + i * 16 + k * 4), b = mesh.positions[i * 3 + k];
          const rel = Math.abs(a - b) / (1 + Math.abs(a));
          if (rel > worstPos) { worstPos = rel; if (rel > 1e-3 && failures.length < 4) failures.push(`trial ${trial} vertex ${i} axis ${k}: original ${a}, port ${b}; eye ${eye} level ${level} flags ${mesh.count}`); }
        }
        const word = mem.u32(d.verts + i * 16 + 12);
        const got = [(word >> 16) & 255, (word >> 8) & 255, word & 255, word >>> 24];
        for (let k = 0; k < 4; k++) worstCol = Math.max(worstCol, Math.abs(got[k] - mesh.colors[i * 4 + k]));
      }
      for (let i = 0; i < d.nIdx; i++) ok(mem.r16(d.idx + i * 2) === mesh.indices[i], `trial ${trial}: index ${i}`);
      if (eye[1] > -200) nBehind++;
    }
    ok(worstPos === 0, `positions differ by (relative) ${worstPos}`);
    ok(worstCol === 0, `colours differ by ${worstCol}`);
    ok(nDraw > 25 && nBehind > 3 && nDraw - nBehind > 3, `exercised ${nDraw} polygons (${nBehind} with the eye above the plane y = -200, ${nDraw - nBehind} below)`);
    // --- the textured pass as the dead code would run it: FUN_0087f854(n1, n2, speed) itself is run on the emulator, then FUN_0087f01e; compared with viewPlaneTexturedMesh (debug option of the port)
    {
      let worstT = 0, nTex = 0, nBelow = 0, worstC = 0, worstUv = 0, order = true, state = true, texOk = true;
      for (let trial = 0; trial < 60; trial++) {
        const eye = [rand() * 80 - 40, rand() * 120 - 60, rand() * 80 - 40].map(Math.fround);
        const yaw = rand() * 6.28, pitch = (rand() - 0.5) * 1.6;
        const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
        const target = [eye[0] + fwd[0] * 10, eye[1] + fwd[1] * 10, eye[2] + fwd[2] * 10].map(Math.fround);
        view = lookDirLH(eye, fwd);
        for (let k = 0; k < 3; k++) { mem.wf32(0x986e18 + k * 4, eye[k]); mem.wf32(0x986d78 + k * 4, target[k]); }
        mem.wf32(0x986d88, 0); mem.wf32(0x986d8c, 1); mem.wf32(0x986d90, 0);
        const n1 = 1 + Math.floor(rand() * 4), n2 = 1 + Math.floor(rand() * 4);   // (the two frame lists hold 4 entries each: DAT_05d5fab0 / DAT_05d5fac0, followed by the speed word and the two phases)
        cpu.call(0x87f854, [n1, n2, 0x40a00000]);   // the setter the original never calls: DAT_05d5faac = n1, DAT_05d5fac0 = n1
        const t1 = Math.fround(rand() * 6), t2 = Math.fround(rand() * 6);
        mem.wf32(0x5d5fad4, t1); mem.wf32(0x5d5fad8, t2);
        draws.length = 0; texCalls.length = 0; stateCalls.length = 0;
        const level = [0, -106, Math.fround(rand() * 60 - 30)][trial % 3];
        cpu.call(0x87f01e, [new Uint32Array(new Float32Array([level]).buffer)[0]]);
        const mesh = viewPlaneTexturedMesh({ eye, fwd: [view[2], view[6], view[10]], up: [0, 1, 0], target, level }, t1, t2);
        const textured = draws.filter((d) => d.fvf === 0x242), coloured = draws.filter((d) => d.fvf === 0x42);
        if (!mesh) { ok(textured.length === 0, `textured trial ${trial}: the original drew ${textured.length} polygons, the port none`); continue; }
        ok(textured.length === 1, `textured trial ${trial}: ${textured.length} textured draws`);
        if (textured.length !== 1) continue;
        nTex++;
        const d = textured[0];
        ok(d.count === mesh.count && d.nIdx === (mesh.count - 2) * 3, `textured trial ${trial}: count ${d.count} / ${mesh.count}`);
        if (d.count !== mesh.count) continue;
        // the textured pass comes first, then the coloured one; state block 0x10 before the textured draw; texture n1 on both stages
        if (draws.indexOf(textured[0]) !== 0 || (coloured.length && draws.indexOf(coloured[0]) < 1)) order = false;
        if (!stateCalls.includes(VIEWPLANE_TEX_PRESET)) state = false;
        if (!(texCalls.length >= 2 && texCalls[0][0] === 0 && texCalls[1][0] === 1 && texCalls[0][1] === n1 && texCalls[1][1] === n1)) texOk = false;
        for (let i = 0; i < d.count; i++) {
          for (let k = 0; k < 3; k++) if (mem.f32(d.verts + i * 32 + k * 4) !== mesh.positions[i * 3 + k]) worstT++;
          if (mem.u32(d.verts + i * 32 + 12) !== 0xcfffffff) worstC = 1;
          for (let k = 0; k < 2; k++) {
            if (mem.f32(d.verts + i * 32 + 16 + k * 4) !== mesh.uvs[i * 2 + k] || mem.f32(d.verts + i * 32 + 24 + k * 4) !== mesh.uvs1[i * 2 + k]) worstUv++;
          }
        }
        for (let i = 0; i < d.nIdx; i++) ok(mem.r16(d.idx + i * 2) === mesh.indices[i], `textured trial ${trial}: index ${i}`);
        // the phases grow by 0.01 per drawn frame
        ok(mem.f32(0x5d5fad4) === Math.fround(t1 + Math.fround(0.01)) && mem.f32(0x5d5fad8) === Math.fround(t2 + Math.fround(0.01)), `textured trial ${trial}: the phases advance by 0.01`);
        if (eye[1] < -200) nBelow++;
      }
      ok(worstT === 0 && worstUv === 0 && worstC === 0, `textured pass: ${worstT} position floats, ${worstUv} texture coordinates and ${worstC} colour words differ (bit for bit)`);
      ok(order && state && texOk, `textured pass order ${order}, state block 0x10 ${state}, texture n1 on both stages ${texOk}`);
      ok(nTex > 30, `exercised ${nTex} textured polygons`);
      mem.w32(0x5d5faac, 0);   // back to the original's state: the pass is off
      notes.push(`${nTex} textured polygons (the dead pass, with FUN_0087f854 run first) against FUN_0087f01e: positions, both texture coordinate sets, colour word and the 0.01 phase step exact`);
    }
    notes.push(`${nDraw} polygons against FUN_0087f01e; relative position error ${worstPos.toExponential(1)}, colour error ${worstCol}`);
    return { checked, failures, notes };
  },
};
