import { loadExe } from './engine-load.mjs';
import { Coverage, FUNCTIONS, flightScenario, sequenceScenario, monkeyScenario, rockScenario, propsScenario, splineScenario, bipFixture } from './m7-z22BIP-cover.mjs';
import '../../src/zones/z22BIP.ts';

// z22BIP, differential test WP-VERIFY "coverage" (docs/re/m6/z22BIP.md, section "Differential test (WP-VERIFY): coverage"). It extends tools/tests/m6-z22BIP.mjs (which runs the original's
// node code in the x86 emulator at dt = 1 only, tolerance 2e-3, for 900 / 3374 / 700 / 800 / 700 ticks) with:
//   * every scenario at dt = 1 AND dt = 0.5 (DAT_008b1718 / DAT_008b171c in the emulator, `world.dt` in the port, the hosted animation advance with the same dt),
//   * tolerance 1e-5 relative (float32 noise; coordinates relative to max(300, |value|); absolute floor 4e-5 = 1 ulp at 500; sweep deltas 4 ulp of their start point),
//   * state injected into both sides (fuel, speed, ammo, thrust, steering, pitch, altitude, impulse, heading band, heading wrap, teleports, scores, monkey / rope states, bananas next to
//     the targets, melons next to the plane, the random table index, scripted box probe hits), so that the branches random flying rarely reaches are compared too,
//   * every engine call the original makes, compared with the port in order: sounds with their handles (the sound-table ids), speech, particles, every collision sweep with all its
//     arguments, and the draw calls: the banana / melon / stone mesh matrices, the monkey's record matrix and draw scale, the propeller draws, the river's texture scroll,
//   * a coverage counter on the original's code (every conditional jump of the zone's functions that run in play: taken / not taken), see the notes.

const DTS = [1, 0.5];

