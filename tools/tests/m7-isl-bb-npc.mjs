import { createBB, runBB, newStats, placePepper, pepperAt, setVar, sgOf, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: the NPC chains of the eras 1 / 2 (story nodes 7 / 30) that the era 0 tests skipped: Pepper standing in the way of walking NPCs (Human1 stop / wait / resume, FUN_004be20f), and the state words of NPCs set to
// the combinations of the bits their node gates test (Turn2Pep A / B / C scenes, MeetPepp, the other Human1 routes, the kids' jump), against the original's code (the NPC oracle of tools/lib/m7-isl-npc-emu.mjs).
export default {
  name: 'm7-isl-bb-npc',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const [node, dt] of [[7, 1], [30, 1], [7, 0.5], [30, 0.5]]) {
      const P = createBB(ctx, { node, dt, seed: 300 + node });
      const w = P.w, sc = dt === 1 ? 1 : 2, c = newCov();
      setVar(P, 0x5e, 1); setVar(P, 9, 1);
      const hum = w.records.filter((r) => !/^BB/.test(r.name) && r.ctrl?.nodes.some((n) => n.kind === 'Human1' && n.args.count !== 1)).slice(0, dt === 1 ? 3 : 2);
      for (const npc of hum) {
        runBB(P, 60 * sc, (i) => { covTick(P, c); const u = Math.floor(i / sc); if (u < 8) placePepper(P, 0, 0, 0, 0); else if (u < 40) pepperAt(P, npc, 1.5, 0); else if (u < 50) pepperAt(P, npc, 1.5, 0.5); else pepperAt(P, npc, 25, 0); return []; }, st, `e${node} dt${dt} chase ${npc.name} `);
      }
      if (dt === 1) {
        placePepper(P, 0, 0, 0, 0);
        const who = w.records.filter((r) => !/^BB/.test(r.name) && r.ctrl?.nodes.length >= 4 && sgOf(r)).slice(node === 7 ? 0 : 2, node === 7 ? 3 : 5);
        let combos = 0;
        for (const npc of who) {
          const bits = [...new Set(npc.ctrl.nodes.flatMap((n) => [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80].filter((b) => (n.mask & b) !== 0)))];
          const masks = [0, ...bits, bits.reduce((a, b) => a | b, 0)];
          for (let i = 0; i + 1 < bits.length; i++) masks.push(bits[i] | bits[i + 1]);
          const v = npc.ctrl.nodes[0].var;
          for (const m of masks.slice(0, 3)) { combos++; runBB(P, 36, (t) => { covTick(P, c); if (t === 0) setVar(P, v, m); return []; }, st, `e${node} fuzz ${npc.name}=${m.toString(16)} `); }
        }
        notes.push(`node ${node}: gate fuzz ${combos} state words on ${who.map((r) => r.name).join(' ')}`);
      }
      notes.push(`node ${node} dt ${dt}: Pepper in front of ${hum.map((r) => r.name).join(' ')}`);
      mergeCov(cov, c);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
