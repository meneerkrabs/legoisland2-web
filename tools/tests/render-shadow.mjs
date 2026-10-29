// Blob shadows (src/game/shadow.ts) against the ORIGINAL FUN_00444940 (+ FUN_00444ef0, Pepper's marker) run on the x86 emulator with hosted engine calls (rays, vars, the vertex
// writer FUN_0087dd20 whose arguments are captured), and the per-zone shadow set-up read from the executable (`extractShadowSetup`): WP-RENDER R5.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { Pe } from '../../src/formats/exe.ts';
import { zoneCodeIndex, extractShadowSetup } from '../../src/formats/zonesetup.ts';
import { mulGame, transformPointGame } from '../../src/render/math.ts';
import { blobShadowPoints, shadowGate, markerPoints, markerVisible, SHADOW_RAY_START, SHADOW_RADIUS, SHADOW_LIFT } from '../../src/game/shadow.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const fr = Math.fround;
const HEAP = 0x20000000;
const REC = HEAP + 0x1000, RECN = 8;
const terrain = [
  (x, z) => fr(2 + 0.5 * Math.sin(0.3 * x) + 0.3 * Math.cos(0.2 * z)),
  (x, z) => fr(1.5 + 0.08 * x + 0.04 * z),
  (x, z) => fr(-1 + 0.9 * Math.abs(Math.sin(0.5 * x)) * 30),   // steep ridges: corners exceed the 16 clamp
];

