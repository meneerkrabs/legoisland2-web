// z09JST differential test, WP-VERIFY coverage (docs/re/m6/z09JST.md "Differential test (WP-VERIFY): coverage"): the original's duel code (FUN_005ce506 with all its helpers, the constructor
// FUN_005d1f64, mfigman, the camera, the popup / end panel code) in the x86 emulation next to the TypeScript port, tick by tick, every scenario at dt = 1 AND dt = 0.5 (the dt goes into
// DAT_008b1718 / DAT_008b171c, the hosted engine advance and the clock of the original, and into `world.dt` of the port), with tolerance 0 (bit for bit; ints / flags / clips /
// calls exactly) and the instruction coverage of the original counted with the emulator's trace hook. What this adds to tools/tests/m6-z09JST-emu.mjs:
//   * dt = 0.5 (the first test ran the original with the image's dt = 1 only);
//   * the states no code sets (0xd, 0x15, 0x1c, 0x1d), reached by writing the state into the node of BOTH sides at several moments of a round (the original's own code then runs the state);
//   * the dead / rare branches (speed < 0 and > 60, precision < 0 / 0, camera modes 2 / 4 / > 0xf, spline freed in mode 0, the z slide of state 6, one-shot rider clip in mode 0, popup 0xd /
//     other, unknown states, both sides at 3 points, variables that must not be lowered), the analogue stick (FUN_005ce506 reads it while no key is held), every medal, charge dithering and all
//     release speeds (hoof classes), a function level compare of FUN_005d1b41 (all frames x speed classes);
//   * the restart path of the constructor (else branch), which the port never runs (the port rebuilds the zone): original after the re-init against a fresh original.
import { loadExe } from '../lib/engine-load.mjs';
import { runScenario, buildOracle, Cov, ZONE_RANGES, NODE_FIELDS } from '../lib/m7-z09JST-cover.mjs';
import { jstKeys, KEY } from '../lib/jst-bot.mjs';
import { MsvcRng } from '../lib/msvc-rng.mjs';
import { srand, randF } from '../../src/game/crt.ts';
import { K, hexf, REC } from '../../src/zones/z09jst/consts.ts';
import { guarded } from '../lib/inject-guard.mjs';

const hx = (n) => n.toString(16);
const flat = () => ({ range: (x) => x / 2 });
const msvc = (s) => new MsvcRng(s);
const lcg = (seed) => { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)] }; };

/**
 * The instruction coverage the scenarios reach in the original: [first address, end address (the next function), executed instructions, instructions of the listing in that range].
 * The test fails when a function gains or loses coverage. The difference (total - executed) is not code that plays: the switch jump tables and the padding after the functions
 * decoded as instructions (0x5d1a06..0x5d1ab5 the state switch's table, 0x5d4448..0x5d4465 / 0x5d4688..0x5d4697 the popup / panel switch tables, 0x5f3a50..0x5f3a8f the camera's, 0x5d27db.., 0x5d4b52.. int3
 * padding): every real branch of FUN_005ce506 / FUN_005d4070 / FUN_005d4467 / FUN_005d4698 / FUN_005f2f0b / mfigman is executed (docs/re/m6/z09JST.md lists how the dead ones are reached).
 * Not run by the oracle (rendering / engine glue, not simulation): FUN_005d2814 (aim marker), FUN_005d3f30 (HUD), FUN_005cd33d (zone loop), FUN_005cdb60 / FUN_005ce1c6 (attach), FUN_005d4b60.
 */
