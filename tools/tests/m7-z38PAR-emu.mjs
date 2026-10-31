// WP-VERIFY z38PAR (docs/re/m3/z38PAR.md "Differential test"): the ORIGINAL's whole update pass of the zone (pilot FUN_004686a3, birds FUN_004677a0, balloon FUN_00467e40, seaplane
// FUN_00468040, boat FUN_00467520, the canopy's draw hook FUN_00468338, all through their vtable slots; constructors FUN_0046a926 / 4684ec / 4681c0 / 467fae / 467d38 / 4676cd; the HUD feed
// FUN_00466f50; the end block of the loop FUN_00465d39) runs in the x86 emulation (tools/lib/m7-z38PAR-emu.mjs on tools/lib/m7-zone-emu.mjs) next to the port's `World.tick()` with the same
// buttons and the same random numbers (FUN_004388ae): every record's matrix / Euler angles / visibility, the nodes' state, the animation clip / frame, the run globals, the camera and every
// sound / speech call (by sound slot identity) are compared tick by tick. dt is a parameter of BOTH sides (DAT_008b1718 in the emulator, `world.dt` in the port); every scenario runs at
// dt = 1 and dt = 0.5. Engine services that are not the subject: collision queries (the port's CollisionWorld over the original's own emulated record state), the animation advance, Pepper's pose.
import fs from 'node:fs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { ParWorldEmu, RECORDS_BASE } from '../lib/m7-z38PAR-emu.mjs';
import { parBotStep, steerBits, pitchBits } from '../lib/par-bot.mjs';
import { startParRun, parSnapshot, parFinish, parResultSpeech } from '../../src/zones/z38PAR.ts';
import { ParHud } from '../../src/zones/parachute/par-hud.ts';
import { shadowPoints } from '../../src/zones/parachute/apo-pilot.ts';
import { giveAnimations } from '../../src/zones/parachute/rigs.ts';
import { setRandomSource, segmentHitsRecordBox } from '../../src/zones/parachute/util.ts';
import { B } from '../../src/game/input.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';

const REC = 0x68;
const MAXFAIL = 24;

