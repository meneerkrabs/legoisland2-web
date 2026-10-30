// WP-VERIFY M7 island gameplay nodes (fork B): SupaStat.c train: TRNL / TRNT / TRNC (FUN_0053d66c ctor, FUN_0053c6eb update, FUN_0053d2ad pre-render, FUN_0053c565 platform beside). The original's node framework + the train
// node + the WAYPOINT WALKER (FUN_00462d4f / 004626d0 / 00461c24 / 00461e69 / 00461f42 / 004621c7 / 004623f0: native, on the compiled ROAD map the original's set-up loaded) run in the x86 emulation next to the port's
// nodes (src/island/pizza/train.ts + src/game/walker.ts) with the same scripted Pepper (position, buttons). Compared tick by tick: the three car records (matrix, Euler, flags), every node field (route index, stop timer, phase,
// ride flags, seat, curve roll, sound state), the shared speed factor / look side / boarded globals, Pepper's record and clip, the camera, all game variables (icons 0x0c, PEPPER_CONTROL 0x5e), the vehicle globals, the sound calls.
import { B, lcg, randomKeys } from '../lib/m7-isl-veh-emu.mjs';
import { trainDuel } from '../lib/m7-isl-veh-train.mjs';
import { platformBeside } from '../../src/island/pizza/train.ts';
import { waypoints } from '../../src/game/walker.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';

const MAXFAIL = 30;
const CARS = ['TRNL', 'TRNT', 'TRNC'];
const POOL = [B.SPACE, B.SPACE, B.UP, B.UP | B.LEFT, B.SPACE | B.RIGHT, B.DOWN, B.ALT, B.ALT | B.LEFT, B.LEFT, B.RIGHT, B.SHIFT, B.SHIFT | B.SPACE, 0, 0, B.UP | B.SHIFT];

