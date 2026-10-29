// A scripted player for z27TRX (the node tests and the browser steps share it). It looks ahead with the game's own collision probes (the two sweeps of FUN_007692a1 / FUN_007698cf)
// at the lane centres, keeps to a lane without a hazard and jumps when every lane is blocked and a jump clears it. Self-contained (no imports): the steps evaluate its source in the page.
//   const bot = makeTrxBot(); const keys = bot.step(world, node)  ->  { right, up, down, jump, roar }  (the keys to hold during the next tick)
export function makeTrxBot(opts = {}) {
  const FWD = ['ROCK', 'STP2', 'VOLC', 'STMP', 'FENC', 'BLDF', 'BLDR', 'LOGS', 'STAT'];
  const UP = ['BURN', 'SLOG', 'EGGS', 'YOLK'];
  const horizon = opts.horizon ?? 90, stay = opts.stay ?? 42, jumps = opts.jumps ?? true;
  const st = { holdUp: 0, holdDown: 0, last: 'none', jumps: 0, laneMoves: 0, lastJumpZ: -1e9, roars: 0, nextRoar: 400 };
  const nm = (h) => h.rec.name.toUpperCase();
  /** the hazard test of the node at the position p = [x, y, z] (the same sweeps) */
  function hazard(w, rec, p) {
    const f = w.col.sweep(rec, [p[0], p[1] + 0.4, p[2] + 6], [0, 0.8, -8.56], 3, 0.01, 0);
    if (f && FWD.includes(nm(f))) return nm(f);
    const u = w.col.sweep(rec, p, [0, 4, 0], 3, 2.0, 0.08);
    if (u && UP.includes(nm(u))) return nm(u);
    return null;
  }
  function groundAt(w, x, z) {
    const g = w.col.groundRec; if (!g) return 0.1;
    const h = w.col.rayRecord(g, [x, 4, z], [0, -300, 0], 3, 1.0, 0.1);
    return h ? Math.max(0.1, h.point[1] - 0.1) : 0.1;
  }
  /** distance to the first hazard in the lane (index -1 / 0 / 1), up to the horizon */
  function clear(w, rec, node, lane, from = 2, y = null) {
    const x = node.baseX + lane * 16;
    for (let d = from; d < horizon; d += 2) {
      const z = node.z + d;
      const yy = y ?? groundAt(w, x, z);
      if (hazard(w, rec, [x, yy, z])) return d;
    }
    return horizon;
  }
  /** would a jump started `delay` ticks from now clear every hazard of the lane? (the arc of FUN_00768510 at the current speed) */
  function arcClear(w, rec, node, lane, delay) {
    const x = node.baseX + lane * 16;
    const v = node.speed;
    const z0 = node.z + v * delay, base = groundAt(w, x, z0);
    for (let k = 0; k <= 34; k++) {
      const t = k * 0.0333, y = Math.max(base, -28 * t * t + 28 * t + base);
      const z = z0 + v * k;
      const yy = Math.max(y, groundAt(w, x, z));
      if (hazard(w, rec, [x, yy, z])) return false;
    }
    return true;
  }
  return {
    st,
    step(w, node) {
      const rec = w.records[335];
      const keys = { right: true, up: false, down: false, jump: false, roar: false };
      const phase = w.vars.get(0xfa);
      if (phase !== 4 || node.stunned) return keys;
      // the roar now and then (the button works while running)
      if (node.z > st.nextRoar) { keys.roar = true; st.nextRoar = node.z + 500; st.roars++; }
      const cur = node.lane;
      // a lane change of the previous tick is still on its way: keep the keys released so the next press is a fresh edge
      if (Math.abs(node.offset - cur * 16) > 0.01 && node.offset !== node.lane * 16 && st.last !== 'none' && st.last !== 'idle') { /* moving */ }
      const cd = [-1, 0, 1].map((l) => clear(w, rec, node, l, 2));
      const idx = (l) => l + 1;
      const here = cd[idx(cur)];
      const jumpable = !node.jumping && !node.burning && w.input.held !== undefined;
      let want = cur;
      if (here < stay) {
        let best = cur, bestD = here;
        for (const l of [-1, 0, 1]) {
          if (Math.abs(l - cur) > 1) continue;                         // one lane per press: the next tick goes on
          const d = cd[idx(l)];
          if (d > bestD + 6 || (d >= bestD + 6 && l === 0)) { best = l; bestD = d; }
        }
        // a lane two steps away may be much better: head for it through the middle
        const far = cur === -1 ? 1 : cur === 1 ? -1 : cur;
        if (far !== cur && cd[idx(far)] > bestD + 12 && cd[idx(0)] > here) { best = 0; bestD = cd[idx(0)]; }
        want = best;
        // every lane blocked soon: jump if an arc clears the hazard
        if (jumps && jumpable && bestD < 26 && node.z - st.lastJumpZ > 40) {
          if (arcClear(w, rec, node, cur, 0)) {
            // jump when the hazard is about to come into the forward probe (the arc must pass over it)
            if (here < 24) { keys.jump = true; st.lastJumpZ = node.z; st.jumps++; }
          }
        }
      }
      if (want !== cur && node.offset === node.lane * 16) {
        if (want < cur) { if (st.holdUp === 0) { keys.up = true; st.holdUp = 2; st.laneMoves++; } } else if (st.holdDown === 0) { keys.down = true; st.holdDown = 2; st.laneMoves++; }
      }
      if (st.holdUp > 0) { if (!keys.up) st.holdUp--; else st.holdUp = 2; }
      if (st.holdDown > 0) { if (!keys.down) st.holdDown--; else st.holdDown = 2; }
      st.last = want !== cur ? 'move' : 'idle';
      return keys;
    },
  };
}
