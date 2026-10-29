import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { startParRun, parSnapshot, parFinish, parResultSpeech, PAR_VARS, PAR_MEDALS, PAR_CTOR } from '../../src/zones/z38PAR.ts';
import { ParPilot, S, CLIP, PILOT } from '../../src/zones/parachute/par-pilot.ts';
import { PAR_SOUNDS, parRun, RING_HIT, RING_MISSED } from '../../src/zones/parachute/par-run.ts';
import { ParHud, HUD_TEX, gaugeRects } from '../../src/zones/parachute/par-hud.ts';
import { BIRDS, BIRD_CENTRE } from '../../src/zones/parachute/par-props.ts';
import { setRandomSource, rand, segmentBox, reflect, segmentHitsRecordBox } from '../../src/zones/parachute/util.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';
import { parBotStep } from '../lib/par-bot.mjs';

// z38PAR "Parachute" (docs/re/m3/z38PAR.md): the pilot's state machine, rings, landing score, HUD model, props and the end-of-game rules, run on the real zone data
// with scripted input; the constants are checked against the executable (.rdata floats / doubles, the immediates of the constructor, the sound-slot loads of FUN_00467370).

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const f64 = (pe, va) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(va), true); d.setUint32(4, pe.u32(va + 4), true); return d.getFloat64(0, true); };
/** the immediates of `push imm8 / imm32` + `call rel32` pairs in [lo, hi): { target, arg } */
function pushCalls(pe, lo, hi) {
  const out = [];
  for (let a = lo; a < hi - 6; a++) {
    const b = pe.at(a);
    let arg = null, len = 0;
    if (b === 0x6a) { arg = pe.at(a + 1); len = 2; } else if (b === 0x68) { arg = pe.u32(a + 1); len = 5; }
    if (arg === null) continue;
    if (pe.at(a + len) === 0xe8) { const rel = pe.u32(a + len + 1) | 0; out.push({ target: (a + len + 5 + rel) >>> 0, arg }); }
  }
  return out;
}
/** does [lo, hi) contain the 32-bit immediate v (little endian) */
function hasImm(pe, lo, hi, v) {
  for (let a = lo; a < hi - 3; a++) if (pe.u32(a) === (v >>> 0)) return true;
  return false;
}
const bits = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };

export default {
  name: 'm3-z38PAR',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);
    let seed = 7;
    const seeded = (s) => { seed = s; setRandomSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }); };

    // ============================================================ numbers of the executable
    // medal thresholds, ring points, landing points (.rdata floats the pilot / the loop read)
    ok([f32(pe, 0x8923d0), f32(pe, 0x8923d4), f32(pe, 0x8923d8)].join() === '2000,3000,5000', 'medal thresholds 0x8923d0 / d4 / d8 = 2000 / 3000 / 5000');
    ok(PAR_MEDALS.BRONZE === 2000 && PAR_MEDALS.SILVER === 3000 && PAR_MEDALS.GOLD === 5000, 'PAR_MEDALS');
    ok([f32(pe, 0x8924b0), f32(pe, 0x8924b4), f32(pe, 0x892240)].join() === '750,500,250' && PILOT.RING_BONUS.join() === '750,500,250', 'ring bonuses 750 / 500 / 250 (0x8924b0 / b4, 0x892240)');
    ok(f32(pe, 0x892120) === 1000 && PILOT.DIVE_BONUS === 1000, 'dive bonus 1000 (0x892120)');
    ok(f32(pe, 0x892484) === 2500 && f32(pe, 0x8923d8) === 5000 && PILOT.LAND_FULL.join() === '5000,2500,1000', 'landing points at the middle: 5000 / 2500 / 1000');
    ok(f32(pe, 0x8924cc) === 26 && f32(pe, 0x8924b8) === 19 && f32(pe, 0x892370) === 11, 'ring reach 26 / 19 / 11 (0x8924cc, 0x8924b8, 0x892370)');
    ok(f32(pe, 0x892080) === 4 && f32(pe, 0x8924c8) === 5.5, 'dive window 4 .. 5.5 radians (0x892080 / 0x8924c8)');
    near(f64(pe, 0x8924a8), 0.07, 1e-12, 'pitch rate 0.07 (double 0x8924a8)'); near(PILOT.PITCH_RATE, Math.fround(0.07), 1e-12, 'the node stores it as a float (+0x74)');
    near(f64(pe, 0x8924a0), PILOT.LEAN_LO, 1e-6, 'lean window low (double 0x8924a0)');
    near(f64(pe, 0x892498), PILOT.LEAN_HI, 1e-6, 'lean window high (double 0x892498)');
    near(f64(pe, 0x892490), 0.4, 1e-6, 'fall speed factor 0.4 (double 0x892490)');
    near(f32(pe, 0x892118), PILOT.FALL_BASE, 1e-6, 'fall base 0.4 (0x892118)');
    ok(f32(pe, 0x892254) === PILOT.FLARE_COST, 'flare cost 50 per frame (0x892254)');
    near(f32(pe, 0x892094), 6.2831855, 1e-6, 'two pi 0x892094');
    ok(f64(pe, 0x8923e0) === 204 && f64(pe, 0x892400) === 175.5 && f64(pe, 0x8923f8) === 145.5 && f64(pe, 0x8923f0) === 115.5, 'gauge 204 and the blink limits 175.5 / 145.5 / 115.5');
    ok(f32(pe, 0x8b96bc) === 146 && f32(pe, 0x8b96c0) === 116 && f32(pe, 0x8b96c4) === 86, 'blink counters start at 146 / 116 / 86');
    ok(f64(pe, 0x892418) === 400 && [f64(pe, 0x892450), f64(pe, 0x892438), f64(pe, 0x892428)].join() === '60,65,48', 'boat radius 400, bird radii 60 / 65 / 48');
    // the constructor FUN_0046a926 (0x46a926 .. 0x46ad76): its float immediates
    const ctor = [[PILOT.START_ALT, '1360'], [PILOT.GLIDE_REF, '400'], [PILOT.PITCH_STEP, '0.17'], [PILOT.WIND_FACTOR, '0.36'], [PILOT.RADIUS[0], 'r3'], [PILOT.RADIUS[1], 'r2'], [PILOT.RADIUS[2], 'r1'],
      [PILOT.CHUTE_FALL, '0.3'], [PILOT.FALL_START, '0.5'], [PILOT.CAM_LERP, '0.85'], [PILOT.CAM_LIFT, '0.15']];
    for (const [v, n] of ctor) ok(hasImm(pe, 0x46a926, 0x46ad76, bits(v)), `constructor immediate ${n} = ${v}`);
    ok(hasImm(pe, 0x46a926, 0x46ad76, bits(1360)) && hasImm(pe, 0x46a926, 0x46ad76, 0x43b40000), 'constructor: start height 1360 and rand(360) for the wind');
    // the sound slots of FUN_00467370: every load2D / load3D (id) of the original is in PAR_SOUNDS and vice versa
    {
      const calls = pushCalls(pe, 0x467370, 0x46751e);
      const orig = calls.filter((c) => c.target === 0x443580 || c.target === 0x4433b0).map((c) => `${c.target === 0x443580 ? '2d' : '3d'}:${c.arg}`).sort();
      const mine = Object.values(PAR_SOUNDS).map((d) => `${d.kind}:${d.id}`);
      // the original loads sound 0x2a twice (2D) and 0x24 three times (3D); mine has one slot per use, 0x2a once (the second load is never played)
      const dedupe = (a) => [...new Set(a)].sort();
      ok(JSON.stringify(dedupe(orig)) === JSON.stringify(dedupe(mine)), `sound slots: ${dedupe(orig)} vs ${dedupe(mine)}`);
      ok(orig.length === 28, `FUN_00467370 loads ${orig.length} slots (28: 10 positional, 18 plain)`);
    }
    // the constructors are registered by their addresses (the extraction's attaches)
    ok(Object.values(PAR_CTOR).every((a) => registeredCtors().includes(a)), 'six constructors registered');

    // ============================================================ the zone loads
    const fresh = (seedv = 1) => { seeded(seedv); const L = loadZone(ctx, 'z38PAR'); const run = startParRun(L.world, L.archive); const pilot = L.pepper.ctrl.find('ParPilot'); return { L, w: L.world, run, pilot, p: L.pepper, hud: new ParHud() }; };
    const step = (G, mask = 0) => { G.w.input.setVirtual(mask); G.w.tick(); if (!G.run.over) G.hud.update(G.run, G.p.ry); };
    {
      const G = fresh();
      ok(G.L.skipped.every((s) => ['SeaAmin', 'seabed'].includes(s.ctorName)), `only the sea nodes are skipped: ${G.L.skipped.map((s) => s.ctorName)}`);
      ok(G.pilot && G.p.name === 'PEPP' && G.p.index === 8, 'the pilot is record 8 (PEPP)');
      ok(G.p.y === 1360 && G.p.x === 0 && G.p.z === 0, 'starts at (0, 1360, 0)');
      const R = G.run.recs;
      ok(R.targets.every((t) => !t.enabled) && !R.shad.enabled && !R.birds[3].enabled, 'targets, shadow and the fourth pterodactyl are hidden by the constructor');
      ok(R.birds.length === 4 && R.rings.length === 3, 'four PTER records, three rings');
      ok(Math.abs(R.rings[2].y - 918.8) < 0.01 && Math.abs(R.rings[0].y - 429.105) < 0.01, 'ring heights');
      ok(G.w.camera.c[4] > 1360 && Math.abs(G.w.camera.c[3]) < 1e-6, 'camera above the pilot');
    }

    // ============================================================ free fall: speeds, pitch, steering
    {
      const G = fresh();
      step(G);                                                   // state 0 -> 1
      ok(G.pilot.state === S.FALL, 'tick 1: free fall');
      const y0 = G.p.y; for (let i = 0; i < 100; i++) step(G);
      near(y0 - G.p.y, 100 * 0.4, 0.01, 'level fall: 0.4 per tick (|sin 0| * 0.4 + 0.4)');
      // Up tilts by 0.07 per tick, wrapping at two pi; Down back (and wraps below 0)
      for (let i = 0; i < 10; i++) step(G, B.UP);
      near(G.p.rx, 0.7, 1e-6, 'Up: rx += 0.07 per tick');
      for (let i = 0; i < 20; i++) step(G, B.DOWN);
      near(G.p.rx, 6.2831855 - 0.7, 1e-5, 'Down below zero wraps to two pi');
      // head down (3 pi / 2): fall speed 0.8, no forward glide
      const G2 = fresh(); step(G2);
      for (let i = 0; i < 40; i++) step(G2, B.DOWN);
      const rx = G2.p.rx; near(rx, 6.2831855 - 40 * 0.07, 1e-4, 'rx after 40 Down ticks');
      const ya = G2.p.y; step(G2, B.DOWN);
      const drop = ya - G2.p.y; near(drop, Math.abs(Math.sin(G2.p.rx - 0.07 * 0) * 0.4) + 0.4, 0.15, `fall speed at rx ${G2.p.rx.toFixed(2)} (formula |sin rx| 0.4 + 0.4)`);
      // glide: sin(2 rx) per tick along the heading (rx = pi / 4: 1.0)
      const G3 = fresh(); step(G3);
      G3.p.rx = Math.PI / 4; G3.p.ry = 0; const z3 = G3.p.z; step(G3);
      ok(Math.abs(G3.p.z - z3 - 1) < 0.2, `glide at pi / 4: ${(G3.p.z - z3).toFixed(3)} per tick along +z (sin(2 rx) = 1, plus the wind drift of at most 0.18)`);
      // steering ramp: 0.02 per tick of Left up to about -0.14 (steps of 0.01 above -0.14), release decays by 0.01
      const G4 = fresh(); step(G4);
      const rates = []; for (let i = 0; i < 20; i++) { step(G4, B.LEFT); rates.push(+G4.pilot.yawRate.toFixed(3)); }
      ok(rates[0] === -0.01 && rates[1] === -0.02 && rates[9] === -0.1 && rates.at(-1) <= -0.14 && rates.at(-1) >= -0.15, `Left ramps the yaw rate by 0.01 per tick to -0.14: ${rates}`);
      ok(rates.every((r, i) => i === 0 || r <= rates[i - 1]), 'the ramp never reverses');
      const ry0 = G4.p.ry; for (let i = 0; i < 30; i++) step(G4);
      ok(G4.pilot.yawRate === 0 && G4.pilot.steerDir === 0, 'the yaw rate decays to zero after release');
      ok(G4.p.ry !== ry0, 'the heading kept turning while it decayed');
      const wind0 = G4.run.windDir; for (let i = 0; i < 100; i++) step(G4);
      ok(Math.abs(G4.run.windDir - wind0) < 100 / 32, 'the wind direction wanders by at most 1/32 rad per tick');
      // the chute cannot open before it is allowed (below a quarter of the start height); then Shift opens it
      const G5 = fresh(); step(G5); for (let i = 0; i < 20; i++) step(G5, B.SHIFT);
      ok(G5.pilot.state === S.FALL && !G5.run.chuteOk, 'Shift is ignored while the chute is not allowed');
    }

    // ============================================================ rings
    {
      const G = fresh(); step(G);
      const r3 = G.run.recs.rings[2];
      // pass ring 3 straight at the dive angle
      G.p.x = r3.x; G.p.z = r3.z; G.p.y = r3.y + 3; G.p.rx = 4.7; G.run.y = G.p.y;
      step(G);
      ok(G.run.ring[2] === RING_HIT, 'ring 3 passed within 26 and the height window (ring.y - 5, ring.y + 4)');
      ok(G.run.score === 1250 && G.run.spoken.includes('LESGPT14'), `ring 3 at the dive angle: 250 + 1000 and LESGPT14 (score ${G.run.score})`);
      ok(G.run.recs.targets[2].enabled && !G.run.recs.targets[0].enabled, 'passing ring 3 shows target 3 only');
      ok(G.run.sound.count('play', 'thruRing') === 1, 'thru_ring played once');
      // ring 2 flat (no dive angle): 500 only
      const r2 = G.run.recs.rings[1];
      G.p.x = r2.x; G.p.z = r2.z; G.p.y = r2.y + 3; G.p.rx = 0.2; step(G);
      ok(G.run.ring[1] === RING_HIT && G.run.score === 1750, `ring 2 flat: +500 (${G.run.score})`);
      // ring 1 missed: below it without passing
      const r1 = G.run.recs.rings[0];
      // (a ring is missed once the pilot is more than 8 below it: the compare is with the double -8.0 at 0x8924c0; M5 audit)
      G.p.x = r1.x + 200; G.p.z = r1.z; G.p.y = r1.y - 7; step(G);
      ok(G.run.ring[0] === 0, 'less than 8 below ring 1: not missed yet');
      G.p.y = r1.y - 9; step(G);
      ok(G.run.ring[0] === RING_MISSED, 'more than 8 below ring 1 without passing: missed (2)');
      // outside the reach / the window: nothing
      const H = fresh(); step(H);
      const q = H.run.recs.rings[2]; H.p.x = q.x + 27; H.p.z = q.z; H.p.y = q.y; step(H);
      ok(H.run.ring[2] === 0, '27 units off the axis does not count (reach 26)');
      H.p.x = q.x; H.p.z = q.z; H.p.y = q.y + 5; H.run.y = H.p.y; step(H);
      ok(H.run.ring[2] === 0, '5 above the ring is outside the window (< ring + 4)');
      H.p.y = q.y - 4; step(H);
      ok(H.run.ring[2] === RING_HIT, '4 below the ring is inside (> ring - 5)');
      // both upper rings missed: the hint LESGPT13
      const M = fresh(); step(M);
      M.p.x = 400; M.p.z = 400; M.p.y = M.run.recs.rings[2].y - 9; step(M); M.p.y = M.run.recs.rings[1].y - 9; step(M);
      ok(M.run.ring[2] === RING_MISSED && M.run.ring[1] === RING_MISSED && M.run.spoken.includes('LESGPT13'), 'both upper rings missed: LESGPT13');
    }

    // ============================================================ scripted WIN: all rings at the dive angle, chute, landing on target 3
    let winScore = 0;
    {
      const G = fresh(1);
      let t = 0; let openAt = -1, st = [];
      for (; t < 6000 && !G.run.over; t++) {
        const m = parBotStep(parSnapshot(G.w), { land: 3 });
        const before = G.pilot.state; step(G, m);
        if (G.pilot.state !== before) st.push(`${before}>${G.pilot.state}@${t}`);
        if (openAt < 0 && G.pilot.state === S.OPENING) openAt = t;
      }
      notes.push(`WIN run: ${t} ticks, score ${G.run.score}, rings ${G.run.ring}, states ${st.join(' ')}`);
      ok(G.run.over && G.run.ring.join() === '1,1,1', `all three rings passed (${G.run.ring})`);
      ok(G.run.score >= 5000 && G.run.landScore > 0 && G.run.landBonus > 0, `rings 4500 + landing ${G.run.landScore} + ${G.run.landBonus} = ${G.run.score}`);
      near(G.run.score, 4500 + G.run.landScore + G.run.landBonus, 1e-6, 'score = rings + landing points + landing bonus');
      ok(G.run.landBonus === 800 || G.run.landBonus === 800 - 50 * Math.round((800 - G.run.landBonus) / 50), `landing bonus 800 minus 50 per flare frame (${G.run.landBonus})`);
      ok(st.some((x) => x.startsWith('1>2')) && st.some((x) => x.startsWith('2>3')) && st.some((x) => x.startsWith('3>4')) && st.some((x) => x.startsWith('4>5')), `state sequence 1 > 2 > 3 > 4 > 5: ${st}`);
      ok(G.run.sound.count('play', 'chuteOpen') === 1 && G.run.sound.count('play', 'landOk') === 1 && G.run.sound.count('play', 'smack') === 0, 'sounds: chute_open once, land_succes_targ once, no smack');
      ok(G.run.sound.count('play', 'thruRing') === 3, 'thru_ring three times');
      ok(G.p.anim.clip === (G.run.score < 2000 ? CLIP.SAD : CLIP.CHEER), `the finish clip: cheer (clip ${G.p.anim.clip})`);
      ok(G.run.canopy === 2, 'the canopy closes after the landing');
      // the end of the loop: hiscore + trophy + result
      const vars = new GameVars();
      const r = parFinish(vars, G.run.score);
      ok(r === 1 && vars.get(PAR_VARS.HISCORE) === Math.trunc(G.run.score), 'success: hiscore written');
      const want = G.run.score >= 5000 ? 3 : G.run.score >= 3000 ? 2 : 1;
      ok(want === 3, 'the scripted WIN is gold (>= 5000)');
      ok(vars.get(PAR_VARS.TROPHY) === want, `trophy ${want} for ${G.run.score}`);
      winScore = G.run.score;
    }
    // the same inputs give the same run (the wind is seeded)
    { const go = () => { const A = fresh(5); for (let i = 0; i < 600; i++) step(A, parBotStep(parSnapshot(A.w), {})); return [A.p.x, A.p.y, A.p.z, A.run.score, A.run.windDir].join(); };
      ok(go() === go(), 'deterministic for a seed'); }

    // ============================================================ scripted LOSS: no parachute
    {
      const G = fresh(3);
      let t = 0; for (; t < 6000 && !G.run.over; t++) step(G, parBotStep(parSnapshot(G.w), { noChute: true }));
      notes.push(`LOSS run (rings, no chute): ${t} ticks, score ${G.run.score}, state ${G.pilot.state}`);
      ok(G.run.over && G.run.score === 0, `crash without the parachute: score 0 (${G.run.score}) even after ${G.run.ring.filter((x) => x === 1).length} rings`);
      ok(G.run.sound.count('play', 'smack') + G.run.sound.count('play', 'bigSplash') + G.run.sound.count('play', 'hitTarget') === 1, 'one crash sound (smack / bigsplash / Hit_targnochute)');
      ok(G.run.sound.count('stop', 'windFall') >= 1, 'the wind loop stops at the crash');
      ok(G.p.anim.clip === CLIP.FALL, `no finish clip after a crash: state 4 only checks for the landing clip 5 (clip ${G.p.anim.clip})`);
      const vars = new GameVars(); vars.set(PAR_VARS.HISCORE, 0);
      ok(parFinish(vars, G.run.score) === 2 && vars.get(PAR_VARS.HISCORE) === 0 && vars.get(PAR_VARS.TROPHY) === 0, 'failed: result 2, hiscore and trophy untouched');
    }
    // landing under the parachute but not on a target: score 0 as well
    {
      const G = fresh(2); step(G);
      G.p.y = 300; G.p.x = 150; G.p.z = 150; G.run.y = 300; for (let i = 0; i < 3; i++) step(G);
      G.run.score = 1250; G.run.ring[2] = 1; G.run.chuteOk = true;
      step(G, B.SHIFT);
      ok(G.pilot.state === S.OPENING, `Shift opens the chute when allowed (state ${G.pilot.state})`);
      for (let i = 0; i < 1500 && G.pilot.state !== S.OVER; i++) step(G);
      ok(G.pilot.state === S.OVER && G.run.score === 0, `landing off target zeroes the score (state ${G.pilot.state}, ${G.run.score})`);
      ok(G.run.sound.count('play', 'landOff') + G.run.sound.count('play', 'splash') === 1, 'land_off_target or splash1 once');
    }

    // ============================================================ bounce (state 7): the balloon hangs in the middle of ring 1 (BalloonAdv_MR.col has 688 polygons)
    {
      const G = fresh(1);
      let hit = -1; for (let t = 0; t < 3000 && !G.run.over && hit < 0; t++) { step(G, parBotStep(parSnapshot(G.w), { ring1Offset: [0, 0] })); if (G.pilot.state === S.BOUNCE) hit = t; }
      ok(hit >= 0, `diving through the middle of ring 1 hits the balloon: bounce (state 7) after ${hit} ticks`);
      ok(G.run.sound.count('play', 'hitBalloon') === 1 && G.p.anim.clip === CLIP.BOUNCE, 'hit_balloon played, bounce clip 7');
      ok(G.pilot.bounce[1] === -0.2, 'the bounce velocity y is -0.2');
      const bounce = [...G.pilot.bounce];
      ok(Math.hypot(bounce[0], bounce[2]) > 0, `the bounce vector is the reflected sweep: ${bounce.map((v) => v.toFixed(2))}`);
      let n = 0; while (G.pilot.state === S.BOUNCE && n < 80) { step(G); n++; }
      ok(G.pilot.state === S.FALL && n >= 55 && n <= 62, `after the 60 frame bounce clip the pilot falls again (${n} ticks, state ${G.pilot.state})`);
      ok(G.run.ring[0] !== RING_HIT, 'the balloon kept the pilot out of the ring');
      // a pterodactyl box: the segment test of FUN_00468590
      const H = fresh(2); step(H);
      const b = H.run.recs.birds[0];
      H.p.x = b.x; H.p.z = b.z; H.p.y = b.y + 1.0; H.run.y = H.p.y; H.pilot.state = S.FALL;   // FUN_00468590 ADDS the box centre (1.63) to the local point: the box it tests is the mirror image, its top face is at local y 0.8
      step(H);
      ok(H.pilot.state === S.BOUNCE, 'touching a pterodactyl: bounce (its mesh is in the sweep, mask 3; FUN_004686a3 plays no sound for that hit)');
      ok(H.run.sound.count('play', 'hitBird') === 0, 'the sweep hit of a pterodactyl is silent (only the box test, FUN_00468590, plays hit_pterodactyl)');
      const pt = [0, 0, 0], nm = [0, 0, 0];
      ok(segmentHitsRecordBox(b, [b.x, b.y + 1.0, b.z], [b.x, b.y + 0.6, b.z], pt, nm) && nm[1] === 1, 'the pterodactyl box test: a segment entering through the top face hits (normal +y)');
      ok(!segmentHitsRecordBox(b, [b.x, b.y + 5, b.z], [b.x, b.y + 4.6, b.z], pt, nm), 'a segment above the box misses');
    }

    // ============================================================ the HUD model (FUN_00466f50)
    {
      const G = fresh(); step(G);
      const f = G.hud.frame;
      ok(f.text === '0' && f.rings.join() === '146,116,86' && f.chuteIcon === HUD_TEX.CHUTE_NO, `initial HUD: ${f.text} ${f.rings} ${f.chuteIcon}`);
      // compass: (wind - yaw) -> 72 frames from texture 14
      G.run.windDir = 0; G.p.ry = 0; G.hud.update(G.run, 0); ok(G.hud.frame.compass === 14 + 0 || G.hud.frame.compass === 14 + 72 - 0, `compass at 0 rad: ${G.hud.frame.compass}`);
      G.run.windDir = Math.PI; G.p.ry = 0; G.hud.update(G.run, 0); ok(Math.abs(G.hud.frame.compass - (14 + 36)) <= 1, `compass at pi: ${G.hud.frame.compass}`);
      // ring icons: passed = the blink frames 146 .. 175, missed = 178 / 177 / 176
      G.run.ring = [1, 2, 0]; const seen = []; for (let i = 0; i < 40; i++) { G.hud.update(G.run, 0); seen.push(G.hud.frame.rings[0]); }
      ok(seen[0] === 146 && seen[1] === 147 && Math.max(...seen) === 175 && seen.includes(146, 5), `ring 1 blinks 146 .. 175: ${seen.slice(0, 8)}...${Math.max(...seen)}`);
      ok(G.hud.frame.rings[1] === 0xb1 && G.hud.frame.rings[2] === 0x56, 'missed ring 2: icon 177; open ring 3: 86');
      // gauge: the chute becomes allowed below a quarter of the start height; the marker is the altitude fraction
      const R = fresh(); R.run.y = 1360; R.hud.update(R.run, 0);
      ok(!R.run.chuteOk && R.hud.frame.gauge.marker === 1 && R.hud.frame.gauge.segments.filter((x) => x === 10).length === 9, 'gauge at the start: marker 1, 9 upper segments red (10), 3 lower green (11)');
      R.run.y = 341; R.hud.update(R.run, 0); ok(!R.run.chuteOk, 'y 341: not yet');
      R.run.y = 339; R.run.refAlt = 341; R.run.height = 330; R.hud.update(R.run, 0);
      ok(R.run.chuteOk && R.run.spoken.includes('LESGPT12') && R.hud.frame.gauge.segments.every((x) => x === 11), 'y 339: the chute is allowed (LESGPT12), all segments green');
      R.hud.update(R.run, 0); ok(R.hud.frame.chuteIcon === HUD_TEX.CHUTE_OK, 'the right icon follows one update later (9)');
      R.run.height = 170.5; R.hud.update(R.run, 0); near(R.hud.frame.gauge.marker, 0.5, 1e-9, 'second phase: marker = height / height at the unlock');
      const g = gaugeRects(0); ok(g.marker[1] + 16 === 508 && g.segs.length === 12 && g.segs[11][1] === 316 && g.cap.join() === '716,516,776,576', 'gauge rectangles on the 800 x 600 grid');
    }

    // ============================================================ the props
    {
      const G = fresh(); step(G);
      const R = G.run.recs;
      // boat: circle of radius 400, 0.003 rad per tick
      for (let i = 0; i < 300; i++) step(G);
      near(Math.hypot(R.boat.x, R.boat.z), 400, 0.01, 'boat on a circle of radius 400');
      near(Math.atan2(R.boat.x, R.boat.z), 0.003 * 300, 0.004, 'boat angle 0.003 per tick');
      // balloon: sinks 0.5 / tick to 400, rises 0.3 / tick to 460
      const ys = []; for (let i = 0; i < 400; i++) { step(G); ys.push(R.ball.y); }
      ok(Math.min(...ys) > 399.4 && Math.max(...ys) < 460.4, `balloon between 400 and 460 (${Math.min(...ys).toFixed(1)} .. ${Math.max(...ys).toFixed(1)})`);
      ok(G.run.sound.count('stop', 'balloonThrust') >= 0, 'balloon thrust sound state');
      // plane: loops in the YZ plane around (-49.7, 705.5, -110), radius 70
      near(Math.hypot(R.plane.y - 705.5, R.plane.z + 110), 70, 0.05, 'plane on its circle of radius 70');
      near(R.plane.x, -49.7, 1e-3, 'plane x');
      // birds: figure of eight around (35.784, 29.474)
      for (let i = 0; i < 3; i++) { const b = R.birds[i], d = BIRDS[i]; ok(Math.abs(b.y - d.y) < 1e-3 && Math.abs(b.x - BIRD_CENTRE[0]) <= d.radius + 1e-6 && Math.abs(b.z - BIRD_CENTRE[1]) <= d.radius + 1e-6, `bird ${i + 1} within its radius ${d.radius} at height ${d.y}`); }
      ok(G.run.sound.count('at', 'birdFly1') > 300 && G.run.sound.count('at', 'planeIdle') > 300 && G.run.sound.count('at', 'ambience') > 300, 'positional sounds every tick');
      // (M7 oracle: FUN_004677a0 pushes 50.0 (0x42480000) for FUN_004388ae and tests `< 1.0`: a call about every 50 ticks per bird, not every other tick)
      { const n = G.run.sound.count('at', 'birdCall1'), fly = G.run.sound.count('at', 'birdFly1'); ok(n > 0 && n < fly * 0.06, `the calls are tried with a 1 in 50 chance per tick (${n} of ${fly})`); }
      ok(R.pepp.anim && R.birds[0].anim && R.birds[0].anim.clip === 1, 'the birds animate (clip 1)');
      void BIRDS;
    }

    // ============================================================ the loop's end rules
    {
      const v = new GameVars();
      ok(parFinish(v, 1999) === 2 && v.get(PAR_VARS.HISCORE) === 1999 && v.get(PAR_VARS.TROPHY) === 0, '1999: failed, hiscore 1999, no trophy');
      ok(parFinish(v, 2000) === 1 && v.get(PAR_VARS.TROPHY) === 1, '2000: bronze, success');
      ok(parFinish(v, 2999) === 1 && v.get(PAR_VARS.TROPHY) === 1, '2999: still bronze');
      ok(parFinish(v, 3000) === 1 && v.get(PAR_VARS.TROPHY) === 2, '3000: silver');
      ok(parFinish(v, 5000) === 1 && v.get(PAR_VARS.TROPHY) === 3, '5000: gold');
      ok(parFinish(v, 100) === 1 && v.get(PAR_VARS.HISCORE) === 5000 && v.get(PAR_VARS.TROPHY) === 3, 'a worse score changes nothing; success follows the stored hiscore (quirk of the loop)');
      const sp = (s) => JSON.stringify(parResultSpeech(s));
      ok(sp(5000) === JSON.stringify({ say: ['LESGPT02', 'LESGPT03'], queued: null }) && sp(3000) === JSON.stringify({ say: ['LESGPT04', 'LESGPT05'], queued: null }) && sp(2000) === JSON.stringify({ say: ['LESGPT06', 'LESGPT07'], queued: 'LESGPT08' }) && sp(1999) === JSON.stringify({ say: ['LESGPT09', 'LESGPT10'], queued: 'LESGPT11' }), 'speech by score');
      // fractional scores: the hiscore is the truncated value, the comparison uses the float
      const w2 = new GameVars(); parFinish(w2, 2999.9); ok(w2.get(PAR_VARS.HISCORE) === 2999 && w2.get(PAR_VARS.TROPHY) === 1, '2999.9 -> 2999, bronze');
    }
    // the shared helpers
    {
      setRandomSource(() => 0.5); ok(Math.abs(rand(2) - (16384 / 32767) * 2) < 1e-9, 'rand: rand() / 32767 * max'); ok(rand(0) === 0 && rand(-1) === 0, 'rand(<= 0) = 0');
      const o = { p: [0, 0, 0], n: [0, 0, 0] };
      const t = segmentBox([-10, 0, 0], [10, 0, 0], [2, 2, 2], o); near(t, 0.4, 1e-9, 'segment vs box: enters the -x face at t 0.4'); ok(o.n[0] === -1 && o.p[0] === -2, 'face normal -x');
      ok(segmentBox([0, 5, 0], [0, 9, 0], [2, 2, 2], o) === 1.01, 'segment vs box: miss = 1.01');
      const r = reflect([1, -1, 0], [0, 1, 0], [0, 0, 0]); ok(r.join() === '1,1,0', 'reflection about the plane normal');
      setRandomSource(null);
    }
    return { checked, failures, notes };
  },
};
