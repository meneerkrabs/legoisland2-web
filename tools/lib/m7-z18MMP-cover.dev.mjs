import { setTickCountSource } from '../../src/game/crt.ts';
import { startTickClock, msClock } from '../../src/zones/common/tickrand.ts';
/** pin the shared clock (GetTickCount - base) to `ms` milliseconds */
const pinClock = (ms) => { setTickCountSource(() => 100); startTickClock(); setTickCountSource(() => 100 + ms); };
import { bootWorld, snapshotFromZone, Z18Bot, KEY } from './m6-z18MMP-bot.mjs';
import { createMmpHarness, snapshotWorld, restoreWorld, f32, CovSet } from './m7-z18MMP-emu.mjs';
import { REC, VAR, PS, SND } from '../../src/zones/z18mmp/consts.ts';
import { MmpRun, clockText, resultLines, applyResult } from '../../src/zones/z18mmp/run.ts';
import { B } from '../../src/game/input.ts';

/** the sound handles whose choice the code makes: DAT_05d5bxxx (the original's globals) -> the port's handle names; the order of the lists is the order of the original's tests */
const HANDLES = [[0x5d5bff0, 'colFall3'], [0x5d5bfe8, 'colFall1'], [0x5d5bfec, 'colFall2'], [0x5d5bfe4, 'colFall0'], [0x5d5bf4c, 'symSpinA'], [0x5d5bf48, 'symSpinB'], [0x5d5bf20, 'coffinOpenA'], [0x5d5bf1c, 'coffinOpenB']];
const KEYBITS = { [KEY.L]: B.LEFT, [KEY.R]: B.RIGHT, [KEY.U]: B.UP, [KEY.D]: B.DOWN, [KEY.SHIFT]: B.SHIFT };
const bitsOf = (keys) => keys.reduce((a, k) => a | KEYBITS[k], 0);
function makeRng(seed) {
  const g = { s: seed >>> 0 };
  const next = () => { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; return g.s / 4294967296; };
  g.float = (x) => (x <= 0 ? 0 : Math.fround(Math.fround(next()) * Math.fround(x))); g.int = (n) => Math.trunc(g.float(msClock())) % n;      // the port's pick: ftol(FUN_004388ae((float)(GetTickCount - base))) % n over the pinned clock
  return g;
}

