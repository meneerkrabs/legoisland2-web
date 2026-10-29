// Differential test of the particle port against the original engine in the x86 interpreter (tools/lib/particle-emu.mjs): the same effect is started in both with the
// same RNG stream, driven through the same per frame inputs (frame counter, dt, parent matrix, gates, parameter overrides, collision list, zoom, camera), and after
// every update the draw list (every particle record, byte for byte, except the link / pointer words), the emitter blocks of all sources, the source matrices /
// movement vectors and the random table index are compared.
import { ParticleEngine } from '../../src/fx/particles/engine.ts';
import { msvcRand } from '../../src/fx/particles/core.ts';
import { archiveParticleFiles } from '../../src/fx/particles/files.ts';
import { ParticleEmu, G } from './particle-emu.mjs';

/** the 4 byte "name" of the record a collision list node points at (DAT_008b85bc compares the first dword with 'PCOL') */
const REC_WALL = 0x4c4c4157;       // 'WALL'
const REC_PCOL = 0x4c4f4350;       // 'PCOL'

/** the shared collision query: the half space y < 0 (a floor), the sphere of radius r at `pos` hits when its lowest point is below it */
function floorQuery(pos, _vel, radius) {
  globalThis.__pq?.(pos, radius);
  if (pos[1] - radius >= 0) return null;
  return { normal: [0, 1, 0], point: [pos[0], radius, pos[2]] };
}

function makeEmu(ctx, files, seed, collide) {
  const emu = new ParticleEmu(ctx, files, { rand: msvcRand(seed), collide });
  const hooks = emu.cpu.hooks;
  // engine constructor pieces that touch Direct3D / textures
  hooks.set(0x41272b, () => 0); hooks.set(0x443070, () => 0); hooks.set(0x442e80, () => 0);
  hooks.set(0x442e40, () => { emu.cpu.eax = 0; });
  hooks.set(0x40ccd8, (c) => { const m = emu.mem; m.wf32(c.arg(0), 640); m.wf32(c.arg(1), 480); m.wf32(c.arg(2), 1.0); });
  hooks.set(0x8870e6, () => { emu.cpu.eax = 0; });
  const self = emu.alloc(0x60);
  emu.call(0x44ec60, [emu.cstr('_data/'), emu.cstr('zone')], self);
  emu.mem.w32(G.engine, self);
  emu.self = self;
  return emu;
}

/**
 * scenario = { frames, dt?: (f) => number, zoom?, move?: (f, M: Float32Array) => void, gates?: [{ frame, var, mask, value }], params?: [{ frame, type, value }], stop?: frame,
 *              pause?: Set<frame>, coll?: 'floor' | 'pcol', lod?: { cam: [x, y, z] }, pos, rot, gate: [var, mask, value], vars?: { [i]: v } }
 * Returns { checked, failures[] }.
 */
