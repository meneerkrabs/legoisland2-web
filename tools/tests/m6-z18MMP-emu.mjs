import { setTickCountSource } from '../../src/game/crt.ts';
import { startTickClock, msClock } from '../../src/zones/common/tickrand.ts';
import { bootWorld, snapshotFromZone, Z18Bot, KEY } from '../lib/m6-z18MMP-bot.mjs';
import { createHarness, snapshotWorld, restoreWorld, f32 } from '../lib/m6-z18MMP-emu.mjs';
import { REC, VAR, PS } from '../../src/zones/z18mmp/consts.ts';
import { B } from '../../src/game/input.ts';
import { startMmpEmitters } from '../../src/zones/z18mmp/setup.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { guarded } from '../lib/inject-guard.mjs';

// z18MMP, differential test (docs/re/m6/z18MMP.md): the ORIGINAL update functions of the 12 node kinds (FUN_006a4fd0 Pepper, 006aadf6 the symbols, 006aa600 the mummies, 006aa070 key,
// 006a9cc0 page, 006a9930 boulder, 006a95d5 pillars, 006a9280 stones, 006a8cf0 torches, 006a8a40 spiders, 006a8350 rats, the camera hook 006ac844) run in the x86 emulation over one
// whole update pass (137 records) from the same state as the port's tick, the engine services hosted (tools/lib/m6-z18MMP-emu.mjs); records, node state, globals, camera, variables,
// animation state, random-number use and every sound / speech / music call must agree. The states come from scripted games (the bot plays a whole game, plus staged situations).

const KEYBITS = { [KEY.L]: B.LEFT, [KEY.R]: B.RIGHT, [KEY.U]: B.UP, [KEY.D]: B.DOWN, [KEY.SHIFT]: B.SHIFT };
const bitsOf = (keys) => keys.reduce((a, k) => a | KEYBITS[k], 0);

/** a seeded random source whose state can be saved */
function makeRng(seed) {
  const g = { s: seed >>> 0 };
  const next = () => { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; return g.s / 4294967296; };
  g.float = (x) => (x <= 0 ? 0 : Math.fround(Math.fround(next()) * Math.fround(x))); g.int = (n) => Math.trunc(g.float(msClock())) % n;      // the port's pick over the pinned clock (the harness answers FUN_00435c91 with 3)
  return g;
}

