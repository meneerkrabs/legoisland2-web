// WP-VERIFY M7 island vehicles: SGHeli (the police helicopter PHEL, the rescue helicopter RHEL). The original's node framework + SGHeli + PepSwitc + SGVehic run natively in the x86 emulation
// (tools/lib/m7-isl-veh-emu.mjs) next to the port's nodes (src/island/vehicles/heli.ts, pepswitch.ts) with the same scripted buttons; compared tick by tick: the records, the node fields, the rotor
// part matrices, all game variables, the vehicle globals, the camera, the sound calls (with frequencies).
import '../lib/m8-cdheap.mjs';   // (WP-SAVE: the original's heap is 0xCD-filled: never-written node bytes start as 0xCD)
import { Duel, B, lcg, randomKeys } from '../lib/m7-isl-veh-emu.mjs';
import { berthPos, vehicles } from '../../src/island/vehicles/common.ts';
import { partMatrix } from '../../src/island/trigger/parts.ts';
import { compareChainBlocks, cdPatchChain } from '../lib/m8-save-pepper.mjs';

const MAXFAIL = 30;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const POOL = [B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT | B.LEFT, B.UP, B.DOWN, B.UP | B.SPACE, B.DOWN | B.SPACE, B.DOWN | B.ALT, 0, 0, B.SPACE | B.UP | B.LEFT];

