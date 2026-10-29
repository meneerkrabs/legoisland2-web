import { parkSession } from '../../src/island/vehicles/crashsound.ts';
// WP-VERIFY M7 island skateboard: skate.c on the island (update FUN_00490e2e with FUN_00490cd2 / FUN_00490af4 / FUN_004900d4 / FUN_0048f66d / FUN_0048e1b0 / FUN_0048fece, the air tricks FUN_0048e840, pre-render FUN_004928d2,
// ctor FUN_00492cc2) with PepSwitc's board switch (Ctrl: FUN_004bb67d mode 1 -> 4 -> 1). The ORIGINAL's code runs natively in the island emulation (tools/lib/m7-isl-veh-skate.mjs, m7-isl-veh-emu.mjs) next to the
// port (src/island/vehicles/skate.ts, pepswitch.ts, src/zones/z01bpk/skate.ts) with the same scripted buttons from many random spots of the island; compared tick by tick: Pepper's and the board's records
// (matrix, Euler, flags), the node block (28 fields), both animation instances (clip / frame), all game variables, the vehicle globals (trick score / flag, surface, rolling-sound surface), the camera, the sound calls.
import { skateDuel, skateToPort, B, lcg, randomKeys, SK } from '../lib/m7-isl-veh-skate.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';

const MAXFAIL = 30;
const POOL = [0, 0, B.LEFT, B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT, B.ALT, B.ALT | B.LEFT, B.ALT | B.RIGHT, B.DOWN, B.SPACE, B.SPACE | B.LEFT, B.SHIFT, B.SHIFT | B.UP, B.UP, B.SPACE | B.DOWN, B.SHIFT | B.RIGHT, B.SHIFT | B.LEFT];

const EDGES = {};      // the edge spots are found once (the terrain is the same in every session)
const TRICKS = [B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.SPACE | B.UP, B.SPACE | B.DOWN, B.SPACE, B.CTRL | B.LEFT, B.CTRL | B.RIGHT, B.CTRL | B.UP, B.CTRL | B.DOWN, B.SHIFT | B.LEFT, B.SHIFT | B.RIGHT, B.SHIFT | B.UP, B.SHIFT | B.DOWN, B.SHIFT, B.CTRL, 0, B.SPACE | B.SHIFT | B.LEFT, B.CTRL | B.SHIFT | B.UP, B.LEFT, B.ALT];

