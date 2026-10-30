import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { B } from '../../src/game/input.ts';
import '../../src/zones/z28HAT.ts';
import { REC, VAR, WINCH, BRONTY, HAT_SOUNDS, K, HatShared, findRecords, medalOf, resultLines, medalText, applyResult } from '../../src/zones/z28hat/rules.ts';
import { prepareHat, hatSounds, hatSnapshot, hatUpdate, hatGlobals, RIGS } from '../../src/zones/z28hat/game.ts';
import { DINO, fx } from '../../src/zones/z28hat/nodes.ts';
import { shadowPoints } from '../../src/zones/z28hat/shadow.ts';
import { setRandomSource } from '../../src/zones/parachute/util.ts';
import { makePlan, hatBotStep, KEY } from '../lib/hat-bot.mjs';
import { createHatHarness, snapshotWorld, restoreWorld, quantize, SPEC, KIND_OF_PORT, f32 } from '../lib/m7-z28HAT-emu.mjs';

// z28HAT, differential test (WP-VERIFY, docs/re/m6/z28HAT.md "Differential test"): the ORIGINAL code of the ten nodes (balloon + camera, winch, big dinosaurs, babies, Bronty, Mr Hates, fireball,
// sandbags, pterodactyl, Pepper's pre-render), their constructors, the zone's attach function FUN_00791990 and the loop's HUD part FUN_007928a0 runs in the x86 emulation over one update pass
// from the same state as one tick of the port (tools/lib/m7-z28HAT-emu.mjs); records, node fields, the zone's globals, variables, camera, animation state, random draws, HUD strings and every
// sound / speech / music-fade call must agree. Every scenario runs at dt = 1 and dt = 0.5 (`world.dt`).

/** a seeded keyed random source (tick, record, draw index): both sides draw the same integer */
function makeKeyed(seed, w) {
  const g = { seed: seed >>> 0, rec: 0, k: 0, counts: new Map(), seq: false, s: 1 };
  g.begin = (rec) => { g.rec = rec; g.k = 0; };
  g.draw = () => {
    g.counts.set(g.rec, (g.counts.get(g.rec) ?? 0) + 1);
    if (g.seq) { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; return (g.s >>> 8) % 32768; }
    let h = Math.imul(g.seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(w.tickCount + 1, 0xc2b2ae35) ^ Math.imul(g.rec + 7, 0x27d4eb2f) ^ Math.imul(g.k++ + 3, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) % 32768;
  };
  return g;
}
function lcg(seed) { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)] }; }
const hex = (n) => '0x' + n.toString(16);
/** FRB1 / FRB2 / FRB3: the port shows flame sheets in place of the particle emitter `burp.par` (flags 0x10 / 0x2 differ from the original's 0): known */
const FLAME = new Set([22, 63, 64]);
/** FRB2 / FRB3 are moved by the port only (the original never touches them) */
const PORT_ONLY = new Set([63, 64]);
/** the pterodactyl's heading is atan2 of the difference of two float32 positions one step (0.95 at dt 0.5) apart: its float32 rounding (3.8e-6 each at |x| ~ 60) shows up as up to ~2e-5 rad */
const PTER_TOL = 0;