export default {
  name: 'm7-z22BIP-cover',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const t00 = Date.now();
    const pe = loadExe(ctx.dataRoot);
    const cov = new Coverage();
    const haveListing = cov.loadStatic();
    const ran = [];
    const take = (name, r, extra) => {
      checked += r.checked; failures.push(...r.failures);
      notes.push(...r.notes.map((n) => n.replace(/ \(tolerance:.*$/, '')));
      if (r.stats) notes.push(`${name}: ${typeof r.stats === 'string' ? r.stats : JSON.stringify(r.stats)}`);
      ran.push([name, r, extra]);
      return r;
    };
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const run = (name, fn) => { const t0 = Date.now(); let r; try { r = fn(); } catch (e) { r = { checked: 0, failures: [`${name} crashed: ${e.stack || e}`], notes: [] }; } r.ms = Date.now() - t0; return take(name, r); };

    // ---- the course
    run('spline', () => splineScenario(ctx, { cov }));
    // ---- the flight node, with injected states: two seeds at both dt, and the "dry tank" run that ends in result 1 and then a plane at the end of the course
    const fl = {};
    for (const dt of DTS) {
      for (const seed of [1, 2]) {
        const r = run(`flight dt ${dt} seed ${seed}`, () => flightScenario(ctx, { dt, seed, ticks: 2400, cov }));
        const s = r.stats; (fl[dt] ??= []).push(s);
      }
      const r = run(`dry tank dt ${dt}`, () => flightScenario(ctx, { dt, seed: 11, ticks: 260, cov, injectRate: 0, noHits: true, label: `dry tank dt ${dt}`, at: {
        10: (h) => h.setF('fuel', 0),
        200: (h) => { const m = h.sp.frame(Math.fround(0.955)).m; h.putRec(74, [m[12], 40, m[14]]); },
      } }));
      (fl[dt] ??= []).push(r.stats);
      // a plane that has stalled with fuel in the tank (speed <= 1, thrust 0, no input): the result stays 0 (the third arm of `speed > 1 || fuel != 0 || end of the course`)
      const r2 = run(`stalled plane dt ${dt}`, () => flightScenario(ctx, { dt, seed: 12, ticks: 120, cov, injectRate: 0, noHits: true, buttons: () => 0, label: `stalled plane dt ${dt}`, at: {
        10: (h) => { h.setF('speed', 0.5); h.setF('thrust', 0); },
      } }));
      (fl[dt] ??= []).push(r2.stats);
    }
    // ---- take-off -> flight -> crash -> recovery -> fuel -> landing -> result
    const sq = {};
    for (const dt of DTS) sq[dt] = run(`sequence dt ${dt}`, () => sequenceScenario(ctx, { dt, cov })).stats;
    // ---- monkeys, rock monsters, props
    const mk = {}, rk = {}, pr = {};
    for (const dt of DTS) {
      mk[dt] = [run(`monkey dt ${dt} seed 1`, () => monkeyScenario(ctx, { dt, seed: 1, ticks: 1500, cov })).stats, run(`monkey dt ${dt} hover`, () => monkeyScenario(ctx, { dt, seed: 2, ticks: 1500, cov, hover: true, label: `monkey dt ${dt} hover` })).stats, run(`monkey dt ${dt} seed 4`, () => monkeyScenario(ctx, { dt, seed: 4, ticks: 1500, cov })).stats];
      rk[dt] = [1, 3, 4].map((seed) => run(`rock dt ${dt} seed ${seed}`, () => rockScenario(ctx, { dt, seed, ticks: 2400, cov })).stats);
      pr[dt] = run(`props dt ${dt}`, () => propsScenario(ctx, { dt, seed: 1, ticks: 700, cov })).stats;
    }

    // ---- the states the scenarios must have visited (so that a change of a scenario cannot silently lose a state)
    const sum = (a, k) => a.reduce((s, x) => s + (x[k] ?? 0), 0);
    for (const dt of DTS) {
      const f = fl[dt];
      ok(sum(f, 'stall') > 0 && sum(f, 'noFuel') > 0 && sum(f, 'lowFuel') > 0 && sum(f, 'alarm') > 0, `flight dt ${dt}: stall / out of fuel / fuel below 15 % / below 10 % visited: ${JSON.stringify(f.map((x) => [x.stall, x.noFuel, x.lowFuel, x.alarm]))}`);
      ok(sum(f, 'rolling') > 0 && sum(f, 'atEnd') > 0 && sum(f, 'crash') > 0 && sum(f, 'ahead') > 0, `flight dt ${dt}: spin-out / end of the course / crash / ahead of Johnny visited`);
      ok(f.every((x) => /(^| )2:/.test(x.modes)) && f.some((x) => /16:/.test(x.modes)) && f.some((x) => /4:/.test(x.modes)), `flight dt ${dt}: modes 2 / 4 / 16 visited: ${f.map((x) => x.modes)}`);
      const rs = f.reduce((a, x) => { for (const k of Object.keys(x.run)) a[k] = (a[k] ?? 0) + x.run[k]; return a; }, {});
      ok(rs.bananasFired > 100 && rs.monkeyHits > 0 && rs.bantHits > 0 && rs.fuelCans > 0 && rs.bananaPickups > 0 && rs.crashes > 0, `flight dt ${dt}: bananas fired, monkey / banana-target hits, fuel cans, banana bunches, crashes: ${JSON.stringify(rs)}`);
      ok(sq[dt].modes === '8>2>4>2>16>2>16>2>16' && sq[dt].result === 3 && sq[dt].landed && sq[dt].approach === 50 && sq[dt].slide === 32 && sq[dt].recover === 30, `sequence dt ${dt}: take-off, flight, recovery, landing (50 + 32 ticks), result 3: ${JSON.stringify([sq[dt].modes, sq[dt].result, sq[dt].approach, sq[dt].slide, sq[dt].recover])}`);
      ok(sq[dt].maxAhead < 1, `sequence dt ${dt}: the flight node's frame at progress + 0.01 stays below 1 (max ${sq[dt].maxAhead.toFixed(4)}; after the landing ${sq[dt].maxAheadLanded.toFixed(4)})`);
      const m = mk[dt];
      ok(sum(m, 'awake') > 0 && sum(m, 'asleep') > 0 && sum(m, 'dazed') > 0 && sum(m, 'melons') > 0 && sum(m, 'melonHits') > 5 && sum(m, 'slow') > 0, `monkey dt ${dt}: asleep / awake / dazed, melons, melon hits, plane below 320: ${JSON.stringify(m)}`);
      const r = rk[dt];
      ok(sum(r, 'near') > 0 && sum(r, 'medium') > 0 && sum(r, 'far') > 0 && sum(r, 'hit') > 0 && sum(r, 'stones') > 0 && sum(r, 'stoneHits') > 0, `rock dt ${dt}: attack / medium / far / hit states, stones, stone hits on the plane: ${JSON.stringify(r)}`);
      ok(pr[dt].ropeMoving > 0 && pr[dt].ropeWaiting > 0 && pr[dt].ropeTurning > 0 && pr[dt].riverNear > 0 && pr[dt].riverFar > 0, `props dt ${dt}: rope target moving / waiting / turning, river near / far: ${JSON.stringify(pr[dt])}`);
    }

    // ---- the original's code that no scenario can reach: the arms of conditional jumps that stayed unvisited, each with the reason (evidence in docs/re/m6/z22BIP.md)
    const rep = cov.report();
    let tot = 0, hit = 0;
    if (haveListing) {
      for (const [, e] of rep) { tot += e.arms; hit += e.armsHit; }
      const miss = [];
      for (const [name, e] of rep) if (e.missing.length) miss.push(`${name} [${e.missing.join(' ')}]`);
      notes.push(`coverage of the original's conditional jumps (taken / not taken arms) in ${FUNCTIONS.length} functions: ${hit} of ${tot} arms visited; never visited: ${miss.join('; ')}`);
      const dead = DEAD_ARMS;
      for (const [name, e] of rep) {
        const want = new Set(dead[name] ?? []);
        const got = new Set(e.missing);
        const extra = [...got].filter((x) => !want.has(x)), lost = [...want].filter((x) => !got.has(x));
        ok(extra.length === 0, `coverage: ${name}: arms never visited that are not listed as dead / rare: ${extra.join(' ')}`);
        ok(lost.length === 0, `coverage: ${name}: arms listed as unreachable were visited (update the list): ${lost.join(' ')}`);
      }
    } else notes.push('coverage: the decompile listing LE2.asm.txt is not next to the repository: the arm coverage was not evaluated');
    const inst = [...rep].reduce((s, [, e]) => s + e.n, 0);
    notes.push(`coverage: ${inst} distinct instructions of the zone's functions executed`);
    notes.push(`scenarios: ${ran.map(([n, r]) => `${n} ${r.checked} (${r.ms} ms)`).join(', ')}`);
    notes.push(`total ${Date.now() - t00} ms`);
    return { checked, failures, notes };
  },
};

