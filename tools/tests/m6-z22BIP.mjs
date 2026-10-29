import fs from 'node:fs';
import { loadExe, loadZone, profileOf } from '../lib/engine-load.mjs';
import { oracleSpline, oracleFlight, oracleSequence, oracleMonkey, oracleRock, oracleProps } from '../lib/bip-oracle.mjs';
import { botButtons } from '../lib/bip-bot.mjs';
import '../../src/zones/z22BIP.ts';
import { prepareBip, BIP_TABLES } from '../../src/zones/z22bip/setup.ts';
import { PLANE, HIT_R2, SCORE, CTOR_WALK } from '../../src/zones/z22bip/plane.ts';
import { CTOR_TAKEOFF } from '../../src/zones/z22bip/takeoff.ts';
import { CTOR_LANDING } from '../../src/zones/z22bip/landing.ts';
import { CTOR_RECOVER } from '../../src/zones/z22bip/recover.ts';
import { CTOR_JOHNNY } from '../../src/zones/z22bip/johnny.ts';
import { CTOR_MONKEY } from '../../src/zones/z22bip/monkey.ts';
import { CTOR_ROCKY, ROCKY } from '../../src/zones/z22bip/rocky.ts';
import { CTOR_PSWITCH, CTOR_SEABED, CTOR_RIVER, CTOR_JERRYCAN, CTOR_PROP3, CTOR_ANIM_CROC, CTOR_ANIM_PARROT, CTOR_ROPE } from '../../src/zones/z22bip/props.ts';
import { SOUNDS, MODE, VAR_MODE } from '../../src/zones/z22bip/run.ts';
import { bipMedal, bipFinish, bipResultLines, BIP_VARS } from '../../src/zones/z22bip/rules.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

// z22BIP "the jungle biplane" (docs/re/m6/z22BIP.md): the original's node code run in the x86 interpreter next to the TypeScript port (spline, flight, take-off ->
// landing, monkeys, rock monsters, props), the constants and tables against the executable, the end rules, and whole flights on the real zone data (a passive plane that
// runs out of fuel, a scripted pilot that collects fuel and lands) with the zone's own collision.

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
const hasImm = (pe, lo, hi, v) => { for (let a = lo; a < hi - 3; a++) if (pe.u32(a) === (v >>> 0)) return true; return false; };
const bits = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };

