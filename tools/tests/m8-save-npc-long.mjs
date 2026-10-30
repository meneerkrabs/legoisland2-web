import { createBB, runBB, newStats, placePepper, pepperAt, setVar, botRecords, botNodes, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-SAVE (NPC families): directed duel scenarios that drive the node fields the general NPC / bot scenarios of m7-isl-npc-*.mjs / m7-isl-bb-*.mjs do not reach (the node blocks of the original and
// the port are compared tick by tick by the NPC oracle of tools/lib/m7-isl-npc-emu.mjs, tolerance 0; tests/m8-save-npc.mjs adds the block compare and the load rounds on top of every scenario):
//   hide / follow  era 1, 1500 ticks with Pepper circling the hiding bots: the hide states 1 / 2 / 3 (peek, run to the new ring node, round the old one), the relocation timer, the circle step's scratch
//                  vector, the follower's gag states (leader clip restart: tap, spin), the leader changes
//   push           era 0: Pepper pressed against an NPC (distance 0.3 .. 1.2) pressing Shift: the conversation start pushes the NPC back (SGMFIG +0x37 / +0x3c)
//   pending        era 0: a conversation started while the speech channel is busy (the lines wait: SGMFIG +0x5c / +0x60 hold their speech ids), subtitles on: the subtitle is written at once. Also with the
//                  speech setting (var 9) off: nothing waits (the saved ids are -1 / -1), the conversation runs on its timer
//   kids           era 0: the kids XXX0..2 jump (Launch node: MOVE & 4) and its gate combinations
//   scenes         era 0: the Turn2Pep B scenes (loops, idle time, turning back) of 4 NPCs with every combination of their gate bits for 160 ticks
//   pconly         era 1: BBT5 (botPConly) ordered to run (MOVE & 2) for 2400 ticks
export default {
  name: 'm8-save-npc-long',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    const cadence = (n) => { globalThis.__m8SnapEvery = n; };      // the observer of tests/m8-save-npc.mjs: ticks between load rounds (a load puts the timers back: the long runs get few)
    // ---- hide / follow
    cadence(397);
    {
      const P = createBB(ctx, { node: 7, dt: 1, seed: 5, pizza: false }), c = newCov();
      const bots = botRecords(P), hide = bots.filter((r) => botNodes(r).hide);
      setVar(P, 0x5e, 1);
      runBB(P, 1500, (t) => { covTick(P, c); const h = hide[Math.floor(t / 400) % hide.length]; if (h) pepperAt(P, h, 12, t * 0.01); return []; }, st, 'hide ');
      notes.push(`hide/follow 1500 ticks: ${showCov(c)}`); mergeCov(cov, c);
      P.restore();
    }
    cadence(undefined);
    // ---- push: Pepper pressed against the NPC, Shift
    {
      const P = createBB(ctx, { node: 2, dt: 1, seed: 9, pizza: false });
      setVar(P, 0x5e, 1); setVar(P, 9, 1);
      for (const nm of ['PAPA', 'NANC', 'NICK', 'SUPE', 'RICH']) {
        const npc = P.w.records.find((r) => r.name === nm);
        for (const d of [0.3, 0.8, 1.2]) {
          runBB(P, 110, (t) => { if (t < 12) { placePepper(P, 0, 0, 0, 0); return []; } if (t < 40) { pepperAt(P, npc, d, 0); return t === 30 ? ['ShiftLeft'] : []; } if (t === 80) return ['ShiftLeft']; return []; }, st, `push ${nm} d${d} `);
        }
      }
      notes.push(`push: 5 NPCs x 3 distances`);
      P.restore();
    }
    // ---- pending lines: the speech channel is busy (both hosts) when the conversation starts
    {
      const P = createBB(ctx, { node: 2, dt: 1, seed: 13, pizza: false });
      setVar(P, 0x5e, 1);
      // subtitles on (var 0): the subtitle is written at the conversation start although the voice waits (FUN_004254a5: FUN_0045d47f(text) if var 0 != 0, FUN_00435a11 only when the channel is idle),
      // the voice that starts later writes none, the conversation's end clears the lines (the oracle compares the texts and whether the lines hold one, every tick)
      setVar(P, 0, 1);
      for (const speech of [1, 0]) {
        setVar(P, 9, speech);
        for (const nm of ['PAPA', 'NANC', 'NICK', 'SUPE', 'INFO', 'LICK']) {
          const npc = P.w.records.find((r) => r.name === nm);
          runBB(P, 150, (t) => {
            if (t < 12) { placePepper(P, 0, 0, 0, 0); return []; }
            if (t === 20) { P.E.say.left = 45; P.ic.sayLeft = 45; }
            if (t < 40) { pepperAt(P, npc, 1.5, 0); return t === 28 ? ['ShiftLeft'] : []; }
            return t === 100 ? ['ShiftLeft'] : [];
          }, st, `pending speech${speech} ${nm} `);
        }
      }
      notes.push('pending: 6 NPCs, speech on / off');
      P.restore();
    }
    // ---- the kids' jump and the Turn2Pep B scenes: every combination of the gate bits
    {
      const P = createBB(ctx, { node: 2, dt: 1, seed: 21, pizza: false });
      setVar(P, 0x5e, 1); setVar(P, 9, 1);
      placePepper(P, 0, 0, 0, 0);
      let combos = 0;
      for (const nm of ['XXX0', 'XXX1', 'XXX2']) {
        const npc = P.w.records.find((r) => r.name === nm), v = npc.ctrl.nodes[0].var;
        for (const m of [4, 6, 0x104, 2, 0x84, 0x20004, 0]) { combos++; runBB(P, 170, (t) => { if (t === 0) setVar(P, v, m); return []; }, st, `kid ${nm}=${m.toString(16)} `); }
      }
      for (const nm of ['PAPA', 'NICK', 'INFO', 'VALS']) {
        const npc = P.w.records.find((r) => r.name === nm), v = npc.ctrl.nodes[0].var;
        const bits = [...new Set(npc.ctrl.nodes.flatMap((n) => [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800].filter((b) => (n.mask & b) !== 0)))];
        const masks = new Set([0]);
        for (let k = 1; k < 1 << Math.min(bits.length, 4); k++) masks.add(bits.slice(0, 4).reduce((a, b, i) => (k & (1 << i) ? a | b : a), 0));
        for (const m of masks) { combos++; runBB(P, 160, (t) => { if (t === 0) setVar(P, v, m); if (t === 1) placePepper(P, 0, 0, 0, 0); return []; }, st, `scene ${nm}=${m.toString(16)} `); }
      }
      // the scenes run to the end: 150 loops of the first clip, then the idle loop with the extra clip after 30 idle ticks (Turn2Pep B's idle timer)
      for (const nm of ['NICK', 'TBOB', 'LICK']) {
        const npc = P.w.records.find((r) => r.name === nm), b = npc.ctrl.nodes.find((n) => n.kind === 'Turn2PepB'), v = b.var;
        combos++; runBB(P, 900, (t) => { if (t === 0) setVar(P, v, b.value); if (t === 1) placePepper(P, 0, 0, 0, 0); return []; }, st, `scene-long ${nm} `);
        setVar(P, v, 0);
      }
      notes.push(`kids / scenes: ${combos} state words`);
      P.restore();
    }
    // ---- botPConly
    cadence(601);
    {
      const P = createBB(ctx, { node: 7, dt: 1, seed: 61, pizza: false }), c = newCov();
      const bot = P.w.records.find((r) => r.name === 'BBT5'), v = bot.ctrl.nodes[0].var;
      placePepper(P, 0, 0, 0, 0);
      runBB(P, 2400, (t) => { covTick(P, c); if (t === 0 || t === 1200) setVar(P, v, 2); return []; }, st, 'pconly ');
      notes.push(`pconly 2400 ticks: ${showCov(c)}`); mergeCov(cov, c);
      P.restore();
    }
    cadence(undefined);
    notes.push(`${st.ticks} ticks, ${st.checked} checks`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