/**
 * The arms (jump address `>` target for a taken jump, `fall` for the fall-through) the scenarios never take, by function. Every one is dead code or an error path in play:
 * constructors' file-open / allocation failure arms, the analog stick of the flight (FUN_004376f9 zeroes the axes), the compiler's always-true flags, the camera clamps that the
 * altitude clamps make unreachable, loops over an empty set, ... The test fails when a function takes an arm that is not listed here or a listed arm becomes reachable.
 */
const DEAD_ARMS = {
  // the analog stick of the flight: FUN_004376f9 zeroes the axes in this build, so the "stick < -20" / "stick > 20" tests (0x70a126 / 0x70a15a, 0x70a2f8 / 0x70a33a) always take the same arm;
  // 0x70af22: the compiler's always-true flag of a `&&` chain; 0x70b413 / 0x70b452: the camera's clamps, which the altitude clamps (0 .. 100) make unreachable
  flightUpdate: ['0x70a12d fall', '0x70a161 fall', '0x70a2ff fall', '0x70a341 fall', '0x70af22>0x70b0c2', '0x70b413 fall', '0x70b452 fall'],
  // the constructors of the nodes with an existing node object (`param_3 != 0`: the constructor run again by a restart): the tests build every node fresh
  flightCtor: ['0x70b7d6>0x70b809'], takeoffCtor: ['0x70c38e>0x70c3b8'], rockCtor: ['0x70cff6>0x70d01d'], propCtor: ['0x70d370>0x70d397'], crocCtor: ['0x70d541>0x70d568'],
  // the stone pool loop's exit arm at 10 (the pool holds more than 10 stones in no scenario), the jump table's `ja` default (the state is 0 .. 3), the stone sound's flag tests (DAT_05d5d0a8 / 0ac)
  // and two arms that are bytes of the jump table disassembled as code (0x70cd96 / 0x70cd9a)
  parrotCtor: ['0x70d6ea>0x70d711'], canCtor: ['0x70dac4>0x70daeb'], johnnyCtor: ['0x70df25>0x70df4f'], riverCtor: ['0x70e1cb>0x70e1f2'], landingCtor: ['0x70e8d1>0x70e8fb'], ropeCtor: ['0x70ed89>0x70edb3'], monkeyCtor: ['0x70fb1c>0x70fb64'],
  // rare, not dead: Johnny's progress passes 1.0 after about 3700 ticks (his step 0.00027 per tick): none of the scenarios flies that long (the take-off sequence ends earlier)
  johnnyUpdate: ['0x70dcc9 fall'],
  seabedCtor: ['0x70fd29>0x70fd50'], recoverCtor: ['0x710185>0x7101ac'], pswitchCtor: ['0x710317>0x71033e'],
  // Recover's phase switch (0 / 1 / anything else): the phase is only ever 0 or 1
  recoverUpdate: ['0x70fdff fall'],
  rockSpawn: ['0x70c63c>0x70c766'],
  rockUpdate: ['0x70cbb1>0x70cd1d', '0x70cd34 fall', '0x70cd3d>0x70cd63', '0x70cd3d fall', '0x70cd96>0x70cd98', '0x70cd96 fall', '0x70cd9a>0x70cd9c', '0x70cd9a fall'],
};
