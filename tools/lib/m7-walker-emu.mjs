// M7 (WP-VERIFY): the waypoint walker (Common\WayPt, FUN_004630c0 loader, FUN_004614d5 create, FUN_00461c24 go to, FUN_004626d0 / FUN_004659b6 step and everything below them) runs from the ORIGINAL
// code in the x86 emulation (src/formats/x86emu.ts) on the real compiled waypoint maps, as an oracle for src/game/walker.ts (tools/tests/m7-walker-emu.mjs). Hosted: the file functions of the loader,
// the allocator, atan2 (the CRT loads an 80 bit constant the interpreter does not model). Everything else of the walker (route lookup, curve planning, steering, traffic rules) is native.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';
import { r24 } from '../../src/zones/common/f32.ts';

const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
export const bits = (v) => { FB[0] = v; return UB[0]; };
export const TABLE = 0x5d4e1b0, STRIDE = 0x84, MAPS = 0x5d500b8, MAP_STRIDE = 0x1f08, RECS = 0x30000000;
export const HEAP = 0x20000000;

/** offsets of the walker struct (0x84 bytes) by the port's field names: [offset, type] (u32, i16, f32) */
export const FIELDS = {
  flags: [0x00, 'u32'], map: [0x04, 'u32'], goal: [0x18, 'i16'], to: [0x1a, 'i16'], next: [0x1c, 'i16'], from: [0x1e, 'i16'], lane: [0x20, 'f32'],
  point0: [0x30, 'f32'], point1: [0x34, 'f32'], point2: [0x38, 'f32'], pointSet: [0x3c, 'u32'], turnRate: [0x40, 'f32'], speed: [0x44, 'f32'], speedReduced: [0x48, 'f32'],
  radiusMin: [0x4c, 'f32'], radiusMax: [0x50, 'f32'], curTurn: [0x54, 'f32'], headingNext: [0x58, 'f32'], headingCur: [0x5c, 'f32'], heading: [0x60, 'f32'], segLen2: [0x68, 'f32'],
  reach: [0x6c, 'f32'], curve: [0x70, 'f32'], radiusLimit: [0x74, 'f32'], stopDist2: [0x78, 'f32'], dist2: [0x7c, 'f32'], speedScale: [0x80, 'f32'],
};

