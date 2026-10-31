import { createBB, runBB, newStats, placePepper, pepperAt, setVar, newCov, covTick, mergeCov, showCov, setPepState, advancePepper, spaceBoth } from '../lib/m7-isl-bb-emu.mjs';
import { scopeOf } from '../lib/m7-isl-npc-emu.mjs';
import { guarded } from '../lib/inject-guard.mjs';

// WP-VERIFY M7b: the NPC side of the pizza (SGMFIG's reaction FUN_0042477f with FUN_00429183 "is a pizza coming at me", the bots' hit node with FUN_00429556) against the original's code, with the pizza nodes (Pizza.c FUN_0042887c
// thrown PIZ0-2, FUN_0042900b hand-over PIZ3 / PIZ4) running natively in the oracle as well (their own comparison is tools/tests/m7-isl-veh-pizza.mjs): Pepper throws (Space in the walk states idle / run, FUN_00427c15 / 004277d0)
// at the bots and at ordinary NPCs, hands a pizza over (FUN_00428a0a), on story node 7; compared tick by tick (records incl. the pizza records, bot / NPC nodes, all variables, sounds incl. Piza_Hit at the bot, collect).
const ST = { IDLE: 0x1b, WALK: 0xd, RUN: 0x24 };
const __test = {
  name: 'm7-isl-bb-pizza',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    const diffs = [];
    for (const dt of [1, 0.5]) {
      const P = createBB(ctx, { node: 7, dt, seed: 91, pizza: true });
      const w = P.w, sc = dt === 1 ? 1 : 2;
      P.scope = [...scopeOf(P), ...w.records.filter((r) => /^PIZ\d$/.test(r.name))];
      const rec = (n) => w.records.find((r) => r.name === n);
      setVar(P, 99, 9);                                          // PIZZAS
      setPepState(P, ST.IDLE);
      // [tick, target, distance, offset, state, hold]: Pepper stands `distance` from the target record facing it, Space after 12 ticks, keeps her place `hold` ticks (the throw / hand-over clip plays), then walks off
      const throws = dt === 1
        ? [[10, 'BBT1', 9, 0, ST.IDLE, 45], [80, 'BBR0', 12, 0.4, ST.IDLE, 45], [150, 'BBT4', 8, 0, ST.RUN, 45], [220, 'NICK', 8, 0, ST.IDLE, 60], [290, 'NANC', 7, 0, ST.IDLE, 60], [360, 'BBT2', 1.8, 0, ST.IDLE, 90]]
        : [[10, 'BBT1', 9, 0, ST.IDLE, 45], [80, 'NICK', 8, 0, ST.IDLE, 45], [150, 'BBT2', 1.8, 0, ST.IDLE, 90]];
      const c = newCov();
      const last = throws[throws.length - 1];
      const total = Math.round((last[0] + 12 + last[5] + 20) * sc);
      runBB(P, total, (t) => {
        covTick(P, c);
        const k = [...throws].reverse().find(([s]) => t >= Math.round(s * sc));
        if (!k) { placePepper(P, 0, 0, 0, 0); return []; }
        const [s0, name, d, off, state, hold] = k, tt = t - Math.round(s0 * sc);
        if (tt < 12 * sc) { pepperAt(P, rec(name), d, off); if (tt === 0) setPepState(P, state === ST.RUN ? ST.RUN : ST.IDLE); }
        else if (tt === 12 * sc) spaceBoth(P, state);
        else if (tt < (12 + hold) * sc) { /* Pepper keeps her place while the clip plays */ }
        else placePepper(P, 0, 0, 0, 0);
        advancePepper(P);
        return [];
      }, st, `pizza dt${dt} `);
      mergeCov(cov, c);
      diffs.push(...(P.spaceDiffs ?? []));
      notes.push(`dt ${dt}: ${P.spaceLog.length} Space presses (${P.spaceLog.map((x) => `0x${x.state.toString(16)}->0x${x.orig.toString(16)}`).join(' ')}); pizzas var ${w.vars.get(99)}, heads ${w.vars.get(0x52)}`);
      P.restore();
    }
    // ---- the two former Human1 findings D8 / D9 (hop arc end 1.5707879, float32 step): BBT1 is hit, BBR0 (its follower) walks free and hops over a walker
    for (const [id, fix8, fix9, what] of [['D8', false, true, 'hop arc ends at _DAT_00892554 = 1.5707879 (port: pi / 2)'], ['D9', true, false, 'hop descent in float32 ends on step 10 (port: step 9) and restarts the walk clip']]) {
      const P = createBB(ctx, { node: 7, dt: 1, seed: 91, pizza: true });
      const w = P.w, ev = newStats(), t1 = w.records.find((r) => r.name === 'BBT1');
      setVar(P, 99, 9); setPepState(P, ST.IDLE);
      runBB(P, 86, (t) => {
        if (ev.fail.length) return [];
        if (t < 22) pepperAt(P, t1, 9, 0); else if (t === 22) spaceBoth(P, ST.IDLE); else if (t >= 67) placePepper(P, 0, 0, 0, 0);
        if (t === 0) setPepState(P, ST.IDLE);
        advancePepper(P);
        return [];
      }, ev, `${id} `);
      st.fail.push(...ev.fail); st.checked += ev.checked; notes.push(`${id} (Human1: ${what}): ${ev.fail.length} differences`);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; sounds ${[...(st.sfx ?? [])].map(([k, v]) => `${k}x${v}`).join(' ')}; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: [...st.fail, ...diffs], notes };
  },
};
export default guarded(__test);
