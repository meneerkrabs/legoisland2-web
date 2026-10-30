// WP-VERIFY M7 island vehicles: SGCar (the ambulance AMBU, the speedsters SPD0 / SPD1 / SPD2, the police car PCAR) with PepSwitc's "leave the car" (FUN_0088e030 finds the free spot) and SGVehic's seat.
// The original's node framework + SGCar + PepSwitc + SGVehic run natively in the x86 emulation (tools/lib/m7-isl-veh-emu.mjs) next to the port's nodes (src/island/vehicles/car.ts, pepswitch.ts) with the
// same scripted buttons; compared tick by tick: the records, the node fields, all game variables (the car's MOVE var bits), the vehicle globals, the camera, the sound calls.
import '../lib/m8-cdheap.mjs';   // (WP-SAVE: the original's heap is 0xCD-filled: never-written node bytes start as 0xCD)
import { Duel, B, lcg, randomKeys } from '../lib/m7-isl-veh-emu.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { compareChainBlocks, cdPatchChain } from '../lib/m8-save-pepper.mjs';

const MAXFAIL = 30;
const CARS = ['AMBU', 'SPD0', 'SPD1', 'SPD2', 'PCAR'];
const POOL = [B.SPACE, B.SPACE, B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT | B.LEFT, B.ALT | B.RIGHT, 0, B.SPACE | B.UP, B.SPACE | B.DOWN];

