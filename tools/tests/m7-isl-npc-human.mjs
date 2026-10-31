import { loadIsland } from '../lib/island-load.mjs';
import { createPair, runPair, newStats, placePepper, pepperAt, setVar, CTORS } from '../lib/m7-isl-npc-emu.mjs';
import { guarded } from '../lib/inject-guard.mjs';

// WP-VERIFY M7: Human1 routes / Turn2Pep A / B / MeetPepp / launch against the original (see m7-isl-npc-emu.mjs): Pepper in the way of walking NPCs (stop, wait, resume), and the
// state words of the NPCs set to combinations of the bits the set-up's node gates test (starts the Turn2Pep B 150-loop scenes, MeetPepp, the other Human1 routes, the kids' jump).
const MINE = new Set([CTORS.SGMFIG, CTORS.Human1, CTORS.Launch, CTORS.T2PA, CTORS.T2PB, CTORS.T2PC, CTORS.MeetPepp]);

const __test = {
  name: 'm7-isl-npc-human',
  run(ctx) {
    const notes = [], st = newStats(), s2 = newStats();
    let checked = 0;
    for (const dt of [1, 0.5]) {
      const sc = dt === 1 ? 1 : 2;     // ticks per original time unit: every scenario spans the same game time at dt 0.5
      let P = createPair(ctx, loadIsland, { node: 2, dt, ctors: MINE, seed: 21 });
      setVar(P, 0x5e, 1); setVar(P, 9, 1);
      const hum = P.w.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'Human1' && n.args.count !== 1)).slice(0, 8);
      for (const npc of hum) {
        runPair(P, 70 * sc, (t) => { const i = Math.floor(t / sc); if (i < 10) placePepper(P, 0, 0, 0, 0); else if (i < 40) pepperAt(P, npc, 1.5, 0); else if (i < 55) pepperAt(P, npc, 1.5, 0.5); else pepperAt(P, npc, 25, 0); }, st, `dt${dt} chase ${npc.name} `);
      }
      notes.push(`dt${dt}: Pepper in front of ${hum.map((r) => r.name).join(' ')}: ${st.ticks} ticks`);
      P.restore();

      // state-word fuzz: for a set of NPCs every bit combination of their node gates (single bits, pairs, all), 40 ticks each
      P = createPair(ctx, loadIsland, { node: 2, dt, ctors: MINE, seed: 33 });
      placePepper(P, 0, 0, 0, 0);
      const who = ['NANC', 'NUBB', 'VALS', 'STEV', 'XXX1', 'DJAB'];
      let combos = 0;
      for (const nm of who) {
        const npc = P.w.records.find((r) => r.name === nm);
        const bits = [...new Set(npc.ctrl.nodes.flatMap((n) => [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80].filter((b) => (n.mask & b) !== 0)))];
        const masks = [0, ...bits, bits.reduce((a, b) => a | b, 0)];
        for (let i = 0; i + 1 < bits.length; i++) masks.push(bits[i] | bits[i + 1]);
        const v = npc.ctrl.nodes[0].var;
        for (const m of masks.slice(0, 5)) {
          combos++;
          runPair(P, 40 * sc, (t) => { if (t === 0) setVar(P, v, m); return []; }, s2, `dt${dt} fuzz ${nm}=${m.toString(16)} `);
        }
      }
      notes.push(`dt${dt}: gate fuzz: ${combos} state words on ${who.join(' ')}, ${s2.ticks} ticks`);
      P.restore();
    }
    return { checked: st.checked + s2.checked, failures: [...st.fail, ...s2.fail], notes };
  },
};
export default guarded(__test);
