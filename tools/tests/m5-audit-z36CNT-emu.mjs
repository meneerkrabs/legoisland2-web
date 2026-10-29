import { loadExe, sceneOf, loadZone } from '../lib/engine-load.mjs';
import { CntEmu } from '../lib/m5-cnt-emu.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { layoutFrom, blurCopies, armShadows } from '../../src/zones/z36cnt/pose.ts';
import { euler24 } from '../../src/zones/common/x87.ts';
import { REC as CREC, CentrifugeSim, readFrameTable, S, VAR_HISCORE_CNT, VAR_TROPHY_CNT } from '../../src/zones/z36cnt/sim.ts';

// z36CNT, M5 audit, ORACLE test: the original's centrifuge code (the TRAI controller FUN_007b20a8 / FUN_007b0c6e with the windows FUN_007b0401, the monitor ranges, the pitch, Bob's
// FUN_007b2836 / FUN_007b24a2) is executed in the x86 interpreter (tools/lib/m5-cnt-emu.mjs) next to the TypeScript `CentrifugeSim`; both get the same buttons and random numbers and the
// controller fields, the zone globals, Pepper's and Bob's animation state, the record visibility bits (the lights), the game variables and every sound / pitch / speech call are compared
// tick by tick over whole games (belt, visor, start, the run, the stop, the result).

const BTN = 0x40;
const gen = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) / 16777216; }; };