export default {
  name: 'm7-z28HAT-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const stats = { ticks: 0, ms: 0, kinds: {}, events: {}, deviations: {}, states: {} };
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const tolOf = (b) => (Math.abs(b) < 1.2e-38 ? 3e-45 : 0);     // bit-exact (denormals: the x87 rounds the 24-bit mantissa before denormalising)       // bit-exact: the port rounds like the original's 24-bit x87
    const ulp32 = (v) => { v = Math.abs(v); return v < 1e-30 ? 1e-45 : Math.pow(2, Math.floor(Math.log2(v)) - 23); };
    const num = (a, b, msg) => { checked++; if (!(Math.abs(a - b) <= tolOf(b))) bad(`${msg}: port ${a}, original ${b}`); };
    const eq = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${msg}: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); };
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z28HAT');
    const total = pe.u32(0x94000c);

    /** a port game on the zone (prepared), the recorder as sound sink and speech, the keyed random source */
    const make = (seed, dt, o = {}) => {
      const L = loadZone(ctx, 'z28HAT');
      const w = L.world;
      w.dt = dt;
      const rk = makeKeyed(seed * 7919 + 13, w);
      const events = [];
      const G = { w, L, rk, seed, arch, events, S: null, nodes: null };
      G.cols = w.records.map((r) => r.colObj);
      G.soundIdOf = (name) => HAT_SOUNDS[name].id;
      if (o.prepare !== false) {
        // the constructors' random draws come one after the other (sequential mode), the tick's by (tick, record, draw)
        rk.seq = true; rk.s = (seed * 2654435761) >>> 0;
        setRandomSource(() => (rk.draw() + 0.5) / 32768);
        fx.rumble = 0; fx.fireball.length = 0;
        const sound = hatSounds(null);
        sound.play = (n) => events.push(['2d', HAT_SOUNDS[n].id]);
        sound.at = (n, p) => events.push(['3d', HAT_SOUNDS[n].id, f32(p[0]), f32(p[1]), f32(p[2])]);
        sound.stop = (n) => events.push(['stop', HAT_SOUNDS[n].id]);
        sound.rate = () => {};
        const { shared, nodes } = (o.before?.(w), hatGlobals.winchLast = o.keepGlobals ? hatGlobals.winchLast : 0, prepareHat(w, arch, sound, { total }));
        G.S = shared; G.nodes = nodes;
        shared.say = (a, b) => { events.push(['say', a, b ?? null]); shared.spoken.push(a); if (b) shared.spoken.push(b); return true; };
        shared.onFade = (f) => events.push(['fade', f32(f)]);
        events.length = 0;
        rk.seq = false;
        for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) { const u = n.update.bind(n); n.update = (ww, rec, c) => { rk.begin(rec.index); return u(ww, rec, c); }; }
      } else { G.S = new HatShared(findRecords(w.records), hatSounds(null)); }
      G.mut = w.records.filter((r) => r.ctrl || r.anim || r.index === REC.PEPP || [REC.PIZ4, 22, 63, 64].includes(r.index));
      G.still = w.records.map((r) => ({ m: r.m.slice(), flags: r.flags & 0xffff }));
      return G;
    };
    const newScenario = (seed, dt) => {
      const G = make(seed, dt);
      const H = createHatHarness(ctx, G);
      H.loadFood();
      if (process.env.HAT_COV) H.cov = (stats.cov ??= new Set());
      return { G, H, w: G.w, dt, seed, prev: 0 };
    };

    // ============================================================ the set-up: FUN_007918a0 + FUN_00791990 run natively against prepareHat
    {
      const A = make(1, 1, { prepare: false });
      const w = A.w, rs = w.records;
      // the loader's anim instances (clip 1; FUN_007a6bf3 + FUN_007a6bf3's tail), without the constructor effects
      const rigs = new Map();
      const rig = (n) => { if (!rigs.has(n)) { const e = arch.find(`anim/${n}.blk`); rigs.set(n, e ? parseBlk(arch.read(e)) : null); } return rigs.get(n); };
      for (const { rec, rig: name } of RIGS) { const r = rs[rec], blk = rig(name); if (r && blk) { if (!r.anim) r.anim = new AnimInstance(blk); r.anim.start(1, 0); } }
      A.mut = rs.filter((r) => true);
      setRandomSource(() => (A.rk.draw() + 0.5) / 32768);
      A.rk.seq = true; A.rk.s = (1 * 2654435761) >>> 0;
      const HA = createHatHarness(ctx, A);
      let init = null;
      try { init = HA.emuInit(); } catch (e) { bad(`the original's set-up failed: ${e.stack || e}`); }
      const P = make(1, 1);
      if (init) {
        const pr = P.w.records;
        const kinds = {}; for (const a of init.attaches) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
        notes.push(`set-up: ${init.attaches.length} zone nodes attached by FUN_00791990 ${JSON.stringify(kinds)}; other attaches (not the zone's): ${init.unknown.map((u) => `${u[0]}:${hex(u[1])}`).join(' ')}`);
        // the attach list: record -> node kind, gates
        for (const a of init.attaches) {
          const spec = SPEC[a.kind], pn = pr[a.rec].ctrl?.nodes.find((n) => n.kind === spec.port);
          ok(!!pn, `set-up: record ${a.rec} ${pr[a.rec].name} has the port's ${spec.port} node`);
          if (!pn) continue;
          eq([pn.var, pn.mask, pn.value], [a.var, a.mask, a.value], `set-up: gate of ${a.kind} on record ${a.rec}`);
          const on = init.nodes.get(a.rec).state, mine = HA.portNode(a.kind, pn), un = init.nodes.get(a.rec).uninit;
          for (const f of spec.fields) {
            if (un.has(f[1])) { stats.uninit = stats.uninit ?? new Set(); stats.uninit.add(`${a.kind}.${f[1]}`); continue; }
            // the heading of the dinosaurs / babies is drawn by the constructors (compared through the record's matrix); the uninitialised bytes of a new dinosaur (+0x47) are 0xcd in the debug heap
            if (f[1] === 'f3' || Array.isArray(on[f[1]])) { for (let i = 0; i < 3; i++) num(mine[f[1]][i], on[f[1]][i], `set-up ${a.kind} on record ${a.rec} ${pr[a.rec].name}: ${f[1]}[${i}]`); }
            else num(mine[f[1]], on[f[1]], `set-up ${a.kind} on record ${a.rec} ${pr[a.rec].name}: ${f[1]}`);
          }
          if (a.kind === 'dino') eq(mine.roar, on.roar, `set-up dino ${a.rec}: roar sound`);
        }
        const attachedRecs = new Set(init.attaches.map((a) => a.rec));
        for (const r of pr) for (const n of r.ctrl?.nodes ?? []) if (KIND_OF_PORT[n.kind]) { checked++; if (!attachedRecs.has(r.index)) bad(`set-up: the port has a ${n.kind} node on record ${r.index} ${r.name} that the original does not attach`); }
        // records after the set-up (flags, matrices incl. the random headings, collision)
        for (let i = 0; i < pr.length; i++) {
          const r = pr[i], a = init.recs[i];
          checked++;
          if (!FLAME.has(i) && (r.flags & 0xffff) !== (a.flags & 0xffff)) bad(`set-up: record ${i} ${r.name} flags: port 0x${(r.flags & 0xffff).toString(16)}, original 0x${a.flags.toString(16)}`);
          for (let k = 0; k < 16; k++) num(r.m[k], a.m[k], `set-up: record ${i} ${r.name} matrix[${k}]`);
          eq(r.colObj ? 1 : 0, a.col, `set-up: record ${i} ${r.name} collision object`);
        }
        for (const { rec } of RIGS) { const q = pr[rec].anim, o = rs[rec].anim; eq([q?.clip, q?.frame], [o?.clip, o?.frame], `set-up: animation of record ${rec} ${pr[rec].name} (clip, frame)`); }
        for (let i = 0; i < 6; i++) num(P.w.camera.c[i], init.camera[i], `set-up: camera[${i}]`);
        eq([P.w.vars.get(VAR.BRONTY), P.w.vars.get(VAR.CONTROL), P.w.vars.get(VAR.WINCH)], [w.vars.get(VAR.BRONTY), w.vars.get(VAR.CONTROL), w.vars.get(VAR.WINCH)], 'set-up: variables 0xfb / 0xfc / 0xfa');
        for (const [k, v] of Object.entries(init.globals)) { if (k === 'text' || k === 'left' || k === 'icon') continue; eq(Array.isArray(v) ? P.S[k].map((x) => f32(x)) : (typeof P.S[k] === 'boolean' ? (P.S[k] ? 1 : 0) : P.S[k]), v, `set-up: global ${k}`); }
        notes.push(`set-up: ${pr.length} records compared (flags, matrix, collision), ${RIGS.length} animation starts, ${init.attaches.length} constructors run natively`);
      }
    }


    // ============================================================ the per-tick comparison
    const maskOf = (m) => m;
    const step = (S, held, label) => {
      const { G, H, w } = S;
      const rs = w.records, Sh = G.S;
      G.events.length = 0; G.rk.counts.clear();
      const s0 = snapshotWorld(G);
      const prevHeld = w.input.held;
      const t0 = Date.now();
      let orig;
      try { orig = H.emuPass(held, prevHeld); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); restoreWorld(G, s0); G.events.length = 0; return false; }
      stats.ms += Date.now() - t0;
      const origAnim = rs.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      const origVars = w.vars.a.slice();
      G.rk.counts.clear();
      restoreWorld(G, s0);
      G.events.length = 0;
      w.input.setVirtual(held);
      w.tick();
      const hud = hatUpdate(w);
      stats.ticks++;
      const portEvents = G.events.slice();
      // ---- records
      const qOf = new Map(s0.recs.map((q) => [q.i, q]));
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i], q = qOf.get(i);
        if (PORT_ONLY.has(i)) continue;
        if (!q) {
          const st = G.still[i];
          checked++;
          if ((orig.recs[i] && (orig.recs[i].flags !== st.flags || orig.recs[i].m.some((v, k) => v !== st.m[k]))) || (r.flags & 0xffff) !== st.flags || r.m[12] !== st.m[12] || r.m[13] !== st.m[13] || r.m[14] !== st.m[14]) bad(`${label}: static record ${i} ${r.name} changed (port ${r.flags}, original ${JSON.stringify(orig.recs[i])})`);
          continue;
        }
        const b = orig.recs[i] ?? { m: Array.from(q.m), e: [q.rx, q.ry, q.rz], flags: q.flags & 0xffff, col: q.colObj ? 1 : 0, variant: q.variant | 0 };
        let still = i !== REC.PTER && (r.flags & 0xffff) === (q.flags & 0xffff) && b.flags === (q.flags & 0xffff) && r.rx === q.rx && r.ry === q.ry && r.rz === q.rz && b.e[0] === q.rx && b.e[1] === q.ry && b.e[2] === q.rz && (r.colObj ? 1 : 0) === (q.colObj ? 1 : 0) && b.col === (q.colObj ? 1 : 0);
        for (let k = 0; k < 16 && still; k++) if (r.m[k] !== q.m[k] || b.m[k] !== q.m[k]) still = false;
        if (still) { checked++; if (r.anim && origAnim[i]) { checked++; if (r.anim.clip !== origAnim[i][0] || Math.abs(r.anim.frame - origAnim[i][1]) > tolOf(origAnim[i][1])) bad(`${label}: record ${i} ${r.name} animation: port ${JSON.stringify([r.anim.clip, r.anim.frame])}, original ${JSON.stringify(origAnim[i])}`); } continue; }
        checked++;
        if (!FLAME.has(i) && (r.flags & 0xffff) !== b.flags) bad(`${label}: record ${i} ${r.name} flags: port 0x${(r.flags & 0xffff).toString(16)}, original 0x${b.flags.toString(16)}`);
        checked++; if ((r.colObj ? 1 : 0) !== b.col) bad(`${label}: record ${i} ${r.name} collision object: port ${r.colObj ? 'on' : 'off'}, original ${b.col ? 'on' : 'off'}`);
        // the rotation entries are sin / cos of float32 angles that grow without a wrap (the babies add up to pi at every wall they meet): the original's angle is rounded to float32 at every addition, the
        // port's is not: allowed 2 ulp of the angle on top of the float32 tolerance
        const angTol = 0;
        const mt = (k) => (i === REC.PTER ? Math.max(tolOf(b.m[k]), PTER_TOL) : [12, 13, 14, 3, 7, 11, 15].includes(k) ? tolOf(b.m[k]) : tolOf(b.m[k]) + angTol);
        let bm = false;
        for (let k = 0; k < 16; k++) { checked++; if (!(Math.abs(r.m[k] - b.m[k]) <= mt(k))) bm = true; }
        if (bm) { const d = []; for (let k = 0; k < 16; k++) if (!(Math.abs(r.m[k] - b.m[k]) <= mt(k))) d.push(`[${k}] ${r.m[k]} vs ${b.m[k]}`); bad(`${label}: record ${i} ${r.name} matrix: port vs original ${d.join(', ')}`); }
        const e = [r.rx, r.ry, r.rz];
        // the pterodactyl's node only rebuilds the matrix (FUN_0043a340): the original leaves the Euler fields alone, the port keeps its heading in ry (nothing reads it)
        if (i !== REC.PTER) for (let k = 0; k < 3; k++) { checked++; if (!(Math.abs(e[k] - b.e[k]) <= tolOf(b.e[k]))) bad(`${label}: record ${i} ${r.name} euler[${k}]: port ${e[k]}, original ${b.e[k]}`); }
        if (r.anim && origAnim[i]) { checked++; if (r.anim.clip !== origAnim[i][0] || Math.abs(r.anim.frame - origAnim[i][1]) > tolOf(origAnim[i][1])) bad(`${label}: record ${i} ${r.name} animation: port ${JSON.stringify([r.anim.clip, r.anim.frame])}, original ${JSON.stringify(origAnim[i])}`); }
      }
      // ---- nodes
      for (const [n, o] of orig.perNode) {
        const mine = H.portNode(o.kind, n);
        for (const k of Object.keys(o.state)) {
          const x = mine[k], y = o.state[k];
          if (o.kind === 'ptera' && k === 'heading') { checked++; if (!(Math.abs(x - y) <= PTER_TOL)) bad(`${label}: ptera heading: port ${x}, original ${y}`); continue; }
          if (Array.isArray(y)) for (let q = 0; q < y.length; q++) num(x[q], y[q], `${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: ${k}[${q}]`);
          else num(x, y, `${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: ${k}`);
        }
        const pd = G.rk.counts.get(o.rec) ?? 0;
        checked++; if (pd !== o.draws) bad(`${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: random draws port ${pd}, original ${o.draws}`);
        stats.kinds[o.kind] = (stats.kinds[o.kind] ?? 0) + 1;
        if (o.state.state !== undefined) stats.states[`${o.kind}${o.state.state}`] = (stats.states[`${o.kind}${o.state.state}`] ?? 0) + 1;
      }
      for (const q of [...Sh.recs.dinos, ...Sh.recs.babies]) if (q.y > 1e30) stats.noGround = (stats.noGround ?? 0) + 1;
      // ---- variables, globals, HUD
      for (const v of [0xfa, 0xfb, 0xfc, VAR.HISCORE, VAR.TROPHY]) { checked++; if ((w.vars.a[v] | 0) !== (origVars[v] | 0)) bad(`${label}: variable 0x${v.toString(16)}: port ${w.vars.a[v]}, original ${origVars[v]}`); }
      const pg = H.portGlobals();
      for (const k of Object.keys(pg)) {
        if (Array.isArray(pg[k])) for (let q = 0; q < 3; q++) num(pg[k][q], orig.globals[k][q], `${label}: global ${k}[${q}]`);
        else eq(pg[k], orig.globals[k], `${label}: global ${k}`);
      }
      eq([hud.score, hud.left, hud.leftIcon], [orig.globals.text, orig.globals.left, orig.globals.icon], `${label}: HUD (score, left, icon)`);
      for (let i = 0; i < 6; i++) num(w.camera.c[i], orig.camera[i], `${label}: camera[${i}]`);
      // ---- sounds / speech / fade in order
      const oe = orig.log;
      const same = oe.length === portEvents.length && oe.every((e, i) => { const q = portEvents[i]; return e.length === q.length && e.every((v, k) => (typeof v === 'number' && ((e[0] === '3d' && k >= 2) || e[0] === 'fade') ? Math.abs(v - q[k]) <= tolOf(v) : v === q[k])); });
      checked++;
      if (!same) bad(`${label}: events: port ${JSON.stringify(portEvents)}, original ${JSON.stringify(oe)}`);
      for (const e of portEvents) { const k = e[0] === 'fade' ? 'fade' : e[0] + (e[1] ?? ''); stats.events[k] = (stats.events[k] ?? 0) + 1; }
      return true;
    };
    const play = (S, n, label, keys, pre, every = 1) => {
      const { G, w } = S;
      for (let i = 0; i < n; i++) {
        if (pre?.(i) === 'stop') break;
        const held = keys(i);
        if (i % every === 0) { if (!step(S, held, `${label} t${i}`)) return false; }
        else { G.events.length = 0; w.input.setVirtual(held); w.tick(); hatUpdate(w); G.events.length = 0; }
        if (failures.length > MAXFAIL) return false;
      }
      return true;
    };

    // ---- 0b. the balloon's shadow: FUN_00796d72 natively (flag 2 of SHAD, FUN_0043ebe0(SHAD model, 2, balloon record + 0x40, 0), FUN_00444480): the 15 dwords it hands over against shadowPoints()
    {
      const bits = (v) => new Uint32Array(new Float32Array([v]).buffer)[0];
      const fl = (u) => new Float32Array(new Uint32Array([u]).buffer)[0];
      for (const dt of [1, 0.5]) {
        const S = newScenario(31, dt), plan = makePlan({});
        let n = 0;
        play(S, 600, `shadow bot dt${dt}`, () => hatBotStep(hatSnapshot(S.w), plan), (i) => {
          if (i % 20 !== 0) return;
          const rec = S.G.S.recs.hotb;
          const pad = { w12: [0, 0x00001234, 0][i % 3], w13: [0x07d80000, 0x00000f1c, 0][(i >> 2) % 3], w14: [1, 0x00010001, 0x0100][(i >> 3) % 3], col: [0x00c81230, 0x01234560, 0x0b100000][i % 3], ctrl: [0x00c9a410, 0x02345670, 0][(i >> 1) % 3] };
          let r;
          try { r = S.H.shadowRun(rec.index, pad); } catch (e) { bad(`shadow hook failed: ${e.stack || e}`); return 'stop'; }
          const mine = shadowPoints(rec);
          ok(r.cap && r.cap.mode === 2 && r.cap.arg4 === 0 && r.ptrOk, `shadow t${i}: FUN_0043ebe0(model, 2, balloon + 0x40, 0): ${JSON.stringify(r.cap && { ...r.cap, words: 0 })} ptrOk ${r.ptrOk} fx ${r.fx}`);
          ok((r.flags80 & 2) !== 0 && r.fx.includes(0x444480), `shadow t${i}: SHAD flag 2 set, FUN_00444480 called`);
          if (!r.cap) return 'stop';
          for (let k = 0; k < 15; k++) {
            const o = r.cap.words[k];
            if ([0, 1, 2, 3, 4, 5, 10, 11].includes(k)) ok(bits(mine[k]) === o, `shadow t${i} word ${k}: port 0x${bits(mine[k]).toString(16)}, original 0x${o.toString(16)}`);
            else ok(mine[k] === 0 && Math.abs(fl(o)) < 1e-18, `shadow t${i} word ${k}: original ${fl(o)} (a heap address / flag / header word: below 1e-18, the port uses 0)`);
          }
          n++;
        }, 1);
        notes.push(`shadow hook dt ${dt}: ${n} draws compared (balloon y ${S.G.S.recs.hotb.y.toFixed(1)}, heading ${S.G.S.recs.hotb.ry.toFixed(3)})`);
      }
    }

    // ---- 1. whole games with the bot (it flies to each dinosaur, hooks, carries, lets go, drops the sandbags)
    for (const [seed, dt, every, cap, opts] of [[1, 1, 4, 9000, {}], [2, 0.5, 8, 22000, {}]]) {
      const S = newScenario(seed, dt);
      const plan = makePlan(opts);
      let over = 0;
      const t0 = stats.ticks;
      play(S, cap, `bot${seed} dt${dt}`, () => hatBotStep(hatSnapshot(S.w), plan), () => { if (S.G.S.result !== 0 && ++over > 40) return 'stop'; }, every);
      notes.push(`bot ${seed} dt ${dt}: ${stats.ticks - t0} ticks compared (every ${every}), score ${S.G.S.score}, delivered ${S.G.S.delivered}, result ${S.G.S.result}, trophy ${S.w.vars.get(VAR.TROPHY)}`);
    }


    // ---- helpers for the injected scenarios (the shared state is the port's own: whatever is set here is the input of both sides)
    const R_ = (G) => G.S.recs;
    const keysOf = (R, o = {}) => {
      let m = 0;
      const { pc = 0.15, left = 0.3, right = 0.3, up = 0.5, down = 0.2, shift = 0.05 } = o;
      return () => {
        if (R.next() < pc) { m = 0; if (R.next() < left) m |= B.LEFT; if (R.next() < right) m |= B.RIGHT; if (R.next() < up) m |= B.UP; else if (R.next() < down) m |= B.DOWN; }
        m &= ~B.SHIFT; if (R.next() < shift) m |= B.SHIFT;
        return m;
      };
    };
    /** put the balloon over (x, z) with a small momentum */
    const park = (S, x, z, R) => { const h = S.G.S.recs.hotb; h.x = x; h.z = z; S.G.S.mom = [f32((R?.next() - 0.5) * 0.4 || 0), 0, f32((R?.next() - 0.5) * 0.4 || 0)]; };
    const place = (S, name, R, dx = 0, dz = 0) => { const r = S.G.S.recs[name]; park(S, r.x + dx, r.z + dz, R); };

    // ---- 2. free balloon flights: random keys, random knock-backs, jumps to places of the valley (walls, the drop zone, Bronty, the nest, the dinosaurs)
    for (const [dt, seed, n] of [[1, 11, 500], [1, 12, 400], [0.5, 13, 600]]) {
      const S = newScenario(seed, dt), R = lcg(seed * 17 + 1), kg = keysOf(R, { shift: 0.08 });
      const rec = S.G.S.recs;
      const places = () => [rec.drop, rec.bron, rec.babies[0], ...rec.dinos, rec.pter];
      play(S, n, `flight${seed} dt${dt}`, kg, (i) => {
        if (i % 60 === 59) { const q = R.pick(places()); park(S, q.x + (R.next() - 0.5) * 60, q.z + (R.next() - 0.5) * 60, R); }
        if (i % 90 === 45) { S.w.vars.set(VAR.CONTROL, 0); S.G.S.push = [f32((R.next() - 0.5) * 2), 0, f32((R.next() - 0.5) * 2)]; S.G.nodes.balloon.hits = R.int(5); S.G.nodes.balloon.timer = 15; }
        if (i % 120 === 100) S.w.vars.set(VAR.WINCH, R.int(4));
        if (i % 75 === 30) { S.w.vars.set(VAR.WINCH, WINCH.CARRY); S.G.S.mom = [f32((R.next() - 0.5) * 3), 0, f32((R.next() - 0.5) * 3)]; }
      });
    }
    // ---- 3. the hook over each dinosaur and over the nest: lowering, hooking, carrying, letting go, falling, landing (inside and outside the drop zone), blinking out
    for (const [dt, len] of [[1, 180], [0.5, 300]]) {
      for (const tgt of ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'nest']) {
        const S = newScenario(21 + tgt.charCodeAt(1), dt), R = lcg(tgt.charCodeAt(1) * 31 + dt * 7);
        const rec = S.G.S.recs, t = tgt === 'nest' ? { x: S.G.S.nest[0], z: S.G.S.nest[2] } : rec.dinos[+tgt[1]];
        park(S, t.x + (R.next() - 0.5) * 6, t.z + (R.next() - 0.5) * 6, null);
        S.w.vars.set(VAR.WINCH, WINCH.LOWER); S.G.S.stegSpeech = R.int(3); S.G.S.tricSpeech = R.int(2);
        let released = false, pressAt = -1;
        const far = (tgt === 'd0' && dt === 1) || (tgt === 'nest' && dt === 0.5);
        play(S, len, `hook ${tgt} dt${dt}`, (i) => {
          const carrying = S.G.S.carrying;
          if (carrying && i > 90 && !released && (far || R.next() < 0.1)) {
            // the hook follows the balloon one tick late: move the balloon first, press three ticks later
            released = true; pressAt = i + 3;
            const q = far ? 0.9 : R.next();
            if (q < 0.4) park(S, rec.drop.x + (R.next() - 0.5) * 40, rec.drop.z + (R.next() - 0.5) * 40, null); else if (q < 0.8) park(S, rec.bron.x + 100 + R.next() * 50, rec.bron.z + R.next() * 50, null); else park(S, 90000, -90000, null);
          }
          return released && i >= pressAt && carrying ? B.SHIFT : 0;
        });
      }
    }
    // ---- 4. Bronty: every state of var 0xfb with the balloon facing / not facing, near and far, with the eat count and the delivered count at their edges; then random jumps between states
    for (const [dt, scale] of [[1, 1], [0.5, 0.6]]) {
      const S = newScenario(31 + dt * 2, dt), R = lcg(31 + dt * 5), kg = keysOf(R, { shift: 0.02 }), Sh = S.G.S, rec = Sh.recs;
      let trial = 0;
      for (const v of [0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 4, 0, 3, 5]) {
        const mode = trial++;
        // the first state 3 runs with the eat count 3 and dinosaurs missing (-> runs up his back), the second with all delivered (-> freed)
        Sh.delivered = mode === 4 || mode === 12 ? Sh.total : R.pick([0, 5]); Sh.allDone = Sh.delivered >= Sh.total;
        Sh.eatCount = mode === 3 || mode === 4 || mode === 12 ? 3 : R.int(3); Sh.score = R.pick([1200, 6000]);
        const ang = R.next() * Math.PI * 2, dist = R.pick([40, 70, 100, 150]);
        park(S, rec.bron.x + Math.sin(ang) * dist, rec.bron.z + Math.cos(ang) * dist, null);
        S.w.vars.set(VAR.BRONTY, v); rec.bron.ry = R.pick([rec.bron.ry, 8, -8, 12, -12, 3.5]);
        play(S, Math.round((v === 5 ? 420 : 150) * scale), `bronty v${v} dt${dt}`, () => 0, (i) => { if (i === 60) park(S, rec.bron.x + Math.sin(ang + 2) * R.pick([30, 66, 75, 110]), rec.bron.z + Math.cos(ang + 2) * 70, null); });
      }
      play(S, Math.round(800 * scale), `bronty random dt${dt}`, kg, (i) => {
        if (i % 35 === 3) { const ang = R.next() * Math.PI * 2, dist = R.pick([20, 55, 66, 72, 90, 140]); park(S, rec.bron.x + Math.sin(ang) * dist, rec.bron.z + Math.cos(ang) * dist, R); }
        if (i % 110 === 7) { S.w.vars.set(VAR.BRONTY, R.int(9)); Sh.eatCount = R.int(5); }
        if (i % 140 === 70) { Sh.delivered = R.pick([0, 5, 11]); Sh.allDone = Sh.delivered >= Sh.total; Sh.score = R.pick([0, 1000, 2400, 2500, 4900, 5000, 7400, 7500, 9500, 10000]); S.w.vars.set(VAR.TROPHY, R.int(4)); }
      });
    }

    // ---- 5. the sandbags: everything is down, Shift over / beside Bronty's head, hits and misses, the end
    for (const dt of [1, 0.5]) {
      const S = newScenario(41, dt), R = lcg(77 + dt), Sh = S.G.S, rec = Sh.recs;
      Sh.delivered = Sh.total; Sh.allDone = true; Sh.score = 7000;
      S.w.vars.set(VAR.BRONTY, BRONTY.IDLE);
      play(S, 560 * (dt === 1 ? 1 : 2), `sandbags dt${dt}`, (i) => (i % 40 === 5 ? B.SHIFT : 0), (i) => {
        if (i % 40 === 0) { const m = S.G.nodes.bronty; const mouth = rec.bron; const off = R.pick([0, 2, 5, 7, 9, 14, 30]); const a = R.next() * 6.28; park(S, mouth.x + Math.sin(a) * off, mouth.z + Math.cos(a) * off, null); }
        if (i % 160 === 100 && S.w.vars.get(VAR.BRONTY) === BRONTY.FREED) S.w.vars.set(VAR.BRONTY, BRONTY.IDLE);
      });
    }
    // ---- 6. the fireball: Bronty in his stance with the balloon far away; the balloon / the hook / a wall in its way; a carried dinosaur dropped by the hit
    for (const [dt, seed] of [[1, 51], [1, 52], [0.5, 53]]) {
      const S = newScenario(seed, dt), R = lcg(seed * 3), Sh = S.G.S, rec = Sh.recs;
      play(S, 560 * (dt === 1 ? 1 : 2), `fireball${seed} dt${dt}`, keysOf(R, { up: 0, left: 0, right: 0, shift: 0 }), (i) => {
        if (i % 150 === 0) {
          S.w.vars.set(VAR.BRONTY, BRONTY.STANCE);
          const ang = R.pick([0, 0.4, 3.1, 4.2, R.next() * 6.28]), dist = R.pick([80, 100, 140, 200]);
          park(S, rec.bron.x + Math.sin(ang) * dist, rec.bron.z + Math.cos(ang) * dist, null);
          if (R.next() < 0.5) { Sh.carrying = true; S.w.vars.set(VAR.WINCH, WINCH.CARRY); }
          S.G.nodes.bronty.cur = 3;
        }
      });
    }
    // ---- 6b. the fireball against the hook: the balloon high above Bronty's mouth with a long rope, so the fireball's line meets the hook first
    for (const [dt, seed] of [[1, 54], [0.5, 55]]) {
      const S = newScenario(seed, dt), R = lcg(seed * 5), Sh = S.G.S, rec = Sh.recs;
      play(S, 500 * (dt === 1 ? 1 : 2), `fireball hook${seed} dt${dt}`, () => 0, (i) => {
        if (i % 100 === 0) {
          S.w.vars.set(VAR.BRONTY, BRONTY.STANCE); S.G.nodes.bronty.cur = 3;
          const a = R.next() * 6.28;
          park(S, rec.bron.x + Math.sin(a) * 100, rec.bron.z + Math.cos(a) * 100, null);
          rec.hotb.y = rec.bron.y + R.pick([70, 85, 100]);
          S.G.nodes.winch.len = R.pick([50, 70, 90]); S.w.vars.set(VAR.WINCH, WINCH.TOP);
        }
      });
    }
    // ---- 6c. a fireball that meets the hook (the balloon is put so that the hook hangs right in front of the flying fireball), and a fireball hit while babies / a dinosaur hang on the hook
    for (const dt of [1, 0.5]) {
      const S = newScenario(56, dt), R = lcg(56 + dt), Sh = S.G.S, rec = Sh.recs, fb = S.G.nodes.fireball;
      play(S, 500 * (dt === 1 ? 1 : 2), `fireball into the hook dt${dt}`, () => 0, (i) => {
        if (i % 100 === 0) { S.w.vars.set(VAR.BRONTY, BRONTY.STANCE); S.G.nodes.bronty.cur = 3; const a = R.next() * 6.28; park(S, rec.bron.x + Math.sin(a) * 100, rec.bron.z + Math.cos(a) * 100, null); }
        if (fb.active && fb.t > 0) {
          const len = S.G.nodes.winch.len;
          const f = rec.frb1;
          rec.hotb.x = f.x + fb.v[0] * 1.5; rec.hotb.z = f.z + fb.v[2] * 1.5; rec.hotb.y = f.y + fb.v[1] * 1.5 + len;
          rec.winch.x = rec.hotb.x; rec.winch.z = rec.hotb.z; rec.winch.y = f.y + fb.v[1] * 1.5;     // the winch node runs after the fireball's: put the hook where it will be seen
          Sh.mom = [0, 0, 0]; S.w.vars.set(VAR.WINCH, WINCH.TOP);
        }
      });
    }
    for (const [dt, tgt] of [[1, 'nest'], [1, 'd1'], [0.5, 'nest']]) {
      const S = newScenario(57, dt), R = lcg(57 + dt), Sh = S.G.S, rec = Sh.recs;
      const t = tgt === 'nest' ? { x: Sh.nest[0], z: Sh.nest[2] } : rec[tgt === 'd1' ? 'dinos' : 'dinos'][1];
      park(S, t.x, t.z, null); S.w.vars.set(VAR.WINCH, WINCH.LOWER);
      let hit = 0;
      play(S, 260 * (dt === 1 ? 1 : 2), `fireball hits the carrier ${tgt} dt${dt}`, () => 0, (i) => {
        if (Sh.carrying && i > 60 && hit < 3 && i % 40 === 0) { hit++; Sh.fireballHit = true; if (hit === 2) { park(S, rec.bron.x + 10, rec.bron.z + 10, null); } }
      });
    }
    // ---- 6d. the hook / the balloon against a wall: a flight direction that hits something is searched with the port's own sweeps, then flown in var 0xfa = 3 (the winch's own sweep) and 0 / 1 / 2
    for (const dt of [1, 0.5]) {
      const S = newScenario(58, dt), R = lcg(58 + dt), Sh = S.G.S, rec = Sh.recs;
      const spots = [];
      for (let k = 0; k < 40000 && spots.length < 6; k++) {
        const x = (R.next() - 0.5) * 900, z = (R.next() - 0.5) * 900, a = R.next() * 6.28, mx = f32(Math.sin(a) * 1.5), mz = f32(Math.cos(a) * 1.5);
        // the winch's own sweep in var 0xfa = 3 (from the balloon's place, radius 0.01) has to hit
        if (S.w.col.sweep(rec.winch, [x, rec.hotb.y, z], [mx, 0, mz], 1, 0.01, 0)) spots.push([x, z, mx, mz]);
      }
      notes.push(`wall spots found for the winch / balloon sweeps (dt ${dt}): ${spots.length}`);
      let si = 0;
      play(S, 240 * (dt === 1 ? 1 : 2), `wall dt${dt}`, () => 0, (i) => {
        if (i % 30 === 0 && spots.length) { const q = spots[si++ % spots.length]; park(S, q[0], q[1], null); Sh.mom = [f32(q[2]), 0, f32(q[3])]; S.w.vars.set(VAR.WINCH, [3, 3, 1, 2][i / 30 % 4]); S.G.nodes.winch.len = 30; }
      });
    }
    // ---- 8. the records the original's reset FUN_00797e90 builds against the scene the port runs on (the extraction), and what the restart sequence leaves of the game variables
    {
      const A = make(1, 1, { prepare: false });
      const HA = createHatHarness(ctx, A);
      A.mut = A.w.records;
      let recs = null;
      try { recs = HA.emuReset(); } catch (e) { bad(`the original's record reset failed: ${e.stack || e}`); }
      if (recs) {
        let flagDiff = 0;
        for (const r of A.w.records) {
          const b = recs[r.index];
          for (let k = 0; k < 16; k++) { checked++; const d = Math.abs(r.m[k] - b.m[k]); if (!(d <= 2.5e-7)) bad(`record reset: record ${r.index} ${r.name} matrix[${k}]: scene ${r.m[k]}, FUN_00797e90 ${b.m[k]}`); }     // the scene's matrices come from formats/matrix.ts (double products): last-bit differences to the float32 builder
          checked++; if ((r.flags & 0xffff) !== b.flags) { flagDiff++; }
        }
        notes.push(`record reset FUN_00797e90: ${A.w.records.length} records, matrices equal to the scene (${flagDiff} flag words differ: the reset writes 2, the zone's set-up code and nodes change it afterwards)`);
      }
      // the restart sequence keeps var 0xfa and the winch's stale copy
      const R = newScenario(5, 1);
      R.w.vars.set(VAR.WINCH, WINCH.LOWER); R.G.S.winchLast = WINCH.LOWER; R.G.S.score = 1234; R.G.S.delivered = 3;
      let out = null;
      try { out = R.H.emuRestart(); } catch (e) { bad(`the original's restart sequence failed: ${e.stack || e}`); }
      if (out) {
        eq([R.w.vars.get(VAR.WINCH), out.globals.winchLast, out.globals.score, out.globals.delivered], [WINCH.LOWER, WINCH.LOWER, 0, 0], 'restart: var 0xfa and DAT_05d5d3c0 are kept, the score / delivered globals are reset (FUN_007918a0)');
        // the port: var 0xfa is not written by prepareHat (the shell clears it at a zone entry only), DAT_05d5d3c0 is a process global that a new game inherits
        const P0 = make(5, 1); P0.S.winchLast = WINCH.LOWER; hatUpdate(P0.w);
        const P = make(5, 1, { keepGlobals: true, before: (w) => w.vars.set(VAR.WINCH, WINCH.LOWER) });
        ok(P.w.vars.get(VAR.WINCH) === WINCH.LOWER && P.S.winchLast === WINCH.LOWER, 'port: prepareHat keeps var 0xfa and inherits the winch copy (restart)');
        const P2 = make(5, 1);
        ok(P2.w.vars.get(VAR.WINCH) === WINCH.TOP && P2.S.winchLast === 0, 'port: a fresh world (zone entry: vars cleared by the shell) starts with 0 / 0');
      }
    }
    // ---- 9. the end banner FUN_00790c19 run natively for every kind of score: the lines (text, y, width), the speech, the hi-score variable, the medal flag
    {
      const H = newScenario(6, 1).H;
      let nb = 0;
      for (const score of [0, 100, 2499, 2500, 2501, 4999, 5000, 5001, 7499, 7500, 7501, 9999, 10000]) {
        for (const hi of [0, 3000, 12000]) {
          const o = H.banner(score, hi), m = medalOf(score);
          const mine = [{ text: String(score).padStart(5, ' '), y: 100, mode: 1 }];
          if (medalText(score)) mine.push({ text: medalText(score), y: 0x96, mode: 1 });
          for (const l of resultLines(score)) mine.push({ text: l.id, y: l.y, mode: 3 });
          eq(o.text.map((t) => [t.text, t.y, t.mode, t.x]), mine.map((t) => [t.text, t.y, t.mode, 0x140]), `banner score ${score}: lines (text, y, mode, x)`);
          eq(o.text.slice(-resultLines(score).length).map((t) => t.wrap), resultLines(score).map(() => 0x20), `banner score ${score}: result lines are 32 wide`);
          const vars = { a: new Map([[0x4a, hi]]), get(i) { return this.a.get(i) ?? 0; }, set(i, v) { this.a.set(i, v); } };
          applyResult(vars, score);
          eq([vars.get(0x4a), o.hi], [Math.max(hi, score), Math.max(hi, score)], `banner score ${score} hi ${hi}: hi-score variable raised only`);
          eq(o.medal, m > 0 ? 1 : 0, `banner score ${score}: medal flag DAT_05d5d314`);
          const l = resultLines(score), sayWant = [['say', l[0].id, l[1]?.id ?? null]];
          eq(o.log, sayWant, `banner score ${score}: the line(s) spoken`);
          nb++;
        }
      }
      notes.push(`banner FUN_00790c19: ${nb} runs (13 scores x 3 hi-scores) against resultLines / medalText / applyResult`);
    }
    // ---- 10. two worlds side by side, NO resync: the original's own state evolves in emulated memory (float32), the port's in its own world; same keys (the bot reads the port) and keyed random numbers.
    //          The discrete state must stay identical; positions agree to a stated drift; a trigger decided inside the rounding margin is the (counted) float32 divergence.
    stats.parallel = [];
    for (const [seed, dt, len] of [[7, 1, 9000], [8, 0.5, 9000]]) {
      const P = newScenario(seed, dt);
      const O = make(seed, dt, { prepare: false });
      const rigs = new Map();
      const rig = (n) => { if (!rigs.has(n)) { const e = arch.find(`anim/${n}.blk`); rigs.set(n, e ? parseBlk(arch.read(e)) : null); } return rigs.get(n); };
      for (const { rec, rig: name } of RIGS) { const r = O.w.records[rec], blk = rig(name); if (r && blk) { if (!r.anim) r.anim = new AnimInstance(blk); r.anim.start(1, 0); } }
      O.mut = O.w.records.slice();
      O.rk.seq = true; O.rk.s = (seed * 2654435761) >>> 0;
      const HO = createHatHarness(ctx, O);
      const init = HO.emuInit();
      HO.readBack({ recs: O.w.records.map(HO.readRec) });
      O.rk.seq = false;
      // the port's constructors drew from its own sequential source; its keyed source is back in place (make() restores it); the original's world now takes the keyed one
      setRandomSource(() => (P.G.rk.draw() + 0.5) / 32768);
      const plan = makePlan();
      const evP = {}, evO = {}, DRIFT = 0.25;
      const drift = { max: 0, at: '' };
      let diverged = null, tooFar = null, over = 0, ticks = 0, prevHeld = 0;
      const dcmp = (a, b, what, label) => { checked++; const d = Math.abs(a - b); if (Math.abs(b) < 1e30 && d > drift.max && d <= DRIFT) { drift.max = d; drift.at = `${label} ${what}`; } if (!(d <= DRIFT) && Math.abs(b) < 1e30) tooFar ??= `${what}: port ${a}, original ${b}`; };
      for (let i = 0; i < len; i++) {
        const held = hatBotStep(hatSnapshot(P.w), plan);
        // original: its own state
        O.w.tickCount = P.w.tickCount;
        const out = HO.emuPass(held, prevHeld, true);
        HO.readBack(out);
        for (const e of out.log) { const k = e[0] === 'fade' ? 'fade' : e[0] + (e[1] ?? ''); evO[k] = (evO[k] ?? 0) + 1; }
        // port
        P.G.events.length = 0; P.w.input.setVirtual(held); P.w.tick(); hatUpdate(P.w);
        for (const e of P.G.events) { const k = e[0] === 'fade' ? 'fade' : e[0] + (e[1] ?? ''); evP[k] = (evP[k] ?? 0) + 1; }
        prevHeld = held;
        ticks++;
        if (i % 20 === 0) {
          const lab = `parallel${seed} dt${dt} t${i}`;
          const glo = HO.readGlobals();
          const Sh = P.G.S;
          const disc = JSON.stringify([P.w.vars.get(0xfa), P.w.vars.get(0xfb), P.w.vars.get(0xfc), Sh.delivered, Sh.score, Sh.carrying ? 1 : 0, Sh.allDone ? 1 : 0, Sh.eatCount, Sh.result]);
          const dorg = JSON.stringify([O.w.vars.get(0xfa), O.w.vars.get(0xfb), O.w.vars.get(0xfc), glo.delivered, glo.score, glo.carrying, glo.allDone, glo.eatCount, glo.result]);
          const nodes = [];
          for (const r of P.w.records) for (const n of r.ctrl?.nodes ?? []) { const kind = KIND_OF_PORT[n.kind]; if (!kind) continue; const m = HO.portNode(kind, n), o = HO.readNode(kind, 0x31000000 + r.index * 0x100); for (const k of Object.keys(o)) if (/^(state|active|cur|count|ate|counted|animate|walking)$/.test(k)) nodes.push([r.index, k, m[k], o[k]]); }
          checked++;
          const nm = JSON.stringify(nodes.map((q) => q.slice(0, 3))), no = JSON.stringify(nodes.map((q) => [q[0], q[1], q[3]]));
          if (disc !== dorg || nm !== no) { diverged = { tick: i, why: disc !== dorg ? `${disc} vs ${dorg}` : (() => { for (let j = 0; j < nodes.length; j++) if (JSON.stringify(nodes[j][2]) !== JSON.stringify(nodes[j][3])) return `node ${nodes[j][0]} ${nodes[j][1]}: port ${nodes[j][2]}, original ${nodes[j][3]}`; return ''; })() }; break; }
          for (const r of P.w.records) { if (!r.ctrl && r.index !== REC.PEPP) continue; if (PORT_ONLY.has(r.index)) continue; const q = O.w.records[r.index];
            if (r.index === REC.PTER) { for (const k of [12, 14]) { const d = Math.abs(r.m[k] - q.m[k]); stats.pterDrift = Math.max(stats.pterDrift ?? 0, d); } continue; } for (const k of [12, 13, 14]) dcmp(r.m[k], q.m[k], `record ${r.index} ${r.name} m[${k}]`, lab); if (r.anim && ![...Sh.recs.dinos, ...Sh.recs.babies].includes(r) || r.anim) dcmp(r.anim?.frame ?? 0, q.anim?.frame ?? 0, `record ${r.index} ${r.name} frame`, lab); }
          dcmp(Sh.mom[0], glo.mom[0], 'momentum x', lab); dcmp(Sh.mom[2], glo.mom[2], 'momentum z', lab);
          if (tooFar) { diverged = { tick: i, why: tooFar }; break; }
        }
        if (P.G.S.result !== 0 && ++over > 30) break;
        if (failures.length > MAXFAIL) break;
      }
      if (diverged) bad(`parallel${seed} dt${dt}: the two worlds diverge already at tick ${diverged.tick}: ${diverged.why}`);
      if (!diverged) {
        const specIds = new Set();
        eq(Object.fromEntries(Object.entries(evP).filter(([k]) => !specIds.has(k))), Object.fromEntries(Object.entries(evO).filter(([k]) => !specIds.has(k))), `parallel${seed} dt${dt}: event totals over ${ticks} ticks`);
      } else { stats.deviations.floatDivergence = (stats.deviations.floatDivergence ?? 0) + 1; stats.parallel.push(diverged); }
      notes.push(`parallel (no resync) seed ${seed} dt ${dt}: ${ticks} ticks, score ${P.G.S.score}/${HO.readGlobals().score}, delivered ${P.G.S.delivered}/${HO.readGlobals().delivered}, largest position drift ${drift.max.toExponential(2)} (${drift.at})${diverged ? `; FIRST DISCRETE DIFFERENCE at tick ${diverged.tick}: ${diverged.why}` : '; no discrete difference'}`);
      stats.ticks += ticks;
    }
    // ---- 7. the end: Bronty freed with every score / trophy combination (result 1 / 2, trophy raised / reset)
    for (const [score, trophy] of [[1000, 3], [1400, 0], [1500, 2], [2400, 1], [2500, 0], [2500, 2], [4000, 3], [4500, 1], [4600, 3], [6500, 0], [6500, 3], [9000, 1], [9500, 0]]) {
      const S = newScenario(60 + (score >> 6), 1), Sh = S.G.S;
      Sh.score = score; Sh.delivered = Sh.total; Sh.allDone = true; S.w.vars.set(VAR.TROPHY, trophy); S.w.vars.set(VAR.BRONTY, BRONTY.FREED);
      let over = 0;
      play(S, 400, `freed ${score}/${trophy}`, () => 0, () => { if (Sh.result !== 0 && ++over > 3) return 'stop'; });
    }

    if (stats.cov) { const fs = globalThis.process.getBuiltinModule('node:fs'); fs.writeFileSync(process.env.HAT_COV, JSON.stringify([...stats.cov].sort((a, b) => a - b))); }
    notes.push(`visited: node updates ${JSON.stringify(stats.kinds)}; node states ${JSON.stringify(stats.states)}`);
    notes.push(`3D sounds of the dinosaurs / babies compared with the position the original's code hands the sound engine (stegRoar, tricRoar, stamp, brexCall): ${['3d14', '3d15', '3d7', '3d10'].reduce((a, k) => a + (stats.events[k] ?? 0), 0)} events, all at the true (x, y, z) of the record (no pointer quirk)`);
    notes.push(`events compared (kind+id: count): ${Object.entries(stats.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    { const g = make(1, 1), r = g.w.records[80]; notes.push(`record 80 (${r.name}) flags 0x${r.flags.toString(16)}, model ${r.model ? 'yes' : 'none'}, colObj ${r.colObj ? 'yes' : 'no'}; the balloon's draw hook FUN_00796d72 sets its flag 2 at every draw and draws it itself`); }
    notes.push(`ticks with a dinosaur / baby that fell where there is no ground (1e38): ${stats.noGround ?? 0}`);
    notes.push(`${stats.ticks} ticks compared, original passes ${stats.ms} ms`);
    if (stats.uninit) notes.push(`fields the constructors leave uninitialised (0xcd, written before read by the update): ${[...stats.uninit].join(' ')}`);
    return { checked, failures, notes };
  },
};
