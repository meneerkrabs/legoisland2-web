// M5 / z40OGL, the seven PeppSwit.c constructors against the ORIGINAL code in the x86 interpreter (24-bit x87 like the game; tools/lib/m5-ogl-emu.mjs): the node framework passes, the constructors and the
// update / pre-render / draw handlers run natively next to the port, tick by tick, on the same buttons, positions and random numbers. Records are compared bit for bit.
import { OglDuel, CTORS, Lcg, B, RECORDS_BASE, REC } from '../lib/m5-ogl-emu.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { oglGlobals } from '../../src/zones/z40OGL/peppswit/globals.ts';
import { guarded } from '../lib/inject-guard.mjs';

const N = Number(process.env.M5_PS_TICKS ?? 1500);

const __test = {
  name: 'm5-z40OGL-peppswit-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const fin = (D, what) => { checked += D.checked; if (D.nfail) failures.push(...D.failures.slice(0, 5).map((s) => `${what}: ${s}`)); };

    // ---- 1. PEPPSWIT + the void node: random modes / mailbox / clips / heights / vehicle / buttons, both story nodes
    for (const [node, dt] of [[64, 1], [66, 1], [64, 0.5], [66, 0.5]]) {
      const R = new Lcg(777 + node + (dt === 1 ? 0 : 1000));
      const D = new OglDuel(ctx, { node, dt, kinds: ['PeppSwit', 'PeppVoid'], ctors: [CTORS.PEPPSWIT, CTORS.VOID], records: (n) => n === 'PEPP', label: `pepper${node} dt${dt}` });
      const pi = D.P.pepper.index, mem = D.emu.cpu.mem, W = D.P.world;
      const clips = [0, 1, 2, 0x16, 99, 0x62, 0x1b, 0x1c, 5];
      const modes = {};
      for (let i = 0; i < N * 2; i++) {
        if (R.next() < 0.08) D.setVar(0x5e, [1, 4, 8, 0x20, 0x101, 0x1001, 0x1004, 2][Math.floor(R.next() * 8)]);
        if (R.next() < 0.1) { const m = [0, 1, 2, 0x57, 0x1f, 0x38, 0x20, 0x32, 0x16, 3][Math.floor(R.next() * 10)]; mem.w32(0x8ae088, m); W.pep.mailbox = m; }
        if (R.next() < 0.1) { const c = clips[Math.floor(R.next() * clips.length)]; D.P.pepper.anim?.start(c, 0); D.O.pepper.anim?.start(c, 0); }
        if (R.next() < 0.05) { const p = D.P.pepper; D.place(pi, p.x + (R.next() - 0.5) * 20, R.next() < 0.5 ? p.y : -120 + R.next() * 40, p.z, 0); }
        if (R.next() < 0.03) { const cur = R.next() < 0.5 ? null : W.records[3]; mem.w32(0x9daa80, cur ? RECORDS_BASE + 3 * REC : 0); vehicles(W).current = cur; }
        let held = 0; if (R.next() < 0.3) held |= B.CTRL; if (R.next() < 0.05) held |= B.ENTER; if (R.next() < 0.3) held |= B.UP;
        D.tick(held);
        const m = D.getVar(0x5e) & 0xfff; modes[m] = (modes[m] ?? 0) + 1;
        for (const r of [3, 4, 74, 75, 76, 77, 78, 79, 80, 81, 82, 135, 136]) D.eq(`variant ${r}`, mem.r32(RECORDS_BASE + r * REC + 0x64) >>> 0, W.records[r].variant >>> 0);
        D.rec(pi, 0xffff, 0); D.vars(); D.globals(); D.calls(); D.ran(pi); D.camera(0); D.anim(pi);
        D.cmp('fall', mem.f32(0x5d5f3c0), oglGlobals(W).fall, 0);
        D.cmp('lamp timer', mem.f32(0x5d5f3c4), oglGlobals(W).lampTimer, 0);
      }
      D.eq('rng draws', D.rngO.n, D.rngP.n);
      for (const k of [1, 4, 8, 32]) if (!modes[k]) failures.push(`pepper${node} dt${dt}: mode ${k} never reached`);
      notes.push(`pepper node ${node} dt ${dt}: ${D.checked} checks, modes ${JSON.stringify(modes)}`);
      fin(D, `pepper${node} dt${dt}`);
    }

    // ---- 2. the slugs: Pepper moved next to them at random, cutscenes on / off
    for (const [node, dt] of [[64, 1], [66, 1], [64, 0.5], [66, 0.5]]) {
      const R = new Lcg(4242 + node + (dt === 1 ? 0 : 1000));
      const D = new OglDuel(ctx, { node, dt, kinds: ['PeppSlug'], ctors: [CTORS.SLUG], records: (n) => /^SLG/.test(n) || n === 'PEPP', label: `slug${node} dt${dt}` });
      const pi = D.P.pepper.index, mem = D.emu.cpu.mem;
      const slugs = D.P.world.records.filter((r) => /^SLG/.test(r.name)).map((r) => r.index);
      const st = {};
      for (let i = 0; i < N * 2; i++) {
        if (R.next() < 0.03) { const s = D.P.world.records[slugs[Math.floor(R.next() * slugs.length)]]; D.place(pi, s.x + (R.next() - 0.5) * 30, s.y + 2, s.z + (R.next() - 0.5) * 30, 0); }
        if (R.next() < 0.01) { const c = R.next() < 0.5; D.emu.cutscene = c; D.P.ictx.held = c; }
        D.tick(0);
        for (const s of slugs) {
          D.rec(s, 0xffff, 0); D.ran(s); D.anim(s);
          const nd = D.emu.nodesOf(s)[0], pn = D.P.world.records[s].ctrl.nodes[0];
          D.eq('state', mem.r32(nd + 0x20) | 0, pn.state); D.eq('probe', mem.r32(nd + 0x24) | 0, pn.probe); D.eq('missed', mem.r16(nd + 0x28) << 16 >> 16, pn.missed);
          D.cmp('timer', mem.f32(nd + 0x2c), pn.timer, 0);
          st[pn.state] = (st[pn.state] ?? 0) + 1;
        }
        D.vars(); D.globals(); D.calls();
      }
      for (const k of [0, 1, 2]) if (!st[k]) failures.push(`slug${node} dt${dt}: state ${k} never reached`);
      notes.push(`slugs node ${node} dt ${dt}: ${D.checked} checks, states ${JSON.stringify(st)}`);
      fin(D, `slug${node} dt${dt}`);
    }

    // ---- 3. the robots
    for (const [node, dt] of [[64, 1], [66, 1], [64, 0.5], [66, 0.5]]) {
      const R = new Lcg(99 + node + (dt === 1 ? 0 : 1000));
      const D = new OglDuel(ctx, { node, dt, kinds: ['PeppRobot'], ctors: [CTORS.ROBOT], records: (n) => /^RBT/.test(n) || n === 'PEPP', label: `robot${node} dt${dt}` });
      const pi = D.P.pepper.index;
      const rb = D.P.world.records.filter((r) => /^RBT/.test(r.name)).map((r) => r.index);
      const clips = {};
      for (let i = 0; i < N * 2; i++) {
        if (R.next() < 0.04) { const s = D.P.world.records[rb[Math.floor(R.next() * rb.length)]]; const k = R.next() < 0.4 ? 40 : 18; D.place(pi, s.x + (R.next() - 0.5) * k, s.y + 1, s.z + (R.next() - 0.5) * k, 0); }
        D.tick(0);
        for (const s of rb) { D.rec(s, 0xffff, 0); D.ran(s); D.anim(s); const r = D.P.world.records[s]; clips[r.anim.clip] = (clips[r.anim.clip] ?? 0) + 1; D.cmp('distSq', D.emu.ctrlDist(s), r.ctrl.distSq, 1e-5); }
        D.vars(); D.calls();
      }
      if (!clips[1] || !clips[3]) failures.push(`robot${node} dt${dt}: clips ${JSON.stringify(clips)}`);
      notes.push(`robots node ${node} dt ${dt}: ${D.checked} checks, clips ${JSON.stringify(clips)}`);
      fin(D, `robot${node} dt${dt}`);
    }

    // ---- 4. the citizens (node 64): the original's SGMFIG runs natively beneath them (it owns the walker)
    for (const dt of [1, 0.5]) {
      const D = new OglDuel(ctx, { node: 64, dt, kinds: ['SGMFIG', 'PeppCitizen'], ctors: [0x426151, CTORS.CITIZEN], records: (n) => /^CIT[1-5]/.test(n) || n === 'PEPP', label: `citizen dt${dt}` });
      const mem = D.emu.cpu.mem;
      const cs = D.P.world.records.filter((r) => /^CIT/.test(r.name)).map((r) => r.index);
      const st = {};
      for (let i = 0; i < N * 2; i++) {
        D.tick(0);
        for (const s of cs) {
          const r = D.P.world.records[s], pn = r.ctrl.nodes.find((n) => n.kind === 'PeppCitizen');
          D.rec(s, 0xffff, 0); D.ran(s); D.anim(s);
          const nd = D.emu.nodesOf(s)[1];
          D.eq('cur', mem.r32(nd + 0x20) | 0, pn.cur); D.eq('state', mem.r32(nd + 0x28) | 0, pn.state);
          st[pn.state] = (st[pn.state] ?? 0) + 1;
        }
        D.vars(); D.calls();
      }
      if (!st[0] || !st[2]) failures.push(`citizens dt${dt}: states ${JSON.stringify(st)} (walking and falling expected)`);
      notes.push(`citizens dt ${dt}: ${D.checked} checks, states ${JSON.stringify(st)}`);
      fin(D, `citizen dt${dt}`);
    }

    // ---- 5. HOLO's watcher and STAR (update / pre-render ran masks; the draw hook against FUN_0042271b)
    for (const dt of [1, 0.5]) {
      const D = new OglDuel(ctx, { node: 64, dt, kinds: ['PeppHolo', 'PeppStar'], ctors: [CTORS.HOLO, CTORS.STAR], records: (n) => n === 'HOLO' || n === 'STAR' || n === 'PEPP', label: `holo/star dt${dt}` });
      const mem = D.emu.cpu.mem, cpu = D.emu.cpu;
      for (let i = 0; i < 20; i++) { D.tick(0); D.ran(5); D.ran(0); D.rec(5, 0xffff, 0); D.rec(0, 0xffff, 0); D.vars(); D.calls(); }
      const eye = D.emu.alloc(16);
      for (const [fogOn, far] of [[0, 400], [1, 400], [1, 250.7], [1, 123.25], [0, 77.5]]) {
        mem.w32(0x983e10, fogOn); mem.wf32(0x89df34, far); mem.w32(0x9dec3c, Math.trunc(far));
        const e = [10.5 + far, -3.25, 77.125];
        e.forEach((v, k) => mem.wf32(eye + 4 * k, v));
        cpu.steps = 0;
        cpu.call(0x42271b, [RECORDS_BASE, D.O.world.records.length, 0, eye], { maxSteps: 5_000_000 });
        const r = D.P.world.records[0];
        r.ctrl.nodes[0].place(r, e, far, !!fogOn);
        D.rec(0, 0xffff, 0);
      }
      notes.push(`holo / star dt ${dt}: ${D.checked} checks`);
      fin(D, `holo/star dt${dt}`);
    }

    // ---- 6. the constructor's decor / roster set-up and Enter next to an outfit record
    for (const dt of [1, 0.5]) {
      const D = new OglDuel(ctx, { node: 64, dt, kinds: ['PeppSwit'], ctors: [CTORS.PEPPSWIT], records: (n) => n === 'PEPP', label: `decor dt${dt}` });
      const mem = D.emu.cpu.mem, pi = D.P.pepper.index;
      const attachModes = D.emu.log.filter((l) => /^mode (10[4-9]|11[0-9]|12[01]) 255 1$/.test(l));
      D.tick(0);
      const W = D.P.world;
      D.eq('constructor render modes', attachModes.join('|'), D.P.log.filter((l) => /^mode (10[4-9]|11[0-9]|12[01]) 255 1$/.test(l)).join('|'));
      if (attachModes.length !== 18) failures.push(`decor: ${attachModes.length} render modes of the constructor (18 expected)`);
      for (let i = 0; i < W.records.length; i++) D.eq(`variant ${i}`, mem.r32(RECORDS_BASE + i * REC + 0x64) >>> 0, W.records[i].variant >>> 0);
      for (let i = 0; i < W.records.length; i++) D.eq(`visible ${i}`, mem.r16(RECORDS_BASE + i * REC + 0x60) & 2, W.records[i].flags & 2);
      D.calls();
      const t = W.records[3];
      D.place(pi, t.x + 1, t.y, t.z + 1, 0);
      let changed = 0;
      for (let i = 0; i < 80; i++) {
        D.tick(i === 2 ? B.ENTER : 0);
        D.eq(`MAMA variant t${i}`, mem.r32(RECORDS_BASE + 3 * REC + 0x64) >>> 0, W.records[3].variant >>> 0);
        D.calls();
        if (i > 2 && W.records[3].variant !== 0x20b01) changed++;
      }
      notes.push(`decor dt ${dt}: ${D.checked} checks; MAMA's variant word changed on ${changed} ticks after Enter`);
      fin(D, `decor dt${dt}`);
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
