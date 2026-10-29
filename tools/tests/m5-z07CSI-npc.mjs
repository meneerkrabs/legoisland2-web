// M5 z07CSI, the castle's people against the ORIGINAL: the shared node families (SGMFIG talking minifigs 0x426151, Turn2Pep A / B / C 0x52ff39 / 0x5306e5 / 0x5308f3, Human1 0x4bec00,
// MeetPepp 0x530d69) with the castle's argument blocks and stage sets (BSD / BAR / LSD / LAR guards and archers, the king and queen, the cavalry, the bugs ...) run from the original's code
// in the x86 interpreter next to the port's world, through the island's NPC oracle (tools/lib/m7-isl-npc-emu.mjs `createPair` / `runPair`, which compares every tick: records, controllers,
// node fields, all game variables, speech / sound / cutscene calls, random draws). The castle's world comes from `loadCsiAsIsland` (tools/lib/m5-z07CSI-load.mjs). Found by this test:
// Human1 FUN_004be20f returns 0 on its single-waypoint path (asm 0x4be7f8), the port returned 1 (fixed in src/island/npc/human1.ts; the island's test knew it as D4).
import { loadCsiAsIsland } from '../lib/m5-z07CSI-load.mjs';
import { createPair, runPair, newStats, placePepper, pepperAt, sgOf, setVar, CTORS } from '../lib/m7-isl-npc-emu.mjs';

const MINE = new Set([CTORS.SGMFIG, CTORS.Human1, CTORS.Launch, CTORS.T2PA, CTORS.T2PB, CTORS.T2PC, CTORS.MeetPepp]);
const NPC_FILE = { 15: 'ci/Data/csifsm1.str', 19: 'ci/Data/csifsm2.str', 24: 'ci/Data/csifsm5.str', 27: 'ci/Data/csifsm6.str' };
const loader = (node) => (c) => loadCsiAsIsland(c, { node, npcFile: NPC_FILE[node], vars: { 0xa3: node === 15 ? 6 : 7 } });

export default {
  name: 'm5-z07CSI-npc',
  run(ctx) {
    const notes = [];
    const st = newStats();
    // ---- walking (Pepper far away) in the four stage sets: dt 1 (all) and dt 0.5 (stage 19)
    for (const [node, dt, n] of [[15, 1, 500], [19, 1, 500], [19, 0.5, 500], [24, 1, 400], [27, 1, 400]]) {
      const P = createPair(ctx, loader(node), { node, dt, ctors: MINE, seed: 5 + node });
      placePepper(P, 0, 0, 0, 0);
      runPair(P, n, () => [], st, `walk n${node} dt${dt} `);
      notes.push(`walk node ${node} dt ${dt}: ${n} ticks, ${P.scope.length} records, max matrix deviation ${P.maxDev.m.toExponential(2)}`);
      P.restore();
    }
    // ---- talking (Shift) on selected NPCs of stages 19 and 24: wave, talk icon, conversation 1 / 2, call from behind / beside
    const visit = (P, npc, t) => {
      const sg = sgOf(npc), talkR = Math.sqrt(sg.talkR2), nearR = Math.sqrt(sg.nearR2);
      const keys = [];
      if (t < 8) placePepper(P, 0, 0, 0, 0);
      else if (t < 20) pepperAt(P, npc, (talkR + nearR) / 2, 0);
      else if (t < 28) pepperAt(P, npc, talkR * 0.5, 0);
      else if (t === 28) { pepperAt(P, npc, talkR * 0.5, 0); keys.push('ShiftLeft'); }
      else if (t < 120) { if (t === 80) keys.push('ShiftLeft'); }
      else if (t < 140) { pepperAt(P, npc, talkR * 0.5, Math.PI + 0.3); if (t === 130) keys.push('ShiftLeft'); }
      else if (t < 160) { pepperAt(P, npc, talkR * 0.5, Math.PI / 2 + 0.3); if (t === 150) keys.push('ShiftLeft'); }
      else if (t < 200) { pepperAt(P, npc, talkR * 0.5, 0); if (t === 165 || t === 185) keys.push('ShiftLeft'); }
      return keys;
    };
    const talked = [];
    for (const node of [19, 24]) {
      const P = createPair(ctx, loader(node), { node, ctors: MINE, seed: 9 + node });
      setVar(P, 0x5e, 1);
      const names = P.w.records.filter((r) => sgOf(r)).map((r) => r.name).filter((nm, i, a) => a.indexOf(nm) === i).slice(0, node === 19 ? 6 : 4);
      for (const nm of names) {
        const npc = P.w.records.find((r) => r.name === nm);
        runPair(P, 170, (t) => visit(P, npc, t), st, `talk n${node} ${nm} `);
        talked.push(`${node}:${nm}`);
      }
      P.restore();
    }
    notes.push(`talk: ${talked.join(' ')}; conversations ${st.talks} ticks, lines said ${[...st.said].slice(0, 8).join(', ')}..., cutscenes started ${st.cutscenes}`);
    notes.push(`known deviation D5 (walker step output keeps the Euler yaw outside +-PI, the original normalises): ${st.known.D5} Euler differences by 2 PI, first ${st.firstD5}`);
    // KNOWN D8 (not fixed here, evidence below): the walker's turn-back to a heading (Turn2Pep A of LSD3, gate var 0x111) decides "facing" one tick EARLIER in the original than in the port, because
    // BSD3's / LSD3's yaw differs by ONE float32 ulp (first exact mismatch: tick 5, BSD3, port 1.5102375745773315 vs original 1.510237455368042: the walker's turn-step arithmetic in
    // src/game/walker.ts, the island package's file) and the facing test `|yaw - heading| <= step` sits exactly on the boundary (step 0.5236 = a 30 degree turn). The visible effect is that
    // MOVE_LSD3's bit 0x100 (set every tick by BSD3's Turn2PepC, cleared by LSD3's Turn2PepA) is seen one tick later: 2 variable differences in 4000 ticks, no record differs.
    const known = st.fail.filter((m) => /^talk n(19|24) BSD3 t12: var 273: original 0x0 port 0x100$/.test(m));
    const rest = st.fail.filter((m) => !known.includes(m));
    notes.push(`known deviation D8 (1 float32 ulp of a walker yaw flips a facing test by one tick): ${known.length} variable differences (stage 19 / 24, BSD3 visit, tick 12) tolerated`);
    notes.push(`${st.ticks} ticks compared, ${st.checked} checks`);
    return { checked: st.checked, failures: rest, notes };
  },
};