export default {
  name: 'm7-z38PAR-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok0 = (c, msg) => { checked++; if (!c) bad(msg); };
    const pe = loadExe(ctx.dataRoot);
    const cover = { states: new Set(), sounds: new Map(), speech: new Map(), landed: 0, bounces: 0, rings: 0, missed: 0 };
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
    const nx = (s) => (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const bad = (m) => { if (failures.length < MAXFAIL) failures.push(m); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const dtShim = { n: 0 };
    const gaugeOver = { n: 0 };

    const scenario = (label, seed, dt, keys, maxTicks, stage = null) => {
      const t0 = Date.now();
      let sp = seed, so = seed;
      const dr = { p: [], o: [] };
      setRandomSource(() => { sp = nx(sp); dr.p.push(sp >> 8 & 0x7fff); return (sp >> 8 & 0x7fff) / 32768; });
      const rngO = { int: () => { so = nx(so); dr.o.push(so >> 8 & 0x7fff); return so >> 8 & 0x7fff; } };   // the scripted rand(); FUN_004388ae runs natively
      // ---- the port
      const L = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
      const W = L.world; W.dt = dt;
      const run = startParRun(W, L.archive);
      const R = run.recs;
      for (const r of W.records) if (r.name === 'SEAE') r.flags |= 0x10;     // SeaAmin's constructor (FUN_004b1212): the foam is not solid; both worlds have it from the start (the port's node sets it in its first update, which only runs in the game)
      const pilot = R.pepp.ctrl.find('ParPilot');
      const nodeOf = (kind) => { for (const r of W.records) { const n = r.ctrl?.find(kind); if (n) return { rec: r.index, node: n }; } throw new Error(`no ${kind}`); };
      const birds = nodeOf('ParBirds').node, balloon = nodeOf('ParBalloon').node, boat = nodeOf('ParBoat').node, canopy = nodeOf('ParCanopy').node;
      const nodeRecords = { pilot: R.pepp.index, birds: nodeOf('ParBirds').rec, balloon: nodeOf('ParBalloon').rec, canopy: nodeOf('ParCanopy').rec, plane: nodeOf('ParPlane').rec, boat: nodeOf('ParBoat').rec };
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
      const L2 = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
      giveAnimations(L2.world, L2.archive, 'PTER', 'PTER');
      const o2 = L2.world.records;
      // the canopy record PARA keeps the scene's flags 2 in both worlds (PARA_Chute.col is header-only in the original's loader: no sweep finds a polygon, tools/tests/m8-para-collision.mjs)
      for (const r of o2) if (r.name === 'SEAE') r.flags |= 0x10;       // the constructor of SeaAmin (FUN_004b1212: `flags |= 0x10`) is not run by the oracle: the port sets the bit in its first update, the oracle world gets it here
      o2.find((r) => r.name === 'PARA').flags |= 0x8000;     // (the port's own 'zero scale, do not draw' bit, as startParRun sets it)
      const pi = R.pepp.index;
      const anims = new Map([[pi, o2[pi].anim]]);
      for (const r of o2) if (r.name === 'PTER') anims.set(r.index, r.anim);
      const land2 = o2.find((r) => r.name === 'LAND');
      const tmp = new Float32Array(15);
      const emu = new ParWorldEmu(pe, { world: L2.world, records: o2, anims, pepperIndex: pi }, {
        rng: rngO, dt, nodeRecords,
        shadow: (rec, size, lift) => shadowPoints(L2.world, rec, land2, size, lift, tmp),
      });
      const mem = emu.cpu.mem;
      const N = W.records.length;
      emu.construct();
      for (let k = 0; k < 9; k++) mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);       // the camera the set-up left (FUN_00422b50 and the loop's first frame are not run)
      const node = emu.node;
      const nf = (o) => mem.f32(node + o), ni = (o) => mem.r32(node + o) | 0;
      if (stage) {
        // STAGED start: the pilot is put into free fall (state 1) at stage.pos with pitch / yaw on BOTH sides
        const [x, y, z] = stage.pos, rx = stage.rx ?? 0.785, ry = stage.ry ?? 0;
        const rec = R.pepp, m = buildMatrix(rx, ry, 0, x, y, z);
        rec.rx = Math.fround(rx); rec.ry = Math.fround(ry); rec.rz = 0; rec.m.set(m); rec.savePrev();
        pilot.state = 1; run.y = y; run.height = y - 5;
        W.camera.c.set([x, y, z, x, y, z], 0);
        const a = RECORDS_BASE + pi * REC;
        for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, m[k]);
        mem.wf32(a + 0x4c, rx); mem.wf32(a + 0x50, ry); mem.wf32(a + 0x54, 0);
        mem.w32(node + 0x30, 1);
        mem.wf32(0x5d57d08, y); mem.wf32(0x5d57d24, y - 5);
        for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
        emu.sync();
      }

      const worst = new Map();
      let nfail = 0, tick = 0;
      const cmp = (name, orig, port, tol = 1e-5, idx = '') => {
        checked++;
        const dd = Math.abs(orig - port);
        if (dd > (worst.get(name) ?? 0)) worst.set(name, dd);
        if (dd !== 0 && orig !== port) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${orig} port ${port} (pilot state ${pilot.state})`); }
      };
      const eq = (name, orig, port, idx = '') => {
        checked++;
        if (orig !== port) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)} (pilot state ${pilot.state})`); }
      };
      const parse = (l) => l.filter((e) => /^(p2|s2|p3|s3|r|say) /.test(e)).map((e) => { const x = e.split(' '); return x[0] === 'p3' ? ['p3', x[1], ...x[2].split(',').map(Number)] : x[0] === 'r' ? ['r', x[1], +x[2]] : x; });
      const states = [];
      const hud = new ParHud(), evs = [];
      const prevM = W.records.map((r) => Float32Array.from(r.m));
      let nrec = 0, t = 0;
      const watched = /^(PEPP|PARA|PTER|BALL|PLNE|BOAT|RNG|TAR)/;
      for (; t < maxTicks && !run.over; t++) {
        const snap = parSnapshot(W);
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
        // ---- records
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
          if (nm === 'SHAD') { eq('SHAD visible (= DAT_05d57de4)', (mem.r32(0x5d57de4) | 0) !== 0, (r.flags & 2) !== 0); continue; }   // the original shows it only inside the canopy's draw hook, the port keeps a flat quad (known, render only)
          for (let k = 0; k < 16; k++) cmp(nm + ' m', mem.f32(a + 0xc + 4 * k), r.m[k], 0, `[${k}] #${i}`);
          if (watched.test(nm)) {
            cmp(nm + ' rx', mem.f32(a + 0x4c), r.rx); cmp(nm + ' ry', mem.f32(a + 0x50), r.ry); cmp(nm + ' rz', mem.f32(a + 0x54), r.rz);
            eq(nm + ' visible', (mem.r16(a + 0x60) & 2) !== 0, (r.flags & 2) !== 0, ` #${i}`);
          }
        }
        nrec += chg.size;
        // ---- the pilot node
        eq('state', ni(0x30), pilot.state); eq('steerDir', ni(0x34), pilot.steerDir); eq('landed', ni(0x38) !== 0, pilot.landed); eq('crashed', ni(0x3c) !== 0, pilot.crashed);
        cmp('yawRate', nf(0x40), pilot.yawRate, 1e-6); cmp('fallTarget', nf(0x44), pilot.fallTarget, 1e-6); cmp('fall', nf(0x4c), pilot.fall, 1e-6); cmp('fwd', nf(0x50), pilot.fwd);
        cmp('windX', nf(0x54), pilot.windX, 1e-6); cmp('windZ', nf(0x58), pilot.windZ, 1e-6); cmp('camLerp', nf(0x5c), pilot.camLerp, 1e-6);
        for (let k = 0; k < 3; k++) { cmp('camOff', nf(0x60 + 4 * k), pilot.camOff[k], 1e-6, `[${k}]`); cmp('bounce', nf(0x78 + 4 * k), pilot.bounce[k], 1e-5, `[${k}]`); }
        // ---- the props' nodes
        cmp('boat angle', mem.f32(emu.nodes.boat + 0x1c), boat.angle, 1e-6); cmp('boat heading', mem.f32(emu.nodes.boat + 0x18), boat.heading, 1e-6);
        for (let k = 0; k < 3; k++) cmp('bird phase', mem.f32(emu.nodes.birds + 0x1c + 4 * k), birds.phase[k], 1e-6, ` ${k}`);
        eq('balloon rising', mem.r32(emu.nodes.balloon + 0x18) !== 0, balloon.rising);
        cmp('canopy scale', mem.f32(emu.nodes.canopy + 0x18), canopy.scale, 1e-6);
        eq('Pepper anim clip', o2[pi].anim.clip, R.pepp.anim.clip); cmp('Pepper anim frame', o2[pi].anim.frame, R.pepp.anim.frame, 1e-6);
        for (const r of W.records) if (r.name === 'PTER') { const q = o2[r.index].anim; eq('PTER anim clip', q.clip, r.anim.clip, ` #${r.index}`); cmp('PTER anim frame', q.frame, r.anim.frame, 1e-6, ` #${r.index}`); }
        // ---- globals
        cmp('score', mem.f32(0x5d57d28), run.score, 1e-6); cmp('windDir', mem.f32(0x5d57d04), run.windDir, 1e-6);
        cmp('y', mem.f32(0x5d57d08), run.y); cmp('height', mem.f32(0x5d57d24), run.height); cmp('groundY', mem.f32(0x5d57db8), run.groundY);
        for (let k = 0; k < 3; k++) eq('ring flag', mem.r32(0x5d57d14 + 4 * k), run.ring[k], ` ${k + 1}`);
        eq('canopy', mem.r32(0x5d57d30) | 0, run.canopy); eq('over', (mem.r32(0x5d57d2c) | 0) !== 0, run.over); eq('shadowOn', (mem.r32(0x5d57de4) | 0) !== 0, run.shadowOn);
        eq('landScore', mem.r32(0x5d57d34) | 0, run.landScore); eq('landBonus', mem.r32(0x5d57d20) | 0, run.landBonus);
        for (let k = 0; k < 6; k++) cmp('camera', mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], 1e-5, `[${k}]`);
        // ---- the HUD (FUN_00466f50 after the update pass; the game's apply() calls ParHud.update(run, yaw) with dt = 1: see the notes)
        {
          const oh = emu.hud(), ph = hud.update(run, R.pepp.ry, W.dt);
          eq('hud text', oh.text, ph.text); eq('hud compass', oh.compass, ph.compass);
          for (let g = 0; g < 3; g++) { eq('hud ring icon', oh.rings[g], ph.rings[g], ` ${g + 1}`); eq('hud ring tint', oh.tints[g] >>> 0, g < 3 && run.ring[g] === 1 ? 0xffffffff : oh.tints[g] >>> 0, ` ${g + 1}`); }
          eq('hud chute icon', oh.chuteIcon, ph.chuteIcon);
          // KNOWN DEVIATION: the original does not clamp the gauge position below (DAT_05d4e138 = 204 - local_20 > 204 when height > refAlt); the port's marker is clamped to the bar
          if (oh.gauge > 204.0001) gaugeOver.n++;
          cmp('hud gauge', oh.gauge, ph.gauge.value, 0);
          cmp('hud gauge marker', Math.min(1, Math.max(0, Math.fround(oh.gauge / 204))), ph.gauge.marker, 0);
          eq('hud segments', oh.segments.join(), ph.gauge.segments.join());
          for (let g = 0; g < 3; g++) cmp('hud blink counter', oh.blink[g], hud.blink[g], 1e-6, ` ${g + 1}`);
          eq('hud chuteOk', (mem.r32(0x5d57d10) | 0) !== 0, run.chuteOk); cmp('hud refAlt', mem.f32(0x5d57d00), run.refAlt);
        }
        // ---- sounds and speech in call order
        const a = parse(olog), b = plog;
        checked++;
        const same = a.length === b.length && a.every((e, i) => e[0] === b[i][0] && e[1] === b[i][1] && e.slice(2).every((v, k) => v === b[i][2 + k]));
        if (!same) { nfail++; bad(`${label}: tick ${tick}: calls differ (pilot state ${pilot.state})\n    original ${a.map((e) => e.join(' ')).join(' | ')}\n    port     ${b.map((e) => e.join(' ')).join(' | ')}`); }
        for (const e of a) if (e[0] === 'p2' && /^(hit|smack|land|thruRing|chute|splash|bigSplash)/.test(e[1]) && evs.length < 14) evs.push(`${e[1]}@${tick}`);
        for (const e of a) { if (e[0] === 'say') bump(cover.speech, e[1]); else bump(cover.sounds, `${e[0]} ${e[1]}`); }
        if (nfail > f0) {
          if (process.env.PAR_DEBUG) {
            bad(`   dbg draws: port ${dr.p.length} original ${dr.o.length}: ${JSON.stringify(dr.o.slice(0, 14))} vs ${JSON.stringify(dr.p.slice(0, 14))}`);
            const at = (i) => [0x3c, 0x40, 0x44].map((o) => mem.f32(RECORDS_BASE + i * REC + o).toFixed(4)).join(',');
            bad(`   dbg PEPP: original ${at(pi)} port ${[R.pepp.x, R.pepp.y, R.pepp.z].map((v) => v.toFixed(4))}`);
            { const q = W.records.find((r) => r.name === 'PARA'); const h = W.col.rayRecord(R.land, [q.x, Math.fround(q.y + 150), q.z], [0, -8000, 0], 3, 0.01, 0); bad(`   dbg port ray from PARA (${q.x}, ${q.y + 150}, ${q.z}): ${h ? h.point : 'miss'} groundY ${run.groundY}`); const h2 = L2.world.col.rayRecord(land2, [q.x, Math.fround(q.y + 150), q.z], [0, -8000, 0], 3, 0.01, 0); bad(`   dbg oracle-world ray: ${h2 ? h2.point : 'miss'}`); }
            const pa = W.records.findIndex((r) => r.name === 'PARA'); bad(`   dbg PARA: original ${at(pa)} port ${[W.records[pa].x, W.records[pa].y, W.records[pa].z].map((v) => v.toFixed(4))}`);
          }
          break;
        }
      }
      const w = [...worst].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
      notes.push(`${label} dt ${dt}: ${t} ticks (${Date.now() - t0} ms), ${nrec} record compares, score ${Math.trunc(run.score)}, rings ${run.ring.join('')}, states ${states.map((s) => `${s.from}>${s.to}@${s.at}`).join(' ')}; unhooked ${[...emu.unhooked].map(([k, v]) => `${k.toString(16)}x${v}`).join(' ') || 'none'}; worst diffs ${w}; events ${evs.join(' ')}`);
      cover.rings += run.ring.filter((v) => v === 1).length; cover.missed += run.ring.filter((v) => v === 2).length;
      cover.bounces += states.filter((s) => s.to === 7).length;
      if (pilot.landed) cover.landed++;
      return { run, pilot, states, ticks: t };
    };

    // ---- scripted players
    const rnd = (seed) => { let q = seed; return () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return (q >>> 8) / 16777216; }; };
    const randomKeys = (seed) => {
      const rd = rnd(seed); let hold = 0, mask = 0;
      return (t, s) => {
        if (hold-- <= 0) { hold = 3 + Math.floor(rd() * 25); mask = 0; if (rd() < 0.5) mask |= B.LEFT; else if (rd() < 0.5) mask |= B.RIGHT; if (rd() < 0.4) mask |= B.UP; else if (rd() < 0.3) mask |= B.DOWN; if (rd() < 0.3 && s.chuteOk) mask |= B.SHIFT; }
        return mask;
      };
    };
    const bot = (plan) => (t, s) => parBotStep(s, plan);
    /** dive onto a world point (glide ratio sin(2 rx) / (|sin rx| * 0.4 + 0.4) per tick) */
    const ratioPitch = (dh, dy) => {
      const want = dh / Math.max(1, dy); let best = 4.71, bd = 1e9;
      for (let a = 0.05; a < 6.28; a += 0.02) { const g = Math.sin(2 * a) / (Math.abs(Math.sin(a)) * 0.4 + 0.4); if (Math.abs(g - want) < bd && Math.sin(2 * a) > 0) { bd = Math.abs(g - want); best = a; } }
      return best;
    };
    const dive = (get, chute = false) => (t, s, W) => {
      let mask = 0;
      if (s.state === 1) {
        const p = get(s, t, W), me = s.pepper;
        mask |= steerBits(s, p.x, p.z);
        mask |= pitchBits(s, p.y < me.y ? ratioPitch(Math.hypot(p.x - me.x, p.z - me.z), me.y - p.y) : 4.71);
        if (chute && s.chuteOk) mask |= B.SHIFT;
      } else if (s.state === 3) mask |= parBotStep(s, { land: 3 });
      return mask;
    };
    const Lq = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
    const rec = (n, k = 0) => Lq.world.records.filter((r) => r.name === n)[k];
    /** a staged start `d` metres from a record, `up` above it, from the bearing `deg`, heading at it */
    const at = (r, d, up, deg) => { const a = (deg * Math.PI) / 180, x = r.x + d * Math.sin(a), z = r.z + d * Math.cos(a); return { pos: [x, r.y + up, z], ry: Math.atan2(r.x - x, r.z - z), rx: 0.785 }; };
    const scen = [
      ['bot rings 3-2-1 land 3', 1, bot({}), 4200],
      ['bot rings 3-1 land 1', 2, bot({ rings: [3, 1], land: 1 }), 4200],
      ['bot rings 3-2-1 land 2', 8, bot({ land: 2 }), 4200],
      ['bot no chute', 3, bot({ noChute: true }), 4200],
      ['bot no dive', 4, bot({ dive: false, land: 2 }), 4200],
      ['random 5', 5, randomKeys(5), 4200], ['random 6', 6, randomKeys(6), 4200], ['random 7', 7, randomKeys(7), 4200],
    ];
    const staged = [
      ['stage balloon', 41, dive(() => ({ x: rec('BALL').x, y: rec('BALL').y, z: rec('BALL').z })), 500, at(rec('BALL'), 40, 60, 30)],
      ['stage balloon 2', 42, dive(() => ({ x: rec('BALL').x, y: rec('BALL').y + 5, z: rec('BALL').z })), 500, at(rec('BALL'), 25, 40, 200)],
      ['stage plane', 43, dive(() => ({ x: rec('PLNE').x, y: rec('PLNE').y, z: rec('PLNE').z })), 500, at(rec('PLNE'), 60, 80, 90)],
      ['stage plane 2', 44, dive(() => ({ x: rec('PLNE').x, y: rec('PLNE').y, z: rec('PLNE').z })), 500, at(rec('PLNE'), 50, 50, 250)],
      ['stage bird 1', 45, dive(() => ({ x: rec('PTER', 0).x, y: rec('PTER', 0).y, z: rec('PTER', 0).z })), 500, { pos: [30, 1000, 30], ry: 0.3, rx: 0.785 }],
      ['stage bird 2', 46, dive(() => ({ x: rec('PTER', 1).x, y: rec('PTER', 1).y, z: rec('PTER', 1).z })), 500, { pos: [40, 1010, -30], ry: 1, rx: 0.785 }],
      // configurations found by a search on the port (random starts above the moving targets, pitch 0 / fixed pitch): each hits what its name says
      ['stage hit bird 3', 58, () => 0, 300, { pos: [38.25, 963.2, -16.49], ry: 0, rx: 0 }],
      ['stage hit bird 1', 59, () => 0, 300, { pos: [93.03, 955.09, 75.76], ry: 0, rx: 0 }],
      ['stage hit bird 2', 60, () => 0, 300, { pos: [-26.5, 980.77, -18.54], ry: 0, rx: 0 }],
      ['stage hit plane', 61, () => 0, 300, { pos: [-43.2, 759.2, -46.2], ry: -2.97, rx: 0.74 }],
      ['stage hit plane 2', 62, () => B.DOWN, 300, { pos: [-37, 733.3, -156.6], ry: -0.39, rx: 0.95 }],
      ['stage hit balloon', 63, () => 0, 300, { pos: [-158.9, 454, -212], ry: -0.89, rx: 0.76 }],
      ['stage ring 3', 47, dive(() => rec('RNG3')), 500, at(rec('RNG3'), 20, 40, 10)],
      ['stage ring 3 dive bonus', 48, dive(() => rec('RNG3')), 500, { pos: [rec('RNG3').x, rec('RNG3').y + 30, rec('RNG3').z], ry: 0, rx: 4.6 }],
      ['stage ring 2', 49, dive(() => rec('RNG2')), 500, at(rec('RNG2'), 20, 40, 100)],
      ['stage ring 1', 50, dive(() => rec('RNG1')), 500, at(rec('RNG1'), 20, 40, 300)],
      ['stage TAR1 no chute', 51, dive(() => rec('TAR1')), 500, at(rec('TAR1'), 30, 100, 40)],
      ['stage TAR3 no chute', 52, dive(() => rec('TAR3')), 500, at(rec('TAR3'), 30, 100, 40)],
      ['stage sea', 53, dive(() => ({ x: 250, y: 2, z: 380 })), 500, { pos: [200, 120, 300], ry: 0.5, rx: 0.785 }],
      ['stage sea chute', 54, (t, s) => (s.chuteOk ? B.SHIFT : 0), 900, { pos: [260, 340, 400], ry: 0.5, rx: 0 }],
      ['stage land chute', 55, bot({ land: 3 }), 900, { pos: [-40, 330, -10], ry: 1, rx: 0 }],
      ['stage land chute 1', 56, bot({ land: 1 }), 1200, { pos: [80, 360, -100], ry: 1, rx: 0 }],
      ['stage random', 57, randomKeys(57), 700, { pos: [0, 900, 0], ry: 0.5, rx: 0.9 }],
    ];
    // the default matrix keeps one test near 30 s; PAR_FULL=1 runs every natural scenario at both dt
    const FULL = !!process.env.PAR_FULL;
    const quick = { 1: new Set(['bot rings 3-2-1 land 3', 'bot no chute', 'random 6']), 0.5: new Set(['bot rings 3-1 land 1']) };
    const only = process.env.PAR_ONLY, onlyDt = process.env.PAR_DT;
    const match = (label, dt) => (!only || new RegExp(only).test(label)) && (!onlyDt || +onlyDt === dt);
    for (const dt of [1, 0.5]) {
      for (const [label, seed, keys, max] of scen) if (match(label, dt) && (FULL || only || quick[dt].has(label))) scenario(label, seed, dt, keys, Math.round(max / dt));
      for (const [label, seed, keys, max, stage] of staged) if (match(label, dt)) scenario(label, seed, dt, keys, Math.round(max / dt), stage);
    }

    // ---- FUN_00468590 (the segment against a pterodactyl's box) run natively on random segments, against `segmentHitsRecordBox`
    {
      const Lf = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) }), o3 = Lf.world.records;
      giveAnimations(Lf.world, Lf.archive, 'PTER', 'PTER');
      const pidx = o3.findIndex((r) => r.name === 'PEPP');
      const emu = new ParWorldEmu(pe, { world: Lf.world, records: o3, anims: new Map([[pidx, o3[pidx].anim]]), pepperIndex: pidx }, { rng: { range: () => 0 }, dt: 1, nodeRecords: {}, shadow: () => null });
      const mem = emu.cpu.mem, buf = emu.alloc(64);
      let q = 4242, hits = 0, n = 0, dis = 0, pointQuirk = 0;
      const rd = () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return q / 4294967296; };
      for (let bi = 0; bi < 4; bi++) {
        const rec = o3.filter((r) => r.name === 'PTER')[bi];
        for (let it = 0; it < 3000; it++) {
          const m = buildMatrix(rd() * 6.28, rd() * 6.28, rd() * 6.28, rec.x, rec.y, rec.z);
          rec.m.set(m); rec.rx = 0; emu.putRecord(rec.index, rec);
          const c = [(rd() - 0.5) * 40, (rd() - 0.5) * 40, (rd() - 0.5) * 40].map((v, k) => v + [rec.x, rec.y, rec.z][k]);
          const a = c.map((v) => Math.fround(v)), b = c.map((v) => Math.fround(v + (rd() - 0.5) * 30));
          for (let k = 0; k < 3; k++) { mem.wf32(buf + 4 * k, a[k]); mem.wf32(buf + 12 + 4 * k, b[k]); }
          emu.cpu.steps = 0;
          const oh = emu.cpu.call(0x468590, [emu.recPtr(rec.index), buf, buf + 12, buf + 24, buf + 40], { maxSteps: 1_000_000 });
          const pp = [0, 0, 0], pn = [0, 0, 0];
          const ph = segmentHitsRecordBox(rec, a, b, pp, pn);
          n++; checked++;
          if ((oh & 1) !== (ph ? 1 : 0)) { dis++; bad(`box fuzz PTER ${bi} #${it}: original ${oh & 1} port ${ph}`); continue; }
          if (ph) {
            hits++;
            for (let k = 0; k < 3; k++) { checked++; const o = mem.f32(buf + 40 + 4 * k); if (!(Math.abs(o - pn[k]) <= 1e-4 * Math.max(1, Math.abs(o)))) bad(`box fuzz PTER ${bi} #${it} normal[${k}]: original ${o} port ${pn[k]}`); }
            // the hit point of the original is overwritten by failed later-face tests (FUN_0043d5ec assigns param_4[0..2] before its conditions are complete); callers use the normal only
            if ([0, 1, 2].some((k) => !(Math.abs(mem.f32(buf + 24 + 4 * k) - pp[k]) <= 1e-3 * Math.max(1, Math.abs(pp[k]))))) pointQuirk++;
          }
        }
      }
      notes.push(`FUN_00468590 native vs segmentHitsRecordBox: ${n} random segments (${hits} crossings), ${dis} disagreements; hit POINT differs in ${pointQuirk} crossings (unused by the callers)`);
    }

    // ---- the end of a game: the loop's case 2 (FUN_00465d39 0x466127 ..) run from the middle of the function on a prepared frame, against `parFinish` / `parResultSpeech`
    {
      const Le = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
      const pidx = Le.world.records.findIndex((r) => r.name === 'PEPP');
      const emu = new ParWorldEmu(pe, { world: Le.world, records: Le.world.records, anims: new Map([[pidx, Le.world.records[pidx].anim]]), pepperIndex: pidx }, { rng: { range: () => 0 }, dt: 1, nodeRecords: {}, shadow: () => null });
      let n = 0;
      const speechSeen = new Set(), troph = new Set(), res = new Set(), queuedSeen = new Set();
      const scores = [0, 1, 250, 1999, 1999.5, 2000, 2001, 2999, 3000, 3001, 3500, 4999, 4999.5, 5000, 5001, 5956, 7500, 12345.7, 99999];
      const stores = [0, 1, 1000, 1999, 2000, 2001, 2999, 3000, 4999, 5000, 20000];
      for (const score of scores) for (const stored of stores) for (const trophy of [0, 3]) {
        const o = emu.endOfGame({ score, stored, trophy });
        const vars = new Map([[0xaa, stored], [0xd1, trophy]]);
        const r = parFinish({ get: (i) => vars.get(i) ?? 0, set: (i, v) => vars.set(i, v) }, Math.fround(score));
        const sp = parResultSpeech(Math.fround(score));
        const what = `end of game score ${score} stored ${stored} trophy ${trophy}`;
        n++;
        const chk = (name, a, b) => { checked++; if (a !== b) bad(`${what}: ${name}: original ${JSON.stringify(a)} port ${JSON.stringify(b)}`); };
        chk('hiscore (var 0xaa)', o.hiscore, vars.get(0xaa)); chk('trophy (var 0xd1)', o.trophy, vars.get(0xd1)); chk('result', o.result, r);
        chk('speech', o.log.filter((e) => e.startsWith('say')).join('|'), `say ${sp.say[0]}${sp.say[1] ? `+${sp.say[1]}` : ''}`);
        chk('queued line', o.queued, sp.queued); chk('mode stays 2 on the first frame', o.mode, 2);
        speechSeen.add(sp.say[0]); troph.add(o.trophy); res.add(o.result); queuedSeen.add(o.queued);
      }
      notes.push(`end of game (loop case 2, ${n} cases of score x stored hiscore x stale trophy): speech ${[...speechSeen].join(',')}, queued ${[...queuedSeen].join(',')}, trophy ${[...troph].sort().join(',')}, results ${[...res].sort().join(',')}`);
    }
    setRandomSource(null);

    const m = (x) => [...x].map(([k, v]) => `${k}x${v}`).join(' ');
    ok0(dtShim.n === 0, `every anim.advance of the port carries dt (${dtShim.n} calls without)`);
    notes.push(`the HUD gauge value (DAT_05d4e138, unclamped) exceeds 204 in ${gaugeOver.n} ticks (height above the last reference altitude) and equals the original's exactly; only the bar's marker ratio is clamped (FUN_00460214 does the same)`);
    {
      const src = fs.readFileSync(new URL('../../src/zones/z38PAR.ts', import.meta.url), 'utf8');
      const calls = (src.match(/hud\.update\(run[^)]*\)/g) ?? []);
      ok0(calls.length > 0 && calls.every((c) => /dt/.test(c)), `HUD blink counters step 1 * DAT_008b1718: every hud.update call site of src/zones/z38PAR.ts passes world.dt (${calls.join(' / ')})`);
    }
    notes.push(`coverage: pilot states ${[...cover.states].sort().join(',')}; ring flags ${cover.rings} passed / ${cover.missed} missed; bounces ${cover.bounces}; landed ${cover.landed}`);
    notes.push(`sound calls: ${m(cover.sounds)}`);
    notes.push(`speech: ${m(cover.speech)}`);
    return { checked, failures, notes };
  },
};
