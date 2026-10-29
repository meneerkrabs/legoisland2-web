// The probe pass (src/game/probe.ts `probePass`) against the ORIGINAL FUN_00427233 run on the x86 emulator with hosted terrain / sweep calls (WP-RENDER R14): random controllers with
// random flag combinations (follow, write-back, extra offset, store, ground samples, throttles, gates, the NPC-record rule) over a few frames; every controller field and every record
// position must agree.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { probePass, newProbeCtrl, PROBE_DEAD } from '../../src/game/probe.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const fr = Math.fround;
const HEAP = 0x20000000, RECS = HEAP + 0x1000, CTRLS = HEAP + 0x10000, N = 12;
const ground = (p) => (p[0] > 40 ? -1e38 : fr(1 + 0.2 * p[0] + Math.sin(p[2])));
const ground2 = (p, mask) => (p[2] > 40 ? -1e38 : fr(0.5 + 0.1 * p[2] + (mask & 1)));

export default {
  name: 'render-probe',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call): every operation rounds to a float mantissa
    cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
    const mem = cpu.mem;
    const rand = rng(2024);
    let nSweeps = 0, nGround = 0, nWrites = 0, nDead = 0, nStored = 0, nNpc = 0;
    // the hosted engine calls: shared with the port through the same JS functions; the sweep decides from the start point
    const sweepOf = (from, delta, mask, radius, skin, probe) => {
      const h = Math.floor(Math.abs(from[0] * 7 + from[2] * 3 + delta[1])) % 5;
      if (h === 0 || h === 1) return null;
      const target = (h + Math.floor(Math.abs(from[1]))) % N;
      return { index: target, point: [fr(from[0] + delta[0] * 0.5), fr(from[1] + delta[1] * 0.5), fr(from[2] + delta[2] * 0.5)], normal: [0, 1, 0.5].map(fr) };
    };
    let hostCalls = { sweep: 0, ground: 0 };
    cpu.hooks.set(0x43cd62, (c) => { hostCalls.ground++; const p = [mem.f32(c.arg(0)), mem.f32(c.arg(0) + 4), mem.f32(c.arg(0) + 8)]; cpu.fpush(ground(p)); });
    cpu.hooks.set(0x43ce45, (c) => { hostCalls.ground++; const p = [mem.f32(c.arg(0)), mem.f32(c.arg(0) + 4), mem.f32(c.arg(0) + 8)]; cpu.fpush(ground2(p, c.arg(2))); });
    const hostSweep = (probe) => (c) => {
      hostCalls.sweep++;
      if (!c.arg(1)) throw new Error('args ' + [0,1,2,3,4,5,6,7].map((i) => c.arg(i).toString(16)).join(' ') + ' probe ' + probe);
      const from = [0, 1, 2].map((k) => mem.f32(c.arg(1) + k * 4)), delta = [0, 1, 2].map((k) => mem.f32(c.arg(2) + k * 4));
      const mask = c.arg(5);
      const r = sweepOf(from, delta, mask, 0, 0, probe);
      if (!r) { c.eax = 0; return; }
      for (let k = 0; k < 3; k++) { mem.wf32(c.arg(3) + k * 4, r.normal[k]); mem.wf32(c.arg(4) + k * 4, r.point[k]); }
      c.eax = RECS + r.index * 0x68;
    };
    cpu.hooks.set(0x441270, hostSweep(false));
    cpu.hooks.set(0x441ac0, hostSweep(true));
    mem.w32(0x9da868, 1);
    const scratch = { pos: [0, 0, 0], nrm: [0, 1, 0.5] };   // the original's stack locals keep their values between calls
    const trials = 80;
    for (let trial = 0; trial < trials; trial++) {
      const dt = trial % 3 === 0 ? 1 : trial % 3 === 1 ? 0.5 : 2.5;
      mem.wf32(0x8b1718, dt);
      // N records with controllers
      const port = [];
      for (let i = 0; i < N; i++) {
        const r = { x: fr(rand() * 60 - 10), y: fr(rand() * 10), z: fr(rand() * 60 - 10), flags: Math.floor(rand() * 4) | (rand() < 0.3 ? 0x40 : 0), ctrl: null };
        const flagBits = [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x200, 0x400, 0x1000, 0x2000, 0x4000, 0x8000];
        let pf = 0x1003; for (const b of flagBits) if (rand() < 0.3) pf |= b; if (rand() < 0.5) pf &= ~0x40;
        const c = newProbeCtrl();
        c.flags = rand() < 0.9 ? 2 : (rand() < 0.5 ? 0 : 6);
        c.near = rand() < 0.5 ? 0x10 : 0;
        c.d18 = fr(rand() * 4); c.d1c = fr(rand() * 4);
        c.off = [fr(rand() * 60 - 10), fr(rand() * 10), fr(rand() * 60 - 10)];
        c.delta = [fr(rand() - 0.5), fr(-rand() * 16), fr(rand() - 0.5)];
        c.skin = fr(rand() * 0.2); c.radius = fr(rand() * 0.2);
        c.mask = rand() < 0.15 ? 0 : [3, 0x41, 0x43, 0x110][Math.floor(rand() * 4)];
        c.extra = [fr(rand()), fr(rand()), fr(rand())];
        c.pflags = pf; c.timer = fr(rand() * 9); c.result = rand() < 0.3 ? 1 : 0;
        r.ctrl = c;
        port.push(r);
      }
      // the same state in the emulated memory
      const writeCtrl = (i) => {
        const r = port[i], c = r.ctrl, a = CTRLS + i * 0x80;
        mem.w32(a + 0xc, c.flags); mem.w32(a + 0x14, c.near); mem.wf32(a + 0x18, c.d18); mem.wf32(a + 0x1c, c.d1c);
        for (let k = 0; k < 3; k++) { mem.wf32(a + 0x20 + k * 4, c.off[k]); mem.wf32(a + 0x2c + k * 4, c.start[k]); mem.wf32(a + 0x38 + k * 4, c.delta[k]); mem.wf32(a + 0x50 + k * 4, c.extra[k]); }
        mem.wf32(a + 0x44, c.skin); mem.wf32(a + 0x48, c.radius); mem.w32(a + 0x4c, c.mask); mem.w32(a + 0x5c, c.pflags); mem.wf32(a + 0x60, c.timer); mem.w32(a + 0x64, c.result === 1 ? 1 : 0);
      };
      for (let i = 0; i < N; i++) {
        const r = port[i], a = RECS + i * 0x68;
        for (let k = 0; k < 0x68; k += 4) mem.w32(a + k, 0);
        mem.wf32(a + 0x3c, r.x); mem.wf32(a + 0x40, r.y); mem.wf32(a + 0x44, r.z); mem.w16(a + 0x60, r.flags); mem.w32(a + 0x5c, CTRLS + i * 0x80);
        writeCtrl(i);
      }
      const env = {
        dt, ground: (p) => ground(p), ground2: (p, m) => ground2(p, m),
        sweep: (owner, from, delta, mask, radius, skin, probe) => { const r = sweepOf([...from], [...delta], mask, radius, skin, probe); return r ? { rec: port[r.index], point: r.point, normal: r.normal } : null; },
      };
      // three frames: the first with fresh state, the next ones re-arm half of the controllers (one probe per arming)
      for (let frame = 0; frame < 3; frame++) {
        hostCalls = { sweep: 0, ground: 0 };
        cpu.call(0x427233, [RECS, N]);
        probePass(port, env, scratch);
        nSweeps += hostCalls.sweep; nGround += hostCalls.ground;
        for (let i = 0; i < N; i++) {
          const r = port[i], c = r.ctrl, a = CTRLS + i * 0x80, ra = RECS + i * 0x68;
          const f = (o) => mem.f32(a + o);
          const same = (x, y, what) => ok(x === y || (Number.isNaN(x) && Number.isNaN(y)), `trial ${trial} frame ${frame} ctrl ${i} ${what}: original ${x}, port ${y} (flags 0x${c.pflags.toString(16)})`);
          for (let k = 0; k < 3; k++) { same(f(0x20 + k * 4), c.off[k], `off[${k}]`); same(f(0x2c + k * 4), c.start[k], `start[${k}]`); same(f(0x38 + k * 4), c.delta[k], `delta[${k}]`); }
          ok(mem.u32(a + 0x4c) === c.mask, `trial ${trial} frame ${frame} ctrl ${i} mask ${mem.u32(a + 0x4c)} vs ${c.mask}`);
          same(f(0x60), c.timer, 'timer');
          const res = mem.u32(a + 0x64);
          const want = typeof c.result === 'object' ? RECS + port.indexOf(c.result) * 0x68 : c.result;
          ok(res === (want >>> 0), `trial ${trial} frame ${frame} ctrl ${i} result 0x${res.toString(16)} vs 0x${(want >>> 0).toString(16)}`);
          same(mem.f32(ra + 0x3c), r.x, 'x'); same(mem.f32(ra + 0x40), r.y, 'y'); same(mem.f32(ra + 0x44), r.z, 'z');
          if (res === PROBE_DEAD) nDead++;
          if (c.pflags & 8 && c.result !== 0) nStored++;
          if (typeof c.result === 'object' && (c.result.flags & 0x40) && (c.pflags & 0x1000)) nNpc++;
        }
        // re-arm (FUN_00427014) a random half of the controllers for the next frame, identically on both sides
        for (let i = 0; i < N; i++) {
          if (rand() < 0.5) {
            const c = port[i].ctrl, mask = [3, 0x41][Math.floor(rand() * 2)];
            c.mask = mask; c.result = 0;
            mem.w32(CTRLS + i * 0x80 + 0x4c, mask); mem.w32(CTRLS + i * 0x80 + 0x64, 0);
          }
        }
        for (let i = 0; i < N; i++) { const r = port[i], ra = RECS + i * 0x68; r.flags = (r.flags & ~1) | (rand() < 0.5 ? 1 : 0); mem.w16(ra + 0x60, r.flags); }
      }
    }
    ok(nSweeps > 300 && nGround > 200, `exercised ${nSweeps} sweeps, ${nGround} ground samples`);
    notes.push(`${trials} x 3 passes over ${N} controllers: ${nSweeps} sweeps, ${nGround} ground samples, ${nDead} switched-off probes, ${nStored} stored contacts, ${nNpc} NPC-rule cases`);
    return { checked, failures, notes };
  },
};
