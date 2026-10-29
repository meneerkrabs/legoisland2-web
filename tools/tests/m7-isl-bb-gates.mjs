import { createBB, runBB, newStats, placePepper, setVar, chaseScript, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: the gate bits of the bots' chains (follow: MOVE & 1 / & 8, hide, harass, MeetPepp & 4, Turn2Pep C, the leaders' 0x2000000 / 0x4000 / 0x20000 marks) against the original's code
// (tools/lib/m7-isl-bb-emu.mjs): the bots' MOVE variables are set to bit combinations on both sides, so the follower nodes lose their leaders (harass makes the free bot the leader of its `& 8` follower when its walker ignored
// another walker), the hide nodes keep or lose their bots, the leaders get / lose 0x2000000. Pepper walks between the bots.
const COMBOS = [1, 8, 9, 2, 4, 0x20000, 0x2000000, 0x4000, 0x2000001, 0xc, 3, 0x20009, 0x1000000 | 1];
export default {
  name: 'm7-isl-bb-gates',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const [dt, node, rounds] of [[1, 7, 4], [0.5, 7, 2]]) {
      const P = createBB(ctx, { node, dt, seed: 123, pizza: true });
      const w = P.w, sc = dt === 1 ? 1 : 2;
      const bots = ['BBT0', 'BBT1', 'BBT2', 'BBT3', 'BBT4', 'BBT5', 'BBR0', 'BBG0', 'BBB0', 'BBY0'];
      const mv = (n) => w.records.find((r) => r.name === n).ctrl.nodes[0].var;
      const chase = chaseScript(P, ['BBT1', 'BBT3', 'BBG0', 'BBB0'], 45, 20);
      const c = newCov(), per = 70 * sc;
      runBB(P, rounds * per, (t) => {
        covTick(P, c);
        const r = Math.floor(t / per);
        if (t % per === 2) bots.forEach((n, i) => setVar(P, mv(n), COMBOS[(i * 3 + r * 4 + (i + r) % 3) % COMBOS.length]));
        if (t % per === Math.round(per / 2)) bots.forEach((n, i) => { if ((i + r) % 2 === 0) setVar(P, mv(n), 0); });
        return chase(t);
      }, st, `gates dt${dt} `);
      mergeCov(cov, c);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