const FUNCS = [
  [0x5ce3a0, 0x5ce454, 64, 64], [0x5ce454, 0x5ce506, 54, 54], [0x5ce506, 0x5d1ab6, 3408, 3487], [0x5d1ab6, 0x5d1b41, 45, 44], [0x5d1b41, 0x5d1d1c, 143, 143], [0x5d1d1c, 0x5d1e1b, 77, 77],
  [0x5d1e1b, 0x5d1e75, 27, 27], [0x5d1f64, 0x5d243e, 361, 361], [0x5d24b0, 0x5d2771, 182, 182], [0x5d2782, 0x5d27e0, 27, 32], [0x5d3b80, 0x5d3c0d, 44, 44], [0x5d3d90, 0x5d3dc8, 19, 19],
  [0x5d4070, 0x5d4467, 290, 305], [0x5d4467, 0x5d4698, 162, 171], [0x5d4698, 0x5d4860, 136, 135], [0x5d4860, 0x5d4add, 129, 129], [0x5d4add, 0x5d4b60, 35, 49],
  [0x5f2bb0, 0x5f2bd8, 14, 14], [0x5f2bd8, 0x5f2bfc, 16, 16], [0x5f2bfc, 0x5f2dd9, 111, 111], [0x5f2dd9, 0x5f2f0b, 86, 86], [0x5f2f0b, 0x5f3a90, 632, 661], [0x5f3a90, 0x5f3aef, 33, 32],
  [0x5f3aef, 0x5f3b25, 21, 21], [0x5f3b61, 0x5f3c54, 77, 77], [0x5f3c66, 0x5f3ce1, 44, 44], [0x5f3ce1, 0x5f3cf6, 9, 9], [0x5f3cf6, 0x5f3d6a, 42, 42], [0x5f3d6a, 0x5f3d78, 7, 7],
  [0x5f3d78, 0x5f3f1b, 147, 147], [0x5f3f1b, 0x5f3f60, 25, 25],
];

