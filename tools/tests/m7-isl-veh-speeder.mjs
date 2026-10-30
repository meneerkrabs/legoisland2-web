// WP-VERIFY M7 island: the speeder.c cars (AMBU, SPD0, SPD1, SPD2, PCAR; FUN_00538126 ctor, update FUN_00537689, pre-render FUN_00537d54, draw hook FUN_00537ea9, destroy) and the driver nodes
// (PETE / RICH / NUBB, FUN_005385d3: update FUN_00538346, pre-render FUN_005383ca). The original's node framework + these nodes run natively in the x86 emulation (tools/lib/m7-isl-veh-speeder.mjs: the
// scripted route replaces the Human1 walker, see there) next to the port's SpeederNode / DriverNode (src/island/pizza/speeder.ts); compared tick by tick: the records (matrix, Euler, flags), the node fields,
// the wheel part matrices at draw time, all game variables, the engine / horn / crash sound calls (3D positions, rates), the burst call, the car globals (engine car, horn flag).
import { speederDuel, CARS, DRIVERS, MOVE_VAR, CTOR_CAR, B, REC, RECORDS_BASE } from '../lib/m7-isl-veh-speeder.mjs';
import { lcg } from '../lib/m7-isl-veh-emu.mjs';
import { partMatrix } from '../../src/island/trigger/parts.ts';
import { withCdHeap } from '../lib/m8-save-pizza.mjs';

const MAXFAIL = 30;