export default {
  name: 'm7-isl-veh-train',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, stations: 0, whistles: 0, boarded: 0, left: 0, rideTicks: 0, braked: 0, lookSwitch: 0, bells: 0, fast: 0, ctrlOff: 0 };
    const devs = new Map(), unhooked = new Map();

    const session = (label, dt, syncMode) => {
      const d = trainDuel(ctx, { node: 2, keepKinds: ['train', 'SupaStat'], keepRecords: (n) => CARS.includes(n), dt, maxFail: MAXFAIL, failures, tolFree: 1e-4, pepSwitc: false, seat: false, draw: false });
      d.label = label; cover.sessions++; d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem;
      startPizzaNodes(W);      // the shell calls it after setupZone: the walkers of the three cars are created (in record order) before the first tick, like the original's constructors at attach time
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const cars = CARS.map(idx);
      const pep = d.P.pepper.index;
      const NODE = { stopTicks: [0x20, 'f'], roll: [0x38, 'f'], seatX: [0x2c, 'f'] };
      void NODE;
      // sync mode: the continuous state (poses, roll, seat, factor, stop timer, camera) of the original is copied into the port before every tick
      d.syncPort = () => {
        for (const i of [...cars, pep]) d.recToPort(i);
        d.cameraToPort();
        const g = W.ext.get('train');
        if (g) g.factor = mem.f32(0x5d586e4);
        for (const i of cars) {
          const n = d.pnode(i, 'train'), a = d.onode(i, 0x53d66c);
          n.stopTicks = mem.f32(a + 0x20); n.roll = mem.f32(a + 0x38); n.seat = [mem.f32(a + 0x2c), mem.f32(a + 0x30), mem.f32(a + 0x34)];
          if (d.resyncNext) {
            // after a float32 knife-edge flip (train-float32-edge): the discrete state of the original too (ride flags, phase, route, walker pause)
            n.riding = mem.r8(a + 0x28) !== 0; n.moving = mem.r8(a + 0x29) !== 0; n.coasting = mem.r8(a + 0x3c) !== 0; n.phase = mem.r8(a + 0x3d); n.routeIdx = mem.r32(a + 0x1c); n.lastCode = mem.r32(a + 0x24) | 0;
            const h = W.records[i].ctrl.walker;
            if (mem.f32(a + 0x20) > 0 || (n.riding && !n.moving)) waypoints.pause(h); else waypoints.resume(h);
          }
        }
      };
      // free-running: the shared speed factor DAT_05d586e4 (float32 steps of +-0.05 per tick) must stay bit-identical to the original's (no re-sync from the original)
      d.syncFree = () => {
        const g = W.ext.get('train'); if (!g) return;
        const f = mem.f32(0x5d586e4), dr = Math.abs(f - g.factor);
        cover.maxFactorDrift = Math.max(cover.maxFactorDrift ?? 0, dr);
        if (dr !== 0) d.fail(`${d.label} t${d.t} speed factor drift ${dr}: original ${f} port ${g.factor}`);
      };
      const compare = () => {
        for (const i of cars) d.rec(i);
        d.rec(pep); d.globals(); d.vars(); d.camera(); d.sounds();
        const g = W.ext.get('train') ?? { factor: NaN, lookRight: false, boarded: false };
        d.cmp('factor DAT_05d586e4', mem.f32(0x5d586e4), g.factor, undefined, '', 1e-6);
        d.eq('lookRight DAT_05d586f0', mem.r32(0x5d586f0) !== 0, g.lookRight); d.eq('boarded DAT_05d586ec', mem.r32(0x5d586ec) !== 0, g.boarded);
        d.eq('surfaceAtFeet DAT_009da9ac', mem.r32(0x9da9ac) | 0, W.pep.surfaceAtFeet | 0);
        d.eq('pepper clip', d.O.pepper.anim.clip, d.P.pepper.anim.clip);
        for (const i of cars) {
          const n = W.records[i].name, pn = d.pnode(i, 'train'), a = d.onode(i, 0x53d66c);
          d.eq(n + ' route', mem.r32(a + 0x1c), pn.routeIdx); d.cmp(n + ' stopTicks', mem.f32(a + 0x20), pn.stopTicks, undefined, '', 1e-5); d.eq(n + ' lastCode', mem.r32(a + 0x24) | 0, pn.lastCode);
          d.eq(n + ' riding', mem.r8(a + 0x28) !== 0, pn.riding); d.eq(n + ' moving', mem.r8(a + 0x29) !== 0, pn.moving);
          for (let k = 0; k < 3; k++) d.cmp(n + ' seat', mem.f32(a + 0x2c + 4 * k), pn.seat[k], undefined, `[${k}]`, 1e-5);
          d.cmp(n + ' roll', mem.f32(a + 0x38), pn.roll, undefined, '', 1e-5);
          d.eq(n + ' coasting', mem.r8(a + 0x3c) !== 0, pn.coasting); d.eq(n + ' phase', mem.r8(a + 0x3d), pn.phase);
        }
      };
      const L = cars[0];
      const pl = () => d.pnode(L, 'train');
      let lastPhase = 0, lastRiding = false, lastLook = false;
      const step = (held = 0) => {
        const gm = d.grazeBegin();
        d.tick(held); cover.ticks++;
        if (process.env.TRAIN_TRACE && d.label === process.env.TRAIN_LABEL && d.t >= +process.env.TRAIN_TRACE - 4 && d.t <= +process.env.TRAIN_TRACE + 3) {
          const g = W.ext.get('train'), nl = pl();
          console.log(d.t, 'held', held, 'orig factor', mem.f32(0x5d586e4), 'phase', mem.r8(d.onode(L, 0x53d66c) + 0x3d), 'riding', mem.r8(d.onode(L, 0x53d66c) + 0x28), 'moving', mem.r8(d.onode(L, 0x53d66c) + 0x29), 'coast', mem.r8(d.onode(L, 0x53d66c) + 0x3c), 'sx', mem.f32(d.onode(L, 0x53d66c) + 0x2c), 'lastCode', mem.r32(d.onode(L, 0x53d66c) + 0x24) | 0,
            '| port factor', g.factor, 'phase', nl.phase, 'riding', nl.riding, 'moving', nl.moving, 'coast', nl.coasting, 'sx', nl.seat[0], 'lastCode', nl.lastCode);
          for (const i of cars) { const a = 0x10000000 + i * 0x68, r = W.records[i]; console.log('   ', r.name, 'orig', mem.f32(a + 0x3c).toFixed(4), mem.f32(a + 0x44).toFixed(4), mem.f32(a + 0x50).toFixed(5), 'port', r.x.toFixed(4), r.z.toFixed(4), r.ry.toFixed(5)); }
          console.log('    olog', d.olog.filter((l) => /^p|^s|^r/.test(l)).join(' | '), '|| port', d.psnd.join(' | '));
        }
        compare();
        { const sm = d.syncMode; d.syncMode = false; d.grazeEnd(gm); d.syncMode = sm; }      // (the knife-edge flips happen in the sync sessions too)
        const n = pl();
        { const lr = W.ext.get('train').lookRight; if (lr !== lastLook) { if (d.t > 1) cover.lookSwitch++; lastLook = lr; } }
        if (n.phase === 2 && lastPhase !== 2 && !n.riding) cover.stations++;
        if (n.riding && !lastRiding) cover.boarded++;
        if (!n.riding && lastRiding) cover.left++;
        if (n.riding) { cover.rideTicks++; if (W.ext.get('train').factor > 1.5) cover.fast++; }
        if (held & B.SHIFT && n.riding) cover.bells++;
        for (const l of d.olog) if (l.startsWith('p3 #252')) cover.whistles++;
        lastPhase = n.phase; lastRiding = n.riding;
      };
      return { d, W, mem, cars, pep, step, L, pl };
    };

    const sc = (dt) => (dt === 1 ? 1 : 2);
    for (const [lab, dt, sm, seed] of [['dt1', 1, false, 5], ['dt0.5', 0.5, false, 6], ['dt1 sync', 1, true, 7], ['dt0.5 sync', 0.5, true, 8]]) {
      const S = session(`train ${lab}`, dt, sm);
      const { d, W, step, pl, L } = S;
      const rnd = lcg(seed), k = sc(dt);
      d.placePepper(-300, 30, -300, 0);          // far from the line: the free-running train
      for (let t = 0; t < 1000 * k; t++) step(0);  // first station stop (the line passes PFM0 at about t 700)
      // ride 1: when the locomotive stands at PFM0 (stop timer running) Pepper steps onto the platform beside it and presses Ctrl
      const rideAtStation = (rideTicks, label) => {
        // wait for the stop at a station (the locomotive's stop timer running, not riding)
        let guard = 0;
        while (!(pl().stopTicks > 0 && !pl().riding) && guard++ < 5000 * k) step(0);
        if (guard >= 5000 * k) { failures.push(`${label}: no station stop reached`); return; }
        const r = W.records[L], spot = [0, 0, 0];
        if (!platformBeside(W, r, spot)) { failures.push(`${label}: no platform beside the stopped locomotive`); return; }
        d.placePepper(spot[0], spot[1] + 0.2, spot[2], 0);
        step(0); step(B.CTRL); step(0);
        // drive: random throttle / looking / bell for a while
        const keys = randomKeys(rnd, POOL, 40 * k);
        for (let t = 0; t < rideTicks * k; t++) { step(keys()); if (!pl().riding) break; }
        // aim for the next platform: full throttle until a platform is beside the locomotive, then Ctrl there (braking first in half of the rides)
        let t2 = 0, left = false;
        while (pl().riding && t2++ < 4000 * k) {
          const near = platformBeside(W, r, [0, 0, 0]);
          if (near) { if (rnd() < 0.5) { for (let u = 0; u < 30 * k; u++) step(B.DOWN); cover.braked++; } step(B.CTRL); left = true; break; }
          step(B.SPACE | (rnd() < 0.05 ? B.LEFT : 0));
        }
        void left;
        for (let t = 0; t < 40 * k; t++) step(0);
      };
      rideAtStation(sm ? 350 : 500, `train ${lab} ride 1`);
      // keep running free for another stretch (the stop after leaving, the follower cars, the whistle) then ride again with different inputs
      for (let t = 0; t < 400 * k; t++) step(0);
      rideAtStation(sm ? 200 : 300, `train ${lab} ride 2`);
      for (let t = 0; t < 300 * k; t++) step(0);
      // Ctrl on the platform while Pepper is far from the locomotive (the range test) and while a cutscene-less walk state: nothing happens
      d.placePepper(-300, 30, -300, 0); step(B.CTRL); step(0); cover.ctrlOff++;
      notes.push(`${lab}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${n} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, c] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + c);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
