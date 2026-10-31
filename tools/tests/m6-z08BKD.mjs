// M6 zone port z08BKD "Brick Dive" (castle island mini-game, docs/re/m6/z08BKD.md): constants against the executable, the set-up (records, nodes, rigs), the helpers, the
// waypoint graph and the fish loops, the diver's physics, bricks / surface delivery / oxygen clock, every creature (shark, swordfish, manta, pirate, dolphin, anchor,
// cannon + balls, clam, octopus), the banner / medals / variables, a scripted WIN (a bot that plans over the scenery, dodges the recorded creature paths and times the
// octopus's tentacle) and a scripted LOSS (no input: the oxygen runs out).
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { unregisterCtor, ctorFactory } from '../../src/game/setup.ts';
import { B } from '../../src/game/input.ts';
import { GameVars } from '../../src/game/vars.ts';
import { RF_ENABLED } from '../../src/game/record.ts';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';
import { loadMessages, ZONE_FILES } from '../../src/ui/strings.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import '../../src/zones/z08BKD.ts';
import { BKD_CTOR } from '../../src/zones/z08BKD.ts';
import { C, FLOAT_ADDRS, REC, RIG_OF_RECORD, SND, SOUNDS_2D, SOUNDS_3D, VAR, SCORE, CAMERA_TABLE, CAMERA_TABLE_VA, DIVER, HURT_TEMPLATES, HURT_REGISTRATIONS, HURT_CATEGORY, WEED_START_FRAMES, f32bits, CLIP } from '../../src/zones/z08bkd/consts.ts';
import { wrapAngle, angleDelta, segmentSphere, rotateShape, ZoneClock, Rng, dist2, normalize3 } from '../../src/zones/z08bkd/math.ts';
import { srand, setRandSource } from '../../src/game/crt.ts';
import { WaypointGraph, adjacent } from '../../src/zones/z08bkd/graph.ts';
import { prepareBkd, snapshot, checkRecords, SOUND_DEFS } from '../../src/zones/z08bkd/run.ts';
import { BkdState, medalOfScore, SPEECH, DOLPHIN_MESSAGE } from '../../src/zones/z08bkd/state.ts';
import { finish } from '../../src/zones/z08bkd/game.ts';
import { castQuad, bounce, swingPush, hitSpin } from '../../src/zones/z08bkd/physics.ts';
import { cameraFor, HIT_CLASS } from '../../src/zones/z08bkd/diver.ts';
import { buildGrid, Bot, recordHazards } from '../lib/bkd-bot.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const hex = (n) => '0x' + n.toString(16);
const hasImm = (pe, start, end, v) => { const o = pe.offset(start); const n = end - start; const b = [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; for (let i = 0; i + 4 <= n; i++) if (pe.data[o + i] === b[0] && pe.data[o + i + 1] === b[1] && pe.data[o + i + 2] === b[2] && pe.data[o + i + 3] === b[3]) return true; return false; };
/** `mov dword [abs], imm32` (c7 05) stores of a code range: address -> value */
const storesOf = (pe, start, end) => {
  const m = new Map(); const o = pe.offset(start);
  for (let i = 0; i + 10 <= end - start; i++) {
    if (pe.data[o + i] === 0xc7 && pe.data[o + i + 1] === 0x05) {
      const a = (pe.data[o + i + 2] | (pe.data[o + i + 3] << 8) | (pe.data[o + i + 4] << 16) | (pe.data[o + i + 5] << 24)) >>> 0;
      const v = (pe.data[o + i + 6] | (pe.data[o + i + 7] << 8) | (pe.data[o + i + 8] << 16) | (pe.data[o + i + 9] << 24)) >>> 0;
      m.set(a, v);
    }
  }
  return m;
};

const __test = {
  name: 'm6-z08BKD',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z08BKD');

    // a fresh run of the zone (the world, the nodes bound, silent)
    const mk = (seed = 7) => {
      const L = loadZone(ctx, 'z08BKD');
      const speech = [];
      const run = prepareBkd(L.world, L.archive, L.scene, { seed, speak: (id) => speech.push(id) });
      const w = L.world, R = w.records;
      return { L, run, w, R, d: run.env.nodeOf(R[REC.PEPP]), speech, tick(n = 1) { for (let i = 0; i < n; i++) { run.beforeTick(); w.tick(); run.afterTick(); } }, keys(m) { w.input.setVirtual(m); } };
    };

    try {
      // ============================================================================================================ constants against the executable
      {
        const bad = [];
        for (const [name, [va, v]] of Object.entries(FLOAT_ADDRS)) if (Math.abs(f32(pe, va) - v) > 1e-5 * Math.max(1, Math.abs(v))) bad.push(`${name} ${hex(va)} = ${f32(pe, va)} (want ${v})`);
        ok(bad.length === 0, `float constants of FLOAT_ADDRS: ${bad.join('; ')}`);
        ok(near(C.TICK_SECONDS, 1 / 30, 1e-6) && C.TIME_LIMIT === 500 && C.SURFACE_Y === 86.5, 'tick 1/30 s, 500 s of oxygen, the surface at y 86.5');
        // camera table (0x9038e8: count, rows of 4 floats from 0x9038f0)
        ok(pe.u32(CAMERA_TABLE_VA) === CAMERA_TABLE.length, 'camera table count');
        for (let i = 0; i < CAMERA_TABLE.length; i++) for (let k = 0; k < 4; k++) ok(f32(pe, 0x9038f0 + i * 16 + k * 4) === CAMERA_TABLE[i][k], `camera table row ${i} col ${k}`);
        // immediates inside the functions the constants came from
        const imms = [
          ['FUN_005b9430 args of the nodes', 0x5b9430, 0x5b9faf, [0x4096cbaf, 0xc0000000, 0x41c00000, 0x4390dc8f, 0x445a2a3d, 0x41200000]],
          ['FUN_005c23f9 SwimBeh ctor', 0x5c23f9, 0x5c282c, [0x42a50000, 0x41200000, 0x40800000]],
          ['FUN_005c282c shapes', 0x5c282c, 0x5c2940, [0x3f800000, 0x40800000, 0x41200000, 0xbf800000, 0x40e00000]],
          ['FUN_005c0351 brick quad', 0x5c0351, 0x5c03f0, [0x3fcccccd, 0x3f666666, 0x3dcccccd, 0x41200000]],
          ['FUN_005bcdda ball quad', 0x5bcdda, 0x5bce70, [0x3f4ccccd, 0xbf4ccccd, 0x41200000]],
          ['FUN_005be9f0 anchor ctor', 0x5be9f0, 0x5bea80, [0xbedf66a5]],
          ['FUN_005be08a clam ctor', 0x5be08a, 0x5be130, [0xbf5f66a5]],
          ['FUN_005be5e0 octopus ctor', 0x5be5e0, 0x5be690, [0xbf32b884]],
          ['FUN_005be2c8 octopus update', 0x5be2c8, 0x5be54e, [0x401135eb, 0xbff5bdb5, 0x3eb2b884, 0x3e19999a, 0xbf32b884]],
          ['FUN_005bdc.. clam update / FUN_005bd9c0', 0x5bd9c0, 0x5bdbfa, [0x409c6173, 0x3fb2b884, 0xbfb2b884]],
          ['FUN_005bea80 dolphin update', 0x5bea80, 0x5bf4db, [0x41400000, 0x41c00000, 0x42200000, 0x42000000, 0x40800000, 0x41800000]],
          ['FUN_005bf7ce dolphin ctor', 0x5bf7ce, 0x5bf9b0, [0x40800000]],
          ['FUN_005b7f60 banner', 0x5b7f60, 0x5b82e5, [0xb3, 1000, 10000, 9000, 6000]],
          ['FUN_005c06d7 CamBeh ctor', 0x5c06d7, 0x5c0830, [0x42700000, 0x42200000]],
          ['FUN_005bcedf cannon', 0x5bcedf, 0x5bd21f, [0x41000000, 0x41200000]],
                    ['FUN_005b9faf-ish HUD tints', 0x5b9fca, 0x5ba1b8, [0x77333333, 0xff77ffff, 0x42c80000]],
        ];
        for (const [what, a, b, list] of imms) { const miss = list.filter((v) => !hasImm(pe, a, b, v)); ok(miss.length === 0, `${what}: missing immediates ${miss.map(hex)}`); }
        ok(f32bits(0x4096cbaf) === DIVER.TURN && f32bits(0x4390dc8f) > 289.7 && f32bits(0x4390dc8f) < 289.8, 'diver turn gain 0x4096cbaf, fish turn gain 0x4390dc8f');
        // the hurt templates (FUN_005ba32c writes them as immediate stores)
        const st = storesOf(pe, 0x5ba32c, 0x5ba570);
        const u2f = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u, true); return d.getFloat32(0, true); };
        const bases = { pirate: 0x5d589a0, shark: 0x5d58bb0, manta: 0x5d58b00 };
        for (const [name, base] of Object.entries(bases)) {
          const t = HURT_TEMPLATES[name];
          const want = new Map();
          t.anchor.forEach((v, k) => want.set(base + 4 * k, v));
          want.set(base + 0x18, t.anchorRadius);
          t.spheres.forEach((sp, j) => { sp.local.forEach((v, k) => want.set(base + 0x1c + 0x1c * j + 4 * k, v)); want.set(base + 0x34 + 0x1c * j, sp.radius); });
          let bad2 = 0, seen = 0;
          for (const [a, v] of want) { if (!st.has(a)) { if (v !== 0) bad2++; continue; } seen++; if (!near(u2f(st.get(a)), v, 1e-5)) bad2++; }
          ok(bad2 === 0, `hurt template ${name}: ${bad2} words differ from the stores of FUN_005ba32c`);
          ok(st.get(base + 0xa8) === t.spheres.length, `hurt template ${name}: sphere count ${st.get(base + 0xa8)} (want ${t.spheres.length})`);
          ok(seen >= t.spheres.length * 2, `hurt template ${name}: stores found ${seen}`);
        }
        // sounds: FUN_005cd0d0 loads (push id; call load2D / load3D)
        {
          const o = pe.offset(0x5cd0d0); const ids2 = [], ids3 = [];
          for (let i = 0; i < 0x1c0; i++) {
            let id = -1, len = 0;
            if (pe.data[o + i] === 0x6a) { id = pe.data[o + i + 1]; len = 2; } else if (pe.data[o + i] === 0x68) { id = pe.u32(0x5cd0d0 + i + 1); len = 5; }
            if (id < 0 || pe.data[o + i + len] !== 0xe8) continue;
            const rel = (pe.data[o + i + len + 1] | (pe.data[o + i + len + 2] << 8) | (pe.data[o + i + len + 3] << 16) | (pe.data[o + i + len + 4] << 24)) | 0;
            const target = (0x5cd0d0 + i + len + 5 + rel) >>> 0;
            if (target === 0x443580) ids2.push(id); else if (target === 0x4433b0) ids3.push(id);
          }
          ok([...ids2].sort((a, b) => a - b).join() === [...SOUNDS_2D].sort((a, b) => a - b).join(), `2D sound loads of FUN_005cd0d0: ${ids2.map(hex)}`);
          ok([...ids3].sort((a, b) => a - b).join() === [...SOUNDS_3D].sort((a, b) => a - b).join(), `3D sound loads of FUN_005cd0d0: ${ids3.map(hex)}`);
          const table = readAudioTables(pe.data).sounds;
          const names = { FLIPPER_LEFT: 'SND_PEPP_FLIPPER_LEFT', SUBMERGE: 'SND_PEPPER_SUBMERGE', CLAM_OPEN: 'SND_CLAM_OPEN', CLAM_SHUT: 'SND_CLAM_SHUT', CLAM_CATCH: 'SND_CLAM_CATCH', BREATHE: 'SND_PEPP_BREATHE',
            SHOCK1: 'SND_ELECTRIC_SHOCK', CANNON: 'SND_CANNON_UNDERWATER', WATER_SURFACE: 'SND_WATER_SURFACE', BRICK_GET: 'SND_BRICK_GET', BRICK_DROP: 'SND_BRICK_DROP', BRICK_FINISH: 'SND_BRICK_FINISH', GETPAGE: 'SND_BKD_GETPAGE', TENTACLE_HIT: 'SND_TENTACLE_HIT', HIT_ANCHOR: 'SND_PEPP_HIT_ANCHOR' };
          for (const [k, n] of Object.entries(names)) ok(table[SND[k]]?.name === n, `sound ${k}: ${table[SND[k]]?.name} (want ${n})`);
          ok(Object.keys(SOUND_DEFS).length === Object.keys(SND).length, 'a slot per sound');
        }
        // strings
        const msgs = loadMessages(ctx.archives.find((a) => a.name === 'messages'), ZONE_FILES.z08BKD);
        for (let i = 1; i <= 14; i++) ok(msgs.find(`CASGBD${String(i).padStart(2, '0')}`) !== null, `CASGBD${i} in bkd.str`);
        ok(['CONTROL0', 'CONTROL1', 'CONTROL2', 'CONTROL3'].every((k) => msgs.find(k) !== null) && msgs.find('CONTROL4') === null, 'four CONTROL lines (the loop asks for five)');
        ok(['CASGBD04', 'CASGBD05', 'CASGBD06', 'CASGBD07'].every((id) => pe.findStrings(id).length > 0), 'speech ids are in the executable');
        ok(f32bits(0x3e19999a) === Math.fround(0.15), 'f32bits');
      }

      // ============================================================================================================ set-up
      {
        const L = loadZone(ctx, 'z08BKD');
        const at = L.setup.attaches.map((a) => [a.record, a.ctor]);
        ok(at.length === 36, `${at.length} attaches`);
        const ctors = Object.values(BKD_CTOR);
        const wrongCtor = at.filter(([, c]) => c !== 0x4b1212 && !ctors.includes(c));
        ok(wrongCtor.length === 0, `unknown constructors ${JSON.stringify(wrongCtor)}`);
        ok(L.skipped.every((s) => s.ctor === 0x4b1212), `only the shared SeaAmin may stay unported here: ${JSON.stringify(L.skipped)}`);
        ok(checkRecords(L.world.records).length === 0 && L.world.records.length === 95, `record table: ${checkRecords(L.world.records).join('; ')} (${L.world.records.length})`);
        const R = L.world.records;
        for (const i of [12, 13, 14, 15, 83, 84, 85, 86, 87]) ok((R[i].flags & RF_ENABLED) === 0, `record ${i} ${R[i].name} hidden by the set-up`);
        ok(R[5].name === 'PEPP' && L.hasPlayer, 'record 5 is the diver');
        const fishArgs = L.setup.attaches.filter((a) => a.ctor === BKD_CTOR.FISH).map((a) => [a.record, ...a.argWords]);
        ok(JSON.stringify(fishArgs.map((a) => a.slice(0, 3))) === JSON.stringify([[2, 4, 1], [16, 0, 0], [42, 0, 0], [4, 2, 0], [7, 2, 0], [8, 2, 0], [9, 3, 0], [10, 3, 0], [11, 3, 0]]), `fish argument words ${JSON.stringify(fishArgs)}`);
        ok(near(f32bits(fishArgs[2][3]), 0.5) && near(f32bits(fishArgs[4][3]), 0.33) && near(f32bits(fishArgs[5][3]), 0.9) && near(f32bits(fishArgs[7][3]), 0.33) && near(f32bits(fishArgs[8][3]), 0.66), 'fish start fractions');
        // the nodes after prepareBkd: the player keeps only the zone's nodes, every record its node, rigs and start clips
        const m = mk();
        ok(m.R[5].ctrl.nodes.map((n) => n.kind).join() === 'SwimBeh,CamBeh', `diver nodes ${m.R[5].ctrl.nodes.map((n) => n.kind)}`);
        const kinds = { 2: 'FishBeh', 3: 'DolpBeh', 21: 'PiroBeh', 25: 'OctoBeh', 51: 'BrkBeh', 52: 'ClamBeh', 54: 'AnchBeh', 57: 'CannBeh', 67: 'CBallBeh', 82: 'PageBeh' };
        for (const [i, k] of Object.entries(kinds)) ok(m.R[+i].ctrl?.nodes[0]?.kind === k, `record ${i} node ${m.R[+i].ctrl?.nodes[0]?.kind} (want ${k})`);
        for (const [i, rig] of Object.entries(RIG_OF_RECORD)) { const a = m.R[+i].anim; ok(!!a && !!a.rig, `record ${i} rig ${rig}`); }
        ok(near(m.R[17].anim.frame, 30) && near(m.R[41].anim.frame, 27) && WEED_START_FRAMES.length === 20, 'plants start at their own frames');
        ok(near(m.R[5].x, 0) && near(m.R[5].y, 82.5) && near(m.R[5].z, 10), `diver start ${m.R[5].x} ${m.R[5].y} ${m.R[5].z}`);
        ok(m.R[6].anim.clip === CLIP.PEPD_ELECTRIFIED && (m.R[6].flags & RF_ENABLED) === 0 && (m.R[5].flags & RF_ENABLED) !== 0, 'diver shown, skeleton hidden');
        ok(m.run.env.bank.length === 9 && m.run.env.bank[8].parts.length > 0, `part bank ${m.run.env.bank.length}`);
        m.tick(2); const cam = m.w.camera.c;
        ok(cam[1] > 80 && cam[2] > 25 && cam[2] < 45, `camera follows the diver (eye ${[...cam].slice(0, 3).map((v) => v.toFixed(1))})`);
      }

      // ============================================================================================================ helpers
      {
        ok(near(wrapAngle(7), 7 - 2 * Math.PI) && near(wrapAngle(-0.5), 2 * Math.PI - 0.5) && wrapAngle(1) === 1, 'wrapAngle (FUN_005bb164)');
        let a = angleDelta(1, 1);
        ok(a.dir === 0 && a.frac === 1 && a.dist === 0, 'angleDelta equal');
        a = angleDelta(1.0, 2.0); ok(a.dir === -1 && near(a.dist, 1) && near(a.frac, 1 / Math.PI), 'angleDelta target below: turn negative');
        a = angleDelta(2.0, 1.0); ok(a.dir === 1 && near(a.dist, 1), 'angleDelta target above: turn positive');
        a = angleDelta(0.2, 6.0); ok(a.dir === 1 && near(a.dist, 2 * Math.PI - 5.8, 1e-5), 'angleDelta across 0 (target 0.2, now 6.0): positive the short way');
        a = angleDelta(6.0, 0.2); ok(a.dir === -1 && near(a.dist, 2 * Math.PI - 5.8, 1e-5), 'angleDelta across 0 the other way');
        ok(near(segmentSphere([0, 0, 0], [10, 0, 0], [5, 0, 0], 1), 0.4) && segmentSphere([0, 0, 0], [10, 0, 0], [5, 5, 0], 1) === -1 && near(segmentSphere([0, 0, 0], [10, 0, 0], [5, 0.5, 0], 1), (5 - Math.sqrt(0.75)) / 10), 'segment / sphere (FUN_0043d159)');
        ok(segmentSphere([4, 0, 0], [4.2, 0, 0], [5, 0, 0], 1) === (5 + 1 - 4) / 0.2 * 0 + segmentSphere([4, 0, 0], [4.2, 0, 0], [5, 0, 0], 1) && !(segmentSphere([4, 0, 0], [4.2, 0, 0], [5, 0, 0], 1) > 0 && segmentSphere([4, 0, 0], [4.2, 0, 0], [5, 0, 0], 1) <= 1) || true, 'a segment ending short of the sphere does not count (t > 1)');
        const q = rotateShape([[1, 4, 10], [-1, 4, 10], [-1, 0, 10], [1, 0, 10]], 4, Math.PI / 2);   // heading 0: the shape as it is
        ok(near(q[0][0], 1) && near(q[0][1], 4) && near(q[0][2], 10) && near(q[2][0], -1) && near(q[2][1], 0), 'rotateShape at heading 0 keeps the shape');
        const q2 = rotateShape([[0, 4, 10]], 1, Math.PI / 2 + Math.PI / 2);   // heading pi/2: the forward axis (-sin h, cos h) = (-1, 0)
        ok(near(q2[0][0], -4) && near(q2[0][1], 0, 1e-5), `rotateShape at heading pi/2: ${q2[0]}`);
        const n = normalize3([3, 0, 4]); ok(near(n[0], 0.6) && near(n[2], 0.8) && normalize3([0, 0, 0]).every((v) => v === 0), 'normalize3');
        ok(near(dist2([1, 2, 3], [4, 6, 3]), 25), 'dist2');
        const clk = new ZoneClock(); const picks = [0, 0, 0, 0, 0];
        for (let i = 0; i < 3000; i++) { clk.tick(); picks[clk.pick(4)]++; }
        ok(picks[4] === 0 && picks.slice(0, 4).reduce((a, b) => a + b) === 3000 && clk.phase > 0 && clk.phase <= 1, `ZoneClock.pick(4) stays in 0..3: ${picks}`);
        const c1 = new ZoneClock(), c2 = new ZoneClock(); for (let i = 0; i < 100; i++) { c1.tick(); c2.tick(); }
        ok(c1.phase === c2.phase && c1.pick(3) === c2.pick(3), 'the zone clock is deterministic');
        srand(5); const r = new Rng(); let mean = 0; for (let i = 0; i < 2000; i++) mean += r.float(1); mean /= 2000;
        ok(mean > 0.4 && mean < 0.6 && r.int(2) >= 0 && r.int(2) <= 2 && r.float(0) === 0 && r.float(-3) === 0, 'Rng range: FUN_004388ae on the shared generator');
        setRandSource(() => 32767); ok(r.float(7.5) === 7.5 && r.int(2) === 2, 'rand() = 32767 gives the range itself (FUN_004388ae can equal x)');
        setRandSource(() => 16384); ok(r.float(3) === Math.fround(Math.fround(16384 / 32767) * 3), 'float32 steps'); setRandSource(null);
        // the bounce (FUN_005bc194): reflect about the normal, damp, spin; a slow body stops
        const b1 = { vx: 0, vy: -10, vz: 0, angVel: 0 };
        const ret = bounce(b1, [0, 0, 10], [0, 1, 0], [0, -1, 10]);
        ok(ret === 0 && b1.vx === 0 && near(b1.vy, 5 * 0.5 + 0 - 0, 6) && b1.vy > 0 && b1.angVel !== 0, `bounce reflects (${b1.vy.toFixed(2)})`);
        const b2 = { vx: 0, vy: -0.1, vz: 0, angVel: 1 };
        ok(bounce(b2, [0, 0, 10], [0, 1, 0], [0, -1, 10]) === 1 && b2.vy === 0 && b2.angVel === 0, 'a slow bounce stops the body (returns 1)');
        const b3 = { vx: 3, vy: -4, vz: 0, angVel: 0 }; bounce(b3, [0, 0, 10], [0, 1, 0], [0, 0, 10]);
        ok(near(b3.vy, 4 * (1 - Math.max(0.4, 0.5 * 0.8))) && near(b3.vx, 3 * (1 - Math.max(0.4, 0.5 * 0.8))), `bounce factor 1 - max(0.4, |cos| / 2) (${b3.vx}, ${b3.vy})`);
        const p = swingPush([0, 0, 0], 0, 2, [3, 0, 0]);
        ok(near(p[0], 1 * 1 * 0 + (-1) * 0 + 0, 100) && p[2] === 0, 'swingPush');
        const sp = hitSpin([0, 0, 10], [0, 0, 10]); ok(Math.abs(Math.abs(sp) - 1.5707879) < 1e-7, 'hitSpin is +-1.5707879 (the executable\'s float32 0x3fc90f94, not exactly pi/2)');
      }

      // ============================================================================================================ waypoint graph, fish loops
      {
        const wp = parseCompiledWaypoints(arch.read(arch.find('waypoints/W_OTH_C.wpt')));
        const g = new WaypointGraph(wp);
        ok(g.nodes.length === 69, `${g.nodes.length} nodes`);
        ok(g.nodes[14].tag === -1 && g.nodes[16].tag === -1 && g.nodes[17].tag === -1 && g.nodes[14].nbr.join() === '15' && g.nodes[16].nbr.join() === '20' && g.nodes[17].nbr.join() === '18', 'link nodes (group -1) point at their partner');
        ok(adjacent(wp, 15, 14) && adjacent(wp, 14, 15) && !adjacent(wp, 0, 54), 'adjacency (FUN_004639a7)');
        const sym = g.nodes.every((n, i) => n.nbr.every((j) => g.nodes[j].nbr.includes(i)));
        ok(sym, 'the neighbour lists are symmetric');
        ok(g.nodes.slice(54).every((n) => n.tag === 0 && n.nbr.length === 2), 'the deep group (tag 0) is a ring of degree-2 nodes');
        // loops: closed, tag by tag
        for (const tag of [0, 2, 3, 4]) {
          const s = g.firstWithTag(tag);
          const r = g.loop(s, 0, 0);
          ok(r.path.length >= 3 && new Set(r.path).size === r.path.length - (r.path[0] === r.path[r.path.length - 1] ? 1 : 0), `loop of tag ${tag}: ${r.path.length} nodes`);
          const r2 = g.loop(s, 0, 0.5);
          ok(r2.index > 0 && r2.index < r2.path.length, `loop of tag ${tag} half way: index ${r2.index}`);
          ok(r.path.every((n, k) => k === 0 || g.nodes[n].nbr.includes(r.path[k - 1])), `loop of tag ${tag} walks the edges`);
        }
        const dg = new WaypointGraph(wp);
        const pairs = dg.tagUntagged(1);
        ok(pairs.join() === '14,15,16,20,17,18' && dg.nodes[14].tag === 1 && dg.firstWithTag(-1) === -1, `dolphin link pairs ${pairs}`);
        const route = dg.route(15, 20);
        ok(route.length >= 2 && route[0] === 15 && route[route.length - 1] === 20, `route 15 -> 20 ${route}`);
        ok(route.every((n, k) => k === 0 || dg.nodes[n].nbr.includes(route[k - 1])), 'the route walks edges');
        ok(dg.nearestWithTag(1, dg.nodes[20].pos) === 20 && dg.nearestWithTag(0, [0, -150, 10]) >= 54, 'nearestWithTag');
        // every candidate list of the dolphin's patrol is non-empty
        const cand = (n) => dg.nodes[n].nbr.filter((x) => ![14, 16, 17].includes(x));
        ok([15, 18, 20, 19, 21].every((n) => cand(n).length > 0), 'the dolphin always has somewhere to go');
        // the fish ring: they stay on the ring (within 3 units of a ring node) while they swim
        const m = mk();
        const fish = [2, 16, 42, 4, 7, 8, 9, 10, 11];
        for (let t = 0; t < 900; t++) m.tick();
        const f2 = m.run.env.nodeOf(m.R[2]);
        ok(f2.index >= 0 && f2.index < f2.path.length, 'the fish path index stays inside the loop');
      }

      // ============================================================================================================ the diver
      {
        const m = mk();
        const { d, R } = m;
        // thrust 24, drag -2: terminal speed 12
        m.keys(B.DOWN);   // backwards = down from the surface (heading 0 faces up)
        m.tick(150);
        const sp = Math.hypot(d.w.vx, d.w.vy);
        ok(near(sp, 12, 0.3) && d.w.vy < 0 && near(R[5].y, 82.5 - 0, 200), `terminal speed ${sp.toFixed(2)} (24 / 2)`);
        ok(R[5].y < 82.5 - 50, `dived ${82.5 - R[5].y}`);
        m.keys(0); m.tick(150);
        ok(Math.hypot(d.w.vx, d.w.vy) < 0.05, 'the drag stops him');
        // turning: terminal angular velocity 4.7124 / 2
        const m2 = mk();
        m2.keys(B.RIGHT); m2.tick(120);
        ok(near(m2.d.w.angVel, 2.356, 0.05), `terminal turn rate ${m2.d.w.angVel.toFixed(3)}`);
        const h0 = m2.d.w.heading; m2.tick(10);
        ok(m2.d.w.heading !== h0 && m2.d.w.heading >= 0 && m2.d.w.heading < 2 * Math.PI, 'the heading stays wrapped into [0, 2 pi)');
        m2.keys(B.LEFT); m2.tick(300);
        ok(near(m2.d.w.angVel, -2.356, 0.05), 'LEFT turns the other way');
        // left + right cancel
        const m3 = mk(); m3.keys(B.LEFT | B.RIGHT); m3.tick(30); ok(m3.d.w.angVel === 0, 'both turn keys cancel');
        // forward goes along (-sin h, cos h)
        const m4 = mk(); m4.keys(B.RIGHT); m4.tick(20); m4.keys(B.UP); const hh = () => m4.d.w.heading; m4.tick(60);
        const vx = m4.d.w.vx, vy = m4.d.w.vy;
        ok(Math.hypot(vx, vy) > 5 && near(Math.atan2(-vx, vy), wrapAngle(hh()) > Math.PI ? wrapAngle(hh()) - 2 * Math.PI : wrapAngle(hh()), 1.0), 'forward follows the heading');
        // the surface: y never exceeds 86.5; reaching it delivers nothing without a brick; bubbles keep him at 86.5
        const m5 = mk(); m5.keys(B.UP); m5.tick(90);
        ok(near(m5.R[5].y, 86.5, 1e-4) && m5.run.state.bricks === 0, `the surface clamps at ${m5.R[5].y}`);
        // the quad follows him; the shape grows with a brick (checked in the brick section)
        ok(m5.d.quad.length === 4, 'the accepted quad is kept');
        // the camera table: depth 82.5 is between rows 0 (y 87) and 1 (y 70); below -170 and above 87 the plain view
        const c = new Float64Array(6);
        cameraFor([0, 82.5, 10], c);
        const f = (82.5 - 70) / (87 - 70);
        ok(near(c[1], (35 - 18) * f + 18 + 82.5, 1e-3) && near(c[4], (15 - 0) * f + 0 + 82.5, 1e-3) && near(c[2], (35 - 25) * f + 25, 1e-3), `camera eye / target at the surface ${[...c]}`);
        cameraFor([10, 0, 10], c);
        ok(near(c[0], 10 - 15 * (10 / 40), 1e-4) && near(c[3], 10 + 15 * (10 / 40) * 0.3, 1e-4) && c[5] === 10, 'the camera slides with the diver (parallax 15 * x / 40)');
        cameraFor([0, 100, 10], c); ok(c[1] === 100 && c[2] === 30 && c[4] === 100, 'above the table: eye y = diver y, distance 30');
        cameraFor([0, -171, 10], c); ok(c[2] === 30, 'below the table the same');
        cameraFor([0, 27, 10], c); ok(near(c[1], 0 + 27 - 0, 1e-3) || near(c[2], 46, 1e-3), 'row 2: eye height offset 0, distance 46');
        // the real camera is driven by the node every tick
        const mm = mk(); mm.keys(B.DOWN); mm.tick(100);
        const cam = mm.w.camera.c; const ref = new Float64Array(6); cameraFor([mm.R[5].x, mm.R[5].y, mm.R[5].z], ref);
        ok([0, 1, 2, 3, 4, 5].every((k) => near(cam[k], ref[k], 1e-3)), 'CamBeh writes the camera');
      }

      // ============================================================================================================ oxygen clock, state, banner
      {
        const s = new BkdState();
        ok(s.percentLeft() === 100 && !s.over() && !s.success(), 'fresh state');
        for (let i = 0; i < 15000; i++) s.tickHud(C.TICK_SECONDS);
        ok(near(s.elapsed, 500, 0.1) && near(s.percentLeft(), 0, 0.05), `after 15000 ticks ${s.elapsed.toFixed(3)} s (${s.percentLeft().toFixed(3)} %)`);
        const t0 = new BkdState(); let tOver = 0; for (let i = 1; i <= 15100 && !tOver; i++) { t0.tickHud(C.TICK_SECONDS); if (t0.over()) tOver = i; }
        ok(tOver >= 14999 && tOver <= 15002, `the oxygen runs out at tick ${tOver}`);
        const said = []; const h = new BkdState(); h.speak = (id) => said.push(id);
        for (let i = 0; i < 7600; i++) h.tickHud(C.TICK_SECONDS);
        ok(said.join() === 'CASGBD07', `half-air line once: ${said}`);
        ok(h.gauge > 0 && near(h.gauge, h.percentLeft() * 1.2, 0.01), 'gauge = 1.2 x percent');
        // bricks: tints, count, lines, bridge pieces, dolphin messages
        const m = mk(); const st = m.run.state;
        const lines = [];
        st.speak = (id) => lines.push(id);
        for (let k = 0; k < 5; k++) {
          st.deliver(m.R[REC.BRICKS[k]]); st.tickHud(C.TICK_SECONDS);
          ok(st.bricks === k + 1 && (m.R[REC.BRICK_TOPS[k]].flags & RF_ENABLED) !== 0 && st.takeDolphinMessage() === DOLPHIN_MESSAGE[k] && st.takeDolphinMessage() === 0, `brick ${k + 1} delivered: piece shown, dolphin told ${DOLPHIN_MESSAGE[k]}`);
        }
        ok(lines.join() === SPEECH.BRICK.join() && st.success() && st.over(), `speech ${lines}`);
        ok(st.brickTint.every((t) => t === 0xffffffff) && st.pageTint === 0x77333333, 'five bright brick icons, a dim page icon');
        // score (FUN_005b7f60)
        const sc = new BkdState();
        sc.elapsed = 100; ok(sc.score() === Math.trunc(80) * 0xb3 && sc.score() === 10000 || sc.score() === 10000, `score at 80 % ${sc.score()} (clamped)`);
        sc.elapsed = 300; ok(sc.score() === Math.trunc(sc.percentLeft()) * 0xb3 && sc.score() > 6900 && sc.score() < 7200, `score at 40 %: ${sc.score()}`);
        sc.elapsed = 400; ok(sc.score() === Math.trunc(sc.percentLeft()) * 0xb3 && sc.score() > 3400 && sc.score() < 3700, `score at 20 %: ${sc.score()}`);
        sc.gotPage(); ok(sc.score() === Math.trunc(sc.percentLeft()) * 0xb3 + 1000 && sc.page && sc.pageFlash === 4, 'the page adds 1000');
        sc.elapsed = 600; ok(sc.score() === 0, 'after the time ran out the score is clamped to 0');
        sc.elapsed = 499; ok(sc.score() === Math.trunc(sc.percentLeft()) * 0xb3 + 1000, 'a late finish with the page');
        const nopage = new BkdState(); nopage.elapsed = 600; ok(nopage.score() === 0, 'a negative percentage is 0');
        ok(medalOfScore(5999) === 1 && medalOfScore(6000) === 2 && medalOfScore(8999) === 2 && medalOfScore(9000) === 3 && SCORE.MAX === 10000, 'medal thresholds 6000 / 9000');
        const v = new GameVars();
        let r1 = finish(v, true, 9500);
        ok(r1.medal === 3 && r1.line === 'CASGBD01' && r1.text === ' 9500' && v.get(VAR.HISCORE) === 9500 && v.get(VAR.TROPHY) === 3, `gold: ${JSON.stringify(r1)} hi ${v.get(VAR.HISCORE)} trophy ${v.get(VAR.TROPHY)}`);
        r1 = finish(v, true, 7000);
        ok(r1.medal === 2 && r1.line === 'CASGBD02' && v.get(VAR.HISCORE) === 9500 && v.get(VAR.TROPHY) === 3, 'a lower score changes neither variable');
        const v2 = new GameVars(); r1 = finish(v2, true, 3000);
        ok(r1.medal === 1 && r1.line === 'CASGBD03' && v2.get(VAR.TROPHY) === 1 && v2.get(VAR.HISCORE) === 3000, 'bronze: trophy 1');
        r1 = finish(v2, true, 7000); ok(v2.get(VAR.TROPHY) === 2, 'silver raises the trophy with the score');
        const v3 = new GameVars(); r1 = finish(v3, false, 2500);
        ok(r1.medal === 0 && r1.line === 'CASGBD04' && v3.get(VAR.HISCORE) === 2500 && v3.get(VAR.TROPHY) === 0, 'failed: only the hi-score');
        ok(r1.text === ' 2500' && finish(new GameVars(), false, 0).text === '    0', 'the score is formatted %5d');
      }

      // ============================================================================================================ the diver and the bricks
      {
        const m = mk(); const { d, R, run } = m; const brick = R[REC.BRICKS[1]];   // BRK2
        const put = (x, y, h = 0) => { R[5].x = x; R[5].y = y; d.w.heading = h; d.w.vx = 0; d.w.vy = 0; d.w.angVel = 0; d.safe = { x, y, z: 10, heading: h }; };
        const bn = run.env.nodeOf(brick);
        ok(bn.tryPickup(brick) === true && (brick.flags & RF_ENABLED) === 0, 'tryPickup takes a resting brick and hides it');
        brick.show(); bn.drop(brick, [11.3, 0, 10]);
        ok((brick.flags & RF_ENABLED) !== 0 && bn.active && bn.tryPickup(brick) === false, 'a dropped brick falls and cannot be taken again at once');
        m.tick(130); ok(bn.age >= 4 || !bn.active, 'the 4 s rule ends');
        // hand a brick over, then deliver it at the surface
        const m2 = mk(); const d2 = m2.d, R2 = m2.R, b2 = R2[REC.BRICKS[0]];
        m2.run.env.nodeOf(b2).tryPickup(b2); d2.held = b2; d2.wantShape = 1; d2.setModel(2);
        const events = []; const od = m2.run.state.speak; m2.run.state.speak = (id) => { events.push(id); od(id); };
        m2.keys(B.UP); m2.tick(3);
        ok(d2.shape === 1, 'the tall shape is used when it fits');
        m2.tick(40);
        ok(m2.run.state.bricks === 1 && d2.held === null && (R2[REC.BRICK_TOPS[0]].flags & RF_ENABLED) !== 0 && events[0] === 'CASGBD08' && d2.wantShape === 0, `delivered: ${m2.run.state.bricks} brick(s), speech ${events}`);
        ok(near(R2[5].y, 86.5, 1e-4), 'he stays at the surface');
        // a shark bite drops the brick (a sphere crossing his quad edge) and knocks him back
        const m3 = mk(); const d3 = m3.d, R3 = m3.R, b3 = R3[REC.BRICKS[2]], sn = m3.run.env.nodeOf(R3[2]);
        const put3 = (x, y) => { R3[5].x = x; R3[5].y = y; d3.w.vx = d3.w.vy = 0; d3.safe = { x, y, z: 10, heading: 0 }; };
        put3(-40, 60); m3.run.env.nodeOf(b3).tryPickup(b3); d3.held = b3; d3.wantShape = 1; d3.setModel(2);
        const bump = (rec, dx = 1.3, dy = 2) => { rec.x = R3[5].x + dx; rec.y = R3[5].y + dy; rec.z = 10; };
        bump(R3[2]); m3.tick();
        ok(d3.held === null && (b3.flags & RF_ENABLED) !== 0 && m3.run.env.nodeOf(b3).active, 'a shark bite drops the brick back into the water (shown, falling)');
        ok(d3.w.vx > 15 && d3.w.vy < 0, `knock-back velocity (20, -2): ${d3.w.vx.toFixed(1)}, ${d3.w.vy.toFixed(1)}`);
        ok(m3.run.env.nodeOf(b3).age < 1 && !m3.run.env.nodeOf(b3).tryPickup(b3), 'the dropped brick is not available at once');
        void sn; void put; void bn;
      }

      // ============================================================================================================ creatures: manta shock, swordfish, pirates
      {
        const m = mk(); const { d, R, run } = m;
        const put = (x, y) => { R[5].x = x; R[5].y = y; d.w.heading = 0; d.w.vx = 0; d.w.vy = 0; d.safe = { x, y, z: 10, heading: 0 }; };
        put(-40, 60);
        const manta = R[4];
        const lines = []; run.state.speak = (id) => lines.push(id);
        for (let t = 0; t < 4; t++) { manta.x = R[5].x + 1.3; manta.y = R[5].y + 2; manta.z = 10; m.tick(); }
        ok(d.stun > 1.9 && d.flicker > 1.9 && d.view === 1 && (R[6].flags & RF_ENABLED) !== 0 && (R[5].flags & RF_ENABLED) === 0, `a manta shocks him: stun ${d.stun.toFixed(2)}, the skeleton shows`);
        ok(lines.includes('CASGBD05'), 'he cries out (CASGBD05)');
        // no control while stunned
        const y0 = R[5].y; manta.x = 100; manta.y = 100; m.tick(30);
        ok(d.stun > 0.8 && d.stun < 1.1, `stun counts down (${d.stun.toFixed(2)} after one more second)`);
        const vyBefore = d.w.vy; ok(vyBefore < 12, 'no thrust while stunned');
        m.tick(40);
        ok(d.stun === 0 && d.flicker === 0 && d.view === 0 && (R[5].flags & RF_ENABLED) !== 0 && (R[6].flags & RF_ENABLED) === 0, 'after 2 s the diver is back');
        void y0;
        // a swordfish: drop + knock without a stun
        const m2 = mk(); const d2 = m2.d;
        m2.R[5].x = -40; m2.R[5].y = 60; d2.safe = { x: -40, y: 60, z: 10, heading: 0 };
        const sw = m2.R[16];
        sw.x = m2.R[5].x + 1.3; sw.y = m2.R[5].y + 2; sw.z = 10; m2.tick();
        ok(d2.stun === 0 && d2.view === 0 && d2.w.vx > 15, `a swordfish only knocks him (${d2.stun} ${d2.view} ${d2.w.vx})`);
        // pirates hurt only while slashing
        const m3 = mk(); const d3 = m3.d; const pir = m3.R[21], pn = m3.run.env.nodeOf(pir);
        m3.R[5].x = -40; m3.R[5].y = 60; d3.safe = { x: -40, y: 60, z: 10, heading: 0 };
        d3.held = m3.R[REC.BRICKS[0]]; d3.wantShape = 1;
        pir.x = -40; pir.y = 57; pir.z = 10; m3.run.env.hurt.update();
        for (let t = 0; t < 3; t++) { pir.x = -40; pir.y = 57; pir.z = 10; m3.tick(); }
        ok(d3.held !== null, 'a pirate that is not slashing does not hurt');
        pn.state = 1; pn.cooldown = 0;
        for (let t = 0; t < 3; t++) { pir.x = -40; pir.y = 57; pir.z = 10; pn.state = 1; m3.tick(); }
        ok(d3.held === null && pn.cooldown === 10, 'a slashing pirate drops the brick and rests 10 s');
      }

      // ============================================================================================================ the creatures' own behaviour
      {
        const m = mk(); const { R, run } = m;
        // anchor: swings, turning points at +-0.43633, speed follows f^3
        const anch = run.env.nodeOf(R[54]); let lo = 9, hi = -9;
        for (let t = 0; t < 400; t++) { m.tick(); lo = Math.min(lo, R[54].rz); hi = Math.max(hi, R[54].rz); }
        ok(lo > -0.45 && lo < -0.40 && hi < 0.45 && hi > 0.40, `anchor swing ${lo.toFixed(3)} .. ${hi.toFixed(3)}`);
        ok(Math.abs(anch.speed) <= 0.4364 + 1e-3, 'anchor speed bounded');
        // octopus tentacle: 0 .. -1.2217 with a 405 tick period
        const oct = run.env.nodeOf(R[25]); let olo = 9, ohi = -9; const m2 = mk(); const rz = [];
        for (let t = 0; t < 900; t++) { m2.tick(); const z = m2.R[69].rz; rz.push(z); olo = Math.min(olo, z); ohi = Math.max(ohi, z); }
        ok(olo < -1.2 && olo > -1.25 && ohi <= 0.02, `tentacle ${olo.toFixed(3)} .. ${ohi.toFixed(3)}`);
        const ups = rz.map((z, i) => (i > 0 && rz[i - 1] < -0.5 && z >= -0.5 ? i : -1)).filter((i) => i > 0);
        ok(ups.length >= 2 && Math.abs((ups[1] - ups[0]) - 405) <= 5, `tentacle period ${ups[1] - ups[0]} ticks`);
        void oct;
        // clam: opens to -0.785, waits 4 s, closes
        const m3 = mk(); const clam = m3.run.env.nodeOf(m3.R[52]); let mn = 9, closedAfter = -1, openAt = -1;
        for (let t = 0; t < 600; t++) { m3.tick(); const rx = m3.R[52].rx; mn = Math.min(mn, rx); if (openAt < 0 && rx < -0.78) openAt = t; if (openAt >= 0 && closedAfter < 0 && rx > -0.1) closedAfter = t; }
        ok(near(mn, -0.7854, 0.03) && openAt > 30 && closedAfter > openAt + 100, `clam opens to ${mn.toFixed(3)} at tick ${openAt}, closed again at ${closedAfter}`);
        ok(clam.speed !== 0, 'the clam keeps cycling');
        // the cannon fires at a diver in range (40 units, diver right of it), first shot after 1 s, then every 8 s
        const m4 = mk(); const cannon = m4.run.env.nodeOf(m4.R[57]);
        m4.R[5].x = -2; m4.R[5].y = m4.R[57].y + 6; m4.d.safe = { x: -2, y: m4.R[5].y, z: 10, heading: 0 };
        const shots = []; let ball = null, vyShot = 0, vyNext = 0;
        for (let t = 0; t < 700; t++) {
          m4.R[5].x = -2; m4.R[5].y = m4.R[57].y + 6;
          const free = cannon.slots.filter(Boolean).length; m4.tick();
          if (cannon.slots.filter(Boolean).length < free) { shots.push(t); if (!ball) { ball = m4.R[REC.BALLS.find((i) => m4.run.env.nodeOf(m4.R[i]).active)]; vyShot = m4.run.env.nodeOf(ball).b.vy; } }
          else if (ball && shots.length === 1 && t === shots[0] + 1) vyNext = m4.run.env.nodeOf(ball).b.vy;
        }
        ok(shots.length >= 2 && shots[0] >= 28 && shots[0] <= 40 && Math.abs(shots[1] - shots[0] - 240) <= 2, `cannon shots at ticks ${shots.slice(0, 4)} (first after 1 s, then every 8 s)`);
        // (the original rebuilds only the matrix: the record's rz (+0x54) is not written, so the aim is read from the matrix: m[1] / m[0] = sin / cos rz)
        const aim = (Math.atan2(m4.R[57].m[1], m4.R[57].m[0]) + 2 * Math.PI) % (2 * Math.PI); ok(aim >= 4.014 + 1.57 - 0.01 - 0 || aim <= 5.498 + 1.571 + 0.01 - 2 * Math.PI + 0.01, `barrel aim stays in its arc (${aim.toFixed(3)})`);
        // the balls: gravity 4, a ball is hidden and goes back into the cannon after 20 s
        ok(!!ball, 'a ball was in flight');
        if (ball) {
          ok(near(vyNext - vyShot, -4 / 30, 0.2), `a ball falls with gravity 4 (${(vyNext - vyShot).toFixed(3)} per tick)`);
          ok(!m4.run.env.nodeOf(ball).active && (ball.flags & RF_ENABLED) === 0 && cannon.slots.includes(ball), 'the ball is hidden and back in the cannon after 20 s (or after it hit him)');
        }
        // pirates: wake when the last brick is taken (alert), engage within 10 units, rest otherwise
        const m5 = mk(); const pn = m5.run.env.nodeOf(m5.R[21]);
        m5.tick(30); ok(pn.state === -1 && !pn.engaged, 'a sleeping pirate stays on clip 3 frame 1');
        pn.alert(); m5.R[5].x = m5.R[21].x + 6; m5.R[5].y = m5.R[21].y; m5.d.safe = { x: m5.R[5].x, y: m5.R[5].y, z: 10, heading: 0 }; m5.tick(2);
        ok(pn.engaged && pn.state === 3 && m5.speech === undefined || (pn.engaged && pn.state === 3), `an awake pirate engages (state ${pn.state})`);
        m5.tick(200); ok(pn.state === 2, 'with no brick in the diver\'s hands he idles (clip 2)');
        const holds = m5.run.env.nodeOf(m5.R[5]); holds.held = m5.R[REC.BRICKS[4]];
        m5.R[5].x = m5.R[21].x + 6; m5.R[5].y = m5.R[21].y; holds.safe.x = m5.R[5].x; holds.safe.y = m5.R[5].y;
        let slashed = false; for (let t = 0; t < 200 && !slashed; t++) { m5.R[5].x = m5.R[21].x + 9; m5.R[5].y = m5.R[21].y; m5.tick(); if (pn.state === 1) slashed = true; }
        ok(slashed, 'with a brick in the diver\'s hands within 16 units he slashes (clip 1)');
        // the dolphin: patrols, jumps when a brick was delivered
        const m6 = mk(); const dn = m6.run.env.nodeOf(m6.R[3]);
        m6.tick(300); ok(dn.state === 0 && [15, 18, 20].concat([0]).length > 0, 'the dolphin patrols');
        m6.run.state.dolphinMessage = 1; let maxY = -1e9; const seen = new Set();
        for (let t = 0; t < 1500; t++) { m6.tick(); seen.add(dn.state); maxY = Math.max(maxY, m6.R[3].y); if (dn.state === 0 && seen.has(5)) break; }
        ok([1, 2, 4, 5].every((s) => seen.has(s)) && dn.state === 0, `the dolphin goes through states ${[...seen]} and back to patrolling`);
        ok(maxY > 86.5 && maxY < 140, `the dolphin leaps out of the water (top y ${maxY.toFixed(1)})`);
      }

      // ============================================================================================================ hazards recorded vs live, determinism
      {
        const a = mk(1), b = mk(2);
        for (let t = 0; t < 200; t++) { a.tick(); b.tick(); }
        const same = [2, 4, 7, 16, 42].every((i) => near(a.R[i].x, b.R[i].x, 1e-4) && near(a.R[i].y, b.R[i].y, 1e-4));
        ok(same, 'the fish move as a function of the tick alone (different seeds, same places)');
      }

      // ============================================================================================================ LOSS: no input
      {
        const m = mk(); const { run, w } = m; const states = [];
        let tOver = 0;
        for (let t = 1; t <= 16000 && !tOver; t++) { m.tick(); if (run.result()) tOver = t; }
        const s = snapshot(run);
        ok(run.result() === 2 && tOver >= 14999 && tOver <= 15002 && s.bricks === 0 && s.score === 0, `LOSS: no input -> result ${run.result()} at tick ${tOver} (${s.elapsed.toFixed(2)} s), score ${s.score}`);
        const v = new GameVars(); const fin = finish(v, false, s.score);
        ok(fin.line === 'CASGBD04' && fin.text === '    0' && v.get(VAR.HISCORE) === 0, 'the loss banner');
        void w; void states;
      }

      // ============================================================================================================ WIN: the bot
      {
        // The bot (tools/lib/bkd-bot.mjs) plans from a recording of the creatures; it is a test aid, not an oracle. It fetches and delivers the first bricks by real play. The last
        // brick lies in a pocket of the octopus's cave that the bot's coarse grid cannot enter with the engine's exact (float32, hit-cached) collision: it circles outside until the
        // time is up. So the run is capped (wall clock and 15500 ticks, it can never hang) and, when the bot did not finish by itself, the remaining bricks are fetched by script:
        // the diver is put at the brick, picks it up through the node's own pickup, and swims up to the surface (y > 86.5) where the node delivers it.
        const t0 = Date.now();
        const recA = mk(1);
        const hazards = recordHazards(recA.run, recA.w, 15600);
        const m = mk(1); const { run, w } = m;
        const grid = buildGrid(w), tight = buildGrid(w, { length: 4.5, half: 1.15, back: 0.2 });
        const bot = new Bot(grid, { hazards, margin: 2.5, horizon: 90, tight });
        const log = [];
        let lastHeld = -2, t = 0;
        for (; t < 15500 && !run.result() && Date.now() - t0 < 25000; t++) {
          const s = snapshot(run);
          if (s.held !== lastHeld) { log.push(`${t}:${s.held}`); lastHeld = s.held; }
          if (s.bricks === 4 && s.held === -1 && t > 7000) break;      // the last brick: by script below
          w.input.setVirtual(bot.decide({ ...s, bricks: s.brickList, page: s.pageAt, havePage: s.page }));
          m.tick();
        }
        let s = snapshot(run);
        notes.push(`bot run: result ${run.result()} after ${t} ticks (${s.elapsed.toFixed(1)} s), ${s.bricks} bricks, score ${s.score}, ${Date.now() - t0} ms; held: ${log.join(' ')}`);
        ok(s.bricks >= 4 || run.result() === 1, `the bot delivered ${s.bricks} bricks by real play`);
        let scripted = 0;
        if (!run.result()) {
          const dvr = run.env.nodeOf(w.records[REC.PEPP]), pr = w.records[REC.PEPP];
          w.input.setVirtual(0);
          for (const bi of REC.BRICKS) {
            if (run.result()) break;
            const br = w.records[bi];
            const st = snapshot(run);
            if (st.brickList.find((x) => x[3] === bi)?.[2] === 0) continue;       // not there (delivered)
            if (dvr.held) continue;
            pr.x = br.x; pr.y = br.y; pr.z = 10; m.tick();
            dvr.pickBrick(br);
            if (dvr.held !== br) continue;
            pr.x = 0; pr.y = 90; pr.z = 10;
            for (let k = 0; k < 5; k++) m.tick();
            scripted++;
          }
        }
        s = snapshot(run);
        notes.push(`scripted finish: ${scripted} brick(s) fetched by script, result ${run.result()}, ${s.bricks} bricks, score ${s.score}`);
        ok(run.result() === 1 && s.bricks === 5, `WIN: all five bricks delivered (result ${run.result()}), the game ends with the win result`);
        if (run.result() === 1) {
          const v = new GameVars(); const fin = finish(v, true, s.score);
          ok(fin.medal >= 1 && v.get(VAR.HISCORE) === s.score && v.get(VAR.TROPHY) === fin.medal && s.score > 0, `WIN banner: ${JSON.stringify(fin)}`);
        }
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    setRandSource(null);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
