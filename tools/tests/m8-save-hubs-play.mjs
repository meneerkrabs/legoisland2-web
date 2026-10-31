// WP-SAVE, the hub nodes' save blocks AFTER GAMEPLAY and the load round trip (z14OSD: Tumblewd 0x629d7e, scorpion 0x62ad35 + grab node 0x62af8d, Gems 0x62b220, PEPPSW 0x62ba3b).
// The ORIGINAL's nodes run natively in the x86 emulation next to the port's (tools/lib/m5-z14OSD-duel.mjs `OsdDuel`, tolerance 0, scripted inputs / ground / random numbers); at many moments
// `compareBlocks` (tools/lib/m8-save.mjs) compares the original's serializer output (vtable +0x14, run natively) with the port's `saveBlock` for every node, and at some moments the
// loader round trip runs: the ORIGINAL's blocks of that moment are kept, the duel ticks on (the state changes), then `restoreBlocks` puts the kept blocks back into BOTH machines (the original's
// loader natively, the port's `loadBlock`), the blocks must be equal again and the duel must go on comparing equal for a few hundred more ticks.
// The emulation's allocator is made 0xCD-filling (tools/lib/m8-save-hubs.mjs `withCdAlloc`): bytes the constructors never write are 0xCD in the original's process (debug heap).
import { OsdDuel, B, stream } from '../lib/m5-z14OSD-duel.mjs';
import { compareBlocks, snapshotBlocks, restoreBlocks } from '../lib/m8-save.mjs';
import { withCdAlloc, eraDiff, ERA_VARS } from '../lib/m8-save-hubs.mjs';
import { looksOf } from '../../src/island/vehicles/looks.ts';
import { guarded } from '../lib/inject-guard.mjs';

const TUM = [104, 105, 106, 107, 108, 109, 111], SCR = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], GEM = [114, 115, 116, 117, 118, 119, 120, 121, 122, 123], PEP = 4, BOARD = 64;
const CT = { TUM: 0x629d7e, SCR: 0x62ad35, GRAB: 0x62af8d, GEM: 0x62b220, SW: 0x62ba3b };

