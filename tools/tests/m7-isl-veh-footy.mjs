// WP-VERIFY M7 island gameplay nodes (fork B): Footy.c: the football BALL (FUN_0053955e ctor, FUN_00538e0b update with FUN_00538880 / 0053893d / 00538968 / 005389d9 / 00538c4d, ground probe FUN_00427139 flags 0x16),
// the flowers FLR1 / FLR2 (FUN_005399d8 / FUN_005396af) and LOON (FUN_00539d44 / FUN_00539ae4). The original's node framework + these nodes run natively in the x86 emulation (tools/lib/m7-isl-veh-emu.mjs)
// next to the port's nodes (src/island/pizza/footy.ts); same scripted kids (stand-ins for the NPC worker's Human1 / Turn2Pep: tools/lib/m7-isl-veh-footy.mjs), the same random stream (FUN_004388ae hosted =
// a seeded generator, the port's Math.random replaced by the same sequence), same dt. Compared tick by tick: the ball / flower / loon records (matrix, Euler, flags), every node field, all game variables,
// the sound calls (position, ids), the kids' variables.
import { Duel, B, lcg } from '../lib/m7-isl-veh-emu.mjs';
import { loadExe } from '../lib/engine-load.mjs';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { installKids, setFalling } from '../lib/m7-isl-veh-footy.mjs';

const MAXFAIL = 30;
const BN = { from: 0x24, to: 0x28 };

