import { loadZone } from '../lib/engine-load.mjs';
import { prepareWorld, snapshot } from '../../src/zones/z41MAP/nodes.ts';
import { createClones, syncClones } from '../../src/zones/z41MAP/game.ts';
import { Bot } from '../lib/z41map-bot.mjs';
import { createHarness, makeRng, AB, f32 } from '../lib/m7-z41MAP-emu.mjs';

// z41MAP, differential test (WP-VERIFY, docs/re/m3/z41MAP.md): the ORIGINAL update functions of Pepper (FUN_00816562), Papa (FUN_00812399), mama (FUN_00815f30), the toppings
// (FUN_00815576), the five citizens (FUN_008140cc) and the slug (FUN_00814f6e) + the draw hooks that rewrite matrices (FUN_00812ea5 / 0081603e / 00814964) run in the x86
// emulation over one update pass from the port's state of every tick; then the port ticks. Records (matrix, Euler, flags), animation state, every node field, the zone's globals,
// the camera, the game variables, every sound / speech / 3D loop / splat call and the random draws are compared tick by tick (tools/lib/m7-z41MAP-emu.mjs).

const TOL = process.env.M7_TOL !== undefined ? +process.env.M7_TOL : 0;
const MAXFAIL = process.env.MAXFAIL ? +process.env.MAXFAIL : 40;

