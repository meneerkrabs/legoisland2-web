// WP-VERIFY M7 island vehicles: SGBoat (the speedboat SPBT, the dinghy DNGY, the jet ski JSKI). The ORIGINAL's node framework + SGBoat + PepSwitc + SGVehic run natively in the x86
// emulation (tools/lib/m7-isl-veh-emu.mjs) next to the port's nodes (src/island/vehicles/boat.ts, pepswitch.ts) with the same scripted buttons; compared tick by tick: the records, the
// node fields, the game variables (all 316), the vehicle globals, the camera, the sound calls (with frequencies), the wake records' draw state.
import { Duel, B, lcg, randomKeys } from '../lib/m7-isl-veh-emu.mjs';
import { berthPos, vehicles } from '../../src/island/vehicles/common.ts';

const MAXFAIL = 30;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const POOL = [B.SPACE, B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT | B.LEFT, B.ALT | B.RIGHT, 0, B.SPACE | B.ALT];

export default {
  name: 'm7-isl-veh-boat',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { boarded: 0, docked: 0, crashes: 0, ticks: 0, reversed: 0, ctrlNoDock: 0, cutsceneBlocked: 0, fast: 0, sessions: 0 };
    const bump = (k) => { cover[k]++; };
    const devs = new Map();
    const unhooked = new Map();

    /** one session: the three boats are driven in turn (board, random drive, back to the own dock, dock) with the given dt */
    const session = (label, dt, seed, syncMode) => {
      const d = new Duel(ctx, { keepKinds: ['SGBoat'], keepRecords: (n) => ['SPBT', 'DNGY', 'JSKI'].includes(n), dt, maxFail: MAXFAIL, failures, draw: true });
      d.label = label; cover.sessions++;
      d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const rnd = lcg(seed);
      const boatIdx = ['SPBT', 'DNGY', 'JSKI'].map(idx);
      const wakes = ['RIPB', 'RIPJ', 'RIPD', 'WAKR', 'WAKP', 'WAKS'].map(idx).filter((i) => i >= 0);
      // sync mode: the continuous state accumulated in float32 by the original (pose, speed, steer, engine pitch, wobble phase, camera) is copied into the port before each tick
      d.syncPort = () => {
        for (const i of [...boatIdx, d.P.pepper.index]) d.recToPort(i);
        d.cameraToPort();
        for (const i of boatIdx) d.nodeToPort(d.pnode(i, 'SGBoat'), d.onode(i, 0x430e6c), { speed: [0x3c, 'f'], wobble: [0x40, 'f'], engineHz: [0x44, 'f'], steer: [0x48, 'f'] });
      };
      const compare = () => {
        for (const i of boatIdx) d.rec(i);
        for (const i of wakes) d.rec(i, 0xfffc);
        d.rec(d.P.pepper.index);
        d.globals(); d.vars(); d.camera(); d.sounds();
        for (const i of boatIdx) {
          const n = W.records[i].name, pn = d.pnode(i, 'SGBoat'), a = d.onode(i, 0x430e6c);
          d.eq(n + ' state', mem.r8(a + 0x38), pn.state);
          if (d.t > 0) d.eq(n + ' dock', mem.r16(a + 0x3a) << 16 >> 16, pn.dock);
          d.cmp(n + ' speed', mem.f32(a + 0x3c), pn.speed); d.cmp(n + ' wobble', mem.f32(a + 0x40), pn.wobble); d.cmp(n + ' engineHz', mem.f32(a + 0x44), pn.engineHz);
          d.cmp(n + ' steer', mem.f32(a + 0x48), pn.steer); d.eq(n + ' fast', mem.r32(a + 0x58), pn.fast); d.cmp(n + ' plumeRate', mem.f32(a + 0x2c), pn.plumeRate);
          if (d.t > 0) d.cmp(n + ' half', mem.f32(a + 0x4c), pn.half);
        }
        for (let k = 0; k < G.docks.length; k++) d.eq('dock taken', mem.r32(0x9da9fc + 4 * k) !== 0, G.docks[k].taken, ` ${k}`);
        // what the draw pass of the original draws (the wake records: the draw hook shows them for the draw only) against the port's visible records
        const orig = new Set(d.emu.drawn.filter(([i, f]) => wakes.includes(i) && (f & 2)).map(([i]) => i));
        // the port: the ripple is an ordinary visible record, the wake records are drawn by the boat's hook (`drawSeq`: WAKR, WAKS before the boat, WAKP after it while fast)
        const seq = new Set(); for (const r of W.records) (r.ctrl?.nodes ?? []).forEach((n, k) => { if (n.drawSeq && r.ctrl.enabled && r.ctrl.ran[k]) { const q = n.drawSeq(W, r); for (const x of [...q.before, ...q.after]) seq.add(x.index); } });
        for (const i of wakes) d.eq(W.records[i].name + ' drawn', orig.has(i), ((W.records[i].flags & 2) !== 0 || seq.has(i)) && (W.records[i].flags & 0x8000) === 0);
      };
      const step = (held) => {
        d.tick(held); cover.ticks++;
        const gm = d.grazeBegin();
        compare();
        d.grazeEnd(gm);
        for (const l of d.olog) if (l === 'p2 #818') bump('crashes');
      };
      const idle = (n, held = 0) => { for (let i = 0; i < n; i++) step(held); };
      const tap = (bits = 0) => { step(bits | B.CTRL); step(bits); };
      const nodeOf = (n) => d.pnode(idx(n), 'SGBoat');
      const moveVar = (n) => ({ SPBT: 0x82, DNGY: 0x10, JSKI: 0xb2 })[n];
      const board = (n, offset = [5, 4]) => {
        const r = W.records[idx(n)];
        d.placePepper(r.x + offset[0], 8, r.z + offset[1]);
        const home = nodeOf(n).dock;
        tap();
        if (d.getVar(moveVar(n)) === 1) bump('boarded'); else if (process.env.ISL_DEBUG) console.log(label, n, 'did not board; current', S_.G.current?.name);
        return home;
      };
      const toDock = (n, dockIdx, maxTicks = 700) => {
        const r = W.records[idx(n)], pn = nodeOf(n);
        const target = berthPos(G.docks[dockIdx]);
        for (let t = 0; t < maxTicks && pn.state === 1; t++) {
          const dx = target[0] - r.x, dz = target[2] - r.z, dist = Math.hypot(dx, dz);
          const ang = wrap(Math.atan2(dx, dz) - r.ry);
          let k = 0;
          if (ang > 0.08) k |= B.RIGHT; else if (ang < -0.08) k |= B.LEFT;
          if (dist > 18 && Math.abs(ang) < 1.0) k |= B.SPACE;
          else if (dist > 18) k |= B.SPACE;           // turn on the spot is impossible: keep moving
          if (dist <= 18) { step(k | B.CTRL); break; }
          step(k);
        }
        // moored? (state 2 until it arrives)
        for (let t = 0; t < 120 && pn.state === 2; t++) step(0);
        if (pn.state === 0) bump('docked'); else if (process.env.ISL_DEBUG) console.log(label, n, 'did not dock; state', pn.state, 'pos', r.x.toFixed(0), r.z.toFixed(0), 'target', target.map(Math.round));
      };
      const S_ = { G };
      return { d, W, mem, G, idx, rnd, step, idle, tap, nodeOf, board, toDock, compare, wakes, boatIdx };
    };

    // ---- session 1 (dt = 1): every boat in turn: board, random drive (crashes into the shore, reverse), back to the own dock, moor
    for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
      const S = session(`boat ${dtLabel}`, dt, 12345, sm);
      const { d, step, idle, tap, board, toDock, rnd } = S;
      const scale = dt === 1 ? 1 : 2;           // the same course takes twice the ticks at dt = 0.5
      idle(6 * scale);
      for (const n of ['SPBT', 'JSKI', 'DNGY']) {
        const pn = S.nodeOf(n);
        // a cutscene blocks boarding: Ctrl does nothing
        d.cutscene(true); const r = S.W.records[S.idx(n)]; d.placePepper(r.x + 5, 8, r.z + 4); tap(); d.cutscene(false); bump('cutsceneBlocked');
        const home = board(n);
        idle(6 * scale);
        const keys = randomKeys(rnd, POOL, 16 * scale);
        for (let t = 0; t < 260 * scale; t++) { const k = keys(); step(k); if (k & B.ALT && pn.speed < 0) bump('reversed'); if (pn.fast) bump('fast'); }
        // Ctrl in open water: no free dock within 24: state 2 -> 1 again (counted)
        if (S.G.docks.every((dk) => Math.hypot(berthPos(dk)[0] - S.W.records[S.idx(n)].x, berthPos(dk)[2] - S.W.records[S.idx(n)].z) > 24)) { tap(); bump('ctrlNoDock'); }
        toDock(n, home, 700 * scale);
        idle(8 * scale);
      }
      if (d.grazes) { cover.grazes = (cover.grazes ?? 0) + d.grazes.length; notes.push(`${dtLabel}: ${d.grazes.length} grazing-sweep divergence(s) (float32 original vs double port, re-synced): ${d.grazes.map((g) => g.slice(0, 120)).join(' ; ')}`); }
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