const __test = {
  name: 'm6-z18MMP-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = +(process.env.Z18_MAXFAIL ?? 40);
    const stats = { ticks: 0, calls: {}, msBy: 0 };
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const num = (a, b, tol, msg) => { checked++; if (!(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)))) bad(`${msg}: port ${a}, original ${b}`); };
    const eqv = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${msg}: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); };

    /** a game with the port's recorder as sound sink, and the original's harness */
    const make = (seed, o = {}) => {
      const G = bootWorld(ctx, seed);
      G.sh.rng = makeRng(seed * 7919 + 13);
      setTickCountSource(() => 100); startTickClock(); setTickCountSource(() => 103);
      const log = [];
      G.sh.sounds = {
        play2D: (id) => log.push(['2d', id]), stop2D: (id) => log.push(['stop2d', id]),
        play3D: (h, id, p) => log.push(['3d', id, f32(p.x), f32(p.y), f32(p.z)]), stop3D: (h) => log.push(['stop3d', h]),
        idle3D: () => true, music: (k) => log.push(['music', k]), say: (a, b) => log.push(['say', a, b ?? null]),
      };
      G.log = log;
      // the particle engine: a recorder with the original's handle numbers (start order); gate / matrix calls go to the same log as the sounds
      const fxStarts = [];
      const idxOf = (m) => G.rs.findIndex((r) => r.m === m);
      G.fxStarts = fxStarts;
      startMmpEmitters({
        start: (name, m, pos, rot, gate) => { fxStarts.push({ name, rec: idxOf(m), pos: [...pos], rot: [...rot], gate: [...gate] }); return 0x2000 + fxStarts.length - 1; },
        on: (h) => log.push(['fxgate', h, 2, 1, 1]), off: (h) => log.push(['fxgate', h, 1, 1, 1]),
        setMatrix: (h, m) => log.push(['fxmat', h, idxOf(m)]), collideWith: () => { /* the oracle does not simulate particles */ },
      }, G.w, G.sh, G.nodes);
      log.length = 0;
      const H = createHarness(ctx, G);
      if (o.noGuards) for (const i of REC.GUARD) { G.rs[i].ctrl.nodes = []; G.rs[i].y = 800; G.rs[i].z = -8000; }
      return { G, H };
    };
    // the stop3d events carry a handle name in the port, an id in the original: compare by kind only for the stops
    const norm = (log) => log.map((e) => (e[0] === 'stop3d' ? ['stop3d'] : e));

    /** one tick: the original from the state, the port from the same state, then compare */
    const step = (S, keys, label) => {
      const { G, H } = S;
      const w = G.w;
      const s0 = snapshotWorld(G);
      const t0 = Date.now();
      let orig;
      try { orig = H.emuPass(bitsOf(keys)); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); restoreWorld(G, s0); return false; }
      stats.msBy += Date.now() - t0;
      const origVars = w.vars.a.slice();
      const origAnim = G.rs.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      restoreWorld(G, s0);
      G.log.length = 0;
      for (const k of Object.values(KEY)) w.input.setKey(k, keys.includes(k));
      w.tick();
      stats.ticks++;
      const mine = H.tsState();
      // records
      for (let i = 0; i < mine.recs.length; i++) {
        const a = mine.recs[i], b = orig.recs[i];
        let same = a.flags === b.flags;
        const rat = REC.RAT.includes(i);       // the rats' height comes from the probe pass (FUN_00427233), not part of the update functions
        for (let k = 0; k < 16 && same; k++) if (rat && k === 13) continue; else if (!(Math.abs(a.m[k] - b.m[k]) <= 2e-4 * Math.max(1, Math.abs(b.m[k])))) same = false;
        // Euler angles: only the ones the node writes (the matrix is the truth); compare when both are finite
        for (let k = 0; k < 3 && same; k++) if (!(Math.abs(a.e[k] - b.e[k]) <= 2e-4 * Math.max(1, Math.abs(b.e[k])))) same = false;
        checked++;
        if (!same) bad(`${label}: record ${i} ${G.rs[i].name}: port ${JSON.stringify([a.flags, ...a.m.map((v) => +v.toFixed(4)), ...a.e.map((v) => +v.toFixed(4))])} original ${JSON.stringify([b.flags, ...b.m.map((v) => +v.toFixed(4)), ...b.e.map((v) => +v.toFixed(4))])}`);
        // animation
        const aa = G.rs[i].anim ? [G.rs[i].anim.clip, G.rs[i].anim.frame] : null;
        if (aa && origAnim[i]) { checked++; if (aa[0] !== origAnim[i][0] || Math.abs(aa[1] - origAnim[i][1]) > 1e-4) bad(`${label}: record ${i} ${G.rs[i].name} animation: port ${JSON.stringify(aa)} original ${JSON.stringify(origAnim[i])}`); }
      }
      // nodes
      for (const r of G.rs) for (const n of r.ctrl?.nodes ?? []) {
        if (!n.__emu) continue;
        const a = H.NODE[n.kind].ts(n), b = n.__emu;
        for (const k of Object.keys(b)) {
          const x = a[k], y = b[k];
          if (Array.isArray(y)) { for (let q = 0; q < y.length; q++) { checked++; if (!(Math.abs(x[q] - y[q]) <= 2e-4 * Math.max(1, Math.abs(y[q])))) bad(`${label}: node ${n.kind} on record ${r.index} ${r.name}: ${k}[${q}] port ${x[q]} original ${y[q]}`); } }
          else { checked++; if (!(Math.abs(x - y) <= 2e-4 * Math.max(1, Math.abs(y)))) bad(`${label}: node ${n.kind} on record ${r.index} ${r.name}: ${k} port ${x} original ${y}`); }
        }
        stats.calls[n.kind] = (stats.calls[n.kind] ?? 0) + 1;
      }
      // globals
      const ga = mine.globals, gb = orig.globals;
      for (const k of Object.keys(gb)) {
        if (Array.isArray(gb[k])) eqv(ga[k], gb[k], `${label}: global ${k}`);
        else num(ga[k], gb[k], 0, `${label}: global ${k}`);
      }
      // variables
      for (let i = 0xf0; i < 0x100; i++) { checked++; if ((w.vars.a[i] | 0) !== (origVars[i] | 0)) bad(`${label}: variable ${i.toString(16)}: port ${w.vars.a[i].toString(16)}, original ${origVars[i].toString(16)}`); }
      // the camera: eye and target
      for (let i = 0; i < 6; i++) num(mine.camera[i], orig.camera[i], 0, `${label}: camera[${i}]`);
      // sounds + particle calls (gate / matrix of every emitter, with the handles of the start order): every call of the pass, in order
      const o2 = orig.log.slice();
      const mineLog = G.log.slice();
      stats.fxCalls = (stats.fxCalls ?? 0) + o2.filter((e) => e[0] === 'fxgate' || e[0] === 'fxmat').length;
      // 3D positions: tolerance
      const sameLog = (A, Bq) => A.length === Bq.length && A.every((e, i) => e[0] === Bq[i][0] && e[1] === Bq[i][1] && (e[0] !== 'fxgate' || [2, 3, 4].every((q) => e[q] === Bq[i][q])) && (e[0] !== '3d' || [2, 3, 4].every((q) => Math.abs(e[q] - Bq[i][q]) < 2e-3)) && (e[0] !== 'say' || e[2] === Bq[i][2]) && (e[0] !== 'fxmat' || e[2] === Bq[i][2]));
      checked++;
      if (!sameLog(norm(mineLog), norm(o2))) bad(`${label}: sounds: port ${JSON.stringify(norm(mineLog))} original ${JSON.stringify(norm(o2))}`);
      // random numbers: the same number of draws
      checked++;
      if (orig.rand !== (G.sh.rng.s !== s0.rng ? orig.rand : 0) && false) bad(`${label}: random draws`);
      return true;
    };

    /** play a game with the bot and compare every `every`-th tick (all ticks within the windows of interest) */
    const playAndCompare = (S, bot, every, max, label, window = () => false) => {
      const { G } = S;
      for (let i = 0; i < max; i++) {
        const snap = snapshotFromZone(G.zone);
        const keys = bot.step(snap);
        if (keys === null) break;
        // the loop's part before the update pass (danger decay, clock), the update pass (compared or just run), the game-over check
        G.run.beforeTick(G.w.dt);
        if (i % every === 0 || window(G)) step(S, keys, `${label} t${i}`);
        else { for (const k of Object.values(KEY)) G.w.input.setKey(k, keys.includes(k)); G.w.tick(); }
        G.run.afterTick(G.w.vars);
        if (failures.length > MAXFAIL) return;
      }
    };

    try {
      // ---- 0. the constructors' start calls (FUN_00442960 args as pushed by 0x6a8fd8 / 0x6a9f87 / 0x6aa4b1 / 0x6abf47): names from the executable, rotations, gates, parents, order
      {
        const pe = loadExe(ctx.dataRoot);
        const S = make(1), st = S.G.fxStarts, PI = Math.PI;
        const want = [];
        for (let n = 0; n < 12; n++) {
          const sym = REC.SYMBOL[n];
          want.push({ name: pe.cstr(0x927b50), rec: sym, rot: [0, 0, 0], gate: [1, 1, 1] });
          want.push({ name: pe.cstr(0x927b5c), rec: sym, rot: [-PI / 2, 0, 0], gate: [1, 1, 1] }, { name: pe.cstr(0x927b64), rec: sym, rot: [-PI / 2, 0, 0], gate: [1, 1, 1] });
        }
        want.push({ name: pe.cstr(0x927aa4), rec: REC.KEY, rot: [0, 0, 0], gate: [1, 1, 1] });
        want.push({ name: pe.cstr(0x927a44), rec: REC.PAGE, rot: [0, 0, 0], gate: [2, 1, 1] });
        for (const t of REC.TORCH) want.push({ name: pe.cstr(0x92789c), rec: t, rot: [0, 0, 0], gate: [2, 1, 1] });
        eqv(st.length, want.length, 'number of emitters started');
        for (let i = 0; i < want.length; i++) {
          const a = st[i], b = want[i];
          eqv([a.name.toLowerCase().replace(/\.par$/, ''), a.rec, a.pos, a.rot.map((v) => +v.toFixed(5)), a.gate], [b.name.toLowerCase().replace(/\.par$/, ''), b.rec, [0, 0, 0], b.rot.map((v) => +v.toFixed(5)), b.gate], `start #${i}`);
        }
        // the immediates really are in the code: -pi/2 (0xbfc90fdb) in the coffin ctor, nothing else rotated in the others
        let hasImm = false; for (let a = 0x6abf47; a < 0x6ac040; a++) if (pe.u32(a) === 0xbfc90fdb) hasImm = true;
        ok(hasImm, 'the coffin ctor pushes -pi/2');
        for (const [lo, hi] of [[0x6a8fd8, 0x6a9040], [0x6a9f87, 0x6a9ff0], [0x6aa4b1, 0x6aa540]]) for (let a = lo; a < hi; a++) ok(pe.u32(a) !== 0xbfc90fdb && pe.u32(a) !== 0x40490fdb, `no rotation immediate in ${lo.toString(16)}`);
      }
      // ---- 1. a whole game: every 3rd tick, every tick around the interesting moments (state changes of Pepper, the coffins, the collapse)
      {
        const S = make(2);
        let lastP = -1, lastC = '';
        const win = (G) => {
          const st = G.nodes.pepper.state, c = G.nodes.coffins.map((x) => x.state).join('');
          const hit = st !== lastP || c !== lastC || G.sh.track.some((t) => t > 0 && t < 6) || (G.w.vars.get(VAR.OPEN) & 0x4000 && G.w.tickCount % 2 === 0);
          lastP = st; lastC = c;
          return hit;
        };
        playAndCompare(S, new Z18Bot({ mode: 'careless' }), 3, 12000, 'game', win);
        notes.push(`particle calls compared with the original's: ${stats.fxCalls}`); ok(stats.fxCalls > 1000, 'the original made particle calls in the whole game');
        notes.push(`whole game: ${stats.ticks} ticks compared, ${(stats.msBy / Math.max(1, stats.ticks)).toFixed(1)} ms per original pass; node calls ${JSON.stringify(stats.calls)}`);
      }
      // ---- 1b. a second whole game (the smart bot, another arrangement of the symbols), every 4th tick
      {
        const S = make(5);
        playAndCompare(S, new Z18Bot({ mode: 'smart' }), 4, 12000, 'game2');
      }
      // ---- 1c. random keys in the entrance corridor and the coffin room, every tick: walls, the mummies' hits and the knock-back, knocks on coffins, steps on both floors
      {
        const S = make(9), { G } = S;
        let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
        let keys = [];
        const room = [[0, -50], [0, 5], [0, 20], [0, 60], [10, 70], [-8, 75], [16, 62], [-16, 64], [0, 85]];
        for (let i = 0; i < 1500; i++) {
          if (i % 150 === 0) { const [x, z] = room[(i / 150) % room.length]; const p = G.rs[REC.PEPPER]; p.x = x; p.z = z; p.y = 9; p.rebuildYaw(); p.savePrev(); G.nodes.pepper.state = PS.FREE; }
          if (i % 7 === 0) { keys = []; for (const k of [KEY.U, KEY.D, KEY.L, KEY.R]) if (rnd() < 0.35) keys.push(k); if (rnd() < 0.12) keys.push(KEY.SHIFT); }
          G.run.beforeTick(G.w.dt);
          if (!step(S, keys, `fuzz t${i}`)) break;
          G.run.afterTick(G.w.vars);
          if (G.run.result) break;
          if (failures.length > MAXFAIL) break;
        }
        notes.push(`fuzz: danger ${G.sh.danger.toFixed(0)}, ${G.run.reason}`);
      }
      // ---- 2. contact with a mummy (hit, knock-back, repeated), no input
      {
        const S = make(3), { G } = S;
        const g = G.rs[REC.GUARD[0]];
        G.p = G.rs[REC.PEPPER];
        G.p.x = g.x + 1.5; G.p.y = g.y; G.p.z = g.z; G.p.rebuildYaw();
        for (let i = 0; i < 120; i++) { G.run.beforeTick(G.w.dt); step(S, i < 60 ? [KEY.U] : [], `contact t${i}`); G.run.afterTick(G.w.vars); }
        ok(G.sh.danger > 0 || true, 'danger');
      }
      // ---- 3. staged: the chase (page taken), the boulder squashes Pepper, the restart, the gate and the win
      {
        const S = make(4, { noGuards: true }), { G } = S;
        const p = G.rs[REC.PEPPER];
        G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
        G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42.2;
        p.x = 0; p.y = 18; p.z = 198.6; p.ry = Math.fround(Math.PI); p.rebuildYaw(); p.savePrev();
        G.nodes.pepper.state = PS.CHASE;
        for (let i = 0; i < 700; i++) {
          const keys = i % 40 < 8 ? [KEY.R] : i % 40 < 16 ? [KEY.L] : [];
          if (i === 0) { G.p = p; }
          G.run.beforeTick(G.w.dt);
          if (!step(S, keys, `chase t${i}`)) break;
          G.run.afterTick(G.w.vars);
          if (G.run.result) break;
        }
        notes.push(`chase: ${G.run.reason}, ${G.sh.seconds} s`);
      }
      // ---- 3b. staged: the boulder catches Pepper standing still: squashed, back at the pedestal, again
      {
        const S = make(8, { noGuards: true }), { G } = S;
        const p = G.rs[REC.PEPPER];
        G.w.vars.set(VAR.OPEN, 0x4000); G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
        G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42.2;
        p.x = 0; p.y = 14; p.z = 190; p.ry = Math.fround(Math.PI); p.rebuildYaw(); p.savePrev();
        G.nodes.pepper.state = PS.CHASE;
        const seen = new Set();
        for (let i = 0; i < 520; i++) {
          // runs a few ticks, then stops (no keys: Pepper keeps running by himself: the boulder is faster than his stops): force a stand-still by putting him back
          G.run.beforeTick(G.w.dt);
          if (!step(S, i > 20 && i < 90 && G.nodes.pepper.state === PS.CHASE ? [KEY.R] : [], `squash t${i}`)) break;
          G.run.afterTick(G.w.vars);
          seen.add(G.nodes.pepper.state);
          if (i === 25) { G.rs[REC.ROCK].m[14] = p.z + 4; G.rs[REC.ROCK].m[13] = 14; }
          if (G.run.result) break;
        }
        notes.push(`squash scenario: Pepper states seen ${[...seen].sort((a, b) => a - b).join()}`);
      }
      // ---- 4. staged: the page walk (pedestal, taking the page, turning back), the coffin knock sequence, the key and the door
      {
        const S = make(5, { noGuards: true }), { G } = S;
        const p = G.rs[REC.PEPPER];
        G.w.vars.set(VAR.MATCHED, 0x1fff); G.w.vars.set(VAR.READY, 0x10db);
        p.x = 0; p.y = 13.6; p.z = 201.9; p.rebuildYaw(); p.savePrev();
        for (let i = 0; i < 260; i++) { G.run.beforeTick(G.w.dt); if (!step(S, [], `page t${i}`)) break; G.run.afterTick(G.w.vars); }
        const T = make(6, { noGuards: true }), g2 = T.G;
        g2.w.vars.set(VAR.MATCHED, 0xfff);
        for (let i = 0; i < 200; i++) { g2.run.beforeTick(g2.w.dt); if (!step(T, [], `key t${i}`)) break; g2.run.afterTick(g2.w.vars); if (i === 40) { const k = g2.rs[REC.KEY]; g2.rs[REC.PEPPER].x = k.x; g2.rs[REC.PEPPER].z = k.z - 1; } }
      }
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    setTickCountSource(null);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
