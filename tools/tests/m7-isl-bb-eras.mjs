import { createBB, runBB, newStats, placePepper, pepperAt, setVar, sgOf, chaseScript, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: the NPC families (SGMFIG, Human1, Turn2Pep A / B / C, MeetPepp, launch) and the bots of the eras 1-4 (story nodes 7 / 30 / 52 / 61) that the NPC test (era 0, node 2) skipped, against the original's code (the same
// oracle: tools/lib/m7-isl-npc-emu.mjs + m7-isl-bb-emu.mjs): the era's own rosters and attach lists (the original's argument blocks), walking, Pepper chasing the bots, Shift conversations with some NPCs (wave, talk icon,
// conversation), the era 3 bots' wave gag (Pepper in front, node > 0x33) and the era 3 / 4 rule that pizzas no longer hit (FUN_00429556 = 0 from node 0x34), a pizza thrown at a bot there.
export default {
  name: 'm7-isl-bb-eras',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const [node, dt] of [[30, 1], [52, 1], [61, 1]]) {
      const P = createBB(ctx, { node, dt, seed: 200 + node, pizza: node >= 52 });
      const w = P.w, sc = dt === 1 ? 1 : 2, c = newCov();
      setVar(P, 0x5e, 1); setVar(P, 9, 1);
      const bots = w.records.filter((r) => /^BB[TRGBY]\d$/.test(r.name) && r.ctrl?.nodes.some((n) => n.kind === 'BotHit')).map((r) => r.name);
      const npcs = w.records.filter((r) => r !== P.pep && /^[A-Z]{4}$/.test(r.name) && !/^BB|^PIZ|^PEPP/.test(r.name) && sgOf(r) && sgOf(r).talkR2 > 0).slice(0, 12);
      const talk = [npcs[1], npcs[5]].filter(Boolean);
      const chase = bots.length ? chaseScript(P, bots.slice(0, 5), 40, 20) : () => { placePepper(P, 0, 0, 0, 0); return []; };
      const n1 = Math.round((bots.length ? 110 : 50) * sc);
      runBB(P, n1, (t) => { covTick(P, c); return chase(t); }, st, `e${node} dt${dt} walk `);
      for (const npc of talk) {
        const sg = sgOf(npc), talkR = Math.sqrt(sg.talkR2), nearR = Math.sqrt(sg.nearR2);
        runBB(P, 70 * sc, (t) => {
          covTick(P, c);
          const keys = [], u = Math.floor(t / sc);
          if (u < 8) placePepper(P, 0, 0, 0, 0);
          else if (u < 20) pepperAt(P, npc, (talkR + nearR) / 2, 0);
          else if (u < 28) pepperAt(P, npc, talkR * 0.5, 0);
          else if (u === 28 && t % sc === 0) { pepperAt(P, npc, talkR * 0.5, 0); keys.push('ShiftLeft'); }
          else if (u === 50 && t % sc === 0) keys.push('ShiftLeft');
          return keys;
        }, st, `e${node} dt${dt} talk ${npc.name} `);
      }
      // era 3: a bot with Pepper in front (SGMFIG 0x200 -> the surprise gag of the hit node), no pizza hit
      if (node === 52 && bots.length) {
        const bot = w.records.find((r) => r.name === bots[1]);
        runBB(P, 90 * sc, (t) => { covTick(P, c); pepperAt(P, bot, 5, 0); return []; }, st, `e${node} dt${dt} front `);
        if (dt === 1) {
          setVar(P, 99, 9);
          const tgt = w.records.find((r) => r.name === bots[0]);
          runBB(P, 100, (t) => { covTick(P, c); if (t < 12) pepperAt(P, tgt, 9, 0); return []; }, st, `e${node} dt${dt} aim `);
        }
      }
      mergeCov(cov, c);
      notes.push(`node ${node} dt ${dt}: ${bots.length} bots (${bots.join(' ')}), talk ${talk.map((r) => r.name).join(' ')}; said ${[...st.said].slice(-3).join(',')}`);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks, cutscenes ${st.cutscenes}; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
