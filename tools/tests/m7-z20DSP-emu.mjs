import { loadExe, loadZone } from '../lib/engine-load.mjs';
import '../../src/zones/z20DSP.ts';
import { DspRng, SoundLog, VAR, STATE, REC } from '../../src/zones/z20dsp/shared.ts';
import { TrackSpline } from '../../src/zones/z20dsp/spline.ts';
import { euler24 } from '../../src/zones/common/x87.ts';
import { prepareDsp } from '../../src/zones/z20dsp/prepare.ts';
import { DspCamera } from '../../src/zones/z20dsp/camera.ts';
import { startDspEmitters } from '../../src/zones/z20dsp/emitters.ts';
import { createOracle, NODE_FIELDS, VARS } from '../lib/dsp-oracle.mjs';

// z20DSP "Desert Speedster", differential test: the ORIGINAL code of the zone (the set-up FUN_006be930 with its constructors, the update of every node: Speedster FUN_006c2627, the falling
// cows, the saucers, the whirlwind, WalkRock, Bertha, the pickups, Replay.c ...) runs natively in the x86 emulation in the 24-bit x87 mode Direct3D 7 leaves (cw 0x7f) next to the port, fed the
// same buttons and the same random draws; after every tick the Speedster's node (all fields), the records of every node (matrices, flags, clips), the variables, the sounds and the speech are
// compared as float32, bit for bit. The engine functions the zone calls (collision, the ground ray, the animation player, the game variables) are hosted by the port's own implementations.

