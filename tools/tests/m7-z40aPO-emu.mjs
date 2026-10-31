// WP-VERIFY z40aPO (docs/re/m3/z40aPO.md "Differential test"): the ORIGINAL's whole update pass of the zone (pilot FUN_007d3187, rock monsters FUN_007d28e0, brickbots FUN_007d19e0,
// asteroids FUN_007d14b0, the wing's draw hook FUN_007d2dd8, all through their vtable slots, constructors FUN_007d53af / 7d2fae / 7d2bf2 / 7d2650 / 7d1778) runs in the x86 emulation
// (tools/lib/m7-z40aPO-emu.mjs, which extends the M5 audit's tools/lib/apo-emu.mjs) next to the port's `World.tick()`, with the same buttons and the same random numbers (FUN_004388ae):
// every record's matrix / Euler angles / visibility, the pilot's and props' node state, the animation clip / frame of Pepper and the rock monsters, the game globals (score, ring flags,
// groups, heights, canopy ...), the camera and every sound / speech call (by sound slot identity) are compared tick by tick. dt is a parameter of BOTH sides (DAT_008b1718 in the emulator,
// `world.dt` in the port); every scenario runs at dt = 1 and dt = 0.5. Engine services the subject is not: collision queries (answered by the port's CollisionWorld over the original's own
// emulated record state), the animation advance (the port's AnimInstance, stepped by rate * dt) and Pepper's pose for the wing (the port's AnimInstance pose).
import fs from 'node:fs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { ApoWorldEmu, RECORDS_BASE } from '../lib/m7-z40aPO-emu.mjs';
import { apoBotStep } from '../lib/apo-bot.mjs';
import { steerBits, pitchBits } from '../lib/par-bot.mjs';
import { startApoRun, apoSnapshot, apoFinish, apoResultSpeech } from '../../src/zones/z40aPO.ts';
import { shadowPoints } from '../../src/zones/parachute/apo-pilot.ts';
import { ApoHud } from '../../src/zones/parachute/apo-hud.ts';
import { apoRun } from '../../src/zones/parachute/apo-run.ts';
import { giveAnimations } from '../../src/zones/parachute/rigs.ts';
import { setRandomSource, segmentHitsRecordBox } from '../../src/zones/parachute/util.ts';
import { meshParts } from '../../src/zones/z27trx/gate.ts';
import { B } from '../../src/game/input.ts';
import { BOT_PARK } from '../../src/zones/parachute/apo-props.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';

const REC = 0x68;
const MAXFAIL = 24;

