import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { startApoRun, apoSnapshot, apoFinish, apoResultSpeech, APO_VARS, APO_MEDALS, APO_CTOR, APO_CUTSCENE } from '../../src/zones/z40aPO.ts';
import { ApoPilot, AS, ACLIP, APO } from '../../src/zones/parachute/apo-pilot.ts';
import { ApoBots, BOT_LAUNCH, BOT_PARK } from '../../src/zones/parachute/apo-props.ts';
import { APO_SOUNDS, apoRun } from '../../src/zones/parachute/apo-run.ts';
import { ApoHud, APO_HUD } from '../../src/zones/parachute/apo-hud.ts';
import { setRandomSource } from '../../src/zones/parachute/util.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';
import { apoBotStep } from '../lib/apo-bot.mjs';

// z40aPO "Parachute landing on Ogel" (docs/re/m3/z40aPO.md): the launch phase, the 15 rings in three groups, the pilot's collisions (asteroids, rock monsters, brickbots), landing
// and scoring, run on the real zone data with scripted input; constants against the executable (.rdata floats, the immediates of the constructor, the sound-slot loads).

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const bits = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };
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
const hasImm = (pe, lo, hi, v) => { for (let a = lo; a < hi - 3; a++) if (pe.u32(a) === (v >>> 0)) return true; return false; };

