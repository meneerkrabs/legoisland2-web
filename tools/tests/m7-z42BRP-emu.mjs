import { createBrpOracle, runZoneLoop, compareState, compareLogs, teleportPepper, portTick, restartOriginal } from '../lib/m7-z42BRP-emu.mjs';
import { loadExe } from '../lib/engine-load.mjs';
import { ZoneLoop, PepBrpNode, stateOf, runCamera } from '../../src/zones/z42BRP/nodes.ts';
import { Phase2Bot } from '../../src/zones/z42BRP/bot.ts';
import { PLAN1, PLAN1_DT05 } from '../../src/zones/z42BRP/bot-plan.ts';
import { ROOF_PLANS } from '../../src/zones/z42BRP/bot-plan-roof.ts';
import {
  VAR, REC, SND, FLOAT_CONSTANTS, readFloat, scoreOf, medalOf, RESULT_LINES, MEDAL_TEXT, clockText, SOUNDS_2D, SOUNDS_3D, MEDAL_GOLD, MEDAL_SILVER, writeResult,
} from '../../src/zones/z42BRP/rules.ts';
import { B } from '../../src/game/input.ts';

// z42BRP, differential test (docs/re/m6/z42BRP.md, section "Differential test (WP-VERIFY)"): the ORIGINAL zone code of the executable (set-up FUN_00820f4e with the six
// constructors, the six update functions 0x826b40 / 0x822ba8 / 0x821704 / 0x825850 / 0x824c80 / 0x8243e5, the zone loop FUN_0081fd64 with its clock / second help / end
// sequence / score) runs in the x86 emulation (tools/lib/m7-z42BRP-emu.mjs) next to the TypeScript port from the same state with the same input; after every tick the records
// (matrices, flags), the nodes' fields, the zone's globals, the variables, the camera, the animation instances and the ordered sound / speech / letterbox / cutscene events agree.
// Every scenario runs at dt = 1 (30 Hz, the port's step now) and dt = 0.5 (60 Hz, the step it will move to; DAT_008b1718 in the original, `world.dt` in the port).

const LEFT = B.LEFT, RIGHT = B.RIGHT, UP = B.UP, DOWN = B.DOWN, ALT = B.ALT, SPACE = B.SPACE;