const f32 = Math.fround;
export default {
  name: 'm7-z20DSP-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0, nums = 0;
    const MAXFAIL = 30;
    const bad = (m) => { if (failures.length < MAXFAIL) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z20DSP');
    const inexact = {};

    /** a port rng that replays the draws the original made in the same tick */
    class Replay extends DspRng { constructor() { super(); this.q = []; this.i = 0; this.over = 0; } next() { if (this.i >= this.q.length) { this.over++; return 0.5; } return this.q[this.i++]; } }

    const build = (seed, dt = 1) => {
      const L = loadZone(ctx, 'z20DSP');
      const w = L.world, car = L.pepper;
      const node = car.ctrl.nodes.find((n) => n.kind === 'SpeedStr');
      const S = node.shared;
      const snd = new SoundLog(); S.sounds = snd;
      const said = []; S.say = (id) => { said.push(id); return true; };
      const rp = new Replay(); S.rng = rp;
      prepareDsp(S, w, L, arch, L.scene, L.pe);
      w.vars.set(VAR.BESTTIME, 3600);
      let btn = 0;
      node.inputOverride = () => btn;
      w.dt = dt;
      // the particle calls of the port, in the format of the oracle's log (handles 100 + n)
      const emit = [];
      const label = (m) => { const i = w.records.findIndex((r) => r.m === m); if (i >= 0) return `rec ${i}`; const k = S.emit.m.indexOf(m); return k >= 0 ? `0x${(0x5d5c2c0 + 0x40 * k).toString(16)}` : '?'; };
      let nh = 100;
      S.fx = {
        start: (name, m, pos, rot, gate) => { const h = nh++; emit.push(`start ${name} ${label(m)} ${pos.map(f32).join(',')} ${rot.map(f32).join(',')} ${gate.join(',')} -> ${h}`); return h; },
        setMatrix: (h, m) => emit.push(`setM ${h} ${label(m)}`),
        stop: (h) => emit.push(`stop ${h}`),
      };
      startDspEmitters(S, w);
      const O = createOracle(pe, w, S);
      O.mem.wf32(0x8b1718, dt);                  // DAT_008b1718: the time step the original multiplies by
      const gen = new DspRng(seed);
      O.rngNext = () => gen.next();
      O.setVar(VAR.BESTTIME, 3600);
      const cam = new DspCamera();
      return { L, w, car, node, S, snd, said, rp, O, gen, cam, emit, setBtn: (b) => { btn = b; } };
    };

    const eqf = (a, b, what, tick) => {
      checked++; nums++;
      if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
      bad(`${what}: original ${a}, port ${b} (tick ${tick})`);
      const k = what.replace(/\d+/g, '#'); inexact[k] = (inexact[k] ?? 0) + 1;
      return false;
    };
    const eqi = (a, b, what, tick) => { checked++; if (a === b) return true; bad(`${what}: original ${a}, port ${b} (tick ${tick})`); return false; };

    /** one tick of both sides; returns the number of mismatches */
    const step = (G, buttons, tick) => {
      const { O, w, node, S, snd, said, rp } = G;
      const before = failures.length;
      snd.log.length = 0; said.length = 0; O.log.length = 0; O.draws.length = 0; G.emit.length = 0; O.emitLog.length = 0;
      if (process.env.DSP_DBG && tick === +process.env.DSP_DBG) { const n = node; notes.push('DBG before ' + JSON.stringify({ accel: n.accel, accelScale: n.accelScale, topSpeed: n.topSpeed, fwd: n.fwdSpeed, brake: n.brake, brakeForce: n.brakeForce, drag: n.drag, forceScale: n.forceScale, dt: w.dt })); }
      O.setHeld(buttons);
      O.updateAll();
      rp.q = O.draws.slice(); rp.i = 0; rp.over = 0;
      G.setBtn(buttons);
      w.tick();
      if (rp.over || rp.i !== rp.q.length) bad(`random draws: the original made ${rp.q.length}, the port used ${rp.i}${rp.over ? ' (+' + rp.over + ' beyond)' : ''} (tick ${tick})`);
      const m = O.mem;
      for (const [nm, off, kind, v] of NODE_FIELDS(node)) {
        if (kind === 'i') eqi(m.r32(O.node + off) | 0, v | 0, `node ${nm}`, tick); else eqf(m.f32(O.node + off), f32(v), `node ${nm}`, tick);
      }
      for (const nd of O.nodes) {
        const r = w.records[nd.rec], a = O.recPtr(nd.rec);
        for (let k = 0; k < 16; k++) if (k % 4 !== 3 || nd.rec === 38) eqf(m.f32(a + 0xc + 4 * k), r.m[k], `rec ${nd.rec} ${r.name} m[${k}]`, tick);
        eqf(m.f32(a + 0x4c), f32(r.rx), `rec ${nd.rec} rx`, tick); eqf(m.f32(a + 0x50), f32(r.ry), `rec ${nd.rec} ry`, tick); eqf(m.f32(a + 0x54), f32(r.rz), `rec ${nd.rec} rz`, tick);
        eqi(m.r16(a + 0x60) & 0x8002, r.flags & 0x8002, `rec ${nd.rec} ${r.name} flags`, tick);
        const sa = O.shadow.get(m.u32(a + 8));
        if (sa && r.anim) eqi(sa.clip, r.anim.clip, `rec ${nd.rec} ${r.name} anim clip`, tick);
      }
      for (const i of [13, 34, 35, 36, 37]) { const r = w.records[i], a = O.recPtr(i); for (let k = 0; k < 16; k++) if (k % 4 !== 3) eqf(m.f32(a + 0xc + 4 * k), r.m[k], `rec ${i} ${r.name} m[${k}]`, tick); }
      // the camera (FUN_006bd776, run once per loop pass after the update): the eye and the target, the orbit counter and the chase angle
      O.cpu.steps = 0; O.cpu.call(0x6bd776, []);
      G.cam.step(w, S);
      for (let k = 0; k < 6; k++) eqf(m.f32(0x9da5e8 + 4 * k), f32(w.camera.c[k]), `camera[${k}]`, tick);
      eqf(m.f32(0x5d5c0b4), f32(G.cam.orbit), 'camera orbit', tick); eqf(m.f32(0x5d5c0b0), f32(G.cam.angle), 'camera angle', tick);
      for (const v of VARS) eqi(O.vars(v) | 0, w.vars.get(v) | 0, `var 0x${v.toString(16)}`, tick);
      eqi(m.r32(0x5d5c0a4) | 0, S.score | 0, 'score', tick);
      eqf(m.f32(0x5d5c078), f32(S.push[0]), 'push x', tick); eqf(m.f32(0x5d5c080), f32(S.push[2]), 'push z', tick);
      eqf(m.f32(0x5d5c084), f32(S.speedMirror), 'speed mirror', tick); eqf(m.f32(0x5d4e138), f32(S.gauge), 'gauge', tick);
      // the particle calls and the four wheel-ground matrices the emitters follow
      if (G.emit.join('|') !== O.emitLog.join('|')) bad(`particle calls: original [${O.emitLog.join('|')}] port [${G.emit.join('|')}] (tick ${tick})`);
      for (let q = 0; q < 4; q++) for (let k = 0; k < 16; k++) eqf(m.f32(0x5d5c2c0 + 0x40 * q + 4 * k), S.emit.m[q][k], `emitter matrix ${q}[${k}]`, tick);
      // sounds and speech
      // the emulator's sound calls get handles (ids are not known to it): the kinds and their order are compared
      const norm = (l) => { const k = l.split(' ')[0]; return k === 'stop3d' ? 'stop' : k; };      // FUN_004435b0 / FUN_004434b0: both stop a sound handle (the twister's 3D loop is stopped by 004435b0)
      const mine = snd.log.map(norm).join('|'), theirs = O.log.filter((l) => !l.startsWith('say ')).map(norm).join('|');
      if (mine !== theirs) bad(`sound calls: original [${theirs}] port [${mine}] (tick ${tick})`);
      const sayO = O.log.filter((l) => l.startsWith('say ')).map((l) => l.slice(4)).join('|');
      if (sayO !== said.join('|')) bad(`speech: original [${sayO}] port [${said.join('|')}] (tick ${tick})`);
      if (process.env.DSP_HITS && tick >= +process.env.DSP_HITS - 3 && tick <= +process.env.DSP_HITS) notes.push(`tick ${tick} turnTo orig ${O.mem.f32(O.node + 0xac)} port ${node.turnTo} from orig ${O.mem.f32(O.node + 0xa8)} port ${node.turnFrom}`), notes.push(`tick ${tick} hit ${node.lastHitKind} ${node.lastHit} spin ${node.spin} turn ${node.turn} stuck ${node.stuck} grounded ${node.grounded} fwd ${node.fwdSpeed} vx ${node.vx} vz ${node.vz} ry ${G.car.ry} orig fwd ${O.mem.f32(O.node + 0x258)} yaw ${O.mem.f32(O.recPtr(38) + 0x50)}`);
      if (false) notes.push(`tick ${tick} hit ${node.lastHitKind} ${node.lastHit}`);
      return failures.length - before;
    };

    /** a driver that follows the track (a function of the port's state only) */
    const pilot = (G) => {
      const ctl = new TrackSpline(G.S.track.pts);
      let seq = 1, slow = 0, escape = 0, side = 0x21;
      return (tick) => {
        const { car } = G;
        const t = ctl.nearest([car.x, car.y, car.z]);
        const f = ctl.frame(Math.min(0.999, t + 0.006));
        const dx = f.p[0] - car.x, dz = f.p[2] - car.z;
        let err = Math.atan2(dx, dz) - car.ry;
        while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
        let b = 0x20;
        if (err > 0.06) b = 0x21; else if (err < -0.06) b = 0x22;
        seq = (seq * 1103515245 + 12345) >>> 0;
        if (tick % 97 === 40) b |= 0x40;                       // the horn
        if (tick % 331 > 318) b = 0x08;                        // a short brake
        // stuck against something: back out with a random turn, then try again with a random heading offset
        if (Math.abs(G.node.fwdSpeed) < 0.06) slow++; else if (slow > 0) slow--;
        if (slow > 45 && escape <= 0) { escape = 50 + (seq >>> 24) % 40; side = (seq >>> 16) & 1 ? 0x21 : 0x22; slow = 0; }
        if (escape > 0) { escape--; b = escape > 25 ? (0x08 | (side & 3)) : (0x20 | (side === 0x21 ? 0x22 : 0x21)); }
        return { b, t };
      };
    };

    try {
      for (const [seed, dt, ticks] of [[11, 1, 1200], [5, 0.5, 2400]]) {
        const G = build(seed, dt);
        const { w, O } = G;
        // the constructors: the port's nodes against the original's, before the first tick
        const m = O.mem;
        { const a = [...O.emitLog].join('|'), b = G.emit.join('|'); checked++; if (a !== b) bad(`emitter starts: original [${a}] port [${b}]`); G.emit.length = 0; O.emitLog.length = 0; }
        for (const [nm, off, kind, v] of NODE_FIELDS(G.node)) {
          if (kind === 'i') eqi(m.r32(O.node + off) | 0, v | 0, `ctor node ${nm}`, -1); else eqf(m.f32(O.node + off), f32(v), `ctor node ${nm}`, -1);
        }
        for (const nd of O.nodes) { const r = w.records[nd.rec], a = O.recPtr(nd.rec); for (let k = 0; k < 16; k++) if (k % 4 !== 3) eqf(m.f32(a + 0xc + 4 * k), r.m[k], `ctor rec ${nd.rec} ${r.name} m[${k}]`, -1); }
        // the race from the start line (the pilot follows the track; boulders stop it, then it backs out with a random turn)
        const drive = pilot(G);
        const N = +(process.env.DSP_TICKS ?? ticks);
        let firstBad = -1, maxT = 0, tick = 0;
        const run = (n) => { for (let k = 0; k < n && firstBad < 0; k++, tick++) { const { b, t } = drive(tick); maxT = Math.max(maxT, t); if (step(G, b, tick) > 0) firstBad = tick; } };
        run(40);                                                    // state 0: the intro, the orbit camera
        w.vars.set(VAR.STATE, STATE.COUNT3); O.setVar(VAR.STATE, STATE.COUNT3);       // the loop's button press (FUN_00417597(0xff, 2)): the countdown 2, 3, 4 and the race
        run(N);
        // placements along the track: the car is put on the track at t facing along it on both sides (the node's fields and the record are copied into the emulator), then driven for a while:
        // cows, boulders / rocks, saucers + cones, the whirlwind, cacti, the pickups and the finish line are met
        const ctl = new TrackSpline(G.S.track.pts);
        const stations = (process.env.DSP_STATIONS ?? '0.08,0.14,0.2,0.26,0.32,0.38,0.44,0.5,0.56,0.62,0.68,0.74,0.8,0.86,0.9,0.93,0.935,0.936,0.937,0.937').split(',').map(Number);
        for (const t0 of stations) {
          if (firstBad >= 0) break;
          const f = ctl.frame(t0), car = G.car, nd = G.node;
          car.x = f.p[0]; car.z = f.p[2]; car.y = f32(f.p[1] + 0.5); car.ry = f32(Math.atan2(f.t[0], f.t[2]));
          nd.vx = 0; nd.vy = 0; nd.vz = 0; nd.fwdSpeed = 0; nd.turn = 0; nd.stuck = 0; nd.grounded = 1; nd.bounce = 0; nd.yawRate = 0;
          car.m.set(euler24(0, car.ry, 0, car.x, car.y, car.z)); car.savePrev();
          O.putRecord(38);
          const m = O.mem;
          for (const [, off, kind, v] of NODE_FIELDS(nd)) { if (kind === 'i') m.w32(O.node + off, v | 0); else m.wf32(O.node + off, v); }
          if (w.vars.get(VAR.STATE) >= STATE.FINISH) break;
          run(400);
        }
        notes.push(`seed ${seed} dt ${dt}: ${firstBad < 0 ? tick : firstBad} ticks compared, track position reached ${maxT.toFixed(3)}, state ${w.vars.get(VAR.STATE)}, ${nums} floats compared`);
      }
    } catch (e) { failures.push(`test crashed: ${e.stack ?? e}`); }
    for (const [k, v] of Object.entries(inexact)) notes.push(`mismatch ${k}: ${v}`);
    return { checked, failures, notes };
  },
};
