// Differential tests of the CPU side of the particle renderer (src/fx/particles/sprites.ts) against the original functions in the x86 interpreter:
// FUN_0044f4c0 (quad), FUN_008885e0 (clip), FUN_00887ae5 (sort).
import { buildQuad, clipPolygon, sortSprites, spinStep } from '../../src/fx/particles/sprites.ts';
import { PState, msvcRand, initTables } from '../../src/fx/particles/core.ts';
import { Particle } from '../../src/fx/particles/pool.ts';
import { AP } from '../../src/fx/particles/layout.ts';
import { ParticleEmu, G, f32bits } from './particle-emu.mjs';

export function runDrawOracle(ctx, files, trials = 300) {
  const failures = [];
  let checked = 0;
  const emu = new ParticleEmu(ctx, files, { rand: msvcRand(3) });
  const mem = emu.mem;
  const ps = new PState(msvcRand(3)); initTables(ps);
  emu.setTables(ps);
  let seed = 99;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const fail = (m) => { if (failures.length < 8) failures.push(m); };
  const self = emu.alloc(0x100), list = emu.alloc(0x40);
  mem.w32(self + 0x20, list);
  const scrP = emu.alloc(16), dest = emu.alloc(0x24 * 16), scratch = emu.alloc(0x24 * 16), pAddr = emu.alloc(0x308);
  mem.w32(0x5d37028, 1);                       // paused: no spin update inside the quad function (tested separately)
  const W = 640, H = 480;
  mem.w32(0x983a50, 0); mem.w32(0x983a54, 0); mem.w32(0x983a58, W); mem.w32(0x983a5c, H);
  for (let t = 0; t < trials; t++) {
    const p = new Particle(0);
    const rf = (a, b) => Math.fround(a + rnd() * (b - a));
    for (let k = 0; k < p.rec.u8.length; k++) p.rec.u8[k] = 0;
    const ai = p.app.i, af = p.app.f;
    ai[AP.CR] = (rnd() * 70000) | 0; ai[AP.CG] = (rnd() * 70000) | 0; ai[AP.CB] = (rnd() * 70000) | 0; ai[AP.CA] = (rnd() * 70000) | 0;
    af[AP.SIZE] = rf(0.05, 3); ai[AP.ANGLE] = (rnd() * 256) | 0; ai[AP.MATERIAL] = (rnd() * 3) | 0;
    for (let k = 0; k < 8; k++) af[AP.UV + k] = rf(0, 1);
    const scr = [rf(-200, 900), rf(-200, 700), rf(0, 1), rf(0.001, 2)];
    const invZoom = rf(0.6, 1.6), sizeScale = rf(100, 900);
    for (let k = 0; k < 0x308; k++) mem.w8(pAddr + k, p.rec.u8[k]);
    mem.w32(list, pAddr);
    for (let k = 0; k < 4; k++) mem.wf32(scrP + 4 * k, scr[k]);
    mem.wf32(G.invZoom, invZoom); mem.wf32(self + 0x38, sizeScale);
    emu.setTables(ps);
    emu.call(0x44f4c0, [0, scrP, dest], self);
    const df = new Float32Array(9 * 24), di = new Int32Array(df.buffer);
    buildQuad(p, scr, invZoom, sizeScale, ps, df, di, 0);
    // the original returns the count in vertex 0 [8] and the material in [7] after the clip
    const sf = new Float32Array(9 * 24), si = new Int32Array(sf.buffer);
    const n = clipPolygon(df, di, 0, sf, si, { left: 0, top: 0, right: W, bottom: H });
    const nEmu = mem.f32(dest + 0x20);
    checked++;
    if (nEmu !== n) { fail(`quad ${t}: vertex count original ${nEmu}, port ${n}`); continue; }
    for (let v = 0; v < n; v++) for (let k = 0; k < 7; k++) {
      checked++;
      const e = mem.u32(dest + (v * 9 + k) * 4), m = di[v * 9 + k] >>> 0;
      if (e !== m) { fail(`quad ${t} vertex ${v} word ${k}: original 0x${e.toString(16)}, port 0x${m.toString(16)}`); v = n; break; }
    }
  }
  // the spin update at the end of FUN_0044f4c0 (not paused): SCT += SCTINC * dt, ANGLE = ftol(SCT + 256) % 256 (after the quad was built with the old angle)
  mem.w32(0x5d37028, 0);
  for (let t = 0; t < trials; t++) {
    const p = new Particle(0);
    const rf = (a, b) => Math.fround(a + rnd() * (b - a));
    for (let k = 0; k < p.rec.u8.length; k++) p.rec.u8[k] = 0;
    const ai = p.app.i, af = p.app.f;
    af[AP.SIZE] = rf(0.05, 3); ai[AP.ANGLE] = (rnd() * 256) | 0;
    af[AP.SCT] = rf(-300, 600); af[AP.SCTINC] = rf(-40, 40);
    const dt = rf(0.3, 2.2);
    for (let k = 0; k < 0x308; k++) mem.w8(pAddr + k, p.rec.u8[k]);
    mem.w32(list, pAddr);
    for (let k = 0; k < 4; k++) mem.wf32(scrP + 4 * k, [100, 100, 0.5, 0.5][k]);
    mem.wf32(G.invZoom, 1); mem.wf32(self + 0x38, 400); mem.wf32(G.dt, dt);
    emu.setTables(ps);
    emu.call(0x44f4c0, [0, scrP, dest], self);
    spinStep(p, Math.fround(dt));
    checked += 2;
    const eSct = mem.u32(pAddr + 0x10 + 0xbc), eAng = mem.u32(pAddr + 0x10 + 0xc4) | 0;
    if (eSct !== (new Uint32Array(p.app.f.buffer, p.app.f.byteOffset, p.app.f.length)[AP.SCT])) fail(`spin ${t}: SCT original 0x${eSct.toString(16)}, port ${p.app.f[AP.SCT]}`);
    if (eAng !== p.app.i[AP.ANGLE]) fail(`spin ${t}: angle original ${eAng}, port ${p.app.i[AP.ANGLE]}`);
  }
  mem.w32(0x5d37028, 1);
  // the clip alone, on random polygons that straddle the edges
  for (let t = 0; t < trials; t++) {
    const rf = (a, b) => Math.fround(a + rnd() * (b - a));
    const df = new Float32Array(9 * 24), di = new Int32Array(df.buffer);
    for (let v = 0; v < 4; v++) {
      df[v * 9] = rf(-300, 1000); df[v * 9 + 1] = rf(-300, 800); df[v * 9 + 2] = rf(0, 1); df[v * 9 + 3] = rf(0, 1);
      di[v * 9 + 4] = (rnd() * 0xffffffff) | 0; df[v * 9 + 5] = rf(0, 1); df[v * 9 + 6] = rf(0, 1);
    }
    for (let k = 0; k < 36; k++) mem.w32(dest + 4 * k, di[k] >>> 0);
    const cnt = emu.call(0x8885e0, [dest, scratch]) | 0;
    const sf = new Float32Array(9 * 24), si = new Int32Array(sf.buffer);
    const n = clipPolygon(df, di, 0, sf, si, { left: 0, top: 0, right: W, bottom: H });
    checked++;
    if (cnt !== n) { fail(`clip ${t}: count original ${cnt}, port ${n}`); continue; }
    for (let v = 0; v < n; v++) for (let k = 0; k < 7; k++) {
      checked++;
      const e = mem.u32(dest + (v * 9 + k) * 4), m = di[v * 9 + k] >>> 0;
      if (e !== m) { fail(`clip ${t} vertex ${v} word ${k}: original 0x${e.toString(16)}, port 0x${m.toString(16)}`); v = n; break; }
    }
  }
  // the sort: random keys with duplicates, sizes around the insertion sort / quicksort threshold
  const ptsP = emu.alloc(16 * 600), idxP = emu.alloc(4 * 600);
  for (let t = 0; t < 120; t++) {
    const n = t < 40 ? 1 + (t % 14) : 10 + ((rnd() * 500) | 0);
    const pts = new Float32Array(n * 4), idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      pts[i * 4] = Math.fround(rnd() * 100); pts[i * 4 + 1] = Math.fround(rnd() * 100); pts[i * 4 + 2] = Math.fround(rnd());
      pts[i * 4 + 3] = t % 3 === 0 ? Math.fround(((rnd() * 8) | 0) / 8) : Math.fround(rnd() * 2);       // every third run has many duplicate keys
      idx[i] = i;
    }
    for (let i = 0; i < n * 4; i++) mem.wf32(ptsP + 4 * i, pts[i]);
    for (let i = 0; i < n; i++) mem.w32(idxP + 4 * i, idx[i]);
    mem.w32(0x5d5fb40, ptsP); mem.w32(0x5d5fb54, idxP);
    emu.call(0x887ae5, [0, n - 1]);
    sortSprites(pts, idx, 0, n - 1);
    checked++;
    for (let i = 0; i < n; i++) {
      if (mem.u32(idxP + 4 * i) !== (idx[i] >>> 0) || mem.f32(ptsP + 16 * i + 12) !== pts[i * 4 + 3]) { fail(`sort ${t} (n=${n}): differs at ${i}`); break; }
    }
  }
  void f32bits;
  return { checked, failures };
}
