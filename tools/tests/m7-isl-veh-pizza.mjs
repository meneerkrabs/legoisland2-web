// WP-VERIFY M7 island gameplay nodes: Pizza.c (the thrown pizza PIZ0-2, the hand-over pizzas PIZ3 / PIZ4 of eras 1-3) with the walk node's Space branch (prelude FUN_00427c15, launch FUN_004277d0, hand-over FUN_00428a0a) and the
// controller probe pass FUN_00427233. The original's node framework + Pizza.c run natively in the x86 emulation (tools/lib/m7-isl-veh-emu.mjs) next to the port's nodes (src/island/pizza/pizza.ts) with the same scripted
// Space presses / Pepper clips; compared tick by tick: the pizza records (matrix, Euler, flags), the node fields, all game variables, the hand-over globals, the sound calls and the emitter calls (gate / matrix / parameter).
import { Duel, B, REC, RECORDS_BASE, lcg } from '../lib/m7-isl-veh-emu.mjs';
import { walkSpace, pizzaSystem } from '../../src/island/pizza/pizza.ts';
import '../../src/island/pizza/index.ts';
import { withCdHeap } from '../lib/m8-save-pizza.mjs';

const MAXFAIL = 30;
const ST = { IDLE: 0x1b, WALK: 0xd, RUN: 0x24, JUMP: 1, SNEAK: 8 };