export default {
  name: 'm7-isl-veh-skate',
  async run(ctx) {
    parkSession.visited = false;   // the emulated original starts with DAT_05d58064 = 0 (a process that never entered the park)
    const failures = [], notes = [];
    let checked = 0;
    const cover = { rides: 0, ticks: 0, states: {}, dismounts: 0, knocked: 0, sessions: 0, clips: {}, tricks: 0, scored: 0, edgeRides: 0, knockRides: 0, ceilingRides: 0 };
    const devs = new Map(), unhooked = new Map();
    const worstAll = new Map();

    const session = (label, dt, seed, syncMode, nRides) => {
      const d = skateDuel(ctx, { dt, maxFail: MAXFAIL, failures, tolFree: 1e-4,
        // the ground tilt (FUN_0048e1b0) builds the up vector from four terrain heights (~40: 1 float32 ulp = 3.8e-6) over 1.6 unit spans on slopes up to 60 degrees: normal error ~ 6 x 3.8e-6 / 1.6 ~ 1.5e-5 per element
        });
      d.label = label; cover.sessions++;
      d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const rnd = lcg(seed);
      const bi = d.board, pi = d.P.pepper.index;
      const first2d = d.emu.loads.find((x) => x.kind === '2d').id, first3d = d.emu.loads.find((x) => x.kind === '3d').id;
      d.syncPort = () => { d.recToPort(pi); d.recToPort(bi); d.cameraToPort(); if (d.snode()) skateToPort(d); };
      const compare = () => {
        d.rec(pi); d.rec(bi);
        d.globals(); d.vars(); d.camera(); d.sounds();
        const pa = d.P.pepper.anim, oa = d.O.pepper.anim;
        d.eq('Pepper clip', oa.clip, pa.clip); d.cmp('Pepper frame', oa.frame, pa.frame);
        const pb = W.records[bi].anim, ob = d.O.world.records[bi].anim;
        if (pb) { d.eq('board clip', ob.clip, pb.clip); d.cmp('board frame', ob.frame, pb.frame); }
        d.cmp('DAT_05d58004 trickScore', mem.f32(0x5d58004), G.trickScore); d.eq('DAT_05d58008 trickFlag', mem.r32(0x5d58008), G.trickFlag);
        d.eq('DAT_009da9ac surface', mem.r32(0x9da9ac), W.pep.surfaceAtFeet | 0);
        d.eq('DAT_05d57ff8 rollSurface', mem.r32(0x5d57ff8) | 0, G.rollSurface);
        d.eq('DAT_008ae088 mailbox', mem.r32(0x8ae088) & 0xff, W.pep.mailbox & 0xff);
        const a = d.onodeSkate(), pn = d.snode();
        if (pn && a && pn.stamp !== 0xfffffffe || (a && mem.r32(a + 8) !== 0xfffffffe)) {
          d.eq('node stamp', mem.r32(a + 8) >>> 0, pn.stamp >>> 0);
          for (const [off, ty, f] of SK) {
            const o = ty === 'f' ? mem.f32(a + off) : ty === 'u8' ? mem.r8(a + off) : mem.r32(a + off) | 0;
            if (ty === 'f') d.cmp('skate.' + f, o, pn[f]); else d.eq('skate.' + f, o, pn[f]);
          }
        }
      };
      const step = (held) => {
        d.tick(held); cover.ticks++;
        // sound handles are slot NUMBERS of the zone's bank (FUN_00874b68 returns the running count): a global that was never loaded holds 0 = the FIRST sound of its bank (2D: `p2 h0`, 3D: `p3 h0`);
        // the hosted loads hand out tokens, so the unloaded 0 is named after the first load of its kind (FUN_004b037e runs first)
        d.olog = d.olog.map((l) => l.replace(/^(p2|s2) h0$/, (_, k) => `${k} #${first2d}`).replace(/^(p3|s3) h0 /, (_, k) => `${k} #${first3d} `));
        const gm = d.grazeBegin();
        compare();
        d.grazeEnd(gm);
        const a = d.onodeSkate();
        if (riding()) { const c = d.O.pepper.anim.clip; cover.clips[c] = (cover.clips[c] ?? 0) + 1; if (c >= 0x52 && c <= 0x6d) cover.tricks++; if (mem.f32(0x5d58004) > 0) cover.scored++; }
        if (a && W.vars.get(0x5e) === 4) { const st = mem.r8(a + 0x18); cover.states[st] = (cover.states[st] ?? 0) + 1; }
      };
      const riding = () => W.vars.get(0x5e) === 4;
      const spot = () => {
        for (let k = 0; k < 50; k++) {
          const x = -300 + rnd() * 600, z = -300 + rnd() * 600;
          const y = W.col.terrainHeight(x, 70, z, 0);
          if (y > 4 && y < 60) return [x, y + 0.05, z];
        }
        return [153.8, 15, -62.5];
      };
      // spots with an edge ahead (the terrain drops by more than 3 within 8 units, flat up to 4: the board rolls off it: the ollie of FUN_00490e2e) and the spots under a sloped ceiling (the knock-off of FUN_004928d2)
      const edges = EDGES.list ??= [];
      if (!EDGES.done) for (let z = -360; z <= 360 && edges.length < 24; z += 20) for (let x = -360; x <= 360 && edges.length < 24; x += 20) {
        const y = W.col.terrainHeight(x, 70, z, 0);
        if (!(y > 4 && y < 60)) continue;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
          const y4 = W.col.terrainHeight(x + dx * 4, 70, z + dz * 4, 0), y8 = W.col.terrainHeight(x + dx * 8, 70, z + dz * 8, 0);
          if (y4 > y - 0.5 && y4 < y + 0.5 && y8 < y - 3 && y8 > 0) { edges.push([x, y + 0.05, z, a]); break; }
        }
      }
      const steep = EDGES.steep ??= [];
      if (!EDGES.done) for (let z = -360; z <= 360 && steep.length < 12; z += 10) for (let x = -360; x <= 360 && steep.length < 12; x += 10) {
        const y = W.col.terrainHeight(x, 70, z, 0);
        if (!(y > 6 && y < 60)) continue;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
          const f = W.col.terrainHeight(x + dx * 3, 70, z + dz * 3, 0), b = W.col.terrainHeight(x - dx * 3, 70, z - dz * 3, 0);
          if (f - b > 3.2 && f - b < 6 && b > 4 && f < 60) { steep.push([x, y + 0.05, z, a]); break; }   // ~28..45 degrees uphill ahead
        }
      }
      EDGES.done = true;
      const ceilings = [[-68, 12.98, 364, -Math.PI / 2], [-104, 21.66, 46, Math.PI / 2], [190, 22.08, -140, -Math.PI]];     // spots below a sloped ceiling (found by a sweep scan), facing into it
      const synth = { on: false };
      for (const col of [W.col, d.O.world.col]) {
        const os = col.sweep.bind(col);
        col.sweep = (rec, from, delta, mask, radius, skin) => {
          if (synth.on && mask === 1 && Math.abs(skin - 0.2) < 1e-6 && Math.abs(delta[1] - 1.2000000476837158) < 1e-6) {
            const n = [Math.fround(-rec.m[8] * 0.8), Math.fround(-0.6), Math.fround(-rec.m[10] * 0.8)];     // (the sweep stores float32 normals)
            return { rec: col === W.col ? W.records[0] : d.O.world.records[0], point: [from[0], Math.fround(from[1] + 1), from[2]], normal: n, surface: 0 };
          }
          return os(rec, from, delta, mask, radius, skin);
        };
      }
      return { d, W, mem, step, rnd, riding, spot, edges, ceilings, steep, synth };
    };

    for (const [dtLabel, dt, sm, rides] of [['dt1', 1, false, 6], ['dt0.5', 0.5, false, 6], ['dt1 sync', 1, true, 14], ['dt0.5 sync', 0.5, true, 14]]) {
      if (process.env.ISL_SESSION && `skate ${dtLabel}` !== process.env.ISL_SESSION) continue;
      const S = session(`skate ${dtLabel}`, dt, +(process.env.ISL_SEED ?? 777), sm, rides);
      if (process.env.ISL_TRACE) {
        const T = +process.env.ISL_TRACE, col = S.W.col, op = col.probe.bind(col), ot = col.terrainHeight.bind(col), oc = S.d.O.world.col;
        const lg = (who, n, a, r) => { if (S.d.t >= T - 1 && S.d.t <= T) console.log(who, 't' + S.d.t, n, JSON.stringify(a), '->', JSON.stringify(r)); };
        col.probe = (rec, f, dl, m) => { const r = op(rec, f, dl, m); lg('port', 'probe', [f, dl, m], r && r.point); return r; };
        col.terrainHeight = (x, y, z, k) => { const r = ot(x, y, z, k); lg('port', 'terr', [x, y, z, k], r); return r; };
        const op2 = oc.probe.bind(oc), ot2 = oc.terrainHeight.bind(oc);
        oc.probe = (rec, f, dl, m) => { const r = op2(rec, f, dl, m); lg('orig', 'probe', [f, dl, m], r && r.point); return r; };
        oc.terrainHeight = (x, y, z, k) => { const r = ot2(x, y, z, k); lg('orig', 'terr', [x, y, z, k], r); return r; };
      }
      const { d, step, rnd, riding, spot, mem, edges, ceilings, steep, synth } = S;
      const sc = dt === 1 ? 1 : 2;
      for (let k = 0; k < 4 * sc; k++) step(0);
      for (let r = 0; r < rides * +(process.env.ISL_MULT ?? 1); r++) {
        // ride types: random spot / an edge ahead / under a ceiling / a stunt flown through the landing
        const kind = [3, 0, 1, 2][r % 4];      // the first ride of a session is the stunt ride: the trick flag DAT_05d58008 is 0 only until the first landing
        let p = spot(), yaw = (rnd() * 2 - 1) * Math.PI;
        if (kind === 1 && edges.length) { const e = edges[Math.floor(rnd() * edges.length)]; p = e; yaw = e[3] + (rnd() - 0.5) * 0.3; cover.edgeRides++; }
        if (kind === 2 && steep.length && r % 8 !== 6) { const e = steep[Math.floor(rnd() * steep.length)]; p = e; yaw = e[3]; cover.knockRides++; }
        else if (kind === 2) { const cc = ceilings[Math.floor(rnd() * ceilings.length)]; p = [cc[0] - Math.sin(cc[3]) * 12 * rnd(), cc[1], cc[2] - Math.cos(cc[3]) * 12 * rnd()]; yaw = cc[3] + (rnd() - 0.5) * 0.4; cover.ceilingRides++; }
        const synthRide = kind === 2 && steep.length && r % 8 !== 6;
        const stunt = kind === 3;
        d.placePepper(p[0], p[1], p[2], yaw);
        d.setState(0x1b);
        step(0);
        step(B.CTRL); step(0);                               // Ctrl: PepSwitc puts Pepper on the board (mode 4)
        if (riding()) cover.rides++;
        const g0 = randomKeys(rnd, POOL, 40 * sc);
        let tt = 0;
        const ground = () => (kind === 1 ? B.SPACE * 0 : stunt && tt < 40 * sc ? ([0x29, 0x2a, 0x2b].includes(mem.r8(d.onodeSkate() + 0x18)) ? (tt++, B.ALT) : 0) : stunt ? 0 : g0());       // edge rides roll straight on; stunt rides charge a jump first
        let hold = 0, cur = 0, wasAir = false;
        const keys = () => {
          const air = mem.r8(d.onodeSkate() + 0x18) === 0x20;
          if (air !== wasAir || hold-- <= 0) {
            wasAir = air;
            if (air && stunt) { cur = r === 0 ? (B.SHIFT | B.DOWN) : TRICKS[r % 13]; hold = 1e9; }
            else if (air) { cur = TRICKS[Math.floor(rnd() * TRICKS.length)]; hold = (4 + Math.floor(rnd() * 45)) * sc; } else { cur = ground(); hold = 0; }
          }
          return air ? cur : ground();
        };
        for (let t = 0; t < 700 * sc && riding(); t++) {
          const k = keys();
          // a scripted low ceiling for a few ticks (both worlds answer the pre-render's ceiling sweep, mask 1 / skin 0.2 / delta.y 1.2, with a hit against Pepper's forward): FUN_004928d2's knock-off on a slope
          synth.on = synthRide && t >= 70 * sc && t < 74 * sc;
          step(k);
          if (mem.r32(0x8ae088) === 0x37) cover.knocked++;
        }
        if (riding()) { step(B.CTRL); step(0); }          // Ctrl on the ground: PepSwitc puts Pepper off the board
        synth.on = false;
        if (!riding()) cover.dismounts++;
        for (let k = 0; k < 6 * sc; k++) step(0);
        // out of the mode: back to the idle walk state for the next ride (the walk node is a stub here)
      }
      if (d.grazes) { cover.grazes = (cover.grazes ?? 0) + d.grazes.length; notes.push(`${dtLabel}: ${d.grazes.length} divergence(s) re-synced (float32 original vs double port): ${d.grazes.map((g) => g.slice(0, 140)).join(' ; ')}`); }
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      void worstAll;
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