export default {
  name: 'm7-isl-veh-car',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const blocks = {};      // WP-SAVE: save blocks of Pepper's chain compared (original serializer vs port saveBlock)
    const cover = { boarded: 0, left: 0, ticks: 0, crashes: 0, reversed: 0, sessions: 0 };
    const devs = new Map();
    const unhooked = new Map();

    const session = (label, dt, seed, syncMode) => {
      const d = new Duel(ctx, { keepKinds: ['SGCar'], keepRecords: (n) => CARS.includes(n), dt, maxFail: MAXFAIL, failures, exact: true });
      cdPatchChain(d);      // WP-SAVE: the bytes of PepSwitc / SGVehic the constructors leave at the debug heap's 0xCD
      d.label = label; cover.sessions++;
      d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const rnd = lcg(seed);
      const cars = CARS.map(idx);
      const NODE = { crash: [0x2c, 'f'], speed: [0x34, 'f'], vx: [0x48, 'f'], vy: [0x4c, 'f'], vz: [0x50, 'f'] };
      d.syncPort = () => {
        for (const i of [...cars, d.P.pepper.index]) d.recToPort(i);
        d.cameraToPort();
        for (const i of cars) d.nodeToPort(d.pnode(i, 'SGCar'), d.onode(i, 0x88fb35), NODE);
      };
      const compare = () => {
        for (const i of cars) d.rec(i);
        d.rec(d.P.pepper.index);
        d.globals(); d.vars(); d.camera(); d.sounds();
        compareChainBlocks(d, blocks);      // WP-SAVE: PepSwitc (spot, flags), SGVehic
        for (const i of cars) {
          const n = W.records[i].name, pn = d.pnode(i, 'SGCar'), a = d.onode(i, 0x88fb35);
          d.eq(n + ' reset', mem.r8(a + 0x1a), pn.reset);
          d.eq(n + ' rampX', mem.r32(a + 0x1c), pn.rampX); d.eq(n + ' rampY', mem.r32(a + 0x20), pn.rampY);
          d.eq(n + ' steer', mem.r32(a + 0x24), pn.steer); d.eq(n + ' stickY', mem.r32(a + 0x28), pn.stickY);
          d.cmp(n + ' crash', mem.f32(a + 0x2c), pn.crash); d.cmp(n + ' speed', mem.f32(a + 0x34), pn.speed);
          d.cmp(n + ' vx', mem.f32(a + 0x48), pn.vx); d.cmp(n + ' vy', mem.f32(a + 0x4c), pn.vy); d.cmp(n + ' vz', mem.f32(a + 0x50), pn.vz);
        }
      };
      const step = (held) => {
        d.tick(held); cover.ticks++;
        if (process.env.ISL_TRACE && d.t >= +process.env.ISL_TRACE - 6 && d.t <= +process.env.ISL_TRACE) {
          for (const i of cars) { const a = d.onode(i, 0x88fb35), pn = d.pnode(i, 'SGCar'); if (mem.r32(a + 0x1c) !== 16 || pn.speed !== 0) console.log(d.t, W.records[i].name, 'held', held, 'orig speed', mem.f32(a + 0x34), 'crash', mem.f32(a + 0x2c), 'v', mem.f32(a + 0x48), mem.f32(a + 0x50), '| port', pn.speed, pn.crash, pn.vx, pn.vz, 'ry', mem.f32(0x10000000 + i * 0x68 + 0x50), W.records[i].ry); }
        }
        compare();
      };
      const idle = (n, held = 0) => { for (let i = 0; i < n; i++) step(held); };
      const tap = (bits = 0) => { step(bits | B.CTRL); step(bits); };
      const MOVE = { AMBU: 0xa7, SPD0: 0x80, SPD1: 0xa4, SPD2: 0x7f, PCAR: 0x60 };
      const board = (n, off = [4, 3]) => {
        const r = W.records[idx(n)];
        d.placePepper(r.x + off[0], r.y + 1, r.z + off[1]);
        tap();
        if ((d.getVar(MOVE[n]) & 0x10000000) !== 0) cover.boarded++;
      };
      const drive = (n, ticks) => {
        const keys = randomKeys(rnd, POOL, 18 * (dt === 1 ? 1 : 2)), pn = d.pnode(idx(n), 'SGCar');
        for (let t = 0; t < ticks; t++) { const k = keys(); step(k); if (pn.crash > 0) cover.crashes++; if (pn.speed < 0) cover.reversed++; }
      };
      // look for a wall: turn a bit, then full speed straight ahead, until the car bounces (crash timer) and has spun out
      const bumper = (n) => {
        const pn = d.pnode(idx(n), 'SGCar'), sc = dt === 1 ? 1 : 2;
        for (let attempt = 0; attempt < 7; attempt++) {
          for (let t = 0; t < 30 * sc; t++) step(B.SPACE | (attempt % 2 ? B.LEFT : B.RIGHT));
          for (let t = 0; t < 140 * sc; t++) { step(B.SPACE); if (pn.crash > 0) { cover.crashes++; for (let u = 0; u < 30 * sc; u++) step(u % 7 < 4 ? B.SPACE : 0); return; } }
        }
      };
      const leave = (n) => { const before = W.pep.mailbox; tap(); if ((d.getVar(MOVE[n]) & 0x10000000) === 0 && before !== 0) cover.left++; };
      return { d, W, idx, rnd, step, idle, tap, board, drive, leave, bumper };
    };

    for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
      if (process.env.ISL_SESSION && `car ${dtLabel}` !== process.env.ISL_SESSION) continue;
      const S = session(`car ${dtLabel}`, dt, 4242, sm);
      const { d, idle, board, drive, leave, bumper } = S;
      const scale = dt === 1 ? 1 : 2;
      idle(4 * scale);
      // free-running sessions are short: after a few thousand ticks float noise moves a car across a polygon edge of the terrain probes (a different tilt): chaos, not logic; the long sessions run in sync mode
      for (const n of sm ? CARS : dt === 1 ? ['AMBU', 'SPD0'] : ['AMBU']) {
        board(n);
        drive(n, 260 * scale);
        leave(n);
        idle(6 * scale);
        board(n);
        drive(n, 60 * scale);
        bumper(n);
        leave(n);
        idle(4 * scale);
      }
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    notes.push(`WP-SAVE save blocks of Pepper's chain compared (original serializer vs port saveBlock, tolerance 0): ${JSON.stringify(blocks)}`);
    return { checked, failures, notes };
  },
};
