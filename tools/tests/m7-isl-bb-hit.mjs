import { createBB, runBB, newStats, placePepper, pepperAt, setVar, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: the bots' hit / collect node (FUN_005327b1 ctor, FUN_00531e97 update, FUN_00532557 pre-render), the pizza-reaction bits of SGMFIG (0x1000 | 0x2000), the fall hit of botPConly (0x10000) and the forced hit
// (0x1000000) against the original's code (tools/lib/m7-isl-bb-emu.mjs): the bots' MOVE variables are set to the states the set-up's gates and the pizza / fall code produce, on both sides, and the dazed sequences (clips 0x94 /
// 0xcf / 0x95 / 0x11b, the count-down, recovery), the harassed NPC's variable (|= 1, -= 0x20000), the collect (head count, score, COLORED_BOTHEADS, Collect.wav, shrink 0.9 -> 0, hidden) are compared tick by tick.
export default {
  name: 'm7-isl-bb-hit',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const [dt, node] of [[1, 7], [0.5, 7]]) {
      const P = createBB(ctx, { node, dt, seed: 77, pizza: true });
      const sc = dt === 1 ? 1 : 2, w = P.w;
      const rec = (n) => w.records.find((r) => r.name === n);
      const mv = (n) => rec(n).ctrl.nodes[0].var;
      const at = new Map();                                  // tick -> [[bot, value]]
      const plan = (t, name, v) => { const k = Math.round(t * sc); if (!at.has(k)) at.set(k, []); at.get(k).push([name, v]); };
      plan(5, 'BBT1', 0x3000); plan(5, 'BBT2', 0x1000000); plan(5, 'BBT3', 0x11000); plan(5, 'BBR0', 0x1000000); plan(5, 'BBG0', 0x1000); plan(5, 'BBB0', 0x3000); plan(5, 'BBT4', 0x1000000);
      plan(5, 'BBT5', 2);
      plan(60, 'BBR0', 0x1000000); plan(60, 'BBB0', 0x1000000); plan(70, 'BBT1', 0x1000000);
      plan(130, 'BBT0', 0x4000); plan(130, 'BBY0', 0x1000000); plan(150, 'BBG0', 0x11000); plan(200, 'BBT5', 0x11000);
      const coll = [[35, 'BBT4'], [100, 'BBB0'], [150, 'BBY0'], [190, 'BBR0']];
      const c = newCov();
      const total = Math.round((dt === 1 ? 260 : 120) * sc);
      runBB(P, total, (t) => {
        covTick(P, c);
        for (const [n, v] of at.get(t) ?? []) setVar(P, mv(n), v);
        const k = coll.find(([s]) => t >= Math.round(s * sc) && t < Math.round((s + 22) * sc));
        if (k) pepperAt(P, rec(k[1]), 1.4, 0.3); else placePepper(P, 0, 0, 0, 0);
        return [];
      }, st, `hit dt${dt} `);
      mergeCov(cov, c);
      notes.push(`dt ${dt}: NUM_BOT_HEADS ${w.vars.get(0x52)}, COLORED_BOTHEADS ${w.vars.get(0x8e)}, score ${w.vars.get(0xa6)}`);
      P.restore();
    }
    // ---- the two former findings, now plain comparisons (docs/re/m4/wp11-brickbot.md, 'Differential test (WP-VERIFY M7b)')
    {
      // BB1: the hit node's gate. The original's constructor writes mask = value = 0 (the node always runs): a forced hit (0x1000000 without 0x1000) is handled
      const P = createBB(ctx, { node: 7, dt: 1, seed: 77, pizza: true });
      const s1 = newStats(), w = P.w, bot = w.records.find((r) => r.name === 'BBT2');
      runBB(P, 12, (t) => { if (t === 5) setVar(P, bot.ctrl.nodes[0].var, 0x1000000); placePepper(P, 0, 0, 0, 0); return []; }, s1, 'BB1 ');
      st.fail.push(...s1.fail); st.checked += s1.checked; notes.push(`BB1 (hit gate: the constructor FUN_005327b1 writes mask = value = 0): ${s1.fail.length} differences in 12 ticks`);
      P.restore();
    }
    {
      // BB2: the shrink after the collect is float32 in the original (ends on step 9 at dt 0.5)
      const P = createBB(ctx, { node: 7, dt: 0.5, seed: 77, pizza: true });
      const s2 = newStats(), w = P.w, bot = w.records.find((r) => r.name === 'BBT4');
      runBB(P, 76, (t) => { if (t === 10) setVar(P, bot.ctrl.nodes[0].var, 0x1000000); if (t >= 60) pepperAt(P, bot, 1.4, 0.3); else placePepper(P, 0, 0, 0, 0); return []; }, s2, 'BB2 ');
      st.fail.push(...s2.fail); st.checked += s2.checked; notes.push(`BB2 (shrink 0.9 - 0.1 * 9 at dt 0.5, float32 ends on step 9): ${s2.fail.length} differences`);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; sounds ${[...(st.sfx ?? [])].map(([k, v]) => `${k}x${v}`).join(' ')}; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