export default {
  name: 'm7-z18MMP-cover',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = +(process.env.Z18_MAXFAIL ?? 40);
    const stats = { ticks: 0, cov: new CovSet() };
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    // float32 compare, tolerance 0 (WP-TIME: the port's nodes are bit-exact now): every compared number is identical (NaN = NaN)
    const ulp32 = (v) => { v = Math.abs(v); return v < 1e-30 ? 1e-45 : Math.pow(2, Math.floor(Math.log2(v)) - 23); };
    const maxErr = { rel: 0, at: '' };
    const close = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
    const num = (a, b, msg) => { checked++; if (!close(a, b)) bad(`${msg}: port ${a}, original ${b}`); };
    const eqv = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${msg}: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); };

    let S0;
    const make = (seed, dt, o = {}) => {
      const G = bootWorld(ctx, seed);
      G.w.dt = dt;
      G.sh.rng = makeRng(seed * 7919 + 13);
      pinClock(3);
      if (process.env.TRAP_RY) { const r = G.rs[121]; let v = r.ry; Object.defineProperty(r, 'ry', { get() { return v; }, set(x) { if (Math.fround(x) !== x) console.log('TRAP ry', x, new Error().stack.split('\n').slice(2, 4).join(' | ')); v = x; } }); }
      const log = [];
      G.sh.sounds = {
        play2D: (id) => log.push(['2d', id]), stop2D: (id) => log.push(['stop2d', id]),
        play3D: (h, id, p) => log.push(['3d', id, f32(p.x), f32(p.y), f32(p.z), h]), stop3D: (h) => log.push(['stop3d', h]),
        idle3D: (h) => !(G.busyNames?.has(h)), music: (k) => log.push(['music', k]), say: (a, b) => log.push(['say', a, b ?? null]),
      };
      G.log = log;
      G.sh.puzzleMusicArmed = true;      // (the zone game arms it when the intro is left)
      const H = createMmpHarness(ctx, G, { cov: stats.cov });
      // the original's handle numbers of the sound handles whose choice the code makes (global address -> the port's handle name, in the order of the original's tests)
      H.names = new Map(); H.addrOf = new Map();
      for (const [addr, name] of HANDLES) { H.names.set(H.mem.u32(addr), name); H.addrOf.set(name, H.mem.u32(addr)); }
      G.busyNames = new Set();
      S0 = { busy: (names) => { G.busyNames = new Set(names); H.busy = new Set(names.map((n) => H.addrOf.get(n))); } };
      if (o.noGuards) for (const i of REC.GUARD) { G.rs[i].ctrl.nodes = []; G.rs[i].y = 800; G.rs[i].z = -8000; }
      return { G, H, dt, busy: S0.busy };
    };
    const norm = (log) => log.map((e) => (e[0] === 'stop3d' ? ['stop3d'] : e));

    const step = (S, keys, label) => {
      const { G, H } = S;
      const w = G.w;
      const s0 = snapshotWorld(G);
      let orig;
      try { orig = H.emuPass(bitsOf(keys)); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); restoreWorld(G, s0); return false; }
      if (process.env.DBG === label) { const pn = G.nodes.pepper; console.log('DBG keys', keys, 'cam', Array.from(w.camera.c).slice(9,18), 'DBG pre vx,vz', pn.vx, pn.vz, 'sweeps', JSON.stringify(H.sweeps)); }
      const origVars = w.vars.a.slice();
      const origAnim = G.rs.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      restoreWorld(G, s0);
      G.log.length = 0;
      for (const k of Object.values(KEY)) w.input.setKey(k, keys.includes(k));
      w.tick();
      stats.ticks++;
      const mine = H.tsState();
      for (let i = 0; i < mine.recs.length; i++) {
        const a = mine.recs[i], b = orig.recs[i];
        let same = a.flags === b.flags, bk = -1;
        for (let k = 0; k < 16 && same; k++) if (!close(a.m[k], b.m[k])) { same = false; bk = k; }
        for (let k = 0; k < 3 && same; k++) if (!close(a.e[k], b.e[k])) { same = false; bk = 16 + k; }
        checked++;
        if (!same) { const pv = bk < 16 ? a.m[bk] : a.e[bk - 16], ov = bk < 16 ? b.m[bk] : b.e[bk - 16]; bad(`${label}: record ${i} ${G.rs[i].name} ${bk >= 0 ? (bk < 16 ? 'm[' + bk + ']' : 'euler[' + (bk - 16) + ']') : 'flags'}: port ${bk >= 0 ? pv : a.flags}, original ${bk >= 0 ? ov : b.flags} [euler port ${a.e} original ${b.e}]${bk >= 0 ? ` (${((pv - ov) / ulp32(ov)).toFixed(1)} ulp)` : ''}`); }
        const aa = G.rs[i].anim ? [G.rs[i].anim.clip, G.rs[i].anim.frame] : null;
        if (aa && origAnim[i]) { checked++; if (aa[0] !== origAnim[i][0] || !close(aa[1], origAnim[i][1])) bad(`${label}: record ${i} ${G.rs[i].name} animation: port ${JSON.stringify(aa)} original ${JSON.stringify(origAnim[i])}`); }
      }
      for (const r of G.rs) for (const n of r.ctrl?.nodes ?? []) {
        if (!n.__emu) continue;
        const a = H.NODE[n.kind].ts(n), b = n.__emu;
        for (const k of Object.keys(b)) {
          const x = a[k], y = b[k];
          if (Array.isArray(y)) { for (let q = 0; q < y.length; q++) num(x[q], y[q], `${label}: node ${n.kind} on record ${r.index} ${r.name}: ${k}[${q}]`); }
          else num(x, y, `${label}: node ${n.kind} on record ${r.index} ${r.name}: ${k}`);
        }
      }
      if (process.env.DBG === label) console.log('DBG pep', mine.recs[121].m.slice(12, 15), orig.recs[121].m.slice(12, 15), 'cam', mine.camera.slice(0, 6), orig.camera.slice(0, 6));
      const ga = mine.globals, gb = orig.globals;
      for (const k of Object.keys(gb)) { if (Array.isArray(gb[k])) eqv(ga[k], gb[k], `${label}: global ${k}`); else num(ga[k], gb[k], `${label}: global ${k}`); }
      { let d = -1; for (let i = 0; i < w.vars.a.length; i++) if ((w.vars.a[i] | 0) !== (origVars[i] | 0)) { d = i; break; } checked++; if (d >= 0) bad(`${label}: variable ${d.toString(16)}: port ${w.vars.a[d].toString(16)}, original ${origVars[d].toString(16)}`); }
      for (let i = 0; i < 6; i++) num(mine.camera[i], orig.camera[i], `${label}: camera[${i}]`);
      const o2 = orig.log.slice();      // (the torches play their handle from every torch node, in the original and in the port: compared call by call)
      const sameLog = (A, Bq) => A.length === Bq.length && A.every((e, i) => e[0] === Bq[i][0] && e[1] === Bq[i][1] && (e[0] !== '3d' || ([2, 3, 4].every((q) => close(e[q], Bq[i][q])) && (Bq[i][5] === undefined || H.names.get(Bq[i][5]) === undefined || H.names.get(Bq[i][5]) === e[5]))) && (e[0] !== 'say' || e[2] === Bq[i][2]));
      checked++;
      if (!sameLog(norm(G.log), norm(o2))) bad(`${label}: sounds: port ${JSON.stringify(norm(G.log))} original ${JSON.stringify(norm(o2))}`);
      return true;
    };

    // ---- event-driven comparison: a tick is run once by the port alone; when anything of interest happened in it (a variable, a state, a clip, a flag or a sound other than the
    // ambient ones changed) the tick is rerun from the snapshot with the original next to it (`step`); every `every`-th tick is compared anyway
    const sigOf = (G) => {
      const sh = G.sh, n = G.nodes;
      return JSON.stringify([n.pepper.state, n.pepper.cur, n.pepper.playing, n.coffins.map((c) => c.state), sh.track, Array.from(G.w.vars.a), G.rs.map((r) => r.flags & 0xffff), [REC.PEPPER, ...REC.GUARD, ...REC.MUMMY_OF].map((i) => G.rs[i].anim?.clip ?? -1),
        n.rock.musicStarted, n.key.doorOpen, n.page.started, n.pillars.map((q) => q.state), n.spiders.map((q) => q.state)]);
    };
    const ambient = (e) => e[0] === '3d' && (e[1] === 0x146 || e[1] === 0x147 || e[1] === 0x18d);
    let skipped = 0;
    const tick = (S, keys, label, every = 1) => {
      const { G } = S;
      S.n = (S.n ?? 0) + 1;
      if (every <= 1 || S.n % every === 0) return step(S, keys, label);
      const s0 = snapshotWorld(G), before = sigOf(G);
      G.log.length = 0;
      for (const k of Object.values(KEY)) G.w.input.setKey(k, keys.includes(k));
      G.w.tick();
      const eventful = sigOf(G) !== before || G.log.some((e) => !ambient(e));
      if (!eventful) { skipped++; return true; }
      restoreWorld(G, s0);
      return step(S, keys, label);
    };
    const playAndCompare = (S, bot, every, max, label) => {
      const { G } = S;
      for (let i = 0; i < max; i++) {
        const keys = bot.step(snapshotFromZone(G.zone));
        if (keys === null) break;
        G.run.beforeTick(S.dt);
        tick(S, keys, `${label} t${i}`, every);
        G.run.afterTick(G.w.vars);
        if (failures.length > MAXFAIL) return;
      }
    };
    /** n ticks with keys from keysFn(i), a hook before each tick, the loop's clock / danger part and game-over check around the update pass */
    const drive = (S, n, keysFn, label, o = {}) => {
      const { G } = S;
      for (let i = 0; i < n; i++) {
        o.before?.(i, G);
        G.run.beforeTick(S.dt);
        const ok1 = tick(S, keysFn(i, G), `${label} t${i}`, o.every ?? 1);
        G.run.afterTick(G.w.vars);
        if (o.stop?.(i, G)) break;
        if (!ok1 || failures.length > MAXFAIL) break;
      }
    };
    const put = (G, x, y, z, ry) => { const p = G.rs[REC.PEPPER]; p.x = x; p.y = y; p.z = z; if (ry !== undefined) p.ry = Math.fround(ry); p.rebuildYaw(); p.savePrev(); G.nodes.pepper.state = PS.FREE; return p; };
        let tmark = Date.now(), tlabel = 'start';
    const lap = (label) => { notes.push(`[time] ${tlabel}: ${Date.now() - tmark} ms, ${stats.ticks} ticks so far`); tmark = Date.now(); tlabel = label; };
    const lcg = (seed) => { let q = seed >>> 0; return () => { q = (Math.imul(q, 1103515245) + 12345) >>> 0; return q / 4294967296; }; };
    try {
      for (const dt of [1, 0.5]) {
        lap('1');
        // ---- 1. whole games (every tick around events, otherwise every 9th): the careless bot (a wrong pair first), the smart bot
        for (const [seed, mode] of [dt === 1 ? [2, 'careless'] : [5, 'smart']]) {
          const S = make(seed, dt), t0 = stats.ticks;
          playAndCompare(S, new Z18Bot({ mode }), 40, dt === 1 ? 2600 : 5200, `game${seed} dt${dt}`);
          notes.push(`game ${seed} (${mode}) dt ${dt}: ${stats.ticks - t0} ticks compared, ${S.G.run.reason}, ${S.G.sh.seconds} s`);
        }
        lap('1c');
        // ---- 1c. random keys in the rooms, every tick
        {
          const S = make(9, dt), { G } = S, R = lcg(12345);
          let keys = [];
          const room = [[0, -50], [0, 5], [0, 20], [0, 60], [10, 70], [-8, 75], [16, 62], [-16, 64], [0, 85]];
          drive(S, dt === 1 ? 700 : 900, (i) => { if (i % 7 === 0) { keys = []; for (const k of [KEY.U, KEY.D, KEY.L, KEY.R]) if (R() < 0.35) keys.push(k); if (R() < 0.12) keys.push(KEY.SHIFT); } return keys; }, `fuzz dt${dt}`,
            { before: (i) => { if (i % 150 === 0) { const [x, z] = room[(i / 150) % room.length]; put(G, x, 9, z); } }, stop: () => G.run.result !== 0 });
        }
      }

      for (const dt of [1, 0.5]) {
        const sc = dt === 1 ? 1 : 2;      // ticks per unit of the dt = 1 scenarios
        lap('2');
        // ---- 2. contact with a mummy (hit, knock-back, repeated), no input
        {
          const S = make(3, dt), { G } = S, g = G.rs[REC.GUARD[0]];
          put(G, g.x + 1.5, g.y, g.z);
          drive(S, 120 * sc, (i) => (i < 60 * sc ? [KEY.U] : []), `contact dt${dt}`);
        }
        lap('3');
        // ---- 3. the chase (page taken), the boulder squashes Pepper, the restart, the gate and the win
        {
          const S = make(4, dt, { noGuards: true }), { G } = S, p = G.rs[REC.PEPPER];
          G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
          G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42.2;
          put(G, 0, 18, 198.6, Math.PI); G.nodes.pepper.state = PS.CHASE;
          drive(S, 700 * sc, (i) => (i % (40 * sc) < 8 * sc ? [KEY.R] : i % (40 * sc) < 16 * sc ? [KEY.L] : []), `chase dt${dt}`, { stop: () => G.run.result !== 0 });
          notes.push(`chase dt ${dt}: ${G.run.reason}, ${G.sh.seconds} s`);
        }
        lap('3b');
        // ---- 3b. the boulder catches Pepper standing still: squashed, back at the pedestal, again
        {
          const S = make(8, dt, { noGuards: true }), { G } = S, p = G.rs[REC.PEPPER], seen = new Set();
          G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
          G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42.2;
          put(G, 0, 14, 190, Math.PI); G.nodes.pepper.state = PS.CHASE;
          drive(S, 520 * sc, (i) => (i > 20 * sc && i < 90 * sc && G.nodes.pepper.state === PS.CHASE ? [KEY.R] : []), `squash dt${dt}`,
            { before: (i) => { seen.add(G.nodes.pepper.state); if (i === 25 * sc) { G.rs[REC.ROCK].m[14] = p.z + 4; G.rs[REC.ROCK].m[13] = 14; } }, stop: () => G.run.result !== 0 });
          notes.push(`squash dt ${dt}: Pepper states seen ${[...seen].sort((a, b) => a - b).join()}`);
        }
        lap('4');
        // ---- 4. the page walk (pedestal, taking the page, turning back) and the key
        {
          const S = make(5, dt, { noGuards: true }), { G } = S;
          G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
          put(G, 0, 13.6, 201.9);
          drive(S, 260 * sc, () => [], `page dt${dt}`);
          const T = make(6, dt, { noGuards: true }), g2 = T.G;
          g2.w.vars.set(VAR.MATCHED, 0xfff);
          drive(T, 200 * sc, () => [], `key dt${dt}`, { before: (i) => { if (i === 40 * sc) { const k = g2.rs[REC.KEY]; put(g2, k.x, g2.rs[REC.PEPPER].y, k.z - 1); } } });
        }
      }

      // =============================================================================== gap scenarios (each reaches code the old oracle never ran)
      for (const dt of [1, 0.5]) {
        const sc = dt === 1 ? 1 : 2;
        lap('D1');
        // ---- D1. the stick limit in the last stretch (z > 200) and the clamp of the chase state: Pepper pushed against +-x
        for (const [x0, key] of [[5.5, KEY.R], [-5.5, KEY.L], [5.5, KEY.L], [-5.5, KEY.R]]) {
          const S = make(11, dt, { noGuards: true }), { G } = S;
          put(G, x0, 14, 203);
          drive(S, 12 * sc, () => [key], `clamp z>200 x${x0} ${key} dt${dt}`);
          const S2 = make(12, dt, { noGuards: true });
          S2.G.w.vars.set(VAR.OPEN, 0x4000); S2.G.w.vars.set(VAR.MATCHED, 0x1fff); S2.G.w.vars.set(VAR.READY, 0x10db); S2.G.rs[REC.PAGE].flags &= ~2; S2.G.rs[REC.TRAP].y = 42.2;
          put(S2.G, x0, 14, 120, Math.PI); S2.G.nodes.pepper.state = PS.CHASE;
          drive(S2, 12 * sc, () => [key], `clamp chase x${x0} ${key} dt${dt}`);
        }
        lap('D2');
        // ---- D2. contact with each of the twelve coffin mummies (shown, clip 0x5a), the three roaming ones, the danger meter's cap
        for (let n = 0; n < 12; n++) {
          const S = make(20 + n, dt, { noGuards: true }), { G } = S, m = G.rs[REC.MUMMY_OF[n]];
          m.flags |= 2; m.anim.start(0x5a, 0);
          put(G, m.x + 0.6, m.y, m.z - 0.5);
          if (n % 4 === 3) G.sh.danger = 130;
          drive(S, 8 * sc, () => [], `coffin mummy ${n} dt${dt}`);
        }
        for (let g = 0; g < 3; g++) {
          const S = make(40 + g, dt), { G } = S, m = G.rs[REC.GUARD[g]];
          put(G, m.x + 1.2, m.y, m.z + 1.0); G.sh.danger = g === 2 ? 125 : 0;
          drive(S, 40 * sc, (i) => (i < 20 * sc ? [KEY.U] : []), `guard ${g} dt${dt}`);
        }
        lap('D3');
        // ---- D3. the walk-to-pedestal state with the collapse running (BUMP: x beyond the walls), the pit (respawn of Pepper and of the boulder)
        for (const [st, x0] of [[PS.TURN_BACK, 4.6], [PS.TO_PEDESTAL, -4.6], [PS.TAKE_PAGE, 4.5]]) {
          const S = make(50 + st, dt, { noGuards: true }), { G } = S;
          G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, st === PS.TURN_BACK ? 0x1fff : 0xfff); G.w.vars.set(VAR.READY, 0x10db);
          put(G, x0, 20, 150); G.nodes.pepper.state = st; if (st === PS.TO_PEDESTAL) G.w.vars.or(VAR.READY, 0x4000);
          drive(S, 160 * sc, () => [], `bump state ${st} dt${dt}`);
        }
        {
          const S = make(60, dt, { noGuards: true }), { G } = S;
          put(G, 0, 14, 120); G.rs[REC.PEPPER].y = -13;
          G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, 0x1fff); G.rs[REC.ROCK].m[13] = -13;
          drive(S, 30 * sc, () => [], `pit dt${dt}`);
        }
      }

      for (const dt of [1, 0.5]) {
        const sc = dt === 1 ? 1 : 2;
        lap('D3b');
        // ---- D3b. TURN_BACK walking into a corner (the second sweep hits again while dirz = -8: BUMP), BUMP standing in the open (the anim ends: RESTART)
        {
          const S = make(70, dt, { noGuards: true }), { G } = S;
          put(G, -5, 30, 41, Math.PI); G.nodes.pepper.state = PS.TURN_BACK; G.rs[REC.PEPPER].anim.start(0x51, 0);
          drive(S, 30 * sc, () => [], `turn back into a corner dt${dt}`);
          const T = make(71, dt, { noGuards: true }), g2 = T.G;
          put(g2, 0, 20, 100); g2.nodes.pepper.state = PS.BUMP; g2.rs[REC.PEPPER].anim.start(0x50, 0);
          g2.w.vars.set(VAR.MATCHED, 0x1fff);
          drive(T, 200 * sc, () => [], `bump to restart dt${dt}`);
        }
        lap('D4');
        // ---- D4. the rats: far from home (they turn back), and the knife edge `ry - angle == 0.087266` exactly (a float equality: the angle is then set, not stepped)
        {
          const S = make(72, dt, { noGuards: true }), { G } = S, rat = G.rs[REC.RAT[1]], rn = rat.ctrl.nodes.find((n) => n.kind === 'mmpRat');
          put(G, 0, 20, -40);
          let edge = 0;
          drive(S, 500 * sc, () => [], `rats dt${dt}`, { before: (i) => {
            if (i % (150 * sc) === 5) {       // put the rat 6 away from its home, mode walk, and try to make diff == RAT_TURN
              rat.x = rn.home[0] + 6; rat.z = rn.home[2] + 3; rat.savePrev(); rn.mode = 0; rn.cycles = 3;
              const dx = rn.home[0] - rat.x, dz = rn.home[2] - rat.z, ang = Math.atan2(dx, dz), T = 0.0872659981250763;
              let ry = f32(ang + T);
              for (let k = 0; k < 40 && f32(ry - f32(ang)) !== T; k++) ry = f32(ry + (f32(ry - f32(ang)) < T ? 1 : -1) * 2 ** (Math.floor(Math.log2(Math.abs(ry))) - 23));
              if (f32(ry - f32(ang)) === T) edge++;
              rat.ry = Math.fround(ry); rat.setEuler(rat.rx, rat.ry, rat.rz, rat.x, rat.y, rat.z);
            } } });
          notes.push(`rats dt ${dt}: float-equality injections that hit diff == 0.087266 exactly: ${edge}`);
        }
        lap('D6');
        // ---- D6. the column-fall sound picks a free one of its four handles (FUN_006a9540), the coffin sounds pick between two (FUN_006aad6a / 006aadb0): every busy pattern
        {
          const S = make(73, dt, { noGuards: true }), { G } = S, pil = G.nodes.pillars[0];
          G.w.vars.set(VAR.OPEN, 0x4000);
          const names = ['colFall3', 'colFall1', 'colFall2', 'colFall0'];
          for (let mask = 0; mask < 16; mask++) {
            S.busy(names.filter((_, i) => mask & (1 << i)));
            pil.state = 0; G.rs[REC.PILLAR[0]].rz = 0; G.rs[REC.PILLAR[0]].m[0] = 1;
            put(G, 0, 12, 170);
            drive(S, 2, () => [], `column sound busy ${mask.toString(2)} dt${dt}`);
          }
          S.busy([]);
          for (const [openBusy, spinBusy] of [[false, false], [true, false], [false, true], [true, true]]) {
            const T = make(74, dt, { noGuards: true });
            T.busy([...(openBusy ? ['coffinOpenA'] : []), ...(spinBusy ? ['symSpinA'] : [])]);
            T.G.w.vars.or(VAR.OPEN, 1 << 5); put(T.G, 0, 12, 60);
            drive(T, 20 * sc, () => [], `coffin sounds open ${openBusy} spin ${spinBusy} dt${dt}`);
          }
        }
        lap('D7');
        // ---- D7. two matching symbols with a name the laugh table does not know (no laugh), the puzzle music armed
        {
          const S = make(75, dt, { noGuards: true }), { G } = S, nm = G.rs[REC.SYMBOL[0]].name;
          const b = REC.SYMBOL.findIndex((i, k) => k !== 0 && G.rs[i].name === nm);
          G.rs[REC.SYMBOL[0]].name = 'XXXX'; G.rs[REC.SYMBOL[b]].name = 'XXXX';
          put(G, 0, 12, 60);
          drive(S, 120 * sc, () => [], `unknown symbol pair dt${dt}`, { before: (i) => { if (i === 2) G.w.vars.or(VAR.OPEN, 1); if (i === 30 * sc) G.w.vars.or(VAR.OPEN, 1 << b); } });
        }
        lap('D8');
        // ---- D8. Shift standing between two coffins (two coffins within reach: the lookup finds no single coffin: no knock), then next to one
        {
          const S = make(76, dt, { noGuards: true }), { G } = S, sy = REC.SYMBOL.map((i) => G.rs[i]);
          let best = [0, 1, 1e9];
          for (let a = 0; a < 12; a++) for (let c = a + 1; c < 12; c++) { const d = Math.hypot(sy[a].x - sy[c].x, sy[a].z - sy[c].z); if (d < best[2]) best = [a, c, d]; }
          const mx = (sy[best[0]].x + sy[best[1]].x) / 2, mz = (sy[best[0]].z + sy[best[1]].z) / 2;
          notes.push(`two coffins within reach at the same time: closest symbols ${best[2].toFixed(2)} apart (reach 2.83 each): midpoint ${[mx, mz].map((v) => v.toFixed(2))}`);
          put(G, mx, 12, mz);
          drive(S, 10 * sc, (i) => [KEY.SHIFT], `shift between two coffins dt${dt}`);
        }
      }

      // =============================================================================== the loop's own functions, run natively next to the port's MmpRun
      {
        lap('L');
        const S = make(90, 1, { noGuards: true }), { G, H } = S, cpu = H.cpu, mem = H.mem, sh = G.sh;
        const call = (addr) => { H.log.length = 0; cpu.steps = 0; H.reset(); H.GL.write(); return cpu.call(addr, [], { maxSteps: 100000 }); };
        const plog = () => { const l = G.log.slice(); G.log.length = 0; return l; };
        // FUN_006a21b0 (the countdown beeps, time up, caught, escaped): seconds x beep counter x danger x var 0xfc
        let n21 = 0;
        for (const sec of [0, 5, 289, 290, 291, 299, 300, 301, 400]) for (const warn of [10, 9, 5, 1, 0]) for (const danger of [-0.2, 0, 144.9, 145, 150]) for (const fc of [0, 0x4000, 0xfff]) {
          sh.seconds = sec; sh.warnNext = warn; sh.danger = f32(danger); G.w.vars.set(VAR.NEAR, fc);
          const ret = call(0x6a21b0), o = H.log.slice(), ow = H.GL.read().warn;
          const run = new MmpRun(sh); sh.seconds = sec; sh.warnNext = warn; sh.danger = f32(danger); G.log.length = 0;
          const over = run.afterTick(G.w.vars);
          const lab = `FUN_006a21b0 sec ${sec} warn ${warn} danger ${danger} var ${fc.toString(16)}`;
          eqv(over ? 1 : 0, ret === 0 ? 0 : 1, `${lab}: game over`); eqv(plog(), o, `${lab}: sounds`); eqv(sh.warnNext >>> 0, ow >>> 0, `${lab}: beep counter`); n21++;
        }
        // FUN_006a2290 (the score) for every second count, lost and won
        for (let sec = 0; sec <= 400; sec++) for (const fc of [0, 0x4000]) {
          sh.seconds = sec; G.w.vars.set(VAR.NEAR, fc);
          const ret = call(0x6a2290) | 0;
          eqv(new MmpRun(sh).score(G.w.vars), ret, `FUN_006a2290 score at ${sec} s, escaped ${fc !== 0}`);
        }
        // FUN_006a4f60 (the clock text "%d:%02d" of 300 - seconds, the gauge value)
        cpu.hooks.set(0x46055f, () => {});
        for (let sec = -20; sec <= 330; sec++) { sh.seconds = sec; sh.danger = f32(sec / 7); call(0x6a4f60); eqv(clockText(sec), mem.cstr(0x5d4dd60), `FUN_006a4f60 clock at ${sec} s`); num(sh.danger, mem.f32(0x5d4e138), 'FUN_006a4f60 gauge'); }
        // the clock / danger part of the loop (0x6a295c .. 0x6a29cd, run in place on a frame), dt 1 / 0.5 and two awkward steps: the float32 stores
        const STOP = { stop: true };
        const frame = 0x7ff00000 - 0x2000;
        for (const dt of [1, 0.5, 0.3, 0.7]) {
          const d32 = f32(dt);
          for (let k = 0; k < 400; k++) {
            const frac = f32((k % 61) * 0.5 + (k % 3) * 0.1), danger = k % 5 === 0 ? -0.5 : f32(k * 0.37), stop = k % 17 === 0 ? 1 : 0, sec = k;
            mem.wf32(0x8b1718, d32); mem.wf32(0x8b171c, 1 / d32); mem.wf32(frame - 0x10, frac); mem.wf32(0x5d5bef0, danger); mem.w32(0x5d5bff8, stop); mem.w32(0x5d5beb0, sec);
            cpu.regs[4] = frame - 0x100; cpu.regs[5] = frame; cpu.eip = 0x6a295c; cpu.top = 0; cpu.steps = 0;
            try { cpu.run({ maxSteps: 1000, trace: (c, at) => { if (at === 0x6a29cd) throw STOP; } }); } catch (e) { if (e !== STOP) throw e; }
            const run = new MmpRun(sh); sh.danger = danger; sh.frac = frac; sh.seconds = sec; sh.stopClock = stop !== 0;
            run.beforeTick(d32);
            const lab = `loop clock dt ${dt} k ${k}`;
            eqv(sh.danger, mem.f32(0x5d5bef0), `${lab}: danger`); eqv(sh.seconds, mem.r32(0x5d5beb0), `${lab}: seconds`); eqv(sh.frac, mem.f32(frame - 0x10), `${lab}: tick fraction`);
          }
        }
        sh.stopClock = false;
        // FUN_006a2355 (the end banner): the lines (text, y), the hi-score / trophy writes, for scores around the medal limits and old hi-scores
        {
          const lines = [];
          cpu.hooks.set(0x439c6f, (c) => { lines.push([c.arg(2) < 0x1000 ? '' : mem.cstr(c.arg(2)), c.arg(6)]); });
          cpu.hooks.set(0x460a3d, () => {});
          cpu.hooks.set(0x85ac00, null); cpu.hooks.delete(0x85ac00);
          for (const sec of [10, 60, 61, 120, 200, 215, 216, 260, 299]) for (const won of [false, true]) for (const hi of [0, 5000, 9999]) {
            sh.seconds = sec; G.w.vars.set(VAR.NEAR, won ? 0x4000 : 0); G.w.vars.set(VAR.HISCORE, hi); G.w.vars.set(VAR.TROPHY, 0);
            lines.length = 0; call(0x6a2355);
            const oHi = G.w.vars.get(VAR.HISCORE), oTro = G.w.vars.get(VAR.TROPHY);
            G.w.vars.set(VAR.HISCORE, hi); G.w.vars.set(VAR.TROPHY, 0);
            const run = new MmpRun(sh), score = run.score(G.w.vars), res = resultLines(run.won(G.w.vars), score);
            applyResult(G.w.vars, run.won(G.w.vars), score);
            const lab = `FUN_006a2355 ${sec} s won ${won} hi ${hi}`;
            // original lines: [score text (y 50), (medal sprite y 100), message lines ...]; compare the message ids and y
            const msgs = lines.filter((l) => /^ADSGMM/.test(l[0])).map((l) => [l[0], l[1]]);
            eqv(res.lines, msgs, `${lab}: message lines`); eqv([G.w.vars.get(VAR.HISCORE), G.w.vars.get(VAR.TROPHY)], [oHi, oTro], `${lab}: hi-score and trophy`);
          }
        }
        notes.push(`loop functions run natively: FUN_006a21b0 ${n21} cases, FUN_006a2290 802 cases, FUN_006a4f60 351 cases, the clock / danger block 1600 cases (dt 1, 0.5, 0.3, 0.7), FUN_006a2355 54 cases`);
      }
      // =============================================================================== the mummy-hit sound variant: ftol(FUN_004388ae(GetTickCount - base)) % 3
      {
        lap('R');
        const variants = [];
        for (const T of [3, 1000, 12345, 987654, 0]) for (let seed = 1; seed <= 12; seed++) {
          const S = make(100 + seed, 1, { noGuards: true }), { G, H } = S, m = G.rs[REC.MUMMY_OF[2]];
          m.flags |= 2; m.anim.start(0x5a, 0); put(G, m.x + 0.5, m.y, m.z - 0.5);
          H.tickMs = T; G.run.beforeTick(1);
          const s0 = snapshotWorld(G), orig = H.emuPass(0); restoreWorld(G, s0);
          { // the port's pick over the same pinned clock: the same squeal as the original's ftol(rand * tick) % 3
            pinClock(T); G.log.length = 0; G.w.tick();
            const mine = G.log.filter((e) => e[0] === '2d' && SND.SQUEAL.includes(e[1])).map((e) => SND.SQUEAL.indexOf(e[1]));
            const idO = orig.log.filter((e) => e[0] === '2d' && SND.SQUEAL.includes(e[1])).map((e) => SND.SQUEAL.indexOf(e[1]));
            eqv(mine, idO, `the port's squeal variant at tick ${T} ms, seed ${seed}`);
            restoreWorld(G, s0); pinClock(3);
          }
          const id = orig.log.filter((e) => e[0] === '2d' && SND.SQUEAL.includes(e[1])).map((e) => SND.SQUEAL.indexOf(e[1]));
          const draw = H.rands.find((r) => r[0] === (T <= 0 ? 0 : T));
          const expect = draw ? Math.trunc(draw[1]) % 3 : 0;
          eqv(id, [expect], `squeal variant at tick ${T} ms, seed ${seed}: the original's choice is ftol(rand * tick) % 3`);
          variants.push([T, id[0], expect]);
        }
        // the distribution of the original's choice over the 32768 values of rand() against the port's uniform int(3), for tick values of a real run
        const dist = [3, 1000, 60000, 150000, 299000].map((T) => { const c = [0, 0, 0]; for (let k = 0; k <= 32767; k++) c[Math.trunc(k / 32767 * T) % 3]++; return `T=${T}: ${c.map((v) => (100 * v / 32768).toFixed(2)).join('/')} %`; });
        notes.push(`the mummy-hit squeal (FUN_006a4fd0, FUN_00435c91 = GetTickCount - base) is ftol(rand/32767 * milliseconds) % 3: the port's default source reads the shared clock (src/zones/common/tickrand.ts) and now makes the same pick (compared at 5 clock values x 12 seeds); distribution of the pick over the 32768 values of rand(): ${dist.join('; ')}`);
      }
    } catch (e) { bad(`test crashed: ${e.stack || e}`); }
    notes.push(`event-driven compare skipped ${skipped} uneventful ticks`);
    if (process.env.MMP_COV) globalThis.process.getBuiltinModule('node:fs').writeFileSync(process.env.MMP_COV, JSON.stringify(Array.from(stats.cov.buf).flatMap((v, i) => (v ? [i + 0x400000] : []))));
    setTickCountSource(null);
    return { checked, failures, notes };
  },
};
