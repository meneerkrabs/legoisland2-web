// M5 z07CSI, the ORACLE test of the horse (Common\Z07CSI\Horse.c: HORS FUN_00579178 / 005769a8 / 00578f2d, the riders FUN_00579725 / 00579379 / 005793c1, the saddles FUN_00579948 / 005797cf):
// the original's node code runs natively in the x86 interpreter (tools/lib/m5-z07CSI-emu.mjs `makeCsiDuel`, the waypoint walker 0x461000 .. 0x466800 native too for the constructor) next to the
// port's nodes, ticked with the same scripted buttons, stick axes, teleports (over land / shore / sea / walls: the port's CollisionWorld answers both sides), story variables and random
// numbers (one shared MSVC LCG). Compared EVERY tick and EXACTLY (float32 bit for bit): the records HORS / PEPP / JKIT / RSAD / GSAD / CLOK (matrix, Euler angles, flags, clip, frame), the
// horse node's block (+0x18 .. +0x58), the camera floats, every game variable, the vehicle globals, every sound call, the number of random numbers consumed.
import '../../src/zones/z07CSI/horse/index.ts';
import { makeCsiDuel, NATIVE_CTORS, B, lcg, RECORDS_BASE, REC, f32 } from '../lib/m5-z07CSI-emu.mjs';
import { castleSpots } from '../lib/m5-z07CSI-horse-spots.mjs';
import { horseAxes, coverage } from '../../src/zones/z07CSI/horse/hors.ts';

const MAXFAIL = 40;
const HORS = 48, PEPP = 7, JKIT = 46, SADDLES = [51, 52, 53];
const KEYS = [0, 0, B.UP, B.UP, B.UP, B.DOWN, B.LEFT, B.RIGHT, B.UP | B.LEFT, B.UP | B.RIGHT, B.DOWN | B.LEFT, B.SPACE, B.ALT, B.UP | B.ALT, B.UP | B.SPACE, B.DOWN | B.RIGHT, B.CTRL, B.UP | B.LEFT | B.SPACE];
const NODE_F = { 0x1c: 'omega', 0x20: 'jumpY0', 0x24: 'hop', 0x2c: 'turnRate', 0x30: 'turnAccel', 0x34: 'pitch', 0x38: 'backTicks', 0x3c: 'sx', 0x40: 'sy', 0x44: 'sz', 0x48: 'syaw', 0x50: 'idle', 0x58: 'standT' };
const NODE_I = { 0x18: 'st', 0x4c: 'sound', 0x54: 'active' };

