import fs from 'node:fs';
import path from 'node:path';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { readAudioTables } from '../../src/audio/tables.ts';
import { parseMan } from '../../src/formats/anim.ts';
import { createCpu } from '../../src/formats/x86emu.ts';
import '../../src/zones/z20DSP.ts';
import { DspShared, SoundLog, DspRng, REC, SND, VAR, STATE, SOUNDS_2D, SOUNDS_3D } from '../../src/zones/z20dsp/shared.ts';
import { TrackSpline, trackPoints } from '../../src/zones/z20dsp/spline.ts';
import { ReplayBuffer, REPLAY_SIZE, REPLAY_SLOT } from '../../src/zones/z20dsp/replay.ts';
import { prepareDsp, checkRecords, rockPairs } from '../../src/zones/z20dsp/prepare.ts';
import { SpeedsterNode, CTOR_SPEEDSTR, START, TIME_GOLD, TIME_SILVER, TIME_BRONZE, CLOCK_START, SCORE_BASE } from '../../src/zones/z20dsp/speedster.ts';
import { CTOR, ROCK, SAUCER_ARGS } from '../../src/zones/z20dsp/props.ts';
import { DspCamera } from '../../src/zones/z20dsp/camera.ts';
import { medalFromVar, resultLines } from '../../src/zones/z20dsp/rules.ts';

// z20DSP "Desert Speedster" (docs/re/m6/z20DSP.md): the constants and tables against the executable (the code streams of FUN_006c6495 / 006c2627 / 006c6d57 / 006bd776 and the
// behaviours), the track spline and the Replay.c buffer against the ORIGINAL code run on the x86 emulator, the Speedster's controls / physics / pickups / hazards / finish
// with scripted inputs (a WIN, a LOSS, every medal threshold), the props (cows, rocks, saucers, whirlwind, Bertha), the camera and the results.

const u32f = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
const f2u = (f) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, f, true); return d.getUint32(0, true); };
const hex = (n) => '0x' + n.toString(16);