export function runScenario(ctx, archive, effect, sc, seed = 7) {
  const files = archiveParticleFiles(archive);
  const failures = [];
  let checked = 0;
  const fail = (m) => { if (failures.length < 6) failures.push(`${archive.name} ${effect}: ${m}`); };
  const colRec = sc.coll === 'pcol' ? REC_PCOL : REC_WALL;
  const emu = makeEmu(ctx, files, seed, (_rec, pos, vel, radius) => floorQuery(pos, vel, radius));
  const vars = { 1: 0, 2: 1, ...(sc.vars ?? {}) };
  for (const [k, v] of Object.entries(vars)) emu.vars.set(+k, v);
  const eng = new ParticleEngine(files, {
    rand: msvcRand(seed), getVar: (i) => vars[i] ?? 0,
    collide: (_rec, pos, vel, radius, outN, outP) => { const r = floorQuery(pos, vel, radius); if (!r) return false; outN.set(r.normal); outP.set(r.point); return true; },
    isPcol: () => colRec === REC_PCOL,
  });
  const chk = (what, a, b) => { checked++; if (a !== b) { fail(`${what}: original ${a}, port ${b}`); return false; } return true; };
  chk('index after construction', emu.u32(G.idx), eng.ps.idx);
  for (let i = 0; i < 4096; i++) if (emu.f32(G.table + 4 * i) !== eng.ps.table[i]) { chk('random table', i, -1); break; }
  for (let i = 0; i < 256; i++) if (emu.f32(G.sin + 4 * i) !== eng.ps.sin[i] || emu.f32(G.cos + 4 * i) !== eng.ps.cos[i]) { chk('sin / cos table', i, -1); break; }
  // the parent matrix
  const M = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, -5, 1]);
  sc.init?.(M);   // (WP-SHELL, additive: the parent matrix at the start)
  const mp = emu.alloc(64);
  const pushM = () => { for (let i = 0; i < 16; i++) emu.setF32(mp + 4 * i, M[i]); };
  pushM();
  const pos = sc.pos ?? [0.5, 1.5, -0.25], rot = sc.rot ?? [-1.5707964, 0.3, 0.1];
  const pp = emu.alloc(12), rp = emu.alloc(12);
  for (let i = 0; i < 3; i++) { emu.setF32(pp + 4 * i, pos[i]); emu.setF32(rp + 4 * i, rot[i]); }
  const g = sc.gate ?? [2, 1, 1];
  const hE = emu.call(sc.swirl ? 0x44f7c0 : 0x44f710, [emu.cstr(effect), mp, pp, rp, g[0], g[1], g[2]], emu.self) >>> 0;
  const hP = sc.swirl ? eng.startSwirl(effect, M, pos, rot, g[0], g[1], g[2]) : eng.start(effect, M, pos, rot, g[0], g[1], g[2]);
  if (!chk('start handle', hE, hP >>> 0) || hP === 0xbabababa) return { checked, failures };
  if (sc.coll) {
    const wall = emu.alloc(16); emu.mem.w32(wall, colRec);
    emu.call(0x44fa00, [hE, wall], emu.self);
    eng.setCollision(hP, { name: colRec });
  }
  emu.call(0x44f090, [], emu.self); eng.finishSetup();
  if (sc.lod) { emu.mem.w32(G.lod, 1); eng.lod = true; }
  const cmpRec = (what, base, rec, lo, hi, skip = []) => {
    const u = new Uint32Array(rec.buf, rec.u8.byteOffset, rec.size >> 2);
    for (let o = lo; o < hi; o += 4) {
      if (skip.includes(o)) continue;
      const e = emu.mem.u32(base + o);
      checked++;
      if (e !== u[o >> 2]) {
        let more = '';
        if (globalThis.__pdiff) for (let o2 = o + 4, k = 0; o2 < hi && k < 8; o2 += 4) { const e2 = emu.mem.u32(base + o2); if (e2 !== u[o2 >> 2]) { more += ` | +0x${o2.toString(16)}: 0x${e2.toString(16)} vs 0x${u[o2 >> 2].toString(16)}`; k++; } }
        fail(`${what} +0x${o.toString(16)}: original 0x${e.toString(16)}, port 0x${u[o >> 2].toString(16)}${more}`); return false;
      }
    }
    return true;
  };
  const frames = sc.frames;
  for (let f = 1; f <= frames; f++) {
    const frame = 1000 + f;
    const dt = sc.dt ? sc.dt(f) : 1.0;
    sc.move?.(f, M); pushM();
    if (sc.matrixAt === f) { emu.call(0x44ea00, [hE, mp], emu.self); eng.setMatrix(hP, M); }
    for (const q of sc.gates ?? []) if (q.frame === f) { emu.call(0x44ea60, [hE, q.var, q.mask, q.value], emu.self); eng.setGate(hP, q.var, q.mask, q.value); }
    for (const q of sc.params ?? []) if (q.frame === f) {
      const cell = emu.alloc(4); emu.setF32(cell, q.value);
      emu.call(0x44ebd0, [hE, q.type, cell], emu.self); eng.setParam(hP, q.type, q.value);
    }
    if (sc.stop === f) { emu.call(0x44eaf0, [hE], emu.self); eng.stop(hP); }
    emu.mem.w32(G.frame, frame); emu.mem.wf32(G.dt, dt); emu.mem.wf32(G.zoom, sc.zoom ?? 1.0);
    if (sc.lod) for (let i = 0; i < 3; i++) emu.mem.wf32(G.cam + 4 * i, sc.lod.cam[i]);
    eng.zoom = Math.fround(sc.zoom ?? 1.0);
    if (sc.lod) eng.camera.set(sc.lod.cam);
    const paused = sc.pause?.has(f) ?? false;
    eng.paused = paused;
    emu.mem.wf32(G.invZoom, 0);
    emu.call(paused ? 0x44f220 : 0x44f2c0, [], emu.self);
    eng.update(dt, frame);
    if (!chk(`frame ${f} index`, emu.u32(G.idx), eng.ps.idx)) break;
    const n = emu.mem.u32(emu.self + 0x14), list = emu.mem.u32(emu.self + 0x20);
    if (!chk(`frame ${f} draw list length`, n, eng.drawList.length)) break;
    if (globalThis.__pdump) globalThis.__pdump(f, emu, list, n, eng);
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = cmpRec(`frame ${f} particle ${i}`, emu.mem.u32(list + 4 * i), eng.drawList[i].rec, 0x10, 0x304);
    const sBase = emu.mem.u32(emu.self + 4);
    for (let h = 0; h < 150 && ok && !sc.swirl; h++) {
      const s = eng.sources[h];
      if (!s.active) continue;
      const base = sBase + h * 0x620;
      // the emitter block (without the pool / list pointers) and the source's matrices, movement and flags
      ok = cmpRec(`frame ${f} source ${h} block`, base + 0x7c, s.tmpl.rec, 0, 0x33c) && cmpRec(`frame ${f} source ${h} block tail`, base + 0x7c, s.tmpl.rec, 0x34c, 0x350);
      const wrap = (arr) => ({ buf: arr.buffer, u8: { byteOffset: arr.byteOffset }, size: arr.byteLength });
      if (ok) ok = cmpRec(`frame ${f} source ${h} world`, base + 0x57c, wrap(s.world), 0, 0x40);
      if (ok) ok = cmpRec(`frame ${f} source ${h} prevWorld`, base + 0x5bc, wrap(s.prevWorld), 0, 0x40);
      if (ok) ok = cmpRec(`frame ${f} source ${h} vel`, base + 0x5fc, wrap(s.vel), 0, 0xc);
      if (ok) ok = chk(`frame ${f} source ${h} speed`, emu.mem.u32(base + 0x608), new Uint32Array(new Float32Array([s.speed]).buffer)[0]);
      if (ok) ok = chk(`frame ${f} source ${h} flags`, emu.mem.r8(base + 2) | (emu.mem.r8(base + 1) << 8), (s.ended ? 1 : 0) | (s.started ? 256 : 0));
    }
    if (!ok) break;
  }
  return { checked, failures };
}