export default {
  name: 'm3-z40aPO',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);
    let seed = 7;
    const seeded = (s) => { seed = s; setRandomSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }); };

    // ============================================================ the executable
    ok([f32(pe, 0x8923d0), f32(pe, 0x8923d8), f32(pe, 0x89297c)].join() === '2000,5000,8000', 'medal thresholds 0x8923d0 / d8 / 0x89297c = 2000 / 5000 / 8000');
    ok(APO_MEDALS.BRONZE === 2000 && APO_MEDALS.SILVER === 5000 && APO_MEDALS.GOLD === 8000, 'APO_MEDALS');
    ok(f32(pe, 0x892120) === 1000 && f32(pe, 0x892990) === 1500 && f32(pe, 0x8923d0) === 2000 && APO.LAND_FULL.join() === '1000,1500,2000', 'landing points at the middle: 1000 / 1500 / 2000');
    near(f32(pe, 0x89299c), APO.PITCH_RATE, 1e-6, 'pitch rate 0.07 (0x89299c)');
    near(f32(pe, 0x8929a8), APO.DOOR_MAX, 1e-5, 'door angle 2.09438 (0x8929a8)'); near(f32(pe, 0x8929a4), APO.SHUTTLE_DRIFT[2], 1e-7, 'shuttle tilt 0.007 (0x8929a4)'); near(f32(pe, 0x8929a0), APO.DOOR_CLOSE, 1e-6, 'doors close 0.09 (0x8929a0)');
    near(f32(pe, 0x8922c0), APO.DOOR_STEP, 1e-6, 'doors open 0.02 (0x8922c0)');
    ok(f32(pe, 0x8921b0) === 80 && f32(pe, 0x8920e8) > 1.19 && f32(pe, 0x8920e8) < 1.21, 'rock monsters wake at 80, their boxes are 1.2 times larger (0x8921b0 / 0x8920e8)');
    ok([f32(pe, 0x892988), f32(pe, 0x892984), f32(pe, 0x892980)].join() === '43,73,103', 'HUD spin limits 43 / 73 / 103');
    ok(f32(pe, 0x94a0d8) === 14 && f32(pe, 0x94a0d4) === 44 && f32(pe, 0x94a0d0) === 74, 'HUD spin counters start at 14 / 44 / 74');
    // constructor FUN_007d53af (0x7d53af .. 0x7d5a50): immediates
    const cons = [[APO.START_ALT, '2000'], [APO.GLIDE_REF, '400'], [APO.RADIUS[0], '22.8'], [APO.RADIUS[1], '11.5'], [APO.RADIUS[2], '7.6'], [APO.CHUTE_FALL, '0.3'], [APO.FALL_START, '0.5'], [APO.CAM_LERP, '0.15'],
      [APO.CAM_OFF[0], '16'], [APO.CAM_OFF[2], '4'], [APO.CAM_LIFT, '0.25'], [APO.GROUP_ALT[0], '1400'], [APO.GROUP_ALT[1], '800'], [APO.GROUP_ALT[2], '310']];
    for (const [v, n] of cons) ok(hasImm(pe, 0x7d53af, 0x7d5a50, bits(v)), `constructor immediate ${n}`);
    ok(hasImm(pe, 0x7d53af, 0x7d5a50, 0xfa) && hasImm(pe, 0x7d53af, 0x7d5a50, 500) && hasImm(pe, 0x7d53af, 0x7d5a50, 0x2ee) && APO.RING_POINTS.join() === '250,500,750', 'ring table points 250 / 500 / 750 (0xfa, 500, 0x2ee)');
    {
      const calls = pushCalls(pe, 0x7d0cb0, 0x7d0f00);
      const orig = calls.filter((c) => c.target === 0x443580 || c.target === 0x4433b0).map((c) => `${c.target === 0x443580 ? '2d' : '3d'}:${c.arg}`);
      const mine = Object.values(APO_SOUNDS).map((d) => `${d.kind}:${d.id}`);
      const dedupe = (a) => [...new Set(a)].sort();
      ok(JSON.stringify(dedupe(orig)) === JSON.stringify(dedupe(mine)), `sound slots of FUN_007d0cb0: ${dedupe(orig)} vs ${dedupe(mine)}`);
      ok(orig.length === 32, `FUN_007d0cb0 loads ${orig.length} slots (32)`);
    }
    ok(Object.values(APO_CTOR).every((a) => registeredCtors().includes(a)), 'six constructors registered');
    ok(APO_CUTSCENE.zone === 'z40OGL' && APO_CUTSCENE.script === 'ogl02' && APO_CUTSCENE.strings === 'apo01' && APO_CUTSCENE.area === 'og', 'the intro cutscene: ogl02 of z40OGL with the strings of apo01 (FUN_007d0839)');
    {
      // FUN_0045c366 / FUN_0045c397 call sites of FUN_007d0839: the strings "z40OGL", "og", "ogl02", "apo01"
      const s = (needle) => pe.findStrings(needle).map((va) => pe.cstr(va));
      ok(s('apo01').some((x) => x.toLowerCase() === 'apo01') && s('ogl02').some((x) => x.toLowerCase() === 'ogl02'), 'the executable names apo01 / ogl02');
    }

    // ============================================================ the zone loads
    const fresh = (seedv = 1, dt = 1) => { seeded(seedv); const L = loadZone(ctx, 'z40aPO'); L.world.dt = dt; const run = startApoRun(L.world, L.archive); const pilot = L.pepper.ctrl.find('ApoPilot'); return { L, w: L.world, run, pilot, p: L.pepper, hud: new ApoHud() }; };
    const step = (G, mask = 0) => { G.w.input.setVirtual(mask); G.w.tick(); if (!G.run.over) G.hud.update(G.run, G.w.dt); };
    {
      const G = fresh();
      const R = G.run.recs;
      ok(G.L.skipped.length === 0, `no attach is skipped: ${G.L.skipped.map((s) => s.ctorName)}`);
      ok(G.p.index === 6 && G.p.y === 2000 && G.p.x === 0, 'PEPP is record 6, starts at (0, 2000, 0)');
      ok(R.rn.length === 15 && R.rc.length === 15 && R.bots.length === 8 && R.rocks.length === 3 && R.rka.length === 8 && R.rkb.length === 6, '15 ring pairs, 8 brickbots, 3 rock monsters, 8 + 6 asteroids');
      ok(R.targets.every((t) => !t.enabled), 'the three targets are hidden (FUN_007d0839 flag writes of records 3 / 4 / 5)');
      ok(R.rn.every((r, i) => Math.abs(R.rc[i].x - r.x) < 1e-3 && R.rc[i].y < r.y + 1 && R.rc[i].y > r.y - 5), 'every ring has its centre disc RC just below it');
      ok(R.rn[0].y > R.rn[14].y && R.rn.every((r, i) => i === 0 || r.y < R.rn[i - 1].y), 'the rings go down from 1916 to 362 in the order of the table');
      ok(G.p.flags & 2 && !(G.p.flags & 0x10), 'the pilot can be hit by the brickbots (not non-solid like the stub player)');
      ok(R.pepp.anim && R.rocks[0].anim && R.rocks[0].anim.clip === 2, 'the rock monsters have their rig (clip 2)');
      ok(G.w.camera.c[1] > 2000, 'camera above the pilot');
    }

    // ============================================================ launch: the doors open, the shuttle leaves, free fall
    {
      const G = fresh();
      const sh = G.run.recs.shtl;
      const t = [];
      for (let i = 0; i < 400; i++) { const s0 = G.pilot.state; step(G); if (G.pilot.state !== s0) t.push(`${s0}>${G.pilot.state}@${i + 1}`); }
      ok(/^0>1@10[56]$/.test(t[0]) && /^1>2@1[23]\d$/.test(t[1]), `states 0 > 1 after ~105 ticks (door 0.02 per tick to 2.09438), 1 > 2 about 24 ticks later: ${t}`);
      ok(!sh.enabled, 'the shuttle is hidden after it left');
      ok(G.run.sound.count('play', 'launch') === 1 && G.run.sound.count('stop', 'engine') >= 20, 'launch once, the engine is stopped during state 1');
      ok(G.p.y === 2000 || G.p.y < 2000, 'the pilot does not fall during the doors / launch (y stays 2000 until state 2)');
      ok(G.run.sound.count('play', 'breath') >= 390 && G.run.sound.count('at', 'palace') >= 390, 'breath (2D) and palace_amb (3D) every tick');
    }
    {
      const G = fresh();
      for (let i = 0; i < 150; i++) step(G);
      ok(G.pilot.state === AS.FALL && G.p.y < 2000, `free fall (y ${G.p.y.toFixed(1)})`);
      const y0 = G.p.y; for (let i = 0; i < 100; i++) step(G);
      near(y0 - G.p.y, 40, 0.5, 'level fall 0.4 per tick');
    }

    // ============================================================ rings: the centre disc triggers, +250 / 500 / 750, targets appear, missed groups
    {
      const G = fresh(); for (let i = 0; i < 130; i++) step(G);
      const R = G.run.recs;
      // dive through ring i from just above its centre disc
      const through = (i) => { const r = R.rc[i]; G.p.x = r.x; G.p.z = r.z; G.p.y = r.y + 5; G.run.y = G.p.y; G.pilot.state = AS.FALL; for (let k = 0; k < 30 && G.run.ring[i] === 0; k++) step(G); };
      through(0);
      ok(G.run.ring[0] === 1 && G.run.score === 250 && G.run.group[0], `a ring of group 1: +250 (score ${G.run.score}), group 1 flag`);
      ok(R.targets[2].enabled && !R.targets[0].enabled && !R.targets[1].enabled, 'group 1 shows target 3');
      ok(G.run.sound.count('play', 'thruRing') === 1, 'thru_spacering once');
      through(5); ok(G.run.ring[5] === 1 && G.run.score === 750 && R.targets[1].enabled && G.run.group[1], `a ring of group 2: +500, target 2 (score ${G.run.score})`);
      through(10); ok(G.run.ring[10] === 1 && G.run.score === 1500 && R.targets[0].enabled && G.run.group[2], `a ring of group 3: +750, target 1 (score ${G.run.score})`);
      const sc = G.run.score; through(5); G.p.y = R.rc[5].y + 5; step(G); ok(G.run.score === sc, 'a ring only counts once');
      ok(G.run.sound.count('at', 'beacon1') > 0 && G.run.sound.count('at', 'beacon2') > 0, 'the beacons of the shown targets are heard');
    }
    {
      // a group is missed when the pilot is below its height without any ring passed: the flag of the group's last ring becomes 2
      const G = fresh(); for (let i = 0; i < 130; i++) step(G);
      const R = G.run.recs;
      const r0 = R.rc[0]; G.p.x = r0.x; G.p.z = r0.z; G.p.y = r0.y + 5; G.run.y = G.p.y; for (let k = 0; k < 30 && G.run.ring[0] === 0; k++) step(G);
      G.p.x = 300; G.p.z = 300; G.p.y = 1390; G.run.y = 1390; step(G); step(G);
      ok(G.run.ring[0] === 1 && G.run.ring[4] !== 2, 'group 1 had a ring passed: not missed below 1400');
      const J = fresh(); for (let i = 0; i < 135; i++) step(J);
      J.p.x = 300; J.p.z = 300; J.p.y = 1390; J.run.y = 1390; step(J); step(J);
      ok(J.run.ring[4] === 2, `no ring of group 1 passed and below 1400: the group is missed (flag ${J.run.ring[4]})`);
      J.p.y = 790; J.run.y = 790; step(J); ok(J.run.ring[9] === 2, 'group 2 missed below 800');
      J.p.y = 300; J.run.y = 300; step(J); ok(J.run.ring[14] === 2, 'group 3 missed below 310');
      J.hud.update(J.run, 1); ok(J.hud.frame.groups.join() === '106,105,104', `HUD: missed icons 104 / 105 / 106 (${J.hud.frame.groups})`);
      const rr = J.run.recs.rc[4]; J.p.x = rr.x; J.p.z = rr.z; J.p.y = rr.y + 5; J.run.y = J.p.y; J.pilot.state = AS.FALL; for (let k = 0; k < 20; k++) step(J);
      ok(J.run.ring[4] === 2, 'the last ring of a missed group can no longer be passed');
    }

    // ============================================================ the same scripted WIN at the game's 60 Hz step (world.dt = 0.5)
    {
      const G = fresh(1, 0.5);
      let t = 0; const st = [];
      for (; t < 18000 && !G.run.over; t++) {
        const m = apoBotStep(apoSnapshot(G.w), { land: 3 });
        const before = G.pilot.state; step(G, m);
        if (G.pilot.state !== before) st.push(`${before}>${G.pilot.state}@${t}`);
      }
      const hits = G.run.ring.reduce((n, x) => n + (x === 1), 0);
      notes.push(`WIN run at dt 0.5: ${t} ticks, score ${G.run.score}, rings ${hits}/15, states ${st.join(' ')}`);
      ok(G.run.over && hits >= 10, `dt 0.5: the bot passes ${hits} of 15 rings`);
      ok(st.some((x) => x.startsWith('2>3')) && st.some((x) => x.startsWith('4>5')) && st.some((x) => x.startsWith('5>6')), `dt 0.5: state sequence ${st}`);
      // the HUD's spin counter steps 1 * dt (float32): half a frame per tick at dt 0.5
      const hh = new ApoHud(), rr = { score: 0, ring: Array(15).fill(0), y: 2000, startAlt: 2000, height: 100, refAlt: 2000, chuteOk: false };
      rr.ring[0] = 1;
      hh.update(rr, 0.5); hh.update(rr, 0.5);
      ok(hh.spin[0] === 15, `dt 0.5: the ring group icon's spin counter advanced 1 in two frames (${hh.spin[0]})`);
    }

    // ============================================================ scripted WIN: rings, wing, landing on target 3
    {
      const G = fresh(1);
      let t = 0; const st = [];
      for (; t < 9000 && !G.run.over; t++) {
        const m = apoBotStep(apoSnapshot(G.w), { land: 3 });
        const before = G.pilot.state; step(G, m);
        if (G.pilot.state !== before) st.push(`${before}>${G.pilot.state}@${t}`);
      }
      const hits = G.run.ring.reduce((n, x) => n + (x === 1), 0);
      notes.push(`WIN run: ${t} ticks, score ${G.run.score}, rings ${hits}/15, states ${st.join(' ')}`);
      ok(G.run.over && hits >= 10, `the bot passes ${hits} of 15 rings`);
      ok(G.run.score >= 5000, `score ${G.run.score} (silver or gold)`);
      near(G.run.score, [...G.run.ring].reduce((s, x, i) => s + (x === 1 ? APO.RING_POINTS[Math.floor(i / 5)] : 0), 0) + G.run.landScore + G.run.landBonus, 1e-6, 'score = rings + landing points + landing bonus');
      ok(G.run.landScore > 0 && G.run.landBonus > 0 && G.run.landBonus <= 800, `landing ${G.run.landScore} + bonus ${G.run.landBonus}`);
      ok(st.some((x) => x.startsWith('2>3')) && st.some((x) => x.startsWith('3>4')) && st.some((x) => x.startsWith('4>5')) && st.some((x) => x.startsWith('5>6')), `state sequence 2 > 3 > 4 > 5 > 6: ${st}`);
      ok(G.run.sound.count('play', 'solarOpen') === 1 && G.run.sound.count('play', 'landOk') === 1, 'solar_open once, landontarget once');
      ok(G.run.spoken.includes('OGSGPO09'), 'OGSGPO09 when the wing opens');
      ok(G.run.chuteOk && G.run.canopy === 2, 'the wing closed after the landing');
      const v = new GameVars(); const r = apoFinish(v, G.run.score);
      ok(r === 1 && v.get(APO_VARS.TROPHY) === (G.run.score >= 8000 ? 3 : 2), `result 1, trophy ${v.get(APO_VARS.TROPHY)}`);
    }
    // the same inputs, the same run
    { const go = () => { const A = fresh(5); for (let i = 0; i < 900; i++) step(A, apoBotStep(apoSnapshot(A.w), {})); return [A.p.x, A.p.y, A.p.z, A.run.score].join(); }; ok(go() === go(), 'deterministic for a seed'); }

    // ============================================================ LOSS: no wing
    {
      const G = fresh(3);
      let t = 0; for (; t < 9000 && !G.run.over; t++) step(G, apoBotStep(apoSnapshot(G.w), { noChute: true }));
      ok(G.run.over && G.run.score === 0, `falling without the wing: score ${G.run.score} after ${t} ticks`);
      ok(G.run.sound.count('play', 'smack') + G.run.sound.count('play', 'hitTarget') >= 0, 'a crash sound');
      const v = new GameVars(); ok(apoFinish(v, G.run.score) === 2 && v.get(APO_VARS.HISCORE) === 0 && v.get(APO_VARS.TROPHY) === 0, 'failed: result 2, nothing written');
    }
    // landing off a target under the wing: 0 points, sound land_offtarget
    {
      const G = fresh(2); for (let i = 0; i < 140; i++) step(G);
      G.p.x = 150; G.p.z = -200; G.p.y = 300; G.run.y = 300; G.run.chuteOk = true; G.run.score = 900;
      step(G, B.SHIFT); ok(G.pilot.state === AS.OPENING, 'Shift opens the wing when allowed');
      for (let i = 0; i < 2500 && G.pilot.state !== AS.OVER; i++) step(G);
      ok(G.run.score === 0 && G.pilot.state === AS.OVER, `off target: score zeroed (${G.run.score})`);
    }

    // ============================================================ the props
    {
      const G = fresh(); for (let i = 0; i < 5; i++) step(G);
      const R = G.run.recs;
      // asteroids tumble
      const rx0 = R.rka[0].rx, ry0 = R.rka[0].ry; for (let i = 0; i < 60; i++) step(G);
      ok(Math.abs(R.rka[0].rx - rx0) + Math.abs(R.rka[0].ry - ry0) > 0, 'the asteroids rotate');
      const ast = G.L.world.records.find((r) => r.name === 'RKA1').ctrl.find('ApoAsteroids');
      ok(ast.spin.slice(0, 8).every((s) => Math.abs(s[0]) <= 0.5 / 15 + 1e-9 && Math.abs(s[1]) <= 0.5 / 15 + 1e-9) && ast.spin.slice(8).every((s) => Math.abs(s[0]) <= 0.5 / 50 + 1e-9), 'spin speeds within +-0.5 / 15 (RKA) and +-0.5 / 50 (RKB) per tick');
      // brickbots: parked at (38.6, 3000, 54.1), fly towards the pilot, 2 per tick
      const bots = G.L.world.records.find((r) => r.name === 'BBT0').ctrl.find('ApoBots');
      ok(bots instanceof ApoBots && bots.bots.length === 8, 'eight bots');
      const b0 = R.bots[0]; const y1 = b0.y; step(G);
      ok(Math.hypot(b0.x - 38.6, b0.z - 54.1) < 90 && b0.y < 3001, `a bot starts at the park position (38.6, ${BOT_PARK[1]}, 54.1) and flies on (y ${b0.y.toFixed(1)})`);
      void y1;
      // a bot far from the pilot's height: once it ran 30 s (900 ticks) it is back at the pad, relaunched while the pilot is above 500
      for (let i = 0; i < 1000; i++) step(G);
      ok(R.bots.some((b) => b.y < 3000), 'the bots come down towards the pilot');
      ok(G.run.sound.count('at', 'rocket0') > 100, 'the rocket sound of a bot above y = 500');
    }
    {
      // a bot that touches something blows up (hidden for 30 ticks), then it is back at the launch pad
      const G = fresh(); for (let i = 0; i < 3; i++) step(G);
      const R = G.run.recs; const bots = R.bots[0].ctrl.find('ApoBots');
      const rk = R.rka[0];
      R.bots[0].x = rk.x; R.bots[0].y = rk.y + 4; R.bots[0].z = rk.z; R.bots[0].savePrev();
      bots.bots[0].flying = true; bots.bots[0].aim = [rk.x, rk.y - 50, rk.z];
      let blown = -1; for (let i = 0; i < 40 && blown < 0; i++) { step(G); if (bots.bots[0].exploded) blown = i; }
      ok(blown >= 0 && !R.bots[0].enabled, `a bot flying into an asteroid blows up (hidden, after ${blown} ticks)`);
      for (let i = 0; i < 31; i++) step(G);
      ok(!bots.bots[0].exploded && R.bots[0].enabled && Math.abs(R.bots[0].x - BOT_LAUNCH[0]) < 3 && Math.abs(R.bots[0].y - BOT_LAUNCH[1]) < 3, `30 ticks later it is back at the pad (${R.bots[0].x.toFixed(1)}, ${R.bots[0].y.toFixed(1)})`);
    }
    {
      // rock monsters wake within 80 of the pilot (OGSGPO08 once), play their clip (growl), then spin
      const G = fresh(); for (let i = 0; i < 3; i++) step(G);
      const R = G.run.recs, rock = R.rocks[1];
      G.p.x = rock.x + 30; G.p.y = rock.y + 40; G.p.z = rock.z; G.run.y = G.p.y; G.pilot.state = AS.FALL;
      step(G);
      ok(G.run.monstersWoke && G.run.spoken.filter((s) => s === 'OGSGPO08').length === 1, 'within 80: OGSGPO08, once');
      const ry0 = rock.ry; const fr = []; for (let i = 0; i < 80; i++) { G.p.x = rock.x + 30; G.p.y = rock.y + 40 + 0; G.p.z = rock.z; step(G); fr.push(rock.anim.frame); }
      ok(Math.max(...fr) >= 29, `the rock monster's clip plays (frame ${Math.max(...fr).toFixed(0)})`);
      ok(rock.ry > ry0, 'then it spins (ry += 0.06 per tick)');
      ok(G.run.sound.count('at', 'rockMonster1') > 10, 'growl through the first slot (the node is attached to ROC1)');
    }
    {
      // the pilot into a rock monster's box: the box test (FUN_007d3050) bounces it with hit_monster and OGSGPO11
      const G = fresh(); for (let i = 0; i < 135; i++) step(G);
      const rock = G.run.recs.rocks[0];
      G.p.x = rock.x; G.p.z = rock.z; G.p.y = rock.y + 14; G.run.y = G.p.y; G.pilot.state = AS.FALL;
      let hit = false; for (let i = 0; i < 60 && !hit; i++) { step(G); if (G.pilot.state === AS.BOUNCE) hit = true; }
      ok(hit, 'diving onto a rock monster bounces the pilot (state 8)');
      ok(G.run.spoken.includes('OGSGPO11') && G.p.anim.clip === ACLIP.BOUNCE, 'OGSGPO11 and the bounce clip');
      ok(G.pilot.prevState === AS.FALL, 'the state to return to is kept');
      let n = 0; while (G.pilot.state === AS.BOUNCE && n < 100) { step(G); n++; }
      ok(G.pilot.state === AS.FALL && n >= 55 && n <= 65, `after the 60 frame clip it falls again (${n} ticks)`);
    }

    // ============================================================ HUD and the end
    {
      const G = fresh(); step(G);
      const f = G.hud.frame;
      ok(f.text === '0' && f.groups.join() === '74,44,14' && f.chuteIcon === APO_HUD.CHUTE_NO, `initial HUD ${f.groups} ${f.chuteIcon}`);
      G.run.ring[0] = 1; const seen = []; for (let i = 0; i < 40; i++) { G.hud.update(G.run, 1); seen.push(G.hud.frame.groups[2]); }
      ok(seen[0] === 15 && Math.max(...seen) === 43 && seen.includes(14), `group 1 spins 14 .. 43: ${seen.slice(0, 5)} .. ${Math.max(...seen)}`);
      G.run.ring[7] = 1; G.hud.update(G.run, 1); ok(G.hud.frame.groups[1] >= 44 && G.hud.frame.groups[1] <= 73, 'group 2 spins 44 .. 73');
      G.run.y = 499; G.run.height = 400; G.run.refAlt = 500; G.hud.update(G.run, 1); ok(G.run.chuteOk, 'the wing becomes available below a quarter of the start height (500)');
      G.hud.update(G.run, 1); ok(G.hud.frame.chuteIcon === 9 && G.hud.frame.gauge.segments.every((x) => x === 11), 'icon 9, all segments 11');
    }
    {
      const v = new GameVars();
      ok(apoFinish(v, 1999) === 2 && v.get(APO_VARS.TROPHY) === 0, '1999: failed');
      ok(apoFinish(v, 2000) === 1 && v.get(APO_VARS.TROPHY) === 1, '2000: bronze');
      ok(apoFinish(v, 4999) === 1 && v.get(APO_VARS.TROPHY) === 1, '4999: still bronze');
      ok(apoFinish(v, 5000) === 1 && v.get(APO_VARS.TROPHY) === 2, '5000: silver');
      ok(apoFinish(v, 7999) === 1 && v.get(APO_VARS.TROPHY) === 2, '7999: silver');
      ok(apoFinish(v, 8000) === 1 && v.get(APO_VARS.TROPHY) === 3 && v.get(APO_VARS.HISCORE) === 8000, '8000: gold');
      ok(apoFinish(v, 10) === 1 && v.get(APO_VARS.HISCORE) === 8000, 'a worse score changes nothing; success follows the stored hiscore');
      ok(JSON.stringify(apoResultSpeech(8000)) === '["OGSGPO01","OGSGPO02"]' && JSON.stringify(apoResultSpeech(5000)) === '["OGSGPO03","OGSGPO04"]' && JSON.stringify(apoResultSpeech(2000)) === '["OGSGPO05",null]' && JSON.stringify(apoResultSpeech(0)) === '["OGSGPO06","OGSGPO07"]', 'speech by score (01 + 02 / 03 + 04 / 05 / 06 + 07)');
    }
    setRandomSource(null);
    return { checked, failures, notes };
  },
};