function rngOf(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
/** random held buttons that change now and then (a key stays down for a few ticks like a human's) */
function fuzzKeys(seed, mix = {}) {
  const r = rngOf(seed);
  let cur = 0, left = 0;
  const pL = mix.left ?? 0.45, pR = mix.right ?? 0.15, pU = mix.up ?? 0, pD = mix.down ?? 0, pA = mix.alt ?? 0.2, pS = mix.space ?? 0, len = mix.len ?? 12;
  return () => {
    if (left-- <= 0) {
      left = 1 + Math.floor(r() * len);
      cur = 0;
      const d = r();
      if (d < pL) cur |= LEFT; else if (d < pL + pR) cur |= RIGHT;
      if (r() < pU) cur |= UP;
      if (r() < pD) cur |= DOWN;
      if (r() < pA) cur |= ALT;
      if (r() < pS) cur |= SPACE;
    }
    return cur;
  };
}

export default {
  name: 'm7-z42BRP-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 30;
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const pe = loadExe(ctx.dataRoot);
    const cov = new Set(), cov05 = new Set(), cov1 = new Set();
    const known = { T1a: [] };
    let maxUlps = 0, ticksTotal = 0, extra3 = [];
    const t0 = Date.now();

    // ---- what the scenarios visited (printed in the notes; the scenarios assert the interesting ones)
    const observe = (E, prev) => {
      const { S, P, mem } = E;
      const covAll = cov;
      const cov_ = { add: (k) => { covAll.add(k); (E.dt === 1 ? cov1 : cov05).add(k); } };
      const n = S.pepbrp, top = S.peptop, bs = S.brickster;
      const ph = P.vars.get(VAR.PHASE);
      if (ph === 1 && n) {
        cov_.add(n.air ? 'run.air' : 'run.ground'); if (n.hold > 0) cov_.add('run.hold');
        if (n.sw1) cov_.add('run.sw1'); if (n.sw2) cov_.add('run.sw2'); if (n.crumble) cov_.add('run.crumble'); if (n.arc) cov_.add('run.arc'); if (n.lift) cov_.add('run.lift');
        if (n.omega < 0) cov_.add('run.left'); if (n.omega > 0) cov_.add('run.right'); if (n.facing !== n.prevFacing) cov_.add('run.turn');
        if (S.restarts > prev.restarts) cov_.add('run.restart'); if (n.hold2 > 0) cov_.add('run.hold2');
        if (n.angle < n.prevAngle && n.angle > 0 && n.prevAngle < 0.5) cov_.add('run.wrap');
        if (E.P.records[REC.BRI2].y < E.P.records[REC.BRI2].m[13] + 1 && n.sw1) cov_.add('run.bri2');
      }
      if (ph === 2 && top) {
        if (top.dir >= 0) cov_.add('roof.dir' + top.dir); if (S.knock) cov_.add('roof.knock'); if (top.flying) cov_.add('roof.pizza');
        if (top.myHits > prev.hits) cov_.add('roof.hit' + top.myHits); if (top.fall > 0) cov_.add('roof.fall'); if (S.respawn) cov_.add('roof.respawn');
        if (S.falls > prev.falls) cov_.add('roof.fell'); if (S.endState > 0) cov_.add('end.state' + S.endState); if (S.endTimer > 0) cov_.add('end.timer');
        if (bs) { cov_.add('boss.idx' + bs.idx); cov_.add(bs.going ? 'boss.going' : 'boss.back'); cov_.add('boss.period' + bs.period); if (bs.reacting) cov_.add('boss.react'); }
        for (const b of S.bots) { if (b.timer < 0) cov_.add('bot.march'); if (b.timer === 90) cov_.add('bot.respawn'); if (b.timer > 0 && b.timer < 90) cov_.add('bot.wait'); }
        const zt = S.zonetop; if (zt && zt.falling >= 0) cov_.add('floor.row' + zt.falling);
        if (zt && zt.nextRow === 0 && zt.timer === 0 && prev.nextRow === 4) cov_.add('floor.wrap');
      }
      if (P.vars.get(VAR.DOOR) === 1) cov_.add('door.closing');
      if (E.cutP.active()) cov_.add('end.cutscene');
    };

    /**
     * one scenario: `hfn(t, E)` gives the held buttons of tick t; every tick the original (E.pass: the six node functions natively, chain of the 96 records) and the port tick, then
     * everything is compared. `before(t, E)` may change state in both worlds (variables, teleports). Returns false after the first failing tick.
     */
    // the 3D sound handles: the original loads one handle per call site (DAT_05d5f5xx), the port picks a `voice` for it: the mapping (sound id, voice) <-> handle must be one to one
    const voiceMap = new Map(), handleMap = new Map();
    const noteVoices = (E) => {
      if (E.vO.length !== E.vP.length) return;
      E.vO.forEach(([id, h], i) => {
        const k = `${E.vP[i][0]}:${E.vP[i][1]}`;
        (voiceMap.get(k) ?? voiceMap.set(k, new Set()).get(k)).add(h);
        (handleMap.get(`${E.dt}:${E.vO[i][0]}:${h}`) ?? handleMap.set(`${E.dt}:${E.vO[i][0]}:${h}`, new Set()).get(`${E.dt}:${E.vO[i][0]}:${h}`)).add(k);
      });
    };
    const secMs = {};
    const lock = (E, hfn, n, label, o = {}) => {
      const tl = Date.now(), key = label.split(' ').slice(0, 2).join(' ');
      try { return lock0(E, hfn, n, label, o); } finally { secMs[key] = (secMs[key] ?? 0) + Date.now() - tl; }
    };
    const lock0 = (E, hfn, n, label, o = {}) => {
      const prev = { restarts: E.S.restarts, hits: E.S.peptop?.myHits ?? 0, falls: E.S.falls, nextRow: 0 };
      let held0 = E.P.input.held;
      for (let t = 0; t < n; t++) {
        if (o.before) o.before(t, E);
        const h = hfn(t, E);
        if (h === null) return t;
        E.setInput(h, (h ^ held0) & h); held0 = h;
        const oe = E.pass();
        const { log } = portTick(E, ZoneLoop, null, h);
        const c = compareState(E, `${label} t${t}`, { noCamera: o.noCamera, known: o.known });
        const l = compareLogs(`${label} t${t}`, log, oe);
        noteVoices(E);
        checked += c.checks + l.checks; ticksTotal++;
        maxUlps = Math.max(maxUlps, c.maxUlps);
        for (const k of c.known) known.T1a.push(k);
        if (c.bad.length || l.bad.length) { for (const m of [...c.bad.slice(0, 4), ...l.bad.slice(0, 2)]) bad(m); return -1; }
        observe(E, prev);
        prev.restarts = E.S.restarts; prev.hits = E.S.peptop?.myHits ?? 0; prev.falls = E.S.falls; prev.nextRow = E.S.zonetop?.nextRow ?? 0;
        o.after?.(t, E);
      }
      return n;
    };
    const planSeq = (plan, dt) => { const a = []; for (let i = 0; i < 16 / dt; i++) a.push(0); for (const [m, k] of plan) for (let i = 0; i < k; i++) a.push(m); return a; };
    const fresh = (dt, seed = 1, o = {}) => createBrpOracle(ctx, { dt, seed, ...o });
    const setPhase2 = (E) => { E.P.vars.set(VAR.PHASE, 2); E.O.vars.set(VAR.PHASE, 2); };
    const setVar = (E, v, x) => { E.P.vars.set(v, x); E.O.vars.set(v, x); };

    try {
      // ============================================================ 1. constants: the port's float constants are the executable's float32 values
      {
        let exact = 0;
        for (const [name, va, v] of FLOAT_CONSTANTS) {
          const e = readFloat(pe, va);
          ok(Math.fround(v) === e && v === e, `constant ${name} @ 0x${va.toString(16)}: port ${v}, executable ${e} (float32 ${Math.fround(v)})`);
          if (v === e) exact++;
        }
        notes.push(`constants: ${exact} / ${FLOAT_CONSTANTS.length} float constants of rules.ts equal the executable's float32 values exactly`);
      }

      // ============================================================ 2. construction: FUN_00820f4e + the six constructors natively against prepareWorld
      for (const dt of [1, 0.5]) {
        const E = fresh(dt);
        const c = compareState(E, `construct dt${dt}`, { noCamera: true });
        checked += c.checks;
        for (const m of c.bad) bad(m);
        const L = E.attaches.map((a) => [a.record, a.ctor, a.pos, a.var, a.mask, a.value]);
        const port = E.P.records.map((r) => r.ctrl?.nodes ?? []);
        ok(L.length === 9 && L.every((a) => a[3] === VAR.PHASE && a[4] === 0x7fff), `the original attaches 9 nodes, all gated on 0xfa: ${JSON.stringify(L)}`);
        const want = [[91, 0x82714a, 0], [90, 0x823f08, 0], [90, 0x8224ba, 1], [14, 0x826516, 0], [14, 0x825378, 1], [92, 0x824a02, 0], [93, 0x824a02, 0], [94, 0x824a02, 0], [95, 0x824a02, 0]];
        ok(JSON.stringify(L.map((a) => [a[0], a[1], a[2]])) === JSON.stringify(want), `attach order of the original: ${JSON.stringify(L.map((a) => [a[0], a[1].toString(16), a[2]]))}`);
        const kinds = (rs) => rs.map((nodes, i) => nodes.length ? `${i}:${nodes.map((n) => n.kind).join('+')}` : '').filter(Boolean).join(' ');
        const kindsO = E.nodes.reduce((m, n) => { (m[n.rec.index] ??= []).push(n.kind); return m; }, {});
        ok(Object.entries(kindsO).map(([i, k]) => `${i}:${k.join('+')}`).join(' ') === kinds(port).split(' ').sort((a, b) => parseInt(a) - parseInt(b)).join(' '), `node chains per record: original ${JSON.stringify(kindsO)} port ${kinds(port)}`);
        // the sound loader FUN_00820b70 (native): the 2D / 3D ids it loads
        const ids2 = new Set(), ids3 = new Set();
        for (const [, h] of E.soundHandles ?? E.handles) (h.kind === '2d' ? ids2 : ids3).add(h.id);
        ok(JSON.stringify([...ids2].sort((a, b) => a - b)) === JSON.stringify([...SOUNDS_2D].sort((a, b) => a - b)), `2D sound ids of FUN_00820b70: ${[...ids2].map((x) => x.toString(16))}`);
        ok(SOUNDS_3D.every((x) => ids3.has(x)), `3D sound ids of FUN_00820b70: ${[...ids3].map((x) => x.toString(16))}`);
        extra3 = [...ids3].filter((x) => !SOUNDS_3D.includes(x));
        // the intro camera (mode 1 draws FUN_008229b0 every frame) from the start state
        E.cpu.steps = 0; E.cpu.call(0x8229b0, [E.recPtr(REC.PEPP)]);
        runCamera(E.P, E.P.records[REC.PEPP]);
        const cc = compareState(E, `intro camera dt${dt}`, { records: [], nodes: new Set() });
        checked += cc.checks; for (const m of cc.bad.filter((x) => x.includes('camera'))) bad(m);
      }
      notes.push('construction: 96 records, 9 constructed nodes (attach order, gates, node fields, globals, animation clips), sound loader ids and the intro camera agree at dt 1 and 0.5');

      // ============================================================ 3. the side run: the recorded plan (the original's exact probe), jumps, switch 1, the crumbling / arc platforms, restarts
      {
        const E = fresh(1);
        PepBrpNode.widenTrigger = false;
        const seq = planSeq(PLAN1, 1);
        const n = lock(E, (t) => (t < 844 ? seq[t] : null), 2000, 'run dt1 plan');
        ok(n === 844, `dt1 plan: ${n} ticks in lock step (up to the tick before the switch-2 landing)`);
        // continue with random keys from the end of the plan
        const f = fuzzKeys(11, { left: 0.4, right: 0.3, alt: 0.3 });
        lock(E, () => f(), 600, 'run dt1 after plan');
        PepBrpNode.widenTrigger = true;
        notes.push(`side run dt=1: the plan up to tick 844 (sw1 ${cov.has('run.sw1')}) + 600 random ticks; widened probe off (the original's own probe)`);
      }
      for (const [seed, label] of [[1, 'fuzz-a'], [2, 'fuzz-b'], [3, 'fuzz-c']]) {
        for (const dt of [1, 0.5]) {
          const E = fresh(dt, seed);
          PepBrpNode.widenTrigger = false;
          const f = fuzzKeys(100 + seed, { left: 0.5, right: 0.15, alt: 0.25 });
          lock(E, () => f(), Math.round(900 / dt), `run ${label} dt${dt}`);
          PepBrpNode.widenTrigger = true;
        }
      }
      // staged: Pepper put on the tower at heights of the switches / platforms, then random keys (the original's probes for sw1, sw2, BRI7, BRI5, the lift at every stage)
      for (const dt of [1, 0.5]) {
        const stages = [[1.45, 57.5, 'sw1'], [2.5216, 84.8, 'sw2 region'], [1.2, 70, 'crumble / arc region'], [-0.5, 100, 'upper tower']];
        for (const [k, [a, y, name]] of stages.entries()) {
          const E = fresh(dt, 5 + k);
          PepBrpNode.widenTrigger = false;
          const f = fuzzKeys(300 + k, { left: 0.35, right: 0.35, alt: 0.3 });
          lock(E, () => f(), Math.round(400 / dt), `stage ${name} dt${dt}`, {
            before: (t, EE) => { if (t === 0) { EE.mem.wf32(EE.node('pepbrp').node + 0x94, 0); EE.S.pepbrp.hold = 0; teleportPepper(EE, a, y); } },
          });
          PepBrpNode.widenTrigger = true;
        }
      }
      // the lift: Pepper placed on BRI8 (the end of the side run): the lift rises, the phase variable becomes 2, the roof starts
      for (const dt of [1, 0.5]) {
        const E = fresh(dt, 9);
        PepBrpNode.widenTrigger = false;
        const bri8 = E.P.records[REC.BRI8];
        const f = fuzzKeys(77, { left: 0.2, right: 0.2, up: 0.2, down: 0.2, space: 0.15, alt: 0.1 });
        lock(E, (t) => (t < 4 / dt ? 0 : f()), Math.round(700 / dt), `lift dt${dt}`, {
          before: (t, EE) => { if (t === 0) { EE.mem.wf32(EE.node('pepbrp').node + 0x94, 0); EE.S.pepbrp.hold = 0; teleportPepper(EE, Math.atan2(bri8.x, bri8.z) + 0.04, bri8.y + 1.2); } },
        });
        ok(E.P.vars.get(VAR.PHASE) === 2 && E.O.vars.get(VAR.PHASE) === 2, `lift dt${dt}: both worlds reach phase 2 (${E.P.vars.get(VAR.PHASE)} / ${E.O.vars.get(VAR.PHASE)})`);
        PepBrpNode.widenTrigger = true;
      }

      // ============================================================ 4. the roof: random keys (walls, falls, bot knock-backs, pizza throws), the floor's collapse, the door
      for (const dt of [1, 0.5]) {
        for (const seed of [1, 2, 3, 4]) {
          const E = fresh(dt, seed);
          const f = fuzzKeys(900 + seed, { left: 0.25, right: 0.25, up: 0.2, down: 0.2, space: 0.2, alt: 0, len: 10 });
          lock(E, (t) => (t < 4 / dt ? 0 : f()), Math.round(1500 / dt), `roof fuzz${seed} dt${dt}`, {
            before: (t, EE) => { if (t === Math.round(3 / dt)) setPhase2(EE); if (t === Math.round(900 / dt)) setVar(EE, VAR.DOOR, 1); if (t === Math.round(1000 / dt)) setVar(EE, VAR.DOOR, 2); if (t === Math.round(1100 / dt)) setVar(EE, VAR.DOOR, 3); },
          });
        }
      }

      // ============================================================ 5. the roof with the recorded look-ahead bot games: pizza hits on Brickster, the three hits end the game (end state,
      //            letterbox, the scripted end cutscene), more ticks after the end
      const roofGame = (key, dt, seed) => {
        const E = fresh(dt, seed);
        const plan = ROOF_PLANS[key];
        ok(!!plan, `a recorded roof game ${key} exists (node tools/lib/z42brp-roofplan.mjs --write)`);
        if (!plan) return;
        const m = []; for (const [mask, k] of plan) for (let i = 0; i < k; i++) m.push(mask);
        lock(E, (t) => (t < 3 ? 0 : t - 3 < m.length ? m[t - 3] : null), 5000, `roof game ${key}`, { before: (t, EE) => { if (t === 2) setPhase2(EE); } });
        ok(E.S.endState >= 1 && E.S.hits === 3, `roof game ${key}: the game ended (end state ${E.S.endState}, hits ${E.S.hits})`);
      };
      roofGame('d1s1', 1, 1); roofGame('d1s2', 1, 2); roofGame('d05s1', 0.5, 1);

      // ============================================================ 6. T1a: switch 2, the original's own probe against the lattice of Pepper's angle steps (docs/re/gaps.md T1a)
      {
        const F = Math.fround, DELTA = 0.019198518246412277;
        // 6a. the window of the original's probe (FUN_00441270: radius 0.16, skin 0.4, from y + 2.4 down 80) at the tower's circle, from the oracle world's collision
        const Ew = fresh(1);
        const R = Ew.S.pepbrp.R, O = Ew.O;
        const probe = (a, y, radius = 0.15999999642372131) => {
          const x = F(F(Math.sin(a)) * R), z = F(F(Math.cos(a)) * R);
          return O.col.sweep(O.records[REC.PEPP], [x, F(y + 2.4000000953674316), z], [0, -80, 0], 3, radius, 0.4000000059604645)?.rec.index ?? -1;
        };
        const windowAt = (y, radius) => { let lo = null, hi = null; for (let a = 2.45; a < 2.6; a += 1e-5) if (probe(a, y, radius) === REC.SWIC2) { if (lo === null) lo = a; hi = a; } return [lo, hi]; };
        const [wlo, whi] = windowAt(84.8);
        notes.push(`T1a: the original's probe of switch 2 with Pepper on the ramp (y 84.8) hits for angles ${wlo.toFixed(5)} .. ${whi.toFixed(5)} (${(whi - wlo).toFixed(5)} rad wide; the docs say 0.0066); the port's widened probe (radius 0.16 + 0.5 * 0.0192 * R = ${(0.16 + 0.5 * DELTA * R).toFixed(3)}) hits ${windowAt(84.8, 0.16 + 0.5 * DELTA * R).map((v) => v.toFixed(5)).join(' .. ')}`);
        ok(whi - wlo > 0.0060 && whi - wlo < 0.0075, `switch 2's window at ground level is ${(whi - wlo).toFixed(5)} rad (docs: 0.0066)`);
        // 6b. the lattice of the plan at dt = 1 on that lap: the step positions L0 = 2.53218, L1 = 2.51298 (angle + 2 pi): both outside the window; the landing tick of the plan's last jump
        const L0 = 2.5321 + 0.0001, planAngle = -3.7510101795196533 + 2 * Math.PI;
        ok(Math.abs(planAngle - 2.532183) < 1e-4, `lattice point L0 ${planAngle}`);
        ok(!(planAngle >= wlo && planAngle <= whi) && !(planAngle - DELTA >= wlo && planAngle - DELTA <= whi), `dt=1: neither L0 (${planAngle.toFixed(5)}) nor L1 (${(planAngle - DELTA).toFixed(5)}) lies in [${wlo.toFixed(5)}, ${whi.toFixed(5)}]`);
        // 6c. the landing overshoot (the probe sees a Pepper whose y is still below the ground in the landing tick): L1 hits for ray starts y in a band, the plan's landing tick has y_air 84.533
        const Ep = fresh(1);
        PepBrpNode.widenTrigger = false;
        const seq = planSeq(PLAN1, 1);
        lock(Ep, (t) => (t < 845 ? seq[t] : null), 2000, 'T1a plan landing');
        const yAirLanding = Ep.S.pepbrp.yAir;
        let band = [null, null];
        for (let y = 83.5; y < 85.5; y += 0.001) if (probe(planAngle - DELTA, y) === REC.SWIC2) { if (band[0] === null) band[0] = y; band[1] = y; }
        notes.push(`T1a dt=1: landing overshoot: L1 hits for ray starts y ${band[0]?.toFixed(3)} .. ${band[1]?.toFixed(3)}, the plan's landing tick has y_air ${yAirLanding.toFixed(3)} (ground 84.80)`);
        ok(band[0] !== null && yAirLanding > band[1], `dt=1: y_air at the landing (${yAirLanding.toFixed(3)}) is above the band ${band[0]} .. ${band[1]} in which L1 would hit`);
        ok(Ep.S.pepbrp.sw2 === false && Ep.mem.r8(Ep.node('pepbrp').node + 0x8b) === 0, 'dt=1: the plan does not trigger switch 2 in the original nor in the port (widened probe off)');
        PepBrpNode.widenTrigger = true;
        // 6d. walking through the window at 16 phases of the lattice: original (emulated) vs port with the original's probe vs port with the widened probe; dt = 1 and 0.5
        const L0n = -3.7510101795196533;
        const table = {};
        for (const dt of [1, 0.5]) {
          const E = fresh(dt);
          const sv = E.save();
          const node = E.node('pepbrp').node;
          const res = { orig: [], widened: [] };
          for (const widen of [false, true]) {
            PepBrpNode.widenTrigger = widen;
            for (let k = 0; k < 16; k++) {
              E.load(sv);
              E.mem.wf32(node + 0x94, 0); E.S.pepbrp.hold = 0;
              teleportPepper(E, L0n + 12 * DELTA + DELTA * k / 16, 84.8);
              let first = -1, firstP = -1;
              const ph = `T1a dt${dt} phase ${k}/16 ${widen ? 'widened' : 'exact'}`;
              const nn = Math.round(40 / dt);
              let diverged = false;
              for (let t = 0; t < nn; t++) {
                const h = t < 2 ? 0 : LEFT;
                E.setInput(h, 0);
                const oe = E.pass();
                const { log } = portTick(E, ZoneLoop, null, h);
                if (first < 0 && E.mem.r8(node + 0x8b)) first = t;
                if (firstP < 0 && E.S.pepbrp.sw2) firstP = t;
                if (diverged) continue;
                const c = compareState(E, `${ph} t${t}`, { noCamera: true, known: widen && dt > 0.5 ? new Set(['node pepbrp.sw2']) : undefined });
                const l = compareLogs(`${ph} t${t}`, log, oe);
                checked += c.checks + l.checks; ticksTotal++;
                if (c.known.length) { known.T1a.push(c.known[0]); diverged = true; continue; }
                if (c.bad.length || l.bad.length) { if (widen && dt > 0.5 && firstP >= 0 && first < 0) { known.T1a.push(`${ph}: port ${c.bad[0] ?? l.bad[0]}`.slice(0, 200)); diverged = true; continue; } for (const m of [...c.bad.slice(0, 3), ...l.bad.slice(0, 2)]) bad(m); break; }
              }
              (widen ? res.widened : res.orig).push([first, firstP]);
              if (!widen) ok(first === firstP, `${ph}: original hits at tick ${first}, the port at ${firstP}`);
              else if (dt <= 0.5) ok(first === firstP, `${ph}: dt 0.5 needs no widening: original ${first}, port ${firstP}`);
              else ok(firstP >= 0, `${ph}: the widened probe of the port hits (tick ${firstP}; the original: ${first})`);
            }
          }
          PepBrpNode.widenTrigger = true;
          table[dt] = res;
          const hitsO = res.orig.filter(([f]) => f >= 0).length;
          const hitsW = res.widened.filter(([, f]) => f >= 0).length;
          notes.push(`T1a dt=${dt}: the original hits switch 2 for ${hitsO} of 16 phases of the lattice (real lattice, phase 0: ${res.orig[0][0] >= 0 ? 'HIT at tick ' + res.orig[0][0] : 'miss'}); the port's widened probe (active only for dt > 0.5) hits for ${hitsW} of 16 (phase 0: ${res.widened[0][1] >= 0 ? 'hit' : 'miss'})`);
        }
        ok(table[1].orig[0][0] < 0, 'T1a: dt = 1, the real lattice (phase 0): the original does NOT hit switch 2');
        ok(table[0.5].orig[0][0] >= 0, 'T1a: dt = 0.5, the real lattice (phase 0): the original hits switch 2 (no widening needed)');
        ok(table[1].widened.every(([, f]) => f >= 0), 'T1a: dt = 1: the port widened probe hits at every phase (documented deviation)');
        ok(table[1].widened[0][0] < 0, 'T1a: dt = 1, widened: the original misses where the port hits (KNOWN DEVIATION, counted)');
        const ph0 = table[1].widened.filter(([f, p]) => f < 0 && p >= 0).length;
        notes.push(`T1a KNOWN DEVIATION (dt = 1 only): ${ph0} of 16 lattice phases where the port's widened probe triggers switch 2 and the original's does not; ${known.T1a.length} compared items listed as known`);
      }

      // ============================================================ 7. the zone loop FUN_0081fd64 natively (modes 7 / 0 / 1 / 9 / 2 / 10 / 4, the game clock, the second help, the end sequence, the score) with the port in step
      const expandPlan = (plan) => { const m = []; for (const [mask, k] of plan) for (let i = 0; i < k; i++) m.push(mask); return m; };
      /**
       * `masks(tick)` = the held buttons of the tick about to run; `phase2At` = tick count after which the phase variable is set to 2 in both worlds (null: the game does it).
       * Returns what happened: the modes with the tick count at each change, the tick of the banner, the first result frame's score ...
       */
      const loopGame = (label, dt, masks, phase2At, seed = 1, sweep = null, startedFromMenu = 0) => {
        const E = fresh(dt, seed, { loop: true, startedFromMenu });
        const loop = new ZoneLoop();
        E.mem.w32(0x983f94, 1); for (const v of [E.O.vars, E.P.vars]) { v.set(5, 67); v.set(0x59, 67); }   // the story node the loop compares (var 5 = var 0x59): both worlds
        const res = { E, modes: [], pendingAt: -1, mode10At: -1, bannerAt: -1, mode4At: -1, tookHelp2: [], frames: 0, resultFrames: 0, fail: false, frameAtMode4: -1, pre: null, results: 0, medals: new Set() };
        const prev = { restarts: 0, hits: 0, falls: 0, nextRow: 0 };
        const frameFail = (c) => { for (const m of c.bad.slice(0, 4)) bad(m); res.fail = true; };
        const info = runZoneLoop(E, loop, {
          held(i) {
            res.frames = i.frame;
            if (i.mode === 10 && res.mode10At < 0) { res.mode10At = i.tick; res.tookHelp2.push(loop.takeHelp2()); }
            if (i.mode === 4 && res.mode4At < 0) { res.mode4At = i.tick; res.frameAtMode4 = i.frame; res.clock0 = E.mem.r32(0x5d5f4c4); }
            if (i.mode === 4) {
              const idx = i.frame - res.frameAtMode4 - 1;
              if (sweep && idx >= 0 && idx < sweep.length) { E.mem.w32(0x5d5f4c4, sweep[idx]); E.mem.w32(0x5d5f4c0, 0); E.O.vars.set(VAR.HISCORE, 0); E.O.vars.set(VAR.TROPHY, 0); }
              res.pre = [E.O.vars.get(VAR.HISCORE), E.O.vars.get(VAR.TROPHY)];
              res.speechFlag = E.mem.r32(0x5d5f4c0);
              return 0;
            }
            if (i.mode === 2) { if (phase2At !== null && i.tick === phase2At && E.P.vars.get(VAR.PHASE) !== 2) setPhase2(E); return masks(i.tick); }
            if (i.mode === 0) return 0;
            return i.frame % 3 === 0 ? 0x10000 : 0;      // intro / help screens (modes 1, 9, 10): a key press now and then
          },
          onTick(i) {
            if (res.fail) return;
            const c = compareState(E, `${label} t${i.tick - 1}`, { skip: new Set(['endTimer']) });
            const l = compareLogs(`${label} t${i.tick - 1}`, i.port, i.orig);
            checked += c.checks + l.checks; ticksTotal++; maxUlps = Math.max(maxUlps, c.maxUlps);
            if (c.bad.length || l.bad.length) { for (const m of [...c.bad.slice(0, 4), ...l.bad.slice(0, 2)]) bad(m); res.fail = true; return; }
            observe(E, prev);
            prev.restarts = E.S.restarts; prev.hits = E.S.peptop?.myHits ?? 0; prev.falls = E.S.falls; prev.nextRow = E.S.zonetop?.nextRow ?? 0;
            if (loop.help2Pending && res.pendingAt < 0) res.pendingAt = i.tick;
            if (i.banner && res.bannerAt < 0) res.bannerAt = i.tick;
          },
          onFrame(i) {
            if (res.fail) return;
            if (i.mode === 4) {
              // FUN_0081fd64 mode 4: the score from the clock, the medal, the texts, the variables and the speech against rules.ts
              const X = E.mem.r32(0x5d5f4c4);
              const score = scoreOf(X), medal = medalOf(score);
              const fake = new Map([[VAR.HISCORE, res.pre[0]], [VAR.TROPHY, res.pre[1]]]);
              writeResult({ get: (v) => fake.get(v), set: (v, x) => fake.set(v, x) }, score);
              const want = [[`Score ${score}`, 0x140, 100], [MEDAL_TEXT[medal], 0x140, 0x96], [RESULT_LINES[medal][0], 0x140, 200], [RESULT_LINES[medal][1], 0x140, 0x140]];
              const got = i.texts.filter((t) => !/^\d\d:\d\d$/.test(t[0]));
              checked += 4;
              if (JSON.stringify(got) !== JSON.stringify(want)) { bad(`${label} result frame ${i.frame} (clock ${X}): texts ${JSON.stringify(got)}, rules.ts ${JSON.stringify(want)}`); res.fail = true; return; }
              if (E.O.vars.get(VAR.HISCORE) !== fake.get(VAR.HISCORE) || E.O.vars.get(VAR.TROPHY) !== fake.get(VAR.TROPHY)) { bad(`${label} result frame (clock ${X}): variables hi-score ${E.O.vars.get(VAR.HISCORE)} / trophy ${E.O.vars.get(VAR.TROPHY)}, rules.ts ${fake.get(VAR.HISCORE)} / ${fake.get(VAR.TROPHY)}`); res.fail = true; return; }
              const wantLog = res.speechFlag === 0 ? [['stopspeech'], ['say', RESULT_LINES[medal][0], RESULT_LINES[medal][1]]] : [];
              if (JSON.stringify(E.log.filter((e) => e[0] === 'say' || e[0] === 'stopspeech')) !== JSON.stringify(wantLog)) { bad(`${label} result frame (clock ${X}): speech ${JSON.stringify(E.log)}, rules.ts ${JSON.stringify(wantLog)}`); res.fail = true; return; }
              res.results++; res.medals.add(medal);
              return;
            }
            if (i.mode === 2 && i.tick > 0) {
              // the clock, the end timer, the draw of the clock text: the loop's tail ran
              const c = compareState(E, `${label} frame ${i.frame}`, { records: [], nodes: new Set(), noCamera: true, loop: true });
              checked += c.checks; for (const m of c.bad.slice(0, 3)) bad(m);
              if (c.bad.length) { res.fail = true; return; }
              const clockText0 = i.texts.find((t) => /^\d\d:\d\d$/.test(t[0]));
              const wantText = E.cutO.active() ? null : clockText(E.S.elapsed);
              ok((clockText0?.[0] ?? null) === wantText && (!clockText0 || (clockText0[1] === 500 && clockText0[2] === 50)), `${label} frame ${i.frame}: clock text ${JSON.stringify(clockText0)}, port ${wantText}`);
            }
          },
          done(i) { return res.fail || i.tick > 20000 || (res.frameAtMode4 > 0 && i.frame > res.frameAtMode4 + (sweep ? sweep.length + 2 : 3)); },
        });
        res.info = info; res.modes = info.modes.map(([f, m]) => m);
        return res;
      };
      // dt = 1: the roof reached by the phase variable (the lift is covered by section 3), the recorded game d1s1
      {
        const m = expandPlan(ROOF_PLANS.d1s1 ?? []);
        const xs = [];
        for (let sec = 50; sec <= 250; sec++) for (const d of [-1, 0, 30, 59]) xs.push(sec * 60 + d);
        const res = loopGame('loop dt1', 1, (t) => (t < 3 ? 0 : m[t - 3] ?? 0), 2, 1, xs);
        const modes = res.modes.join(',');
        ok(/^7,0,1,9,2,10,2,4/.test(modes), `loop dt1: modes ${modes} (expected 7,0,1,9,2,10,2,4: fade in, start, intro, help, play, second help, play, result)`);
        ok(res.pendingAt === 3 && res.mode10At === 3, `loop dt1: the second help comes after the tick that sees the phase variable 2: port ${res.pendingAt}, original mode 10 at tick ${res.mode10At}`);
        ok(res.tookHelp2.length === 1 && res.tookHelp2[0] === true, 'loop dt1: the port asks for the second help exactly once (takeHelp2)');
        ok(res.bannerAt > 0 && res.bannerAt === res.mode4At, `loop dt1: the banner follows the end sequence at the same tick: port ${res.bannerAt}, original mode 4 at tick ${res.mode4At}`);
        ok(res.results >= 2 && res.clock0 === Math.trunc(res.E.S.elapsed), `loop dt1: result frames checked ${res.results}, the clock ${res.clock0} = the port's elapsed ${res.E.S.elapsed}`);
        ok(res.medals.size === 3 && res.results >= xs.length, `loop dt1: score sweep: ${res.results} result frames over the clock range 50 s .. 250 s, medals seen ${[...res.medals].sort().join(',')}`);
        notes.push(`loop dt=1: modes ${modes}, ${res.info.tick} ticks, second help after tick ${res.mode10At}, banner at tick ${res.bannerAt}`);
      }
          // the zone started from the menu (var 0xb != 0): the end sequence runs without the cutscene (FUN_0045c40c does nothing), the banner follows two ticks after the third hit
      {
        const m = expandPlan(ROOF_PLANS.d1s1 ?? []);
        const res = loopGame('loop dt1 menu', 1, (t) => (t < 3 ? 0 : m[t - 3] ?? 0), 2, 1, null, 1);
        ok(res.E.cutO.starts === 0 && res.E.cutP.starts === 0, `menu start: no cutscene (original ${res.E.cutO.starts}, port ${res.E.cutP.starts})`);
        ok(res.bannerAt > 0 && res.bannerAt === res.mode4At, `menu start: banner at tick ${res.bannerAt} (port), original mode 4 at tick ${res.mode4At}`);
      }
      // dt = 0.5: the whole game from the intro: the recorded side run (switch 2 hit with the original's own probe), the lift, the phase change by the zone itself, the roof game
      {
        const m = expandPlan(ROOF_PLANS.f05s1 ?? []);
        ok(m.length > 1000, 'a recorded full game f05s1 exists');
        const res = loopGame('loop dt0.5', 0.5, (t) => m[t] ?? 0, null);
        const modes = res.modes.join(',');
        ok(/^7,0,1,9,2,10,2,4/.test(modes), `loop dt0.5: modes ${modes}`);
        ok(res.pendingAt > 0 && res.pendingAt === res.mode10At, `loop dt0.5: second help after tick ${res.pendingAt} (port) / ${res.mode10At} (original)`);
        ok(res.E.S.pepbrp.lift && res.E.S.pepbrp.sw1 && res.E.S.pepbrp.sw2, `loop dt0.5: the side run was won (sw1 ${res.E.S.pepbrp.sw1}, sw2 ${res.E.S.pepbrp.sw2}, lift ${res.E.S.pepbrp.lift})`);
        ok(res.bannerAt > 0 && res.bannerAt === res.mode4At, `loop dt0.5: banner at tick ${res.bannerAt} (port), original mode 4 at tick ${res.mode4At}`);
        notes.push(`loop dt=0.5: modes ${modes}, ${res.info.tick} ticks, side run won with the original's probe (sw2 at the lattice midpoint), second help after tick ${res.mode10At}, banner at tick ${res.bannerAt}, clock ${res.E.mem.r32(0x5d5f4c4)} (${clockText(res.E.mem.r32(0x5d5f4c4))})`);
      }

      // ============================================================ 8. the pause menu's restart: the original re-initialises the existing nodes in place (the constructors' re-init branches, FUN_00820f4e(0)),
      //            the port starts a fresh run: after a restart the original's side run must behave like a fresh game (records; flame bobbers excluded: they follow the wall clock)
      for (const dt of [1, 0.5]) {
        const E = fresh(dt, 3);
        PepBrpNode.widenTrigger = false;
        const f = fuzzKeys(555, { left: 0.45, right: 0.15, alt: 0.3 });
        lock(E, (t) => (t < 16 / dt ? 0 : f()), Math.round(700 / dt), `restart prelude dt${dt}`);
        const before = { sw1: E.S.pepbrp.sw1, restarts: E.S.restarts, y: E.P.records[REC.PEPP].y };
        restartOriginal(E);
        const F = fresh(dt, 3);
        const H = { ...E, P: F.P, S: F.S, cutP: F.cutP, logP: F.logP, nodes: E.nodes.filter((n) => n.kind === 'zonebrp' || n.kind === 'zonetop') };
        ok(F.P.vars.get(VAR.PHASE) === 1 && E.O.vars.get(VAR.PHASE) === 1, 'restart: both are in phase 1');
        const f2 = fuzzKeys(556, { left: 0.5, right: 0.1, alt: 0.3 });
        let held0 = 0, bad0 = 0;
        const others = F.P.records.map((r) => r.index).filter((i) => ![30, 31, 32, 33].includes(i));
        for (let t = 0; t < Math.round(600 / dt) && !bad0; t++) {
          const h = f2();
          E.setInput(h, (h ^ held0) & h); held0 = h;
          const oe = E.pass();
          const { log } = portTick(H, ZoneLoop, null, h);
          const c = compareState(H, `restart dt${dt} t${t}`, { noCamera: true, records: others, flagMask: 0xfffe, ignoreHiddenMatrix: true, ulps: 2,   // (the original re-computes BRI5's place from the angle: 1 ulp from the scene's value)
            nodes: new Set(['zonebrp', 'zonetop']), skip: new Set(['respawn', 'firstRun', 'knockTimer', 'reset5ec', 'reset5fc', 'reset600', 'firstTop']) });
          const l = compareLogs(`restart dt${dt} t${t}`, log, oe);
          checked += c.checks + l.checks; ticksTotal++;
          if (c.bad.length || l.bad.length) { for (const m of [...c.bad.slice(0, 3), ...l.bad.slice(0, 2)]) bad(m); bad0 = 1; }
        }
        ok(before.restarts > 0 || before.y > 5, `restart dt${dt}: the prelude left the start (y ${before.y.toFixed(1)}, ${before.restarts} falls)`);
        PepBrpNode.widenTrigger = true;
      }
    } catch (e) {
      bad(`crashed: ${e.stack || e}`);
    }
    PepBrpNode.widenTrigger = true;

    notes.push(`coverage at dt=1: ${[...cov1].sort().join(' ')}`);
    notes.push(`coverage at dt=0.5: ${[...cov05].sort().join(' ')}`);
    for (const k of ['run.air', 'run.ground', 'run.hold', 'run.sw1', 'run.sw2', 'run.crumble', 'run.arc', 'run.lift', 'run.restart', 'run.turn', 'roof.dir0', 'roof.dir1', 'roof.dir2', 'roof.dir3', 'roof.knock', 'roof.pizza', 'roof.hit1', 'roof.hit2', 'roof.hit3', 'roof.fall', 'roof.respawn', 'boss.period45', 'boss.period30', 'boss.react', 'bot.march', 'bot.respawn', 'floor.row0', 'door.closing', 'end.state1', 'end.state2', 'end.state3', 'end.cutscene']) { ok(cov1.has(k), `coverage: ${k} reached at dt=1`); }
    for (const k of ['run.air', 'run.sw1', 'run.sw2', 'run.crumble', 'run.arc', 'run.lift', 'roof.knock', 'roof.hit3', 'boss.period30', 'bot.march', 'end.state3']) { ok(cov05.has(k), `coverage: ${k} reached at dt=0.5`); }
    notes.push(`FUN_00820b70 also loads the 3D sounds ${extra3.map((x) => '0x' + x.toString(16))} (no node of the zone plays them)`);
    // handles are numbered per oracle instance: compare within one dt only through the sets of voices per handle
    const multi = [...voiceMap].filter(([, hs]) => hs.size > 1);
    notes.push(`voice map: ${[...voiceMap].map(([k, hs]) => k + '->' + [...hs].map((h) => h.toString(16)).join('/')).sort().join(' ')}`);
    notes.push(`3D sound voices: ${voiceMap.size} (sound id, voice) pairs seen in the port${multi.length ? ', ambiguous: ' + multi.map(([k]) => k).join(' ') : ''}`);
    notes.push(`time by scenario: ${Object.entries(secMs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    notes.push(`${ticksTotal} lock-step ticks, float noise at most ${maxUlps.toFixed(1)} ulps of the original's value, ${Date.now() - t0} ms`);
    return { checked, failures, notes };
  },
};