// (WP-SAVE: the original is a debug build whose heap fills fresh node blocks with 0xCD; the nodes of this family keep that fill in the fields the constructors never write, so the oracle must allocate like it: tools/lib/m8-save-pizza.mjs)
const suite = {
  name: 'm7-isl-veh-speeder',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, frame0: 0, hits: 0, horns: 0, bursts: 0, playerHit: 0, pitch: 0, shifts: 0, returns: 0, driverOut: 0, driverIn: 0, pitchUp: 0, pitchDown: 0, popUp: 0 };
    const devs = new Map(), unhooked = new Map();
    const realRandom = Math.random;

    const session = (label, node, dt, syncMode, seed) => {
      // scripted random source: the k-th call of either side returns the same value (the port's `Math.random` is replaced for the session)
      const seq = []; const rr = lcg(seed);
      // k = 0..5 -> the value k + 0.5 (trunc = k); k = 6 -> exactly 6.0 for the original (FUN_004388ae(6.0) = rand() / 32767 * 6 reaches 6.0 for rand() = 32767) and 1.0 for the port's Math.random (never returned by it)
      const val = (n) => { while (seq.length <= n) { const k = Math.floor(rr() * 6); seq.push(seq.length % 19 === 11 ? 6 : k); } return seq[n]; };
      let nO = 0, nP = 0;
      Math.random = () => { const k = val(nP++); return k === 6 ? 32767.5 / 32768 : (k + 0.5) / 6; };
      const d = speederDuel(ctx, { node, dt, rng: { range: (x) => { if (!(x > 0)) return 0; const k = val(nO++); return k === 6 ? 6.0 : k + 0.5; } }, maxFail: MAXFAIL, failures, tolFree: 1e-4, rotAbsSync: 1e-5 });
      d.label = label; cover.sessions++; d.syncMode = syncMode;
      nP = 0;   // (the port's world set-up drew from the script (the nodes' constructors: random starts); the original's set-up runs natively: the script starts at the first tick for both)
      const W = d.P.world, emu = d.emu, mem = emu.cpu.mem;
      const A = (i) => RECORDS_BASE + i * REC;
      const names = (i) => W.records[i].name;
      const NS = { wobble: [0x18, 'f'], rate: [0x1c, 'f'], offTicks: [0x24, 'f'], wheel: [0x34, 'f'] };
      const gl = () => W.ext.get('speeder');
      d.syncPort = () => {
        for (const i of [...d.cars, ...d.drivers, d.P.pepper.index]) d.recToPort(i);
        for (const i of d.cars) {
          const pn = d.pnode(i, 'speeder'), a = d.onode(i, 0x538126);
          if (!pn) continue;
          d.nodeToPort(pn, a, NS);
          pn.saved = [mem.f32(a + 0x28), mem.f32(a + 0x2c), mem.f32(a + 0x30)]; pn.savedEuler = [mem.f32(a + 0x38), mem.f32(a + 0x3c), mem.f32(a + 0x40)];
        }
        for (const i of d.drivers) { const pn = d.pnode(i, 'speederDriver'), a = d.onode(i, 0x5385d3); if (pn) pn.rise = mem.f32(a + 0x20); }
      };
      const prevRate = new Map(), prevMoved = new Map(), prevPlaced = new Map();
      const compare = () => {
        for (const i of [...d.cars, ...d.drivers]) d.rec(i);
        d.rec(d.P.pepper.index);
        d.vars(); d.sounds();
        for (const i of [...d.cars, ...d.drivers]) { const cp = mem.r32(A(i) + 0x5c); d.eq(names(i) + ' controller flags', cp ? mem.r32(cp + 0xc) : -1, W.records[i].ctrl ? W.records[i].ctrl.flags : -1); }
        for (const i of d.cars) {
          const n = names(i), pn = d.pnode(i, 'speeder'), a = d.onode(i, 0x538126);
          d.cmp(n + ' wobble', mem.f32(a + 0x18), pn.wobble, undefined, '', 1e-5);
          // the engine rate (Hz, ~20000, +-118.3 per tick accumulated in float32: half an ulp = 1e-3 per addition): relative 5e-6 (0.1 Hz) + 2e-3
          d.cmp(n + ' rate', mem.f32(a + 0x1c), pn.rate, 5e-6, '', 2e-3);
          { const r0 = prevRate.get(i); if (r0 !== undefined) { const r1 = mem.f32(a + 0x1c); if (r1 > r0) cover.pitchUp++; else if (r1 < r0) cover.pitchDown++; } prevRate.set(i, mem.f32(a + 0x1c)); }
          { const m1 = pn.moved, m0 = prevMoved.get(i); if (m0 && !m1) cover.returns++; prevMoved.set(i, m1); }
          d.eq(n + ' skipPrerender', mem.r8(a + 0x20) !== 0, pn.skipPrerender); d.eq(n + ' moved', mem.r8(a + 0x21) !== 0, pn.moved);
          d.cmp(n + ' offTicks', mem.f32(a + 0x24), pn.offTicks);
          for (let k = 0; k < 3; k++) { d.cmp(n + ' saved', mem.f32(a + 0x28 + 4 * k), pn.saved[k], undefined, `[${k}]`, 1e-4); d.cmp(n + ' savedEuler', mem.f32(a + 0x38 + 4 * k), pn.savedEuler[k], undefined, `[${k}]`, 1e-5); }
          // (the wheel angle integrates the distance |pos - saved| of the record translation, whose float32-vs-double noise is up to ~1e-3 near 400 units: angle = 2 atan(d / 4): 5e-4)
          d.cmp(n + ' wheel', mem.f32(a + 0x34), pn.wheel, undefined, '', 5e-4);
          const snap = d.wheels.get(i);
          if (snap) {
            for (let k = 0; k < 4; k++) {
              const pm = partMatrix(W, W.records[i], 2 + k);
              if (!pm) continue;
              for (let q = 0; q < 16; q++) d.cmp(n + ' wheel' + (2 + k), snap[k][q], pm[q], undefined, `[${q}]`, 5e-4);
            }
          }
        }
        for (const i of d.drivers) {
          const n = names(i), pn = d.pnode(i, 'speederDriver'), a = d.onode(i, 0x5385d3);
          d.cmp(n + ' rise', mem.f32(a + 0x20), pn.rise); d.eq(n + ' placed', mem.r8(a + 0x24) !== 0, pn.placed);
          { const p1 = pn.placed, p0 = prevPlaced.get(i); if (p0 === false && p1) cover.driverOut++; else if (p0 && !p1) cover.driverIn++; prevPlaced.set(i, p1); if (pn.rise > 0) cover.popUp++; }
        }
        const g = gl(), ec = mem.r32(0x5d586e0);
        d.eq('DAT_05d586e0 engine car', ec ? (ec - RECORDS_BASE) / REC : -1, g?.engineCar ? g.engineCar.index : -1);
        d.eq('DAT_05d586dc horn', mem.r32(0x5d586dc) !== 0, g ? g.honked : false);
      };
      const step = (held = 0) => {
        d.drawRan.clear(); d.tick(held); cover.ticks++;
        d.olog = d.olog.map((l) => l.replace(/^s3 /, 's2 '));
        for (const l of d.olog) {
          const m = /^p3 #(\d+) /.exec(l);
          if (m && +m[1] === 0x372) cover.hits++;
          else if (m && [0x2dd, 0x2e6, 0x2e7, 0x2eb, 0x2ee].includes(+m[1])) cover.horns++;
          else if (/^r #880 /.test(l)) cover.pitch++;
          else if (/^p2 #(884|885|886|887|888)$/.test(l)) cover.shifts++;
        }
        for (const l of d.olog) if (l.startsWith('fxp burst')) cover.bursts++;
        if (d.t === 1) cover.frame0++;
        compare();
      };
      const sc = 1 / dt;
      const run = (n, held = 0) => { for (let t = 0; t < Math.round(n * sc); t++) step(typeof held === 'function' ? held(t) : held); };
      const turn = (ph, amp = 0.014) => (t) => amp * Math.sin(t * dt * 0.05 + ph);
      const startRoutes = () => {
        const spec = { AMBU: [0.45, 0], SPD0: [0.3, 1], SPD1: [0.35, 2], SPD2: [0.25, 3], PCAR: [0.4, 4] };
        for (const i of d.cars) { const [v, ph] = spec[names(i)]; d.route.set(i, { v, turn: turn(ph), paused: false }); d.flagsBoth(i, 1, 0); }
      };
      const FAR = [600, 40, 600];
      const pepAhead = (i, dist, side, up = 0) => {
        const m = W.records[i].m, r = W.records[i];
        const p = [r.x + m[8] * dist + m[0] * side, r.y + up, r.z + m[10] * dist + m[2] * side];
        d.placePepper(p[0], p[1], p[2], 0);
      };
      const pepAway = () => d.placePepper(FAR[0], FAR[1], FAR[2], 0);
      return { d, W, mem, names, step, run, startRoutes, pepAhead, pepAway, sc, A, gl };
    };

    /** the scenario (full = all phases; short = the free drive + the Pepper obstacles, for the other eras' attach sets) */
    const scenario = (S, dtLabel, full) => {
      const { d, W, run, startRoutes, pepAhead, pepAway, names } = S;
      const dt = d.dt;
      const id = (n) => d.idx(n);
      const has = (n) => id(n) >= 0 && d.cars.includes(id(n));
      const R = (n) => W.records[id(n)];
      const varOf = (n) => d.pnode(id(n), 'speeder').var;
      const bits = (n, set, clear = 0) => d.setVar(varOf(n), (d.getVar(varOf(n)) | set) & ~clear);
      pepAway();
      startRoutes();
      // P0: the cars drive their routes: tick 0 is the first frame (straight onto the ground), then the pitch easing, the wheels, the engine loops at the car
      run(160);
      // P1: Pepper in the road ahead (an obstacle within 25.28 units, radius 4): horn once, crash sound every tick, burst once, the car stops and falls apart; Pepper leaves, the car recovers
      for (const [n, dist, side, ticks] of [['AMBU', 16, 0, 30], ['SPD0', 24, 2.5, 25], ['PCAR', 12, -1, 25], ['SPD1', 30, 0, 12], ['SPD2', 20, 7.5, 12]]) {
        if (!has(n)) continue;
        pepAhead(id(n), dist, side);
        run(ticks);
        pepAway();
        run(15);
        if (W.records[id(n)].flags & 0x8000) d.flagsBoth(id(n), 0, 0x8000);    // the brick effect's end (stand-in)
        run(25);
      }
      if (!full) return;
      // P2: a car Pepper drives (var bit 0x20000000, parked) in the road of an AI car: the obstacle table scan finds it (FUN_004239b3 of its first node)
      bits('SPD2', 0x20000000); d.route.get(id('SPD2')).paused = true;
      { const r = R('SPD2'); d.placeRec(id('PCAR'), r.x - r.m[8] * 14 + r.m[0] * 1.37, r.y, r.z - r.m[10] * 14 + r.m[2] * 1.37, r.ry + 0.07); }
      { const h0 = cover.hits; run(20); cover.playerHit += cover.hits - h0; }
      d.flagsBoth(id('PCAR'), 0, 0x8000); run(20);
      bits('SPD2', 0, 0x20000000); d.route.get(id('SPD2')).paused = false; run(30);
      // P3: Pepper drives SPD1 (var 0x30000000, flag 1): Shift = a random horn (the scripted random source), the engine revs with the throttle keys (0xa3) and drops back to idle
      bits('SPD1', 0x30000000); d.route.get(id('SPD1')).v = 0.7;
      run(220, (t) => (Math.floor(t * dt / 55) % 2 === 0 ? B.SPACE : 0) | ((t * dt) % 11 === 0 ? B.SHIFT : 0));
      // he gets out (0x10000000 off): in view the car just stays; out of view for 300 ticks it goes back to where it was when he took it
      bits('SPD1', 0, 0x10000000); d.route.get(id('SPD1')).paused = true; run(40);
      d.flagsBoth(id('SPD1'), 0, 1); run(330); d.flagsBoth(id('SPD1'), 1, 0);
      bits('SPD1', 0, 0x20000000); d.route.get(id('SPD1')).paused = false; d.route.get(id('SPD1')).v = 0.35; run(40);
      // a car Pepper drives that is flagged stopped (0x2000): with him in it the flag is cleared, without him the AI branch runs
      bits('SPD0', 0x20000000); d.flagsBoth(id('SPD0'), 0x2000, 0); run(10);
      bits('SPD0', 0x10000000); run(10); bits('SPD0', 0, 0x30000000); d.flagsBoth(id('SPD0'), 0, 0x2000); run(10);
      // P4: the drivers get out of their cars (bit 8 of the car's var: the in-car test (var & 8) == 0 fails) and back in
      for (const n of ['AMBU', 'SPD1', 'SPD0']) { bits(n, 8); run(25); bits(n, 0, 8); run(15); }
      // the destroy hooks (FUN_005382fb: engine loop off, Pepper's engine off), called for every car: the sound calls
      for (const n of ['AMBU', 'SPD0', 'SPD1', 'SPD2', 'PCAR']) {
        d.psnd.length = 0; d.emu.log = [];
        d.emu.cpu.steps = 0; d.emu.cpu.call(0x5382fb, [RECORDS_BASE + id(n) * REC, d.onode(id(n), CTOR_CAR)], { maxSteps: 1_000_000 });
        d.pnode(id(n), 'speeder').destroy(W, R(n));
        d.olog = d.emu.log.map((l) => l.replace(/^s3 /, 's2 '));
        d.sounds();
      }
      void names; void dtLabel;
    };
    const finish = (d, dtLabel) => {
      for (const k of Object.keys(d.axle)) cover['axle_' + k] = (cover['axle_' + k] ?? 0) + d.axle[k];
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a2, n] of d.emu.unhooked) unhooked.set(a2, (unhooked.get(a2) ?? 0) + n);
      for (const [i2, e] of d.deviations) { const q = devs.get(i2); if (q) q.count += e.count; else devs.set(i2, { ...e }); }
    };
    try {
      for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
        const S = session(`speeder ${dtLabel}`, 2, dt, sm, 99);
        scenario(S, dtLabel, dtLabel !== 'dt0.5 sync');
        finish(S.d, dtLabel);
      }
      // the other eras' attach sets (different gates / controller flags / start nodes: nodes 30 (the hologram era 0 variant), 52 (era 3), 61 (era 4)), free-running and the sync mode at dt 1 / 0.5 on the short script
      for (const [node, dt, sm] of [[30, 1, false], [52, 0.5, true], [61, 1, false]]) {
        const label = `speeder node${node} dt${dt}${sm ? ' sync' : ''}`;
        const S = session(label, node, dt, sm, 7 + node);
        scenario(S, label, false);
        finish(S.d, label);
      }
    } finally { Math.random = realRandom; }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
export default { ...suite, run: (ctx) => withCdHeap(() => suite.run(ctx)) };