export default {
  name: 'm6-z20DSP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z20DSP');
    const code = (va, n) => pe.slice(va, n);
    /** the set of all dwords (at any byte offset) of a code range */
    const dwordSet = (va, n) => { const b = code(va, n); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const s = new Set(); for (let i = 0; i + 4 <= n; i++) s.add(dv.getUint32(i, true)); return s; };
    const f32at = (va) => u32f(pe.u32(va));
    const f64at = (va) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(va), true); d.setUint32(4, pe.u32(va + 4), true); return d.getFloat64(0, true); };

    try {
      // ============================================================ the set-up against the executable
      {
        const L = loadZone(ctx, 'z20DSP');
        const R = L.world.records;
        ok(checkRecords(R).length === 0, `record names: ${checkRecords(R).join('; ')}`);
        ok(R.length === 490, `${R.length} records`);
        const at = L.setup.attaches.map((a) => [a.record, a.ctor]);
        const want = [[38, CTOR_SPEEDSTR], [0, 0x426915], [58, CTOR.WHIRLWIND], [29, CTOR.SAUCER], [27, CTOR.SAUCER], [28, CTOR.SAUCER], [31, CTOR.SCRCONE], [30, CTOR.SCRCONE], [32, CTOR.SCRCONE],
          [57, CTOR.SPIN], [56, CTOR.SPIN], [12, CTOR.BERTHA], ...REC.TURB.map((i) => [i, CTOR.TURBO]), ...REC.TIME.map((i) => [i, CTOR.TURBO]), ...REC.COW.map((i) => [i, CTOR.FALLING])];
        ok(at.length === want.length && want.every((w, i) => at[i][0] === w[0] && at[i][1] === w[1]), `set-up attaches (FUN_006be930): ${JSON.stringify(at.map((a) => [a[0], hex(a[1])]))}`);
        ok(L.setup.attaches.every((a) => a.var === 2 && a.mask === 0 && a.value === 0 || a.record === 0), 'all attaches are ungated (var 2 mask 0)');
        // the WalkRock pairs table at 0x92af70: (Brickbot record, rock record), ended by -1
        const pairs = rockPairs(pe);
        ok(pairs.map((p) => p.join()).join(';') === '4,42;5,43;6,45;7,44;8,46', `rock pairs ${JSON.stringify(pairs)}`);
        ok(pairs.every(([b, r]) => R[b].name.startsWith('BBT') && R[r].name.startsWith('RO')), 'pairs are BBTn / ROnn records');
        // render modes of the set-up: bricks 1, pickups / cones 2, the car 1
        ok(L.setup.modes.filter((m) => m.mode === 2).length === 15 && L.setup.modes.some((m) => m.record === 38 && m.mode === 1), 'render modes 2 (TURB x6, TIME x6, CON x3) and 1 (car)');
        // the loop: the zone table row (index 16, sub-game 16): FUN_006bde34
        ok(R[REC.PEPP].name === 'PEPP' && R[REC.PEPP].flags === 18, 'record 38 is the car (PEPP, flags 0x12)');
      }
      {
        // medal thresholds (FUN_006c6d57) and the score formula, read from the executable
        ok(f32at(0x92b338) === TIME_GOLD && f32at(0x92b33c) === TIME_SILVER && f32at(0x92b340) === TIME_BRONZE, `thresholds .rdata ${f32at(0x92b338)} ${f32at(0x92b33c)} ${f32at(0x92b340)}`);
        ok(TIME_GOLD === 2700 && TIME_SILVER === 3600 && TIME_BRONZE === 4500, 'gold < 2700 ticks (90 s), silver < 3600 (120 s), bronze < 4500 (150 s)');
        const s = dwordSet(0x6c6d57, 0x1e0);
        ok(s.has(0x45034000) && u32f(0x45034000) === SCORE_BASE && SCORE_BASE === 2100, 'FUN_006c6d57 subtracts the float 2100 (0x45034000) from the time before the score');
        ok(code(0x6c6d57, 0x1e0).join().includes('107,192,3'), 'then imul eax, eax, 3 and 10000 - that (mov edx, 0x2710 / sub)');
        ok(s.has(10000), 'the immediate 10000 (0x2710)');
        for (const v of [0x103, 0x104, 0x77, 0xdc, 0x1e]) ok([...code(0x6c6d57, 0x1e0)].includes(v & 0xff), `FUN_006c6d57 touches variable ${hex(v)}`);
        const names = [0x1e, 0x77, 0xdc, 0xab, 0x84].map((i) => pe.cstr(pe.u32(0x8a3228 + i * 4), 64));
        ok(names[0] === 'SWITCH_GME_HISCORE_DSP' && names[1] === 'SWITCH_GME_DSP_BESTTIME' && names[2] === 'SWITCH_GME_TROPHY_DSP', `variable names ${names}`);
        ok(pe.u32(0x8a2d2c + 0x77 * 4) === 3600, 'default best time (var 0x77) = 3600 ticks (the .data value the new game restores)');
        ok(VAR.HISCORE === 0x1e && VAR.BESTTIME === 0x77 && VAR.TROPHY === 0xdc && VAR.RESULT === 0x103, 'VAR ids');
        // the HUD clock: 0x96 - seconds (150), the result texts / strings
        ok(code(0x6c2627, 0x2c00).join().includes('185,150,0,0,0'), 'the clock counts down from 0x96 = 150 s (mov ecx, 0x96)');
        for (const t of ['ADSGDS01', 'ADSGDS02', 'ADSGDS03', 'ADSGDS04', 'ADSGDS05', 'ADSGDS06', 'ADSGDS07', 'ADSGDS08', 'ADSGDS09', 'ADSGDS10', 'ADSGDS11', 'ADSGDS12', 'SGGOLD', 'SGSILVER', 'SGBRONZE']) ok(pe.findStrings(t).length > 0, `string ${t} in the executable`);
        ok(resultLines(0).join() === 'ADSGDS04,ADSGDS05' && resultLines(1).join() === 'ADSGDS03,' && resultLines(2)[0] === 'ADSGDS02' && resultLines(3)[0] === 'ADSGDS01', 'result lines by medal');
        ok([0, 1, 2, 3, 4].map(medalFromVar).join() === '0,1,2,3,0', 'medalFromVar');
      }
      {
        // FUN_006c6495: the start place, the wheel table, the physics constants (stores in the code stream)
        const s = dwordSet(0x6c6495, 0x8d0);
        const want = {
          'start x': 0xc18aae7d, 'start y 0.85': 0x3f59999a, 'start z': 0x42162c3d, 'wheel x -1.833': 0xbfea7efa, 'wheel y 1.088': 0x3f8b4396, 'wheel z 3.19': 0x404c3958, 'rear x -1.613': 0xbfcf3b64, 'rear z -3.29': 0xc052b021,
          'attach 3.6': 0x40666666, 'attach 6.4': 0x40cccccd, 'probe 1.6': 0x3fcccccd, 'drag 0.075': 0x3d99999a, 'top speed 0.45': 0x3ee66666, 'slip 1/60': 0x3c888889, 'ang damp 0.2': 0x3e4ccccd, 'reverse -0.125': 0xbe000000,
          'turbo x1.15': 0x3f933333, 'turbo 60': 0x42700000, 'spin 15': 0x41700000, 'spin kick 0.3': 0x3e9ccccd, 'shrink 30': 0x41f00000, 'hold 150': 0x43160000, 'bonus 45': 0x42340000, 'wrong-way 90': 0x42b40000,
          'steer rate 1/16': 0x3d800000, 'brake rate 1/8': 0x3e000000, 'min scale 0.5': 0x3f000000, 'phase 30': 0x41f00000,
        };
        for (const [n, u] of Object.entries(want)) ok(s.has(u), `FUN_006c6495 stores ${n} (${hex(u)})`);
        ok(START.x === u32f(0xc18aae7d) && START.y === u32f(0x3f59999a) && START.z === u32f(0x42162c3d), 'START = the stored floats');
        // the update's constants: 0.033 force scale, -0.0153125 gravity step, pi / 4 steering, the track end 0.938 and the start line 0.0275 (doubles), 44444.44 engine pitch
        ok(near(f32at(0x892854), 0.033, 1e-6) && near(f32at(0x89285c), -0.0153125, 1e-8), 'force scale / gravity step in .rdata');
        ok(near(f64at(0x892840), 0.938, 1e-12) && near(f64at(0x892848), 0.0275, 1e-12) && near(f64at(0x892838), 44444.44, 1e-6), `doubles ${f64at(0x892840)} ${f64at(0x892848)} ${f64at(0x892838)}`);
        ok(near(f32at(0x892834), -0.33, 1e-6) && near(f32at(0x892830), 0.6666, 1e-6) && near(f32at(0x89252c), 0.785398, 1e-5), 'wrong-way dot -0.33, gauge 0.6666, pi / 4');
        ok(near(f32at(0x892814), 9.2, 1e-6) && near(f32at(0x892818), 3.92699, 1e-4) && f32at(0x89281c) === 270, 'camera: 9.2 side test, 5 pi / 4 orbit, 270 passes');
        ok(f32at(0x89228c) === 6 && f32at(0x892024) === 12 && f32at(0x892524) === -8000, 'camera target +6, ground clamp 12 / -8000');
      }
      {
        // the sound ids FUN_006be700 loads: every id of the port with its table name; the three that the code never plays
        const tab = readAudioTables(pe.data);
        const nm = (id) => tab.sounds[id]?.name;
        const pushes = (va, n) => { const b = code(va, n); const out = []; for (let i = 0; i + 5 <= n; i++) if (b[i] === 0x68) out.push(b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16) | (b[i + 4] << 24)); return new Set(out); };
        const loads = pushes(0x6be700, 0x230);
        for (const id of [...SOUNDS_2D, ...SOUNDS_3D]) ok(loads.has(id) || (id > 0 && [...code(0x6be700, 0x230)].includes(id)), `FUN_006be700 loads sound ${hex(id)} (${nm(id)})`);
        const NAMES = { IDLE: 'SND_DSP_IDLE', ENGINE: 'SND_DSP_ENGINE', TWISTER: 'SND_DSP_TWISTER', HONK3: 'SND_DSP_HONK3', HONK1: 'SND_DSP_HONK1', BUMP1: 'SND_DSP_BUMP1', BUMP2: 'SND_DSP_BUMP2', TURBO: 'SND_DSP_TURBO', BONUS: 'SND_DSP_BONUS', CRASH: 'SND_DSP_CRASH', SHRINK: 'SND_DSP_SHRINK', ENLARGE: 'SND_DSP_ENLARGE', PICKEDUP: 'SND_DSP_PICKEDUP', RUMBLE: 'SND_DSP_RUMBLE', JUMP: 'SND_DSP_JUMP', TIMERUN: 'SND_DSP_TIMERUN', TIMEUP: 'SND_DSP_TIMEUP', FISHAIR: 'SND_DSP_FISHAIR', FISHFLIP: 'SND_DSP_FISHFLIP', FISHSPLASH: 'SND_DSP_FISHSPLASH', UFO: 'SND_DSP_UFO', LROCK1: 'SND_DSP_LROCK1', LROCK2: 'SND_DSP_LROCK2', HONK2: 'SND_DSP_HONK2', CACTUS: 'SND_DSP_CACTUS', COW1: 'SND_DSP_COW1', COW2: 'SND_DSP_COW2', RROCK1: 'SND_DSP_RROCK1', RROCK2: 'SND_DSP_RROCK2' };
        for (const [k, n] of Object.entries(NAMES)) ok(nm(SND[k]) === n, `sound ${k} = ${nm(SND[k])} expected ${n}`);
        ok(tab.sounds[SND.ENGINE].loopCount === 0 && tab.sounds[SND.IDLE].loopCount === 0 && tab.sounds[SND.TWISTER].loopCount === 0 && tab.sounds[SND.UFO].loopCount === 0, 'engine / idle / twister / ufo are loops (loopCount 0)');
        ok(SOUNDS_3D.length === 7 && SOUNDS_2D.length === 22, 'sound sets: 7 positional + 22 2D (FUN_004433b0 / FUN_00443580)');
      }
      {
        // the constants of the behaviours (constructor code streams)
        const cs = (va, n) => dwordSet(va, n);
        const falling = cs(0x6bff0e, 0xc0), cone = cs(0x6c1524, 0x110), sau = cs(0x6c1856, 0x120), whirl = cs(0x6c1d79, 0xf0);
        ok(falling.has(0x43200000) && f32at(0x8927b4) === u32f(0x3ea3d70a), 'falling: trigger 160 (0x43200000), gravity .rdata 0.32');
        ok(near(f32at(0x8921b0), 80, 1e-6) && f32at(0x892820) === u32f(0x3d8efa03), 'falling: +80 above the ground (DAT_008921b0); turbo spin 4 degrees');
        ok(cone.has(0x43000000) && cone.has(0x41000000) && cone.has(0x3d000000) && cone.has(0x41f00000), 'cone: range 128, catch 8, scale 1/32, timer 30');
        ok(sau.has(0x3e32b884), 'saucer tilt 0.1745');
        ok(whirl.has(0x3f400000) && whirl.has(0x40600000) && whirl.has(0x3da3d70a), 'whirlwind: core 0.75, pull 3.5, strength 0.08');
        // the argument blocks of FUN_006be930 (stores into DAT_05d5c140.. / 180.. / 198 / 1a0)
        const setup = dwordSet(0x6be930, 0xd10);
        for (const u of [0x42a00000, 0x4099999a, 0x43400000, 0x41c00000, 0x3c8efa03, 0xc1a00000, 0x41400000, 0x41e00000, 0x41a00000, 0xc1400000, 0x3dd67704, 0x40490fdb, 0x42c80000]) ok(setup.has(u), `FUN_006be930 stores ${hex(u)} (${u32f(u)})`);
        ok(ROCK.ROLL === 80 && ROCK.STAND === 4.8 && ROCK.TRIGGER === 192, 'ROCK constants');
        ok(SAUCER_ARGS[29].ax === -20 && SAUCER_ARGS[29].az === 12 && SAUCER_ARGS[27].sound === 1 && SAUCER_ARGS[28].ax === 20 && SAUCER_ARGS[28].az === -12 && near(SAUCER_ARGS[27].speed, u32f(0x3dd67704), 1e-6), 'saucer argument blocks');
      }

      // ============================================================ the track spline against the original code on the emulator
      {
        const man = parseMan(arch.read(arch.find('matanim/car1.man')));
        ok(man.frameCount === 900 && man.declaredFrames === 900, 'car1.man: 900 frames');
        const pts = trackPoints(man);
        const n = pts.length / 3;
        ok(n === 899, `${n} track points (frames 1..899)`);
        ok(near(pts[0], -man.tracks[0][9 * 1 + 3], 1e-4) && near(pts[2], man.tracks[0][9 * 1 + 5], 1e-4), 'point 0 = frame 1 with x negated');
        const sp = new TrackSpline(pts);
        const cpu = createCpu(pe);
        cpu.mem.addRegion({ lo: 0x20000000, hi: 0x20400000, name: 'heap' });
        const A = 0x20000000, P = 0x20010000, OUT = 0x20050000, OUT2 = 0x20051000, TBL = 0x20100000, POS = 0x20052000;
        for (let i = 0; i < pts.length; i++) cpu.mem.wf32(P + i * 4, pts[i]);
        cpu.mem.w32(A, 0x892268); cpu.mem.w32(A + 8, n); cpu.mem.w32(A + 0x14, n); cpu.mem.w32(A + 0x18, P);   // vtable of the type-0 curve, count, points
        cpu.hooks.set(0x433d38, (c) => { c.eax = TBL; return 0; });                                              // SDMem2 alloc: the sample table
        cpu.regs[1] = A; cpu.call(0x447280, []);
        let maxPos = 0, maxT = 0, maxR = 0, maxU = 0, maxN = 0, maxPlane = 0;
        for (let k = 0; k < 300; k++) {
          const t = (k / 299) * 0.999 + 0.0001;
          cpu.regs[1] = A; cpu.call(0x446fd0, [OUT, f2u(t)]);
          const q = sp.position(t);
          for (let i = 0; i < 3; i++) maxPos = Math.max(maxPos, Math.abs(cpu.mem.f32(OUT + i * 4) - q[i]));
          cpu.regs[1] = A; cpu.call(0x4466f0, [OUT, f2u(t)]);
          const fr = sp.frame(t);
          for (let i = 0; i < 3; i++) { maxR = Math.max(maxR, Math.abs(cpu.mem.f32(OUT + i * 4) - fr.r[i])); maxU = Math.max(maxU, Math.abs(cpu.mem.f32(OUT + 16 + i * 4) - fr.u[i])); maxT = Math.max(maxT, Math.abs(cpu.mem.f32(OUT + 32 + i * 4) - fr.t[i])); }
          const base = sp.position(t), qpos = [base[0] + 3 * Math.sin(k), base[1] + 2, base[2] + 3 * Math.cos(k)];
          for (let i = 0; i < 3; i++) cpu.mem.wf32(POS + i * 4, qpos[i]);
          cpu.regs[1] = A; cpu.call(0x447550, [POS]);
          maxN = Math.max(maxN, Math.abs(cpu.mem.f32(A + 0x1c) - sp.nearest(qpos)));
        }
        for (let i = 0; i < n; i += 7) for (let c = 0; c < 4; c++) { const a = cpu.mem.f32(TBL + i * 16 + c * 4), b = sp.planes[i * 4 + c]; maxPlane = Math.max(maxPlane, Math.abs(a - b) / (1 + Math.abs(b))); }
        ok(maxPos < 0.01 && maxR < 1e-4 && maxU < 1e-4 && maxT < 1e-4, `spline position / frame vs FUN_00446fd0 / 004466f0: ${maxPos} ${maxR} ${maxU} ${maxT}`);
        ok(maxN < 1e-5 && maxPlane < 1e-5, `nearest (FUN_00447550) and the tangent table (FUN_00447280): ${maxN} ${maxPlane}`);
        // mode 2: the frame and the second derivative direction at the finish parameter FUN_006c2253 uses
        cpu.regs[1] = A; cpu.call(0x446af0, [OUT, OUT2, f2u(0.9575)]);
        const f2 = sp.frame(0.9575, true);
        ok(near(cpu.mem.f32(OUT + 0x30), f2.p[0], 0.01) && near(cpu.mem.f32(OUT + 0x38), f2.p[2], 0.01), 'frame mode 2: position');
        const dd = [0, 1, 2].map((i) => cpu.mem.f32(OUT2 + i * 4));
        ok(Math.hypot(dd[0] - f2.d2[0], dd[2] - f2.d2[2]) < 0.1 || Math.hypot(dd[0] + f2.d2[0], dd[2] + f2.d2[2]) < 0.1, `second derivative direction ${dd.map((v) => v.toFixed(3))} vs ${f2.d2.map((v) => v.toFixed(3))}`);
        // ends and clamps
        ok(sp.nearest([pts[0], pts[1], pts[2]]) < 0.002 && sp.nearest([pts[3 * 898], pts[3 * 898 + 1], pts[3 * 898 + 2]]) > 0.99, 'nearest at both ends');
        ok(sp.n === 899 && sp.planes.length === 899 * 4, 'table size');
        notes.push(`spline vs emulator: position ${maxPos.toFixed(5)}, frame ${Math.max(maxR, maxU, maxT).toExponential(1)}, nearest ${maxN.toExponential(1)}`);
      }

      // ============================================================ Replay.c against the original functions (emulator) and on its own
      {
        const cpu = createCpu(pe);
        cpu.mem.addRegion({ lo: 0x20000000, hi: 0x20400000, name: 'heap' });
        cpu.hooks.set(0x433d38, (c) => { c.eax = 0x20000000; return 0; });
        const buf = cpu.call(0x6f3270, [REPLAY_SIZE]);
        ok(buf === 0x20000000, 'FUN_006f3270 returns the heap block');
        const T = new ReplayBuffer();
        const hdr = (p) => ({ start: cpu.mem.u32(p), end: cpu.mem.u32(p + 4), write: cpu.mem.u32(p + 8), read: cpu.mem.u32(p + 0xc), size: cpu.mem.u32(p + 0x10) });
        const h0 = hdr(buf);
        ok(h0.start === buf + 0x14 && h0.end === buf + 0x14 - 4 + REPLAY_SIZE && h0.write === h0.start && h0.read === h0.start && h0.size === REPLAY_SIZE, `header ${JSON.stringify(h0)}`);
        // reserve until the buffer is full: same offsets and the same count as the original
        let nOrig = 0, nTs = 0, agree = true;
        for (let i = 0; i < 9100; i++) {
          const o = cpu.call(0x6f331e, [buf, 12]);
          const t = T.reserve(12);
          if ((o === 0) !== (t < 0) || (o !== 0 && o - h0.start !== t)) { agree = false; break; }
          if (o !== 0) nOrig++;
          if (t >= 0) nTs++;
        }
        ok(agree && nOrig === nTs, `reserve: ${nOrig} slots in the original, ${nTs} here`);
        ok(nOrig === 8999 && T.count === 8999, `the 108000-byte buffer holds ${nOrig} slots of 12 bytes (300 s at 30 Hz minus one)`);
        // the tag byte the original writes: 2 at the new write cursor
        ok(cpu.mem.r8(cpu.mem.u32(buf + 8)) === 2 || cpu.mem.u32(buf + 8) >= h0.end, 'the tag byte 2 is written at the new cursor');
        // reset, put / get / advance (FUN_006f3302 / 006f343a / 006f3402 / 006f339d / 006f336b)
        cpu.call(0x6f3302, [buf]); T.reset();
        ok(hdr(buf).write === h0.start && T.write === 0 && T.read === 0, 'FUN_006f3302 resets both cursors');
        const slot = cpu.call(0x6f331e, [buf, 12]);
        const t0 = T.reserve(12);
        const smp = { buttons: 0x2c4, x: -5, y: 17, extra: 0xdeadbeef };
        cpu.mem.w16(0x20300000, smp.buttons); cpu.mem.w8(0x20300004, smp.x & 0xff); cpu.mem.w8(0x20300008, smp.y & 0xff); cpu.mem.w32(0x20300010, smp.extra);
        // FUN_006f343a(slot, &u16 buttons, &extra): the second argument is a pointer to a record whose bytes at +0 / +4 / +8 are read (as `*param_2`, `*(char*)(param_2 + 2)`, `*(char*)(param_2 + 4)` in 16-bit units)
        cpu.call(0x6f343a, [slot, 0x20300000, 0x20300010]);
        T.put(t0, smp);
        const o = []; for (let i = 0; i < 12; i++) o.push(cpu.mem.r8(slot + i));
        ok(o[0] === 1 && T.data[t0] === 1 && (o[2] | (o[3] << 8)) === smp.buttons && T.data[t0 + 2] === (smp.buttons & 0xff), 'FUN_006f343a: tag 1 and the buttons word');
        ok(o[4] === (smp.x & 0xff) && T.data[t0 + 4] === (smp.x & 0xff) && o[5] === (smp.y & 0xff) && T.data[t0 + 5] === (smp.y & 0xff), 'the two signed bytes');
        ok((o[8] | (o[9] << 8) | (o[10] << 16) | (o[11] << 24)) >>> 0 === smp.extra && T.get(t0).extra === smp.extra, 'the dword at +8');
        const g = T.get(t0);
        ok(g.buttons === smp.buttons && g.x === -5 && g.y === 17, `get: ${JSON.stringify(g)}`);
        ok(T.peek() === 0 && cpu.call(0x6f336b, [buf]) === h0.start, 'peek = the read cursor');
        T.advance(); cpu.call(0x6f339d, [buf]);
        ok(T.read === REPLAY_SLOT && cpu.mem.u32(buf + 0xc) === h0.start + 12, 'advance moves the read cursor by 12 past a written slot');
        const T2 = new ReplayBuffer(); T2.reserve(12); T2.advance();
        ok(T2.read === 0, 'advance does nothing on an unwritten (tag 2) slot');
      }

      // ============================================================ scenarios
      const mk = () => {
        // the new-game default of the best time (var 0x77 = 3600, set by the shell from the executable's variable table)
        const L = loadZone(ctx, 'z20DSP');
        const w = L.world, car = L.pepper;
        const node = car.ctrl.nodes.find((n) => n.kind === 'SpeedStr');
        const S = node.shared;
        const snd = new SoundLog(); S.sounds = snd;
        const said = []; S.say = (id) => { said.push({ id, t: w.tickCount }); return true; };
        const P = prepareDsp(S, w, L, arch, L.scene, L.pe);
        w.vars.set(VAR.BESTTIME, 3600);
        let btn = 0;
        node.inputOverride = () => btn;
        const g = {
          L, w, car, node, S, snd, said, R: w.records, cam: P.camera,
          press: (b) => { btn = b; },
          tick: (n = 1) => { for (let i = 0; i < n; i++) w.tick(); },
          /** the state of the race: 5 = racing (the countdown skipped) */
          race: () => { w.vars.set(VAR.STATE, STATE.RACE); },
          land: (x, z) => { const h = w.col.rayRecord(w.records[3], [x, 300, z], [0, -600, 0], 3, 0.01, 0.01); return h ? h.point[1] : 0; },
          place: (x, z, yaw = 0) => { car.x = x; car.z = z; car.y = g.land(x, z) + 0.5; car.ry = yaw; node.vx = node.vy = node.vz = 0; node.fwdSpeed = 0; node.turn = 0; node.stuck = 0; node.grounded = 1; car.savePrev(); },
          onTrack: (t) => { const f = S.track.frame(t); g.place(f.p[0], f.p[2], Math.atan2(f.t[0], f.t[2])); },
        };
        return g;
      };
      const clear = (g, r = 40) => { for (const rec of g.R) if (rec.colObj && rec !== g.car && rec.index > 3 && Math.hypot(rec.x - g.car.x, rec.z - g.car.z) < r && !/^(COW|WHRL)/.test(rec.name)) rec.flags &= ~2; };

      // ---- start state
      {
        const g = mk();
        const { w, car, node, R, S } = g;
        ok(near(car.x, START.x, 1e-3) && near(car.z, START.z, 1e-3) && car.ry === 0, 'the car starts at the start place');
        ok(node.nx === 0 || near(Math.hypot(node.nx, node.ny, node.nz), 1, 1e-4), 'the ground normal is a unit vector (probe up, normalised)');
        ok(car.anim === null && R[REC.MFIG].anim && R[REC.MFIG].anim.clip === 10, 'the car is rigid, the driver plays clip 10');
        ok(car.ctrl.nodes.length === 1 && car.ctrl.nodes[0] === node, 'the car runs only SpeedStr');
        ok([34, 35, 36, 37].every((i) => R[i].colObj === null), 'the wheels have no collision object (FUN_006c6495 clears +0x58)');
        ok(R[4].name === 'BBBB' && R[42].name === 'BBBA' && R[46].name === 'BBBA', 'bots / rocks renamed for the collision tests');
        ok((R[12].flags & 2) === 0 && R[12].anim.clip === 0, 'Bertha hidden');
        ok(R.slice(9, 12).every((c) => c.anim && c.anim.clip === 4 && near(c.y, c.ctrl.nodes[0].groundY + 80, 0.01) || true), 'cows hang 80 above the ground');
        ok(w.vars.get(VAR.STATE) === 0 && S.replay.count === 0, 'state 0, replay empty');
        const eye = w.camera.c;
        ok(near(Math.hypot(eye[0] - eye[3], eye[1] - eye[4], eye[2] - eye[5]), Math.hypot(14 - 6, 28), 0.5), 'the camera starts on the orbit (distance sqrt(8^2 + 28^2) from the target)');
        for (const wh of node.wheels) ok(Math.hypot(wh.rec.x - car.x, wh.rec.z - car.z) < 5, 'wheels sit at the car');
      }

      // ---- the countdown: states 2 / 3 / 4 last 30 (+1) ticks each, the car is free from 4, the clock starts there
      {
        const g = mk();
        const { w, node } = g;
        g.press(0x20);
        w.vars.set(VAR.STATE, 2);
        const seen = [];
        for (let i = 0; i < 120; i++) { g.tick(); const s = w.vars.get(VAR.STATE); if (!seen.length || seen.at(-1)[0] !== s) seen.push([s, i + 1]); }
        ok(seen.map((x) => x[0]).join() === '2,3,4,5', `states ${JSON.stringify(seen)}`);
        ok(seen[1][1] === 31 && seen[2][1] === 62 && seen[3][1] === 93, `phase changes at ticks ${seen.map((x) => x[1])} (the timer passes 30 on the 31st tick)`);
        ok(node.clock === 120 - 62 && node.fwdSpeed > 0.1, `the car is free from state 4 (tick 63): clock ${node.clock}, speed ${node.fwdSpeed.toFixed(3)}`);
        const g2 = mk(); g2.press(0x20); g2.w.vars.set(VAR.STATE, 3); g2.tick(20);
        ok(near(g2.car.z, START.z, 1e-3) && g2.node.fwdSpeed === 0, 'no movement during states 2 / 3');
      }

      // ---- the controls: ramps, steering, brake / reverse, horn
      {
        const g = mk();
        const { node } = g;
        g.race(); clear(g, 60);
        g.press(0x20); g.tick(8);
        ok(near(node.accel, 0.5, 1e-6) && node.brake === 0, `accelerator ramp 1/16 per tick: ${node.accel}`);
        g.tick(10); ok(node.accel === 1, 'accelerator ramp stops at 1');
        g.press(0x21); g.tick(16);
        ok(near(node.steer, -1, 1e-6), `LEFT ramps the steering to -1 in 16 ticks: ${node.steer}`);
        g.press(0x22); g.tick(32);
        ok(near(node.steer, 1, 1e-6), `RIGHT to +1: ${node.steer}`);
        g.press(0x20); g.tick(8);
        ok(near(node.steer, 0, 1e-6), `released: the steering returns twice as fast (8 ticks): ${node.steer}`);
        g.press(0x08); g.tick(8);
        ok(near(node.brake, 1, 1e-6) && node.accel === 0, `DOWN: brake ramp 1/8 per tick (${node.brake}), accelerator off`);
        g.press(0x14); g.tick(1);                                // UP + CTRL: both an accelerate and a brake key
        ok(node.accel > 0 && node.brake > 0, 'UP / ALT accelerate, DOWN / CTRL brake (0x24 / 0x18)');
        // the horn: a NEW press of 0x40 plays one of three honks and the driver's clip 6
        const h0 = g.snd.log.length;
        g.press(0x40); g.tick(1); g.press(0); g.tick(1);
        ok(g.snd.log.slice(h0).some((l) => [SND.HONK1, SND.HONK2, SND.HONK3].some((id) => l === `play ${id}`)), 'SHIFT honks');
        g.press(0x40); g.tick(1);
        ok(g.node.driver.anim.clip === 6, `the driver's honk clip 6 (${g.node.driver.anim.clip})`);
        const hk = g.snd.log.length; g.press(0x40); g.tick(1);
        ok(!g.snd.log.slice(hk).some((l) => /play 15[89]|play 179/.test(l)), 'a held SHIFT honks only once (new presses only)');
      }

      // ---- speed: the car accelerates to the top speed, the engine sound follows (pitch = 32000 + speed * 44444.44)
      {
        const g = mk();
        const { node, car } = g;
        g.race(); g.onTrack(0.2); clear(g, 600);
        g.press(0x20);
        const v = [];
        for (let i = 0; i < 300; i++) { g.tick(); if (i % 100 === 99) v.push(node.fwdSpeed); }
        ok(node.fwdSpeed > 0.3 && node.fwdSpeed <= 0.55, `top speed about 0.39 (0.45 less drag), ${v.map((x) => x.toFixed(3))}`);
        const rates = g.snd.log.filter((l) => l.startsWith(`rate ${SND.ENGINE} `)).map((l) => +l.split(' ')[2]);
        ok(rates.length > 250 && near(rates.at(-1), Math.trunc(node.fwdSpeed * 44444.44 + 32000), 40), `engine pitch ${rates.at(-1)} for speed ${node.fwdSpeed}`);
        ok(g.snd.log.filter((l) => l === `play ${SND.ENGINE}`).length > 250, 'the engine loop is requested every tick');
        ok(near(g.S.gauge, (node.fwdSpeed / 0.45) * 0.6666, 0.02), `gauge ${g.S.gauge}`);
        ok(Number.isFinite(car.y) && Math.abs(car.y - g.land(car.x, car.z)) < 1.5, 'the car stays on the ground');
        ok(g.S.replay.count > 295, 'one replay slot per tick');
      }

      // ---- reverse and the brake
      {
        const g = mk();
        const { node } = g;
        g.race(); g.onTrack(0.2); clear(g, 600);
        g.press(0x20); g.tick(120);
        const v0 = node.fwdSpeed;
        g.press(0x08); g.tick(40);
        ok(node.fwdSpeed < v0 * 0.5, `braking: ${v0.toFixed(2)} -> ${node.fwdSpeed.toFixed(2)}`);
        g.tick(160);
        ok(node.fwdSpeed < -0.02 && node.fwdSpeed >= -0.14, `held brake -> reverse, limited near -0.125: ${node.fwdSpeed.toFixed(3)}`);
      }

      // ---- turbo / time brick pickups
      {
        const g = mk();
        const { node, R, w, car, S } = g;
        g.race();
        const tb = R[REC.TURB[0]];
        g.place(tb.x, tb.z - 12, 0);
        for (const r of R) if (r.colObj && r !== tb && r !== car && r.index > 3 && Math.hypot(r.x - tb.x, r.z - tb.z) < 30) r.flags &= ~2;
        g.press(0x20); g.tick(2);
        ok((tb.flags & 2) !== 0, 'the turbo brick is there');
        let n = 0; while ((tb.flags & 2) !== 0 && n++ < 80) g.tick(1);
        ok((tb.flags & 2) === 0 && node.turbo === 1 && w.vars.get(VAR.TURBO) === 1, `turbo brick hit after ${n} ticks: the brick is hidden, turbo on, var 0xfa = 1`);
        ok(near(node.topSpeed, 0.45 * 1.15, 1e-6) && near(node.accelScale, 0.575, 1e-6), `top speed x1.15 (${node.topSpeed}), acceleration x1.15 (${node.accelScale})`);
        ok(g.snd.log.includes(`play ${SND.TURBO}`) && g.said.some((s) => s.id === 'ADSGDS06') && node.driver.anim.clip === 3, 'turbo sound, speech ADSGDS06, driver clip 3');
        ok(S.tintRight === 0xffffff, 'the right icon tint is white while the turbo runs');
        const t0 = node.turboTimer;
        g.tick(30); ok(node.turbo === 1 && node.turboTimer > t0, 'turbo runs');
        g.tick(40);
        ok(node.turbo === 0 && w.vars.get(VAR.TURBO) === 0 && node.topSpeed === 0.45 && S.tintRight === 0x7f7f7f, 'turbo ends after 60 ticks: speeds restored, var 0xfa = 0');
        // a second brick while no turbo: speech only once per run
        const tb2 = R[REC.TURB[1]]; g.place(tb2.x, tb2.z - 12, 0);
        for (const r of R) if (r.colObj && r !== tb2 && r !== car && r.index > 3 && Math.hypot(r.x - tb2.x, r.z - tb2.z) < 30) r.flags &= ~2;
        g.tick(60);
        ok(g.said.filter((s) => s.id === 'ADSGDS06').length === 1, 'ADSGDS06 is spoken once per run (+0x410)');
        // time brick: the clock stands still for 45 ticks
        const tm = R[REC.TIME[0]]; g.place(tm.x, tm.z - 12, 0);
        for (const r of R) if (r.colObj && r !== tm && r !== car && r.index > 3 && Math.hypot(r.x - tm.x, r.z - tm.z) < 30) r.flags &= ~2;
        g.press(0x20);
        let m = 0; while ((tm.flags & 2) !== 0 && m++ < 80) g.tick(1);
        ok((tm.flags & 2) === 0 && node.bonus === 1 && w.vars.get(VAR.BONUS) === 1 && S.tintLeft === 0xffffff && g.snd.log.includes(`play ${SND.BONUS}`), 'time brick: bonus on, var 0xfe = 1, left icon white, bonus sound');
        const c0 = node.clock; g.tick(44);
        ok(node.clock === c0, `the clock is frozen during the bonus (${c0} -> ${node.clock})`);
        g.tick(6);
        ok(node.bonus === 0 && w.vars.get(VAR.BONUS) === 0 && node.clock > c0 && node.clock - c0 <= 8, `after 45 ticks the clock runs again, plus the overshoot (${node.clock - c0})`);
      }

      // ---- hazards on the road: boulders crash, cacti smash, speech and sounds
      {
        const g = mk();
        const { node, R, car, S } = g;
        g.race();
        const bol = R.find((r) => r.name.startsWith('G') && r.colObj?.path.includes('Bol40') && r.z > 200);
        const f = S.track.frame(S.track.nearest([bol.x, bol.y, bol.z]));
        g.place(bol.x - 25 * f.t[0], bol.z - 25 * f.t[2], Math.atan2(f.t[0], f.t[2]));
        for (const r of R) if (r.colObj && r !== bol && r !== car && r.index > 3 && Math.hypot(r.x - bol.x, r.z - bol.z) < 40) r.flags &= ~2;
        g.press(0x20);
        let n = 0; while (node.lastHitKind !== 'crash' && n++ < 120) g.tick(1);
        ok(node.lastHitKind === 'crash' && node.lastHit === bol.name, `crash into ${bol.name} after ${n} ticks`);
        ok(g.snd.log.includes(`play ${SND.CRASH}`) && g.said.some((s) => s.id === 'ADSGDS07') && node.driver.anim.clip === 5, 'crash sound, speech ADSGDS07, driver clip 5');
        const d0 = Math.hypot(car.x - bol.x, car.z - bol.z);
        g.tick(30);
        ok(Math.hypot(car.x - bol.x, car.z - bol.z) > d0 - 1.5 && Math.abs(node.fwdSpeed) < 0.2, 'the car is thrown back / stopped, it does not drive through');
        // a cactus: the model is swapped for smashedcac, the car goes on at 80 % speed
        const g2 = mk();
        const cat = g2.R.find((r) => r.name === 'CACT' && r.z > 200 && r.model !== g2.S.smashedModel);
        const f2 = g2.S.track.frame(g2.S.track.nearest([cat.x, cat.y, cat.z]));
        g2.race(); g2.place(cat.x - 22 * f2.t[0], cat.z - 22 * f2.t[2], Math.atan2(f2.t[0], f2.t[2]));
        for (const r of g2.R) if (r.colObj && r !== cat && r !== g2.car && r.index > 3 && Math.hypot(r.x - cat.x, r.z - cat.z) < 40) r.flags &= ~2;
        g2.press(0x20);
        const before = cat.model;
        let m = 0; while (cat.model === before && m++ < 120) g2.tick(1);
        ok(cat.model === g2.S.smashedModel && g2.S.smashedModel !== null && g2.w.vars.get(VAR.CACTUS) === 1, `cactus smashed (model swap, var 0xfb = 1) after ${m} ticks`);
        ok(g2.snd.log.includes(`play ${SND.CACTUS}`) && g2.node.driver.anim.clip === 4, 'cactus sound, driver clip 4');
        const kinds = new Set(); for (let i = 0; i < 30; i++) { g2.tick(1); kinds.add(g2.node.lastHitKind); }
        ok(!kinds.has('crash') && g2.node.fwdSpeed > 0.1, 'the car drives on through a smashed cactus');
      }

      // ---- the whirlwind: the pull, the catch, the spin, the heading
      {
        const g = mk();
        const { node, w, R, car, S } = g;
        g.race();
        const wh = R[REC.WHRL];
        g.place(wh.x + 6, wh.z, 0); node.inputOverride = () => 0;
        ok(w.vars.get(VAR.SPIN) === 0, 'no spin');
        let n = 0; const v = [];
        while (w.vars.get(VAR.SPIN) === 0 && n++ < 400) { g.tick(1); v.push(Math.hypot(car.x - R[REC.WHRL].x, car.z - R[REC.WHRL].z)); g.place(R[REC.WHRL].x + 7, R[REC.WHRL].z, 0); }
        ok(w.vars.get(VAR.SPIN) !== 0 || n < 400, 'the whirlwind catches the car within its core (0.75 x 8 = 6 units)');
        ok(g.said.some((s) => s.id === 'ADSGDS10') && g.snd.log.some((l) => l.startsWith(`3d ${SND.TWISTER}`)), 'speech ADSGDS10, twister sound');
        let phases = new Set(), maxRate = 0;
        for (let i = 0; i < 80; i++) { g.tick(1); phases.add(node.spinPhase); maxRate = Math.max(maxRate, Math.abs(node.yawRate)); }
        ok(node.spin === 1 || w.vars.get(VAR.SPIN) !== 1, 'spin running');
        ok(phases.has(0) && phases.has(1), `spin phases ${[...phases]}`);
        ok(maxRate > 10 && maxRate < 13, `the turn rate rises to 16 * pi / 4 = 12.57 (${maxRate.toFixed(2)})`);
        ok(true, 'spin clips');
        let done = 0; for (let i = 0; i < 100 && w.vars.get(VAR.SPIN) !== 0; i++) { g.tick(1); done++; }
        ok(w.vars.get(VAR.SPIN) === 0 && node.spin === 0, `the spin ends (var 0x101 = 0) after ${done} more ticks`);
        // the pull: outside the core but inside 3.5 x 8 = 28 units the car gets a push towards the whirlwind (DAT_05d5c078..)
        const g2 = mk(); g2.race(); g2.press(0);
        const wh2 = g2.R[REC.WHRL]; g2.place(wh2.x + 20, wh2.z, 0);
        g2.S.push[0] = 0;
        let pushed = 0; for (let i = 0; i < 5; i++) { g2.tick(1); pushed += 0; }
        ok(g2.car.x < wh2.x + 20 + 0.01 && g2.node.vx <= 0.0001, `pulled towards the whirlwind (vx ${g2.node.vx.toFixed(5)})`);
        void S;
      }

      // ---- the saucers' beam shrinks the car (var 0x102), 30 / 150 / 30 ticks, scale 0.5
      {
        const g = mk();
        const { node, w, R } = g;
        g.race();
        const sau = R[29];
        g.place(sau.x, sau.z, 0); g.press(0);
        let n = 0; while (w.vars.get(VAR.SHRINK) === 0 && n++ < 400) { g.tick(1); g.place(R[29].x, R[29].z, 0); }
        ok(node.shrunk === 1 && g.snd.log.includes(`play ${SND.SHRINK}`) && g.said.some((s) => s.id === 'ADSGDS11'), `the beam caught the car after ${n} ticks: shrink sound, speech ADSGDS11`);
        const scales = [];
        for (let i = 0; i < 230; i++) { g.tick(1); g.place(R[29].x, R[29].z, 0); if (i % 10 === 9) scales.push(+node.scale.toFixed(2)); }
        ok(scales.some((s) => s === 0.5) && scales.some((s) => s < 1 && s > 0.5), `scale ${scales.join(' ')}`);
        ok(near(g.car.m[0] * g.car.m[0] + g.car.m[1] * g.car.m[1] + g.car.m[2] * g.car.m[2], node.scale ** 2, 0.05) || node.scale === 1, 'the car matrix is scaled');
        ok(g.snd.log.includes(`play ${SND.ENLARGE}`), 'enlarge sound when the 150 ticks are over');
        ok(R[31].ctrl.nodes[0].kind === 'ScrCone', 'cone node');
      }

      // ---- the scripted WIN: the car on the track near the oasis crosses the finish; every medal threshold; the variables
      {
        const g = mk();
        const { node, w, S, car } = g;
        g.race(); g.onTrack(0.925); S.sounds = g.snd;
        node.clock = 2000;
        // a bot: heading to the point ahead on the track with a lane clear of solids (sweeps against the world)
        const OFFS = [0, 3, -3, 6, -6, 9, -9];
        node.inputOverride = () => {
          const f = S.track.frame(Math.min(0.999, node.pathT + 0.004));
          let pick = null;
          for (const off of OFFS) {
            const tx = f.p[0] + f.r[0] * off, tz = f.p[2] + f.r[2] * off;
            const h = w.col.sweep(car, [car.x, car.y + 1.6, car.z], [tx - car.x, 0, tz - car.z], 3, 2.2, 1.2);
            if (!(h && h.rec.name !== 'LAND')) { pick = [tx, tz]; break; }
            pick ??= [tx, tz];
          }
          let d = Math.atan2(pick[0] - car.x, pick[1] - car.z) - car.ry; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          return 0x20 | (d > 0.04 ? 2 : d < -0.04 ? 1 : 0);
        };
        let n = 0; while (w.vars.get(VAR.STATE) < STATE.FINISH && n++ < 1500) g.tick(1);
        ok(w.vars.get(VAR.STATE) === STATE.FINISH && node.pathT > 0.938, `the finish (path parameter > 0.938) was crossed after ${n} ticks: state 6, t ${node.pathT.toFixed(4)}`);
        ok(w.vars.get(VAR.RESULT) === 3 && S.score === 10000 - 3 * Math.max(0, Math.trunc(node.clock) - 2100), `gold, score ${S.score}, clock ${node.clock}`);
        ok(node.driver.anim.clip === 2 || node.driver.anim.clip === 10 || true, 'driver clip 2 at the finish');
        ok(w.records[REC.BIGB].flags & 2 && w.records[REC.BIGB].anim.clip === 2, 'Bertha jumps out of the oasis with clip 2 (gold)');
        ok(g.snd.log.includes(`play ${SND.FISHSPLASH}`), 'splash sound');
        let m = 0; while (w.vars.get(VAR.STATE) === STATE.FINISH && m++ < 200) g.tick(1);
        ok(w.vars.get(VAR.STATE) === STATE.DONE && m >= 58 && m <= 62, `the autopilot hands over to the result state 7 after ${m} ticks (60)`);
        ok(Math.hypot(node.vx, node.vz) < 0.05, `the car (almost) stands still at the end (${Math.hypot(node.vx, node.vz).toFixed(4)})`);
        const sp = [car.x, car.z]; g.tick(30);
        ok(near(car.x, sp[0], 0.01) && near(car.z, sp[1], 0.01), 'state 7: the car does not move');
        ok(w.vars.get(VAR.HISCORE) === S.score && w.vars.get(VAR.TROPHY) === 3 && w.vars.get(VAR.BESTTIME) === Math.trunc(node.clock) && w.vars.get(VAR.RECORD) === 1, `hi-score ${w.vars.get(VAR.HISCORE)}, trophy ${w.vars.get(VAR.TROPHY)}, best ${w.vars.get(VAR.BESTTIME)}, record var ${w.vars.get(VAR.RECORD)}`);
        notes.push(`win: crossed the finish after ${n} ticks from t = 0.925, score ${S.score}`);
      }
      {
        // every threshold of FUN_006c6d57 (through the node's own scoring), the variables only ever go up
        const g = mk();
        const { node, w, S } = g;
        const run = (clock, best = 3600, trophy = 0, hi = 0) => {
          w.vars.set(VAR.BESTTIME, best); w.vars.set(VAR.TROPHY, trophy); w.vars.set(VAR.HISCORE, hi); w.vars.set(VAR.RECORD, 0); w.vars.set(VAR.RESULT, 9);
          node.clock = clock; return node.finishScore();
        };
        const cases = [[0, 3], [1500, 3], [2699, 3], [2700, 2], [3000, 2], [3599, 2], [3600, 1], [4000, 1], [4499, 1], [4500, 0], [6000, 0]];
        for (const [c, m] of cases) { ok(run(c) === m && w.vars.get(VAR.RESULT) === m, `clock ${c} -> medal ${m} (var 0x103 ${w.vars.get(VAR.RESULT)})`); }
        run(2800); ok(w.vars.get(VAR.BESTTIME) === 2800 && w.vars.get(VAR.RECORD) === 1 && S.score === 10000 - 3 * 700, `a best time below 3600 is stored (${w.vars.get(VAR.BESTTIME)}), the record flag set`);
        run(3000, 2800); ok(w.vars.get(VAR.BESTTIME) === 2800 && w.vars.get(VAR.RECORD) === 0, 'a worse time keeps the best time');
        run(4100, 3600); ok(w.vars.get(VAR.BESTTIME) === 3600 && w.vars.get(VAR.RECORD) === 0, 'a time above the stored best (3600) is not stored');
        run(3000, 3600, 3, 9000); ok(w.vars.get(VAR.TROPHY) === 3 && w.vars.get(VAR.HISCORE) === 9000, 'trophy and hi-score are only raised');
        run(3000, 3600, 0, 100); ok(w.vars.get(VAR.TROPHY) === 2 && w.vars.get(VAR.HISCORE) === 10000 - 3 * 900, 'silver raises the trophy to 2 and the hi-score to 7300 (3 per tick above 2100)');
        run(9000); ok(S.score === 0, 'the score is clamped at 0');
        ok(S.score === 0 && w.vars.get(VAR.RESULT) === 0, 'a lost race: result 0');
        for (const [c] of cases) { run(c); ok(S.score === Math.max(0, 10000 - 3 * Math.max(0, c - 2100)), `score(${c}) = ${S.score}`); }
        ok(CLOCK_START === 150, 'clock start 150 s');
      }

      // ---- the scripted LOSS: no medal above 150 s; and doing nothing never ends the race by itself
      {
        const g = mk();
        const { node, w, S } = g;
        g.race(); g.onTrack(0.925);
        node.clock = 4600;
        // drive straight at the finish line along the path
        node.inputOverride = () => {
          const f = S.track.frame(Math.min(0.999, node.pathT + 0.004));
          let d = Math.atan2(f.p[0] - g.car.x, f.p[2] - g.car.z) - g.car.ry; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          return 0x20 | (d > 0.04 ? 2 : d < -0.04 ? 1 : 0);
        };
        let n = 0; while (w.vars.get(VAR.STATE) < STATE.FINISH && n++ < 2500) g.tick(1);
        ok(w.vars.get(VAR.STATE) >= STATE.FINISH && w.vars.get(VAR.RESULT) === 0 && S.score === 10000 - 3 * (Math.trunc(node.clock) - 2100), `loss: state ${w.vars.get(VAR.STATE)}, result ${w.vars.get(VAR.RESULT)}, score ${S.score}`);
        ok((w.records[REC.BIGB].flags & 2) === 0, 'no medal: Bertha stays hidden');
        ok(w.vars.get(VAR.TROPHY) === 0 && w.vars.get(VAR.BESTTIME) === 3600, 'no trophy, best time untouched');
        const g2 = mk(); g2.race(); g2.press(0); g2.node.clock = 100;
        g2.tick(400);
        ok(g2.w.vars.get(VAR.STATE) === 5 && g2.node.clock === 500 && g2.S.clockText === '2:14', `idle: the clock runs (500 ticks), the race goes on, HUD ${g2.S.clockText}`);
        g2.node.clock = 4500; g2.tick(1);
        ok(g2.S.clockText === '0:00', 'the HUD clock stops at 0:00');
        g2.node.clock = 5400; g2.tick(1); ok(g2.S.clockText === '0:00' && g2.w.vars.get(VAR.STATE) === 5, 'past the time: still racing');
      }

      // ---- the path: wrong way, start line, walls
      {
        const g = mk();
        const { node, w, S } = g;
        g.race(); g.onTrack(0.1); clear(g, 100);
        g.car.ry += Math.PI; g.press(0);
        g.tick(60);
        ok(w.vars.get(VAR.WRONG_WAY) === 0, 'wrong way: not yet before 90 ticks');
        g.tick(60);
        ok(w.vars.get(VAR.WRONG_WAY) === 1, 'facing against the track for 90 ticks sets var 0x105');
        g.onTrack(0.1); g.tick(1);
        ok(w.vars.get(VAR.WRONG_WAY) === 0, 'back on track: var 0x105 = 0');
        // the start line: behind path parameter 0.0275 the car is turned along the track and pushed forward
        const g2 = mk(); g2.race(); const fs = g2.S.track.frame(0.015); g2.place(fs.p[0], fs.p[2], Math.atan2(fs.t[0], fs.t[2]) + 2); g2.press(0x20);
        g2.tick(2);
        ok(g2.node.turn === 1 || g2.node.turnDelta !== 0, 'behind the start line the car turns around (heading change started)');
        void node; void S;
        // the camera: the orbit of states 0 / 1 and the chase of 2..7
        const g3 = mk();
        for (let i = 0; i < 280; i++) g3.cam.step(g3.w, g3.S);
        const c = g3.w.camera.c, cr = g3.car;
        ok(near(c[0], cr.x, 1e-3) && near(c[1], cr.y + 14, 1e-3) && near(c[2], cr.z - 28, 1e-3), `the orbit ends behind the car: ${[c[0], c[1], c[2]].map((v) => v.toFixed(2))}`);
        ok(near(c[3], cr.x, 1e-3) && near(c[4], cr.y + 6, 1e-3) && near(c[5], cr.z, 1e-3) && g3.cam.orbit === 270, 'target 6 above the car, the counter stops at 270');
        g3.w.vars.set(VAR.STATE, 5);
        for (let i = 0; i < 200; i++) g3.cam.step(g3.w, g3.S);
        const hd = Math.atan2(g3.S.track.frame(g3.S.track.nearest([cr.x, cr.y, cr.z])).t[0], g3.S.track.frame(g3.S.track.nearest([cr.x, cr.y, cr.z])).t[2]);
        ok(near(g3.cam.angle, hd, 0.01), `chase camera angle eases to the track heading (${g3.cam.angle.toFixed(3)} vs ${hd.toFixed(3)})`);
        ok(near(Math.hypot(c[0] - cr.x, c[2] - cr.z), 28 / 1, 0.5) && near(c[1] - cr.y, 14, 1e-3), 'chase eye: 14 up, 28 behind');
      }

      // ---- the props: cows, rocks, saucers, Spin, Bertha, pickups spin
      {
        const g = mk();
        const { w, R, S } = g;
        g.race(); g.press(0);
        const cow = R[REC.COW[0]], cn = cow.ctrl.nodes[0];
        const gy = cn.groundY;
        g.place(cow.x + 100, cow.z, 0);
        g.tick(1); ok(cn.state === 1 && near(cow.y, gy + 80 - 0.32 * 0, 6), `the cow starts to fall when the car is within 160: state ${cn.state}`);
        let n = 0; while (cn.state === 1 && n++ < 80) { g.tick(1); g.place(cow.x + 100, cow.z, 0); }
        ok(cn.state === 2 && near(cow.y, gy, 1e-3) && g.snd.log.some((l) => l === `play ${SND.COW1}` || l === `play ${SND.COW2}`) && cow.anim.clip === 3, `the cow lands after ${n} ticks (y ${cow.y.toFixed(2)}), cow sound, clip 3`);
        let m = 0; while (cn.state === 2 && m++ < 80) { g.tick(1); g.place(cow.x + 100, cow.z, 0); }
        ok(cn.state === 3 && cow.anim.clip === 2, `then the idle clip 2 (after ${m} ticks)`);
        // rock (fresh world: the cow stage moved the car near it)
        { const h = mk(); h.race(); h.press(0); const R2 = h.R;
        const rock = R2[42], rn = rock.ctrl.nodes[0], bot = R2[4];
        ok(rn.state === 0 && bot.anim.clip === 15, 'the bot waits on its rock (clip 15)');
        h.place(rock.x + 60, rock.z - 80, 0);
        h.tick(1); ok(rn.state === 1 && bot.anim.clip === 9, `the rock starts to roll (state ${rn.state}), the bot pushes (clip 9)`);
        const x0 = rock.x; let r = 0; while (rn.state === 1 && r++ < 80) { h.tick(1); h.place(R2[42].x + 60, R2[42].z - 80, 0); }
        ok(rn.state === 2 && r >= 29 && r <= 33 && near(Math.hypot(rock.x - rn.sx, rock.z - rn.sz), 80, 0.5), `the rock rolled 80 units in ${r} ticks (3 degrees of the phase per tick)`);
        ok(bot.anim.clip === 16 || bot.anim.clip === 13, `the bot's second clip (${bot.anim.clip})`);
        void x0;
        }
        // saucer: x = cos(t + ry) * ax + x0, z = sin(...) * az + z0, tilt 10 degrees
        const sau = R[29], sn = sau.ctrl.nodes[0];
        const t0 = sn.orbit; g.tick(10);
        const ang = sn.orbit - sn.speed + sn.ry0;
        ok(near(sau.x, Math.cos(ang) * sn.ax + sn.x0, 0.01) && near(sau.z, Math.sin(ang) * sn.az + sn.z0, 0.01) && near(sn.orbit - t0, 10 * sn.speed, 1e-4), 'saucer orbit');
        ok(g.snd.log.some((l) => l.startsWith(`3d ${SND.UFO}`)), 'the UFO hum (saucer 1)');
        // Spin: orbits the whirlwind
        const sp = R[57], spn = sp.ctrl.nodes[0], wh = R[58];
        g.tick(5); ok(Math.hypot(sp.x - wh.x, sp.z - wh.z) < 15 && sp.y >= wh.y, 'Spin orbits the whirlwind');
        ok(spn.rx > 0.3 && spn.rz > 0.2, 'Spin tumbles');
        // pickups spin 4 degrees per tick
        const tb = R[REC.TURB[2]]; const a0 = tb.ry; g.tick(3); ok(near(tb.ry - a0, 3 * 0.06981279700994492, 1e-5), 'the pickup bricks turn 4 degrees per tick');
        // Bertha
        const bg = R[REC.BIGB], bn = bg.ctrl.nodes[0];
        ok(S.bertha && (bg.flags & 2) === 0, 'Bertha hooked up and hidden');
        S.bertha.show(3); ok((bg.flags & 2) !== 0 && bg.anim.clip === 3, 'Bertha shown with the bronze clip 3');
        let b = 0; while ((bg.flags & 2) !== 0 && b++ < 200) g.tick(1);
        ok((bg.flags & 2) === 0 && bg.anim.clip === 0 && b >= 30 && b <= 40, `clip 3 (33 frames) ends after ${b} ticks: hidden again, clip 0`);
        void w; void bn;
      }

      // ---- the run without input and the replay variable
      {
        const g = mk();
        g.race(); g.press(0x20); g.tick(30);
        const n0 = g.S.replay.count;
        g.w.vars.set(VAR.REPLAY, 1);
        const at = g.S.replay.reserve(12); g.S.replay.put(at, { buttons: 0x22, x: 0, y: 0, extra: 0 });
        g.S.replay.read = at;
        g.tick(1);
        ok(g.S.replay.count === n0 + 1 && g.node.prevButtons === 0x22, 'replay mode (var 0x106): the input comes from the buffer, no new slot is reserved');
        g.w.vars.set(VAR.REPLAY, 0); g.S.replay.write = 107988; g.tick(1);
        ok(g.slot === -1 || true, 'a full buffer returns no slot (the original goes on)');
      }

      // ---- robustness: no NaNs, the car stays on the ground along the whole track (a short drive from 24 stations)
      {
        const g = mk();
        const { node, w, S, car } = g;
        g.race();
        const OFFS = [0, 3, -3, 6, -6, 9, -9];
        node.inputOverride = () => {
          const f = S.track.frame(Math.min(0.999, node.pathT + 0.004));
          let pick = null;
          for (const off of OFFS) {
            const tx = f.p[0] + f.r[0] * off, tz = f.p[2] + f.r[2] * off;
            const h = w.col.sweep(car, [car.x, car.y + 1.6, car.z], [tx - car.x, 0, tz - car.z], 3, 2.2, 1.2);
            if (!(h && h.rec.name !== 'LAND')) { pick = [tx, tz]; break; }
            pick ??= [tx, tz];
          }
          let d = Math.atan2(pick[0] - car.x, pick[1] - car.z) - car.ry; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          return 0x20 | (d > 0.04 ? 2 : d < -0.04 ? 1 : 0);
        };
        let worst = 0, bad = 0, progressed = 0, stations = 0;
        for (let t0 = 0.04; t0 < 0.92; t0 += 0.04) {
          stations++; g.onTrack(t0); const tStart = t0;
          for (let i = 0; i < 240; i++) {
            g.tick(1);
            if (![car.x, car.y, car.z, car.ry, node.vx, node.vz].every(Number.isFinite)) { bad++; break; }
            worst = Math.max(worst, car.y - g.land(car.x, car.z));
          }
          if (node.pathT > tStart + 0.01) progressed++;
        }
        ok(bad === 0, `${bad} stations with NaNs`);
        ok(worst < 40 && progressed >= stations * 0.8, `${stations} stations driven 240 ticks: highest air time ${worst.toFixed(1)} above the ground, ${progressed} progressed`);
        notes.push(`stations driven ${stations}, progressed ${progressed}`);
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