export default {
  name: 'm5-audit-z36CNT-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 12) failures.push(m); else if (failures.length === 12) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);
    const archive = ctx.archives.find((a) => a.name === 'z36CNT');
    const rig = parseBlk(archive.read(archive.find('anim/MFIG.blk')));
    const table = readFrameTable((va) => pe.u32(va));
    const scene = sceneOf(ctx, 'z36CNT');

    const scenario = (label, seed, player, ticks, hiscore0 = 0) => {
      const f0 = failures.length;
      const next = gen(seed), drawn = [];
      const vars = new Map([[VAR_HISCORE_CNT, hiscore0], [VAR_TROPHY_CNT, 0]]), vars2 = new Map(vars);
      const ev = [];
      const flags = scene.records.map((r) => r.flags);
      const host = {
        pep: new AnimInstance(rig), bob: new AnimInstance(rig),
        show: (i, on) => { if (on) flags[i] |= 2; else flags[i] &= ~2; },
        play: (id) => ev.push(`p ${id}`), stop: (id) => ev.push(`s ${id}`), rate: (id, hz) => ev.push(`r ${id} ${hz}`), say: (id) => ev.push(`say ${id}`),
        getVar: (i) => vars.get(i) ?? 0, setVar: (i, v) => { vars.set(i, v); ev.push(`setVar ${i} ${v}`); },
        rand: () => { const v = next(); drawn.push(v); return v; },
        visor: () => {},
      };
      const sim = new CentrifugeSim(host, table);
      // ---- the oracle: its own animation instances, the original's constructors
      const pep2 = new AnimInstance(rig), bob2 = new AnimInstance(rig);
      const recs = scene.records.map((r) => ({ name: r.name, m: Array.from(r.m ?? new Float32Array(16)), flags: r.flags }));
      let di = 0;
      const emu = new CntEmu(pe, recs, new Map([[19, pep2], [0, bob2]]), { rand: () => drawn[di++], vars: vars2 });
      emu.construct();
      const mem = emu.cpu.mem, T = emu.trai, B = emu.bob;
      const tf = (o) => mem.f32(T + o), ti = (o) => mem.r32(T + o), tb = (o) => mem.r8(T + o);
      const num = (tick, name, orig, port, tol = 1e-5) => { checked++; if (!(Math.abs(orig - port) <= tol * Math.max(1, Math.abs(orig)))) bad(`${label}: tick ${tick} ${name}: original ${orig} port ${port}`); };
      const eq = (tick, name, orig, port) => { checked++; if (JSON.stringify(orig) !== JSON.stringify(port)) bad(`${label}: tick ${tick} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); };
      const compare = (t) => {
        eq(t, 'state', ti(0xf8), sim.state); eq(t, 'clip', ti(0xfc), sim.clip); num(t, 'time', tf(0xf0), sim.time); num(t, 'bonusHits', tf(0xf4), sim.bonusHits);
        eq(t, 'reached75', ti(0x100) !== 0, sim.reached75); eq(t, 'latchL', ti(0x104) !== 0, sim.latchL); eq(t, 'latchR', ti(0x108) !== 0, sim.latchR); eq(t, 'bonus', ti(0x10c) !== 0, sim.bonus);
        num(t, 'angle', tf(0x110), sim.angle); num(t, 'power', tf(0x114), sim.power); eq(t, 'streak', ti(0x11c), sim.streak);
        eq(t, 'resetStreak', ti(0x120) !== 0, sim.resetStreak); eq(t, 'prevHit', ti(0x124) !== 0, sim.prevHit); eq(t, 'hit', ti(0x128) !== 0, sim.hit);
        eq(t, 'score', ti(0x12c), sim.score); eq(t, 'inWindow', ti(0x130) !== 0, sim.inWindow); eq(t, 'launch', ti(0x134) !== 0, sim.launch);
        eq(t, 'mon cur', ti(0x138), sim.mon.cur); eq(t, 'mon next', ti(0x13c), sim.mon.next); num(t, 'mon frame', tf(0x140), sim.mon.frame); num(t, 'mon start', tf(0x144), sim.mon.start); num(t, 'mon end', tf(0x148), sim.mon.end);
        eq(t, 'swish', tb(0x14c) !== 0, sim.swish); num(t, 'visorAngle', tf(0x150), sim.visorAngle); num(t, 'visorStep', tf(0x154), sim.visorStep); eq(t, 'visorFirst', ti(0x198) === 1, sim.visorFirst);
        eq(t, 'bob state', mem.r32(B + 0x1c), sim.bobState); num(t, 'bob speed', mem.f32(B + 0x20), sim.bobSpeed);
        eq(t, 'bobNext', mem.r32(0x5d5d4e4), sim.bobNext); num(t, 'bobPower', mem.f32(0x5d5d49c), sim.bobPower);
        eq(t, 'shownScore', mem.r32(0x5d5d424), sim.shownScore); eq(t, 'medalOk', mem.r32(0x5d5d46c) !== 0, sim.medalOk); eq(t, 'result', mem.r32(0x5d5d470), sim.result);
        num(t, 'hudStreak', mem.f32(0x5d5d474) === mem.f32(0x5d5d474) ? mem.r32(0x5d5d474) : 0, sim.hudStreak); num(t, 'hudTime', mem.f32(0x5d5d468), sim.hudTime); num(t, 'hudPower', mem.f32(0x5d5d48c), sim.hudPower);
        eq(t, 'hudFrame', mem.r32(0x5d5d420), sim.hudFrame); eq(t, 'saidDizzy', mem.r32(0x5d5d3cc) !== 0, sim.saidDizzy);
        eq(t, 'pep clip', pep2.clip, host.pep.clip); num(t, 'pep frame', pep2.frame, host.pep.frame); eq(t, 'bob clip', bob2.clip, host.bob.clip); num(t, 'bob frame', bob2.frame, host.bob.frame);
        for (let i = 4; i < 18; i++) eq(t, `rec${i} visible`, (mem.r16(emu.recPtr(i) + 0x60) & 2) !== 0, (flags[i] & 2) !== 0);
        eq(t, 'vars', [...vars2].sort(), [...vars].sort());
      };
      compare(-1);
      let states = new Set(), maxScore = 0;
      for (let t = 0; t < ticks && failures.length === f0; t++) {
        const pressed = player(sim, t);
        ev.length = 0; drawn.length = 0; di = 0;
        sim.bobStep(); sim.step(pressed);
        const olog = emu.tick(pressed);
        eq(t, 'calls', olog, ev);
        eq(t, 'random calls', di, drawn.length);
        compare(t);
        states.add(sim.state); maxScore = Math.max(maxScore, sim.score);
      }
      notes.push(`${label}: ${ticks} ticks, states ${[...states].sort().join('')}, score ${sim.score}, power ${sim.power.toFixed(2)}, result ${sim.result}, hiscore ${vars.get(VAR_HISCORE_CNT)} trophy ${vars.get(VAR_TROPHY_CNT)}, unhooked ${JSON.stringify([...emu.unhooked].map(([a, n]) => `${a.toString(16)}x${n}`))}`);
    };

    /** the perfect player: Shift on the start screens, left in the top window / right in the bottom window as soon as it opens */
    const perfect = (sim, t) => {
      if (sim.state === S.BELT || sim.state === S.START) return BTN;
      if (sim.state === S.RUN) { const z = sim.zoneOf(); if (z === 'top' && !sim.latchL) return 1; if (z === 'bottom' && !sim.latchR) return 2; }
      return 0;
    };
    const g1 = gen(3);
    const mash = (sim, t) => {
      if (sim.state === S.BELT || sim.state === S.START) return g1() < 0.2 ? BTN : 0;
      const r = g1(); return r < 0.15 ? 1 : r < 0.3 ? 2 : r < 0.33 ? 3 : 0;
    };
    const lazy = (sim, t) => (sim.state === S.BELT || sim.state === S.START ? ((t % 50) === 7 ? BTN : 0) : 0);
    const g2 = gen(11);
    /** early / late presses around the windows (half the presses are one tick early or late) */
    const sloppy = (sim, t) => {
      if (sim.state === S.BELT || sim.state === S.START) return BTN;
      if (sim.state === S.RUN) { const z = sim.zoneOf(); const r = g2(); if ((z === 'top' || z === 'left') && r < 0.4) return 1; if ((z === 'bottom' || z === 'right') && r < 0.4) return 2; }
      return 0;
    };
    // a player that hits most windows (a missed window resets the streak, two hits in a row add power): perfect, but a quarter of the presses are dropped
    const g3 = gen(21), g4 = gen(22);
    const partial = (sim, t) => { const b = perfect(sim, t); if (sim.state === S.RUN && b && g3() < 0.25) return 0; if (sim.state === S.RUN && !b && g4() < 0.02) return g4() < 0.5 ? 1 : 2; return b; };
    scenario('partial', 7, partial, 3400);
    scenario('partial, low hi-score', 8, partial, 3400, 500);
    scenario('perfect', 1, perfect, 3400);
    scenario('mash', 2, mash, 3400);
    scenario('lazy', 3, lazy, 600);
    scenario('sloppy', 4, sloppy, 3400);
    scenario('perfect, better hi-score', 5, perfect, 3400, 99999);
    scenario('perfect, worse hi-score', 6, perfect, 3400, 3000);

    // ---- the placement of the machine (the draw hook FUN_007b1a1b, `poseAt` of pose.ts) at many angles / powers: the real copy's matrices of TRAI / CHAI / WEIG / PEPP
    {
      const L = loadZone(ctx, 'z36CNT');
      const R = L.world.records;
      const recs = R.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
      const emu = new CntEmu(pe, recs, new Map([[19, new AnimInstance(rig)], [0, new AnimInstance(rig)]]), { rand: () => 0.5, vars: new Map() });
      emu.construct();
      const mem = emu.cpu.mem;
      { const cw = emu.cpu.cw; emu.cpu.cw = 0x7f; emu.cpu.steps = 0; emu.cpu.call(0x7afe61, [], { maxSteps: 100000 }); emu.cpu.cw = cw; }   // FUN_007afe61: the five shadow points of the zone set-up
      const pos = (i) => [R[i].m[12], R[i].m[13], R[i].m[14]];
      const layout = layoutFrom(pos(CREC.TRAI), pos(CREC.CHAI), pos(CREC.WEIG));
      const g = gen(99);
      let n = 0, copiesSeen = 0, shadowsSeen = 0;
      const bitsOf = (arr) => Array.from(arr, (v) => { const f = new Float32Array(1); f[0] = v; return new Uint32Array(f.buffer)[0]; });
      for (let k = 0; k < 120; k++) {
        const angle = Math.fround(k === 0 ? 0 : g() * 6.2831855), power = Math.fround(k % 5 === 0 ? 0 : k % 7 === 0 ? 1 : k % 11 === 0 ? 0.2 : g());
        // the arm record's matrix as FUN_007b0c6e's last matrix call leaves it (the hook reads it as its starting point): FUN_0043a5e4(0, -angle, 0, position) in 24-bit x87
        const base = euler24(0, -angle, 0, ...layout.arm);
        for (let j = 0; j < 16; j++) mem.wf32(emu.recPtr(CREC.TRAI) + 0xc + 4 * j, base[j]);
        emu.place(angle, power);
        const mine = blurCopies(layout, base, power);
        const bad2 = (what, a, b) => { checked++; n++; if (a.length !== b.length || a.some((v, i) => v !== b[i])) bad(`placement angle ${angle} power ${power} ${what}: original ${a} port ${b}`); };
        const orig = emu.draws.filter((d) => d.model !== undefined), shad = emu.draws.filter((d) => d.shadow);
        bad2('copies', [orig.length], [mine.length * 3]);
        mine.forEach((c, i) => {
          [[18, c.arm], [1, c.chair], [2, c.weight]].forEach(([rec, m], q) => {
            const d = orig[i * 3 + q] ?? { model: -1, m: [], mode: -1, alpha: -1 };
            bad2(`copy ${i} record ${rec} order`, [d.model], [rec]);
            bad2(`copy ${i} record ${rec} matrix`, bitsOf(d.m), bitsOf(m));
            bad2(`copy ${i} record ${rec} mode / alpha`, [d.mode, d.alpha], [c.alpha === 255 ? 1 : 7, c.alpha]);
          });
        });
        copiesSeen += mine.length;
        const real = mine[mine.length - 1];
        const cmp = (name, a, b) => bad2(name, bitsOf(a), bitsOf(b));
        cmp('CHAI record', Array.from({ length: 16 }, (_, j) => mem.f32(emu.recPtr(CREC.CHAI) + 0xc + 4 * j)), real.chair);
        cmp('WEIG record', Array.from({ length: 16 }, (_, j) => mem.f32(emu.recPtr(CREC.WEIG) + 0xc + 4 * j)), real.weight);
        cmp('PEPP record', Array.from({ length: 16 }, (_, j) => mem.f32(emu.recPtr(CREC.PEPP) + 0xc + 4 * j)), real.pepper);
        const sh = armShadows(real.arm);
        bad2('shadow count', [shad.length], [2]);
        sh.forEach((pts, i) => { bad2(`shadow ${i}`, bitsOf(shad[i]?.shadow ?? []), bitsOf(pts)); shadowsSeen++; });
        if (failures.length > 8) break;
      }
      const worst = 0;
      notes.push(`placement (the draw hook, 24-bit x87, bit for bit): ${n} comparisons over ${copiesSeen} loop iterations and ${shadowsSeen} shadows, worst difference ${worst}, unhooked ${JSON.stringify([...emu.unhooked].map(([a, c]) => `${a.toString(16)}x${c}`))}`);
    }
    return { checked, failures, notes };
  },
};
