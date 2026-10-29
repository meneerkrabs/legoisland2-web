import { loadIsland } from '../lib/island-load.mjs';
import { createPair, runPair, newStats, placePepper, pepperAt, sgOf, setVar, setObjective, CTORS, hex } from '../lib/m7-isl-npc-emu.mjs';

// WP-VERIFY M7: the island's NPC nodes (SGMFIG 0x426151, Human1 0x4bec00 / 0x4bf329, Turn2Pep A / B / C, MeetPepp) against the ORIGINAL code in the x86 emulation (tools/lib/m7-isl-npc-emu.mjs):
// the original's constructors, node passes (FUN_0042226e / 00427233 / 004225c5 / 0042271b), SGGen interaction code, walker, animation and collision functions run natively next to
// the port's world; every tick the records (matrix, Euler, flags, animation clip / frame), controllers (flags, ran bits, distance, probe result), node fields, all 319 game variables,
// the NPC globals, camera, speech / sound / cutscene calls and random draws are compared bit for bit (tolerance 0) at 24-bit x87 precision. This file: free walking at dt 1 and 0.5, the talk scenarios.
const MINE = new Set([CTORS.SGMFIG, CTORS.Human1, CTORS.Launch, CTORS.T2PA, CTORS.T2PB, CTORS.T2PC, CTORS.MeetPepp]);

export default {
  name: 'm7-isl-npc-emu',
  run(ctx) {
    const notes = [];
    const st = newStats();
    const evidence = [];

    // ---- walking (Pepper far away): dt = 1 and dt = 0.5
    for (const dt of [1, 0.5]) {
      const P = createPair(ctx, loadIsland, { node: 2, dt, ctors: MINE, seed: 5 });
      placePepper(P, 0, 0, 0, 0);
      const n = dt === 1 ? 500 : 500;
      runPair(P, n, () => [], st, `walk dt${dt} `);
      notes.push(`walk dt ${dt}: ${n} ticks, ${P.scope.length} records, max matrix deviation ${P.maxDev.m.toExponential(2)}`);
      P.restore();
    }

    // ---- talking (Shift) on selected NPCs: wave, talk icon, conversation 1 / 2, cutscene customers, call from behind / beside
    const visit = (P, npc, t, T) => {
      const sg = sgOf(npc), talkR = Math.sqrt(sg.talkR2), nearR = Math.sqrt(sg.nearR2);
      const keys = [];
      if (t < 8) placePepper(P, 0, 0, 0, 0);
      else if (t < 20) pepperAt(P, npc, (talkR + nearR) / 2, 0);
      else if (t < 28) pepperAt(P, npc, talkR * 0.5, 0);
      else if (t === 28) { pepperAt(P, npc, talkR * 0.5, 0); keys.push('ShiftLeft'); }
      else if (t < 120) { /* the conversation runs */ if (t === 80) keys.push('ShiftLeft'); }
      else if (t < 140) { pepperAt(P, npc, talkR * 0.5, Math.PI); if (t === 130) keys.push('ShiftLeft'); }
      else if (t < 160) { pepperAt(P, npc, talkR * 0.5, Math.PI / 2); if (t === 150) keys.push('ShiftLeft'); }
      else if (t < 200) { pepperAt(P, npc, talkR * 0.5, 0); if (t === 165 || t === 185) keys.push('ShiftLeft'); }
      return keys;
    };
    const names = ['INFO', 'PAPA', 'NICK', 'NANC', 'SUPE', 'NUBB', 'BBT1', 'PETE'];
    const P = createPair(ctx, loadIsland, { node: 2, ctors: MINE, seed: 9 });
    setVar(P, 0x5e, 1); setVar(P, 9, 1);
    for (const nm of names) {
      const npc = P.w.records.find((r) => r.name === nm);
      runPair(P, 170, (t) => visit(P, npc, t), st, `talk ${nm} `);
    }
    notes.push(`talk: ${names.join(' ')}; conversations ${st.talks} ticks, lines said ${[...st.said].slice(0, 8).join(', ')}..., cutscenes started ${st.cutscenes}, state-word bit sets seen ${st.states.size}`);
    P.restore();

    notes.push(`${st.ticks} ticks compared, ${st.checked} checks`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