export default {
  name: 'm7-isl-veh-footy',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, kicks: 0, astray: 0, passes: 0, arrivals: 0, rolls: 0, ready: 0, blockedKick: 0, falling: 0, fetchSkip: 0, flowers: 0, flowerCycles: 0, loonCycles: 0, sinceAstrayMax: 0, relocations: 0 };
    const devs = new Map(), unhooked = new Map();
    const realRandom = Math.random;
    try {
      const session = (label, node, dt, syncMode, seed) => {
        const rngO = lcg(seed), rngP = lcg(seed);
        const d = new Duel(ctx, { node, keepKinds: ['Footy', 'Flower', 'Bob'], keepRecords: (n) => /^(BALL|FLR1|FLR2|LOON)$/.test(n), dt, maxFail: MAXFAIL, failures, draw: false, pepSwitc: false, seat: false,
          rng: { range: (x) => rngO() * x }, tolFree: 1e-4 });
        d.label = label; cover.sessions++; d.syncMode = syncMode;
        Math.random = rngP;
        // the Silence.wav ids 0 / 2 (the flowers' growing sounds, FUN_004433f0 with DAT_05d58148 / 188): inaudible, the port does not play them (docs wp5-pizza.md): dropped from the original's list, counted
        d.origDrop = (l) => /^p3 #[02] /.test(l);
        const W = d.P.world, mem = d.emu.cpu.mem;
        const idx = (n) => W.records.findIndex((r) => r.name === n);
        const kids = installKids(d);
        startPizzaNodes(W);     // the shell calls it after setupZone: the ball takes kid 0's matrix, the flowers start at scale 0.5 (the constructors' work)
        const ball = idx('BALL'), flr = ['FLR1', 'FLR2'].map(idx).filter((i) => i >= 0), loon0 = idx('LOON'), loon = loon0 >= 0 && d.pnode(loon0, 'Bob') ? loon0 : -1;
        const rnd = lcg(seed ^ 0x5bd1e995);
        d.placePepper(-300, 30, -300, 0);
        const PN = ball >= 0 ? d.pnode(ball, 'Footy') : null;
        const ptr = (i, ctor) => d.onode(i, ctor);
        // free-running: the ball's pose (position, spin angle rx) and the last offset are accumulated in float32 by the original (pos -= speed * dir each tick: half an ulp of a coordinate of 300 = 1.5e-5 per step, in one
        // direction for a straight flight) and in doubles by the port: after a flight of 100+ steps they are up to ~5e-4 apart: rounding, not logic. Free-run therefore takes them from the original every tick and FAILS if
        // the drift exceeds 5e-3 (the bound of 150 steps of half an ulp at 512); the sync sessions (same copy of the whole node state, 5e-6 bounds) test the logic strictly
        d.syncFree = () => {
          if (ball < 0) return;
          const a = ptr(ball, 0x53955e), r = W.records[ball], ra = 0x10000000 + ball * 0x68;
          const drift = Math.max(Math.abs(mem.f32(ra + 0x3c) - r.x), Math.abs(mem.f32(ra + 0x40) - r.y), Math.abs(mem.f32(ra + 0x44) - r.z), Math.abs(mem.f32(ra + 0x4c) - r.rx));
          cover.maxDrift = Math.max(cover.maxDrift ?? 0, drift);
          if (drift > 5e-3) d.fail(`${d.label} t${d.t} ball pose drift ${drift}`);
          d.recToPort(ball); void a;
        };
        d.syncPort = () => {
          if (ball >= 0) {
            d.recToPort(ball);
            const a = ptr(ball, 0x53955e), f = (o) => mem.f32(a + o);
            PN.phase = f(0x2c); PN.hop = f(0x30); PN.target = [f(0x40), f(0x44), f(0x48)]; PN.roll = [f(0x4c), f(0x50), f(0x54)];
            PN.rate = f(0x58); PN.speed = f(0x5c); PN.dir = [f(0x80), f(0x84), f(0x88)]; PN.ready = f(0xa0);
          }
          for (const i of flr) { const n = d.pnode(i, 'Flower'), a = ptr(i, 0x5399d8); n.t = mem.f32(a + 0x18); n.scale = mem.f32(a + 0x1c); d.recToPort(i); }
          if (loon >= 0) { const n = d.pnode(loon, 'Bob'), a = ptr(loon, 0x539d44); n.off = mem.f32(a + 0x20); n.wait = mem.f32(a + 0x24); d.recToPort(loon); }
        };
                const compare = () => {
          if (ball >= 0) {
            d.rec(ball);
            const a = ptr(ball, 0x53955e), f = (o) => mem.f32(a + o), n = 'BALL';
            d.eq(n + ' state', mem.r8(a + 0xa4), PN.state); d.eq(n + ' sinceAstray', mem.r8(a + 0xa5), PN.sinceAstray); d.eq(n + ' astray', mem.r8(a + 0xa6), PN.astray);
            d.eq(n + ' from', mem.r32(a + 0x24), PN.from); d.eq(n + ' to', mem.r32(a + 0x28), PN.to);
            d.cmp(n + ' phase', f(0x2c), PN.phase, undefined, '', 1e-5); d.cmp(n + ' hop', f(0x30), PN.hop); d.cmp(n + ' last.x', f(0x34), PN.last[0], undefined, '', 1e-4); d.cmp(n + ' last.z', f(0x3c), PN.last[2], undefined, '', 1e-4);
            for (let k = 0; k < 3; k++) { d.cmp(n + ' target', f(0x40 + 4 * k), PN.target[k], undefined, `[${k}]`, 1e-4); d.cmp(n + ' roll', f(0x4c + 4 * k), PN.roll[k], undefined, `[${k}]`, 1e-5); d.cmp(n + ' dir', f(0x80 + 4 * k), PN.dir[k], undefined, `[${k}]`, 1e-5); }
            d.cmp(n + ' rate', f(0x58), PN.rate, undefined, '', 1e-6); d.cmp(n + ' speed', f(0x5c), PN.speed, undefined, '', 1e-6); d.cmp(n + ' ready', f(0xa0), PN.ready, undefined, '', 1e-4);
          }
          for (const i of flr) { d.rec(i); const a = ptr(i, 0x5399d8), n = W.records[i].name, pn = d.pnode(i, 'Flower'); d.cmp(n + ' t', mem.f32(a + 0x18), pn.t, undefined, '', 1e-5); d.cmp(n + ' scale', mem.f32(a + 0x1c), pn.scale, undefined, '', 1e-5); }
          // free-run: off += 0.04 (dt 0.5) accumulates in float32 in the original (a step of 0.04 on the 2e-6 grid of 16..32 is off by up to 1e-6 per step: 1.7e-4 after 600 steps), in doubles in the port: rounding, bound 4e-4 (the knife edge `height < off` is the loon-float deviation) d.cmp('LOON wait', mem.f32(a + 0x24), pn.wait, undefined, '', 1e-5); d.cmp('LOON height', mem.f32(a + 0x18), pn.height); }
          if (loon >= 0) { d.rec(loon); const a = ptr(loon, 0x539d44), pn = d.pnode(loon, 'Bob'); d.eq('LOON state', mem.r32(a + 0x1c), pn.state); d.cmp('LOON off', mem.f32(a + 0x20), pn.off, undefined, '', d.syncMode ? 1e-5 : 4e-4); d.cmp('LOON wait', mem.f32(a + 0x24), pn.wait, undefined, '', 1e-5); d.cmp('LOON height', mem.f32(a + 0x18), pn.height); }
          d.vars();
          // the sounds: Silence.wav ids 0 / 2 (the flowers' growing sounds) are inaudible: the port does not play them (docs wp5-pizza.md): dropped from the original's list
          d.sounds();
        };
        // the kids: scripted. A kick bit (2) in a kid's variable starts the kick clip 0x1d (the real kid node plays it); Pepper-near (0x100) and falling are toggled at random; the fetch bit (8) is cleared after a while
        const kidClip = new Map();
        const kidStep = () => {
          for (const k of kids) {
            const v = d.getVar(k.var);
            const A = [d.O.world.records[k.idx].anim, W.records[k.idx].anim];
            if ((v & 2) && k.kick < 0) { k.kick = 0; for (const an of A) an?.start(0x1d, 0); }
            if (k.kick >= 0) { k.kick += 1; if (k.kick > 50 * (dt === 1 ? 1 : 2)) { k.kick = -1; d.setVar(k.var, d.getVar(k.var) & ~2); for (const an of A) an?.start(0, 0); } }
            if (k.kick >= 0) for (const an of A) an?.advance(1.0, dt);
            if ((v & 8) && !k.fetchLeft) k.fetchLeft = 1 + Math.floor(rnd() * 60);
            if (k.fetchLeft && --k.fetchLeft === 0) d.setVar(k.var, d.getVar(k.var) & ~8);
            // Pepper near (0x100) / falling for a while (a short spell now and then, so that the ball is held up only briefly)
            if (k.nearLeft > 0) { if (--k.nearLeft === 0) d.setVar(k.var, d.getVar(k.var) & ~0x100); } else if (rnd() < 0.004) { k.nearLeft = 1 + Math.floor(rnd() * 40); d.setVar(k.var, d.getVar(k.var) | 0x100); cover.blockedKick++; }
            if (k.fallLeft > 0) { if (--k.fallLeft === 0) setFalling(d, k, 0); } else if (rnd() < 0.004) { k.fallLeft = 1 + Math.floor(rnd() * 40); setFalling(d, k, 1); cover.falling++; }
          }
        };
        // the kids walk about: a kid that is not the one about to kick moves to a new spot (both worlds) now and then
        // the scene's XXX0 stands far from the park (its NPC node walks it there in the game): the stand-in puts it next to the other two (the park: XXX1 / XXX2 are 20 units apart, terrain + 0.69)
        { const x = 30, z = -335; const y = W.col.terrainHeight(x, 40, z, 4) + 0.69; d.placeRec(kids[0].idx, x, y, z, 1.0); if (ball >= 0) d.placeRec(ball, x, y, z, 1.0); }
        const origin = kids.map((k) => { const r = W.records[k.idx]; return [r.x, r.y, r.z, r.ry]; });
        const relocate = () => {
          if (!PN || PN.state !== 1) return;
          const k = kids[Math.floor(rnd() * 3)], o = origin[kids.indexOf(k)];
          const x = o[0] + (rnd() - 0.5) * 16, z = o[2] + (rnd() - 0.5) * 16, ry = (rnd() - 0.5) * 6.2;
          d.placeRec(k.idx, x, o[1], z, ry); cover.relocations++;
        };
        let lastState = 0, lastTo = -1;
        const step = () => {
          kidStep();
          if (rnd() < 0.05) relocate();
          const gm = d.grazeBegin();
          const ra = 0x10000000 + ball * 0x68, o0 = [0x3c, 0x40, 0x44].map((o) => mem.f32(ra + o));
          try { d.tick(0); } catch (e) { const a = ptr(ball, 0x53955e); console.log('CRASH', label, d.t, 'state', mem.r8(a + 0xa4), 'phase', mem.f32(a + 0x2c), 'rate', mem.f32(a + 0x58), 'speed', mem.f32(a + 0x5c), 'tgt', mem.f32(a + 0x40), mem.f32(a + 0x48), 'from/to', mem.r32(a + 0x24), mem.r32(a + 0x28), 'pos', o0); throw e; }
          cover.ticks++;
          if (process.env.LOON_TRACE && loon >= 0 && d.t >= +process.env.LOON_TRACE - 3 && d.t <= +process.env.LOON_TRACE + 3) { const a = ptr(loon, 0x539d44), n = d.pnode(loon, 'Bob'); console.log('LOON', d.t, 'orig', mem.r32(a + 0x1c), mem.f32(a + 0x20), mem.f32(a + 0x24), '| port', n.state, n.off, n.wait); }
          if (process.env.FOOTY_TRACE && d.t >= +process.env.FOOTY_TRACE - 8 && d.t <= +process.env.FOOTY_TRACE + 2 && PN) {
            const a = ptr(ball, 0x53955e), f = (o) => mem.f32(a + o).toFixed(3), r = W.records[ball];
            console.log(d.t, 'orig st', mem.r8(a + 0xa4), 'from/to', mem.r32(a + 0x24), mem.r32(a + 0x28), 'ph', mem.f32(a + 0x2c).toFixed(7), 'rate', mem.f32(a + 0x58).toFixed(7), 'hop', mem.f32(a + 0x30), 'y', mem.f32(0x10000000 + ball * 0x68 + 0x40), 'pos', mem.f32(0x10000000 + ball * 0x68 + 0x3c).toFixed(2), mem.f32(0x10000000 + ball * 0x68 + 0x44).toFixed(2), 'tgt', f(0x40), f(0x48), 'last', f(0x34), f(0x3c), '| port st', PN.state, 'from/to', PN.from, PN.to, 'ph', PN.phase.toFixed(7), 'rate', PN.rate.toFixed(7), 'hop', PN.hop, 'y', r.y, 'pos', r.x.toFixed(2), r.z.toFixed(2), 'tgt', PN.target[0].toFixed(3), PN.target[2].toFixed(3), 'last', PN.last[0].toFixed(3), PN.last[2].toFixed(3), 'kv', kids.map((k) => d.getVar(k.var)), kids.map((k) => k.pn.falling), 'terr', W.col.terrainHeight(r.x, r.y + 8, r.z, 4), W.col.terrainHeight(-239.0, 62.4, 62.0, 4), 'probe', !!W.col.probe(r, [r.x, r.y + 8, r.z], [0, -40, 0], 0x2043));
          }
          if (process.env.FOOTY_KICKS && PN && mem.r8(ptr(ball, 0x53955e) + 0xa4) === 2 && PN.state === 2 && (d.t < 5 || lastState !== 2)) {
            const a = ptr(ball, 0x53955e), r = W.records[ball];
            console.log('KICK', d.t, 'orig tgt', [0x40, 0x44, 0x48].map((o) => mem.f32(a + o)), 'rate', mem.f32(a + 0x58), 'ready', mem.f32(a + 0xa0), 'pos', [0x3c, 0x40, 0x44].map((o) => mem.f32(0x10000000 + ball * 0x68 + o)), '| port', PN.target, PN.rate, PN.ready, [r.x, r.y, r.z]);
          }
          compare();
          d.grazeEnd(gm);
          if (PN) {
            const a = ptr(ball, 0x53955e), st = mem.r8(a + 0xa4);
            if (st !== lastState) { if (st === 2) cover.kicks++; if (st === 4) { cover.arrivals++; if (mem.r8(a + 0xa6)) cover.rolls++; } if (st === 1 && lastState === 4) cover.passes++; lastState = st; }
            if (mem.r8(a + 0xa6) === 1 && lastState === 8 && st === 8) { /* astray flight */ }
            if (PN.astray && PN.state === 2 && lastTo !== PN.to) { cover.astray++; lastTo = PN.to; } else if (PN.state === 1) lastTo = -1;
            cover.sinceAstrayMax = Math.max(cover.sinceAstrayMax, PN.sinceAstray);
          }
        };
        return { d, W, mem, step, kids, ball, flr, loon, PN, rnd, ptr };
      };

      const trackReady = (S) => {
        // 'ready' bit (4) set on a receiver, fetch bit (8): counted from the kid variables
        for (const k of S.kids) { const v = S.d.getVar(k.var); if (v & 4) cover.ready++; if (v & 8) cover.fetchSkip++; }
      };
      void trackReady;

      const seedOf = (l) => [...l].reduce((a, c) => a + c.charCodeAt(0), 0);
      // era 0 (story node 2): ball + flowers (no LOON); era 3 (node 52): ball + flowers + LOON
      for (const [lab, node, dt, sm, seed, n] of [
        ['e0 dt1', 2, 1, false, 7, 4500], ['e0 dt0.5', 2, 0.5, false, 11, 7000], ['e0 dt1 sync', 2, 1, true, 13, 3500], ['e0 dt0.5 sync', 2, 0.5, true, 17, 3500],
        ['e3 dt1', 52, 1, false, 19, 3000], ['e3 dt0.5', 52, 0.5, false, 23, 5500], ['e3 dt1 sync', 52, 1, true, 29, 1700], ['e3 dt0.5 sync', 52, 0.5, true, 31, 3200],
      ]) {
        if (process.env.FOOTY_ONLY && lab !== process.env.FOOTY_ONLY) continue;
        const S = session(`footy ${lab}`, node, dt, sm, seed);
        const { d, step, kids, flr } = S;
        const sc = dt === 1 ? 1 : 2;
        if (/dt1$|dt0.5$/.test(lab)) d.setVar(0x122, 12 + (seedOf(lab) % 20));    // var 290: the ready distance = 0.8 x its value (the kids' nodes set it in the game); 0 in the sync sessions
        for (let t = 0; t < 4 * sc; t++) step();
        for (let t = 0; t < n; t++) {
          step();
          // STEV's variable (MOVE_STEV 0x7c): bits 0x20 / 0x10 start the flowers FLR1 / FLR2 (they clear their own bit when the cycle ends)
          if (flr.length && t % (700 * sc) === 5 * sc) { d.setVar(0x7c, d.getVar(0x7c) | 0x20); cover.flowers++; }
          if (flr.length && t % (700 * sc) === 150 * sc) { d.setVar(0x7c, d.getVar(0x7c) | 0x10); cover.flowers++; }
          if (S.loon >= 0 && S.d.pnode(S.loon, 'Bob').state === 3) cover.loonCycles += 1 / (90 * sc);
          trackReady(S);
        }
        cover.flowerCycles += d.getVar(0x7c) & 0x30 ? 0 : 1;
        notes.push(`${lab}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
        if (d.grazes) notes.push(`${lab}: ${d.grazes.length} re-sync(s): ${d.grazes.slice(0, 3).map((g) => g.slice(0, 140)).join(' ; ')}`);
        cover.silent = (cover.silent ?? 0) + (d.silent ?? 0);
        checked += d.checked;
        for (const [a, c] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + c);
        for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      }
    } finally { Math.random = realRandom; }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