const __test = {
  name: 'm8-save-hubs-play',
  run(ctx) {
    return withCdAlloc(() => {
      const failures = [], notes = [];
      let checked = 0, moments = 0, loads = 0;
      const MAX = 30;
      const make = (label, o = {}) => new OsdDuel(ctx, { failures, label, maxFail: MAX, ...o });
      /** the framework words and the node blocks: all of the duel's constructors, bit exact */
      const blocks = (d, what, only) => {
        const r = compareBlocks(d.P.world, d.emu, `${what} t${d.t}`, only);
        checked += r.checked; moments++;
        for (const f of r.failures) if (failures.length < 60) failures.push(f);
        return r;
      };
      /** the load round trip: keep the original's blocks now, run `n` ticks with `step`, put the blocks back in both machines, compare blocks, then run on `after` ticks comparing blocks every `every` */
      const roundTrip = (d, what, only, step, n, after, every, cmp, era = false) => {
        const snap = snapshotBlocks(d.emu, d.P.world, only);
        for (let k = 0; k < n; k++) step(k);
        if (era) for (const [v, x] of ERA_VARS) d.setVar(v, x);      // the era table the loader's FUN_00420674 rebuilds depends on these variables
        if (era) for (let k = 0; k < 8; k++) d.emu.cpu.mem.w32(0x9da590 + 4 * k, 3);   // a look change was running (DAT_009da590, the busy list): FUN_004202ef clears it
        if (era) { const lk = looksOf(d.P.world); if (lk) lk.busy.fill(0); }
        const n2 = restoreBlocks(d.P.world, d.emu, snap);
        loads += n2;
        if (era) {
          const e = eraDiff(d.emu, d.P.world); checked++; if (e) failures.push(`${what}: decor era table after the load: ${e}`);
          const bz = Array.from({ length: 8 }, (_, k) => d.emu.cpu.mem.r32(0x9da590 + 4 * k) | 0), lk = looksOf(d.P.world);
          checked++; if (bz.some((x) => x !== -1) || (lk && lk.busy.some((x) => x !== -1))) failures.push(`${what}: busy list after the load: original ${bz} port ${lk?.busy}`);
        }
        blocks(d, `${what} after load`, only);
        // (the loaded node memory is the file's: a second save gives the same bytes)
        const again = snapshotBlocks(d.emu, d.P.world, only);
        for (let i = 0; i < snap.length; i++) if (snap[i].bytes && Buffer.compare(Buffer.from(snap[i].bytes), Buffer.from(again[i].bytes)) !== 0) failures.push(`${what}: original block ${i} changed by its own load`);
        for (let k = 0; k < after; k++) { step(n + k); if (k % every === 0) blocks(d, `${what} run-on`, only); if (cmp) cmp(d); }
      };
      const flags = (d, ids) => { for (const i of ids) d.setFlags(i, d.rec(i).flags | 1); };

      // ============================================================ Tumblewd
      const bumpy = (x, z) => ((Math.floor(x / 40) + Math.floor(z / 40)) % 5 === 0 ? null : 20 + 6 * Math.sin(x / 17) + 4 * Math.cos(z / 13));
      for (const [label, dt, scr, ticks] of [['bumpy ground with holes', 1, bumpy, 700], ['no ground (fall, sink, rest, reset) dt 0.5', 0.5, () => null, 900]]) {
        const d = make(`tum ${label}`, { kinds: ['TUM'], dt, seed: 11 });
        d.script(scr); flags(d, TUM);
        const only = new Set([CT.TUM]);
        blocks(d, d.label, only);
        for (let t = 0; t < ticks; t++) { d.tick(0); if (t % 7 === 0) blocks(d, d.label, only); }
        roundTrip(d, `${d.label} load`, only, () => d.tick(0), 150, 400, 5);
        checked += d.checked;
      }

      // ============================================================ scorpions + the grab node
      for (const [label, dt, seed, ticks, flat] of [['dt 1 seed 1', 1, 1, 1500, true], ['dt 0.5 seed 3', 0.5, 3, 1500, false]]) {
        const d = make(`scorpion ${label}`, { kinds: ['SCR', 'GRAB'], dt, seed });
        d.script(flat ? () => 10 : (x, z) => 10 + 2 * Math.sin(x / 5) + Math.cos(z / 4));
        flags(d, SCR);
        const only = new Set([CT.SCR, CT.GRAB]);
        const rnd = stream(900 + seed);
        const step = (t) => {
          if (t % 12 === 0 && rnd() < 0.6) {
            const s = d.rec(SCR[Math.floor(rnd() * SCR.length)]);
            const r = rnd() < 0.5 ? 1 + rnd() * 3 : rnd() < 0.5 ? 3 + rnd() * 7 : 10 + rnd() * 30, ang = rnd() * 6.2831853;
            d.place(PEP, s.x + Math.sin(ang) * r, s.y + 0.3, s.z + Math.cos(ang) * r, rnd() * 6 - 3);
          }
          if (t % 150 === 149) { const s = d.rec(SCR[Math.floor(rnd() * SCR.length)]); d.place(s.index, s.x + (rnd() - 0.5) * 70, s.y, s.z + (rnd() - 0.5) * 70, s.ry, s.rx, s.rz); }
          d.tick(0);
        };
        blocks(d, d.label, only);
        for (let t = 0; t < ticks; t++) { step(t); if (t % 6 === 0) blocks(d, d.label, only); }
        roundTrip(d, `${d.label} load`, only, (k) => step(ticks + k), 200, 500, 5);
        checked += d.checked;
      }
      // a scripted attack: the scorpion bites, Pepper is grabbed (the grab node's block while the grab runs)
      {
        const d = make('scorpion attack', { kinds: ['SCR', 'GRAB'], seed: 5 });
        d.script(() => 10); flags(d, SCR);
        const only = new Set([CT.SCR, CT.GRAB]);
        const s = d.rec(8);
        d.place(8, s.x, s.y, s.z, 0); d.place(PEP, s.x, s.y, s.z + 5, 0);
        let grabbedAt = -1;
        const step = (t) => {
          d.tick(0);
          const n = d.pnode(8, 'SCR');
          if (n.state === 0x10 && t > 2) { const e = d.rec(8); d.place(PEP, e.x - Math.sin(e.ry) * 1.4, e.y, e.z - Math.cos(e.ry) * 1.4, 0); }
          if (grabbedAt < 0 && (d.getVar(0x5e) & 0x20)) grabbedAt = t;
        };
        for (let t = 0; t < 320; t++) { step(t); blocks(d, d.label, only); if (grabbedAt >= 0 && t === grabbedAt + 3) break; }
        if (grabbedAt < 0) failures.push('scorpion attack: Pepper was never grabbed');
        // load a block of the grabbed moment after the grab is over
        roundTrip(d, 'scorpion attack load', only, (k) => step(400 + k), 120, 120, 3);
        notes.push(`scorpion attack: grab at tick ${grabbedAt}`);
        checked += d.checked;
      }

      // ============================================================ Gems
      for (const [label, vars, dt] of [['nothing collected', {}, 1], ['gems 0, 2, 9 collected before', { 0x1d: 0x205 }, 1]]) {
        const d = make(`gems ${label}`, { kinds: ['GEM'], vars, dt, seed: 4 });
        const only = new Set([CT.GEM]);
        blocks(d, d.label, only);
        const picked = [];
        for (const [gi, i] of GEM.entries()) {
          const g = d.rec(i);
          d.place(PEP, g.x + 1.5, g.y, g.z, 0);
          d.tick(0); blocks(d, `${d.label} pick`, only);
          d.tick(0); blocks(d, `${d.label} pick`, only);
          // load the original's blocks of "the gem was just picked up" after Pepper left, the gem's countdown ran out, and put them back
          if (gi === 3 || gi === 6) {
            const snap = snapshotBlocks(d.emu, d.P.world, only);
            d.place(PEP, g.x + 100, g.y, g.z, 0);
            for (let t = 0; t < 6; t++) { d.tick(0); blocks(d, `${d.label} count`, only); }
            loads += restoreBlocks(d.P.world, d.emu, snap);
            blocks(d, `${d.label} after load`, only);
            for (let t = 0; t < 6; t++) { d.tick(0); blocks(d, `${d.label} run-on`, only); d.compareRecord(i); d.eq('gem state', d.emu.cpu.mem.r32(d.onode(i, 'GEM') + 0x1c), d.pnode(i, 'GEM').state); }
          } else {
            d.place(PEP, g.x + 100, g.y, g.z, 0);
            for (let t = 0; t < 6; t++) { d.tick(0); blocks(d, d.label, only); }
          }
          picked.push(d.pnode(i, 'GEM').state);
        }
        checked += d.checked;
      }

      // ============================================================ PEPPSW
      for (const [label, dt, seed, sea, ticks] of [['sea 0', 1, 21, 0, 1800], ['sea 5 dt 0.5', 0.5, 23, 5, 2200]]) {
        const d = make(`peppsw ${label}`, { kinds: ['SW'], dt, seed });
        d.setSea(sea);
        d.script((x, z) => (x < 0 ? 2 : Math.abs(z - 50) < 20 ? 6 : 12));
        d.setFlags(BOARD, d.rec(BOARD).flags & ~2);
        const only = new Set([CT.SW]);
        const rnd = stream(31 + seed);
        const modes = [1, 1, 1, 2, 4], states = [27, 1, 2, 0x57, 0x1f, 0x20, 0x21, 0x32, 5], clips = [27, 99, 0x62, 0x24, 0x3f, 0x40, 0x25, 1, 3];
        let held = 0;
        const step = () => {
          if (d.t % 5 === 0 && rnd() < 0.5) {
            const mode = modes[Math.floor(rnd() * modes.length)] | (rnd() < 0.3 ? 0x1000 : 0);
            d.setVar(0x5e, mode); d.setMailbox(states[Math.floor(rnd() * states.length)]); d.setClip(PEP, clips[Math.floor(rnd() * clips.length)], 0);
            const px = (rnd() - 0.5) * 80, pz = 20 + rnd() * 70, hy = rnd() < 0.5 ? sea - 1 + rnd() * 2 : sea + 2 + rnd() * 6;
            d.place(PEP, px, hy, pz, rnd() * 6.2 - 3.1);
            held = rnd() < 0.4 ? B.CTRL : rnd() < 0.2 ? B.UP : 0;
          }
          d.tick(held);
          if (held & B.CTRL) held = rnd() < 0.5 ? 0 : held;
        };
        blocks(d, d.label, only);
        for (let t = 0; t < ticks; t++) { step(); if (t % 3 === 0) blocks(d, d.label, only); }
        roundTrip(d, `${d.label} load`, only, () => step(), 100, 400, 3, null, true);
        checked += d.checked;
      }
      notes.push(`z14OSD: ${moments} comparison moments, ${loads} node loads`);
      return { checked, failures, notes };
    });
  },
};
export default guarded(__test);