export default {
  name: 'render-shadow',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    // ----------------------------------------------------------------------------- the per-zone set-up
    {
      const starts = pe.functionStarts(), idx = zoneCodeIndex(pe, starts);
      const want = {
        z01BPK: [22, 32, 34], z02LGI: [4, 5, 6, 0x186, 0x187], z03PPH: [6], z04IFC: [], z07CSI: [3, 4], z10RGB: [4, 0x26], z13CAI: [4, 5, 7, 8], z14OSD: [3], z16PYA: [1], z18MMP: [0, 0x5c, 0x5d],
        z21FSH: [4], z23DIP: [2], z27TRX: [0, 1], z28HAT: [1, 4, 5], z36CNT: [], z40OGL: [1], z41MAP: [0], z50LTC: [1], z60FRE: [],
      };
      for (const z of ['z05WAB', 'z08BKD', 'z09JST', 'z15SSH', 'z17WAS', 'z20DSP', 'z22BIP', 'z38PAR', 'z39ASB', 'z40aPO']) ok(extractShadowSetup(pe, idx.get(z.toLowerCase()), starts) === null, `${z}: never calls FUN_00444850: no blob shadows`);
      for (const [z, recs] of Object.entries(want)) {
        const s = extractShadowSetup(pe, idx.get(z.toLowerCase()), starts);
        ok(!!s && JSON.stringify(s.records) === JSON.stringify([...recs].sort((a, b) => a - b)) && s.unresolved === 0, `${z}: registered terrain records ${s ? JSON.stringify(s.records) : 'none'} vs ${JSON.stringify(recs)}`);
      }
      const brp = extractShadowSetup(pe, idx.get('z42brp'), starts);
      ok(brp && brp.records.length === 56 && brp.records[0] === 14 && brp.records.at(-1) === 79, `z42BRP: switch-registered records ${brp?.records.length}`);
    }
    // ----------------------------------------------------------------------------- the geometry against the original code
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call): every operation rounds to a float mantissa
    cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
    const mem = cpu.mem;
    const G = { ready: 0x9e5864, ready2: 0x9e5860, count: 0x9e5714, list: 0x9e575c, sea: 0x9da858, cam: 0x9da5e8, model: 0x9e585c, tex: 0x9e56f0, dt: 0x8b1718, tick: 0x9e5868, recs: 0x983804, nrecs: 0x983800, type: 0x8b58d0 };
    const vars = new Map();
    const captured = [];
    let texCalls = [];
    const BONES = HEAP + 0x20000;   // bone matrices: 16 floats each
    cpu.hooks.set(0x417575, (c) => { c.eax = vars.get(c.arg(0)) ?? 0; });
    cpu.hooks.set(0x4092fd, () => {});
    cpu.hooks.set(0x416ad7, () => {});
    cpu.hooks.set(0x416885, () => {});
    cpu.hooks.set(0x43bc58, (c) => { c.eax = BONES + c.arg(1) * 64; });
    cpu.hooks.set(0x87dd20, (c) => { const p = c.arg(2); const a = new Float32Array(15); for (let i = 0; i < 15; i++) a[i] = mem.f32(p + i * 4); captured.push({ mode: c.arg(1), pts: a }); });
    cpu.hooks.set(0x43f1a0, (c) => { texCalls.push({ tex: c.arg(2), mode: c.arg(3) }); });
    cpu.hooks.set(0x441b10, (c) => {
      const rec = c.arg(0), st = c.arg(1);
      const ri = Math.round((rec - mem.u32(G.recs)) / 0x68);
      const o = mem.u32(st), hit = mem.u32(st + 12);
      const ox = mem.f32(o), oy = mem.f32(o + 4), oz = mem.f32(o + 8);
      const h = terrain[ri === 4 ? 0 : ri === 5 ? 1 : 2](ox, oz);
      if (oy < h) { c.eax = 0; return; }
      mem.wf32(hit, ox); mem.wf32(hit + 4, h); mem.wf32(hit + 8, oz);
      c.eax = 1;
    });
    const rayJs = (rec, o) => { const h = terrain[rec === 4 ? 0 : rec === 5 ? 1 : 2](o[0], o[2]); return o[1] < h ? null : [o[0], fr(h), o[2]]; };   // (the hosted ray stores the hit as a float, like the collision world's points)
    mem.w32(G.recs, REC); mem.w32(G.nrecs, RECN);
    const rand = rng(4242);
    const setRec = (i, m, name, anim, ctrlFlags) => {
      const a = REC + i * 0x68;
      for (let k = 0; k < 0x68; k += 4) mem.w32(a + k, 0);
      for (let k = 0; k < 4; k++) mem.w8(a + k, name.charCodeAt(k));
      mem.w32(a + 4, HEAP + 0x30000);   // the model pointer (non-zero)
      mem.w32(a + 8, anim ? HEAP + 0x40000 : 0);
      for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + k * 4, m[k]);
      if (ctrlFlags !== null) { mem.w32(a + 0x5c, HEAP + 0x50000 + i * 0x40); mem.w32(HEAP + 0x50000 + i * 0x40 + 0xc, ctrlFlags); }
      return a;
    };
    const rotY = (a, x, y, z) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]); };
    const nums = { shadow: 0, marker: 0, worst: 0 };
    mem.w32(G.ready, 1); mem.w32(G.ready2, 1);
    for (let k = 0; k < 9; k++) mem.w32(G.tex + k * 4, 100 + k);
    for (let trial = 0; trial < 60; trial++) {
      const registered = trial % 4 === 0 ? [4] : trial % 4 === 1 ? [4, 5] : trial % 4 === 2 ? [5, 6, 4] : [6];
      mem.w32(G.count, registered.length);
      registered.forEach((r, i) => mem.w32(G.list + i * 4, r));
      const sea = fr(rand() * 3 - 1); mem.wf32(G.sea, sea);
      const eye = [fr(rand() * 20 - 10), fr(rand() * 10 + 5), fr(rand() * 20 - 10)];
      for (let k = 0; k < 3; k++) mem.wf32(G.cam + k * 4, eye[k]);
      const pepper = trial % 3 !== 0;
      const type = pepper ? [0, 1, 2, 3, 4, 5, 6, 8][trial % 8] : 4;   // (type 7 is the marker's own texture)
      const anim = trial % 2 === 0;
      const inVehicle = trial % 5 === 0 ? 1 : 0;
      const x = fr(rand() * 30 - 15), z = fr(rand() * 30 - 15), y = fr(rand() * 6 - 1);
      const yaw = rand() * 6.28;
      const m = rotY(yaw, x, y, z);
      const bone0 = rotY(rand() * 6.28, fr(rand() * 2 - 1), fr(rand() * 2), fr(rand() * 2 - 1));
      const bone10 = rotY(rand() * 6.28, fr(rand() * 2 - 1), fr(rand() * 2), fr(rand() * 2 - 1));
      for (let k = 0; k < 16; k++) { mem.wf32(BONES + k * 4, bone0[k]); mem.wf32(BONES + 10 * 64 + k * 4, bone10[k]); }
      vars.set(0xc5, type); vars.set(0xc6, pepper ? 1 : 0); vars.set(0xa9, inVehicle);
      const tick = Math.floor(rand() * 40);
      mem.wf32(G.tick, tick); mem.wf32(G.dt, 1);
      const rp = setRec(1, m, pepper ? 'PEPP' : 'BRIK', anim, pepper ? null : 0x10);
      captured.length = 0; texCalls = [];
      cpu.call(0x444940, [rp]);
            // the port's input: the hips bone times the record matrix for an animated PEPP when not in a vehicle, else the record matrix
      let src = m;
      if (anim && !inVehicle) src = mulGame(bone0, m);
      // the distance test of non-PEPP records: 80 units to the camera (6400): trial positions are within it, so they are drawn
      const near = !pepper ? ((eye[0] - x) ** 2 + (eye[1] - y) ** 2 + (eye[2] - z) ** 2) <= 6400 : true;
      const wantMarker = pepper && markerVisible(tick + 1);
      const gotShadow = captured.filter((c) => c.mode === 2 && texCalls[captured.indexOf(c)]?.tex === 100 + type);
      if (!near) { ok(captured.length === 0, `trial ${trial}: far record drew ${captured.length}`); continue; }
      const marker = captured.filter((c, i) => texCalls[i]?.tex === 107);
      ok(marker.length === (wantMarker ? 1 : 0), `trial ${trial}: marker ${marker.length} vs ${wantMarker}`);
      ok(gotShadow.length === 1, `trial ${trial}: ${gotShadow.length} shadow draws (type ${type})`);
      if (!gotShadow.length) continue;
      const want = blobShadowPoints({ x: src[12], y: src[13], z: src[14], fx: src[8], fz: src[10], type, seaLevel: sea }, registered, rayJs);
      let worst = 0;
      for (let i = 0; i < 15; i++) worst = Math.max(worst, Math.abs(gotShadow[0].pts[i] - want[i]));
      nums.worst = Math.max(nums.worst, worst);
      ok(worst === 0, `trial ${trial}: type ${type} shadow differs by ${worst}: ${[...gotShadow[0].pts].map((v) => v.toFixed(3))} vs ${[...want].map((v) => v.toFixed(3))}`);
      nums.shadow++;
      if (wantMarker && marker.length) {
        const bm = mulGame(bone10, m);
        const mp = markerPoints(bm, eye);
        let w2 = 0;
        for (let i = 0; i < 15; i++) w2 = Math.max(w2, Math.abs(marker[0].pts[i] - mp[i]));
        ok(w2 === 0, `trial ${trial}: marker differs by ${w2}`);
        ok(texCalls[captured.indexOf(marker[0])].mode === 2, 'marker draws in mode 2');
        nums.marker++;
      }
      ok(texCalls[captured.indexOf(gotShadow[0])].mode === 0, 'shadow draws in mode 0');
    }
    ok(nums.shadow > 30 && nums.marker > 5, `exercised: ${nums.shadow} shadows, ${nums.marker} markers`);
    // a zone without registered terrain draws nothing
    mem.w32(G.count, 0);
    captured.length = 0;
    vars.set(0xc5, 4); vars.set(0xc6, 0);
    cpu.call(0x444940, [setRec(1, rotY(0, 0, 0, 0), 'PEPP', false, null)]);
    ok(captured.length === 0, 'no registered record: nothing is drawn');
    // type -1 (shadow off)
    mem.w32(G.count, 1); mem.w32(G.list, 4);
    vars.set(0xc5, -1);
    cpu.call(0x444940, [setRec(1, rotY(0, 0, 0, 0), 'PEPP', false, null)]);
    ok(captured.length === 0, 'var 0xc5 = -1: no shadow');
    {
      // the value FUN_00444940 leaves in eax (a node draw hook made of it, FUN_004bd41a, reports it to the draw pass: 0 = not handled, other = handled): shadowGate against the emulated function
      const cases = [   // [label, name, ctrl flags (null = none), position, shadow type, terrain registered]
        ['PEPP drawn', 'PEPP', null, 0, 4, true], ['PEPP type -1', 'PEPP', null, 0, -1, true], ['PEPP type 9', 'PEPP', null, 0, 9, true],
        ['BRIK drawn', 'BRIK', 0x10, 5, 4, true], ['BRIK 0x40', 'BRIK', 0x40, 5, 4, true], ['BRIK far', 'BRIK', 0x10, 500, 4, true], ['BRIK flags 0', 'BRIK', 0, 5, 4, true], ['BRIK flags 6', 'BRIK', 6, 5, 4, true],
        ['BRIK no ctrl', 'BRIK', null, 5, 4, true], ['BRIK far flags 0', 'BRIK', 0, 500, 4, true], ['no terrain', 'BRIK', 0x10, 5, 4, false], ['PEPP no terrain', 'PEPP', null, 0, 4, false],
      ];
      const eye0 = [0, 1, 2].map((k) => mem.f32(G.cam + k * 4));
      let nRet = 0;
      for (const [label, name, flags, at, type, terrain] of cases) {
        mem.w32(G.count, terrain ? 1 : 0); mem.w32(G.list, 4); vars.set(0xc5, type); vars.set(0xc6, 0);
        const rec = setRec(1, rotY(0, at, 0, at), name, false, flags);
        const rv = cpu.call(0x444940, [rec]) >>> 0;
        const dx = eye0[0] - at, dy = eye0[1] - 0, dz = eye0[2] - at;
        const g = shadowGate({ terrain, pepp: name === 'PEPP', type, hasCtrl: flags !== null, ctrlFlags: flags ?? 0, dist2: dx * dx + dy * dy + dz * dz });
        ok((rv === 0) === (g.ret === 0) && rv !== 1, `${label}: the original returns 0x${rv.toString(16)}, shadowGate ${g.ret}`);
        nRet++;
      }
      notes.push(`${nRet} return-value cases of FUN_00444940 (draw-hook result)`);
      mem.w32(G.count, 1); mem.w32(G.list, 4);
    }
    // the engine's matrix helpers the shadow code is built from (FUN_0043a9e5 matrix product, FUN_0043ab72 point transform), against the original on random matrices
    {
      const R = 0x20080000, A = R, B = R + 0x40, O = R + 0x80, PT = R + 0xc0;
      let bad = 0, n = 0, badM = 0, badP = 0;
      const rm = () => Float32Array.from({ length: 16 }, () => fr(rand() * 6 - 3));
      for (let t = 0; t < 200; t++) {
        const a = rm(), b = rm();
        for (let k = 0; k < 16; k++) { mem.wf32(A + k * 4, a[k]); mem.wf32(B + k * 4, b[k]); }
        cpu.call(0x43a9e5, [O, B, A]);   // FUN_0043a9e5(out, b, a) = a x b
        const want = mulGame(a, b);
        for (let k = 0; k < 16; k++) { n++; if (mem.f32(O + k * 4) !== want[k]) { bad++; badM++; } }
        const p = [fr(rand() * 8 - 4), fr(rand() * 8 - 4), fr(rand() * 8 - 4)];
        for (let k = 0; k < 3; k++) mem.wf32(PT + k * 4, p[k]);
        cpu.call(0x43ab72, [O + 0x80, B, PT]);
        const tp = transformPointGame(b, p);
        for (let k = 0; k < 3; k++) { n++; if (mem.f32(O + 0x80 + k * 4) !== tp[k]) { bad++; badP++; } }
      }
      ok(bad === 0, `${bad} of ${n} floats differ from FUN_0043a9e5 / FUN_0043ab72 (${badM} product, ${badP} point)`);
    }
    ok(SHADOW_RAY_START.length === 9 && SHADOW_RADIUS[3] === fr(0.6) && SHADOW_LIFT[8] === fr(0.5), 'tables');
    notes.push(`${nums.shadow} shadows and ${nums.marker} markers against FUN_00444940 / FUN_00444ef0, worst point difference ${nums.worst.toExponential(1)}`);
    return { checked, failures, notes };
  },
};
