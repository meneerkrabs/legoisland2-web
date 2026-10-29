import { createBB, runBB, newStats, placePepper, setVar, newCov, covTick, mergeCov, showCov } from '../lib/m7-isl-bb-emu.mjs';

// WP-VERIFY M7b: botPConly.c (FUN_0053de63 ctor, FUN_0053d990 update, FUN_0053dc65 pre-render; BBT5 of era 1) against the original's code (tools/lib/m7-isl-bb-emu.mjs): MOVE & 2 makes the bot run to PATH 255 and back to
// 252 (clip 0x118, walker FUN_004626d0 / 004625d7 / 00462a11), a fall (lifted 3 units in both worlds: SGMFIG falling, then more than 0.04 per tick) plays BB_PIZZADAZED and ends with 0x11000 (the hit node: knocked over, how 3),
// and below y 96 within 24 units of TBOB (moved next to it in both worlds) it sets MOVE_TBOB |= 0x20. dt = 1 and 0.5.
export default {
  name: 'm7-isl-bb-pconly',
  run(ctx) {
    const notes = [], st = newStats(), cov = newCov();
    for (const dt of [1, 0.5]) {
      const P = createBB(ctx, { node: 7, dt, seed: 61, pizza: true });
      const w = P.w, sc = dt === 1 ? 1 : 2, c = newCov();
      const bot = w.records.find((r) => r.name === 'BBT5'), tbob = w.records.find((r) => r.name === 'TBOB');
      const mv = bot.ctrl.nodes[0].var;
      const lift = (dy) => { bot.setEuler(bot.rx, bot.ry, bot.rz, bot.x, bot.y + dy, bot.z); P.E.mirrorRecord(bot); };
      const tele = (r, to) => { to.setEuler(to.rx, to.ry, to.rz, to.x, 80, to.z); P.E.mirrorRecord(to); bot.setEuler(bot.rx, bot.ry, bot.rz, to.x + 6, 80, to.z + 6); P.E.mirrorRecord(bot); };
      const total = Math.round((dt === 1 ? 330 : 230) * sc);
      const var20 = w.vars.get(tbob.ctrl.nodes[0].var);
      runBB(P, total, (t) => {
        covTick(P, c);
        placePepper(P, 0, 0, 0, 0);
        const u = Math.floor(t / sc), edge = t % sc === 0;
        if (u === 3 && edge) setVar(P, mv, 2);
        if (u === 110 && edge) lift(3);
        if (u === 190 && edge) setVar(P, mv, 2);
        return [];
      }, st, `pconly dt${dt} `);
      // TBOB: the bot (MOVE & 2 off) next to him
      setVar(P, mv, 0); tele(bot, tbob);
      runBB(P, 12 * sc, () => { covTick(P, c); placePepper(P, 0, 0, 0, 0); return []; }, st, `pconly dt${dt} tbob `);
      mergeCov(cov, c);
      notes.push(`dt ${dt}: TBOB's MOVE var 0x${(w.vars.get(tbob.ctrl.nodes[0].var) >>> 0).toString(16)} (was 0x${(var20 >>> 0).toString(16)}); BBT5 y ${bot.y.toFixed(1)}`);
      P.restore();
    }
    notes.push(`${st.ticks} ticks, ${st.checked} checks; coverage ${showCov(cov)}`);
    return { checked: st.checked, failures: st.fail, notes };
  },
};
