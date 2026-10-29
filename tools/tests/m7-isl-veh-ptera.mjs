// WP-VERIFY M7 island vehicles: Ptera.c (the pterodactyl PTER, the hang glider GLDR; eras 3 / 4) with PepSwitc's boarding. The original's node framework + Ptera (ctor FUN_004bb1a6, update FUN_004b93b0, pre-render
// FUN_004baf1b) + PepSwitc run natively in the x86 emulation next to the port's nodes (src/island/vehicles/ptera.ts, pepswitch.ts) with the same scripted buttons; compared tick by tick: the records, the node
// fields, the animation clip / frame, all game variables, the vehicle globals (pads taken), the camera, the sound calls. See tools/lib/m7-isl-veh-supe.mjs (pteraSession).
import { pteraSession, B, RECORDS_BASE, REC, lcg } from '../lib/m7-isl-veh-supe.mjs';
import { vehicles, berthPos } from '../../src/island/vehicles/common.ts';

const MAXFAIL = 30;
const POOL = [B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT | B.LEFT, B.UP, B.DOWN, B.UP | B.SPACE, B.DOWN | B.SPACE, B.DOWN | B.ALT, 0, 0, B.SPACE | B.UP | B.LEFT, B.DOWN | B.RIGHT];
const randomKeys = (rnd, pool, maxHold) => { let cur = 0, left = 0; return () => { if (left-- <= 0) { cur = pool[Math.floor(rnd() * pool.length)]; left = 2 + Math.floor(rnd() * (maxHold - 1)); } return cur; }; };

