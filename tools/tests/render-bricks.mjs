// The brick effects' batching (src/fx/bricks/draw.ts `BrickBatchCpu`) against the ORIGINAL FUN_0044d420 (LOD by squared distance, transform of positions / normals) and FUN_00886be0
// (palette UVs, specular lighting FUN_0088612c, index rebasing, the 4096-vertex / 4096-index buffer bookkeeping) run on the x86 emulator (WP-RENDER R2).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { BrickBatchCpu, BATCH_VERTICES, BATCH_INDICES } from '../../src/fx/bricks/draw.ts';
import { prepareLights } from '../../src/render/meshlight.ts';
import { brickPaletteUv, BRICK_PALETTE_VA } from '../../src/formats/bricks.ts';
import { LOD1_D2, LOD2_D2 } from '../../src/fx/bricks/manager.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const HEAP = 0x20000000;
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export default {
  name: 'render-bricks',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call): every operation rounds to a float mantissa
    cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x800000, name: 'heap' });
    const mem = cpu.mem;
    const rand = rng(777);
    // memory map
    const SET = HEAP, LIGHTS = HEAP + 0x100, SETPTRS = HEAP + 0x40, BRICK = HEAP + 0x1000, TPOS = HEAP + 0x2000, TNRM = HEAP + 0x6000, VB = HEAP + 0x100000, IB = HEAP + 0x200000, MESH = HEAP + 0x300000;
    const G = { sets: 0x5d5fafc, eye: 0x986e18, cam: 0x9da5e8, tpos: 0x5d124d8, tnrm: 0x5d124dc, vbptr: 0x5d5fb5c, ibptr: 0x5defb6c, nv: 0x5defb60, ni: 0x5d5fb44, dbg: 0x5d37024 };
    // light set: a sun, a point, the ambient (as FUN_008849c6 builds them)
    const list = [
      { kind: 1, pos: [0, 0, 0], dir: [0.5, 0.7, 0.51], color: [1, 0.9, 0.8], range: 1 },
      { kind: 2, pos: [3, 2, 1], dir: [0, 1, 0], color: [1, 1, 1], range: 1 },
      { kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: [0.25, 0.3, 0.35], range: 1 },
    ];
    const l0 = Math.hypot(...list[0].dir); list[0].dir = list[0].dir.map((v) => v / l0);
    mem.w32(SET, list.length); mem.w32(SET + 8, LIGHTS); mem.w32(SETPTRS, SET); mem.w32(G.sets, SETPTRS);
    list.forEach((l, i) => {
      const a = LIGHTS + i * 100;
      for (let k = 0; k < 100; k += 4) mem.w32(a + k, 0);
      mem.w32(a, l.kind);
      for (let k = 0; k < 3; k++) { mem.wf32(a + 4 + k * 4, l.pos[k]); mem.wf32(a + 0x10 + k * 4, l.dir[k]); mem.wf32(a + 0x4c + k * 4, l.color[k]); }
      mem.wf32(a + 0x5c, l.range);
    });
    const set = { ambient: [0.25, 0.3, 0.35], directional: [], point: [], list };
    mem.w32(G.tpos, TPOS); mem.w32(G.tnrm, TNRM); mem.w32(G.vbptr, VB); mem.w32(G.ibptr, IB);
    mem.w32(G.dbg, 0);
    cpu.call(0x43ac78, [0x5d5fb00]);   // FUN_00886900 does this at start-up: the batch's world matrix DAT_05d5fb00 = identity
    let nChecked = 0, worstPos = 0, worstUv = 0, lodsSeen = new Set(), maxDiff = 0;
    const batch = new BrickBatchCpu();
    mem.w32(G.nv, 0); mem.w32(G.ni, 0);
    for (let trial = 0; trial < 40; trial++) {
      // a brick with three LOD meshes
      const lods = [];
      for (let l = 0; l < 3; l++) {
        const nv = 12 + Math.floor(rand() * 40), ntri = 6 + Math.floor(rand() * 20);
        const positions = new Float32Array(nv * 3).map(() => rand() * 2 - 1), normals = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) { const v = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]; const k = 1 / Math.hypot(...v); for (let c = 0; c < 3; c++) normals[i * 3 + c] = v[c] * k; }
        const indices = new Uint16Array(ntri * 3).map(() => Math.floor(rand() * nv));
        lods.push({ positions, normals, indices, vertexCount: nv, split: Math.floor(nv * rand()) });
      }
      // memory image of the brick record (FUN_0044d420 / FUN_00886be0 field offsets)
      let at = MESH;
      const place = (arr) => { const p = at; for (let i = 0; i < arr.length; i++) mem.wf32(p + i * 4, arr[i]); at += arr.length * 4; return p; };
      const placeIdx = (arr) => { const p = at; for (let i = 0; i < arr.length; i++) mem.w16(p + i * 2, arr[i]); at += Math.ceil(arr.length / 2) * 4; return p; };
      lods.forEach((m, l) => {
        mem.w32(BRICK + l * 4, place(m.positions)); mem.w32(BRICK + 0xc + l * 4, place(m.normals)); mem.w32(BRICK + 0x18 + l * 4, placeIdx(m.indices));
        mem.w16(BRICK + 0x24 + l * 2, m.split); mem.w16(BRICK + 0x2a + l * 2, m.vertexCount); mem.w16(BRICK + 0x30 + l * 2, m.indices.length);
      });
      // world matrix: rotation about y with a uniform scale (brick matrices are rotation * translation); position at the translation
      const a = rand() * 6.28, sc = 0.8 + rand() * 0.6, c = Math.cos(a), s = Math.sin(a);
      const w = new Float32Array([c * sc, 0, -s * sc, 0, 0, sc, 0, 0, s * sc, 0, c * sc, 0, rand() * 20 - 10, rand() * 20 - 10, rand() * 20 - 10, 1]);
      for (let k = 0; k < 16; k++) mem.wf32(BRICK + 0x9c + k * 4, w[k]);
      for (let k = 0; k < 3; k++) mem.wf32(BRICK + 0xcc + k * 4, w[12 + k]);
      const dist = trial % 3 === 0 ? 20 : trial % 3 === 1 ? 60 : 120;   // d^2 400 / 3600 / 14400: LOD 0 / 1 / 2
      const eye = [w[12] + (rand() > 0.5 ? 1 : -1) * dist, w[13] + 1, w[14] + (rand() * 2 - 1) * 10].map(Math.fround);
      for (let k = 0; k < 3; k++) { mem.wf32(G.eye + k * 4, eye[k]); mem.wf32(G.cam + k * 4, eye[k]); }
      const c1 = Math.floor(rand() * 32), c2 = trial % 4 === 3 ? -1 : Math.floor(rand() * 32);   // colour2 = -1: the original reads the 8 bytes before the palette (brickPaletteUv(-1))
      mem.w32(BRICK + 0xe8, c1); mem.w32(BRICK + 0xec, c2);
      // where the original starts in the buffers: occasionally with some vertices already in
      const startV = trial % 5 === 4 ? 1000 : batch.nv, startI = trial % 5 === 4 ? 2000 : batch.ni;
      if (trial % 5 === 4) { batch.nv = startV; batch.ni = startI; }
      mem.w32(G.nv, startV); mem.w32(G.ni, startI);
      if (!batch.full(lods[0].vertexCount, lods[0].indices.length) && BATCH_VERTICES - 52 > startV) { /* room: the normal path */ }
      cpu.call(0x44d420, [BRICK]);
      const lod = mem.r8(BRICK + 0xf2);
      lodsSeen.add(lod);
      const dx = eye[0] - w[12], dy = eye[1] - w[13], dz = eye[2] - w[14], d2 = Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy) + Math.fround(dz * dz));
      const wantLod = d2 < LOD1_D2 ? 0 : d2 < LOD2_D2 ? 1 : 2;
      ok(lod === wantLod || Math.abs(d2 - LOD1_D2) < 1 || Math.abs(d2 - LOD2_D2) < 1, `trial ${trial}: LOD ${lod}, port ${wantLod} (d2 ${d2})`);
      const m = lods[lod];
      // the port
      const prep = prepareLights(set, IDENT, eye);
      const uv1 = brickPaletteUv(pe, c1), uv2 = brickPaletteUv(pe, c2);
      batch.add(m, w, m.split, uv1, uv2, prep);
      // compare the vertex buffer (36 bytes per vertex), the index buffer and the counters
      const nv = m.vertexCount;
      for (let i = 0; i < nv; i++) {
        const o = VB + (startV + i) * 0x24;
        for (let k = 0; k < 3; k++) worstPos = Math.max(worstPos, Math.abs(mem.f32(o + k * 4) - batch.pos[(startV + i) * 3 + k]));
        const ou = mem.f32(o + 0x14), ov = mem.f32(o + 0x18);
        worstUv = Math.max(worstUv, Math.abs(ou - batch.uv[(startV + i) * 2]), Math.abs(ov - batch.uv[(startV + i) * 2 + 1]));
        for (let k = 0; k < 3; k++) {
          maxDiff = Math.max(maxDiff, Math.abs(mem.r8(o + 0xc + (2 - k)) - batch.col[(startV + i) * 4 + k]), Math.abs(mem.r8(o + 0x10 + (2 - k)) - batch.spec[(startV + i) * 4 + k]));
        }
        ok(mem.r8(o + 0xf) === batch.col[(startV + i) * 4 + 3] && mem.r8(o + 0x13) === batch.spec[(startV + i) * 4 + 3], `trial ${trial}: alpha bytes`);
        nChecked++;
      }
      for (let i = 0; i < m.indices.length; i++) ok(mem.r16(IB + (startI + i) * 2) === batch.idx[startI + i], `trial ${trial}: index ${i}: ${mem.r16(IB + (startI + i) * 2)} vs ${batch.idx[startI + i]}`);
      ok(mem.r32(G.nv) === batch.nv && mem.r32(G.ni) === batch.ni, `trial ${trial}: counters ${mem.r32(G.nv)}/${mem.r32(G.ni)} vs ${batch.nv}/${batch.ni}`);
      if (batch.nv > 2500) { batch.reset(); mem.w32(G.nv, 0); mem.w32(G.ni, 0); }
    }
    ok(worstPos === 0, `positions differ by ${worstPos}`);
    ok(worstUv === 0, `palette UVs differ by ${worstUv}`);
    ok(maxDiff === 0, `diffuse / specular bytes differ by ${maxDiff}`);
    ok(lodsSeen.size === 3, `LODs seen ${[...lodsSeen]}`);
    // the buffer limits: (0x1000 - n <= used) flushes
    {
      const b = new BrickBatchCpu();
      b.nv = BATCH_VERTICES - 30; b.ni = 10;
      ok(b.full(30, 3) && !b.full(29, 3), 'full(): the brick must be strictly smaller than the room that is left');
      b.nv = 10; b.ni = BATCH_INDICES - 12;
      ok(b.full(3, 12) && !b.full(3, 11), 'full(): the index buffer limit');
    }
    // the original's buffer flush at the limit (FUN_00886be0 with a nearly full buffer calls the D3D flush): reached natively only through the D3D device, so only the test above
    notes.push(`${nChecked} vertices compared against FUN_0044d420 + FUN_00886be0; position error ${worstPos.toExponential(1)}, byte error ${maxDiff}; palette = ${BRICK_PALETTE_VA.toString(16)}`);
    return { checked, failures, notes };
  },
};