const __test = {
  name: 'm7-z09JST-cover',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const cov = new Cov();
    const visited = new Set();
    const worstAll = {};
    const stateTicks = new Map();
    const tot = { ticks: 0, checked: 0, floats: 0, exact: 0, scenarios: 0, worstRel: 0, worstName: '' };
    const t0 = Date.now();
    const add = (r) => {
      checked += r.checked; tot.checked += r.checked; tot.ticks += r.ticks; tot.floats += r.floats; tot.exact += r.exact; tot.scenarios++;
      for (const s of r.states) visited.add(s);
      for (const [st, c] of r.stateTicks ?? []) stateTicks.set(st, (stateTicks.get(st) ?? 0) + c);
      for (const [k, v] of Object.entries(r.worst)) { if (v > (worstAll[k] ?? 0)) worstAll[k] = v; if (v > tot.worstRel) { tot.worstRel = v; tot.worstName = k; } }
      if (globalThis.process?.env?.Z09_LIST) notes.push(`  [${r.label}] ${r.ticks} ticks`);
      for (const f of r.failures) if (failures.length < 30) failures.push(f);
      if (r.unhooked && !/^0x4359d5x\d+ 0x41f17cx\d+$/.test(r.unhooked)) failures.push(`${r.label ?? ''} unexpected unhooked calls: ${r.unhooked}`);
      return r;
    };
    const run = (o) => { const r = runScenario(ctx, { cov, mkRng: msvc, ...o }); r.label = o.label; return add(r); };
    const DTS = [1, 0.5];
    /** results of the tournaments (their emulators are the starting point of the restart scenarios) */
    const TRES = new Map();

    // ------------------------------------------------------------------------------------------------------------------------ 0. the sensitivity of the test + constants
    {
      // a port at another dt than the original must fail within a few ticks (both directions): the dt really reaches both sides
      for (const [a, b] of [[0.5, 1], [1, 0.5]]) {
        const r = runScenario(ctx, { label: `sens`, seed: 1, dt: a, dtPort: b, keys: (d, t) => jstKeys(d, 'win', t), maxTicks: 40, mkRng: msvc, stop: () => false });
        checked++;
        if (r.failures.length === 0) failures.push(`sensitivity: port dt ${b} against original dt ${a} did not fail`);
      }
      checked++;
      if (hexf(pe.u32(0x892100)) !== K.STICK_DIV) failures.push(`K.STICK_DIV ${K.STICK_DIV} != exe ${hexf(pe.u32(0x892100))}`);
      checked++;
      if (hexf(pe.u32(0x8b1718)) !== 1) failures.push('image dt (DAT_008b1718) is not 1');
      // the random numbers: FUN_004388ae (the engine's rand(range): CRT rand() / 32767 * range, 0 for range <= 0) run natively with the CRT's own rand (0x85daf0, seed 0x964aa4) against the shared `randF` / `srand` of src/game/crt.ts
      {
        const { emu } = buildOracle(ctx, pe, { dt: 1, rng: msvc(1) });
        const cpu = emu.cpu;
        cpu.hooks.delete(0x4388ae); cpu.exec.push([0x4388ae, 0x4388e7]); cpu.invalidate();
        const fb = (v) => { const b = new Float32Array([v]); return new Uint32Array(b.buffer)[0]; };
        let nd = 0, nb = 0;
        for (const seed of [1, 12345, 0xdeadbeef, 0x7fffffff, 0x80000000, 0]) {
          srand(seed); cpu.mem.w32(0x964aa4, seed >>> 0);
          for (let i = 0; i < 1500; i++) {
            const range = [200, 500, 7.5, 1000, 0, -3, 32767, 4.5e6][i % 8];
            cpu.call(0x4388ae, [fb(range)]);
            const o = cpu.fpop(), p = randF(Math.fround(range));
            checked++; nd++;
            if (o !== p) { nb++; if (failures.length < 30) failures.push(`rand(${range}) seed ${seed} draw ${i}: original ${o} port ${p}`); }
          }
        }
        notes.push(`random numbers: ${nd} draws of the original's FUN_004388ae (native CRT rand) against crt.ts randF (the port's generator), ${nb} differences (bit-identical for the same seed; the port seeds with the clock like the original)`);
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------ bots
    /** per round plan: the tournament bot decides the style from the score: `winAfter` rounds lost first (hitsE < k) then won (gold 0, silver 1, bronze 2), or the player wins `p` rounds and then loses */
    const tourney = (k, mode = 'medal', ready = 40) => {
      let lastState = -1, round = -1;
      return (d, t) => {
        if (d.state === 0 && lastState !== 0) round++;
        lastState = d.state;
        const style = mode === 'medal' ? (d.hitsE < k ? 'loss' : 'win') : (d.hitsP < k ? 'win' : 'loss');
        return jstKeys(d, style, t, { ready });
      };
    };
    /** the charge dithers: pump to `up`, rest until below `down`, pump to `ready`, let go */
    const dither = (up, down, ready, style = 'win') => {
      let phase = 0;
      return (d, t) => {
        if (d.state === 0 || d.state === 2) phase = 0;
        if (d.state !== 3) return jstKeys(d, style, t, { ready });
        const g = d.gauge ?? 0;
        if (phase === 0) { if (g > up) phase = 1; else return t % 2 === 0 ? KEY.RIGHT : KEY.LEFT; }
        if (phase === 1) { if (g < down) phase = 2; else return 0; }
        if (g > ready) return KEY.SPACE;
        return t % 2 === 0 ? KEY.RIGHT : KEY.LEFT;
      };
    };
    const stopAtPopup = (d) => d.state === 0x21;

    // ------------------------------------------------------------------------------------------------------------------------ 1. tournaments: every medal, lost with 0 / 1 / 2 points, variables that are only raised
    {
      const T = [
        // [label, bot, seed, dts, vars]
        ['gold', tourney(0), 1, DTS, {}],
        ['silver', tourney(1), 7, [0.5], { 0x18: 99999, 0xcb: 3 }],
        ['bronze', tourney(2), 3, [1], { 0x18: 1, 0xcb: 1 }],
        ['lost0', tourney(0, 'lose'), 11, [0.5], { 0xcb: 2 }],
        ['lost2', tourney(2, 'lose'), 13, [1], { 0x18: 5 }],
      ];
      for (const [label, bot, seed, dts, vars] of T) for (const dt of dts) {
        const r = run({ label: `${label} dt${dt}`, seed, dt, keys: bot, maxTicks: 9000, vars });
        TRES.set(`${label} dt${dt}`, r);
        notes.push(`${label} dt ${dt}: ${r.ticks} ticks, result ${r.result}, medal ${r.d.medal}, score ${r.d.score}, hits ${r.d.hitsP}:${r.d.hitsE}, vars hi ${r.S.W.vars.get(0x18)} trophy ${r.S.W.vars.get(0xcb)}`);
        checked++;
        if (r.result === 0) failures.push(`${label} dt${dt}: tournament did not finish in ${r.ticks} ticks`);
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------ 2. one round: release speeds (hoof classes, speed clamp), dithering, the toggle, slow
    {
      const R = [
        ['rel19', (d, t) => jstKeys(d, 'win', t, { ready: 19 }), [0.5]], ['rel25', (d, t) => jstKeys(d, 'win', t, { ready: 25 }), [1]], ['rel35', (d, t) => jstKeys(d, 'win', t, { ready: 35 }), [0.5]],
        ['rel45', (d, t) => jstKeys(d, 'win', t, { ready: 45 }), [1]], ['rel59.5', (d, t) => jstKeys(d, 'win', t, { ready: 59.5 }), DTS],
        ['dither', dither(22, 15, 30), DTS], ['dither2', dither(19, 17.5, 45, 'loss'), [1]],
        ['holdleft', (d, t) => (d.state === 2 ? KEY.LEFT : jstKeys(d, 'win', t, { ready: 30 })), [0.5]],
      ];
      for (const [label, keys, dts] of R) for (const dt of dts) {
        const r = run({ label: `${label} dt${dt}`, seed: 5 + label.length, dt, keys, maxTicks: 2500, stop: stopAtPopup });
      }
      // slow: SPACE below 18 (state 4 5 6 7), with the dark knight's z slide of state 6 injected (dz <= tz branch)
      for (const dt of DTS) {
        if (dt === 1) run({ label: `slow dt${dt}`, seed: 31, dt, keys: (d, t) => jstKeys(d, 'slow', t), maxTicks: 3000, stop: stopAtPopup });
        let fired = false;
        run({
          label: `slow-z dt${dt}`, seed: 32, dt, keys: (d, t) => jstKeys(d, 'slow', t), maxTicks: 3000, stop: stopAtPopup,
          beforeTick: (n, S) => { if (!fired && S.d.state === 6) { fired = true; S.setRec(REC.DRKK, 14, -82.0); } },
        });
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------ 3. aim: keys and the analogue stick (read while no key is held), random wobble
    {
      const aimBot = (seed) => {
        const R = lcg(seed);
        let held = 0, stk = [0, 0], left = 0;
        const sticks = [0, 0, 19, -20, 20, -21, 21, 40, -64, 127, -128, 90];
        const heldSet = [0, 0, 0, KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.UP | KEY.LEFT, KEY.DOWN | KEY.RIGHT, KEY.UP | KEY.DOWN, KEY.LEFT | KEY.RIGHT];
        return {
          keys: (d, t) => {
            if (d.state !== 9) return jstKeys(d, 'win', t, { ready: 40 });
            if (left-- <= 0) { left = R.int(14); held = R.pick(heldSet); stk = [R.pick(sticks), R.pick(sticks)]; }
            return held;
          },
          stick: (d) => (d.state === 9 ? stk : [0, 0]),
        };
      };
      for (const seed of [21, 22]) for (const dt of DTS) {
        const b = aimBot(seed);
        run({ label: `aimmash${seed} dt${dt}`, seed, dt, keys: b.keys, stick: b.stick, maxTicks: dt === 1 ? 1100 : 1700, stop: () => false });
      }
      // stick only (no key at all in the ride), the aim steered by the stick onto the shield / away
      for (const dt of DTS) {
        const style = { win: [0, 0], loss: [30, 30] };
        let want = 'win', round = 0, last = -1;
        const keys = (d, t) => { if (d.state === 0 && last !== 0) { round++; want = round % 2 ? 'loss' : 'win'; } last = d.state; return d.state === 9 ? 0 : jstKeys(d, 'win', t, { ready: 35 }); };
        const stick = (d) => {
          if (d.state !== 9) return [0, 0];
          const [tx, ty] = style[want];
          const f = (v) => (Math.abs(v) < 0.5 ? 0 : v > 0 ? 100 : -100);
          return [f(tx - d.aimX), f(ty - d.aimY)];
        };
        run({ label: `stick dt${dt}`, seed: 23, dt, keys, stick, maxTicks: 3200, stop: (d) => d.hitsP + d.hitsE >= 2 && d.state === 0x21 });
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------ 4. the states that no code sets: 0xd 0x15 0x1c 0x1d written into both nodes
    {
      /** when(d, S, info) is evaluated after every tick: true -> inject */
      const CTX = {
        clash: (d, S, i) => i.prev === 9 && d.state !== 9 && (d.state === 0xb || d.state === 0xc || d.state === 0xe),
        react: (d, S, i) => i.sinceClash === 10,
        ride: (d, S, i) => d.state === 9 && i.inState === 40,
        charge: (d, S, i) => d.state === 3 && d.speed > 12,
        walk: (d, S, i) => d.state === 5 && i.inState === 6,
      };
      const injectRun = (target, ctxName, dt, style, seed, rng = msvc) => {
        let prev = -1, inState = 0, sinceClash = -1, fired = false, firedAt = -1;
        const info = { prev, inState, sinceClash };
        const r = run({
          label: `inject ${hx(target)} @${ctxName} dt${dt}`, seed, dt, mkRng: rng, maxTicks: 4000,
          keys: (d, t) => jstKeys(d, style, t, { ready: 40 }),
          stop: (d) => fired && d.state === 0x21,
          afterTick: (n, S) => {
            const d = S.d;
            info.prev = prev; info.inState = d.state === prev ? inState + 1 : 0; inState = info.inState;
            if (info.prev === 9 && d.state !== 9) sinceClash = 0; else if (sinceClash >= 0) sinceClash++;
            info.sinceClash = sinceClash;
            if (!fired && CTX[ctxName](d, S, info)) { fired = true; firedAt = n; S.state(target); }
            prev = d.state;
          },
        });
        checked++;
        if (!fired) failures.push(`${r.label}: the injection moment was never reached`);
        return { r, firedAt };
      };
      let n = 0;
      // [context, bot style, seed, rng, dts]
      const PLAN = [['clash', 'glance', 41, flat, DTS], ['clash', 'win', 2, msvc, [1]], ['clash', 'loss', 111, msvc, [0.5]], ['react', 'win', 10, msvc, [1]], ['ride', 'win', 4, msvc, [0.5]], ['charge', 'win', 6, msvc, [1]], ['walk', 'slow', 31, msvc, [0.5]], ['react', 'loss', 111, msvc, DTS]];
      for (const target of [0xd, 0x15, 0x1c, 0x1d]) for (const [ctxName, style, seed, rng, dts] of PLAN) for (const dt of dts) if ((ctxName !== 'walk' || target === 0x15 || target === 0x1c) && (style !== 'loss' || ctxName !== 'react' || target === 0x1d)) injectRun(target, ctxName, dt, style, seed + n++ % 3, rng);
    }

    // ------------------------------------------------------------------------------------------------------------------------ 5. dead / rare branches
    {
      // 5.1 speed < 0 in state 3 (floor 0), speed > 60 (cap; also reached by release 59.5 above)
      for (const dt of DTS) {
        let done = 0;
        run({ label: `speed<0 dt${dt}`, seed: 51, dt, keys: (d, t) => jstKeys(d, 'win', t, { ready: 20 }), maxTicks: 900, stop: stopAtPopup,
          beforeTick: (n, S) => { if (S.d.state === 3 && done < 2 && n % 7 === 0) { done++; S.setField('speed', done === 1 ? -5 : -0.01); } } });
        done = 0;
        run({ label: `speed>60 dt${dt}`, seed: 52, dt, keys: (d, t) => (d.state === 3 ? (t % 2 ? KEY.LEFT : KEY.RIGHT) : jstKeys(d, 'win', t)), maxTicks: 900, stop: (d) => d.state >= 4,
          beforeTick: (n, S) => { if (S.d.state === 3 && done === 0 && S.d.speed > 30) { done = 1; S.setField('speed', 75.5); } } });
      }
      // 5.2 precision: aim^2 in (39, 40) -> 0 -> 1; aim^2 > 40 in state 0xb (precision < 0 -> 0 -> 1) (state 0xb is only set below 40: injected)
      for (const [aq, tag, dts] of [[39.5, 'p0', DTS], [45, 'pneg', [1]]]) for (const dt of dts) {
        let fired = false;
        run({ label: `precision ${tag} dt${dt}`, seed: 2, dt, keys: (d, t) => jstKeys(d, 'win', t), maxTicks: 3000, stop: (d) => fired && d.state === 0x21,
          afterTick: (n, S) => { if (!fired && S.d.state === 0xb) { fired = true; S.setField('aimSq', aq); } } });
      }
      // 5.3 camera modes written in the idle state: 2 and 4 (no code sets them), > 0xf, negative, mode 0 with the spline made (it is freed)
      for (const dt of DTS) {
        const seq = [2, 4, 0x10, 0x11, 0xffff, -1, 3, 4, 'spline0', 0xe, 0xd, 0xf, 8, 6, 5, 7, 9, 0xa, 0xb, 0xc, 10];
        let i = 0;
        run({ label: `cammodes dt${dt}`, seed: 5, dt, keys: () => 0, maxTicks: seq.length * 3 + 4, stop: () => false,
          beforeTick: (n, S) => {
            if (S.d.state !== 1 || n % 3 !== 2 || i >= seq.length) return;
            const m = seq[i++];
            if (m === 'spline0') { S.setField('camMode', 0); S.setField('splineMade', true); } else S.setField('camMode', m);
          } });
      }
      // 5.4 state numbers nothing handles (the switch falls through to the spectators and the camera)
      for (const dt of DTS) {
        const seq = [0xa, 0x1e, 0x24, 0x7fffffff, -1, 0x100];
        let i = 0;
        run({ label: `unknown states dt${dt}`, seed: 6, dt, keys: () => 0, maxTicks: seq.length * 2 + 3, stop: () => false,
          beforeTick: (n, S) => { if (n % 2 === 1 && i < seq.length) S.state(seq[i++]); else if (n % 2 === 0 && n > 0) S.state(1); } });
      }
      // 5.5 popups: 0xd (like 0xe), others (nothing is drawn), the result states of 0x22 with both sides at 3 points (the win branch wins), over 3
      for (const [tag, popup, hp, he] of [['popup0xd', 0xd, null, null], ['popup0', 0, null, null], ['popup0xf', 0xf, null, null], ['popup4+3pts', 4, 3, 3], ['popup3+5pts', 3, 1, 5], ['popup7+4pts', 7, 4, 1]]) for (const dt of [tag === 'popup0xd' || tag === 'popup0' ? 0.5 : 1]) {
        let st = 0;
        run({ label: `${tag} dt${dt}`, seed: 8, dt, keys: (d, t) => jstKeys(d, 'win', t), maxTicks: 3500, stop: (d) => st > 0 && (d.state === 0x23 || (d.state === 0x21 && hp === null && st > 1)),
          afterTick: (n, S) => {
            if (st === 0 && S.d.state === 0x1f) { st = 1; S.setField('popup', popup); if (hp !== null) { S.setField('hitsP', hp); S.setField('hitsE', he); } }
            else if (st === 1 && S.d.state === 0x21) st = 2;
          } });
      }
      // 5.6 a one-shot rider clip in mode 0 with noWrap 0: the rider holds on its last frame (FUN_005f3d78 0x5f3ed2): the glance state 0x20 with other clips written
      for (const dt of DTS) {
        let fired = false;
        run({ label: `mode0-hold dt${dt}`, seed: 41, dt, mkRng: flat, keys: (d, t) => jstKeys(d, 'glance', t), maxTicks: 3500, stop: (d) => fired && d.state === 0x21,
          afterTick: (n, S) => {
            if (fired || S.d.state !== 0x20) return;
            // a row whose rider clips are one-shot clips shorter than the remaining slide: the rider's own animation ends -> result 2 -> seek(last frame)
            const rig = S.W.records[REC.JKIT].anim, tabs = S.d.host.tables;
            const rowOk = (tab, ri) => { for (let r = 0; r < tab.length; r++) { const c = rig.rig.clips[tab[r][ri]]; if (c && (c.flags & 0x10) === 0 && c.frameCount > 2 && c.frameCount < 40) return r; } return -1; };
            const rp = rowOk(tabs.player, 3), re = rowOk(tabs.enemy, 2);
            if (rp >= 0) S.setClips('player', rp);
            if (re >= 0) S.setClips('enemy', re);
            fired = true;
          } });
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------ 6. FUN_005d1b41 (hoofbeats) at function level: all frames x speed classes, original function against `JoustDuel.hooves`
    {
      const r = runScenario(ctx, { label: 'hooves', seed: 1, dt: 1, cov, mkRng: msvc, keys: () => 0, maxTicks: 2, stop: () => false });
      const { d, emu, S } = r;
      const f32 = Math.fround, next = (v) => { const b = new Float32Array([v]); new Uint32Array(b.buffer)[0]++; return b[0]; };
      const speeds = [0, 17.9, 18, 29.99, 30, next(30), 35, 39.999996, 40, next(40), 59, 60];
      const mem = emu.cpu.mem;
      let nCalls = 0, nFail = 0;
      const snd = d.host.snd, orig3 = snd.play3D;
      for (const sp of speeds) for (let f = -2; f <= 30; f++) {
        S.setField('speed', sp);
        const ol = []; emu.log = [];
        emu.cpu.call(0x5d1b41, [emu.node, f], { trace: emu.trace() });
        for (const l of emu.log) ol.push(l);
        const pl = [];
        snd.play3D = (i, p) => pl.push(`p3 ${i} ${[0, 1, 2].map((k) => p[k].toString()).join(',')}`);
        d.hooves(f);
        snd.play3D = orig3;
        checked++; nCalls++;
        if (ol.join('|') !== pl.join('|')) { nFail++; if (failures.length < 30) failures.push(`hooves speed ${sp} frame ${f}: original [${ol}] port [${pl}]`); }
      }
      notes.push(`FUN_005d1b41 (hoofbeats): ${nCalls} calls (${speeds.length} speeds x frames -2..30), ${nFail} differences`);
      add({ checked: 0, ticks: 0, floats: 0, exact: 0, states: new Set(), failures: [], worst: {} });
    }

    // ------------------------------------------------------------------------------------------------------------------------ 6b. FUN_005f3b61 on a manager that is already bound (the flag-clearing loop 0x5f3bae: dead in play, the constructor binds each manager once after FUN_005f3aef zeroed it)
    {
      const r = runScenario(ctx, { label: 'rebind', seed: 1, dt: 1, cov, mkRng: msvc, keys: () => 0, maxTicks: 3, stop: () => false });
      const { d, emu, S } = r;
      const mem = emu.cpu.mem;
      let bad = 0;
      for (const [who, rows, row, ids] of [['enemy', 3, 4, [REC.LKNG, REC.LQUN, REC.BKNG]], ['player', 4, 6, [REC.DRKH, REC.GSAD, REC.CLOK, REC.JKIT]]]) {
        const arr = emu.alloc(16);
        ids.forEach((id, i) => mem.w32(arr + 4 * i, emu.recPtr(id)));
        const mgr = mem.u32(who === 'player' ? 0x5d5b284 : 0x5d5b288);
        emu.cpu.call(0x5f3b61, [mgr, rows, arr, row], { trace: emu.trace() });
        d[who].bind(ids.map((i) => S.W.records[i]), row);
        for (let i = 0; i < 30; i++) { checked++; if ((mem.r16(emu.recPtr(i) + 0x60) & 2) !== (S.W.records[i].flags & 2)) { bad++; failures.push(`rebind ${who}: record ${i} flag 2: original ${mem.r16(emu.recPtr(i) + 0x60) & 2} port ${S.W.records[i].flags & 2}`); } }
        for (let k = 0; k < rows; k++) { checked++; if (mem.r32(mgr + 0x30 + 4 * k) !== d[who].clip[k]) { bad++; failures.push(`rebind ${who}: clip ${k}: original ${mem.r32(mgr + 0x30 + 4 * k)} port ${d[who].clip[k]}`); } }
      }
      notes.push(`FUN_005f3b61 on bound managers (the record flags of the old group are cleared): ${bad} differences`);
    }

    // ------------------------------------------------------------------------------------------------------------------------ 7. the restart in place (FUN_00423532 calls the constructor with the existing node: else branch)
    {
      // the port rebuilds the zone: `rememberRestart` / `applyRestart` carry the one field with a visible effect (the spectator level +0x44); everything else the original keeps is overwritten
      // before it is read (see the note). The oracle is the original after the lost / won tournament, re-initialised; the port a fresh zone with the carried level.
      for (const [from, dt] of [['lost2 dt1', 1], ['gold dt1', 0.5], ['silver dt0.5', 0.5]]) {
        const r0 = TRES.get(from);
        if (!r0) { failures.push(`restart: no result for ${from}`); continue; }
        const level0 = r0.d.level;
        let before = null, after = null;
        const r1 = run({
          label: `restart after ${from} (level ${level0}) at dt${dt}`, seed: 77, dt, restartOf: r0, keys: (d, t) => jstKeys(d, 'win', t), maxTicks: 1500, stop: stopAtPopup,
          beforeReinit: (emu) => { before = nodeWords(emu); }, afterReinit: (emu) => { after = nodeWords(emu); },
        });
        const kept = Object.keys(after).filter((a) => after[a] === before[a] && after[a] !== 0).map((a) => nodeName(+a));
        const reset = Object.keys(after).filter((a) => after[a] !== before[a]).map((a) => nodeName(+a));
        notes.push(`restart after ${from}, dt ${dt}: ${r1.ticks} ticks compared against the port (level ${level0} carried); the re-init changed ${reset.join(' ')}; it kept ${kept.join(' ')}`);
      }
    }
    {
      // sensitivity: without the carried level the spectators' idle clips of the retry differ from the original's
      const r0 = TRES.get('lost0 dt0.5');
      const r = runScenario(ctx, { label: 'restart without carry', seed: 78, dt: 0.5, restartOf: r0, noCarry: true, keys: (d, t) => jstKeys(d, 'win', t), maxTicks: 40, mkRng: msvc, stop: () => false });
      checked++;
      if (r.failures.length === 0) failures.push('restart sensitivity: the port without the carried level did not differ from the original');
      else notes.push(`restart without the carried level fails as it must: ${r.failures[0]}`);
    }
    function nodeWords(emu) { const o = {}; for (let a = 0; a < 0x11c; a += 4) o[a] = emu.cpu.mem.r32(emu.node + a); return o; }
    function nodeName(a) { const e = NODE_FIELDS.find((f) => f[0] === a); return e ? `${e[2]}(0x${hx(a)})` : `0x${hx(a)}`; }

    // ------------------------------------------------------------------------------------------------------------------------ coverage
    {
      let total = 0; for (const [lo, hi] of ZONE_RANGES) total += cov.count(lo, hi);
      if (globalThis.process?.env?.Z09_COVDUMP) { const fs = globalThis.process.getBuiltinModule('node:fs'); const all = []; for (const [lo, hi] of ZONE_RANGES) for (let a = lo; a < hi; a++) if (cov.has(a)) all.push(a); fs.writeFileSync(globalThis.process.env.Z09_COVDUMP, JSON.stringify(all)); }
      let bad = 0;
      for (const [lo, hi, want, listing] of FUNCS) {
        const got = cov.count(lo, hi);
        checked++;
        if (got !== want) { bad++; failures.push(`coverage of 0x${hx(lo)}..0x${hx(hi)}: ${got} instructions executed, expected ${want} (listing ${listing})`); }
      }
      notes.push(`coverage per function range (executed / listing): ${FUNCS.map(([lo, hi, w, l]) => `${hx(lo)} ${cov.count(lo, hi)}/${l}`).join(', ')}${bad ? ` (${bad} OFF)` : ''}`);
      notes.push(`instruction coverage of the original (zone ${ZONE_RANGES.map(([a, b]) => `0x${hx(a)}..0x${hx(b)}`).join(', ')}): ${total} distinct instructions executed over ${tot.scenarios} scenarios`);
      const missing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1f, 0x20, 0x21, 0x22, 0x23].filter((s) => !visited.has(s));
      notes.push(`ticks run per state (original and port compared each tick): ${[...stateTicks].filter(([st]) => st >= 0 && st < 0x30).sort((a, b) => a[0] - b[0]).map(([st, c]) => `${hx(st)}:${c}`).join(' ')}`);
      notes.push(`states whose code ran: ${[...visited].sort((a, b) => a - b).map(hx).join(' ')}${missing.length ? ` (NOT: ${missing.map(hx).join(' ')})` : ''}`);
      checked++;
      if (missing.length) failures.push(`states not run: ${missing.map(hx).join(' ')}`);
    }
    notes.push(`largest float differences (relative to max(1, |value|)): ${Object.entries(worstAll).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ')}`);
    notes.push(`${tot.scenarios} scenarios, ${tot.ticks} ticks compared, ${tot.checked} checks, worst relative difference ${tot.worstRel.toExponential(1)} (${tot.worstName}), tolerance 0 (bit for bit); ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
