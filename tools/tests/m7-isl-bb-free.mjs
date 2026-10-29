import { createBB, runBB as runPair, newStats, placePepper, chaseScript, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: the Brickster's bots (BrickBot.c: follower FUN_00531d45, hit / collect FUN_005327b1, harass FUN_00532acc, hide FUN_00533ba8, botPConly FUN_0053de63) on story node 7 (era 1) against the ORIGINAL's code in the x86
// emulation (tools/lib/m7-isl-bb-emu.mjs on the NPC oracle tools/lib/m7-isl-npc-emu.mjs): the constructors, the node passes (FUN_0042226e / 00427233 / 004225c5 / 0042271b), SGMFIG, Human1, MeetPepp, Turn2Pep C, the walker, animation
// and collision code run natively; per tick compared: records (matrix, Euler, flags, clip / frame), controllers, every node block of the bots (follower history / clips / gag state, hit state, harass timer, hide state), all 319
// variables, the sounds / speech / random draws. This file: no pizza, Pepper far away and chasing the bots, dt = 1 and 0.5, out-of-view records.
export default {
  name: 'm7-isl-bb-free',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const dt of [1, 0.5]) {
      const P = createBB(ctx, { node: 7, dt, seed: 41 });
      const n = dt === 1 ? 260 : 220;
      const chase = chaseScript(P, ['BBT0', 'BBT3', 'BBR0', 'BBT4', 'BBY0', 'BBG0'], 50, 60);
      const c = newCov();
      runPair(P, n, (t) => { covTick(P, c); return chase(t); }, st, `free dt${dt} `);
      // out of view: the bots' records leave the frustum (follower: the leader's clip is not mirrored; hide: frozen after 90 ticks out of view; Human1 / SGMFIG unaffected)
      const hidden = new Set(['BBT0', 'BBT3', 'BBR0', 'BBT1', 'BBY0']);
      P.view = (r) => !hidden.has(r.name);
      runPair(P, 110 * (dt === 1 ? 1 : 2), (t) => { covTick(P, c); return chase(t); }, st, `hidden dt${dt} `);
      P.view = undefined;
      runPair(P, 60, (t) => { covTick(P, c); return chase(t); }, st, `back dt${dt} `);
      mergeCov(cov, c);
      notes.push(`dt ${dt}: max matrix deviation ${P.maxDev.m.toExponential(2)}, frame ${P.maxDev.frame.toExponential(2)}`);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