export function createWalkerEmu(ctx, zone) {
  const pe = loadExe(ctx.dataRoot), cpu = createCpu(pe), mem = cpu.mem;
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;      // 24-bit precision as Direct3D 7 leaves it (see m7-walk-emu.mjs)
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  mem.addRegion({ lo: HEAP, hi: HEAP + 0x1000000, name: 'heap' });
  mem.addRegion({ lo: RECS, hi: RECS + 0x10000, name: 'records' });
  let heap = HEAP;
  const alloc = (n) => { const p = heap; heap = (heap + Math.max(4, n) + 15) & ~15; return p; };
  const hook = (a, f) => cpu.hooks.set(a, f);
  const E = { cpu, mem, pe, alloc, unhooked: new Map() };
  hook(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
  hook(0x433d60, () => {});                                      // the heap's free (FUN_00463701 frees the maps' blocks)
  const files = new Map(); let nextFile = 0x100;
  hook(0x43bfb7, (c) => {
    const e = archive.find(mem.cstr(c.arg(0)).replace(/\\/g, '/'));
    if (!e) { c.eax = 0; return; }
    const h = (nextFile += 0x10); files.set(h, { data: archive.read(e), pos: 0 }); c.eax = h;
  });
  hook(0x43c1a0, (c) => {
    const f = files.get(c.arg(0)), dst = c.arg(1), len = c.arg(2);
    if (!f) { c.eax = 0; return; }
    const k = Math.max(0, Math.min(len, f.data.length - f.pos));
    mem.write(dst, f.data.subarray(f.pos, f.pos + k)); f.pos += k; c.eax = k;
  });
  hook(0x43c22e, (c) => { files.delete(c.arg(0)); });
  hook(0x4388e7, (c) => { c.fpush(r24(Math.sqrt(c.argf(0)))); });      // FUN_004388e7(x): sqrt at 24 bit (fsqrt: the result stays in st0)
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  cpu.exec = [[0x460e00, 0x466200], [0x43a000, 0x43b100], [0x858d30, 0x873e00]];
  cpu.fallback = (a) => (c) => { E.unhooked.set(a, (E.unhooked.get(a) ?? 0) + 1); throw new Error(`m7 walker emu: unhooked call to 0x${a.toString(16)} from 0x${c.retAddr.toString(16)}`); };
  cpu.invalidate();
  const call = (a, args = [], o = {}) => { cpu.steps = 0; cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; return cpu.call(a, args, { maxSteps: o.maxSteps ?? 2e7, trace: E.trace ?? undefined }); };
  E.call = call;
  E.reset = () => call(0x4613d0);
  E.loadMaps = () => {
    const names = ['ROAD', 'PATH', 'CSM', 'OTH'], counts = [];
    for (let s = 0; s < 4; s++) {
      const p = alloc(64); const str = `Waypoints/W_${names[s]}`; for (let i = 0; i < str.length; i++) mem.w8(p + i, str.charCodeAt(i)); mem.w8(p + str.length, 0);
      call(0x4630c0, [s, p]);
      counts.push(mem.u32(MAPS + s * MAP_STRIDE));
    }
    return counts;
  };
  /** a record block of the oracle: name, matrix, Euler angles, flags (the walker reads the position at +0x3c.., the name at +0 and the heading at +0x50) */
  E.recPtr = (i) => RECS + i * 0x68;
  E.writeRec = (i, r) => {
    const a = E.recPtr(i);
    for (let k = 0; k < 4; k++) mem.w8(a + k, r.name.charCodeAt(k) || 0x20);
    for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, r.m[k]);
    mem.wf32(a + 0x50, r.ry); mem.w16(a + 0x60, r.flags);
  };
  E.readRec = (i) => { const a = E.recPtr(i); return { x: mem.f32(a + 0x3c), y: mem.f32(a + 0x40), z: mem.f32(a + 0x44), ry: mem.f32(a + 0x50), m: Array.from({ length: 16 }, (_, k) => mem.f32(a + 0xc + 4 * k)) }; };
  E.walkerPtr = (h) => TABLE + (h - 1) * STRIDE;
  E.readWalker = (h) => {
    const p = E.walkerPtr(h), o = {};
    for (const [k, [off, t]] of Object.entries(FIELDS)) o[k] = t === 'f32' ? mem.f32(p + off) : t === 'i16' ? (mem.r16(p + off) << 16) >> 16 : mem.u32(p + off);
    return o;
  };
  /** the walkers of node lists 0 / 1 / 2 of a map node as handles, in list order (node +0x14 / +0x18 / +0x1c is the head, walker +0x24 / +0x28 / +0x2c the link) */
  E.lists = (map, node) => {
    const base = mem.u32(MAPS + map * MAP_STRIDE + 0x3320 - 0x8) , out = [];
    void base;
    const nodes = mem.u32(0x5d51fb0 + map * MAP_STRIDE);
    for (let l = 0; l < 3; l++) {
      const lst = []; let p = mem.u32(nodes + node * 0x20 + 0x14 + 4 * l), n = 0;
      while (p && n++ < 100) { lst.push((p - TABLE) / STRIDE + 1); p = mem.u32(p + 0x24 + 4 * l); }
      out.push(lst);
    }
    return out;
  };
  // ---- the walker functions by the port's names
  const U = (v) => v >>> 0;
  const pos = alloc(16), yaw = alloc(16), out = alloc(16);
  E.n = {
    create: (map, recIdx, start) => call(0x4614d5, [map, recIdx < 0 ? 0 : E.recPtr(recIdx), U(start)]),
    free: (h) => call(0x461a3b, [h]),
    goTo: (h, node, cont) => call(0x461c24, [h, node, cont]),
    setSpeed: (h, v) => call(0x462206, [h, bits(v)]),
    setTurnRate: (h, v) => call(0x462324, [h, bits(v)]),
    setLane: (h, v) => call(0x461ad6, [h, bits(v)]),
    setRadiusMin: (h, v) => call(0x4623aa, [h, bits(v)]),
    setRadiusMax: (h, v) => call(0x4623cd, [h, bits(v)]),
    setRadiusLimit: (h, v) => call(0x462436, [h, bits(v)]),
    setStopDistance: (h, v) => call(0x4623f0, [h, bits(v)]),
    setSpeedScale: (h, v) => call(0x4621c7, [h, bits(v)]),
    setIgnore: (h, a, b) => call(0x46190f, [h, U(a), U(b)]),
    apply: (h, recIdx) => call(0x461fe4, [h, E.recPtr(recIdx)]),
    followRecord: (h, recIdx) => call(0x462729, [h, recIdx < 0 ? 0 : E.recPtr(recIdx)]),
    turnToHeading: (h, v) => call(0x462952, [h, bits(v)]),
    turnToNode: (h, node) => call(0x462918, [h, node]),
    teleport: (h, node) => call(0x4625d7, [h, 0, node]),
    /** FUN_004626d0(handle, pos, yaw, out) with the record's position / yaw: -> { code, x, y, z, yaw, dist } */
    step(h, p3, y) {
      for (let i = 0; i < 3; i++) mem.wf32(pos + 4 * i, p3[i]);
      mem.wf32(yaw, y); mem.wf32(out, 0); mem.wf32(out + 4, 0);
      const code = call(0x4626d0, [h, pos, yaw, out]) | 0;
      return { code, x: mem.f32(pos), y: mem.f32(pos + 4), z: mem.f32(pos + 8), yaw: mem.f32(yaw), dist: mem.f32(out) };
    },
  };
  /** DAT_008b1718 / DAT_008b171c: the tick's time step (the walker's steering scales with it) */
  E.setDt = (dt) => { mem.wf32(0x8b1718, dt); mem.wf32(0x8b171c, 1 / dt); };
  return E;
}