export default {
  name: 'm6-z22BIP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);

    // ============================================================ numbers and tables of the executable
    // flight
    ok(f32(pe, 0x892394) === PLANE.SPEED_MAX && PLANE.SPEED_MAX === 400, 'top speed 400 (0x892394)');
    ok(f32(pe, 0x8928c0) === PLANE.FIRE_MIN_SPEED && PLANE.FIRE_MIN_SPEED === 320, 'bananas above speed 320 (0x8928c0)');
    ok(f32(pe, 0x892868) === PLANE.PITCH_TO_ALT && f32(pe, 0x892110) === PLANE.ALT_MAX && f32(pe, 0x892024) === PLANE.STALL_SPEED, 'pitch to altitude 1/64, ceiling 96, stall speed 12');
    near(f32(pe, 0x892118), PLANE.FALL_STALL, 1e-7, 'stall sink 0.4 (0x892118)');
    ok(f32(pe, 0x931ef8) === PLANE.FUEL_UNIT && f32(pe, 0x8928a8) === PLANE.SPEED_TURN && f32(pe, 0x892100) === PLANE.TURN_DIV, 'fuel unit 6825, speed factor 1/256, turn divisor 128');
    near(f32(pe, 0x8920d8), PLANE.BANK_K, 1e-9, 'pi / 180 (0x8920d8)');
    ok(f64(pe, 0x8928b0) === PLANE.SOUND_HZ_BASE && f64(pe, 0x8928b8) === PLANE.SOUND_HZ_PER_PITCH, 'engine sound rate 56750 - 65.5 * pitch (doubles 0x8928b0 / b8)');
    ok(f64(pe, 0x892890) === PLANE.HEADING_BAND && f64(pe, 0x892898) === -PLANE.HEADING_BAND, 'heading band +-0.9 (doubles 0x892890 / 98)');
    ok(f32(pe, 0x892254) === PLANE.FUEL_CAN && f32(pe, 0x892074) === PLANE.FUEL_LOW_SAY && f32(pe, 0x892060) === PLANE.FUEL_LOW_ALARM, 'fuel can 50 %, speech below 15 %, alarm below 10 %');
    // the hit tests and the medals (immediates of FUN_00709258 / FUN_00709fac)
    ok(hasImm(pe, 0x709258, 0x70988a, SCORE.MONKEY) && hasImm(pe, 0x709258, 0x70988a, HIT_R2.MONKEY) && hasImm(pe, 0x709258, 0x70988a, HIT_R2.BANT) && hasImm(pe, 0x709258, 0x70988a, HIT_R2.DTR), 'monkey 700 points, hit limits 92 / 32 / 48 (squared distances)');
    const hasBytes = (lo, hi, seq) => { for (let a = lo; a < hi - seq.length; a++) if (seq.every((v, k) => pe.at(a + k) === v)) return true; return false; };
    ok(hasBytes(0x709258, 0x70988a, [0x83, 0xc2, SCORE.TARGET]) && hasBytes(0x709258, 0x70988a, [0x83, 0xc2, SCORE.BANANA_TARGET]), 'rope target 100 (add edx, 0x64), banana target 20 (add edx, 0x14)');
    ok(hasImm(pe, 0x709fac, 0x70b572, PLANE.MEDAL_BASE) && hasImm(pe, 0x709fac, 0x70b572, PLANE.MEDAL_STEP) && hasImm(pe, 0x709fac, 0x70b572, PLANE.AMMO_BUNCH), 'medal base 3000, step 2000, banana bunch 500');
    ok(hasImm(pe, 0x70b7b2, 0x70bbeb, 1000) && hasImm(pe, 0x70b7b2, 0x70bbeb, PLANE.THRUST_MAX ? bits(PLANE.THRUST_MAX) : 0) && hasImm(pe, 0x70b7b2, 0x70bbeb, bits(PLANE.STEER_MAX)), 'constructor: 1000 bananas, thrust 323.2, steering 2.2');
    ok(hasImm(pe, 0x70e8b0, 0x70ea22, 0) && f64(pe, 0x892210) === 2, 'landing runway lift 2.0 (double 0x892210)');
    ok(f32(pe, 0x932130) === ROCKY.GRAVITY && pe.u32(0x93212c) === ROCKY.STONE_LIFE && pe.u32(0x932124) === ROCKY.NEAR2 && pe.u32(0x932120) === ROCKY.FAR2 && pe.u32(0x932138) === ROCKY.THROW_FRAME, 'rock monsters: gravity -0.04, stone life 300, 7200 / 9600, frame 87');
    // the vtables: update / draw addresses of every node (the ports are named after them)
    for (const [vt, upd, name] of [[0x931f00, 0x709fac, 'Walk'], [0x932040, 0x70c014, 'Takeoff'], [0x932108, 0x70ca17, 'Rocky'], [0x9321a8, 0x70d140, 'prop'], [0x932328, 0x70db60, 'csplane'],
      [0x932380, 0x70e010, 'River'], [0x9323d0, 0x70e42c, 'Landing'], [0x932498, 0x70ea60, 'RopeSld'], [0x932560, 0x70f433, 'monkey'], [0x932600, 0x70fdc0, 'Recover'], [0x9322d8, 0x70d960, 'JerryCan']]) {
      ok(pe.u32(vt) === upd, `${name}: update ${upd.toString(16)} is vtable slot 0 of ${vt.toString(16)}`);
    }
    // the constructors: every address the port registers is attached by the zone's set-up code
    const prof = profileOf(ctx, 'z22BIP');
    const attached = new Set(prof.setup.attaches.map((a) => a.ctor));
    for (const [n, c] of [['Walk', CTOR_WALK], ['Takeoff', CTOR_TAKEOFF], ['Landing', CTOR_LANDING], ['Recover', CTOR_RECOVER], ['csplane', CTOR_JOHNNY], ['Rocky', CTOR_ROCKY], ['PSwitch', CTOR_PSWITCH], ['SeaBed', CTOR_SEABED],
      ['River', CTOR_RIVER], ['JerryCan', CTOR_JERRYCAN], ['prop', CTOR_PROP3], ['croc', CTOR_ANIM_CROC], ['parrot', CTOR_ANIM_PARROT]]) ok(attached.has(c), `${n} (${c.toString(16)}) is attached by the set-up code`);
    ok(registeredCtors().includes(CTOR_WALK) && registeredCtors().includes(CTOR_ROCKY) && registeredCtors().includes(CTOR_JOHNNY), 'constructors registered');
    // the nodes attached from tables: their constructors are the pushed addresses of FUN_00707800
    ok(hasImm(pe, 0x70814f, 0x708344, CTOR_MONKEY) && hasImm(pe, 0x707800, 0x707da6, CTOR_ROPE), 'monkeys (0x70fafb, FUN_0070814f) and rope targets (0x70ed68, FUN_00707800) are attached from tables');
    // the tables read at run time
    {
      const rows = (base) => { const out = []; for (let a = base; (pe.u32(a) | 0) !== -1; a += 0x10) out.push([pe.u32(a), pe.u32(a + 4), pe.u32(a + 8), pe.u32(a + 12)]); return out; };
      const mk = rows(BIP_TABLES.MONKEYS), rp = rows(BIP_TABLES.ROPES);
      ok(mk.length === 16 && mk.every((r) => r[2] === 3 && (r[3] === 4 || r[3] === 1)), `16 monkeys, awake clip 3, hit clip 4 (or 1): ${mk.length}`);
      ok(rp.length === 13 && rp.every((r) => /^DTH\d+\.SRC$/i.test(pe.cstr(r[3]))), `13 rope targets with their DTHn.SRC: ${rp.length}`);
      const L = loadZone(ctx, 'z22BIP');
      ok(mk.every((r) => L.world.records[r[0]].name.startsWith('MNK')) && rp.every((r) => L.world.records[r[0]].name.startsWith('DTH') && L.world.records[r[1]].name.startsWith('SLD') && L.world.records[r[2]].name.startsWith('DTR')), 'table records have the names MNK / DTH-SLD-DTR');
    }
    // the sound slots of FUN_00708640: every load2D / load3D (id) is in SOUNDS and vice versa
    {
      const calls = pushCalls(pe, 0x708640, 0x708808);
      const orig = calls.filter((c) => c.target === 0x443580 || c.target === 0x4433b0).map((c) => `${c.target === 0x443580 ? '2d' : '3d'}:${c.arg}`).sort();
      const mine = Object.values(SOUNDS).map((d) => `${d.kind}:${d.id}`).sort();
      ok(JSON.stringify(orig) === JSON.stringify(mine), `sound slots: ${orig.length} loads, mine ${mine.length}`);
    }

    // ============================================================ the original's code against the port (x86 interpreter)
    const sections = [];
    const run = (name, fn) => {
      const t0 = Date.now();
      let r;
      try { r = fn(); } catch (e) { r = { checked: 0, failures: [`${name} crashed: ${e.stack || e}`], notes: [] }; }
      checked += r.checked; failures.push(...r.failures); notes.push(...r.notes.map((n) => `${n} (${Date.now() - t0} ms)`));
      sections.push([name, r]);
      return r;
    };
    run('spline', () => oracleSpline(ctx));
    const fl = run('flight', () => oracleFlight(ctx, 900));
    ok(fl.stats && fl.stats.score > 0 && fl.stats.monkeyHits >= 1 && fl.stats.targetHits >= 1 && fl.stats.bantHits >= 1 && fl.stats.fuelCans === 1 && fl.stats.bananaPickups === 1 && fl.stats.crashes === 1, `flight: the scripted run scored, hit a monkey, a banana target and a rope target, picked up a can and a bunch, crashed once: ${JSON.stringify(fl.stats)}`);
    const sq = run('sequence', () => oracleSequence(ctx, 4000));
    ok(sq.modes && sq.modes.join() === [MODE.TAKEOFF, MODE.FLY, MODE.RECOVER, MODE.FLY, MODE.LAND, MODE.FLY].join(), `sequence: modes ${sq.modes}`);
    ok(sq.result === 3, `sequence: landed, bronze (3): ${sq.result}`);
    const mo = run('monkey', () => oracleMonkey(ctx, 700));
    ok(mo.melonHits >= 1, `monkey: a melon hit the plane (${mo.melonHits})`);
    const rk = run('rock', () => oracleRock(ctx, 800));
    ok(rk.stoneHits >= 1, `rock: a stone hit the plane (${rk.stoneHits})`);
    run('props', () => oracleProps(ctx, 700));

    // ============================================================ the end rules
    {
      ok([0, 1, 2, 3, 4, 5, 6, 7].map(bipMedal).join() === '0,0,0,1,2,3,3,3', 'medal of a result code: 3 bronze, 4 silver, 5+ gold');
      ok(JSON.stringify(bipResultLines(1).lines) === '[["ADSGBI06",140],["ADSGBI07",300]]' && bipResultLines(1).medal === null, 'failed banner: ADSGBI06 at 140, ADSGBI07 at 300, no medal');
      ok(bipResultLines(3).medal === 'SGBRONZE' && bipResultLines(4).medal === 'SGSILVER' && bipResultLines(5).medal === 'SGGOLD' && bipResultLines(5).lines.length === 1, 'banner medals');
      ok(bipResultLines(5).speech.join() === 'ADSGBI01' && bipResultLines(4).speech.join() === 'ADSGBI02,ADSGBI03' && bipResultLines(3).speech.join() === 'ADSGBI04,ADSGBI05' && bipResultLines(2).speech.join() === 'ADSGBI06,ADSGBI07', 'result speech');
      const v = new GameVars();
      bipFinish(v, 3000, 1); ok(v.get(BIP_VARS.HISCORE) === 3000 && v.get(BIP_VARS.TROPHY) === 0, 'a failed flight keeps the score as hi-score, trophy 0');
      bipFinish(v, 2000, 5); ok(v.get(BIP_VARS.HISCORE) === 3000 && v.get(BIP_VARS.TROPHY) === 0, 'a lower score writes nothing');
      bipFinish(v, 7000, 4); ok(v.get(BIP_VARS.HISCORE) === 7000 && v.get(BIP_VARS.TROPHY) === 2, 'silver: trophy 2');
      bipFinish(v, 11000, 6); ok(v.get(BIP_VARS.TROPHY) === 3, 'five and more: gold trophy 3');
    }

    // ============================================================ the zone on its real data
    const fresh = () => { const L = loadZone(ctx, 'z22BIP'); const S = prepareBip(L.world, L.archive, L.pe); return { L, w: L.world, S, R: S.run }; };
    {
      const G = fresh(), { w, S, R } = G;
      ok(w.records.length === 222 + 30 + 160 + 50 + 2, `records: 222 of the scene + 242 helper records for the projectiles and propellers: ${w.records.length}`);
      ok(S.monkeys.length === 16 && S.ropes.length === 13 && S.rockies.length === 5 && S.props?.owners.join() === '74,75,75', 'nodes: 16 monkeys, 13 rope targets, 5 rock monsters, 3 propellers');
      ok(S.plane.ctrl.nodes.map((n) => n.kind).join() === 'PSwitch,Walk,Recover,Takeoff,Landing', `the plane's chain (no walking nodes): ${S.plane.ctrl.nodes.map((n) => n.kind)}`);
      ok(w.vars.get(VAR_MODE) === MODE.TAKEOFF, 'variable 0xfa = 8 (take-off)');
      near(S.walk.ammo, 1000, 0, 'bananas 1000'); near(S.walk.fuel, 100 * PLANE.FUEL_UNIT, 0, 'tank full');
      ok(Math.abs(w.camera.c[1] - 500) > 1 && w.camera.c[4] < 100, 'the camera settled on the plane (50 steps of the take-off camera)');
      ok(R.randTable.every((v) => v >= -1.2481 && v <= 1.2561), 'the 40 random numbers lie in -1.248 .. 1.257');
      ok(R.spline.n === 64, 'the course has 64 control points (60 + 4)');
      // the original's plane starts on the course (frame at 0) 4 above it
      near(S.plane.x, 444.15, 0.1, 'the plane stands on the course at its start (the first point is the runway start: (5 P0 + P1) / 6)'); near(S.plane.y, -32.72, 0.1, '... 4 above it');
    }
    // the take-off: Johnny starts after 50 ticks, the run 20 ticks later, then 100 ticks; then the flight at speed 400, altitude 24.5
    {
      const G = fresh(), { w, S } = G;
      let flyAt = -1;
      for (let i = 0; i < 260 && flyAt < 0; i++) { w.input.setVirtual(0); w.tick(); if (w.vars.get(VAR_MODE) === MODE.FLY) flyAt = i; }
      ok(flyAt === 170 || flyAt === 171 || flyAt === 172, `take-off ends after ~171 ticks (50 + 21 + 100): ${flyAt}`);
      ok(S.walk.speed === 400 && Math.abs(S.walk.alt - 24.5) < 0.01, `flight starts at speed 400, altitude 24.5: ${S.walk.speed} ${S.walk.alt}`);
      near(S.takeoff.progress, 0.03, 1e-4, 'the plane flew 0.03 of the course');
    }
    // a passive plane: crashes into the terrain are put right by Recover (100 points each), the fuel runs out and the game is lost (result 1)
    {
      const G = fresh(), { w, S, R } = G;
      let at = -1;
      for (let i = 0; i < 4000 && !R.result; i++) { w.input.setVirtual(0); w.tick(); at = i; }
      ok(R.result === 1, `no input: out of fuel and stopped, result 1 (${R.result} at ${at})`);
      ok(R.stats.crashes >= 1 && S.walk.fuel === 0 && S.walk.speed <= 1, `crashes ${R.stats.crashes}, fuel ${S.walk.fuel}, speed ${S.walk.speed}`);
      ok(!S.walk.landed && R.said.includes('ADSGBI09') && R.said.includes('ADSGBI13'), `speech: low fuel and the crash line: ${R.said.slice(0, 4)}`);
    }
    // the pilot: collects fuel cans, shoots monkeys and lands (bronze: the score is below 5000, so it reads 100)
    let win;
    {
      const G = fresh(), { w, S, R } = G;
      let at = -1;
      for (let i = 0; i < 6000 && !R.result; i++) { w.input.setVirtual(botButtons(S, w)); w.tick(); at = i; }
      win = { at, score: S.walk.score, stats: { ...R.stats }, result: R.result, landed: S.walk.landed };
      ok(R.result >= 3 && S.walk.landed, `the pilot lands: result ${R.result} after ${at} ticks`);
      ok(R.stats.fuelCans >= 3, `the pilot collected ${R.stats.fuelCans} fuel cans (the course needs about three tanks)`);
      ok(R.stats.monkeyHits >= 1 && R.stats.bananasFired > 50, `bananas fired ${R.stats.bananasFired}, monkeys hit ${R.stats.monkeyHits}`);
      ok(R.result === 3 ? S.walk.score === 100 : S.walk.score >= 5000, `bronze reads 100 points, higher medals the real score: result ${R.result}, score ${S.walk.score}`);
      notes.push(`pilot flight: ${JSON.stringify(win)}`);
    }
    // the medal thresholds on the landing: the score when the flight resumes decides ((score - 3000) / 2000 + 2, at least 3). The first update after the landing finds the
    // runway's terrain in the plane's box (a crash: -100 points), so the pinned score is raised by 100; the margins keep every case away from a threshold
    for (const [score, want] of [[0, 3], [4800, 3], [5200, 3], [6800, 3], [7200, 4], [8800, 4], [9200, 5], [10800, 5], [11200, 6], [30000, 15]]) {
      const G = fresh(), { w, S, R } = G;
      S.monkeys.forEach((m) => { m.node.update = () => 2; });          // no melons while the score is pinned
      for (let i = 0; i < 6000 && !R.result; i++) {
        w.input.setVirtual(botButtons(S, w));
        if (w.vars.get(VAR_MODE) === MODE.LAND || S.walk.landed) S.walk.score = score + 100;
        w.tick();
      }
      ok(R.result === want, `landing with ${score} points: result ${R.result}, medal ${bipMedal(R.result)} (expected ${want})`);
      if (want === 3 && score < 4900) ok(S.walk.score === 100, `a landing below 5000 reads 100 (${S.walk.score})`);
    }
    // pickups and hits on the real world (a banana next to a monkey, a can and a bunch in the plane's box)
    {
      const G = fresh(), { w, S, R } = G;
      for (let i = 0; i < 175; i++) { w.input.setVirtual(0); w.tick(); }          // into the flight
      const mk = S.monkeys[1];
      S.monkeys.forEach((m) => { m.node.update = () => 2; });
      mk.node.state = 1;
      const b = S.walk.bananas[0];
      b.active = true; b.born = R.bananaClock; b.x = mk.rec.x + 1; b.y = mk.rec.y; b.z = mk.rec.z; b.vx = b.vy = b.vz = 0;
      const s0 = S.walk.score; w.input.setVirtual(0); w.tick();
      ok(S.walk.score - s0 >= SCORE.MONKEY && mk.node.state === 2 && R.stats.monkeyHits >= 1, `a banana within 9 units of an awake monkey scores 700 (+${S.walk.score - s0}), state 2`);
      ok(R.said.includes('ADSGBI12'), 'the monkey says "oek, oek, iek"');
    }
    notes.push(`sections: ${sections.map(([n, r]) => `${n} ${r.checked}`).join(', ')}`);
    return { checked, failures, notes };
  },
};
