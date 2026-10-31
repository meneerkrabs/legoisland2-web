// WP-SAVE (Pepper's walk node, ctor 0x42f470): the save block of SGwalk (saver FUN_0042ef62, loader FUN_0042f20d, 178 bytes: the walk struct node +0x18 .. +0x73 and the globals the walk code
// shares) after GAMEPLAY. The scenarios of the M7 walk harness (tools/lib/m7-walk-emu.mjs / m7-walk-run.mjs: the original's walk node FUN_0042d514 + camera + collision run natively next to the
// port's WalkNode) are run with the original's SERIALIZER run natively on the original's node struct after every tick, and the port's `saveBlock`: the 178 bytes must be identical, tick by tick.
// The LOADER: a block of the ORIGINAL (from a state reached by its code) is loaded into the original's node (FUN_0042f20d natively) and into the port's node (`loadBlock`), later in the same free-running
// session; both then compare equal on every tick of the M7 comparison (node, record, camera, animation, globals, sounds ...) for the rest of the scenario.
// (The node's constructor leaves +0x19 / +0x1a / +0x68 / +0x6c / +0x70 at the debug heap's 0xCD, src/game/heapfill.ts: the harness pushes every modelled field of the port's node into the original's struct, so both start from the same bytes.)
import { createRunner, makeScript, constScript } from '../lib/m7-walk-run.mjs';
import { findLedges } from '../lib/m7-walk-run.mjs';
import { hex, firstDiff } from '../lib/m8-save.mjs';
import { B } from '../../src/game/input.ts';
import { lcg } from '../lib/m7-isl-veh-emu.mjs';
import { ST } from '../../src/game/walk.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { guarded } from '../lib/inject-guard.mjs';

const RB = 0x30000000, REC = 0x68;

