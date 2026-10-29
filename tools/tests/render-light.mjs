// CPU vertex lighting (src/render/meshlight.ts) against the ORIGINAL functions of the executable run on the x86 emulator (docs/re/rendering.md section 5, WP-RENDER):
//   FUN_00885664 (light vectors per draw), FUN_00885a9a (static 0x242), FUN_0088589e (skinned), FUN_0088612c (shiny 0x2c2, bricks), FUN_00885e33 (skinned shiny).
// Random light sets (directional / point / ambient), random rotation + (non-)uniform scale matrices, random normals / positions; every output byte must agree.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { prepareLights, lightStatic, lightSkinned, lightShiny } from '../../src/render/meshlight.ts';
import { lightSetFromLgt } from '../../src/render/lighting.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const HEAP = 0x20000000;
const mkLights = (rand) => {
  const list = [];
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const d = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const l = Math.hypot(...d);
    list.push({ kind: 1, pos: [0, 0, 0], dir: [d[0] / l, Math.abs(d[1] / l), d[2] / l], color: [rand(), rand(), rand()], range: 1 });
  }
  for (let i = 0; i < 2; i++) list.push({ kind: 2, pos: [rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2], dir: [0, 1, 0], color: [rand(), rand(), rand()], range: 1 + rand() * 3 });
  list.push({ kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: [rand() * 0.5, rand() * 0.5, rand() * 0.5], range: 1 });
  return list;
};
function matrix(rand, nonUniform) {
  const ax = rand() * 6.28, ay = rand() * 6.28, az = rand() * 6.28;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // rows = rotated basis (row-vector convention)
  const rx = [cy * cz, cy * sz, -sy], ry = [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy], rz = [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy];
  const s = nonUniform ? [0.5 + rand() * 2, 0.5 + rand() * 2, 0.5 + rand() * 2] : (() => { const k = 0.5 + rand() * 2; return [k, k, k]; })();
  const m = new Float32Array(16);
  [rx, ry, rz].forEach((r, i) => { for (let k = 0; k < 3; k++) m[i * 4 + k] = r[k] * s[i]; });
  m[12] = rand() * 10 - 5; m[13] = rand() * 10 - 5; m[14] = rand() * 10 - 5; m[15] = 1;
  return m;
}