export default {
  name: 'm7-isl-veh-ptera',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, boarded: 0, landed: 0, bounces: 0, ceiling: 0, seaBounce: 0, states: new Set(), clip4: 0, wing: 0, clips: new Set() };
    const devs = new Map(), unhooked = new Map();
    const need = (c, m) => { checked++; if (!c) failures.push('coverage: ' + m); };

    const session = (label, dt, sync, seed, node = 52) => {
      const d = pteraSession(ctx, { label, dt, syncMode: sync, seed, node, failures, maxFail: MAXFAIL });
      cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const PN = { yawRate: [0x1c, 'f'], pitchRate: [0x24, 'f'], bounceT: [0x28, 'f'], speed: [0x38, 'f'], ground: [0x40, 'f'], prop: [0x7c, 'f'] };
      const names = ['PTER', 'GLDR'];
      d.syncPort = () => {
        for (const nm of names) { const i = d.vehicle[nm], pn = d.pnode(i, 'Ptera'); d.recToPort(i); if (pn) { d.nodeToPort(pn, d.onode(i, 0x4bb1a6), PN); const a = d.onode(i, 0x4bb1a6); pn.bounce = [0, 1, 2].map((k) => mem.f32(a + 0x2c + 4 * k)); } }
        d.recToPort(d.O.pepper.index); d.cameraToPort();
        if (d.resyncNext && !d.syncMode) {
          // after a float-noise divergence (a frame boundary crossed one tick apart, the world wrap, ...): the discrete state that hangs on it comes from the original too
          for (const nm of names) { const i = d.vehicle[nm], pn = d.pnode(i, 'Ptera'), a = d.onode(i, 0x4bb1a6), ao = d.O.world.records[i].anim, ap = W.records[i].anim;
            pn.wing = mem.r32(a + 0x84); pn.state = mem.r8(a + 0x23) << 24 >> 24; pn.bouncing = mem.r8(a + 0x22) !== 0; pn.yawDir = mem.r8(a + 0x20); pn.pitchDir = mem.r8(a + 0x21);
            if (ao && ap) { ap.clip = ao.clip; ap.frame = ao.frame; } }
          const po = d.O.pepper.anim, pp = d.P.pepper.anim; pp.clip = po.clip; pp.frame = po.frame;
        }
      };
      const compare = () => {
        d.rec(d.P.pepper.index);
        for (const nm of names) {
          const i = d.vehicle[nm], pn = d.pnode(i, 'Ptera'), a = d.onode(i, 0x4bb1a6);
          d.rec(i);
          d.eq(nm + ' state', mem.r8(a + 0x23) << 24 >> 24, pn.state); cover.states.add(pn.state);
          d.cmp(nm + ' yawRate', mem.f32(a + 0x1c), pn.yawRate); d.eq(nm + ' yawDir', mem.r8(a + 0x20), pn.yawDir); d.eq(nm + ' pitchDir', mem.r8(a + 0x21), pn.pitchDir);
          d.eq(nm + ' bouncing', mem.r8(a + 0x22) !== 0, pn.bouncing); d.cmp(nm + ' pitchRate', mem.f32(a + 0x24), pn.pitchRate); d.cmp(nm + ' bounceT', mem.f32(a + 0x28), pn.bounceT);
          if (pn.bouncing) for (let k = 0; k < 3; k++) d.cmp(nm + ' bounce', mem.f32(a + 0x2c + 4 * k), pn.bounce[k], undefined, `[${k}]`, 1e-5);
          d.cmp(nm + ' speed', mem.f32(a + 0x38), pn.speed); d.cmp(nm + ' ground', mem.f32(a + 0x40), pn.ground, undefined, '', 1e-4);
          d.eq(nm + ' pad', mem.r16(a + 0x78) << 16 >> 16, pn.pad);
          if (nm === 'GLDR') d.cmp(nm + ' prop', mem.f32(a + 0x7c), pn.prop, undefined, '', 1e-5);
          else d.eq(nm + ' wing', mem.r32(a + 0x84), pn.wing);
          const ao = d.O.world.records[i].anim, ap = W.records[i].anim;
          if (ao && ao.clip === 4) cover.clip4++;
          if (ao && nm === 'PTER') cover.clips.add(ao.clip);
          if (ao && ap) { d.eq(nm + ' clip', ao.clip, ap.clip); d.cmp(nm + ' frame', ao.frame, ap.frame, 0, '', 1e-4); }
        }
        { const po = d.O.pepper.anim, pp = d.P.pepper.anim; d.eq('PEPP clip', po.clip, pp.clip); d.cmp('PEPP frame', po.frame, pp.frame, 0, '', 1e-4); }
        d.globals(); d.vars(); d.camera(); d.sounds();
        for (let k = 0; k < G.pads.length; k++) d.eq('pad taken', mem.r32(0x9daa50 + 4 * k) !== 0, G.pads[k].taken, ` ${k}`);
      };
      const step = (held = 0) => { d.tick(held); cover.ticks++; const gm = d.grazeBegin(); compare(); d.grazeEnd(gm); for (const l of d.olog) if (/^p2 #(771|770)$/.test(l)) cover.wing++; };
      const run = (n, held = 0) => { for (let t = 0; t < n; t++) step(held); };
      const finish = () => {
        d.restore();
        if (d.grazes) notes.push(`${label}: ${d.grazes.length} float-noise divergence(s) re-synced: ${d.grazes.slice(0, 3).map((g) => g.slice(0, 110)).join(' ; ')}`);
        notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
        checked += d.checked;
        for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
        for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      };
      return { d, W, mem, G, step, run, finish, compare };
    };

    for (const [label, dt, sync] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
      const S = session(`ptera ${label}`, dt, sync, 31337);
      const { d, W, mem, G, step, run } = S;
      const sc = dt === 1 ? 1 : 2;
      const rnd = lcg(777);
      run(5 * sc);
      for (const name of ['PTER', 'GLDR']) {
        const i = d.vehicle[name], r = W.records[i], pn = d.pnode(i, 'Ptera');
        // Pepper stands beside the parked vehicle: Ctrl chooses it (state 3 -> the pre-render boards: state -1, PEPPER_CONTROL 0x40)
        d.placePepper(r.x + 6, r.y, r.z + 4);
        d.setState(0x1b, false);
        run(2 * sc);
        step(B.CTRL); step(0);
        if (d.getVar(0x5e) === 0x40) cover.boarded++;
        run(70 * sc);                                   // the take-off climbs 0.25 per tick to 18 above the ground
        // free flight with random keys
        const keys = randomKeys(rnd, POOL, 22 * sc);
        for (let t = 0; t < 700 * sc; t++) { step(keys()); if (pn.bouncing) cover.bounces++; if (r.y >= 183.9) cover.ceiling++; }
        // the ceiling: hold the nose up (Up pitches the nose down in the original's frame: both signs are tried)
        for (const key of [B.UP, B.DOWN]) { for (let t = 0; t < 260 * sc; t++) step(key | B.SPACE); }
        // low over the sea: dive towards the water
        d.putVehicle(name, 150, 40, 700, 0, 0.3);
        for (let t = 0; t < 200 * sc; t++) { step(B.UP | B.SPACE); if (r.y <= W.seaLevel + 2.5) cover.seaBounce++; }
        // landing: above a free pad (within 32), Ctrl
        const free = G.pads.map((p, k) => [k, p]).filter(([, p]) => !p.taken);
        for (const [k, p] of free.slice(0, 2)) {
          const q = berthPos(p);
          d.putVehicle(name, q[0] + 10, q[1] + 30, q[2] - 6, 1.0);
          run(3 * sc);
          step(B.CTRL); step(0);
          for (let t = 0; t < 120 * sc && pn.state !== 3; t++) step(0);
          if (pn.state === 3) cover.landed++;
          run(10 * sc);
          // Pepper is on the exit node; board again (frees the pad)
          d.placePepper(r.x + 5, r.y, r.z + 3);
          step(B.CTRL); step(0); run(40 * sc);
          void k;
        }
        // a cutscene while parked / flying: the pre-render does nothing
        d.cutscene(true); run(20 * sc); d.cutscene(false);
        // Ctrl far from any pad while flying: nothing; then park it with a landing for the next vehicle
        const q = berthPos(G.pads.find((p) => !p.taken) ?? G.pads[0]);
        d.putVehicle(name, q[0] - 8, q[1] + 25, q[2] + 8, 2.0);
        run(3 * sc); step(B.CTRL); step(0);
        for (let t = 0; t < 120 * sc && pn.state !== 3; t++) step(0);
        run(20 * sc);
      }
      S.finish();
    }
    need(cover.boarded >= 8, `boarded ${cover.boarded}`); need(cover.landed >= 8, `landed ${cover.landed}`);
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify({ ...cover, states: [...cover.states].sort((a, b) => a - b), clips: [...cover.clips] })}`);
    return { checked, failures, notes };
  },
};