export default {
  name: 'm7-z41MAP-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const known = new Map();         // KNOWN DEVIATIONS: key -> { count, first }
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const dev = (key, msg) => { const k = known.get(key); if (k) k.count++; else known.set(key, { count: 1, first: msg }); };
    const close = (a, b, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    const stats = { ticks: 0, pepper: new Set(), papa: new Set(), citizen: new Set(), slug: new Set(), mama: new Set(), slot: new Set(), branches: {}, picks: 0, games: 0 };

    const T0 = Date.now();
    const press = (w, mask) => { const i = w.input; i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask; };

    /** a fresh zone world + harness with the port's recorder as sink */
    const make = (seed, dt = 1, vars = {}) => {
      const L = loadZone(ctx, 'z41MAP', { subgame: 28 });
      for (const [k, x] of Object.entries(vars)) L.world.vars.set(+k, x);
      const w = L.world;
      const S = prepareWorld(w, L.archive);
      w.externalInput = true;
      w.dt = dt;
      const rngP = makeRng(seed * 7919 + 13);
      S.env.rng = () => rngP.next();
      const Eh = { msv: 1000 };
      S.env.ms = () => Eh.msv;
      const plog = [];
      S.env.sfx = (id) => plog.push(['2d', id]);
      S.env.say = (id) => plog.push(['say', id]);
      S.env.flight = (p) => plog.push(p ? ['3d', ...p] : ['stop3d']);
      S.env.puff = (p) => plog.push(['puff', ...p]);
      // the helper records of the zone game (dough, layers, toppings in the air): created before the harness mirrors the records
      const nBase = w.records.length;
      const clones = createClones(w);
      const H = createHarness(ctx, w, S, { nBase });
      H.init();
      return { L, w, S, H, rngP, plog, dt, clones, nBase, Eh, label: '' };
    };

    const compareTick = (E, orig, label) => {
      const { w, S, H, rngP, plog } = E;
      const mine = H.tsState();
      const ck = (c, msg) => { checked++; if (!c) bad(`${label}: ${msg}`); };
      const cn = (a, b, msg, key) => {
        checked++;
        if (!close(a, b)) { if (key && E.known?.[key]) dev(key, `${label}: ${msg}: port ${a}, original ${b}`); else bad(`${label}: ${msg}: port ${a}, original ${b}`); }
      };
      // records
      for (let i = 0; i < E.nBase; i++) {
        const a = mine.recs[i], b = orig.recs[i], r = w.records[i];
        const exp = b.m.slice();
        if (r === H.cit4) for (let k = 0; k < 3; k++) exp[12 + k] = f32(exp[12 + k] + H.drawOffset[k]);
        if (r === H.slug) for (let k = 0; k < 12; k++) if (k % 4 !== 3) exp[k] = f32(exp[k] * 0.4);
        ck((a.flags | 1) === b.flags, `record ${i} ${r.name} flags port ${a.flags.toString(16)}, original ${b.flags.toString(16)}`);
        for (let k = 0; k < 16; k++) cn(a.m[k], exp[k], `record ${i} ${r.name} m[${k}]`);
        for (let k = 0; k < 3; k++) cn(a.e[k], b.e[k], `record ${i} ${r.name} euler[${k}]`);
        if (r.anim && orig.anims[i]) {
          ck(r.anim.clip === orig.anims[i][0], `record ${i} ${r.name} clip port ${r.anim.clip}, original ${orig.anims[i][0]}`);
          cn(r.anim.frame, orig.anims[i][1], `record ${i} ${r.name} frame`);
        }
      }
      // nodes
      H.entries.forEach(([r, n, kind], ei) => {
        const a = mine.nodes[ei], b = orig.nodes[ei];
        const cmp = (x, y, path) => {
          if (Array.isArray(y)) { ck(Array.isArray(x) && x.length === y.length, `${r.name} ${kind}.${path} length`); y.forEach((v, q) => cmp(x[q], v, `${path}[${q}]`)); }
          else if (y && typeof y === 'object') for (const k of Object.keys(y)) cmp(x[k], y[k], `${path}.${k}`);
          else cn(x, y, `node ${kind} on ${r.name}: ${path}`, `${kind}.${path.replace(/\[\d+\]/g, '[]')}`);
        };
        for (const k of Object.keys(b)) cmp(a[k], b[k], k);
      });
      // globals
      const ga = mine.globals, gb = orig.globals;
      for (const k of Object.keys(gb)) {
        if (Array.isArray(gb[k])) gb[k].forEach((v, q) => cn(ga[k][q], v, `global ${k}[${q}]`, `global.${k}`));
        else cn(ga[k], gb[k], `global ${k}`, `global.${k}`);
      }
      // the hand-made draws of the draw hooks (dough, layers, toppings in the air) against the port's helper records (syncClones of the zone game)
      syncClones(w, S, E.clones);
      {
        const tokOfModelOf = (rec) => { const t = ['TOP1', 'TOP2', 'TOP3', 'TOP4', 'TOMA', 'MEAT', 'CHEE', 'GREE', 'PIZ1'].map((n) => w.records.find((r) => r.name === n)).find((q) => q.model && q.model === rec.model); return t ? H.tokOf(t) : -1; };
        const pd = [];
        if (E.clones.dough.enabled) pd.push([tokOfModelOf(E.clones.dough), Array.from(E.clones.dough.m)]);
        for (const l of E.clones.layers) if (l.rec.enabled) pd.push([tokOfModelOf(l.rec), Array.from(l.rec.m)]);
        for (const byTpl of E.clones.toppings) for (const r of Object.values(byTpl)) if (r.enabled) pd.push([tokOfModelOf(r), Array.from(r.m)]);
        ck(pd.length === orig.draws.length, `draw calls: port ${pd.length}, original ${orig.draws.length}`);
        if (pd.length === orig.draws.length) pd.forEach((d, i) => { ck(d[0] === orig.draws[i][0], `draw ${i} model port ${d[0]}, original ${orig.draws[i][0]}`); for (let k = 0; k < 16; k++) cn(d[1][k], orig.draws[i][1][k], `draw ${i} matrix[${k}]`); });
        stats.draws = (stats.draws ?? 0) + orig.draws.length;
      }
      // game variables
      for (const i of [0x3f, 0xda]) ck(w.vars.get(i) === orig.vars[i], `variable 0x${i.toString(16)} port ${w.vars.get(i)}, original ${orig.vars[i]}`);
      // sounds / speech / loops / splats in order (the emulator's var and emitter-stop entries are not part of the port's recorder)
      const o = orig.log.filter((e) => e[0] !== 'var' && e[0] !== 'emit');
      const sameLog = o.length === plog.length && o.every((e, i) => e[0] === plog[i][0] && e.slice(1).every((v, q) => (typeof v === 'number' ? close(plog[i][q + 1], v, 0) : v === plog[i][q + 1])));
      checked++;
      if (!sameLog) bad(`${label}: sounds/speech: port ${JSON.stringify(plog)} original ${JSON.stringify(o)}`);
      // random numbers: the same number of draws (and therefore the same generator state)
      ck(orig.rand === E.rngDraws, `random draws: port ${E.rngDraws}, original ${orig.rand}`);
      ck(orig.rngS === rngP.s, `random state after the tick`);
      if (S.papa.thrown > S.papa.count) stats.over = (stats.over ?? 0) + 1;
      stats.maxAir = Math.max(stats.maxAir ?? 0, S.flying);
      // the zone's variables of state: coverage
      stats.pepper.add(S.pepper.state); stats.papa.add(S.papa.state); stats.mama.add(S.mama.state); stats.slug.add(S.slug.state);
      for (const r of w.records) { const n = r.ctrl?.nodes.find((x) => x.kind === 'citizen'); if (n) stats.citizen.add(n.state); }
      for (const s of S.toppings.slots) stats.slot.add(s.state);
      for (const l of plog) if (l[0] === 'say') stats.branches[l[1]] = (stats.branches[l[1]] ?? 0) + 1;
      for (const l of S.log.slice(E.logN)) stats.branches[l] = (stats.branches[l] ?? 0) + 1;
      E.logN = S.log.length;
      for (const e of orig.log) if (e[0] === '2d') stats.branches[`snd${e[1].toString(16)}`] = (stats.branches[`snd${e[1].toString(16)}`] ?? 0) + 1;
    };

    /** one tick: the original from the state, then the port from the same state, then compare */
    const step = (E, mask, label) => {
      const { w, H, rngP } = E;
      press(w, mask);
      const held = w.input.held, pressed = w.input.pressed;
      H.rng.s = rngP.s; H.rng.n = 0;
      E.Eh.msv = H.msv = 1000 + 37 * (stats.ticks % 997) + (stats.ticks % 7);     // the scripted clock of this tick (the same value for both sides)
      let orig; const q0 = performance.now();
      try { orig = H.pass(held, pressed, E.dt); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); return false; }
      const q1 = performance.now(); stats.tPass = (stats.tPass ?? 0) + q1 - q0;
      E.plog.length = 0;
      const n0 = rngP.n;
      w.tick(); stats.tPort = (stats.tPort ?? 0) + performance.now() - q1;
      E.rngDraws = rngP.n - n0;
      stats.ticks++;
      const q2 = performance.now(); compareTick(E, orig, label); stats.tCmp = (stats.tCmp ?? 0) + performance.now() - q2;
      return failures.length <= MAXFAIL;
    };

    /** the fastest possible thrower: picks and throws as soon as the state allows, whatever the round wants (more than one topping in the air) */
    const rapid = (rnd, E) => {
      const pe = E.S.pepper, pa = E.S.papa;
      if (pe.state === 2 && (pa.state === 2 || pa.state === 3 || pa.state > 5)) return [4, 8, 1, 2][Math.floor(rnd() * 4)];
      if (pe.state === 4) return 0x80 | [0, 1, 2][Math.floor(rnd() * 3)];
      if (pe.state === 5) return E.rapidDir ?? 0;
      return 0;
    };
    const chaosMask = (rnd, bot, E, p) => {
      if (bot === 'rapid') return rapid(rnd, E);
      const base = bot ? bot.step(snapshot(E.S)) : 0;
      if (rnd() >= p) return base;
      const picks = [0, 0, 1, 2, 4, 8, 0x80, 0x81, 0x82, 0x84, 0x88, 0x80 | 1, 0x80 | 2];
      return picks[Math.floor(rnd() * picks.length)];
    };
    const lcgRnd = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };

    const play = (E, ticks, mode, noise, label, seed) => {
      const bot = mode === 'rapid' ? 'rapid' : mode ? new Bot(mode) : null;
      const rnd = lcgRnd(seed);
      let ok = true;
      for (let i = 0; i < ticks && ok; i++) {
        const mask = chaosMask(rnd, bot, E, noise);
        ok = step(E, mask, `${label} t${i}`);
        if (E.S.result) { for (let q = 0; q < 8; q++) { ok = step(E, 0, `${label} end t${i}+${q}`); } break; }
      }
      stats.games++;
      
    };

    try {
      const t0 = Date.now();
      // sanity of the host: FUN_0043a9e5 is the row-vector product
      { const E = make(1); checked++; if (!E.H.matMulOk) bad('FUN_0043a9e5 is not the row-vector product dst = b * a'); }
      // ---- 0. the constructors: the initial state of every node, the start clips and Pepper's first camera against the port's set-up
      {
        const E = make(1), { H, w, S } = E;
        const c = H.runCtors();
        const ck = (cond, msg) => { checked++; if (!cond) bad(`ctor: ${msg}`); };
        const cmpObj = (a, b, path) => {
          if (Array.isArray(b)) { ck(Array.isArray(a) && a.length === b.length, `${path} length`); b.forEach((v, q) => cmpObj(a?.[q], v, `${path}[${q}]`)); }
          else if (b && typeof b === 'object') for (const k of Object.keys(b)) cmpObj(a?.[k], b[k], `${path}.${k}`);
          else ck(close(a, b), `${path}: port ${a}, original ${b}`);
        };
        for (const [r, n, kind] of H.entries) {
          if (kind === 'citizen') continue;
          if (kind === 'Topping') {
            // the constructor only sets the slots' state and active words (the matrices etc. are written when a topping is picked)
            const pt = H.NODE.Topping.ts(n);
            cmpObj({ bonus: pt.bonus, slots: pt.slots.map((q) => ({ state: q.state, active: q.active })) }, { bonus: c.nodes.Topping.bonus, slots: c.nodes.Topping.slots.map((q) => ({ state: q.state, active: q.active })) }, 'Topping');
          } else cmpObj(H.NODE[kind].ts(n), c.nodes[kind], `${kind}`);
        }
        for (const ci of c.citizens) {
          const n = ci.rec.ctrl.nodes.find((x) => x.kind === 'citizen');
          cmpObj({ state: n.state, slot: n.slot, steps: n.steps, prog: n.prog }, { state: ci.st.state, slot: ci.st.slot, steps: ci.st.steps, prog: ci.st.prog }, `citizen ${ci.rec.name}`);
          ck(n.rate === ci.rate || close(n.rate, ci.rate), `${ci.rec.name} rate ${n.rate} vs ${ci.rate}`);
          ck(ci.table === 0x955d58, 'citizen clip table pointer');
        }
        const mp = S.mama.pos, rm = S.mama.rec;
        cmpObj(mp, c.mamaPos, 'mama position'); ck(close(mp[0], rm.x) && close(mp[2], rm.z), 'mama position = her record');
        w.records.slice(0, E.nBase).forEach((r, i) => { if (r.anim) { ck(r.anim.clip === c.anims[i][0], `${r.name} start clip port ${r.anim.clip}, original ${c.anims[i][0]}`); cmpObj(r.anim.frame, c.anims[i][1], `${r.name} start frame`); } });
        cmpObj(Array.from(w.camera.c).slice(0, 6), c.camera, 'first camera');
        cmpObj(S.near, c.near, 'near plane after the constructor');
      }
      // ---- 1. a full winning game, every tick (dt = 1)
      { const E = make(11); play(E, 9000, 'win', 0, 'win', 1); notes.push(`win game: papa level ${E.S.papa.level}, score ${E.S.papa.score}, medal ${E.S.papa.medal}, result ${E.S.result}`); }
      // ---- 2. a losing game
      { const E = make(12); play(E, 9000, 'lose', 0, 'lose', 2); notes.push(`lose game: papa level ${E.S.papa.level}, score ${E.S.papa.score}, medal ${E.S.papa.medal}, result ${E.S.result}`); }
      // ---- 3. bot with random noise (wrong keys at wrong times: hits on Papa, misses, window hits, cheese at the citizen), several seeds
      for (let sd = 0; sd < 4; sd++) { const E = make(20 + sd); play(E, 2600, sd % 2 ? 'win' : 'lose', 0.08 + 0.04 * sd, `noise${sd}`, 100 + sd); }
      // ---- 4. pure random keys
      for (let sd = 0; sd < 2; sd++) { const E = make(40 + sd); play(E, 2500, null, 1, `rand${sd}`, 200 + sd); }
      // ---- 4b. rapid fire: the next topping is picked and thrown at once, several in the air at the same time (the fifth topping of a round)
      for (let sd = 0; sd < 3; sd++) { const E = make(60 + sd); play(E, 2000, 'rapid', 0, `rapid${sd}`, 300 + sd); }
      // ---- 4c. staged: a topping lands after the round is complete (thrown == count == 4): the original's out-of-range slot index aliases the score field (docs/re/gaps.md Z)
      for (let trial = 0; trial < 6; trial++) {
        const E = make(80 + trial), { S, w } = E;
        S.papa.level = 2 + (trial % 3);
        for (let i = 0; i < 600 && S.papa.state !== 2; i++) if (!step(E, 0, `alias${trial} wait t${i}`)) break;
        if (S.papa.state !== 2) { bad(`alias${trial}: Papa never reached the swing state`); continue; }
        const rnd = lcgRnd(900 + trial);
        S.papa.thrown = S.papa.count; S.papa.state = [6, 7, 8][trial % 3];
        const s0 = S.toppings.slots[0], h = S.papa.hand, tp = [4, 8, 2, 1][trial % 4];
        s0.state = 2; s0.active = 1; s0.type = tp; s0.dir = 0; s0.t = 0; s0.tpl = w.records.find((r) => r.name === ['TOP4', 'TOP1', 'TOP2', 'TOP3'][[4, 8, 2, 1].indexOf(tp)]);
        s0.start = [f32(h[12] + (rnd() - 0.5) * 0.8), f32(3.04 - 1.5 + rnd() * 1.5), -9]; s0.t = Math.floor((-1 - s0.start[2]) / 0.264) - 1 - Math.floor(rnd() * 2);
        S.flying = 1; S.papa.score = 1000 + trial;
        for (let i = 0; i < 40; i++) if (!step(E, 0, `alias${trial} t${i}`)) break;
        notes.push(`alias trial ${trial}: log ${S.log.slice(-2)}, score ${S.papa.score}, thrown ${S.papa.thrown}`);
      }
      // ---- 4d. the slug's and mama's states the zone code never reaches by itself (slug 4 / 5, mama 2 / 3 at odd moments): injected every few ticks
      { const E = make(90), { S } = E; const rnd = lcgRnd(77);
        for (let i = 0; i < 1200; i++) {
          if (i % 7 === 0) { S.slug.state = [0, 2, 3, 4, 5][Math.floor(rnd() * 5)]; S.mama.state = Math.floor(rnd() * 4); }
          if (!step(E, 0, `inject t${i}`)) break;
        }
      }
      // ---- 5. an earlier medal in the variables (the result flag follows the stored trophy), an earlier hi-score
      { const E = make(50, 1, { 0x3f: 2, 0xda: 9000 }); play(E, 9000, 'lose', 0, 'trophy', 3); notes.push(`lose with trophy 2: result ${E.S.result}, var 0x3f ${E.w.vars.get(0x3f)}, hi ${E.w.vars.get(0xda)}`); }
      stats.ticks1 = stats.ticks;
      notes.push(`dt=1: ${stats.ticks} ticks in ${Date.now() - t0} ms`);
      // ---- 6. the same at dt = 0.5 (DAT_008b1718 = 0.5 in the original, world.dt = 0.5 in the port: the fixed 60 Hz step the port will run): every time step must scale the same way
      { const E = make(111, 0.5); play(E, 9000, 'win', 0, 'win@0.5', 1); notes.push(`dt=0.5 win game: papa level ${E.S.papa.level}, score ${E.S.papa.score}, medal ${E.S.papa.medal}, result ${E.S.result}`); }
      { const E = make(120, 0.5); play(E, 2500, 'lose', 0.1, 'noise@0.5', 400); }
      { const E = make(130, 0.5); play(E, 2000, 'rapid', 0, 'rapid@0.5', 500); }
      notes.push(`dt=0.5: ${stats.ticks - stats.ticks1} ticks`);
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    notes.push(`states visited: Pepper ${[...stats.pepper].sort()}, Papa ${[...stats.papa].sort((a, b) => a - b)}, mama ${[...stats.mama].sort()}, slug ${[...stats.slug].sort()}, citizens ${[...stats.citizen].sort()}, topping slots ${[...stats.slot].sort()}`);
    notes.push(`time: original ${stats.tPass?.toFixed(0)} ms, port ${stats.tPort?.toFixed(0)} ms, compare ${stats.tCmp?.toFixed(0)} ms`);
    notes.push(`hand-made draw calls compared: ${stats.draws}`);
    notes.push(`toppings in the air at most ${stats.maxAir}, ticks with thrown > count: ${stats.over ?? 0}`);
    notes.push(`branches: ${JSON.stringify(stats.branches)}`);
    for (const [k, v] of known) notes.push(`KNOWN DEVIATION ${k}: ${v.count} x, first ${v.first}`);
    return { checked, failures, notes };
  },
};
