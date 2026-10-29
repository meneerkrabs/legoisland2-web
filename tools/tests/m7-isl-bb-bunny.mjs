import { bunnyDuel, compareBunnies, B, lcg } from '../lib/m7-isl-bb-bunny.mjs';

// WP-VERIFY M7b: the island's rabbits RBT0-4 (Bunny.c FUN_004b2149 / 004b18fb / 004b1ffb) against the original's code (tools/lib/m7-isl-bb-bunny.mjs on the ambient oracle): free hopping (dt 1 and 0.5), Pepper next to the
// rabbits with Shift (the startle, sound 0x103), all five startled at once (the extra score item), out of view (frozen after 101 ticks). Compared per tick: records, node blocks, animation clip / frame, variables, sounds, random draws.
export default {
  name: 'm7-isl-bb-bunny',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, shifts: 0, states: {}, frozen: 0, five: 0 };
    for (const [label, dt, sm, free] of [['dt1', 1, false, 900], ['dt0.5', 0.5, false, 900], ['dt1 sync', 1, true, 700]]) {
      const d = bunnyDuel(ctx, { dt, seed: 17, maxFail: 30, failures });
      d.label = `bunny ${label}`; d.syncMode = sm; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, sc = dt === 1 ? 1 : 2;
      d.syncPort = () => {
        for (const i of d.bunnies) {
          d.recToPort(i); const pn = d.pnode(i, 'Bunny'), a = d.onode(i, 0x4b2149);
          for (const [f, [off, ty]] of Object.entries({ state: [0x34, 'i'], saved: [0x38, 'i'], count: [0x3c, 'i'], off: [0x40, 'i'], burrow: [0x44, 'i'], bored: [0x48, 'i'] })) pn[f] = ty === 'f' ? mem.f32(a + off) : mem.r32(a + off);
          const oa = d.O.world.records[i].anim, pa = W.records[i].anim; if (oa && pa) { if (pa.clip !== oa.clip) pa.start(oa.clip, oa.frame); pa.frame = oa.frame; }
        }
      };
      const step = (held) => {
        for (const r of W.records) { const a = 0x10000000 + r.index * 0x68; const f = mem.r16(a + 0x60); mem.w16(a + 0x60, d.hidden.has(r.index) ? f & ~1 : f | 1); }
        d.tick(held); cover.ticks++;
        compareBunnies(d, cover);
      };
      const r0 = W.records[d.bunnies[0]];
      d.placePepper(0, 0, 0, 0);
      for (let t = 0; t < free; t++) step(0);
      // Pepper next to a rabbit: Shift (within 8 units) startles it (sound 0x103 at Pepper, clip 4, then back)
      const rnd = lcg(3);
      for (const i of d.bunnies.slice(0, 3)) {
        for (let round = 0; round < 2; round++) {
          const r = W.records[i];
          for (let t = 0; t < 12 * sc; t++) { d.placePepper(r.x + 2, r.y, r.z + 2, 0); step(0); }
          d.placePepper(r.x + 2, r.y, r.z + 2, 0); step(B.SHIFT); cover.shifts++; step(0);
          for (let t = 0; t < 40 * sc; t++) { d.placePepper(r.x + 2, r.y, r.z + 2, 0); step(rnd() < 0.05 ? B.SHIFT : 0); }
        }
      }
      // all five in a ring round Pepper (both worlds), one Shift: five pokes at once -> SWITCH_GME_LGI_EXTRA_SCOREITEMS bit 1, score + 1000
      const c0 = [r0.x, r0.y, r0.z];
      d.placePepper(c0[0], c0[1], c0[2], 0);
      d.bunnies.forEach((i, k) => {
        for (const r of [W.records[i], d.O.world.records[i]]) r.setEuler(r.rx, r.ry, r.rz, c0[0] + Math.sin(k * 1.2) * 3, c0[1], c0[2] + Math.cos(k * 1.2) * 3);
        d.emu.putRecord(i, d.O.world.records[i]);
      });
      d.emu.sync();
      for (let t = 0; t < 4; t++) step(0);
      step(B.SHIFT); cover.shifts++; cover.five++;
      for (let t = 0; t < 6; t++) step(0);
      // out of view: 101 ticks hidden and farther than 16 units: frozen; then back
      d.placePepper(0, 0, 0, 0);
      d.bunnies.slice(0, 3).forEach((i) => d.hidden.add(i));
      for (let t = 0; t < 130 * sc; t++) { step(0); if (d.pnode(d.bunnies[0], 'Bunny').off > 100) cover.frozen++; }
      d.hidden.clear();
      for (let t = 0; t < 120 * sc; t++) step(0);
      notes.push(`${d.label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}; extra score item ${d.getVar(0xbd) & 1}, score ${d.getVar(0xa6)}`);
      checked += d.checked;
      d.cleanup();
    }
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