const __test = {
  name: 'm8-save-walk',
  async run(ctx) {
    const R = await createRunner(ctx, { coverage: false });
    const stat = { fuzz: 0, blockChecks: 0, loads: 0, loadTicks: 0, tags: 0, ticks0: 0 };
    const bad = R.bad;

    /** the original's serializer on the harness' node struct (both protocols of FUN_00418ec7) */
    const origBlock = (H) => {
      const { cpu, mem } = H.E, cell = H.E.alloc(8);
      mem.w32(cell, 0); cpu.steps = 0;
      let size = cpu.call(0x42ef62, [H.NODE, cell], { maxSteps: 1e6 }) | 0;
      if (size !== -1) throw new Error(`saver protocol: first call returned ${size}`);
      const buf = H.E.alloc(0x100);
      mem.w32(cell, buf); cpu.steps = 0;
      size = cpu.call(0x42ef62, [H.NODE, cell], { maxSteps: 1e6 }) | 0;
      return mem.read(buf, size);
    };
    const origLoad = (H, bytes) => {
      const { cpu, mem } = H.E, buf = H.E.alloc(bytes.length + 16);
      mem.write(buf, bytes); cpu.steps = 0;
      cpu.call(0x42f20d, [H.NODE, buf], { maxSteps: 1e6 });
    };
    const changed = new Uint8Array(178); let base = null;
    const compare = (tag, t, H, w, walk, rec, ob) => {
      if (!base) base = Uint8Array.from(ob);
      for (let i = 0; i < ob.length; i++) if (ob[i] !== base[i]) changed[i] = 1;
      const pb = walk.saveBlock(w, rec, rec.ctrl);
      stat.blockChecks++; R.checked++;
      const d = ob.length !== pb.length ? 0 : firstDiff(ob, pb);
      if (ob.length !== pb.length || d >= 0) bad(`${tag} tick ${t}: save block byte ${d} differs: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))} (sizes ${ob.length} / ${pb.length})`);
      return pb;
    };
    /** per tick: the original's block right after its run, the port's after its tick */
    const hooks = (tag, extra = {}) => {
      let ob = null;
      return (t, phase, H, w) => {
        const walk = H.walk, rec = H.rec;
        if (phase === 'pre') {
          if (!H.addedExec) { H.E.cpu.exec.push([0x42ef00, 0x42f300], [0x419000, 0x41a000]); H.E.cpu.invalidate(); H.addedExec = true; }
          extra.pre?.(t, H, w, walk, rec);
        } else if (phase === 'orig') { ob = origBlock(H); extra.orig?.(t, H, w, walk, rec, ob); }
        else if (phase === 'post') { compare(tag, t, H, w, walk, rec, ob); extra.post?.(t, H, w, walk, rec, ob); }
      };
    };
    const S = (name, zone, dt, held, o = {}) => {
      const tag = `${name} ${zone} dt ${dt}`;
      R.scenario({ name, zone, dt, held, ...o, hook: hooks(tag, o.x ?? {}) });
    };
    const walkUp = (n = 80) => [...constScript([[B.UP, n]])];
    const inj = (tick, fn) => (t, w, walk, rec) => { if (t === tick) fn(w, walk, rec); };


    // ---- 0. layout fuzz: every field of the node and every global to a random value (both sides), the original's serializer must give the port's bytes; and the reverse: random bytes loaded
    // by the original's loader and by `loadBlock` must leave the same state (node bytes, every global, the matrix, the accessory's flags).
    {
      const f32 = (() => { const a = new Float32Array(1); return (v) => { a[0] = v; return a[0]; }; })();
      const NODE_KEYS = [['state', 'u8'], ['shift', 'u8'], ['animResult', 'u8'], ['hideFlag', 'u8'], ['landFlag', 'u8'], ['b1d', 'u8'], ['dirFlag', 'u8'], ['slideFlag', 'u8'], ['rampX', 'i32'], ['rampY', 'i32'], ['camRampX', 'i32'], ['camRampY', 'i32'],
        ['stickX', 'f'], ['stickY', 'f'], ['camStickX', 'f'], ['camStickY', 'f'], ['idleTimer', 'f'], ['runTimer', 'f'], ['t', 'f'], ['y0', 'f'], ['yJump', 'f'], ['v0', 'f'], ['vJump', 'f'], ['speed', 'f'], ['vx', 'f'], ['vy', 'f'], ['vz', 'f'], ['w48', 'u32'], ['w4c', 'u32']];
      const NODE_OFF = { state: 0x18, shift: 0x19, animResult: 0x1a, hideFlag: 0x1b, landFlag: 0x1c, b1d: 0x1d, dirFlag: 0x1e, slideFlag: 0x1f, rampX: 0x20, stickX: 0x24, rampY: 0x28, stickY: 0x2c, camRampX: 0x30, camStickX: 0x34, camRampY: 0x38, camStickY: 0x3c,
        idleTimer: 0x40, runTimer: 0x44, w48: 0x48, w4c: 0x4c, t: 0x50, y0: 0x54, yJump: 0x58, v0: 0x5c, vJump: 0x60, speed: 0x64, vx: 0x68, vy: 0x6c, vz: 0x70 };
      const fuzzHooks = (tag, iters, seed) => (t, phase, H, w) => {
        if (phase !== 'pre' || t !== 0) return;
        if (!H.addedExec) { H.E.cpu.exec.push([0x42ef00, 0x42f300], [0x419000, 0x41a000]); H.E.cpu.invalidate(); H.addedExec = true; }
        const rnd = lcg(seed), { mem } = H.E, walk = H.walk, rec = H.rec, v = vehicles(w), g = w.pep;
        const keep = {}; for (const [k] of NODE_KEYS) keep[k] = walk[k];
        const keepG = { mailbox: g.mailbox, onObjectByte: g.onObjectByte, surfaceAtFeet: g.surfaceAtFeet, flagB8: g.flagB8, current: v.current, range: v.range, kind: v.kind, kind2: v.kind2, m: Float32Array.from(rec.m), accFlags: walk.accessory?.flags };
        const rf = () => f32((rnd() - 0.5) * (rnd() < 0.2 ? 1e6 : 200));
        const ri = () => (Math.floor(rnd() * 0x100000000) | 0);
        for (let it = 0; it < iters; it++) {
          // saver direction: random port state -> original's bytes
          for (const [k, ty] of NODE_KEYS) walk[k] = ty === 'u8' ? Math.floor(rnd() * 256) : ty === 'i32' ? ri() : ty === 'u32' ? ri() >>> 0 : rf();
          g.mailbox = Math.floor(rnd() * 256); g.onObjectByte = Math.floor(rnd() * 256); g.surfaceAtFeet = ri(); g.flagB8 = Math.floor(rnd() * 256);
          const ci = rnd() < 0.25 ? -1 : Math.floor(rnd() * w.records.length);
          const cur = ci < 0 ? null : w.records[ci];
          v.current = cur; mem.w32(0x9daa80, cur ? RB + cur.index * REC : 0);
          v.range = rf(); v.kind = ((ri() << 16) >> 16); v.kind2 = ((ri() << 16) >> 16);
          mem.wf32(0x8ae330, v.range); mem.w16(0x9da9fa, v.kind & 0xffff); mem.w16(0x8ae1e0, v.kind2 & 0xffff); mem.w8(0x9da9b8, g.flagB8);
          for (let k = 0; k < 16; k++) rec.m[k] = rf();
          if (walk.accessory) walk.accessory.flags = Math.floor(rnd() * 0x10000);
          H.pushState();
          mem.w8(0x9da9b4, g.onObjectByte); mem.w8(H.NODE + 0x1d, walk.b1d); mem.w32(H.NODE + 0x48, walk.w48 >>> 0); mem.w32(H.NODE + 0x4c, walk.w4c >>> 0);     // (the harness' pushState carries the modelled fields only)
          // pushState writes the mailbox byte and the other globals; the rest above was written directly
          const ob = origBlock(H), pb = walk.saveBlock(w, rec, rec.ctrl);
          stat.fuzz++; R.checked++;
          const d = ob.length !== pb.length ? 0 : firstDiff(ob, pb);
          if (d >= 0) bad(`${tag} fuzz ${it}: serializer byte ${d} differs: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`);
          // loader direction: random bytes (valid record tags half of the time)
          const bytes = new Uint8Array(178); for (let i = 0; i < 178; i++) bytes[i] = Math.floor(rnd() * 256);
          if (rnd() < 0.5) { const name = w.records[Math.floor(rnd() * w.records.length)].name; for (let k = 0; k < 4; k++) bytes[0x63 + k] = k < name.length ? name.charCodeAt(k) : 0; }
          // a float field that is a NaN keeps its payload in the original; a JS number cannot (signalling NaNs are quieted): not a state a game produces, so the random floats are finite
          for (const o of [0xc, 0x14, 0x1c, 0x24, 0x28, 0x2c, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5d, ...Array.from({ length: 16 }, (_, k) => 0x70 + 4 * k)]) if ((bytes[o + 3] & 0x7f) === 0x7f && (bytes[o + 2] & 0x80)) bytes[o + 3] &= 0x3f;
          if (!walk.accessory) { bytes[0xb0] = 0; bytes[0xb1] = 0; }   // (a zone without the accessory record: the harness points DAT_009daa7c past the record array; that word is not state of the world)
          if (rnd() < 0.4) bytes[0x5c] = bytes[0x61];            // the two mailbox copies agree (the writer's output) or not (the second one stays)
          origLoad(H, bytes);
          walk.loadBlock(w, rec, rec.ctrl, bytes);
          stat.fuzz++; R.checked += 12;
          const ob2 = origBlock(H), pb2 = walk.saveBlock(w, rec, rec.ctrl);
          const d2 = ob2.length !== pb2.length ? 0 : firstDiff(ob2, pb2);
          if (d2 >= 0) bad(`${tag} fuzz ${it}: after the loader, the serializer byte ${d2} differs: original ${hex(ob2.subarray(Math.max(0, d2 - 4), d2 + 8))} port ${hex(pb2.subarray(Math.max(0, d2 - 4), d2 + 8))}`);
          // every global directly
          const cmpv = (n, a, b) => { if (a !== b) bad(`${tag} fuzz ${it}: after the loader ${n}: original ${a} port ${b}`); };
          cmpv('mailbox', mem.r8(0x8ae088), g.mailbox & 0xff); cmpv('flagB8', mem.r8(0x9da9b8), g.flagB8); cmpv('onObject byte', mem.r8(0x9da9b4), g.onObjectByte);
          cmpv('surface', mem.r32(0x9da9ac) | 0, g.surfaceAtFeet | 0); cmpv('range bits', mem.r32(0x8ae330) >>> 0, new Uint32Array(Float32Array.of(v.range).buffer)[0]);
          cmpv('kind', mem.r16(0x9da9fa) << 16 >> 16, v.kind); cmpv('kind2', mem.r16(0x8ae1e0) << 16 >> 16, v.kind2);
          const op = mem.r32(0x9daa80); cmpv('current', op ? (op - RB) / REC : -1, v.current ? v.current.index : -1);
          for (let k = 0; k < 16; k++) cmpv(`matrix[${k}]`, mem.r32(RB + rec.index * REC + 0xc + 4 * k) >>> 0, new Uint32Array(Float32Array.of(rec.m[k]).buffer)[0]);
          if (walk.accessory) cmpv('accessory flags', mem.r16(RB + walk.accessory.index * REC + 0x60), walk.accessory.flags & 0xffff);
          for (const [k, ty] of NODE_KEYS) {
            const o = NODE_OFF[k], a = ty === 'u8' ? mem.r8(H.NODE + o) : ty === 'f' ? mem.r32(H.NODE + o) >>> 0 : mem.r32(H.NODE + o) >>> 0;
            const b = ty === 'u8' ? walk[k] : ty === 'f' ? new Uint32Array(Float32Array.of(walk[k]).buffer)[0] : walk[k] >>> 0;
            if (!(ty === 'f' && Number.isNaN(walk[k]))) cmpv('node.' + k, a, b);
          }
        }
        // back to the sane state (both sides)
        for (const [k] of NODE_KEYS) walk[k] = keep[k];
        Object.assign(g, { mailbox: keepG.mailbox, onObjectByte: keepG.onObjectByte, surfaceAtFeet: keepG.surfaceAtFeet, flagB8: keepG.flagB8 });
        v.current = keepG.current; v.range = keepG.range; v.kind = keepG.kind; v.kind2 = keepG.kind2; rec.m.set(keepG.m); if (walk.accessory) walk.accessory.flags = keepG.accFlags;
        mem.w32(0x9daa80, 0); mem.wf32(0x8ae330, v.range); mem.w16(0x9da9fa, 0); mem.w16(0x8ae1e0, 1); mem.w8(0x9da9b8, 0);
        H.pushState();
      };
      for (const [zone, seed] of [['z03PPH', 11], ['z02LGI', 12]]) R.scenario({ name: 'layout fuzz', zone, dt: 1, held: [0, 0, 0], hook: fuzzHooks(`fuzz ${zone}`, +(process.env.M8_FUZZ ?? 100), seed) });
    }
    // ---- 1. block after every tick of the random key scripts (all states, jumps, the camera keys), both zones, both dt
    const N = +(process.env.M8_N ?? 3), T = +(process.env.M8_T ?? 160);
    for (const dt of [1, 0.5]) {
      for (let i = 0; i < N; i++) S(`random script ${i}`, 'z03PPH', dt, makeScript(300 + i, T));
      for (let i = 0; i < Math.ceil(N / 2); i++) S(`random script ${i}`, 'z02LGI', dt, makeScript(400 + i, T), { pos: [153.8, 15, -62.5], yaw: i });
    }
    // ---- 2. the states other nodes request through the mailbox; the Alt jump; sub-games where jumping is off; the pad stick; the cliff edges of the island
    for (const dt of [1, 0.5]) {
      for (const [name, st, n] of [['knock-back', ST.KNOCKBACK, 40], ['off the board', ST.OFFBOARD, 50], ['crash', ST.CRASH, 50], ['out of the water', ST.OUTOFWATER, 50], ['throw', ST.THROW, 60], ['hand over', ST.THROW2, 60], ['throw run', ST.THROWRUN, 60], ['idle', ST.IDLE, 40], ['run left', ST.RUNLEFT, 60]])
        S(`mailbox ${name}`, 'z03PPH', dt, walkUp(n), { inject: inj(8, (w) => { w.pep.mailbox = st; }) });
      S('knock-back with an arc', 'z03PPH', dt, walkUp(60), { subgame: 0, inject: inj(8, (w, walk, rec) => { w.pep.mailbox = ST.KNOCKBACK; walk.t = Math.fround(0.05); walk.y0 = rec.y; walk.v0 = 5; }) });
      S('jump with a velocity handed over', 'z03PPH', dt, new Array(50).fill(0), { subgame: 0, inject: inj(3, (w) => { w.pep.mailbox = ST.JUMP; w.pep.jumpVelocity = [0.5, 0, Math.fround(0.2)]; }) });
      S('idle gag turn', 'z03PPH', dt, new Array(40).fill(0), { inject: inj(4, (w, walk) => { w.pep.mailbox = ST.TURN; walk.dirFlag = 1; }) });
      for (const sg of [3, 0x11, 0]) S(`Alt taps sub-game 0x${sg.toString(16)}`, 'z03PPH', dt, constScript([[B.UP, 8], [B.UP | B.ALT, 1], [B.UP, 6], [B.ALT, 1], [0, 10], [B.ALT, 1], [0, 20]]), { subgame: sg });
      S('pad stick sweep', 'z03PPH', dt, makeScript(61, 220, { dir: [[0, 1]], jump: 0 }), { inject: (t, w, walk) => { walk.padY = [-20, -34, -48, -60, -90, -127, 0, 50, 0][Math.floor(t / 25) % 9]; walk.padX = [0, 0, 20, -40, 60, -80, 0, 0, 90][Math.floor(t / 25) % 9]; } });
      S('island beach into the sea', 'z02LGI', dt, constScript([[B.UP, 70], [0, 5], [B.UP | B.LEFT, 30], [0, 5]]), { pos: [505, 3.5, -88], yaw: Math.PI / 2 });
    }
    const ledges = findLedges(ctx);
    [3, 6, 11, 14].map((k) => ledges[(k * 7 + 1) % ledges.length]).forEach((l, k) => {
      const run = k === 3;
      S(`ledge ${l.x},${l.z} ${run ? 'run' : 'pad'}`, 'z02LGI', 1, run ? constScript([[B.UP, 60], [0, 30]]) : new Array(110).fill(0), { pos: [l.x - l.dx * 4, l.h + 0.5, l.z - l.dz * 4], yaw: Math.atan2(l.dx, l.dz), inject: run ? undefined : (t, w, walk) => { walk.padY = t < 80 ? -48 : 0; } });
    });

    // ---- 3. the globals the block carries and the original's code does not write on this path: the vehicle record (DAT_009daa80: the block holds its tag), the range, kind (DAT_009da9fa),
    // DAT_008ae1e0, the float DAT_009da9b8 (non-zero: the tilt / slope code is skipped by both), the accessory's flags
    {
      const setG = (H, w, o) => {
        const { mem } = H.E, v = vehicles(w);
        if (o.current !== undefined) { mem.w32(0x9daa80, o.current === null ? 0 : RB + o.current * REC); v.current = o.current === null ? null : w.records[o.current]; }
        if (o.kind !== undefined) { mem.w16(0x9da9fa, o.kind & 0xffff); v.kind = o.kind << 16 >> 16; }
        if (o.kind2 !== undefined) { mem.w16(0x8ae1e0, o.kind2 & 0xffff); v.kind2 = o.kind2 << 16 >> 16; }
        if (o.flagB8 !== undefined) { mem.w8(0x9da9b8, o.flagB8); w.pep.flagB8 = o.flagB8; }
      };
      for (const dt of [1, 0.5]) {
        S('globals: vehicle record / kind / kind2 / flagB8', 'z03PPH', dt, makeScript(81, 160), {
          x: { pre: (t, H, w) => {
            if (t === 10) setG(H, w, { current: 3, kind: -2, kind2: -2 });
            if (t === 40) setG(H, w, { current: 1 });
            if (t === 70) setG(H, w, { current: null, kind: -3, kind2: 7 });
            if (t === 90) setG(H, w, { flagB8: 1 });
            if (t === 130) setG(H, w, { flagB8: 0, kind: 32767, kind2: -32768 });
          } },
        });
        stat.tags++;
      }
    }

    // ---- 4. the loader. Free-running sessions (the original keeps its own state); at tick T1 the original's block is taken, at tick T2 it is loaded into both machines, then the run goes on
    // under the full M7 comparison. The state loaded differs from the state at T2 (the walk moved on), so every field of the block changes.
    {
      const roundTrip = (name, zone, dt, held, T1, T2, o = {}) => {
        let snap = null;
        S(name, zone, dt, held, {
          ...o, free: true,
          x: {
            pre: (t, H, w, walk, rec) => {
              o.x?.pre?.(t, H, w, walk, rec);
              if (t === T2) {
                origLoad(H, snap); walk.loadBlock(w, rec, rec.ctrl, snap);
                // both nodes now hold exactly the block's bytes
                const ob2 = origBlock(H), pb2 = walk.saveBlock(w, rec, rec.ctrl);
                stat.loads++; R.checked++;
                const d = firstDiff(ob2, pb2);
                if (d >= 0) bad(`${name} ${zone} dt ${dt}: after the load tick ${t}: the saved block differs at byte ${d}: original ${hex(ob2.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb2.subarray(Math.max(0, d - 4), d + 8))}`);
                const d2 = firstDiff(ob2, snap);
                if (d2 >= 0) bad(`${name} ${zone} dt ${dt}: the original's loader + serializer do not give the block back (byte ${d2})`);
              }
            },
            orig: (t, H, w, walk, rec, ob) => { if (t === T1) snap = Uint8Array.from(ob); if (t > T2) stat.loadTicks++; },
          },
        });
      };
      for (const dt of [1, 0.5]) {
        for (let i = 0; i < 4; i++) roundTrip(`load round trip ${i}`, 'z03PPH', dt, makeScript(500 + i, 300), 60 + 10 * i, 140 + 15 * i);
        for (let i = 0; i < 3; i++) roundTrip(`load round trip ${i}`, 'z02LGI', dt, makeScript(600 + i, 300), 70 + 10 * i, 170, { pos: [153.8, 15, -62.5], yaw: i * 2 });
        // a block that carries a vehicle record and a non-zero flagB8 / kind / range, loaded into a clean machine
        roundTrip('load round trip with vehicle record and flagB8', 'z03PPH', dt, makeScript(700, 300), 90, 170, {
          x: { pre: (t, H, w) => {
            const { mem } = H.E, v = vehicles(w);
            if (t === 20) { mem.w32(0x9daa80, RB + 2 * REC); v.current = w.records[2]; mem.w16(0x9da9fa, 0xfffe); v.kind = -2; mem.w16(0x8ae1e0, 0xfffd); v.kind2 = -3; mem.w8(0x9da9b8, 0); }
            if (t === 120) { mem.w32(0x9daa80, 0); v.current = null; mem.w16(0x9da9fa, 0); v.kind = 0; mem.w16(0x8ae1e0, 1); v.kind2 = 1; }
          } },
        });
      }
    }
    const still = []; for (let i = 0; i < 178; i++) if (!changed[i]) still.push(i);
    const ranges = []; for (const i of still) { const l = ranges[ranges.length - 1]; if (l && l[1] === i - 1) l[1] = i; else ranges.push([i, i]); }
    const notes = [`block bytes that never differed from the first tick's block in any scenario (so only the constructor / loader value is checked there): ${ranges.map(([a, b]) => a === b ? '0x' + a.toString(16) : '0x' + a.toString(16) + '-0x' + b.toString(16)).join(' ')}`, ...R.summary(), `block checks ${stat.blockChecks} (every tick of every scenario: original serializer vs port saveBlock); fuzz iterations (serializer + loader, every field and global random) ${stat.fuzz}; loader round trips ${stat.loads}, ticks compared after a load ${stat.loadTicks}`];
    return { checked: R.checked, failures: R.failures, notes };
  },
};
export default guarded(__test);
