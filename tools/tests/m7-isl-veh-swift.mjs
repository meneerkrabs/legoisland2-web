// WP-VERIFY M7 island ambient: the swift flock (SFT0-9): the leader FUN_004b2f64 (ctor FUN_004b31db) flies the cubic B-spline of swift.man (the original's spline engine SplineBase.cpp 0x445000.. runs natively on the .man
// file of the archive, FUN_0043ecd0 / FUN_004454e0 / FUN_00445660), the followers FUN_004b35f9 (ctor FUN_004b3a92) steer to it (FUN_004b336d) and play their wing clip (rig SWFT). The original's node code runs in the island
// emulation (tools/lib/m7-isl-veh-ambient.mjs) next to the port (src/island/ambient/animals.ts: SwiftLeaderNode, SwiftNode, BSpline) with the same random draws; compared tick by tick: records, leader / follower node blocks,
// animation clip / frame, sound calls, random draws.
import { m8Note } from '../lib/m8-d.mjs';
import { ambientDuel, CTOR, hostFiles, SPLINE_EXEC, giveAnims } from '../lib/m7-isl-veh-ambient.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const MAXFAIL = 30;

const __test = {
  name: 'm7-isl-veh-swift',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, wobble: 0 };
    const devs = new Map(), unhooked = new Map();
    for (const [dtLabel, dt, sm, ticks] of [['dt1', 1, false, 1800], ['dt0.5', 0.5, false, 2200], ['dt1 sync', 1, true, 2200], ['dt0.5 sync', 0.5, true, 1800]]) {
      const label = `swift ${dtLabel}`;
      const d = ambientDuel(ctx, { node: 2, dt, seed: 21, kinds: ['SwiftLeader', 'Swift'], ctors: new Set([CTOR.SWIFT_LEADER, CTOR.SWIFT]), maxFail: MAXFAIL, failures, tolFree: 1e-4,
        extraExec: SPLINE_EXEC, beforeAttach: (emu, duel) => { hostFiles(emu, duel); } });
      d.label = label; d.syncMode = sm; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem;
      giveAnims(d, 'SWFT', /^SFT\d$/);
      // sync mode: the port's leader takes the spline point the ORIGINAL just computed (float32 evaluation of the cubic: the port's double evaluation differs by ~1e-4, which a follower close to its target turns into ~1e-4 rad of yaw);
      // the evaluation itself is compared in every session (leader.target) with the tolerance of float32 arithmetic on coordinates of ~200
      const lead0 = W.records.findIndex((r) => r.name === 'SFT9');
      if (sm) { const lp = d.pnode(lead0, 'SwiftLeader'), la = d.onode(lead0, CTOR.SWIFT_LEADER); lp.eval = () => { lp.target = [0, 1, 2].map((k) => mem.f32(la + 0x70 + 4 * k)); for (let k = 0; k < 16; k++) lp.matrix[k] = mem.f32(la + 0x40 + 4 * k); }; }
      const sft = W.records.filter((r) => /^SFT\d$/.test(r.name)).map((r) => r.index);
      const lead = W.records.findIndex((r) => r.name === 'SFT9');
      const FN = { cnt: [0x2c, 'h'], perched: [0x2e, 'h'], dyaw: [0x30, 'f'], dpitch: [0x34, 'f'], timer: [0x38, 'f'] };
      d.syncPort = () => {
        for (const i of sft) { d.recToPort(i); d.nodeToPort(d.pnode(i, 'Swift'), d.onode(i, CTOR.SWIFT), { dyaw: [0x30, 'f'], dpitch: [0x34, 'f'], timer: [0x38, 'f'] }); const pn = d.pnode(i, 'Swift'), a = d.onode(i, CTOR.SWIFT); pn.cnt = (mem.r16(a + 0x2c) << 16 >> 16); pn.perched = (mem.r16(a + 0x2e) << 16 >> 16); }
        d.nodeToPort(d.pnode(lead, 'SwiftLeader'), d.onode(lead, CTOR.SWIFT_LEADER), { t: [0x30, 'f'], perch: [0x34, 'f'], state: [0x38, 'i'], homing: [0x3c, 'i'] });
        const la = d.onode(lead, CTOR.SWIFT_LEADER); { const lq = d.pnode(lead, 'SwiftLeader'); lq.target = [0, 1, 2].map((k) => mem.f32(la + 0x70 + 4 * k)); for (let k = 0; k < 16; k++) lq.matrix[k] = mem.f32(la + 0x40 + 4 * k); }   // the spline value the followers chase (float32 evaluation: compared separately below)
      };
      // the constructors drew a random start timer each (rand(200): FUN_004b3a92 / SwiftNode): the port's value is replaced by the original's (both are one uniform draw; the sequences differ only at construction)
      for (const i of sft) { const a = d.onode(i, CTOR.SWIFT); d.pnode(i, 'Swift').timer = mem.f32(a + 0x38); }
      const step = () => {
        d.tick(0); cover.ticks++;
        const gm = d.grazeBegin();
        for (const i of sft) d.rec(i, 0xfffe);
        d.vars(); d.sounds();
        const s = d.script.settle(); d.eq('rand draws left (original)', 0, s.left); d.eq('rand draws over (port)', 0, s.over);
        const la = d.onode(lead, CTOR.SWIFT_LEADER), lp = d.pnode(lead, 'SwiftLeader');
        d.cmp('leader.t', mem.f32(la + 0x30), lp.t, undefined, '', 1e-7); d.eq('leader.state', mem.r32(la + 0x38) | 0, lp.state); d.eq('leader.homing', mem.r32(la + 0x3c) | 0, lp.homing); d.cmp('leader.perch', mem.f32(la + 0x34), lp.perch);
        if (!sm) for (let k = 0; k < 3; k++) d.cmp('leader.target', mem.f32(la + 0x70 + 4 * k), lp.target[k], undefined, `[${k}]`, 1e-4);   // (free run: the port's own t differs by the float32 accumulation of t)
        // the spline itself: the port's BSpline at the ORIGINAL's t against the original's native evaluation (SplineBase 0x4466f0); target = point - (16, 0, 0)
        { const p = lp.spline.point(mem.f32(la + 0x30)); for (let k = 0; k < 3; k++) d.cmp('spline(t)', mem.f32(la + 0x70 + 4 * k), k === 0 ? Math.fround(p[0] - 16) : p[k], 0, `[${k}]`); }
        for (const i of sft) {
          const n = W.records[i].name, pn = d.pnode(i, 'Swift'), a = d.onode(i, CTOR.SWIFT);
          d.eq(n + '.cnt', (mem.r16(a + 0x2c) << 16 >> 16), pn.cnt); d.eq(n + '.perched', (mem.r16(a + 0x2e) << 16 >> 16), pn.perched);
          for (const f of ['dyaw', 'dpitch', 'timer']) d.cmp(`${n}.${f}`, mem.f32(a + FN[f][0]), pn[f], undefined, '', 1e-5);
          const oa = d.O.world.records[i].anim, pa = W.records[i].anim;
          if (pa) { d.eq(n + ' clip', oa.clip, pa.clip); d.cmp(n + ' frame', oa.frame, pa.frame, undefined, '', 1e-4); }
          if (pn.cnt > 0) cover.wobble++;
        }
        d.grazeEnd(gm);
      };
      for (let t = 0; t < ticks; t++) step();
      if (d.grazes) { cover.grazes = (cover.grazes ?? 0) + d.grazes.length; notes.push(`${label}: ${d.grazes.length} divergence(s) re-synced: ${d.grazes.map((g) => g.slice(0, 140)).join(' ; ')}`); }
      if (d.m8) notes.push(`${label}: ${m8Note(d.m8)}`);
      notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      d.cleanup();
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