export default {
  name: 'm5-z07CSI-horse-emu',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    coverage.hits = {};
    const cover = { ticks: 0, sessions: 0, mounts: 0, ridden: 0, moved: 0, jumps: 0, jumpEnds: 0, gallop: 0, standingTurns: 0, reversing: 0, soundCalls: 0, axes: 0, cutscene: 0, joust: 0 };
    const SESSIONS = (process.env.HORSE_ONLY ? [[1, 4242, 19]] : [[1, 11, 21], [1, 2024, 22], [0.5, 77, 25], [1, 4242, 19]]);
    for (const [dt, seed, node] of SESSIONS) {
      const d = makeCsiDuel(ctx, { node, seed, dt, failures, maxFail: MAXFAIL, chain: false, kinds: [NATIVE_CTORS.HORSE, NATIVE_CTORS.RIDER, NATIVE_CTORS.SADDLE], keepKinds: ['Horse'], pepperKinds: ['Horse'], vars: { 0xa3: 7 }, extraExec: [[0x461000, 0x466800]],
        // the oracle's records = the port's (flags, matrices, Euler angles, animation clips): the port's world is the one the game runs
        beforeAttach: (dd) => {
          const P = dd.P.world.records, Ow = dd.O.world.records;
          for (let i = 0; i < P.length; i++) {
            Ow[i].m.set(P[i].m); Ow[i].rx = P[i].rx; Ow[i].ry = P[i].ry; Ow[i].rz = P[i].rz; Ow[i].flags = P[i].flags;
            dd.emu.putRecord(i, Ow[i]);
            if (P[i].anim && Ow[i].anim) Ow[i].anim.start(P[i].anim.clip, P[i].anim.frame);
          }
        } });
      d.label = `horse n${node} dt${dt} seed${seed}`; cover.sessions++;
      horseAxes.x = 0; horseAxes.y = 0;                          // (module state of the port: the stick axes the previous session left)
      const W = d.P.world, mem = d.emu.cpu.mem, G = d.P.G;
      const hp = W.records[HORS], pp = W.records[PEPP];
      const onode = d.emu.nodeOf.get(HORS)[0].ptr;
      const pnode = d.pnode(HORS, 'Horse');
      pnode.setupApplied = true;                                  // (the tests place the records themselves)
      for (const i of SADDLES) d.pnode(i, 'Horse').setupApplied = true;
      const rnd = lcg(seed * 31 + 7);
      const scale = dt === 1 ? 1 : 2;
      // the frustum flag: the renderer sets record flag 1; the port asks the context (`inFrustum`), both read the flag the test writes into both records
      d.P.ictx.inFrustum = (rec) => (rec.flags & 1) !== 0;
      const setView = (on) => {
        for (const [r, side] of [[hp, 'P'], [d.O.world.records[HORS], 'O']]) { r.flags = on ? r.flags | 1 : r.flags & ~1; }
        mem.w16(RECORDS_BASE + HORS * REC + 0x60, on ? mem.r16(RECORDS_BASE + HORS * REC + 0x60) | 1 : mem.r16(RECORDS_BASE + HORS * REC + 0x60) & ~1);
      };
      const showHorse = () => { for (const r of [hp, d.O.world.records[HORS]]) r.flags |= 2; mem.w16(RECORDS_BASE + HORS * REC + 0x60, mem.r16(RECORDS_BASE + HORS * REC + 0x60) | 2); };
      showHorse();
      // the story switches the bridge records: BRGE (4, the broken bridge: `DAT_009da9b4` when the probe finds it) and BRGB (6, the wooden bridge: polygons of surface 7) are solid in some stages
      const setFlags = (i, v) => { for (const r of [W.records[i], d.O.world.records[i]]) r.flags = v; mem.w16(RECORDS_BASE + i * REC + 0x60, v); };
      const BRIDGES = { 21: [2, 2], 22: [0x12, 2], 25: [2, 0x12], 19: [0x12, 0x12] }[node];
      setFlags(4, BRIDGES[0]); setFlags(6, BRIDGES[1]);
      const putHorse = (x, z, ry, yy) => {
        const y = yy ?? W.col.terrainHeight(x, 200, z, 0);
        for (const r of [hp, d.O.world.records[HORS]]) { r.setEuler(0, ry, 0, x, y > -1e30 ? y : 0, z); r.rx = 0; r.ry = f32(ry); r.rz = 0; }
        d.emu.putRecord(HORS, d.O.world.records[HORS]);
        mem.w16(RECORDS_BASE + HORS * REC + 0x60, d.O.world.records[HORS].flags & 0xffff);
        d.emu.sync();
      };
      const putPepper = (x, z) => {
        const y = W.col.terrainHeight(x, 200, z, 0);
        d.placePepper(x, y > -1e30 ? y : 0, z, rnd() * 6.28 - 3.14);
      };
      const setRange = (v) => { mem.wf32(0x8ae330, v); G.range = f32(v); };
      const fl = (a, b, name) => { checked++; const x = f32(b); if (!(a === x || (Number.isNaN(a) && Number.isNaN(x)))) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
      const it = (a, b, name) => { checked++; if (a !== b) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
      let rng0 = { o: 0, p: 0 };
      const compare = () => {
        for (const i of [HORS, PEPP, JKIT, ...SADDLES]) {
          const a = RECORDS_BASE + i * REC, r = W.records[i];
          for (let k = 0; k < 16; k++) fl(mem.f32(a + 0xc + 4 * k), r.m[k], `${r.name}.m[${k}]`);
          fl(mem.f32(a + 0x4c), r.rx, `${r.name}.rx`); fl(mem.f32(a + 0x50), r.ry, `${r.name}.ry`); fl(mem.f32(a + 0x54), r.rz, `${r.name}.rz`);
          it(mem.r16(a + 0x60), r.flags & 0xffff, `${r.name}.flags`);
          const ao = d.O.world.records[i].anim, ap = r.anim;
          if (ao && ap) { it(ao.clip, ap.clip, `${r.name} clip`); fl(ao.frame, ap.frame, `${r.name} frame`); }
        }
        for (const [off, name] of Object.entries(NODE_F)) fl(mem.f32(onode + +off), pnode[name], `node.${name}`);
        for (const [off, name] of Object.entries(NODE_I)) it(mem.r32(onode + +off) | 0, pnode[name] | 0, `node.${name}`);
        it(mem.r32(0x5d58964), pnode.pending, 'DAT_05d58964');
        for (let k = 0; k < 6; k++) fl(mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], `camera[${k}]`);
        d.vars();
        d.globals();
        if (d.olog) d.sounds();
        it(d.rngCount.o - rng0.o, d.rngCount.p - rng0.p, 'random numbers consumed');
        checked += 3;
      };

      // ---- the start: the oracle's constructor against the port's constructor
      d.reseed(seed);
      rng0 = { o: d.rngCount.o, p: d.rngCount.p };
      compare();
      // ---- scenarios
      // positions near what the horse reacts to: the shore / sea, the bridge BRGE (surface 7 / record 4), the castle walls, trees (sweeps), open land
      const bigRecs = W.records.filter((r) => r.index > 3 && r.colObj && r.colObj.radius > 12 && r.colObj.radius < 80 && r.name !== 'PORS' && r.name !== 'PM00');
      const spot = (kind) => {
        if (kind === 'bridge') { const b = W.records[4]; return [b.x + (rnd() - 0.5) * 24, b.z + (rnd() - 0.5) * 24]; }
        if (kind === 'wall') { const r = bigRecs[Math.floor(rnd() * bigRecs.length)], a = rnd() * 6.28, rr = r.colObj.radius * (0.5 + rnd() * 0.7); return [r.x + Math.cos(a) * rr, r.z + Math.sin(a) * rr]; }
        if (kind === 'shore') {
          for (let k = 0; k < 60; k++) {
            const a = rnd() * 6.28, rr = 250 + rnd() * 200, x = Math.cos(a) * rr, z = Math.sin(a) * rr, h = W.col.terrainHeight(x, 200, z, 0);
            if (h < 8) return [x, z];
          }
        }
        return [-330 + rnd() * 660, -330 + rnd() * 660];
      };
      const { land: LAND, cliffs: CLIFFS } = castleSpots(W);
      const SPOTS = ['land', 'land', 'wall', 'wall', 'wall', 'shore', 'shore', 'bridge', 'bridge', 'bridge', 'bridge', 'edge', 'edge', 'cliff', 'cliff'];
      let afterPlace = null;
      const placeAt = (kind) => {
        afterPlace = kind;
        const ry = rnd() * 6.28 - 3.14;
        if (kind === 'bridge') {
          // on the deck: the first solid thing below a point above the bridge
          for (let k = 0; k < 30; k++) {
            const [x, z] = spot('bridge');
            const h = W.col.probe(null, [x, 60, z], [0, -90, 0], 3);
            if (h && (h.rec.index === 4 || h.rec.index === 6)) { putHorse(x, z, ry, h.point[1]); return; }
          }
        } else if (kind === 'cliff' && CLIFFS.length) {
          const c = CLIFFS[Math.floor(rnd() * CLIFFS.length)];
          putHorse(c[0] + (rnd() - 0.5) * 2, c[1] + (rnd() - 0.5) * 2, c[2] + (rnd() - 0.5) * 0.3); return;
        } else if (kind === 'edge') {
          // where the island's terrain ends: walk out from a point of land along a random direction until the ground is gone, stay on the last step
          for (let k = 0; k < 30; k++) {
            const a = rnd() * 6.28, dx = Math.cos(a), dz = Math.sin(a), p0 = LAND[Math.floor(rnd() * LAND.length)];
            let x = p0[0], z = p0[1], last = null;
            for (let i = 0; i < 400; i++) { const h = W.col.terrainHeight(x, 200, z, 0); if (h > -1e30) last = [x, z]; else if (last) break; x += dx * 1.5; z += dz * 1.5; }
            if (last && W.col.terrainHeight(last[0] + dx * 3, 200, last[1] + dz * 3, 0) < -1e30) { putHorse(last[0] + dx * rnd() * 2, last[1] + dz * rnd() * 2, Math.atan2(dx, dz) + (rnd() < 0.6 ? 0 : 3.14159)); return; }   // forward = (sin ry, 0, cos ry): out to sea or back to land
          }
        }
        const [x, z] = spot(kind);
        putHorse(x, z, ry);
      };
      // ridden behaviours: the keys held for a while
      const BEHAVIOURS = [
        () => ({ keys: [B.UP], n: 20 + rnd() * 70 }),
        () => ({ keys: [B.UP, B.UP | B.LEFT, B.UP | B.RIGHT], n: 30 + rnd() * 60 }),
        () => ({ keys: [B.UP | B.SPACE, B.UP], n: 20 + rnd() * 40 }),
        () => ({ keys: [B.DOWN], n: 3 + rnd() * 12 }),
        () => ({ keys: [B.DOWN, 0], n: 2 + rnd() * 8 }),
        () => ({ keys: [B.UP | B.ALT, B.ALT], n: 3 + rnd() * 12 }),
        () => ({ keys: [B.LEFT, B.RIGHT], n: 10 + rnd() * 30 }),
        () => ({ keys: [B.UP | B.ALT, B.UP], n: 10 + rnd() * 50 }),
        () => ({ keys: KEYS, n: 20 + rnd() * 60 }),
        () => ({ keys: [B.DOWN | B.LEFT, B.DOWN | B.RIGHT, B.DOWN], n: 8 + rnd() * 20 }),
      ];
      let held = 0;
      let beh = BEHAVIOURS[0](), behLeft = 0, behKey = 0, longIdle = 0, ctrlNext = false;
      for (let t = 0; t < 8000 * scale; t++) {
        const ridden = (W.vars.get(0x112) & 1) !== 0;
        if (t % (3 * scale) === 0) {
          const r = rnd();
          if (!ridden) {
            if (longIdle > 0) { longIdle -= 3 * scale; held = 0; }
            else if (ctrlNext) { held = B.CTRL; ctrlNext = false; }
            else if (r < 0.25) {
              // Pepper next to the horse, walking, the horse in view: the next Ctrl takes her on
              const ang = rnd() * 6.28, rr = 1 + rnd() * 5;
              putPepper(hp.x + Math.cos(ang) * rr, hp.z + Math.sin(ang) * rr); d.setVar(0x5e, 1); d.setState(0x1b, false); setView(true); setRange(576); held = 0; ctrlNext = true;
            } else {
              if (r < 0.5) { const ang = rnd() * 6.28, rr = rnd() < 0.7 ? 1 + rnd() * 8 : 20 + rnd() * 60; putPepper(hp.x + Math.cos(ang) * rr, hp.z + Math.sin(ang) * rr); }
              else if (r < 0.58) placeAt(SPOTS[Math.floor(rnd() * SPOTS.length)]);
              else if (r < 0.66) setView(rnd() < 0.5);
              else if (r < 0.70) { d.setVar(0x5e, [1, 1, 1, 2, 4][Math.floor(rnd() * 5)]); }
              else if (r < 0.73) d.setState([1, 0x1b, 0x62, 0x24][Math.floor(rnd() * 4)], false);
              else if (r < 0.76) { d.setVar(0x112, 1); d.setVar(0x5e, 0x10); d.setCurrent(HORS); }      // the story starts the ride (node 21: var 0x112 := 1)
              else if (r < 0.79 && pnode.active) { longIdle = 330 * scale; setView(false); putPepper(hp.x + 80, hp.z); d.setVar(0x5e, 1); d.setState(0x1b, false); setRange(576); }  // out of sight for 300 ticks: the horse goes home
              else if (r < 0.82) { d.setCurrent(HORS); }                                                  // the horse is the vehicle but the ride flag is not set yet
              setRange(rnd() < 0.8 ? 576 : rnd() < 0.5 ? 0.5 : 12);
              held = rnd() < 0.5 ? B.CTRL : 0;
            }
          } else {
            if (r < 0.03) placeAt(SPOTS[Math.floor(rnd() * SPOTS.length)]);
            else if (r < 0.06) d.setVar(0x58, [0x11, 0x15, 0x16, 0x17, 0x18, 0x19][Math.floor(rnd() * 6)]);
            else if (r < 0.075) { const g = rnd(); horseAxes.y = g < 0.3 ? -127 : g < 0.5 ? -80 : g < 0.7 ? 127 : g < 0.85 ? 90 : 0; d.emu.axisY = horseAxes.y; cover.axes++; horseAxes.x = rnd() < 0.5 ? 0 : Math.floor(rnd() * 255) - 127; d.emu.axisX = horseAxes.x; }
            else if (r < 0.09) { horseAxes.x = 0; horseAxes.y = 0; d.emu.axisX = 0; d.emu.axisY = 0; }
            else if (r < 0.10) setView(rnd() < 0.5);
            else if (r < 0.11) { d.emu.cutscene = true; d.P.ictx.held = true; cover.cutscene++; }
            else if (r < 0.14) { d.emu.cutscene = false; d.P.ictx.held = false; }
            else if (r < 0.15 || ((pnode.st & 0x1010) !== 0 && rnd() < 0.05)) { const c = [1, 2, 3, 4, 5, 6, 7][Math.floor(rnd() * 7)]; for (const w of [W, d.O.world]) w.records[HORS].anim?.start(c, 0); }   // a cutscene script / the story sets the horse's clip
            else if (r < 0.17 && (W.vars.get(0x112) & 0x10) === 0) { d.setCurrent(-1); d.setVar(0x5e, 1); }          // Control's dismount (tests/m5-z07CSI-control)
            if (afterPlace === 'edge' || afterPlace === 'cliff' || afterPlace === 'bridge') { beh = { keys: [rnd() < 0.5 ? B.UP : B.DOWN, B.UP | B.LEFT, B.DOWN | B.RIGHT], n: 20 + rnd() * 20 }; behLeft = beh.n; behKey = 0; afterPlace = null; }
            if (behLeft-- <= 0) { beh = BEHAVIOURS[Math.floor(rnd() * BEHAVIOURS.length)](); behLeft = beh.n; }
            if (rnd() < 0.35) behKey = Math.floor(rnd() * beh.keys.length);
            held = beh.keys[behKey];
          }
        }
        const before = { v112: W.vars.get(0x112), cur: G.current?.index ?? -1, st: pnode.st, clip: hp.anim?.clip, y: hp.y, x: hp.x, z: hp.z, pend: pnode.pending, idle: pnode.active };
        if (process.env.HORSE_DBG) { d.rngCount.pl = []; d.rngCount.ol = []; }
        if (process.env.HORSE_TR && d.t >= +process.env.HORSE_TR - 6 && d.t <= +process.env.HORSE_TR) console.log('t', d.t, 'held', held, 'v112', W.vars.get(0x112), 'v5e', W.vars.get(0x5e), 'cur', G.current?.name, 'range', G.range, 'orig range', mem.f32(0x8ae330), 'cut', d.P.ictx.cutsceneActive(), d.emu.cutscene, 'flags', hp.flags.toString(16), mem.r16(RECORDS_BASE + HORS * REC + 0x60).toString(16), 'dist', pp.x - hp.x, pp.z - hp.z, 'pep mailbox', W.pep.mailbox, mem.r32(0x8ae088));
        d.tick(held); cover.ticks++;
        if (process.env.HORSE_TR && d.t >= +process.env.HORSE_TR - 6 && d.t <= +process.env.HORSE_TR) console.log('  after: port st', pnode.st, 'clip', hp.anim?.clip, hp.anim?.frame, 'pos', hp.x, hp.z, '| orig st', mem.r32(onode + 0x18), 'clip', d.O.world.records[HORS].anim?.clip, d.O.world.records[HORS].anim?.frame, 'pos', mem.f32(RECORDS_BASE + HORS * REC + 0x3c), 'olog', d.olog.slice(0, 6).join(' | '), 'stamp', pnode.stamp, W.frame, mem.r32(onode + 8), mem.r32(0x9da5cc));
        if (process.env.HORSE_DBG && d.rngCount.pl.join() !== d.rngCount.ol.join()) console.log('rng t', d.t, 'port', d.rngCount.pl.join(), 'orig', d.rngCount.ol.join(), 'log', d.olog.filter((l) => /p2|p3/.test(l)).join(' | '));
        compare();
        const after = { v112: W.vars.get(0x112), cur: G.current?.index ?? -1, st: pnode.st, clip: hp.anim?.clip, x: hp.x, z: hp.z };
        if (before.cur !== HORS && after.cur === HORS) cover.mounts++;
        if (after.v112 & 1) cover.ridden++;
        if (pnode.st & 1) cover.gallop++;
        if ((pnode.st & 0x10) && !(before.st & 0x10)) cover.jumps++;
        if (!(pnode.st & 0x10) && (before.st & 0x10)) cover.jumpEnds++;
        if (pnode.st & 0x100) cover.reversing++;
        if (Math.abs(after.x - before.x) + Math.abs(after.z - before.z) > 0.01) cover.moved++;
        if (pnode.st & 0x1000) cover.standingTurns++;
        if ((W.vars.get(0x58) >= 0x16 && W.vars.get(0x58) <= 0x18) && (W.vars.get(0x112) & 1)) cover.joust++;
        if (d.psnd.length) cover.soundCalls += d.psnd.length;
      }
      checked += d.checked;
      notes.push(`${d.label}: ${d.nfail} failures`);
    }
    notes.push(`coverage (ticks / events): ${JSON.stringify(cover)}`);
    // every branch of the node the scenarios have to reach (the branch names are `hit(...)` in src/zones/z07CSI/horse/hors.ts; `deadElse` is unreachable in the original too)
    const MUST = ['mount', 'idleVehicle', 'icon', 'graze', 'grazeStart', 'idleLevel', 'neigh', 'outOfView', 'inView', 'home', 'rideStart', 'axisUp', 'axisUpHard', 'axisDown', 'axisDownHard', 'axisRight', 'axisLeft',
      'spaceToggle', 'busyOn', 'busyOff', 'gaitTrot', 'gaitGallop', 'jumpStart', 'hopArm', 'hopMax', 'mvJump', 'mvFwd', 'mvBack', 'backStop', 'turnLeft', 'turnRight', 'landing', 'landingTurn', 'standReset', 'reversing',
      'probe22', 'probe11', 'probe00', 'probe01', 'probe10', 'probe12', 'probe21', 'probe02', 'probe20', 'clampFront', 'clampBack', 'surface7', 'pitchSolid', 'pitchBridge', 'pitchBoth', 'pitchFrontOnly', 'pitchBackOnly', 'pitchNone',
      'stepDown', 'holdDown', 'stepUp', 'holdUp', 'liftGround', 'liftStart', 'liftRaise', 'walkStep', 'fwdBlockedClamp', 'fwdBlockedDrop', 'wallAheadHit', 'wallAheadFree', 'wallAheadGround', 'deflectPos', 'deflectNeg', 'deflectBehind',
      'fwdMove', 'fwdBody', 'backBlockedClamp', 'backBlockedDrop', 'backSweep2', 'backMove', 'backBody', 'animReverse', 'animReverseWrap', 'jumpEnd', 'landingEnd', 'standTurn', 'standTurnMove', 'standFace', 'pushFront', 'pushBack',
      'stillRotate', 'turnRamp', 'turnMax', 'restore', 'camEase', 'camDrop', 'camHold', 'camRaise', 'sndClip1', 'snd2a', 'snd2b', 'snd2c', 'snd2reset', 'snd2d', 'snd3a', 'snd3c', 'snd3d', 'snd3e', 'sndClip4'];
    const hits = coverage.hits;
    notes.push(`branches reached: ${Object.keys(hits).length}; rarest: ${Object.entries(hits).sort((x, y) => x[1] - y[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const k of MUST) if (!(hits[k] > 0)) failures.push(`coverage: branch ${k} never reached`);
    if (hits.deadElse) failures.push(`the unreachable else of the move code was reached ${hits.deadElse} times`);
    // BRGE (record 4) has no collision polygons (hasPolys false): the probe cannot find it, FUN_00576840's `== DAT_00983804 + 0x1a0` test never fires; checked by the data
    if (hits.bridgeHit) failures.push(`BRGE was hit ${hits.bridgeHit} times (the record has no polygons)`);
    coverage.hits = null;
    return { checked, failures, notes };
  },
};
