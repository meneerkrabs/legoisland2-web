// M5 audit, z40aPO (docs/re/m5/audit-minigames-b.md), the ORACLE test: the original's code of the zone is executed in the x86 interpreter (tools/lib/apo-emu.mjs) next to the
// TypeScript port: the pilot (constructor FUN_007d53af, update FUN_007d3187: the whole state machine, camera, rings, landing, shuttle doors), the rock monsters (FUN_007d28e0),
// the brickbots (FUN_007d19e0), the asteroids (FUN_007d14b0), the wing (draw hook FUN_007d2dd8) and the HUD (FUN_007d0f00). Both get the same buttons and the same random numbers;
// the node state, the matrices / flags of every record, the shuttle's sub-object matrices, the camera, the score, the ring flags, the HUD and every sound / speech call are compared
// tick by tick over whole scripted games. Only the collision answers (sweep, ground probe, rock-monster box) come from the port's code (on a proxy world whose records are copied from
// the oracle's memory at each call), the animation instances are the port's `AnimInstance`.
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { ApoEmu, RECORDS_BASE } from '../lib/apo-emu.mjs';
import { apoBotStep } from '../lib/apo-bot.mjs';
import { startApoRun, apoSnapshot } from '../../src/zones/z40aPO.ts';
import { shadowPoints, rockBoxHit, crossBox } from '../../src/zones/parachute/apo-pilot.ts';
import { APO_SOUNDS } from '../../src/zones/parachute/apo-run.ts';
import { setRandomSource } from '../../src/zones/parachute/util.ts';
import { meshParts } from '../../src/zones/z27trx/gate.ts';
import { B } from '../../src/game/input.ts';
import { steerBits, pitchBits } from '../lib/par-bot.mjs';
import { ApoHud } from '../../src/zones/parachute/apo-hud.ts';