// (WP-SAVE: the original is a debug build whose heap fills fresh node blocks with 0xCD; the nodes of this family keep that fill in the fields the constructors never write, so the oracle must allocate like it: tools/lib/m8-save-pizza.mjs)
const suite = {
  name: 'm7-isl-veh-pizza',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { throws: 0, runThrows: 0, hits: 0, splats: 0, vanish: 0, recycled: 0, stale: 0, hand: 0, aimed: 0, ticks: 0, sessions: 0, cutsceneDrop: 0 };
    const devs = new Map(), unhooked = new Map();

    const session = (label, node, dt, syncMode, o = {}) => {
      const d = new Duel(ctx, { node, keepKinds: ['Pizza', 'PizzaHand', 'PizzaCarry'], keepRecords: (n) => /^(PIZ\d|CNST|RHCP|BRIK|PAPA|MAMA)$/.test(n), dt, maxFail: MAXFAIL, failures, draw: true,
        pepSwitc: false, seat: false, advancePepper: 1.0, portSpace: walkSpace, exact: true });
      d.label = label; cover.sessions++;
      d.syncMode = syncMode;
      const W = d.P.world, mem = d.emu.cpu.mem;
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const piz = ['PIZ0', 'PIZ1', 'PIZ2', 'PIZ3', 'PIZ4'].map(idx).filter((i) => i >= 0);
      const proj = ['PIZ0', 'PIZ1', 'PIZ2'].map(idx);
      const hand = ['PIZ3', 'PIZ4'].map(idx).filter((i) => i >= 0 && d.pnode(i, 'PizzaHand'));
      const used = new Set(), released = new Set();
      const ri = (ptr) => (ptr ? (ptr - RECORDS_BASE) / REC : -1);
      const PN = { speed: [0x34, 'f'], startFrame: [0x38, 'f'], releaseFrame: [0x3c, 'f'], travelled: [0x44, 'f'], spin: [0x4c, 'f'] };
      d.syncPort = () => {
        for (const i of proj) { const pn = d.pnode(i, 'Pizza'); if (pn) { d.nodeToPort(pn, d.onode(i, 0x42887c), PN); d.recToPort(i); } }
      };
      const compare = () => {
        for (const i of piz) d.rec(i, 0xfffe, undefined, true);     // (flag bit 0 = frustum: set by the renderer; the draw hook FUN_004285b0 also sets it while a pizza is held; the pose of a hidden pizza is unobservable: the draw hook keeps moving a hidden held pizza with the hand)
        d.vars(); d.sounds();
        const s = pizzaSystem(W);
        d.eq('DAT_009da870 target', ri(mem.r32(0x9da870)), s.target ? s.target.index : -1);
        d.eq('hand window start', mem.r16(0x8adf4a), s.handStart); d.eq('hand window end', mem.r16(0x8adf48), s.handEnd);
        for (const i of proj) {
          const pn = d.pnode(i, 'Pizza'), a = d.onode(i, 0x42887c), n = W.records[i].name;
          if (!pn) continue;
          d.eq(n + ' slot', mem.r32(a + 0x1c), pn.slot);
          // dir (+0x20..) and clip (+0x4a) are written when a throw starts / is released: their initial values (the original's zeroed block, the port's defaults) are never read before that
          if (mem.r16(a + 0x40) !== 0) used.add(i);                               // the pizza appeared (clip written)
          if (mem.r16(a + 0x40) !== 0 && mem.r8(a + 0x48) === 0) released.add(i);  // released (dir written)
          if (released.has(i)) for (let k = 0; k < 3; k++) d.cmp(n + ' dir', mem.f32(a + 0x20 + 4 * k), pn.dir[k], undefined, `[${k}]`, 1e-5);
          d.eq(n + ' target', ri(mem.r32(a + 0x2c)), pn.target ? pn.target.index : -1); d.eq(n + ' hit', ri(mem.r32(a + 0x30)), pn.hit ? pn.hit.index : -1);
          d.cmp(n + ' speed', mem.f32(a + 0x34), pn.speed); d.cmp(n + ' startFrame', mem.f32(a + 0x38), pn.startFrame); d.cmp(n + ' releaseFrame', mem.f32(a + 0x3c), pn.releaseFrame);
          d.eq(n + ' flightBit', mem.r16(a + 0x40), pn.flightBit); d.eq(n + ' count', mem.r16(a + 0x42) << 16 >> 16, pn.count);
          d.cmp(n + ' travelled', mem.f32(a + 0x44), pn.travelled, undefined, '', 1e-4); d.eq(n + ' held', mem.r8(a + 0x48) !== 0, pn.held); d.eq(n + ' probePending', mem.r8(a + 0x49) !== 0, pn.probePending);
          if (used.has(i)) d.eq(n + ' clip', mem.r16(a + 0x4a) << 16 >> 16, pn.clip); d.cmp(n + ' spin', mem.f32(a + 0x4c), pn.spin, undefined, '', 1e-5);
        }
        for (const i of hand) {
          const pn = d.pnode(i, 'PizzaHand'), a = d.onode(i, 0x42900b), n = W.records[i].name;
          d.eq(n + ' done', mem.r32(a + 0x2c) !== 0, pn.done); d.eq(n + ' frame', mem.r32(a + 0x30), pn.frame);
          d.eq(n + ' reached', ri(mem.r32(a + 0x20)), pn.reached ? pn.reached.index : -1);
        }
      };
      const step = (held = 0) => {
        d.tick(held); cover.ticks++;
        if (process.env.ISL_TRACE && d.t >= +process.env.ISL_TRACE - 4 && d.t <= +process.env.ISL_TRACE) {
          const pa = d.P.pepper.anim, oa = d.O.pepper.anim;
          console.log(d.t, 'pepper clip/frame port', pa.clip, pa.frame, 'orig', oa.clip, oa.frame, 'mailbox', mem.r32(0x8ae088), 'PIZZAS', mem.r32(0x8a2d2c + 99 * 4), d.getVar(99));
          for (const i of proj) { const pn = d.pnode(i, 'Pizza'), a = d.onode(i, 0x42887c); console.log('  ', W.records[i].name, 'orig held', mem.r8(a + 0x48), 'count', mem.r16(a + 0x42), 'bit', mem.r16(a + 0x40), 'clip', mem.r16(a + 0x4a) << 16 >> 16, 'stamp', mem.r32(a + 8), 'flags', mem.r16(RECORDS_BASE + i * REC + 0x60).toString(16), '| port held', pn.held, 'count', pn.count, 'bit', pn.flightBit, 'clip', pn.clip, 'stamp', pn.stamp, 'flags', W.records[i].flags.toString(16)); }
        }
        compare();
      };
      const idle = (n) => { for (let i = 0; i < n; i++) step(0); };
      const pizzaNow = () => proj.filter((i) => d.pnode(i, 'Pizza') && W.records[i].enabled).length;
      return { d, W, mem, idx, proj, hand, step, idle, pizzaNow, compare };
    };

    // spots with an open direction and a wall direction (the port's collision world: where a 100 unit sweep at pizza height stops)
    const scan = (S, spot) => {
      const { W, d } = S;
      const open = [], wall = [];
      for (let k = 0; k < 24; k++) {
        const yaw = -Math.PI + k * Math.PI / 12, dd = [Math.sin(yaw) * 150, 0, Math.cos(yaw) * 150];
        const h = W.col.sweep(d.P.pepper, [spot[0], spot[1] + 2, spot[2]], dd, 3, 1.0, 0.1);
        if (!h) open.push(yaw); else if (Math.hypot(h.point[0] - spot[0], h.point[2] - spot[2]) < 90) wall.push(yaw);
      }
      return { open, wall };
    };
    const SPOTS = [[153.8, 15, -62.5], [-100, 26, 60], [0, 22, 0]];

    // ---- era 0 (story node 2): the toy throw. Pepper in the open and in front of walls
    for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
      const S = session(`pizza e0 ${dtLabel}`, 2, dt, sm);
      const { d, W, step, idle, mem } = S;
      const sc = dt === 1 ? 1 : 2;
      const seen = (key) => { cover[key] = (cover[key] ?? 0) + 1; };
      const trackCounts = () => { for (const i of S.proj) { const c = mem.r16(d.onode(i, 0x42887c) + 0x42); if (c === 4) seen('vanish'); else if (c === 5) seen('splats'); else if (c === 6) seen('hits'); } };
      const run = (n) => { for (let t = 0; t < n; t++) { step(0); trackCounts(); } };
      const throwAt = (spot, yaw, state, wait) => {
        d.placePepper(spot[0], spot[1], spot[2], yaw);
        d.setState(state);
        const pz = d.getVar(99);
        step(B.SPACE); d.space(state);
        if (pz === 7) seen('recycled');
        run(wait * sc);
      };
      d.placePepper(160, 14, -40, 0);
      d.setState(ST.IDLE);
      idle(3);
      let sp = 0;
      for (const spot of SPOTS) {
        const { open, wall } = scan(S, spot);
        if (!open.length && !wall.length) continue;
        sp++;
        // a throw into the open (the pizza flies 144 units and vanishes) and one at a wall (the sweep hits: splat); walking (clip 0x0b) and running (clip 0x42)
        if (open.length) { throwAt(spot, open[0], ST.IDLE, 110); seen('throws'); throwAt(spot, open[open.length >> 1], ST.RUN, 100); seen('runThrows'); }
        if (wall.length) { throwAt(spot, wall[0], ST.IDLE, 100); seen('throws'); throwAt(spot, wall[wall.length - 1], ST.WALK, 100); seen('throws'); }
      }
      // four throws in a row (a new one as soon as the previous pizza has left the hand): all three slots busy, the 4th recycles the furthest
      const open0 = scan(S, SPOTS[2]).open;
      for (let k = 0; k < 5; k++) throwAt(SPOTS[2], open0[k % Math.max(1, open0.length)] ?? 0, ST.IDLE, 22);
      run(150 * sc);
      // the throw clip is interrupted (a jump) before the release frame: the pizza in the hand is dropped
      d.placePepper(...SPOTS[2], 0); d.setState(ST.IDLE);
      step(B.SPACE); d.space(ST.IDLE); run(20 * sc);
      d.setState(ST.JUMP); run(10 * sc); seen('stale');
      // a cutscene starts while the pizza is in the hand
      d.setState(ST.IDLE);
      step(B.SPACE); d.space(ST.IDLE); run(20 * sc);
      d.cutscene(true); run(6 * sc); d.cutscene(false); seen('cutsceneDrop');
      // Space in states that cannot throw (jump, landing): nothing happens
      for (const st of [ST.JUMP, 0x57, 0x1f, 0x3f]) { d.setState(st); step(B.SPACE); d.space(st); run(5); }
      d.setState(ST.IDLE);
      run(10 * sc);
      cover.spots = sp;
      notes.push(`${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a2, n] of d.emu.unhooked) unhooked.set(a2, (unhooked.get(a2) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }

    // ---- era 1 (story node 10): the hand-over pizzas PIZ3 / PIZ4, targets (controller flag 0x40) to aim at and to hit
    for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
      const S = session(`pizza e1 ${dtLabel}`, 10, dt, sm);
      const { d, W, step, idle, mem } = S;
      const sc = dt === 1 ? 1 : 2;
      const run = (n) => { for (let t = 0; t < n; t++) step(0); };
      const tree = W.records.findIndex((r) => r.name === 'TREE'), sign = W.records.findIndex((r) => r.name === 'SIGN'), bbb = W.records.findIndex((r) => r.name === 'BBB0');
      for (const i of [tree, sign, bbb]) d.makeTarget(i);
      const R = (i) => W.records[i];
      const faceTo = (from, to) => Math.atan2(to.x - from[0], to.z - from[2]);
      // Pepper 40 units from the tree, facing it: the throw aims at it (the 10 degree release cone; the 45 degree prelude cone finds it, 40 units: not a hand-over)
      const t = R(tree);
      for (const off of [[-40, -10], [-25, 30], [20, -45], [-60, 5]]) {
        const from = [t.x + off[0], t.y + 2, t.z + off[1]];
        d.placePepper(from[0], from[1], from[2], faceTo(from, t) + (off[0] === -60 ? 0.12 : 0));
        d.setState(ST.IDLE);
        step(B.SPACE); d.space(ST.IDLE); cover.aimed++;
        run(110 * sc);
      }
      // hand-over: a target within 4.8 units inside the 45 degree cone: state 0x0c, the hand pizzas appear between the frames 10 and 40 of the clip, the window ends with the splat
      for (const [i, off] of [[sign, [-3.2, 1]], [bbb, [2, -3.5]], [sign, [3.9, 0]], [bbb, [-2.5, -2.5]]]) {
        const r = R(i), from = [r.x + off[0], r.y, r.z + off[1]];
        d.placePepper(from[0], from[1], from[2], faceTo(from, r));
        d.setState(ST.IDLE);
        step(B.SPACE); d.space(ST.IDLE); cover.hand++;
        run(95 * sc);
      }
      // throw while a hand-over runs (state 0x0c is not a throwing state), the clip interrupted during the window, a cutscene during it
      { const r = R(sign), from = [r.x - 3, r.y, r.z]; d.placePepper(from[0], from[1], from[2], faceTo(from, r)); d.setState(ST.IDLE); step(B.SPACE); d.space(ST.IDLE); run(15 * sc); d.setState(ST.JUMP); run(40 * sc); }
      { const r = R(sign), from = [r.x - 3, r.y, r.z]; d.placePepper(from[0], from[1], from[2], faceTo(from, r)); d.setState(ST.IDLE); step(B.SPACE); d.space(ST.IDLE); run(20 * sc); d.cutscene(true); run(10 * sc); d.cutscene(false); run(60 * sc); }
      // the story nodes 0x35..0x37 always throw, 0x38..0x3c never (FUN_00427c15 reads the story node var 0x58)
      for (const node of [0x35, 0x38, 0x3d]) { d.setVar(0x58, node); const r = R(sign), from = [r.x - 3, r.y, r.z]; d.placePepper(from[0], from[1], from[2], faceTo(from, r)); d.setState(ST.IDLE); step(B.SPACE); d.space(ST.IDLE); run(100 * sc); }
      notes.push(`e1 ${dtLabel}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a2, n] of d.emu.unhooked) unhooked.set(a2, (unhooked.get(a2) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      void idle; void mem;
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
export default { ...suite, run: (ctx) => withCdHeap(() => suite.run(ctx)) };