export default {
  name: 'm7-isl-veh-heli',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const blocks = {};      // WP-SAVE: save blocks of Pepper's chain compared (original serializer vs port saveBlock)
    const cover = { boarded: 0, landed: 0, ticks: 0, ctrlNoPad: 0, states: new Set(), sessions: 0, fast: 0 };
    const devs = new Map();
    const unhooked = new Map();

    const session = (label, dt, seed, syncMode) => {
      const d = new Duel(ctx, { keepKinds: ['SGHeli'], keepRecords: (n) => n === 'PHEL' || n === 'RHEL', dt, maxFail: MAXFAIL, failures, tolFree: 1e-4 });
      cdPatchChain(d);      // WP-SAVE: the bytes of PepSwitc / SGVehic the constructors leave at the debug heap's 0xCD
      d.label = label; cover.sessions++;
      d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const rnd = lcg(seed);
      const hel = ['PHEL', 'RHEL'].map(idx);
      // sync mode: the continuous state the original accumulates in float32 (record pose, velocities, rotor angles, pitch wobble, engine pitch, camera) is copied into the port before each tick
      d.syncPort = () => {
        for (const i of [...hel, d.P.pepper.index]) d.recToPort(i);
        d.cameraToPort();
        for (const i of hel) d.nodeToPort(d.pnode(i, 'SGHeli'), d.onode(i, 0x4325e8), { vx: [0x1c, 'f'], vy: [0x20, 'f'], vz: [0x24, 'f'], rotorMain: [0x2c, 'f'], rotorTail: [0x30, 'f'], wobble: [0x34, 'f'], engineHz: [0x38, 'f'] });
      };
      const compare = () => {
        for (const i of hel) d.rec(i);
        d.rec(d.P.pepper.index);
        d.globals(); d.vars(); d.camera(); d.sounds();
        compareChainBlocks(d, blocks);      // WP-SAVE: PepSwitc (spot, flags), SGVehic
        for (const i of hel) {
          const n = W.records[i].name, pn = d.pnode(i, 'SGHeli'), a = d.onode(i, 0x4325e8);
          d.eq(n + ' state', mem.r8(a + 0x18), pn.state);   // (a byte; the other three bytes of the dword are never written: heap fill)
          d.cmp(n + ' vx', mem.f32(a + 0x1c), pn.vx); d.cmp(n + ' vy', mem.f32(a + 0x20), pn.vy); d.cmp(n + ' vz', mem.f32(a + 0x24), pn.vz);
          if (d.t > 0) d.eq(n + ' pad', mem.r16(a + 0x28) << 16 >> 16, pn.pad);
          // the rotor angles are accumulated unwrapped (+0.8 / +0.75 per tick): in float32 the sum near angle a rounds by up to half an ulp (6e-8 * a) per tick in a fixed direction (0.8 is not a multiple of the ulp), so the
          // original's angle drifts from the port's double sum by at most 6e-8 * a per tick flown (n = a / step): the bound below. (The port could Math.fround the sums to match exactly; purely visual.)
          const bound = (a, stp) => (d.syncMode ? 2e-6 * (1 + Math.abs(a)) : 6e-8 * (Math.abs(a) / stp) * Math.abs(a) + 1e-5);
          d.cmp(n + ' rotorMain', mem.f32(a + 0x2c), pn.rotorMain, 0, '', bound(pn.rotorMain, 0.8)); d.cmp(n + ' rotorTail', mem.f32(a + 0x30), pn.rotorTail, 0, '', bound(pn.rotorTail, 0.75));
          d.cmp(n + ' wobble', mem.f32(a + 0x34), pn.wobble, 0, '', bound(pn.wobble, 0.02 * dt)); d.cmp(n + ' engineHz', mem.f32(a + 0x38), pn.engineHz);
          cover.states.add(pn.state);
          // the rotor parts (FUN_0043ea60: RHEL main 2 / tail 3, PHEL 3): the live matrices of the port's `partMatrix` against the buffer of the original
          const buf = d.emu.partBufs.get(i);
          for (const k of [2, 3]) {
            const pm = partMatrix(W, W.records[i], k);
            if (!pm) continue;
            for (let q = 0; q < 16; q++) d.cmp(n + ' part' + k, buf ? mem.f32(buf + 0x40 * k + 4 * q) : pm[q], pm[q], 0, `[${q}]`, bound(pn.rotorMain, 0.8) + bound(pn.rotorTail, 0.75) + (q >= 12 ? 1e-4 : 0));
          }
        }
        for (let k = 0; k < G.pads.length; k++) d.eq('pad taken', mem.r32(0x9daa50 + 4 * k) !== 0, G.pads[k].taken, ` ${k}`);
      };
      const step = (held) => { d.tick(held); cover.ticks++; compare(); };
      const idle = (n, held = 0) => { for (let i = 0; i < n; i++) step(held); };
      const tap = (bits = 0) => { step(bits | B.CTRL); step(bits); };
      const board = (n, offset = [5, 4]) => {
        const r = W.records[idx(n)];
        d.placePepper(r.x + offset[0], r.y, r.z + offset[1]);
        tap();
        if (d.getVar({ PHEL: 0x3e, RHEL: 0xbe }[n]) === 1) cover.boarded++;
      };
      return { d, W, mem, G, idx, rnd, step, idle, tap, board, compare };
    };

    for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
      const S = session(`heli ${dtLabel}`, dt, 777, sm);
      const { d, W, G, step, idle, tap, board, rnd, idx } = S;
      const scale = dt === 1 ? 1 : 2;
      idle(5 * scale);
      for (const n of ['RHEL', 'PHEL']) {
        board(n);
        const r = W.records[idx(n)];
        idle(60 * scale);                       // take-off: climbs by itself to 40 above the ground
        const keys = randomKeys(rnd, POOL, 20 * scale);
        for (let t = 0; t < 420 * scale; t++) { const k = keys(); step(k); if (k & (B.SPACE | B.ALT)) cover.fast++; }
        // Ctrl away from every pad: no free pad within 80 -> state 2 falls back to 1
        const farFromPads = G.pads.every((p) => Math.hypot(berthPos(p)[0] - r.x, berthPos(p)[2] - r.z) > 80);
        if (farFromPads) { tap(); cover.ctrlNoPad++; }
        // fly to the nearest free pad, then Ctrl: the heli lands by itself
        const free = G.pads.map((p, i) => [i, p]).filter(([, p]) => !p.taken);
        let best = free[0];
        for (const f of free) if (Math.hypot(berthPos(f[1])[0] - r.x, berthPos(f[1])[2] - r.z) < Math.hypot(berthPos(best[1])[0] - r.x, berthPos(best[1])[2] - r.z)) best = f;
        const target = berthPos(best[1]);
        const pn = d.pnode(idx(n), 'SGHeli');
        for (let t = 0; t < 900 * scale && pn.state === 1; t++) {
          const dx = target[0] - r.x, dz = target[2] - r.z, dist = Math.hypot(dx, dz);
          const ang = wrap(Math.atan2(dx, dz) - r.ry);
          let k = 0;
          if (ang > 0.1) k |= B.RIGHT; else if (ang < -0.1) k |= B.LEFT;
          if (Math.abs(ang) < 0.6 && dist > 60) k |= B.SPACE;
          if (dist <= 60 && Math.abs(ang) < 0.6) { step(k | B.CTRL); break; }
          step(k);
        }
        for (let t = 0; t < 600 * scale && pn.state === 2; t++) step(0);
        if (pn.state === 0) cover.landed++;
        idle(12 * scale);
      }
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify({ ...cover, states: [...cover.states] })}`);
    notes.push(`WP-SAVE save blocks of Pepper's chain compared (original serializer vs port saveBlock, tolerance 0): ${JSON.stringify(blocks)}`);
    return { checked, failures, notes };
  },
};