export default {
  name: 'm7-z40aPO-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok0 = (c, msg) => { checked++; if (!c) bad(msg); };
    const pe = loadExe(ctx.dataRoot);
    const cover = { states: new Set(), sounds: new Map(), speech: new Map(), botLaunch: 0, botExplode: 0, rockWake: 0, bounces: 0, ringsPassed: 0, groupsMissed: 0, landed: 0, sky: 0, fx: new Map() };
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

    const nx = (s) => (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const gaugeOver = { n: 0 };
    const dtShim = { n: 0, byDt: new Map() };
    const bad = (m) => { if (failures.length < MAXFAIL) failures.push(m); else if (failures.length === MAXFAIL) failures.push('... more failures'); };

    /** one scenario at one dt: `keys(tick, snapshot, W)` -> buttons */
    const scenario = (label, seed, dt, keys, maxTicks, stage = null) => {
      const t0 = Date.now();
      let sp = seed, so = seed;
      setRandomSource(() => { sp = nx(sp); return (sp >> 8 & 0x7fff) / 32768; });
      const rngO = { int: () => { so = nx(so); return so >> 8 & 0x7fff; } };   // FUN_004388ae at 24-bit precision: the division and the product round to float32
      // ---- the port
      const L = loadZone(ctx, 'z40aPO');
      const W = L.world; W.dt = dt;
      const run = startApoRun(W, L.archive);
      const R = run.recs;
      const pilot = R.pepp.ctrl.find('ApoPilot');
      pilot.parts = meshParts(L.scene, L.archive, R.shtl).map((m) => m.slice());
      const nodeOf = (kind) => { for (const r of W.records) { const n = r.ctrl?.find(kind); if (n) return { rec: r.index, node: n }; } throw new Error(`no ${kind}`); };
      const bots = nodeOf('ApoBots').node, rocks = nodeOf('ApoRockMonsters').node, ast = nodeOf('ApoAsteroids').node, wing = nodeOf('ApoWing');
      const nodeRecords = { pilot: R.pepp.index, rocks: nodeOf('ApoRockMonsters').rec, bots: nodeOf('ApoBots').rec, wing: wing.rec, asteroids: nodeOf('ApoAsteroids').rec };
      // every animation advance of the port must carry the world's dt (the original's FUN_0043b76a steps by rate * DAT_008b1718): a call without it is a failure
      for (const r of W.records) {
        const a = r.anim;
        if (!a) continue;
        const adv = a.advance.bind(a);
        a.advance = (rate, d) => { if (d === undefined) { dtShim.n++; bad(`${label}: anim.advance(${rate}) called without dt`); return adv(rate, dt); } return adv(rate, d); };
      }
      const plog = [];
      const wrap = (name, f) => { const o = run.sound[name].bind(run.sound); run.sound[name] = (...a) => { f(...a); return o(...a); }; };
      wrap('play', (n) => plog.push(['p2', n])); wrap('stop', (n) => plog.push([run.sound.defs[n].kind === '3d' ? 's3' : 's2', n]));
      wrap('at', (n, p) => plog.push(['p3', n, p[0], p[1], p[2]])); wrap('rate', (n, hz) => plog.push(['r', n, hz | 0]));
      run.say = (s) => { plog.push(['say', s]); return true; };
      // ---- the oracle world and the original
      const L2 = loadZone(ctx, 'z40aPO');
      for (const n of ['ROC1', 'ROC2', 'ROC3']) giveAnimations(L2.world, L2.archive, n, 'ROCK', 2);
      const o2 = L2.world.records;
      // the scene's flag word of PEPP is 2: the 0x10 (non-solid) bit is the port's walk set-up (ApoPilot.init clears it again); the original's pilot is solid, the brickbots / rocks hit it
      o2[6].flags &= ~0x10;
      const anims = new Map([[6, L2.pepper.anim]]);
      for (const n of ['ROC1', 'ROC2', 'ROC3']) { const r = o2.find((q) => q.name === n); anims.set(r.index, r.anim); }
      const ogel2 = o2.find((r) => r.name === 'OGEL');
      const tmp = new Float32Array(15);
      const emu = new ApoWorldEmu(pe, { world: L2.world, records: o2, pepperAnim: L2.pepper.anim, anims }, {
        rng: rngO, dt, nodeRecords,
        parts: (i) => (o2[i].name === 'SHTL' ? meshParts(L2.scene, L2.archive, o2[i]) : []),
        shadow: (rec, size, lift) => shadowPoints(L2.world, rec, ogel2, size, lift, tmp),
      });
      const mem = emu.cpu.mem;
      const N = W.records.length;
      emu.construct();
      for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);       // the camera the zone's set-up left (FUN_00422b50)
      const node = emu.node;
      if (stage) {
        // STAGED start: the pilot is put into free fall (state 2) at stage.pos with pitch / yaw, the shuttle hidden, on BOTH sides (the node fields of the constructor's state after the
        // launch: camera offset 0, doors closed); everything after the first tick is compared as usual
        const [x, y, z] = stage.pos, rx = stage.rx ?? 0.785, ry = stage.ry ?? 0;
        const rec = R.pepp, m = buildMatrix(rx, ry, 0, x, y, z);
        rec.rx = Math.fround(rx); rec.ry = Math.fround(ry); rec.rz = 0; rec.m.set(m); rec.savePrev();
        R.shtl.hide(); pilot.state = 2; pilot.camOff = [0, 0, 0]; pilot.door = [0, 0, 0]; pilot.camLerp = 0.15; run.y = y; run.height = y - 5;
        W.camera.c.set([x, y, z, x, y, z], 0);
        const a = RECORDS_BASE + 6 * REC;
        for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, m[k]);
        mem.wf32(a + 0x4c, rx); mem.wf32(a + 0x50, ry); mem.wf32(a + 0x54, 0);
        const sh = RECORDS_BASE + 10 * REC; mem.w16(sh + 0x60, mem.r16(sh + 0x60) & ~2);
        mem.w32(node + 0x38, 2); mem.wf32(node + 0x60, 0.15); for (let k = 0; k < 3; k++) { mem.wf32(node + 0x64 + 4 * k, 0); mem.wf32(node + 0x80 + 4 * k, 0); }
        mem.wf32(0x5d5ee60, y); mem.wf32(0x5d5f0a8, y - 5);
        for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
        emu.sync();
        // the bots' constructor aims every bot at the pilot's position at construction time (the original) / at its first update (the port): both are the staged position here
        if (bots.park) { bots.park(W); bots.parked = true; bots.started = true; }
        else { bots.started = true; R.bots.forEach((r, i) => { r.x = BOT_PARK[0]; r.y = BOT_PARK[1]; r.z = BOT_PARK[2]; r.savePrev(); bots.bots[i].aim = [x, y, z]; }); }
        for (let i = 0; i < 8; i++) { const b = 0x5d5eed0 + i * 0x28; mem.wf32(b + 4, x); mem.wf32(b + 8, y); mem.wf32(b + 12, z); }
      }
      const nf = (o) => mem.f32(node + o), ni = (o) => mem.r32(node + o) | 0;

      const worst = new Map();
      let nfail = 0, tick = 0, phase = '';
      const cmp = (name, orig, port, tol = 1e-5, idx = '') => {
        checked++;
        const dd = Math.abs(orig - port);
        if (dd > (worst.get(name) ?? 0)) worst.set(name, dd);
        // coordinate-type quantities carry the float32 noise of the altitude they were computed at (ulp(2000) = 1.2e-4 stays in the value when the pilot is lower): an absolute floor of ABS
        // (5 ulp at 2000) next to the relative tolerance; the exact fields (tol <= 1e-6) have no floor
        if (dd !== 0 && orig !== port) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${orig} port ${port} (pilot state ${pilot.state})`); }
      };
      const eq = (name, orig, port, idx = '') => {
        checked++;
        if (orig !== port) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)} (pilot state ${pilot.state})`); }
      };
      const parse = (l) => l.filter((e) => /^(p2|s2|p3|s3|r|say) /.test(e)).map((e) => { const x = e.split(' '); return x[0] === 'p3' ? ['p3', x[1], ...x[2].split(',').map(Number)] : x[0] === 'r' ? ['r', x[1], +x[2]] : x; });
      const states = [];
      const hud = new ApoHud(), bFly = Array(8).fill(true), bExp = Array(8).fill(false);
      let t = 0;
      const pilotFields = () => {
        eq('state', ni(0x38), pilot.state);
        cmp('door0', nf(0x80), pilot.door[0], 1e-6); cmp('door1', nf(0x84), pilot.door[1], 1e-6); cmp('door2', nf(0x88), pilot.door[2], 1e-6);
        cmp('fall (+0x58)', nf(0x58), pilot.fall, 1e-6); cmp('fwd (+0x5c)', nf(0x5c), pilot.fwd);
        cmp('camLerp (+0x60)', nf(0x60), pilot.camLerp, 1e-6);
        for (let k = 0; k < 3; k++) cmp('camOff', nf(0x64 + 4 * k), pilot.camOff[k], 1e-6, `[${k}]`);
        cmp('yawRate (+0x4c)', nf(0x4c), pilot.yawRate, 1e-6); eq('steerDir (+0x44)', ni(0x44), pilot.steerDir);
        eq('landed (+0x48)', ni(0x48), pilot.landed ? 1 : 0);
        for (let k = 0; k < 3; k++) cmp('bounce', nf(0x8c + 4 * k), pilot.bounce[k], 1e-5, `[${k}]`);
        eq('prevState (+0x3c)', ni(0x3c), pilot.prevState); eq('prevClip (+0x40)', ni(0x40), pilot.prevClip);
      };
      const prevM = W.records.map((r) => Float32Array.from(r.m));
      let nrec = 0;
      const evs = [];
      for (; t < maxTicks && !run.over; t++) {
        const snap = apoSnapshot(W);
        const held = keys(t, snap, W);
        const olog = emu.tickAll(held, 0);
        plog.length = 0;
        W.input.setVirtual(held);
        W.tick();
        tick = t + 1;
        const before = states.length ? states[states.length - 1].to : 0;
        if (pilot.state !== before) states.push({ at: t, from: before, to: pilot.state });
        cover.states.add(pilot.state);
        const f0 = nfail;
        // ---- records: matrix, Euler angles, visibility. Every record the original wrote this tick or the port changed; all of them every 64 ticks and at the start
        const chg = new Set(emu.touched); emu.touched.clear();
        for (let i = 0; i < N; i++) {
          const r = W.records[i], pm = prevM[i];
          let d = false;
          for (let k = 0; k < 16; k++) if (pm[k] !== r.m[k]) { d = true; pm[k] = r.m[k]; }
          if (d) chg.add(i);
        }
        const all = t % 64 === 0 || t === maxTicks - 1;
        for (let i = 0; i < N; i++) {
          if (!all && !chg.has(i)) continue;
          const a = RECORDS_BASE + i * REC, r = W.records[i], nm = r.name;
          for (let k = 0; k < 16; k++) cmp(nm + ' m', mem.f32(a + 0xc + 4 * k), r.m[k], 1e-5, `[${k}]`);
          if (nm === 'PEPP' || nm === 'SHTL' || /^(RK|BB|RO|TA|SH|PA)/.test(nm) || i === nodeRecords.wing) {
            cmp(nm + ' rx', mem.f32(a + 0x4c), r.rx); cmp(nm + ' ry', mem.f32(a + 0x50), r.ry); cmp(nm + ' rz', mem.f32(a + 0x54), r.rz);
            // SHAD: the original's draw hook (FUN_007d2cf0) shows the record only while it draws it (flags |= 2, draw, flags &= ~2) and only while DAT_05d5f208 is set; the port keeps it
            // visible for the renderer in exactly those ticks
            // port: the wing's draw hook draws the record (live vertices, z test off) exactly while DAT_05d5f208 is set, and the record itself stays disabled (flag 2 cleared after the draw)
            if (nm === 'SHAD') {
              let drawn = 0; wing.node.drawShadow = (rec, verts) => { if (rec === r && verts === run.shadow) drawn++; };
              wing.node.draw(W, W.records[wing.rec]);
              eq('SHAD drawn by the hook (= DAT_05d5f208)', (mem.r32(0x5d5f208) | 0) !== 0, drawn === 1);
              eq('SHAD record disabled between draws', false, (r.flags & 2) !== 0);
            }
            else eq(nm + ' visible', (mem.r16(a + 0x60) & 2) !== 0, (r.flags & 2) !== 0);
          }
        }
        nrec += chg.size;
        pilotFields();
        // ---- node state of the props
        for (let i = 0; i < 8; i++) {
          const b = bots.bots[i], base = 0x5d5eed0 + i * 0x28, x = ` bot ${i}`;
          cmp('bot aim x', mem.f32(base + 4), b.aim[0], 1e-5, x); cmp('bot aim y', mem.f32(base + 8), b.aim[1], 1e-5, x); cmp('bot aim z', mem.f32(base + 12), b.aim[2], 1e-5, x);
          eq('bot flying', mem.r8(base + 0x18), b.flying ? 1 : 0, x); eq('bot exploded', mem.r8(base + 0x24), b.exploded ? 1 : 0, x);
          cmp('bot timer', mem.f32(base + 0x1c), b.timer, 1e-6, x); cmp('bot counter', mem.f32(base + 0x20), b.counter, 1e-6, x);
          if (b.flying && !bFly[i]) cover.botLaunch++;
          if (b.exploded && !bExp[i]) cover.botExplode++;
          bFly[i] = b.flying; bExp[i] = b.exploded;
        }
        for (let k = 0; k < 3; k++) eq('rock awake', mem.r8(0x5d5f1f5 + 8 * k), rocks.awake[k] ? 1 : 0, ` ${k}`);
        for (let k = 0; k < 3; k++) {
          const ar = emu.anims.get(mem.r32(RECORDS_BASE + (nodeRecords.rocks + k) * REC + 8)), pr = W.records[nodeRecords.rocks + k].anim;
          cmp('rock anim frame', ar.frame, pr.frame, 1e-6, ` ${k}`); eq('rock anim clip', ar.clip, pr.clip, ` ${k}`);
        }
        eq('Pepper anim clip', L2.pepper.anim.clip, R.pepp.anim.clip); cmp('Pepper anim frame', L2.pepper.anim.frame, R.pepp.anim.frame, 1e-6);
        cmp('wing scale', mem.f32(emu.nodes.wing + 0x18), wing.node.scale, 1e-6);
        if (t === 0) {
          for (let i = 0; i < 8; i++) { cmp('asteroid spin x', mem.f32(0x5d5f014 + i * 0x10), ast.spin[i][0], 1e-6, ` ${i}`); cmp('asteroid spin y', mem.f32(0x5d5f018 + i * 0x10), ast.spin[i][1], 1e-6, ` ${i}`); }
          for (let j = 0; j < 6; j++) { cmp('rkb spin x', mem.f32(0x5d5ee74 + j * 0x10), ast.spin[8 + j][0], 1e-6, ` ${j}`); cmp('rkb spin y', mem.f32(0x5d5ee78 + j * 0x10), ast.spin[8 + j][1], 1e-6, ` ${j}`); }
        }
        // ---- globals
        cmp('score', mem.f32(0x5d5f090), run.score, 1e-6);
        cmp('height', mem.f32(0x5d5f0a8), run.height, 1e-5); cmp('y (DAT_05d5ee60)', mem.f32(0x5d5ee60), run.y);
        for (let i = 0; i < 15; i++) eq('ring flag', mem.r8(0x5d5f0d0 + i * 0x14), run.ring[i], ` ${i}`);
        eq('groups', [mem.r32(0x5d5f0b0) !== 0, mem.r32(0x5d5f0ac) !== 0, mem.r32(0x5d5f0b4) !== 0].join(), run.group.join());
        eq('canopy', mem.r32(0x5d5ee64) | 0, run.canopy); eq('over', mem.r32(0x5d5ee68) | 0, run.over ? 1 : 0);
        eq('chuteOk', (mem.r32(0x5d5f098) | 0) !== 0, run.chuteOk);
        eq('monstersWoke', (mem.r32(0x5d5f0a4) | 0) !== 0, run.monstersWoke);
        eq('aborted', (mem.r32(0x5d5f094) | 0) !== 0, run.aborted);
        eq('landScore', mem.r32(0x5d5f09c) | 0, run.landScore); eq('landBonus', mem.r32(0x5d5f0b8) | 0, run.landBonus);
        eq('shadow switch', (mem.r32(0x5d5f208) | 0) !== 0, run.shadowOn);
        for (let k = 0; k < 6; k++) cmp('camera', mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], 1e-5, `[${k}]`);
        for (let j = 1; j <= 3; j++) {
          const base = emu.partBufs.get(10);
          if (base) for (let q = 0; q < 16; q++) cmp('shuttle part', mem.f32(base + j * 0x40 + q * 4), pilot.parts[j][q], 1e-6, ` ${j}[${q}]`);
        }
        if (pilot.state !== 0 && pilot.state !== 1) for (let q = 0; q < 15; q++) cmp('shadow', mem.f32(0x5d5f290 + 4 * q), run.shadow[q], 5e-4, `[${q}]`);       // terrain heights under a float32-accurate position (noise 1e-5 times a slope of up to ~30)
        // ---- the HUD (FUN_007d0f00 after the update pass; the game's apply() calls ApoHud.update(run) with dt = 1: see the notes)
        {
          const oh = emu.hud(), ph = hud.update(run, W.dt);
          eq('hud text', oh.text, ph.text);
          for (let g = 0; g < 3; g++) { eq('hud icon', oh.icons[g], [ph.groups[2], ph.groups[1], ph.groups[0]][g], ` group ${g + 1}`); eq('hud tint', oh.tints[g] >>> 0, [ph.tints[2], ph.tints[1], ph.tints[0]][g] >>> 0, ` group ${g + 1}`); }
          eq('hud chute icon', oh.chuteIcon, ph.chuteIcon);
          // KNOWN DEVIATION: FUN_007d0f00 does not clamp the gauge position below: DAT_05d4e138 = 204 - local_c is > 204 when height > refAlt (a bounce lifts the pilot above the
          // altitude of the last reference); the port's marker fraction is clamped to 0..1 (src/zones/parachute/apo-hud.ts)
          if (oh.gauge > 204.0001) gaugeOver.n++;
          cmp('hud gauge', oh.gauge, ph.gauge.value, 0);
          cmp('hud gauge marker', Math.min(1, Math.max(0, Math.fround(oh.gauge / 204))), ph.gauge.marker, 0);
          eq('hud segments', oh.segments.join(), ph.gauge.segments.join());
          for (let g = 0; g < 3; g++) cmp('hud spin counter', oh.spin[g], hud.spin[g], 1e-6, ` ${g}`);
        }
        // ---- sounds and speech in call order
        const a = parse(olog), b = plog;
        checked++;
        const same = a.length === b.length && a.every((e, i) => e[0] === b[i][0] && e[1] === b[i][1] && e.slice(2).every((v, k) => v === b[i][2 + k]));
        if (!same) { nfail++; bad(`${label}: tick ${tick}: calls differ (pilot state ${pilot.state})\n    original ${a.map((e) => e.join(' ')).join(' | ')}\n    port     ${b.map((e) => e.join(' ')).join(' | ')}`); }
        for (const e of a) if (e[0] === 'p2' && /^(hit|smack|land|thruRing|solar)/.test(e[1]) && evs.length < 14) evs.push(`${e[1]}@${tick}`);
        for (const e of a) { if (e[0] === 'say') bump(cover.speech, e[1]); else bump(cover.sounds, `${e[0]} ${e[1]}`); }
        for (const e of emu.fx) bump(cover.fx, e.split(' ')[0] + ' ' + (e.split(' ')[2] ?? ''));
        for (let i = 0; i < 8; i++) { const base = 0x5d5eed0 + i * 0x28; if (olog.length && 0) void base; }
        if (nfail > f0) {
          if (process.env.APO_DEBUG) {
            const at = (i) => [0x3c, 0x40, 0x44].map((o) => mem.f32(RECORDS_BASE + i * REC + o).toFixed(4)).join(',');
            for (const i of [nodeRecords.pilot, ...Array.from({ length: 8 }, (_, k) => nodeRecords.bots + k)]) bad(`   dbg rec ${i} ${W.records[i].name}: original ${at(i)} port ${[W.records[i].x, W.records[i].y, W.records[i].z].map((v) => v.toFixed(4))}`);
          }
          break;
        }
      }
      dtShim.byDt.set(dt, (dtShim.byDt.get(dt) ?? 0) + dtShim.n); dtShim.n = 0;
      const w = [...worst].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
      notes.push(`${label} dt ${dt}: ${t} ticks (${Date.now() - t0} ms), ${nrec} record compares, score ${run.score}, over ${run.over}, states ${states.map((s) => `${s.from}>${s.to}@${s.at}`).join(' ')}; unhooked ${[...emu.unhooked].map(([k, v]) => `${k.toString(16)}x${v}`).join(' ') || 'none'}; worst diffs ${w}; events ${evs.join(' ')}`);
      for (const r of run.ring) { if (r === 1) cover.ringsPassed++; if (r === 2) cover.groupsMissed++; }
      cover.bounces += states.filter((s) => s.to === 8).length;
      cover.rockWake += rocks.awake.filter(Boolean).length;
      if (run.aborted) cover.sky++;
      if (pilot.landed) cover.landed++;
      return { run, pilot, states, ticks: t };
    };

    // ---- scripted players
    /** steer / pitch towards a world point; `dive` = pitch (4.71 = straight down, 4.25 = glide) */
    const chase = (get, pitch = 4.25, noChute = false) => (t, s) => {
      let mask = 0;
      if (s.state === 2) {
        const p = get(s, t);
        mask |= steerBits(s, p.x, p.z);
        mask |= pitchBits(s, Math.hypot(p.x - s.pepper.x, p.z - s.pepper.z) > 3 ? pitch : 4.71);
        if (!noChute && s.chuteOk) mask |= B.SHIFT;
      } else if (s.state === 4) mask |= apoBotStep(s, { land: 3 });
      return mask;
    };
    const rnd = (seed) => { let q = seed; return () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return (q >>> 8) / 16777216; }; };
    const randomKeys = (seed) => {
      const rd = rnd(seed); let hold = 0, mask = 0;
      return (t, s) => {
        if (hold-- <= 0) { hold = 3 + Math.floor(rd() * 25); mask = 0; if (rd() < 0.5) mask |= B.LEFT; else if (rd() < 0.5) mask |= B.RIGHT; if (rd() < 0.4) mask |= B.UP; else if (rd() < 0.3) mask |= B.DOWN; if (rd() < 0.3 && s.chuteOk) mask |= B.SHIFT; }
        return mask;
      };
    };
    /** dive onto a world point: steer to it and pick the pitch whose glide ratio (sin(2 rx) / (|sin rx| * 0.4 + 0.4) per tick) reaches it from here (the wing is never opened unless `chute`) */
    const ratioPitch = (dh, dy) => {
      const want = dh / Math.max(1, dy); let best = 4.71, bd = 1e9;
      for (let a = 0.05; a < 6.28; a += 0.02) { const g = Math.sin(2 * a) / (Math.abs(Math.sin(a)) * 0.4 + 0.4); if (Math.abs(g - want) < bd && Math.sin(2 * a) > 0) { bd = Math.abs(g - want); best = a; } }
      return best;
    };
    const dive = (get, chute = false, lead = 0) => (t, s) => {
      let mask = 0;
      if (s.state === 2) {
        const p = get(s, t), me = s.pepper;
        mask |= steerBits(s, p.x, p.z);
        const dh = Math.hypot(p.x - me.x, p.z - me.z);
        mask |= pitchBits(s, p.y + lead < me.y ? ratioPitch(dh, me.y - p.y - lead) : 4.71);
        if (chute && s.chuteOk) mask |= B.SHIFT;
      } else if (s.state === 4) mask |= apoBotStep(s, { land: 3 });
      return mask;
    };
    /** fly flat away from the island (towards the sky sphere): rx = pi / 4 is the longest glide */
    const away = (t, s) => (s.state === 2 ? pitchBits(s, 0.785) | (t < 200 ? B.RIGHT : 0) : 0);
    const bot = (plan) => (t, s) => apoBotStep(s, plan);
    const L0 = loadZone(ctx, 'z40aPO');
    const scen = [
      ['idle', 3, () => 0, 6000],
      ['bot target 3', 1, bot({ land: 3 }), 9000],
      ['bot target 1', 4, bot({ land: 1, margin: 0.7 }), 9000],
      ['bot target 2', 6, bot({ land: 2 }), 9000],
      ['bot no wing', 5, bot({ noChute: true }), 9000],
      ['chase ROC1', 21, chase((s) => s.rocks[0]), 4000],
      ['chase ROC2', 22, chase((s) => s.rocks[1]), 4000],
      ['chase ROC3', 23, chase((s) => s.rocks[2]), 4000],
      ['chase bot launch', 24, chase(() => ({ x: 38.6, z: 54.1 }), 4.25, true), 4000],
      ['dive ROC1', 31, dive((s) => s.rocks[0]), 4000], ['dive ROC2', 32, dive((s) => s.rocks[1]), 4000], ['dive ROC3', 33, dive((s) => s.rocks[2]), 4000],
      ['dive TAR1', 34, dive((s) => s.targets[0]), 4000], ['dive TAR3', 35, dive((s) => s.targets[2]), 4000],
      ['dive asteroid', 36, dive((s) => ({ x: s.rc[3].x + 5, y: s.rc[3].y, z: s.rc[3].z + 5 })), 4000], ['fly away', 37, away, 8000],
      ['random 11', 11, randomKeys(11), 6000], ['random 12', 12, randomKeys(12), 6000], ['random 13', 13, randomKeys(13), 6000],
    ];
    /** a staged start `d` metres from record `name`'s position, `up` above it, coming from the bearing `deg`, heading at it */
    const at = (r, d, up, deg) => {
      const a = (deg * Math.PI) / 180, x = r.x + d * Math.sin(a), z = r.z + d * Math.cos(a);
      return { pos: [x, r.y + up, z], ry: Math.atan2(r.x - x, r.z - z), rx: 0.785 };
    };
    const staged = [];
    if (L0) {
      const rec = (n) => L0.world.records.find((r) => r.name === n);
      for (const n of ['ROC1', 'ROC2', 'ROC3']) for (const deg of [0, 180]) staged.push([`stage ${n} @${deg}`, 40 + staged.length, dive((s) => s.rocks[+n[3] - 1], false, 0), 350, at(rec(n), 30, 25, deg)]);
      for (const n of ['TAR1', 'TAR2', 'TAR3']) staged.push([`stage ${n} no chute`, 60 + staged.length, dive((s) => s.targets[+n[3] - 1], false, 0), 350, at(rec(n), 30, 120, 40)]);
      staged.push(['stage OGEL ground', 70, dive(() => ({ x: 120, y: 10, z: -120 }), false, 0), 350, { pos: [60, 150, -60], ry: Math.atan2(60, -60), rx: 0.785 }]);
      staged.push(['stage bots', 71, chase(() => ({ x: 38.6, z: 54.1 }), 4.71, true), 500, { pos: [38.6, 700, 54.1], ry: 0, rx: 4.71 }]);
      staged.push(['stage bots hover', 72, (t, s) => pitchBits(s, 4.71), 500, { pos: [40, 520, 56], ry: 0, rx: 4.71 }]);
      staged.push(['stage chute low', 73, (t, s) => (s.chuteOk ? B.SHIFT | pitchBits(s, 4.71) : pitchBits(s, 4.71)), 500, { pos: [30, 400, 10], ry: 0, rx: 4.71 }]);
      staged.push(['stage chute glide land', 74, bot({ land: 3 }), 2500, { pos: [-10, 520, 20], ry: 1, rx: 4.71 }]);
      staged.push(['stage random', 76, randomKeys(76), 800, { pos: [0, 1300, 0], ry: 0.5, rx: 0.9 }]);
      staged.push(['stage asteroid RKA5', 75, dive((s) => ({ x: -8, y: 1133, z: 19 }), false, 0), 350, { pos: [-30, 1190, 40], ry: 2.2, rx: 0.785 }]);
    }
    // the default matrix keeps one test near 30 s; APO_FULL=1 runs every natural scenario at both dt (about 3 minutes)
    const FULL = !!process.env.APO_FULL;
    const quick = { 1: new Set(['bot target 3', 'chase bot launch', 'fly away']), 0.5: new Set(['bot target 1']) };
    const quickMax = { 0.5: 5200 };       // (the default matrix stops the dt 0.5 run in the glide; the staged runs cover the landing at dt 0.5)
    const only = process.env.APO_ONLY, onlyDt = process.env.APO_DT;
    for (const dt of [1, 0.5]) {
      for (const [label, seed, keys, max] of scen) if ((!only || new RegExp(only).test(label)) && (!onlyDt || +onlyDt === dt) && (FULL || only || quick[dt].has(label))) scenario(label, seed, dt, keys, FULL || only ? Math.round(max / dt) : Math.min(Math.round(max / dt), quickMax[dt] ?? 1e9));
      for (const [label, seed, keys, max, stage] of staged) if ((!only || new RegExp(only).test(label)) && (!onlyDt || +onlyDt === dt)) scenario(label, seed, dt, keys, Math.round(max / dt), stage);
    }
    // ---- FUN_007d3050 (the segment against a rock monster's box, scaled 1.2) run natively on random segments, against the port's `segmentHitsRecordBox(..., 1.2)`
    {
      const Lf = loadZone(ctx, 'z40aPO'), o3 = Lf.world.records;
      const anims = new Map([[6, Lf.pepper.anim]]);
      const emu = new ApoWorldEmu(pe, { world: Lf.world, records: o3, pepperAnim: Lf.pepper.anim, anims }, { rng: { range: () => 0 }, dt: 1, nodeRecords: {}, parts: () => [], shadow: () => null });
      const mem = emu.cpu.mem;
      const buf = emu.alloc(64);
      let q = 12345, hits = 0, n = 0, bad0 = 0, pointQuirk = 0;
      const rd = () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return q / 4294967296; };
      for (const name of ['ROC1', 'ROC2', 'ROC3']) {
        const rec = o3.find((r) => r.name === name);
        for (let it = 0; it < 4000; it++) {
          const m = buildMatrix(rd() * 6.28, rd() * 6.28, rd() * 6.28, rec.x, rec.y, rec.z);
          rec.m.set(m); rec.rx = 0; emu.putRecord(rec.index, rec);
          const c = [(rd() - 0.5) * 30, (rd() - 0.5) * 30, (rd() - 0.5) * 30].map((v, k) => v + [rec.x, rec.y, rec.z][k]);
          const a = c.map((v) => Math.fround(v)), b = c.map((v) => Math.fround(v + (rd() - 0.5) * 24));
          for (let k = 0; k < 3; k++) { mem.wf32(buf + 4 * k, a[k]); mem.wf32(buf + 12 + 4 * k, b[k]); }
          emu.cpu.steps = 0;
          const oh = emu.cpu.call(0x7d3050, [emu.recPtr(rec.index), buf, buf + 12, buf + 24, buf + 40], { maxSteps: 1_000_000 });
          const pp = [0, 0, 0], pn = [0, 0, 0];
          const ph = segmentHitsRecordBox(rec, a, b, pp, pn, 1.2);
          n++; checked++;
          if ((oh & 1) !== (ph ? 1 : 0)) { bad0++; if (failures.length < MAXFAIL) failures.push(`box fuzz ${name} #${it}: original ${oh & 1} port ${ph}`); continue; }
          if (ph) {
            hits++;
            // the normal is compared strictly. The hit POINT is not reliable in the original: FUN_0043d5ec assigns param_4[0..2] while it evaluates the later faces' range checks even when
            // those checks then fail, so an earlier face's point is overwritten; the pilot uses the normal only (FUN_007d3187 bounces off local_18), the differences are counted
            const nrm = [0, 1, 2].map((k) => mem.f32(buf + 40 + 4 * k));
            for (let k = 0; k < 3; k++) cmpBox(nrm[k], pn[k], `${name} #${it} normal[${k}]`);
            let pdiff = false;
            for (let k = 0; k < 3; k++) if (!(Math.abs(mem.f32(buf + 24 + 4 * k) - pp[k]) <= 1e-3 * Math.max(1, Math.abs(pp[k])))) pdiff = true;
            if (pdiff) pointQuirk++;
          }
        }
      }
      function cmpBox(o, p, what) { checked++; if (!(Math.abs(o - p) <= 1e-4 * Math.max(1, Math.abs(o)))) { bad(`box fuzz ${what}: original ${o} port ${p}`); } }
      notes.push(`FUN_007d3050 native vs segmentHitsRecordBox(1.2): ${n} random segments (${hits} crossings), ${bad0} disagreements; hit POINT differs in ${pointQuirk} crossings (original's point is overwritten by failed later-face tests, unused by the callers)`);
    }
    // ---- the end of a game: the loop's case 2 (FUN_007cf929 0x7cfe00 ..) run from the middle of the function on a prepared frame, against `apoFinish` / `apoResultSpeech`
    {
      const Le = loadZone(ctx, 'z40aPO');
      const emu = new ApoWorldEmu(pe, { world: Le.world, records: Le.world.records, pepperAnim: Le.pepper.anim, anims: new Map([[6, Le.pepper.anim]]) }, { rng: { range: () => 0 }, dt: 1, nodeRecords: {}, parts: () => [], shadow: () => null });
      let n = 0, speechSeen = new Set(), troph = new Set(), res = new Set();
      const scores = [0, 1, 250, 1999, 1999.5, 2000, 2001, 3500, 4999, 4999.9, 5000, 5001, 6657, 7999, 7999.5, 8000, 8000.5, 8183, 12345.7, 99999];
      const stores = [0, 1, 1000, 1999, 2000, 2001, 4999, 5000, 7999, 8000, 20000];
      for (const score of scores) for (const stored of stores) for (const trophy of [0, 3]) {
        const o = emu.endOfGame({ score, stored, trophy });
        const vars = new Map([[0x2c, stored], [0x43, trophy]]);
        const r = apoFinish({ get: (i) => vars.get(i) ?? 0, set: (i, v) => vars.set(i, v) }, Math.fround(score));
        const sp = apoResultSpeech(Math.fround(score));
        const what = `end of game score ${score} stored ${stored} trophy ${trophy}`;
        n++;
        const chk = (name, a, b) => { checked++; if (a !== b) bad(`${what}: ${name}: original ${JSON.stringify(a)} port ${JSON.stringify(b)}`); };
        chk('hiscore (var 0x2c)', o.hiscore, vars.get(0x2c));
        chk('trophy (var 0x43)', o.trophy, vars.get(0x43));
        chk('result (1 success / 2 failure)', o.result, r);
        chk('speech', o.log.filter((e) => e.startsWith('say')).join('|'), `say ${sp[0]}${sp[1] ? `+${sp[1]}` : ''}`);
        chk('mode stays 2 on the first frame', o.mode, 2);
        speechSeen.add(sp[0]); troph.add(o.trophy); res.add(o.result);
      }
      notes.push(`end of game (loop case 2, ${n} cases of score x stored hiscore x stale trophy): speech lines ${[...speechSeen].join(',')}, trophy values ${[...troph].sort().join(',')}, results ${[...res].sort().join(',')}`);
    }
    setRandomSource(null);
    const m = (x) => [...x].map(([k, v]) => `${k}x${v}`).join(' ');
    ok0([...dtShim.byDt.values()].every((n) => n === 0), `every anim.advance of the port carries dt`);
    notes.push(`the HUD gauge value (DAT_05d4e138, unclamped) exceeds 204 in ${gaugeOver.n} ticks (height above the last reference altitude) and equals the original's exactly; only the bar's marker ratio is clamped (FUN_00460214 does the same)`);
    {
      const src = fs.readFileSync(new URL('../../src/zones/z40aPO.ts', import.meta.url), 'utf8');
      const calls = (src.match(/hud\.update\(run[^)]*\)/g) ?? []);
      ok0(calls.length > 0 && calls.every((c) => /dt/.test(c)), `HUD spin counters step 1 * DAT_008b1718: every hud.update call site of src/zones/z40aPO.ts passes world.dt (${calls.join(' / ')})`);
    }
    notes.push(`coverage: pilot states ${[...cover.states].sort().join(',')}; ring flags set ${cover.ringsPassed} passed / ${cover.groupsMissed} missed; bounces ${cover.bounces}; rock wakes ${cover.rockWake}; landed ${cover.landed}; sky ${cover.sky}`);
    notes.push(`sound calls: ${m(cover.sounds)}`);
    notes.push(`speech: ${m(cover.speech)}; particle calls (original only): ${m(cover.fx)}`);
    return { checked, failures, notes };
  },
};