const REC = 0x68;
const f32 = Math.fround;
export default {
  name: 'm5-audit-z40aPO-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    let capEnd = 0;

    /** one scenario: `keys(tick, snapshot)` -> buttons; returns the state changes */
    const scenario = (label, seed, keys, maxTicks) => {
      capEnd = failures.length + 6;
      // random numbers: the same sequence on both sides (rand() in 0..32767, the original's rand() / 32767 * x)
      let sp = seed, so = seed;
      const nx = (s) => (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      const portRng = () => { sp = nx(sp); return ((sp >> 8) & 0x7fff) / 32768; };
      // FUN_004388ae at 24-bit precision (control word 0x7f): `rand() / 32767` and the product with `x` each round to float32
      const rngO = { range: (x) => { so = nx(so); return f32(f32(((so >> 8) & 0x7fff) / 32767) * x); } };
      // ---- the port (its constructors draw the asteroids' random speeds first: 28 numbers)
      setRandomSource(portRng);
      const L = loadZone(ctx, 'z40aPO');
      const run = startApoRun(L.world, L.archive);
      const W = L.world, R = run.recs;
      const pilot = R.pepp.ctrl.find('ApoPilot');
      pilot.parts = meshParts(L.scene, L.archive, R.shtl).map((m) => m.slice());
      const plog = [];
      const wrap = (name, f) => { const o = run.sound[name].bind(run.sound); run.sound[name] = (...a) => { f(...a); return o(...a); }; };
      const id = (n) => APO_SOUNDS[n].id;
      wrap('play', (n) => plog.push(`p2 ${id(n)}`));
      wrap('stop', (n) => plog.push(`s2 ${id(n)}`));
      wrap('at', (n, p) => plog.push(`p3 ${id(n)} ${[0, 1, 2].map((k) => Math.fround(p[k]).toFixed(2)).join(',')}`));
      wrap('rate', (n, hz) => plog.push(`r ${id(n)} ${hz | 0}`));
      run.say = (s) => { plog.push(`say ${s}`); return true; };
      // ---- the oracle's own world and the collision proxy (their random numbers are not part of the sequence)
      setRandomSource(() => 0.5);
      const L2 = loadZone(ctx, 'z40aPO'); startApoRun(L2.world, L2.archive);
      const L3 = loadZone(ctx, 'z40aPO');
      setRandomSource(portRng);
      const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags }));
      const anims = new Map([6, 7, 8, 9].map((i) => [i, L2.world.records[i].anim]));
      const ogel3 = L3.world.records.find((r) => r.name === 'OGEL');
      const tmp = new Float32Array(15);
      const emu = new ApoEmu(pe, recs, anims, {
        rng: rngO,
        nativeBox: true,            // the original's FUN_007d3050 / FUN_0043d5ec run natively in the games: only the box of the .col is given (FUN_00442570)
        parts: (i) => (L2.world.records[i].name === 'SHTL' ? meshParts(L2.scene, L2.archive, L2.world.records[i]) : []),
        proxy: {
          recs: L3.world.records,
          sweep: (rec, pos, delta, mask, r, s) => L3.world.col.sweep(rec, pos, delta, mask, r, s),
          shadow: (rec, size, lift) => shadowPoints(L3.world, rec, ogel3, size, lift, tmp),
        },
      });
      const mem = emu.cpu.mem;
      emu.loadSounds();
      emu.construct();
      for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);       // the camera the zone's set-up left (FUN_00422b50): the same start for both
      const node = emu.node;
      const nf = (o) => mem.f32(node + o), ni = (o) => mem.r32(node + o) | 0;
      const hudP = new ApoHud();

      const TOLK = +(process.env.APO_TOL ?? 0);       // bit exact: the port rounds every operation like the 24-bit x87 (APO_TOL scales the old tolerances for comparisons)
      const cmp = (tick, name, orig, port, tol = 2e-3) => {
        tol *= TOLK;
        checked++;
        if (!(Math.abs(orig - port) <= tol * Math.max(1, Math.abs(orig))) && failures.length < capEnd) failures.push(`${label}: tick ${tick} ${name}: original ${orig} port ${port} (state ${pilot.state}, ring flags ${[...run.ring].join('')})`);
      };
      const eq = (tick, name, orig, port) => {
        checked++;
        if (orig !== port && failures.length < capEnd) failures.push(`${label}: tick ${tick} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)} (state ${pilot.state})`);
      };
      const states = [];
      const sounds = (l) => l.filter((e) => /^(p2|s2|p3|s3|r|say) /.test(e));
      const same = (a, b) => a.length === b.length && a.every((e, i) => {
        const x = e.split(' '), y = b[i].split(' ');
        if (x[0] !== y[0] || x[1] !== y[1]) return false;
        if (x[0] === 'p3') return x[2].split(',').every((v, k) => Math.abs(+v - +y[2].split(',')[k]) <= 0.02);
        return x.slice(2).join(' ') === y.slice(2).join(' ');
      });
      const moving = W.records.map((r, i) => i).filter((i) => /^(PEPP|SHTL|ROC|BBT|RK|PARA|TAR)/.test(W.records[i].name));
      const cover = new Map();
      let t = 0;
      for (; t < maxTicks && !run.over; t++) {
        const held = keys(t, apoSnapshot(W));
        const olog = emu.tick(held, 0);
        emu.hud();
        emu.draw();
        plog.length = 0;
        W.input.setVirtual(held);
        W.tick();
        const hf = hudP.update(run);
        const before = states.length ? states[states.length - 1].to : 0;
        if (pilot.state !== before) states.push({ at: t, from: before, to: pilot.state });
        const T = t + 1;
        eq(T, 'state', ni(0x38), pilot.state);
        // records: every record that moves (full matrix every 7th tick and at the end of a state, position and flags every tick)
        const full = T % 7 === 1 || pilot.state === 5 || pilot.state === 6;
        for (const i of moving) {
          const a = RECORDS_BASE + i * REC, r = W.records[i], name = r.name;
          const isPilot = i === 6 || name === 'SHTL' || name === 'PARA';
          for (const k of (isPilot || full) ? [...Array(16).keys()] : [12, 13, 14]) cmp(T, `${name} m[${k}]`, mem.f32(a + 0xc + 4 * k), r.m[k]);
          if (isPilot || name.startsWith('RK')) { cmp(T, `${name} rx`, mem.f32(a + 0x4c), r.rx); cmp(T, `${name} ry`, mem.f32(a + 0x50), r.ry); cmp(T, `${name} rz`, mem.f32(a + 0x54), r.rz); }
          eq(T, `${name} enabled`, mem.r16(a + 0x60) & 2, r.flags & 2);
        }
        // the wing's scale (the port keeps it in the record; the original in the node)
        cmp(T, 'wing scale', mem.f32(emu.wing + 0x18), W.records[79].ctrl.find('ApoWing').scale, 1e-5);
        // node fields
        cmp(T, 'door0', nf(0x80), pilot.door[0], 1e-5); cmp(T, 'door1', nf(0x84), pilot.door[1], 1e-5); cmp(T, 'door2', nf(0x88), pilot.door[2], 1e-5);
        cmp(T, 'fall (+0x58)', nf(0x58), pilot.fall, 1e-5); cmp(T, 'fwd (+0x5c)', nf(0x5c), pilot.fwd, 1e-4);
        cmp(T, 'camLerp (+0x60)', nf(0x60), pilot.camLerp, 1e-5);
        for (let k = 0; k < 3; k++) cmp(T, `camOff[${k}]`, nf(0x64 + 4 * k), pilot.camOff[k], 1e-5);
        cmp(T, 'yawRate (+0x4c)', nf(0x4c), pilot.yawRate, 1e-6); eq(T, 'steerDir (+0x44)', ni(0x44), pilot.steerDir);
        eq(T, 'landed (+0x48)', ni(0x48), pilot.landed ? 1 : 0);
        for (let k = 0; k < 3; k++) cmp(T, `bounce[${k}]`, nf(0x8c + 4 * k), pilot.bounce[k], 1e-4);
        // globals
        cmp(T, 'score', mem.f32(0x5d5f090), run.score, 1e-6);
        cmp(T, 'height', mem.f32(0x5d5f0a8), run.height, 5e-2); cmp(T, 'y (DAT_05d5ee60)', mem.f32(0x5d5ee60), run.y);
        for (let i = 0; i < 15; i++) eq(T, `ring flag ${i}`, mem.r8(0x5d5f0d0 + i * 0x14), run.ring[i]);
        eq(T, 'groups', [mem.r32(0x5d5f0b0) !== 0, mem.r32(0x5d5f0ac) !== 0, mem.r32(0x5d5f0b4) !== 0].join(), run.group.join());
        eq(T, 'canopy', mem.r32(0x5d5ee64) | 0, run.canopy); eq(T, 'over', mem.r32(0x5d5ee68) | 0, run.over ? 1 : 0);
        eq(T, 'chuteOk', (mem.r32(0x5d5f098) | 0) !== 0, run.chuteOk);
        eq(T, 'monsters woke', (mem.r32(0x5d5f0a4) | 0) !== 0, run.monstersWoke);
        // the HUD (FUN_007d0f00): score text, the three group icons and their tints, the wing icon, the gauge
        eq(T, 'HUD text', mem.cstr(0x5d4dd60), hf.text);
        eq(T, 'HUD group icons / tints', [0x5d4e144, 0x5d4e14c, 0x5d4e154].map((a) => mem.r32(a)).join() + '/' + [0x5d4e148, 0x5d4e150, 0x5d4e158].map((a) => mem.r32(a) >>> 0).join(), hf.groups.join() + '/' + hf.tints.join());
        eq(T, 'HUD wing icon', mem.r32(0x5d4dd38) | 0, hf.chuteIcon);
        eq(T, 'HUD gauge segments', Array.from({ length: 12 }, (_, i) => mem.r32(0x5d4e0c8 + i * 8) | 0).join(), hf.gauge.segments.join());
        cmp(T, 'HUD gauge marker', Math.min(1, Math.max(0, f32(mem.f32(0x5d4e138) / 204))), hf.gauge.marker, 1e-3);
        for (let g = 0; g < 3; g++) cmp(T, `HUD spin ${g}`, mem.f32(0x94a0d8 - 4 * g), hudP.spin[g], 1e-6);
        // the camera
        for (let k = 0; k < 6; k++) cmp(T, `camera[${k}]`, mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], 1e-3);
        // the shuttle's sub-object matrices (doors, hatch)
        const base = emu.partBufs.get(10);
        if (base) for (let j = 1; j <= 3; j++) for (let q = 0; q < 16; q++) cmp(T, `shuttle part ${j}[${q}]`, mem.f32(base + j * 0x40 + q * 4), pilot.parts[j][q], 1e-5);
        // the shadow patch (DAT_05d5f290: five points; the oracle's ground probe is the port's `shadowPoints`, the SHAD draw switch is DAT_05d5f208)
        if (pilot.state !== 0 && pilot.state !== 1) for (let q = 0; q < 15; q++) cmp(T, `shadow[${q}]`, mem.f32(0x5d5f290 + 4 * q), run.shadow[q], q % 3 === 1 ? 5e-2 : 1e-2);       // the heights follow the slope of the ground under a 1 ulp difference of the position
        eq(T, 'shadow on', (mem.r32(0x5d5f208) | 0) !== 0, run.shadowOn);
        // sounds and speech, in call order (pilot, rock monsters, brickbots)
        const a = sounds(olog), b = sounds(plog);
        if (process.env.APO_DEBUG && a.some((e) => e === 'say OGSGPO11')) console.log(label, 'bounce at', T, a.join(' | '));
        for (const e of a) { const k = e.split(' ').slice(0, 2).join(' '); cover.set(k, (cover.get(k) ?? 0) + 1); }
        checked++;
        if (!same(a, b) && failures.length < capEnd) failures.push(`${label}: tick ${T}: calls differ (state ${pilot.state})\n    original ${a.join(' | ')}\n    port     ${b.join(' | ')}`);
        if (failures.length >= capEnd) break;
      }
      notes.push(`${label}: ${t} ticks, score ${run.score}, over ${run.over}, states ${states.map((s) => `${s.from}>${s.to}@${s.at}`).join(' ')}; events ${['p2 224:asteroid', 'p2 225:monster', 'p2 226:bot', 'p2 223:ring', 'p3 227:growl', 'p2 239:ring-through', 'p2 231:smack', 'p2 232:target', 'say OGSGPO11:bounce', 'say OGSGPO08:wake'].map((q) => { const [k, n] = q.split(':'); return `${n} ${cover.get(k) ?? 0}`; }).join(', ')}; unhooked ${[...emu.unhooked].map(([k, v]) => `${k.toString(16)}x${v}`).join(' ') || 'none'}`);
      return { run, pilot, states, ticks: t };
    };

    // 1: no input at all: the doors, the launch, a free fall at 0.4 per tick to the ground (state 5 / 6)
    scenario('idle', 3, () => 0, 6000);
    // 2: the scripted bot: dives through the rings, opens the wing, glides to target 3 / 1 and lands, or never opens it
    const bot = (plan) => (t, s) => apoBotStep(s, plan);
    scenario('bot target 3', 1, bot({ land: 3 }), 9000);
    scenario('bot target 1', 4, bot({ land: 1, margin: 0.7 }), 9000);
    scenario('bot no wing', 5, bot({ noChute: true }), 9000);
    // 2b: dive at a rock monster / a brickbot's path: steer at the record and fall (state 2), so that the pilot's segment crosses the rock's box (hit_monster, bounce)
    const diveAt = (pick) => (t, s) => {
      if (s.state !== 2) return 0;
      const q = pick(s);
      const dh = Math.hypot(q.x - s.pepper.x, q.z - s.pepper.z);
      return steerBits(s, q.x, q.z) | pitchBits(s, dh > 3 ? 4.25 : 4.71);   // the horizontal speed is sin(2 rx): 4.71 falls straight down
    };
    for (const k of [0, 2]) scenario(`dive at rock monster ${k + 1}`, 20 + k, diveAt((s) => s.rocks[k]), 3000);
    scenario('dive at the launch pad of the bots', 30, diveAt(() => ({ x: 38.6, z: 54.1 })), 3000);
    // 3: random buttons (held for a random while): bounces off asteroids / rocks / bots, group misses, pitch limits
    for (const seed of [11, 13, 15]) {
      let q = seed, hold = 0, mask = 0;
      const rnd = () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return (q >>> 8) / 16777216; };
      scenario(`random ${seed}`, seed, (t, s) => {
        if (hold-- <= 0) { hold = 3 + Math.floor(rnd() * 25); mask = 0; if (rnd() < 0.5) mask |= B.LEFT; else if (rnd() < 0.5) mask |= B.RIGHT; if (rnd() < 0.4) mask |= B.UP; else if (rnd() < 0.3) mask |= B.DOWN; if (rnd() < 0.3 && s.chuteOk) mask |= B.SHIFT; }
        return mask;
      }, 6000);
    }
    // 4: FUN_007d3050 (the segment against a rock monster's box: world to local, the box crossing FUN_0043d5ec, the point and normal back to the world) run natively against the
    // port's `segmentHitsRecordBox`, over random segments around the three rocks turned by random angles
    {
      setRandomSource(() => 0.5);
      const L2 = loadZone(ctx, 'z40aPO'); startApoRun(L2.world, L2.archive);
      const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags }));
      const emu = new ApoEmu(pe, recs, new Map(), { rng: { range: () => 0 }, nativeBox: true, proxy: { recs: L2.world.records } });
      const mem = emu.cpu.mem;
      let q = 99;
      const rnd = () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return (q >>> 8) / 16777216; };
      const A = emu.alloc(16), Bp = emu.alloc(16), P = emu.alloc(16), N = emu.alloc(16);
      let hits = 0, tried = 0, bad = 0;
      for (let n = 0; n < 6000; n++) {
        const i = 7 + (n % 3), rec = L2.world.records[i];
        rec.ry = f32(rnd() * 6.28); rec.rx = f32((rnd() - 0.5) * 0.4); rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
        emu.putRecord(i, rec);
        const near = () => [rec.x + (rnd() - 0.5) * 24, rec.y + 4 + (rnd() - 0.5) * 20, rec.z + (rnd() - 0.5) * 20].map(f32);
        const a = near(), b = (n & 1) ? near() : [f32(a[0] + (rnd() - 0.5) * 3), f32(a[1] - 0.4), f32(a[2] + (rnd() - 0.5) * 3)];
        for (let k = 0; k < 3; k++) { mem.wf32(A + 4 * k, a[k]); mem.wf32(Bp + 4 * k, b[k]); mem.wf32(P + 4 * k, 0); mem.wf32(N + 4 * k, 0); }
        emu.cpu.steps = 0;
        const ret = emu.cpu.call(0x7d3050, [emu.recPtr(i), A, Bp, P, N], { maxSteps: 1_000_000 }) & 0xff;
        const pp = [0, 0, 0], nn = [0, 0, 0];
        const ok = rockBoxHit(rec, a, b, pp, nn);
        tried++; checked++;
        if (ok) hits++;
        let good = (ret !== 0) === ok;
        if (good && ok) for (let k = 0; k < 3; k++) { good = good && Math.abs(mem.f32(P + 4 * k) - pp[k]) < 2e-4 && Math.abs(mem.f32(N + 4 * k) - nn[k]) < 2e-5; checked += 2; }
        if (!good) { bad++; if (failures.length < 6) failures.push(`FUN_007d3050 vs segmentHitsRecordBox: rock ${i - 6}, segment ${a} -> ${b}: original ${ret} point ${[0, 1, 2].map((k) => mem.f32(P + 4 * k))} normal ${[0, 1, 2].map((k) => mem.f32(N + 4 * k))}; port ${ok} ${pp} ${nn}`); }
      }
      notes.push(`FUN_007d3050 (rock monster box) native vs port: ${tried} random segments, ${hits} crossings, ${bad} differences`);
    }
    setRandomSource(null);
    return { checked, failures, notes };
  },
};
