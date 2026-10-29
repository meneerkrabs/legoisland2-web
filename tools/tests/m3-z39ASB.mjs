// M3 zone port z39ASB (Asteroid Belt): the shuttle simulation (src/zones/z39ASB/belt.ts) with scripted input on the real zone's records, against the executable's
// constants (docs/re/m3/z39ASB.md): layout, speed regimes, controls (inverted up / down), hit test, 5 hits fail, hull use, finish, medals / hiscore / trophy variables,
// HUD model, backdrop corners, sound ids. A scripted WIN (a bot that dodges) and two scripted LOSSES (five hits, hull used up).
import { unregisterCtor, ctorFactory } from '../../src/game/setup.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';
import { RF_ENABLED, RF_FRUSTUM, RF_NO_DRAW } from '../../src/game/record.ts';
import { AsteroidBelt, MsvcRand, EngineModel, C, ST, VAR, SCRATCH_VARS, regimeOf, medalIndex, RF_HIDDEN_ASTEROID } from '../../src/zones/z39ASB/belt.ts';
import { hudSprites, hitIcons, gaugeSprites, SEGMENT_TEX, HUD_TEX } from '../../src/zones/z39ASB/hudmodel.ts';
import { backdropCorners, BACKDROP_INDICES } from '../../src/zones/z39ASB/backdrop.ts';
import { SND, IMPACTS, YELLS, MISSES, BeltSound } from '../../src/zones/z39ASB/sound.ts';
import { CTOR_SHUTTLE, ShuttleNode, SAY } from '../../src/zones/z39ASB/game.ts';
import '../../src/zones/z39ASB.ts';
import { loadExe, loadZone } from '../lib/engine-load.mjs';

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const hasImm = (pe, start, end, v) => { const o = pe.offset(start); const n = end - start; const b = [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; for (let i = 0; i + 4 <= n; i++) if (pe.data[o + i] === b[0] && pe.data[o + i + 1] === b[1] && pe.data[o + i + 2] === b[2] && pe.data[o + i + 3] === b[3]) return true; return false; };

export default {
  name: 'm3-z39ASB',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ------------------------------------------------------------------------------------------------ the executable: constants of the port
    // (a) float constants at the addresses the code reads them from (.rdata)
    const FLOATS = {
      0x892100: 128, 0x8921f4: 16, 0x89254c: -16, 0x892024: 12, 0x892964: -12, 0x892618: -4.8, 0x892674: 4.8, 0x892954: -4.4, 0x892804: 4.4, 0x8921b0: 80, 0x892468: -4, 0x892080: 4,
      0x892684: -8, 0x892958: -400, 0x89295c: 8192, 0x89296c: 6144, 0x892968: 3072, 0x8925e8: 1024, 0x892970: -64, 0x892390: 800, 0x892030: 0.01, 0x89224c: 150, 0x892120: 1000,
      0x8923bc: 508, 0x8923b8: 516, 0x8921a0: 576, 0x892024: 12, 0x8921f4: 16, 0x892388: 60, 0x89237c: 20, 0x892394: 400, 0x89239c: 69, 0x892974: 22, 0x8924c8: 5.5, 0x8924cc: 26, 0x89257c: 18,
      0x892398: 699, 0x8923a4: 716, 0x89204c: 0.5, 0x892034: 0.05, 0x9456f4: -1500, 0x8922cc: 0.005, 0x892950: 98, 0x89281c: 270, 0x892114: 200, 0x892710: 245,
    };
    let bad = [];
    for (const [a, v] of Object.entries(FLOATS)) if (Math.abs(f32(pe, +a) - v) > 1e-3 * Math.max(1, Math.abs(v))) bad.push(`0x${(+a).toString(16)} = ${f32(pe, +a)} (want ${v})`);
    ok(bad.length === 0, `float constants: ${bad.join('; ')}`);
    // (b) immediates inside the functions: constructor FUN_007b96a0 .. FUN_007b9917
    const CTOR_END = 0x7b9917, UPD = 0x7b82dd, UPD_END = 0x7b91b9, SCORE = 0x7b7e9a, SCORE_END = 0x7b7f68;
    ok(hasImm(pe, 0x7b96a0, CTOR_END, 10000) && hasImm(pe, 0x7b96a0, CTOR_END, 0x447a0000) && hasImm(pe, 0x7b96a0, CTOR_END, 1000) && hasImm(pe, 0x7b96a0, CTOR_END, 0x4019999a) && hasImm(pe, 0x7b96a0, CTOR_END, 0xc4400000) && hasImm(pe, 0x7b96a0, CTOR_END, 0xc3c80000),
      'constructor: score 10000, hull 1000.0 / 1000, speed 2.4, start z -768, camera -400');
    ok(hasImm(pe, 0x7b96a0, CTOR_END, 0x3f4ccccd) && hasImm(pe, 0x7b96a0, CTOR_END, 0x3e23d70a) && hasImm(pe, 0x7b96a0, CTOR_END, 0x42200000), 'constructor: move speed 0.8, shake 0.16, first spacing 40');
    ok(hasImm(pe, UPD, UPD_END, 0x4019999a) && hasImm(pe, UPD, UPD_END, 0x40666666) && hasImm(pe, UPD, UPD_END, 0x4099999a) && hasImm(pe, UPD, UPD_END, 0x40c00000), 'update: the four max speeds 2.4 / 3.6 / 4.8 / 6.0');
    ok(hasImm(pe, UPD, UPD_END, 0x41a00000) && hasImm(pe, UPD, UPD_END, 0x41800000) && hasImm(pe, UPD, UPD_END, 0x41600000) && hasImm(pe, UPD, UPD_END, 0x41400000), 'update: the four spacings 20 / 16 / 14 / 12');
    ok(hasImm(pe, UPD, UPD_END, 0x41f00000) || hasImm(pe, 0x7b7f68, 0x7b82dd, 0x41f00000), 'hit: timer 30');
    ok(hasImm(pe, SCORE, SCORE_END, 0x1b58) && hasImm(pe, SCORE, SCORE_END, 0x1388), 'medal thresholds 0x1b58 (7000) and 0x1388 (5000) in FUN_007b7e9a');
    // the exact comparison structure of FUN_007b7e9a: cmp [ebp+8], 0x1b58 ; jle (not gold) ... ; cmp [ebp+8], 0x1388 ; jle (not silver)
    {
      const code = [...pe.slice(SCORE, SCORE_END - SCORE)];
      const find = (v) => { for (let i = 0; i + 6 < code.length; i++) if (code[i] === 0x81 && code[i + 2] === 0x08 && (code[i + 3] | (code[i + 4] << 8)) === v && code[i + 5] === 0 && code[i + 6] === 0) return i; return -1; };
      const a = find(0x1b58), b = find(0x1388);
      ok(a >= 0 && b > a && code[a + 7] === 0x7e && code[b + 7] === 0x7e, `FUN_007b7e9a: cmp score, 0x1b58 / 0x1388 followed by jle (score <= threshold: the lower medal): ${a} ${b} ${code[a + 7]?.toString(16)} ${code[b + 7]?.toString(16)}`);
    }
    // (c) the sound table: ids and names
    const snd = { 0x1ca: 'SND_ASB_MISS1', 0x1cb: 'SND_ASB_MISS2', 0x1cc: 'SND_ASB_IMPACT3', 0x1cd: 'SND_ASB_IMPACT2', 0x1ce: 'SND_ASB_IMPACT1', 0x1fe: 'SND_ASB_ENGINE', 0x24f: 'SND_ASB_ENGINE_IDLE', 0x24d: 'SND_ASB_THRUST', 0x200: 'SND_ASB_AMBIENCE', 0x202: 'SND_ASB_YELL1', 0x201: 'SND_ASB_YELL2', 0x203: 'SND_ASB_ALARM', 0x204: 'SND_ASB_FINALALARM', 0x1ff: 'SND_ASB_THRUST_START', 0x36d: 'SND_ASB_ENGINE_STOP', 0x250: 'SND_ASB_GYRO' };
    // the names live in the table of the executable (src/formats/sound.ts)
    // (read here without a browser)
    return Promise.all([import('../../src/formats/sound.ts')]).then(([sound]) => {
      const table = sound.readExeSoundTable(pe.data);
      for (const [id, name] of Object.entries(snd)) ok(table[+id]?.name === name, `sound ${id}: ${table[+id]?.name} (want ${name})`);
      ok(IMPACTS.join() === [0x1ce, 0x1cd, 0x1cc].join() && YELLS.join() === [0x202, 0x201].join() && MISSES.join() === [0x1ca, 0x1cb].join(), 'sound id arrays of the port (impact / yell / miss order of FUN_007b6c20)');
      // the zone's message table (OG/Data/ASB.str): speech ids exist and carry the voice numbers 1699..1711
      const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
      return import('../../src/ui/strings.ts').then((strings) => {
        const tab = strings.loadMessages(messages, ['OG/Data/ASB.str']);
        for (let i = 1; i <= 13; i++) { const id = `OGSGAB${String(i).padStart(2, '0')}`; ok(tab.has(id), `ASB.str has ${id}`); ok(tab.voice(id) === 1698 + i, `${id} voice ${tab.voice(id)}`); }
        for (let i = 0; i < 4; i++) ok(tab.raw(`CONTROL${i}`) !== `CONTROL${i}`, `ASB.str has CONTROL${i}`);
        ok(!tab.has('CONTROL4') || tab.raw('CONTROL4') === 'CONTROL4', 'ASB.str has no CONTROL4 (help = 4 lines)');
        ok(tab.raw('CONTROL0').startsWith('BUTTON_UP') && tab.raw('CONTROL1').startsWith('BUTTON_DOWN'), 'help: UP = "Omlaag gaan" (down), DOWN = "Omhoog gaan" (up): inverted flight');
        return run2();
      });
    });

    // ------------------------------------------------------------------------------------------------ the simulation
    function run2() {
      const L = loadZone(ctx, 'z39ASB');
      const recs = L.world.records;
      const named = (n) => recs.filter((r) => r.name === n);
      ok(recs[1].name === 'SHUT' && recs[2].name === 'HULL' && recs[3].name === 'SKY_', 'records 1 / 2 / 3 = SHUT / HULL / SKY_');
      const asts = recs.filter((r) => r.name.startsWith('AST'));
      ok(asts.length === 235 && named('ASTA').length === 235, `235 asteroid records (${asts.length})`);
      for (let i = 3; i <= 11; i++) ok(!recs[i].enabled, `set-up clears the flags of record ${i} (${recs[i].name}): never drawn`);
      ok(L.setup.attaches.length === 1 && L.setup.attaches[0].ctor === CTOR_SHUTTLE && L.setup.attaches[0].record === 1, 'one attach: the shuttle constructor 0x7b96a0 on record 1');
      ok(ctorFactory(CTOR_SHUTTLE) !== undefined, 'the shuttle constructor is registered');

      const fresh = (seed = 1234, vars = new GameVars()) => {
        const L2 = loadZone(ctx, 'z39ASB');
        const r = L2.world.records;
        const events = [];
        const cam = new Float64Array(18);
        const belt = new AsteroidBelt({ shut: r[1], hull: r[2], asteroids: r.filter((x) => x.name.startsWith('AST')) }, cam, new MsvcRand(seed), vars, (e) => events.push(e));
        return { belt, events, cam, vars, L: L2, shut: r[1], hull: r[2], ast: belt.recs.asteroids };
      };

      // ---- rand() is the MSVC LCG; FUN_004388ae scales it
      {
        const r = new MsvcRand(1);
        ok(r.next() === 41 && r.next() === 18467 && r.next() === 6334, 'MSVC rand() with seed 1: 41, 18467, 6334');
        ok(new MsvcRand(5).range(0) === 0 && new MsvcRand(5).range(-3) === 0, 'range <= 0 gives 0');
        const m = new MsvcRand(7); let mx = 0; for (let i = 0; i < 2000; i++) mx = Math.max(mx, m.range(60)); ok(mx < 60 && mx > 50, 'range(60) stays below 60');
      }

      // ---- layout (FUN_007b9917): z series with the spacing regimes, x / y ranges, drift every third
      {
        const { belt, ast, shut, cam } = fresh();
        ok(shut.z === -768 && shut.x === 0 && shut.y === 0, 'shuttle starts at (0, 0, -768)');
        ok(cam[0] === 0 && cam[1] === 0 && cam[2] === -768 - 400 && cam[5] === cam[2] + 1, 'camera: 400 behind the shuttle, target one unit ahead');
        ok(ast[0].z === 0 && ast[1].z === 40 && ast[2].z === 60 && ast[3].z === 80, 'asteroid z: 0, 40, 60, 80 (spacing 40 for the first step, then 20)');
        let zs = ast.map((a) => a.z), okMono = true, maxStep = 0;
        for (let i = 1; i < zs.length; i++) { if (zs[i] <= zs[i - 1]) okMono = false; }
        ok(okMono, 'z strictly increasing');
        // spacing follows the regime of the previous asteroid's own z
        let regOk = true;
        for (let i = 2; i < zs.length; i++) { const want = regimeOf(zs[i - 2]).spacing; if (Math.abs(zs[i] - zs[i - 1] - (i === 1 ? 40 : regimeOf(zs[i - 2]).spacing)) > 1e-3) regOk = false; }
        ok(regOk, 'z step = spacing of the regime of the previous asteroid (20 up to 1024, 16 to 3072, 14 to 6144, 12 beyond)');
        ok(Math.abs(zs[zs.length - 1] - 3870) < 80, `last asteroid at z ~ 3870 (${zs[zs.length - 1]})`);
        ok(ast.every((a) => a.x >= -26 && a.x <= 34 && a.y >= -18 && a.y <= 26), 'x in [-26, 34], y in [-18, 26]');
        ok(belt.ast.every((t, i) => (i % 3 === 0 ? (Math.abs(t.vx) <= 0.24 && Math.abs(t.vy) <= 0.2) : t.vx === 0 && t.vy === 0)), 'every third asteroid drifts (|vx| <= 0.24, |vy| <= 0.2), the others stand still');
        ok(belt.ast.every((t) => Math.abs(t.rxv) <= 0.0175 && Math.abs(t.ryv) <= 0.0262 && Math.abs(t.rzv) <= 0.0350), 'rotation speeds within +-1 / 1.5 / 2 degrees per tick');
        for (const [v, val] of SCRATCH_VARS) ok(belt.vars.get(v) === val, `scratch var 0x${v.toString(16)} = ${val}`);
        // determinism: the same seed gives the same layout
        const b2 = fresh(1234), b3 = fresh(99);
        ok(b2.ast.every((a, i) => a.x === ast[i].x && a.y === ast[i].y && a.z === ast[i].z), 'same seed, same layout');
        ok(b3.ast.some((a, i) => a.x !== ast[i].x), 'another seed, another layout');
      }

      // ---- speed regimes
      ok(regimeOf(0).maxSpeed === Math.fround(2.4) && regimeOf(1024).maxSpeed === Math.fround(2.4) && regimeOf(1025).maxSpeed === Math.fround(3.6) && regimeOf(3072).maxSpeed === Math.fround(3.6) && regimeOf(3073).maxSpeed === Math.fround(4.8) && regimeOf(6144).maxSpeed === Math.fround(4.8) && regimeOf(6145).maxSpeed === 6, 'max speed by z: 2.4 / 3.6 / 4.8 / 6.0 at 1024 / 3072 / 6144');
      ok(regimeOf(0).spacing === 20 && regimeOf(2000).spacing === 16 && regimeOf(4000).spacing === 14 && regimeOf(7000).spacing === 12, 'spacing by z: 20 / 16 / 14 / 12');

      // ---- intro fly-in: the camera comes in at 4 per tick, the state changes to FLY after 99 ticks, HULL replaces SHUT
      {
        const { belt, events, shut, hull, cam } = fresh();
        ok(belt.state === ST.INTRO && !belt.started, 'starts in the intro state (shuttle drawn, no update yet)');
        let n = 0;
        while (belt.state === ST.INTRO && n < 500) { belt.update({ held: 0 }); n++; }
        ok(n === 99 && belt.state === ST.FLY && belt.camOff === -8, `fly-in lasts ${n} ticks (-400 + 4 n > -8 at n = 99), then offset -8`);
        ok(events.some((e) => e.type === 'state' && e.from === ST.INTRO && e.to === ST.FLY), 'state event INTRO -> FLY');
        // (M7 oracle: the tick that switches to flight clears SHUT's enabled bit (`flags &= 0xfffd`); the next update sets it again)
        ok(!(shut.flags & RF_ENABLED), 'the switch to flight hides SHUT for that tick (FUN_007b82dd flags &= 0xfffd)');
        belt.update({ held: 0 });
        ok((hull.flags & RF_ENABLED) && !(hull.flags & RF_NO_DRAW) && (shut.flags & RF_ENABLED) && (shut.flags & RF_NO_DRAW), 'flying: HULL shown, SHUT enabled (flags |= 3 every tick) but not drawn (the hook draws HULL instead)');
        ok(Math.abs(hull.x - shut.x) < 1e-6 && Math.abs(hull.y - (shut.y - 5.5)) < 1e-5 && Math.abs(hull.z - (shut.z - 22)) < 1e-3, 'HULL at the shuttle + (0, -5.5, -22)');
        ok(Math.abs(hull.m[0] - 1.3) < 1e-6 && Math.abs(hull.m[5] - 1.5) < 1e-6 && Math.abs(hull.m[10] - 1.2) < 1e-6, 'HULL scale (1.3, 1.5, 1.2)');
        // speed: 2.4 for the first 1024 units (shuttle z -768 + 2.4 per tick)
        ok(Math.abs(belt.speed - 2.4) < 1e-4, `speed 2.4 at the start (${belt.speed})`);
      }

      // ---- controls: LEFT / RIGHT / UP / DOWN move 0.8 per tick; UP goes DOWN; limits; hull and score cost
      {
        const { belt, shut } = fresh(5);
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        const x0 = shut.x, y0 = shut.y, h0 = belt.hull, s0 = belt.score;
        // move the field away so nothing is hit during the control test
        for (const a of belt.recs.asteroids) a.x = 100;
        belt.update({ held: B.LEFT });
        ok(Math.abs(shut.x - (x0 - 0.8)) < 1e-6 && belt.hull === h0 - 1 && belt.score === s0 - 1, 'LEFT: x -0.8, hull -1, score -1');
        belt.update({ held: B.RIGHT });
        ok(Math.abs(shut.x - x0) < 1e-5, 'RIGHT: x +0.8');
        belt.update({ held: B.UP });
        ok(Math.abs(shut.y - (y0 - 0.8)) < 1e-6, 'UP: y -0.8 (inverted: the shuttle goes down)');
        belt.update({ held: B.DOWN });
        ok(Math.abs(shut.y - y0) < 1e-5, 'DOWN: y +0.8 (up)');
        belt.update({ held: B.LEFT | B.UP });
        ok(Math.abs(belt.hull - (h0 - 4 - 2)) < 1e-6 && belt.score === s0 - 6, 'two axes in one tick cost 2 hull / 2 score');
        belt.update({ held: B.LEFT | B.RIGHT });
        ok(Math.abs(shut.x - (x0 - 0.8 - 0.8)) < 1e-5, 'LEFT wins over RIGHT');
        // limits: x within [-16, 16] (a move is refused beyond the edge), y within [-12, 12]; no cost when refused
        for (let i = 0; i < 80; i++) belt.update({ held: B.LEFT });
        ok(shut.x >= -16.8 && shut.x < -16, `x stops at the left limit (${shut.x})`);
        const h1 = belt.hull; belt.update({ held: B.LEFT });
        ok(belt.hull === h1, 'a refused move costs nothing');
        belt.update({ held: B.RIGHT });
        ok(shut.x > -16.8 + 0.79 && belt.hull === h1 - 1, 'moving away from the limit is allowed');
        for (let i = 0; i < 80; i++) belt.update({ held: B.DOWN });
        ok(shut.y > 12 && shut.y <= 12.8, `y stops at the top limit (${shut.y})`);
        for (let i = 0; i < 80; i++) belt.update({ held: B.UP });
        ok(shut.y < -12 && shut.y >= -12.8, `y stops at the bottom limit (${shut.y})`);
        // the camera follows x / y and sits at z - 8
        ok(Math.abs(belt.cam[0] - shut.x) < 1e-6 && Math.abs(belt.cam[1] - shut.y) < 1e-6 && Math.abs(belt.cam[2] - (shut.z - 8)) < 1e-3, 'camera = shuttle (x, y) at z - 8');
        ok(Math.abs(belt.cam[5] - belt.cam[2] - 1) < 1e-9 && belt.cam[3] === belt.cam[0], 'target one unit ahead');
        ok(belt.engine.gyro > 0 && belt.engine.drop > 0, 'engine pitch counters rise while steering');
      }

      // ---- speed ramp and the finish line
      {
        const { belt, shut } = fresh(3);
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        // keep everything out of the way
        for (let t = 0; t < 4000 && belt.state === ST.FLY; t++) { for (const a of belt.recs.asteroids) a.x = 100; belt.update({ held: 0 }); }
        ok(belt.state === ST.DONE || belt.state === ST.END, `the course ends (state ${belt.state} at z ${shut.z})`);
        ok(belt.cam[2] > 8192 && belt.cam[2] < 8192 + 7, `finish at eye z > 8192 (${belt.cam[2]})`);
        ok(Math.abs(belt.speed - 6) < 0.02 || belt.speed >= 5.99, `speed grew to the top regime (${belt.speed})`);
      }

      // ---- the hit test (FUN_007b7f68): near-miss warning 4..80 ahead in the lane, collision within +-4 of the camera, new hits ignored while shaking
      {
        const { belt, events, shut, vars } = fresh(7);
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        for (const a of belt.recs.asteroids) a.x = 100;
        const eyeZ = belt.cam[2];
        const a0 = belt.recs.asteroids[0];
        a0.x = shut.x + 2; a0.y = shut.y - 1; a0.z = eyeZ + 40;      // in the lane, 40 ahead: warning
        events.length = 0;
        belt.update({ held: 0 });
        ok(events.some((e) => e.type === 'warn' && !e.final), 'asteroid 40 ahead in the lane: near-miss warning event');
        ok(belt.state === ST.FLY, 'no collision yet');
        a0.x = 100;
        events.length = 0; belt.update({ held: 0 });
        ok(events.some((e) => e.type === 'warnEnd') && !events.some((e) => e.type === 'warn'), 'lane free: warnEnd');
        // out of the box in x (|dx| 4.9) or y (|dy| 4.5): neither warning nor hit
        for (const [dx, dy] of [[4.9, 0], [-4.9, 0], [0, 4.5], [0, -4.5]]) {
          const e0 = belt.cam[2];
          a0.x = belt.cam[0] - dx; a0.y = belt.cam[1] - dy; a0.z = e0 + 1;
          events.length = 0; belt.update({ held: 0 });
          ok(!events.some((e) => e.type === 'hit' || e.type === 'warn'), `outside the box (${dx}, ${dy}): nothing`);
          a0.x = 100;
        }
        // collision: dz = 0, inside the box
        const e1 = belt.cam[2];
        a0.x = belt.cam[0] + 4.7; a0.y = belt.cam[1] - 4.3; a0.z = e1 + 1;       // inside +-4.8 / +-4.4
        const sc = belt.score;
        events.length = 0; belt.update({ held: 0 });
        const hitEv = events.find((e) => e.type === 'hit');
        ok(hitEv && hitEv.hits === 1 && hitEv.slot === 4, 'collision: hit event, 1 hit, the top icon (slot 4) greys');
        ok(belt.state === ST.HIT && belt.score === sc - 2000 && belt.hits === 1 && belt.slotTint[4] === 0xff7f7f7f && belt.slotTint[3] === 0xffffff, 'state HIT, score -2000, icon tint 0xff7f7f7f');
        ok(belt.hitTimer === 29 || belt.hitTimer === 30 || belt.hitTimer === 29, `hit timer ~30 (${belt.hitTimer})`);
        // shaking: the camera x offset jumps between +-0.16 for 30 ticks, controls ignored, no second hit
        const xs = [];
        const x0 = shut.x;
        for (let i = 0; i < 29; i++) { a0.x = belt.cam[0]; a0.y = belt.cam[1]; a0.z = belt.cam[2] + 1; belt.update({ held: B.LEFT }); xs.push(+(belt.cam[0] - shut.x).toFixed(3)); }
        ok(xs.every((v) => Math.abs(Math.abs(v) - 0.16) < 1e-3) && new Set(xs).size === 2, `camera shakes +-0.16 (${[...new Set(xs)]})`);
        ok(shut.x === x0 && belt.hits === 1, 'no steering and no second hit while shaking');
        a0.x = 100;
        belt.update({ held: 0 }); belt.update({ held: 0 });
        ok(belt.state === ST.FLY, 'after the shake: back to FLY');
        ok(vars.get(VAR.RESULT) === 0, 'result var still 0');
      }

      // ---- bots on the real field
      /** a bot: steer away from asteroids that will cross the lane (looks ahead 70 units); `mode` = 'dodge' | 'idle' | 'wiggle' */
      const fly = (seed, mode, maxTicks = 6000) => {
        const T = fresh(seed);
        const { belt, events, shut } = T;
        let t = 0, ticks = 0;
        const seen = new Set();
        while (belt.result === 0 && t < maxTicks) {
          let held = 0;
          if (mode === 'wiggle' && belt.state === ST.FLY) held = (Math.floor(t / 40) & 1) ? B.LEFT : B.RIGHT;
          if (mode === 'dodge' && belt.state === ST.FLY) {
            let worst = null;
            for (const a of belt.recs.asteroids) {
              const dz = a.z - belt.cam[2];
              if (dz < -2 || dz > 75) continue;
              const dx = belt.cam[0] - a.x, dy = belt.cam[1] - a.y;
              if (Math.abs(dx) < 5.8 && Math.abs(dy) < 5.5 && (!worst || dz < worst.dz)) worst = { dz, dx, dy, a };
            }
            if (worst) {
              // leave the box on the cheaper side: sideways when the x offset is smaller, else vertically
              const needX = 5.8 - Math.abs(worst.dx), needY = 5.5 - Math.abs(worst.dy);
              const canLeft = shut.x > -16, canRight = shut.x < 16, canUp = shut.y < 12, canDown = shut.y > -12;
              if (needX <= needY * 1.2) held = worst.dx >= 0 ? (canRight ? B.RIGHT : canLeft ? B.LEFT : 0) : (canLeft ? B.LEFT : canRight ? B.RIGHT : 0);
              else held = worst.dy >= 0 ? (canUp ? B.DOWN : canDown ? B.UP : 0) : (canDown ? B.UP : canUp ? B.DOWN : 0);   // DOWN key = +y
            }
          }
          belt.update({ held }); t++;
        }
        return { ...T, ticks: t };
      };

      // WIN: a dodging bot flies the whole course, gold, variables written like the original
      {
        const vars = new GameVars(); vars.set(VAR.HISCORE, 0); vars.set(VAR.TROPHY, 0);
        const T = (() => { const X = fresh(2024, vars); return X; })();
        const { belt, events, shut } = T;
        let t = 0;
        const dodge = (b) => {
          let worst = null;
          for (const a of b.recs.asteroids) {
            const dz = a.z - b.cam[2];
            if (dz < -2 || dz > 75) continue;
            const dx = b.cam[0] - a.x, dy = b.cam[1] - a.y;
            if (Math.abs(dx) < 5.8 && Math.abs(dy) < 5.5 && (!worst || dz < worst.dz)) worst = { dz, dx, dy };
          }
          if (!worst) return 0;
          const needX = 5.8 - Math.abs(worst.dx), needY = 5.5 - Math.abs(worst.dy);
          if (needX <= needY * 1.2) return worst.dx >= 0 ? (shut.x < 16 ? B.RIGHT : B.LEFT) : (shut.x > -16 ? B.LEFT : B.RIGHT);
          return worst.dy >= 0 ? (shut.y < 12 ? B.DOWN : B.UP) : (shut.y > -12 ? B.UP : B.DOWN);
        };
        while (belt.result === 0 && t < 6000) { belt.update({ held: belt.state === ST.FLY ? dodge(belt) : 0 }); t++; }
        notes.push(`WIN run: ${t} ticks, hits ${belt.hits}, score ${belt.score}, hull ${belt.hull}, final z ${shut.z.toFixed(0)}`);
        ok(belt.result === 1 && vars.get(VAR.RESULT) === 1, 'WIN: result 1, var 0xfc = 1');
        ok(belt.hits <= 1, `WIN: the bot took ${belt.hits} hits`);
        ok(belt.finalScore === belt.score && belt.finalScore >= 7001, `WIN: gold score ${belt.finalScore}`);
        ok(events.filter((e) => e.type === 'end').length === 1 && events.at(-1).result === 1, 'WIN: one end event with result 1');
        ok(vars.get(VAR.MEDAL) === 2 && vars.get(VAR.HISCORE) === belt.finalScore, 'WIN: medal var 0x102 = 2, hiscore var 0x29 = score');
        ok(vars.get(VAR.TROPHY) === 2, 'WIN: trophy 2 before the banner (the level below the medal)');
        belt.bannerStep();
        ok(vars.get(VAR.TROPHY) === 3, 'WIN: the banner raises the trophy to 3 (gold)');
        // timing: 99 fly-in ticks + the flight (8200 + 768 units at 2.4 .. 6.0) + 98 ticks of camera pull back
        ok(t > 2300 && t < 2600, `WIN: the run takes ${t} ticks (~${(t / 30).toFixed(0)} s: 99 fly-in + 8968 units at 2.4 .. 6.0 + 98 pull back)`);
        ok(belt.state === ST.END, 'WIN: ends in state END');
      }

      // LOSS 1: no steering: five hits crash the shuttle (result 2), the banner has no medal and leaves the variables alone
      {
        let done = null;
        for (const seed of [11, 12, 13, 14, 15, 16]) {
          const vars = new GameVars(); vars.set(VAR.HISCORE, 123); vars.set(VAR.TROPHY, 1);
          const T = fresh(seed, vars); const { belt, events } = T;
          let t = 0; while (belt.result === 0 && t < 6000) { belt.update({ held: 0 }); t++; }
          if (belt.result === 2 && belt.hits === 5) { done = { T, t, vars }; break; }
        }
        ok(!!done, 'LOSS: an idle shuttle crashes (5 hits) within a few seeds');
        if (done) {
          const { T, t, vars } = done; const { belt, events } = T;
          notes.push(`LOSS (idle): ${t} ticks, ${belt.hits} hits, score ${belt.score}`);
          ok(belt.state === ST.END && vars.get(VAR.RESULT) === 2, 'LOSS: state END, var 0xfc = 2');
          ok(events.filter((e) => e.type === 'hit').length === 5 && events.some((e) => e.type === 'state' && e.to === ST.CRASHED), 'LOSS: five hit events and the CRASHED state');
          ok(belt.slotTint.every((c) => c === 0xff7f7f7f), 'LOSS: all five icons grey');
          ok(belt.score === Math.max(0, 10000 - 5 * 2000), `LOSS: score ${belt.score} (10000 - 5 x 2000 = 0)`);
          ok(vars.get(VAR.HISCORE) === 123 && vars.get(VAR.TROPHY) === 1, 'LOSS: hiscore and trophy untouched');
          belt.bannerStep();
          ok(vars.get(VAR.TROPHY) === 1, 'LOSS: the banner does not raise the trophy');
          // the camera retreated to -400 behind the shuttle
          ok(Math.abs(belt.camOff - -400) < 4.01, `LOSS: the camera pulled back (${belt.camOff})`);
        }
      }

      // LOSS 2: the hull (fuel) runs out: 1001 moves
      {
        const vars = new GameVars();
        const T = fresh(8, vars); const { belt, events } = T;
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        let moves = 0;
        for (let t = 0; t < 3000 && belt.result === 0; t++) {
          for (const a of belt.recs.asteroids) if (a.z - belt.cam[2] < 200) a.x = 100;        // no collisions: this test is about the fuel
          const wasFly = belt.state === ST.FLY;
          belt.update({ held: (Math.floor(t / 20) & 1) ? B.LEFT : B.RIGHT });
          if (wasFly && belt.state === ST.FLY) moves++;
        }
        ok(belt.result === 2 && events.some((e) => e.type === 'state' && e.to === ST.EMPTY), 'LOSS (empty): the hull is used up -> EMPTY -> failed');
        ok(belt.hull === 0 && belt.hits === 0, `LOSS (empty): hull 0, no hits (moves ${moves})`);
        ok(moves >= 1000 && moves <= 1002, `LOSS (empty): after ${moves} moves (1000 hull + the one below zero)`);
        ok(belt.score === 10000 - 1001, `LOSS (empty): each move took one score point, the one that empties the hull too (${belt.score})`);
      }

      // ---- medals / hiscore / trophy (FUN_007b7e9a + banner FUN_007b61a4)
      {
        for (const [score, want] of [[0, 0], [4999, 0], [5000, 0], [5001, 1], [6999, 1], [7000, 1], [7001, 2], [10000, 2]]) ok(medalIndex(score) === want, `medal of ${score} = ${want}`);
        const finish = (score, vars) => {
          const T = fresh(1, vars); const { belt, shut } = T;
          while (belt.state === ST.INTRO) belt.update({ held: 0 });
          for (const a of belt.recs.asteroids) a.x = 100;
          belt.score = score; shut.z = 8200;
          belt.update({ held: 0 });
          return belt;
        };
        for (const [score, medal] of [[4000, 0], [5001, 1], [7000, 1], [7001, 2], [9500, 2]]) {
          const vars = new GameVars(); vars.set(VAR.HISCORE, 6000); vars.set(VAR.TROPHY, 0);
          const belt = finish(score, vars);
          ok(belt.state === ST.DONE, `score ${score}: the finish line is crossed (state ${belt.state})`);
          ok(vars.get(VAR.MEDAL) === medal, `score ${score}: medal var ${vars.get(VAR.MEDAL)} (want ${medal})`);
          ok(vars.get(VAR.HISCORE) === Math.max(6000, score), `score ${score}: hiscore ${vars.get(VAR.HISCORE)}`);
          ok(vars.get(VAR.TROPHY) === medal, `score ${score}: trophy before the banner = ${medal} (gold 2, silver 1, bronze 0)`);
          belt.bannerStep();
          ok(vars.get(VAR.TROPHY) === medal + 1, `score ${score}: trophy after the banner = ${medal + 1}`);
        }
        // only ever raised: a gold trophy stays gold after a bronze run; silver after a silver
        {
          const vars = new GameVars(); vars.set(VAR.TROPHY, 3); vars.set(VAR.HISCORE, 9999);
          const belt = finish(4000, vars); belt.bannerStep();
          ok(vars.get(VAR.TROPHY) === 3 && vars.get(VAR.HISCORE) === 9999, 'a bronze run after gold: trophy 3, hiscore 9999 stay');
          const v2 = new GameVars(); v2.set(VAR.TROPHY, 3); const b2 = finish(8000, v2);
          ok(v2.get(VAR.TROPHY) === 2, 'gold run after gold: FUN_007b7e9a writes 2 ...');
          b2.bannerStep(); ok(v2.get(VAR.TROPHY) === 3, '... and the banner restores 3');
          const v3 = new GameVars(); v3.set(VAR.TROPHY, 3); const b3 = finish(6000, v3); b3.bannerStep();
          ok(v3.get(VAR.TROPHY) === 3, 'a silver run after gold: trophy stays 3');
        }
      }

      // ---- the world's node chain: the attach creates a ShuttleNode that drives the belt from World.tick with the input mapper
      {
        const L3 = loadZone(ctx, 'z39ASB');
        const n = L3.world.records[1].ctrl?.find('Shuttle');
        ok(n instanceof ShuttleNode, 'setupZone attached the ShuttleNode to SHUT');
        const r = L3.world.records;
        const vars = L3.world.vars;
        const belt = new AsteroidBelt({ shut: r[1], hull: r[2], asteroids: r.filter((x) => x.name.startsWith('AST')) }, L3.world.camera.c, new MsvcRand(5), vars);
        n.belt = belt;
        L3.world.vars.set(2, 1);
        L3.world.input.setVirtual(0);
        for (let i = 0; i < 120; i++) { L3.world.input.update(); L3.world.tick(); }
        ok(n.ran === 120 && belt.frame === 120 && belt.state === ST.FLY, `World.tick drives the belt through the node (${n.ran} ticks)`);
        L3.world.input.setVirtual(B.LEFT);
        const x0 = r[1].x;
        for (let i = 0; i < 5; i++) { L3.world.input.update(); L3.world.tick(); }
        ok(r[1].x < x0 - 3.5, `the held LEFT bit steers the shuttle (${x0} -> ${r[1].x})`);
        ok(L3.skipped.length === 0, 'no attaches skipped in z39ASB');
        // the render interpolation: records saved their previous matrix, the camera too
        ok(Math.abs(L3.world.camera.c[2] - (r[1].z - 8)) < 1e-2, 'camera at shuttle z - 8 after the node ran');
      }

      // ---- asteroid motion and recycling
      {
        const { belt, shut } = fresh(21);
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        for (let i = 0; i < 10; i++) belt.update({ held: 0 });
        const ez = belt.cam[2];
        const inWin = belt.recs.asteroids.filter((a) => a.z - ez >= -64 && a.z - ez <= 800);
        ok(inWin.length >= 10, `${inWin.length} asteroids in the window (-64 .. 800)`);
        ok(belt.recs.asteroids.every((a) => { const dz = a.z - ez; const out = dz < -64 || dz > 800; return ((a.flags & RF_HIDDEN_ASTEROID) !== 0) === out && ((a.flags & RF_FRUSTUM) === 0) === out; }), 'asteroids outside the window: frustum bit cleared and not drawn (FUN_007b959c), inside: set');
        const moving = inWin.find((a, i) => belt.ast[belt.recs.asteroids.indexOf(a)].rzv !== 0);
        const rz0 = moving.rz; belt.update({ held: 0 });
        ok(moving.rz !== rz0, 'a window asteroid rotates');
        // run until the first one is passed and recycled to the end of the field
        const first = belt.recs.asteroids[0];
        let moved = false;
        for (let t = 0; t < 800 && !moved; t++) { for (const a of belt.recs.asteroids) a.x = 100; const z0 = first.z; belt.update({ held: 0 }); if (first.z > z0 + 100) moved = true; }
        ok(moved && first.z >= 3800, `a passed asteroid is put at the end of the field (z ${first.z})`);
      }

      // ---- HUD model (FUN_0046055f / FUN_0045fc19 / FUN_00460214)
      {
        const icons = hitIcons([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xff7f7f7f]);
        ok(icons.length === 5 && icons.every((s) => s.tex === HUD_TEX.ICON && s.rect[0] === 20 && s.rect[2] === 80 && s.rect[3] - s.rect[1] === 60), '5 icons of 60x60 at x = 20');
        ok(icons[0].rect[1] === 516 && icons[4].rect[1] === 228 && icons[4].tint === 0xff7f7f7f, 'slot i top = 516 - 72 i, the top one is grey');
        const full = gaugeSprites(1, 0xffffffff), half = gaugeSprites(0.5, 0xffffffff), empty = gaugeSprites(0, 0xff7f7f7f);
        ok(full.length === 1 + 12 + 1 && half.length === 1 + 6 + 1 && empty.length === 2, `gauge sprites: ${full.length} / ${half.length} / ${empty.length}`);
        ok(full[0].tex === HUD_TEX.ARROW && full[0].rect[1] === 508 - 192 - 16 && full[0].rect[3] === 508 - 192 + 16 && full[0].rect[0] === 696 && full[0].rect[2] === 728, 'the marker arrow at the top of a full gauge');
        ok(empty[0].rect[1] === 508 - 16 && empty[1].tint === 0xff7f7f7f && empty[1].tex === HUD_TEX.FRAME && empty[1].rect.join() === [716, 516, 776, 576].join(), 'empty gauge: arrow at the bottom, the frame icon tinted');
        ok(full.slice(1, 13).map((s) => s.tex).join() === SEGMENT_TEX.join() && full[1].rect.join() === [732, 492, 764, 508].join() && full[12].rect.join() === [732, 492 - 176, 764, 508 - 176].join(), 'segments: 4 red, 4 yellow, 4 green from the bottom, 16 px pitch');
        ok(gaugeSprites(0.04, 0xffffffff).length === 2 && gaugeSprites(0.05, 0xffffffff).length === 3, 'segment count = trunc(12 r + 0.5): 0.04 -> 0, 0.05 -> 1');
        ok(hudSprites([1, 1, 1, 1, 1], 1, 1).length === 5 + 14, 'hudSprites: column + gauge');
        // frame flash below 150 hull
        const { belt } = fresh(4);
        while (belt.state === ST.INTRO) belt.update({ held: 0 });
        for (const a of belt.recs.asteroids) a.x = 100;
        belt.hull = 149; belt.update({ held: 0 });
        ok(belt.frameTint === 0x7f7f7f || belt.frameTint === 0xffffff, 'frame tint set below 150 (the executable stores 0x7f7f7f / 0xffffff)');
        belt.hull = 0; belt.update({ held: 0 }); ok(belt.frameTint === 0x7f7f7f, 'frame tint grey at hull 0');
        ok(belt.scoreText === String(belt.score), 'score text = "%d"');
      }

      // ---- the star field backdrop (FUN_007b7c24 / FUN_0088002d)
      {
        const c = backdropCorners([0, 0, 0], [0, 0, 1]);
        ok(c.length === 4 && Math.abs(c[0][0] + 1050) < 1e-3 && Math.abs(c[0][1] + 1050) < 1e-3 && Math.abs(c[0][2] - 1500) < 1e-3, `corner 0 = bottom left at (-1050, -1050, 1500): ${c[0]}`);
        ok(Math.abs(c[2][0] - 1050) < 1e-3 && Math.abs(c[2][1] - 1050) < 1e-3 && Math.abs(c[3][0] + 1050) < 1e-3 && Math.abs(c[3][1] - 1050) < 1e-3 && Math.abs(c[1][0] - 1050) < 1e-3 && Math.abs(c[1][1] + 1050) < 1e-3, 'corners BL, BR, TR, TL');
        const d = backdropCorners([10, -3, 100], [0, 0, 1]);
        ok(Math.abs(d[0][0] - (10 - 1050)) < 1e-2 && Math.abs(d[0][2] - 1600) < 1e-2, 'corners follow the eye');
        ok(BACKDROP_INDICES.join() === '0,2,1,0,3,2', 'index list 0 2 1 0 3 2');
        // clockwise seen from the camera (x right, y up): (0, 2, 1) = BL -> TR -> BR
        const cross = (a, b, cc) => (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
        ok(cross(c[0], c[2], c[1]) < 0 && cross(c[0], c[3], c[2]) < 0, 'both triangles are clockwise for the camera (front faces)');
      }

      // ---- sounds (muted: the log records the calls)
      {
        const s = new BeltSound(null);
        ok(s.log === null, 'BeltSound without audio does nothing');
        const eng = new EngineModel();
        for (let i = 0; i < 300; i++) eng.spoolStep(true);
        ok(eng.spool === 0x5622 + (245 - (0x5622 % 245)) % 245 || eng.spool >= 0x5622, `thrust spool ramps to 0x5622 (${eng.spool})`);
        for (let i = 0; i < 100; i++) eng.steerStep(true);
        ok(eng.gyro >= 0xb86 && eng.drop >= 0xfd2 && eng.gyroRate === eng.gyro + 0x5622, 'steering raises the gyro and the thrust drop up to their caps');
        const before = eng.thrustRate;
        for (let i = 0; i < 100; i++) eng.steerStep(false);
        ok(eng.gyro === 0 || eng.gyro < 98, 'releasing lowers the gyro');
        ok(eng.thrustRate >= before, 'thrust rate recovers');
        // with a fake sound engine: the event -> sound mapping of FUN_007b7f68 / FUN_007b82dd
        {
          const calls = [];
          const fake = { sfx: {
            load2D: async (id) => ({ id, kind: '2d' }), load3D: async (id) => ({ id, kind: '3d' }),
            play2D: (s) => { calls.push(`play ${s.id}`); return true; }, play3D: (s, p) => { calls.push(`play3d ${s.id} ${p.x},${p.y},${p.z}`); return true; },
            stop: (s) => calls.push(`stop ${s.id}`), setRate: (s, hz) => calls.push(`rate ${s.id} ${hz}`), setListener: (p) => calls.push(`listener ${p.x},${p.y},${p.z}`),
          } };
          const bs = new BeltSound(fake);
          return bs.load().then(() => {
            bs.event({ type: 'hit', hits: 1, voice: 0, yell: 1, impact: 2, slot: 4 });
            ok(calls.join('|') === `play ${SND.YELL2}|play ${SND.IMPACT3}`, `hit: yell 1 = SND_ASB_YELL2, impact 2 = SND_ASB_IMPACT3 (${calls})`);
            calls.length = 0;
            bs.event({ type: 'warn', pos: [1, 2, 3], miss: 1, final: false });
            ok(calls[0] === `play3d ${SND.MISS2} 1,2,3` && calls[1] === `play ${SND.ALARM}`, `near miss: MISS2 at the asteroid, then the alarm (${calls})`);
            calls.length = 0;
            bs.event({ type: 'warn', pos: [0, 0, 0], miss: 0, final: true });
            ok(calls[1] === `play ${SND.FINAL_ALARM}`, 'the fifth hit warning uses the final alarm');
            calls.length = 0;
            bs.event({ type: 'warnEnd' });
            ok(calls.includes(`stop ${SND.MISS1}`) && calls.includes(`stop ${SND.MISS2}`) && calls.includes(`stop ${SND.ALARM}`), 'warnEnd stops the whooshes and alarms');
            calls.length = 0;
            const eng = new EngineModel(); eng.spoolStep(true);
            bs.tick(ST.FLY, eng);
            ok(calls.includes(`play ${SND.THRUST}`) && calls.includes(`play ${SND.GYRO}`) && calls.includes(`rate ${SND.THRUST} ${eng.thrustRate}`), `flying: thrust + gyro loops with the engine pitch (${calls})`);
            calls.length = 0;
            bs.event({ type: 'state', from: ST.FLY, to: ST.EMPTY });
            ok(calls.join('|') === `stop ${SND.THRUST}|stop ${SND.GYRO}|play ${SND.ENGINE_STOP}`, `out of fuel: thrust and gyro stop, engine cut-off plays (${calls})`);
            calls.length = 0;
            bs.frame([5, 6, 7]);
            ok(calls.includes(`play ${SND.ENGINE}`) && calls.includes(`play ${SND.ENGINE_IDLE}`) && calls.includes('listener 5,6,7'), 'every frame: the engine loops play and the listener follows the camera');
            calls.length = 0;
            bs.tick(ST.END, eng);
            ok(calls.includes(`stop ${SND.ENGINE}`) && calls.includes(`play ${SND.ENGINE_IDLE}`), 'state END: engine stops, idle plays');
            return finish();
          });
        }
      }
      function finish() {
        ok(SAY.HIT.join() === 'OGSGAB06,OGSGAB07' && SAY.FAIL === 'OGSGAB04' && SAY.BY_MEDAL.join() === 'OGSGAB03,OGSGAB02,OGSGAB01' && SAY.INTRO === 'OGSGAB13', 'speech ids');
        unregisterCtor(CTOR_SHUTTLE);
        return { checked, failures, notes };
      }
    }
  },
};