export default {
  name: 'render-light',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call): every operation rounds to a float mantissa
    cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x400000, name: 'heap' });
    const mem = cpu.mem;
    const SET = HEAP, LIGHTS = HEAP + 0x100, MAT = HEAP + 0x2000, VB = HEAP + 0x10000, NRM = HEAP + 0x80000;
    const EYE = 0x986e18;
    const N = 64;
    let worst = { static: 0, skinned: 0, shiny: 0, shinySpec: 0, skShiny: 0, skShinySpec: 0, prep: 0 };
    const byName = {};
    let nScaled = 0, nScaledBad = 0, nCarry = 0, nMismatch = 0, nBytes = 0, nSpec = 0;
    const rand = rng(12345);
    for (let trial = 0; trial < 60; trial++) {
      const list = mkLights(rand);
      const set = { ambient: [0, 0, 0], directional: [], point: [], list };
      const nonUniform = trial % 3 === 2;
      const m = matrix(rand, nonUniform);
      const eye = [rand() * 40 - 20, rand() * 40 - 20, rand() * 40 - 20];
      // runtime light array: type, pos (+4), dir (+0x10), diffuse (+0x4c), range (+0x5c) -- the fields FUN_008849c6 fills and FUN_00885664 reads
      mem.w32(SET, list.length); mem.w32(SET + 8, LIGHTS);
      list.forEach((l, i) => {
        const a = LIGHTS + i * 100;
        for (let k = 0; k < 100; k += 4) mem.w32(a + k, 0);
        mem.w32(a, l.kind);
        for (let k = 0; k < 3; k++) { mem.wf32(a + 4 + k * 4, l.pos[k]); mem.wf32(a + 0x10 + k * 4, l.dir[k]); mem.wf32(a + 0x4c + k * 4, l.color[k]); }
        mem.wf32(a + 0x5c, l.range);
      });
      for (let k = 0; k < 16; k++) mem.wf32(MAT + k * 4, m[k]);
      for (let k = 0; k < 3; k++) mem.wf32(EYE + k * 4, eye[k]);
      const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = rand() * 6 - 3;
        // mostly unit normals; some short ones (skinned blends are not renormalised) and some aligned with the half vector so the specular term fires
        let v = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
        const l = Math.hypot(...v); const k = (i % 5 === 4 ? 0.8 : 1) / l;
        nrm[i * 3] = v[0] * k; nrm[i * 3 + 1] = v[1] * k; nrm[i * 3 + 2] = v[2] * k;
      }
      const prep = prepareLights(set, m, eye);
      // the original: FUN_00885664 (thiscall: ecx = light set, [esp+4] = matrix), then the lighting function
      mem.fill(LIGHTS + 0x1c, 0, 0);   // (keep)
      cpu.regs[1] = SET; cpu.call(0x885664, [MAT]);
      // light vectors: compare the prepared fields with the original's writes
      list.forEach((l, i) => {
        const a = LIGHTS + i * 100;
        if (l.kind === 1) {
          for (let k = 0; k < 3; k++) {
            worst.dir = Math.max(worst.dir ?? 0, Math.abs(-mem.f32(a + 0x1c + k * 4) - prep.lights[i].dirObj[k])); worst.half = Math.max(worst.half ?? 0, Math.abs(mem.f32(a + 0x40 + k * 4) - prep.lights[i].halfObj[k])); worst.prep = Math.max(worst.prep, Math.abs(-mem.f32(a + 0x1c + k * 4) - prep.lights[i].dirObj[k]), Math.abs(mem.f32(a + 0x40 + k * 4) - prep.lights[i].halfObj[k]));
          }
        } else if (l.kind === 2) {
          for (let k = 0; k < 3; k++) worst.prep = Math.max(worst.prep, Math.abs(mem.f32(a + 0x28 + k * 4) - prep.lights[i].posObj[k]));
        }
      });
      for (let i = 0; i < N * 3; i++) mem.wf32(NRM + i * 4, nrm[i]);
      const compare = (name, got, stride, off, tag, wantAlpha) => {
        for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
          const o = mem.r8(VB + i * stride + off + (k === 0 ? 2 : k === 1 ? 1 : 0));   // 0xAARRGGBB little endian: B, G, R, A
          const g = got[i * 4 + k];
          nBytes++;
          const dlt = Math.abs(o - g);
          worst[tag] = Math.max(worst[tag], dlt);
          if (dlt > 0) { nMismatch++; if (failures.length < 6) failures.push(`${name} trial ${trial} vertex ${i} channel ${k}: original ${o}, port ${g}`); }
        }
        // alpha byte: left alone by the 0x242 variants (wantAlpha), 0xff or the carry of an overshooting channel in the 0x2c2 variants (the port's own packed byte)
        for (let i = 0; i < N; i++) {
          const a = mem.r8(VB + i * stride + off + 3), want = wantAlpha === 0xff ? got[i * 4 + 3] : wantAlpha;
          ok(a === want, `${name}: alpha byte ${a}, port ${want}`);
        }
      };
      // FUN_00885a9a (0x242, stride 0x20): positions at +0, the colour dword at +0xc (alpha left alone: preset 0x55)
      const initVb = (stride, alpha) => { for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) mem.wf32(VB + i * stride + k * 4, pos[i * 3 + k]); mem.w32(VB + i * stride + 0xc, (alpha << 24) >>> 0); mem.w32(VB + i * stride + 0x10, 0); } };
      initVb(0x20, 0x55);
      const out = new Uint8Array(N * 4), spec = new Uint8Array(N * 4);
      cpu.regs[1] = SET; cpu.call(0x885a9a, [N, VB, NRM]);
      lightStatic(prep, N, nrm, pos, out);
      compare('FUN_00885a9a', out, 0x20, 0xc, 'static', 0x55);
      initVb(0x20, 0x55);
      cpu.regs[1] = SET; cpu.call(0x88589e, [N, VB, NRM]);
      lightSkinned(prep, N, nrm, out);
      compare('FUN_0088589e', out, 0x20, 0xc, 'skinned', 0x55);
      // the specular functions: the half vector is not renormalised, so the powers only make sense for unscaled matrices (a scaled shiny record overshoots; checked above for the diffuse part)
      const mu = new Float32Array(m);
      for (let r = 0; r < 3; r++) { const l = Math.hypot(m[r * 4], m[r * 4 + 1], m[r * 4 + 2]); for (let k = 0; k < 3; k++) mu[r * 4 + k] = m[r * 4 + k] / l; }
      for (let k = 0; k < 16; k++) mem.wf32(MAT + k * 4, mu[k]);
      cpu.regs[1] = SET; cpu.call(0x885664, [MAT]);
      const prepU = prepareLights(set, mu, eye);
      initVb(0x24, 0);
      cpu.regs[1] = SET; cpu.call(0x88612c, [N, VB, NRM]);
      lightShiny(prepU, N, nrm, out, spec, false);
      compare('FUN_0088612c diffuse', out, 0x24, 0xc, 'shiny', 0xff);
      compare('FUN_0088612c specular', spec, 0x24, 0x10, 'shinySpec', 0xff);
      for (let i = 0; i < N; i++) if (spec[i * 4] | spec[i * 4 + 1] | spec[i * 4 + 2]) nSpec++;
      initVb(0x24, 0);
      cpu.regs[1] = SET; cpu.call(0x885e33, [N, VB, NRM]);
      lightShiny(prepU, N, nrm, out, spec, true);
      compare('FUN_00885e33 diffuse', out, 0x24, 0xc, 'skShiny', 0xff);
      compare('FUN_00885e33 specular', spec, 0x24, 0x10, 'skShinySpec', 0xff);
      // the SAME functions with the scaled matrix `m` (the half vector comes out longer than 1: the powers overshoot 255 and carry into the neighbouring byte, or overflow fistp): must still agree byte for byte
      for (let k = 0; k < 16; k++) mem.wf32(MAT + k * 4, m[k]);
      cpu.regs[1] = SET; cpu.call(0x885664, [MAT]);
      const prepS = prepareLights(set, m, eye);
      const cmpRaw = (name, got, stride, off) => {
        for (let i = 0; i < N; i++) {
          const o = mem.u32(VB + i * stride + off), g = (got[i * 4 + 3] * 0x1000000 + got[i * 4] * 0x10000 + got[i * 4 + 1] * 0x100 + got[i * 4 + 2]) >>> 0;
          nScaled++;
          if (o !== g) { nScaledBad++; byName[name] = (byName[name] ?? 0) + 1; if (failures.length < 6) failures.push(`${name} scaled trial ${trial} vertex ${i}: original 0x${o.toString(16)}, port 0x${g.toString(16)}`); }
          if ((o >>> 24) !== 0xff) nCarry++;
        }
      };
      initVb(0x24, 0);
      cpu.regs[1] = SET; cpu.call(0x88612c, [N, VB, NRM]);
      lightShiny(prepS, N, nrm, out, spec, false);
      cmpRaw('FUN_0088612c diffuse', out, 0x24, 0xc); cmpRaw('FUN_0088612c specular', spec, 0x24, 0x10);
      initVb(0x24, 0);
      cpu.regs[1] = SET; cpu.call(0x885e33, [N, VB, NRM]);
      lightShiny(prepS, N, nrm, out, spec, true);
      cmpRaw('FUN_00885e33 diffuse', out, 0x24, 0xc); cmpRaw('FUN_00885e33 specular', spec, 0x24, 0x10);
    }
    ok(nScaledBad === 0, `${nScaledBad} of ${nScaled} scaled shiny dwords differ ${JSON.stringify(byName)}`);
    ok(nCarry > 10, `overshoot exercised only ${nCarry} times`);
    notes.push(`scaled shiny matrices: ${nScaled} dwords exact, ${nCarry} with an overshooting channel`);
    ok(worst.prep === 0, `light vectors (FUN_00885664) differ by ${worst.prep}`);
    ok(nMismatch === 0, `${nMismatch} of ${nBytes} colour bytes differ`);
    ok(nSpec > 40, `the specular term was exercised only ${nSpec} times`);
    notes.push(`max byte difference: static ${worst.static}, skinned ${worst.skinned}, shiny ${worst.shiny}/${worst.shinySpec}, skinned shiny ${worst.skShiny}/${worst.skShinySpec}; light vectors ${worst.prep.toExponential(1)} (dir ${worst.dir.toExponential(1)}, half ${worst.half.toExponential(1)}); ${nBytes} bytes, ${nSpec} specular vertices`);
    // the runtime array of a light file: directional, point, ambient last, ambient = component-wise maximum
    {
      const set = lightSetFromLgt({ declaredCount: 2, lights: [
        { type: 2, direction: [0.5, -0.5, 0.7071], position: [0, 0, 0], diffuse: [1, 1, 1], ambient: [0.1, 0.2, 0.3] },
        { type: 0, direction: [0, 1, 0], position: [1, 2, 3], diffuse: [0.5, 0.5, 0.5], ambient: [0.3, 0.1, 0.2] }] });
      ok(set.list.length === 3 && set.list[0].kind === 1 && set.list[0].dir[1] === 0.5 && set.list[1].kind === 2 && set.list[2].kind === 0, 'runtime array: directional, point, ambient last');
      ok(Math.abs(set.list[2].color[0] - 0.3) < 1e-6 && Math.abs(set.list[2].color[1] - 0.2) < 1e-6 && Math.abs(set.list[2].color[2] - 0.3) < 1e-6, 'ambient = component-wise max');
    }
    return { checked, failures, notes };
  },
};
