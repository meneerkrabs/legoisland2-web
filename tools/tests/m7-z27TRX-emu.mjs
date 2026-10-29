import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { B } from '../../src/game/input.ts';
import { prepareTrx } from '../../src/zones/z27trx/prepare.ts';
import { TrxRun } from '../../src/zones/z27trx/run.ts';
import { bindGate, meshParts } from '../../src/zones/z27trx/gate.ts';
import { clockText } from '../../src/zones/z27TRX.ts';
import { BANNER } from '../../src/zones/z27trx/consts.ts';
import { VAR, PHASE } from '../../src/zones/z27trx/consts.ts';
import { makeTrxBot } from '../lib/trx-bot.mjs';
import { createTrxHarness, snapshotWorld, restoreWorld, quantize, SPEC, KIND_OF_PORT, f32 } from '../lib/m7-z27TRX-emu.mjs';

// z27TRX, differential test (WP-VERIFY, docs/re/m6/z27TRX.md "Differential test"): the ORIGINAL code of the rex node (FUN_0076a39b: phases, probes, rumble, footsteps, rider, cameras),
// of the props (gate, volcano, swinging logs, boulders, eggs, brontosaurus, spectators) and of the zone's record loop + constructors runs in the x86 emulation over one update pass from
// the same state as one tick of the port (tools/lib/m7-z27TRX-emu.mjs); records, node fields, run globals, variables, camera, anim state, random-number draws, HUD text and every sound /
// speech / rumble call must agree. Every scenario runs at dt = 1 (the port today) and dt = 0.5 (the 60 Hz step the port will move to; `world.dt`).

/** a seeded keyed random source: the value of draw k of record r in tick t does not depend on how many draws other nodes made (the port skips the spectators' draws out of view) */
function makeKeyed(seed, w) {
  const g = { seed: seed >>> 0, rec: 0, k: 0, counts: new Map() };
  g.begin = (rec) => { g.rec = rec; g.k = 0; };
  g.draw = () => {
    g.counts.set(g.rec, (g.counts.get(g.rec) ?? 0) + 1);
    let h = Math.imul(g.seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(w.tickCount + 1, 0xc2b2ae35) ^ Math.imul(g.rec + 7, 0x27d4eb2f) ^ Math.imul(g.k++ + 3, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) % 32768;
  };
  return g;
}
class Sink {
  log = []; on = new Set();
  play(id) { this.log.push(['2d', id]); this.on.add(id); }
  at(id, p) { this.log.push(['3d', id, f32(p[0]), f32(p[1]), f32(p[2])]); this.on.add(id); }
  stop(id) { this.log.push(['stop', id]); this.on.delete(id); }
  playing(id) { return this.on.has(id); }
}
/** a plain seeded generator for the scenarios' own choices */
function lcg(seed) { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)] }; }

export default {
  name: 'm7-z27TRX-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const stats = { ticks: 0, ms: 0, kinds: {}, phases: new Set(), clips: new Set(), events: {}, crash: {}, flags: {}, deviations: {} };
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const tolOf = () => 0;       // bit-exact: the port rounds like the original's 24-bit x87
    const ulp32 = (v) => { v = Math.abs(v); return v < 1e-30 ? 1e-45 : Math.pow(2, Math.floor(Math.log2(v)) - 23); };
    /** terrain heights: the port places the rex at the double-precision z, the original at the float32 z (half a unit in the last place of z) and the ground facets are slanted:
     * the height may differ by the slope times that; the tolerance is two ulp of z (slopes up to 4:1) on top of the float32 tolerance; the largest ratio seen is reported */
    const tolH = () => 0;
    const numH = (a, b, z, msg) => { checked++; stats.hRatio = Math.max(stats.hRatio ?? 0, Math.abs(a - b) / ulp32(z)); if (!(Math.abs(a - b) <= tolH(b, z))) bad(`${msg}: port ${a}, original ${b}`); };
    const num = (a, b, msg) => { checked++; if (!(Math.abs(a - b) <= tolOf(b))) bad(`${msg}: port ${a}, original ${b}`); };
    const eq = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${msg}: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); };

    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z27TRX');
    const rig = (n) => { const e = arch.find(`anim/${n}.blk`); return e ? parseBlk(arch.read(e)) : null; };
    const rigs = { TREX: rig('TREX'), MFIG: rig('MFIG'), TRIC: rig('TRIC'), STEG: rig('STEG'), BREX: rig('BREX'), BRON: rig('BRON') };

    /** a port game on the zone (prepared), with the recorder as sound sink and the keyed random source */
    const make = (seed, dt, o = {}) => {
      const L = loadZone(ctx, 'z27TRX');
      const w = L.world;
      w.dt = dt;
      const sink = new Sink(), rk = makeKeyed(seed * 7919 + 13, w);
      const rng = { float: (max) => (max <= 0 ? 0 : f32(f32(rk.draw() / 32767) * max)), int: (n) => (n <= 1 ? 0 : rk.draw() % n) };
      let g = null;
      if (o.prepare !== false) {
        g = prepareTrx(w, L.pepper, { rigs, models: L.scene.models, pe, sound: sink, rng, say: (id) => { sink.log.push(['say', id]); return true; } });
        bindGate(g.gate, meshParts(L.scene, arch, g.gateRec));
        g.run.rumble = (a, b) => sink.log.push(['rumble', a | 0, b | 0]);
        // the keyed source needs the record of the node that draws
        for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) { const u = n.update.bind(n); n.update = (ww, rec, c) => { rk.begin(rec.index); return u(ww, rec, c); }; }
      }
      const G = { w, L, g, run: g?.run ?? new TrxRun(), sink, rk, node: g?.node, seed };
      G.mut = w.records.filter((r) => r.ctrl || r.index === 336 || r.anim);
      G.still = w.records.map((r) => ({ m: r.m.slice(), flags: r.flags & 0xffff, model: r.model }));
      return G;
    };
    const S0 = {};
    const newScenario = (seed, dt, o) => {
      const G = make(seed, dt, o);
      const H = createTrxHarness(ctx, G);
      if (process.env.TRX_COV) H.cov = (S0.cov ??= new Set());
      return { G, H, w: G.w, dt, seed };
    };

    // ============================================================ the set-up: the original's zone loop and constructors against prepareTrx
    {
      const A = (() => {
        // the world as the engine's loader leaves it (rigs bound like the builder FUN_0076b230 does), NOT prepared: the original's FUN_0076649a + constructors run on it
        const G = make(1, 1, { prepare: false });
        const w = G.w, rs = w.records;
        rs[335].anim = new AnimInstance(rigs.TREX); rs[336].anim = new AnimInstance(rigs.MFIG);
        for (const r of rs) { const n = r.name.toUpperCase(); if ((n === 'TRIC' || n === 'STEG' || n === 'BREX' || n === 'BRON') && rigs[n]) r.anim = new AnimInstance(rigs[n]); }
        // the engine gives the ground record (record 0); camera / vars start empty
        return G;
      })();
      const HA = createTrxHarness(ctx, A);
      let init;
      try { init = HA.emuInit(); } catch (e) { bad(`the original's set-up failed: ${e.stack || e}`); init = null; }
      const P = make(1, 1);            // the port after prepareTrx
      if (init) {
        const pr = P.w.records;
        // 1. the attach list: record -> constructor
        const portKinds = new Map();
        for (const r of pr) for (const n of r.ctrl?.nodes ?? []) portKinds.set(r.index, [...(portKinds.get(r.index) ?? []), n.kind]);
        const origKinds = new Map();
        for (const a of init.attaches) origKinds.set(a.rec, [...(origKinds.get(a.rec) ?? []), SPEC[a.kind].port]);
        for (const [i] of origKinds) {
          const want = origKinds.get(i).filter(Boolean), have = portKinds.get(i) ?? [];
          eq(have, want, `set-up: nodes of record ${i} ${pr[i].name}`);
        }
        for (const [i, k] of portKinds) { checked++; if (!origKinds.has(i)) bad(`set-up: the port attaches ${k} to record ${i} ${pr[i].name}, the original does not`); }
        const kinds = {}; for (const a of init.attaches) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
        notes.push(`set-up: ${init.attaches.length} attaches by FUN_0076649a (${JSON.stringify(kinds)}), controllers on ${init.ctrlCreated.length} records`);
        {
          // PTRA (record 2) gets the controller + the no-op `fly` node (FUN_00768188) in both
          const have = pr.filter((r) => r.ctrl).map((r) => r.index), want = init.ctrlCreated.slice().sort((a, b) => a - b);
          eq(have, want, 'set-up: records with a controller');
        }
        // 2. the constructors' nodes
        for (const a of init.attaches) {
          const spec = SPEC[a.kind], on = init.nodes.get(a.rec).state;
          if (!spec.port) continue;
          const pn = pr[a.rec].ctrl.nodes.find((n) => n.kind === spec.port);
          if (!pn) continue;
          const portState = {};
          for (const f of spec.fields) { const v = pn[f[1]]; portState[f[1]] = f[2] === 'b' ? (v ? 1 : 0) : v; }
          for (const f of spec.fields) {
            // the constructor leaves the jump launch speed / gravity (+0x40 / +0x44) at 0 (written when a jump starts); the port keeps the constants in the fields
            if (a.kind === 'trex' && (f[1] === 'jumpV' || f[1] === 'jumpG')) continue;
            num(portState[f[1]], on[f[1]], `set-up ctor ${a.kind} on record ${a.rec} ${pr[a.rec].name}: ${f[1]}`);
          }
          // gate / var / mask / value of the attach
          eq([pn.var, pn.mask, pn.value], [a.var, a.mask, a.value], `set-up: gate of ${a.kind} on record ${a.rec}`);
        }
        // 3. the records after the loop + constructors: flags, matrices, model, anim
        const origAnim = (i) => ({ clip: pr[i].anim?.clip });
        let nrec = 0;
        for (let i = 0; i < pr.length; i++) {
          const a = init.recs[i], r = pr[i];
          const portFlags = r.flags & 0xffff;
          nrec++; checked++;
          if (portFlags !== a.flags) bad(`set-up: record ${i} ${r.name} flags: port 0x${portFlags.toString(16)}, original 0x${a.flags.toString(16)}`);
          for (let k = 0; k < 16; k++) { checked++; const d = Math.abs(r.m[k] - a.m[k]); if (d > 0) stats.sceneDiff = Math.max(stats.sceneDiff ?? 0, d); if (!(d <= 2.5e-7)) bad(`set-up: record ${i} ${r.name} matrix[${k}]: port ${r.m[k]}, original ${a.m[k]}`); }     // scene matrices come from formats/matrix.ts (double products): float32 rounding of each product differs in the last bit (not a zone module)
          eq(r.model ? 0x0e000000 + r.model.index : 0, a.model, `set-up: record ${i} ${r.name} model`);
        }
        // the anim state the constructors leave (clip / frame)
        for (const i of [335, 336, ...pr.filter((r) => ['TRIC', 'STEG', 'BREX', 'BRON'].includes(r.name.toUpperCase())).map((r) => r.index)]) {
          eq([pr[i].anim?.clip, pr[i].anim?.frame], [A.w.records[i].anim?.clip, A.w.records[i].anim?.frame], `set-up: anim of record ${i} ${pr[i].name} (clip, frame)`);
        }
        // 4. the camera and the globals the set-up leaves
        for (let i = 0; i < 6; i++) num(P.w.camera.c[i], init.camera[i], `set-up: camera[${i}]`);
        eq([P.w.vars.get(VAR.PHASE), P.run.clock, P.run.timeout ? 1 : 0], [A.w.vars.get(VAR.PHASE), init.globals.clock, init.globals.timeout], 'set-up: phase, clock, timeout');
        notes.push(`set-up: ${nrec} records compared (flags, matrix, model), ${init.calls} constructors run natively`);
      }
    }

    // ============================================================ the per-tick comparison
    const KEYS = { right: B.RIGHT, left: B.LEFT, up: B.UP, down: B.DOWN, jump: B.ALT, roar: B.SHIFT };
    const maskOf = (k) => (k.right ? B.RIGHT : 0) | (k.left ? B.LEFT : 0) | (k.up ? B.UP : 0) | (k.down ? B.DOWN : 0) | (k.jump ? B.ALT : 0) | (k.roar ? B.SHIFT : 0);
    const inViewOf = (S) => (r) => { const c = S.w.camera.c, dx = r.x - c[3], dz = r.z - c[5]; return dx * dx + dz * dz <= 220 * 220; };
    /** one tick: the original from the state, the port from the same state, then compare everything */
    const step = (S, held, label, opts = {}) => {
      const { G, H, w } = S;
      const rs = w.records, run = G.run;
      G.sink.log.length = 0; G.rk.counts.clear();
      // (no quantisation of the port's state any more: it holds float32 values by construction)
      // the spectators' frustum flag (record flag bit 0): the test's distance proxy stands in for the renderer's view test, set on the port's records as the shared input
      { const iv = inViewOf(S); for (const r of rs) if (r.ctrl?.nodes.some((n) => n.kind === 'trx-anim')) r.flags = iv(r) ? r.flags | 1 : r.flags & ~1; }
      const s0 = snapshotWorld(G);
      const t0 = Date.now();
      let orig;
      const inView = inViewOf(S);
      const inViewNow = new Map(); for (const r of rs) if (r.ctrl?.nodes.some((n) => n.kind === 'trx-anim')) inViewNow.set(r, inView(r));
      try { orig = H.emuPass(held, (r) => inViewNow.get(r)); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); restoreWorld(G, s0); G.sink.log.length = 0; return false; }
      stats.ms += Date.now() - t0;
      const origAnim = rs.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      const origVars = w.vars.a.slice();
      G.rk.counts.clear();
      restoreWorld(G, s0);
      G.sink.log.length = 0;
      // the frustum flag (record flag bit 0) of the spectators: the zone game sets it after every tick; here both sides get the same decision
      for (const [r, v] of inViewNow) r.flags = v ? r.flags | 1 : r.flags & ~1;
      w.input.setVirtual(held);
      w.tick();
      stats.ticks++;
      const portEvents = G.sink.log.slice();
      // ---- records
      const qOf = new Map(s0.recs.map((q) => [q.i, q]));
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i], q = qOf.get(i);
        if (!q) {
          // a record without controller / animation: nobody moves it; the original did not touch its memory either
          const st = G.still[i];
          checked += 1;
          if (orig.recs[i] || (r.flags & 0xffff) !== st.flags || r.model !== st.model || r.m[12] !== st.m[12] || r.m[13] !== st.m[13] || r.m[14] !== st.m[14]) bad(`${label}: static record ${i} ${r.name} changed (port ${r.flags}, original ${JSON.stringify(orig.recs[i])})`);
          continue;
        }
        const b = orig.recs[i] ?? { m: Array.from(q.m), e: [q.rx, q.ry, q.rz], flags: q.flags & 0xffff, model: H.modelPtr(q.model), variant: q.variant | 0 };
        // quick path: nothing of the record changed on either side (the original works on the mirror of exactly this state)
        let still = (r.flags & 0xffff) === (q.flags & 0xffff) && (b.flags & 0xfffe) === (q.flags & 0xfffe) && r.model === q.model && H.modelPtr(q.model) === b.model && r.variant === q.variant && b.variant === (q.variant | 0)
          && r.rx === q.rx && r.ry === q.ry && r.rz === q.rz && b.e[0] === q.rx && b.e[1] === q.ry && b.e[2] === q.rz;
        for (let k = 0; k < 16 && still; k++) if (r.m[k] !== q.m[k] || b.m[k] !== q.m[k]) still = false;
        if (still) { checked += 1; if (r.anim && origAnim[i]) { checked++; if (r.anim.clip !== origAnim[i][0] || Math.abs(r.anim.frame - origAnim[i][1]) > tolOf(origAnim[i][1])) bad(`${label}: record ${i} ${r.name} animation: port ${JSON.stringify([r.anim.clip, r.anim.frame])}, original ${JSON.stringify(origAnim[i])}`); } continue; }
        checked++;
        if ((r.flags & 0xfffe) !== (b.flags & 0xfffe)) bad(`${label}: record ${i} ${r.name} flags: port 0x${(r.flags & 0xffff).toString(16)}, original 0x${b.flags.toString(16)}`);
        checked++;
        if (H.modelPtr(r.model) !== b.model) bad(`${label}: record ${i} ${r.name} model: port ${H.modelPtr(r.model).toString(16)}, original ${b.model.toString(16)}`);
        if (r.variant !== b.variant) { checked++; bad(`${label}: record ${i} ${r.name} variant: port ${r.variant}, original ${b.variant}`); }
        let bm = false;
        for (let k = 0; k < 16; k++) {
          checked++;
          const ht = k === 13 && (i === 335 || i === 336);
                    if (ht) stats.hRatio = Math.max(stats.hRatio ?? 0, Math.abs(r.m[k] - b.m[k]) / ulp32(b.m[14]));
          if (!(Math.abs(r.m[k] - b.m[k]) <= (ht ? tolH(b.m[k], b.m[14]) : tolOf(b.m[k])))) bm = true;
        }
        if (bm) { const d = []; for (let k = 0; k < 16; k++) if (!(Math.abs(r.m[k] - b.m[k]) <= (k === 13 && (i === 335 || i === 336) ? tolH(b.m[k], b.m[14]) : tolOf(b.m[k])))) d.push(`[${k}] ${r.m[k]} vs ${b.m[k]}`); bad(`${label}: record ${i} ${r.name} matrix: port vs original ${d.join(', ')}`); }
        const e = [r.rx, r.ry, r.rz];
        for (let k = 0; k < 3; k++) { checked++; if (!(Math.abs(e[k] - b.e[k]) <= tolOf(b.e[k]))) bad(`${label}: record ${i} ${r.name} euler[${k}]: port ${e[k]}, original ${b.e[k]}`); }
        if (r.anim && origAnim[i]) { checked++; if (r.anim.clip !== origAnim[i][0] || Math.abs(r.anim.frame - origAnim[i][1]) > tolOf(origAnim[i][1])) bad(`${label}: record ${i} ${r.name} animation: port ${JSON.stringify([r.anim.clip, r.anim.frame])}, original ${JSON.stringify(origAnim[i])}`); }
      }
      // ---- nodes
      for (const [n, o] of orig.perNode) {
        const mine = H.portNode(o.kind, n);
        for (const k of Object.keys(o.state)) {
          const x = mine[k], y = o.state[k];
          if (Array.isArray(y)) { for (let q = 0; q < 16; q++) num(x[q], y[q], `${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: ${k}[${q}]`); }
          else if (o.kind === 'trex' && (k === 'jumpBase' || k === 'jumpY')) numH(x, y, o.state.z, `${label}: trex node: ${k}`);
          else num(x, y, `${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: ${k}`);
        }
        // random draws (a spectator draws every tick, in view or not, in both)
        const pd = G.rk.counts.get(o.rec) ?? 0;
        { checked++; if (pd !== o.draws) bad(`${label}: ${o.kind} node on record ${o.rec} ${rs[o.rec].name}: random draws port ${pd}, original ${o.draws}`); }
        stats.kinds[o.kind] = (stats.kinds[o.kind] ?? 0) + 1;
      }
      // ---- variables (0xfa .. 0xff, the trophy / hi-score)
      for (const v of [0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff, VAR.TROPHY, VAR.HISCORE]) { checked++; if ((w.vars.a[v] | 0) !== (origVars[v] | 0)) bad(`${label}: variable 0x${v.toString(16)}: port ${w.vars.a[v]}, original ${origVars[v]}`); }
      // ---- globals
      const gb = orig.globals;
      eq([run.timeout ? 1 : 0, run.score, run.volcano ? run.volcano.index : -1, run.arrivalCamera ? 1 : 0], [gb.timeout, gb.score, gb.volcano ? (gb.volcano - 0x30000000) / 0x68 : -1, gb.camFlag], `${label}: globals (timeout, score, volcano, camera flag)`);
      num(run.clock, gb.clock, `${label}: clock`);
      eq(run.hitsText, gb.text, `${label}: HUD hit text`);
      eq(run.hudDim, gb.color !== 0xffffffff, `${label}: HUD text dim`);
      if (G.node) num(G.node.camZ, orig.perNode.get(G.node)?.state.camZ ?? G.node.camZ, `${label}: camZ`);
      for (let i = 0; i < 6; i++) { if (i === 4) numH(w.camera.c[i], orig.camera[i], orig.camera[5], `${label}: camera[4]`); else num(w.camera.c[i], orig.camera[i], `${label}: camera[${i}]`); }
      // ---- sounds / speech / rumble in order; the fog call = the port's arrival-fog request
      const oe = orig.log.filter((e) => e[0] !== 'fog'), fogs = orig.log.filter((e) => e[0] === 'fog').length;
      const same = oe.length === portEvents.length && oe.every((e, i) => { const q = portEvents[i]; return e.length === q.length && e.every((v, k) => (typeof v === 'number' && k >= 2 && e[0] === '3d' ? Math.abs(v - q[k]) <= tolOf(v) : v === q[k])); });
      checked++;
      if (!same) bad(`${label}: events: port ${JSON.stringify(portEvents)}, original ${JSON.stringify(oe)}`);
      eq(run.arrivalFog && !s0.run.arrivalFog ? 1 : 0, fogs > 0 ? 1 : 0, `${label}: arrival fog call`);
      for (const e of portEvents) { const k = e[0] + (e[1] ?? ''); stats.events[k] = (stats.events[k] ?? 0) + 1; }
      // ---- coverage
      stats.phases.add(w.vars.get(0xfa));
      if (G.node) {
        const a = G.node;
        for (const f of ['stunned', 'burning', 'jumping']) if (a[f]) stats.flags[f] = (stats.flags[f] ?? 0) + 1;
        if (a.blink) stats.flags['blink' + a.blink] = (stats.flags['blink' + a.blink] ?? 0) + 1;
        if (G.node.lane !== 0) stats.flags.sideLane = (stats.flags.sideLane ?? 0) + 1;
      }
      const pc = rs[335].anim?.clip; if (pc !== undefined) stats.clips.add(pc);
      return true;
    };


    // ============================================================ scenarios
    const place = (S, z, lane = 0, speed) => {
      const n = S.G.node, p = S.G.run.pepp;
      z = f32(z); n.z = z; n.camZ = z; n.lane = lane; n.prevLane = lane; n.offset = lane * 16; p.x = n.baseX + n.offset; p.z = z;
      if (speed !== undefined) n.speed = f32(speed);
    };
    const names = (S, ...ns) => S.w.records.filter((r) => ns.includes(r.name.toUpperCase()));
    const laneOf = (x, baseX) => Math.max(-1, Math.min(1, Math.round((x - baseX) / 16)));
    /** play `n` ticks; `keys(i)` -> mask, `pre(i)` may change the shared state first; the first `every`-th tick (and all while `always(i)`) are compared */
    const grp = {};
    const play = (S, n, label, keys, pre, every = 1) => {
      const { G, w } = S;
      const gk = label.replace(/[0-9 ].*$/, '') || label; const g0 = stats.ticks; grp[gk] = grp[gk] ?? 0;
      try { return play0(S, n, label, keys, pre, every); } finally { grp[gk] += stats.ticks - g0; }
    };
    const play0 = (S, n, label, keys, pre, every = 1) => {
      const { G, w } = S;
      for (let i = 0; i < n; i++) {
        if (pre?.(i) === 'stop') break;
        const held = keys(i);
        if (i % every === 0) { if (!step(S, held, `${label} t${i}`)) return false; }
        else { G.sink.log.length = 0; w.input.setVirtual(held); w.tick(); G.sink.log.length = 0; }
        if (failures.length > MAXFAIL) return false;
      }
      return true;
    };

    const HAZ = ['ROCK', 'STP2', 'VOLC', 'STMP', 'FENC', 'BLDF', 'BLDR', 'LOGS', 'STAT', 'BURN', 'SLOG', 'EGGS', 'YOLK'];
    /** a random key mask generator: a held key changes with probability `pc` per tick */
    const keyGen = (R, o = {}) => {
      let m = 0;
      const { pc = 0.12, right = 0.75, jump = 0.05, roar = 0.03, left = 0.08, lane = 0.12 } = o;
      return () => {
        if (R.next() < pc) {
          m = 0;
          if (R.next() < right) m |= B.RIGHT;
          if (R.next() < left) m |= B.LEFT;
          const q = R.next(); if (q < lane) m |= B.UP; else if (q < 2 * lane) m |= B.DOWN;
          if (R.next() < jump * 3) m |= B.ALT;
          if (R.next() < roar * 3) m |= B.SHIFT;
        } else if (m & (B.ALT | B.SHIFT)) { if (R.next() < 0.5) m &= ~(B.ALT | B.SHIFT); }
        return m;
      };
    };
    /** random "sound finished" events in the engine state both sides see */
    const soundNoise = (S, R) => { const on = S.G.sink.on; if (on.size && R.next() < 0.2) { const a = [...on]; on.delete(a[R.int(a.length)]); } };
    /** put the rex a little before a random hazard record of the given names; returns the record */
    const before = (S, R, nm, dmin = 6, dmax = 70) => {
      const hs = names(S, ...nm);
      const h = R.pick(hs);
      const n = S.G.node, lane = laneOf(h.x, n.baseX);
      place(S, h.z - (dmin + R.next() * (dmax - dmin)), R.next() < 0.7 ? lane : R.int(3) - 1, 0.6 + R.next() * 0.8);
      return h;
    };
    const T = { trials: 0 };
    /** rename a record (the original's mirror keeps the names of the static records from the first full mirror) */
    const rename = (S, r, nm) => { r.name = nm; for (let i = 0; i < 4; i++) S.H.mem.w8(0x30000000 + r.index * 0x68 + i, nm.charCodeAt(i)); };

    // ---- 1. whole games with the bot: dt 1 every tick, dt 0.5 every 3rd tick (the transitions are covered every tick below)
    for (const [seed, dt, every] of [[1, 1, 3], [3, 0.5, 6]]) {
      const S = newScenario(seed, dt), bot = makeTrxBot();
      const R = lcg(seed * 31 + 5);
      const t0 = stats.ticks;
      let over = 0;
      play(S, 12000, `bot${seed} dt${dt}`, () => maskOf(bot.step(S.w, S.G.node)), () => { soundNoise(S, R); if (S.w.vars.get(0xfa) === 7 && ++over > 25) return 'stop'; }, every);
      notes.push(`bot ${seed} dt ${dt}: ${stats.ticks - t0} ticks compared (every ${every}), phase ${S.w.vars.get(0xfa)}, ${S.G.node.hits} hits, score ${S.G.run.score}, medal ${S.w.vars.get(0xff)}`);
    }

    const base = newScenario(1, 1);
    notes.push(`records by name: ${[...HAZ, 'BRON', 'GATE', 'BRDG', 'TRIC', 'STEG', 'BREX'].map((n) => `${n} ${names(base, n).length}`).join(', ')}`);
    // ---- 2. hazards: the rex placed a little before each kind of hazard, random speed / lane / keys, until the crash is over and the blinking ends
    for (const [dt, trials, len] of [[1, 2, 80], [0.5, 1, 130]]) {
      for (const nm of HAZ) {
        if (!names({ w: base.w }, nm).length) continue;
        const S = newScenario(11 + nm.charCodeAt(0), dt), R = lcg(nm.charCodeAt(1) * 977 + dt * 13);
        const kg = keyGen(R, { jump: 0.1, roar: 0.05 });
        for (let t = 0; t < trials; t++) {
          const h = before(S, R, [nm]);
          S.w.vars.set(0xfa, 4);
          play(S, len, `${nm}${t} dt${dt}`, kg, () => soundNoise(S, R));
          T.trials++;
        }
      }
    }
    // ---- 3. lane changes into a blocked neighbour lane (the bounce back), every kind of blocker
    for (const [dt, nt] of [[1, 10], [0.5, 6]]) {
      const S = newScenario(21, dt), R = lcg(77 + dt * 5);
      for (let t = 0; t < nt; t++) {
        const hs = names(S, 'ROCK', 'STP2', 'VOLC', 'STMP', 'FENC', 'BLDF', 'LOGS', 'STAT', 'BLDR');
        const h = R.pick(hs), n = S.G.node, hl = laneOf(h.x, n.baseX);
        const from = hl === 0 ? (R.next() < 0.5 ? -1 : 1) : 0;
        place(S, h.z - (4 + R.next() * 12), from, 0.6 + R.next() * 0.8);
        S.w.vars.set(0xfa, 4);
        const dir = hl > from ? B.DOWN : B.UP, at = R.int(4);
        play(S, 40 * (dt === 1 ? 1 : 2), `bounce${t} dt${dt}`, (i) => B.RIGHT | (i === at ? dir : 0) | (R.next() < 0.03 ? B.ALT : 0), () => soundNoise(S, R));
      }
    }
    // ---- 4. the props: boulders, eggs, swinging logs, volcanoes, the brontosaurus, the gate and the spectators
    for (const [dt, sc] of [[1, 1], [0.5, 0.4]]) {
      const S = newScenario(31, dt), R = lcg(99 + dt * 3);
      const cnt = (n) => Math.max(1, Math.round(n * sc));
      const kg = keyGen(R, { jump: 0.03, roar: 0.02, lane: 0.05 });
      const trial = (nm, dmin, dmax, len, lane) => {
        if (!names(S, nm).length) return;
        const h = R.pick(names(S, nm));
        place(S, h.z - (dmin + R.next() * (dmax - dmin)), lane ?? laneOf(h.x, S.G.node.baseX), 0.6 + R.next() * 0.8);
        S.w.vars.set(0xfa, 4);
        play(S, len * (dt === 1 ? 1 : 2), `${nm} dt${dt}`, kg, () => soundNoise(S, R));
      };
      for (let k = 0; k < cnt(5); k++) trial('BLDR', 40, 95, 65);
      for (let k = 0; k < cnt(5); k++) trial('EGGS', 30, 90, 55);
      
      for (let k = 0; k < cnt(4); k++) trial('SLOG', 60, 200, 70);
      for (let k = 0; k < cnt(4); k++) trial('VOLC', 40, 100, 50);
      for (let k = 0; k < 2; k++) trial('BRON', 10, 80, 90);
    }
    // ---- 5. free runs with random keys (jumps, roars, lane changes, braking, accelerating), the spectators in view, sounds ending at random
    for (const [dt, seed, n] of [[1, 41, 800], [0.5, 42, 500]]) {
      const S = newScenario(seed, dt), R = lcg(seed * 3), kg = keyGen(R, { pc: 0.2, right: 0.6, left: 0.2, jump: 0.15, roar: 0.08, lane: 0.2 });
      play(S, n, `free dt${dt}`, kg, (i) => { soundNoise(S, R); if (i % 500 === 499 && S.w.vars.get(0xfa) === 4) place(S, 300 + R.next() * 3500, R.int(3) - 1); });
    }
    // ---- 6. the end: arrival run from z 4100 (the gate opens, autopilot, the camp camera, score + medal for every hit count, hi-score / trophy only raised), the clips of the medals
    for (const [dt, hs] of [[1, [0, 20, 30]], [0.5, [10]]]) {
      for (const hits of hs) {
        const S = newScenario(50 + hits, dt), R = lcg(hits * 7 + 1);
        const n = S.G.node;
        place(S, 4095 + R.next() * 15, 0, 0.6 + R.next() * 0.8); n.hits = hits;
        S.w.vars.set(0xfa, 4); S.w.vars.set(VAR.HISCORE, R.pick([0, 5000, 9000])); S.w.vars.set(VAR.TROPHY, R.pick([0, 1, 2, 3]));
        let over = 0;
        play(S, 700 * (dt === 1 ? 1 : 2), `end${hits} dt${dt}`, () => B.RIGHT, () => { soundNoise(S, R); if (S.w.vars.get(0xfa) === 7 && ++over > 12) return 'stop'; }, 1);
      }
    }
    for (const hits of [5, 9, 15, 25, 29, 35, 41, 50]) {
      const S = newScenario(70 + hits, 1), R = lcg(hits + 3), n = S.G.node;
      place(S, 4326 + R.next() * 5, R.int(3) - 1, 1.0 + R.next() * 0.4); n.hits = hits;
      S.w.vars.set(0xfa, 4); S.w.vars.set(VAR.HISCORE, R.pick([0, 9500])); S.w.vars.set(VAR.TROPHY, R.pick([0, 3]));
      let over = 0;
      play(S, 400, `finish${hits}`, () => 0, () => { if (S.w.vars.get(0xfa) === 7 && ++over > 8) return 'stop'; });
    }
    // ---- 7. the clock runs out: anywhere on the track (phase 5 without the camp camera, the slowing down, a jump in the air, the lose clips), also close to the camp
    for (const [dt, seed] of [[1, 81], [1, 82], [1, 83], [0.5, 84], [0.5, 85]]) {
      const S = newScenario(seed, dt), R = lcg(seed), n = S.G.node;
      const z = [900 + R.next() * 2000, 4000 + R.next() * 300, 300 + R.next() * 600][seed % 3];
      place(S, z, R.int(3) - 1, 0.6 + R.next() * 0.8); n.clock = 3 + R.int(30);
      S.w.vars.set(0xfa, 4);
      let over = 0;
      const kg = keyGen(R, { jump: 0.3, roar: 0.05, lane: 0.05 });
      play(S, 500, `timeout${seed} dt${dt}`, (i) => (seed % 2 === 0 && i < 40 ? kg() : 0), () => { if (S.w.vars.get(0xfa) === 7 && ++over > 12) return 'stop'; });
      // the jump in the air when the clock runs out
    }
    {
      const S = newScenario(86, 1), R = lcg(8), n = S.G.node;
      place(S, 1200, 0, 1.2); n.clock = 12; S.w.vars.set(0xfa, 4);
      let over = 0;
      play(S, 700, 'timeout in the air', (i) => (i === 4 ? B.RIGHT | B.ALT : B.RIGHT), () => { if (S.w.vars.get(0xfa) === 7 && ++over > 12) return 'stop'; });
    }
    // ---- 8. the waiting phases: first tick (phase 0 -> 4) and phase 1
    for (const dt of [1, 0.5]) {
      for (const ph of [0, 1]) {
        const S = newScenario(90 + ph, dt), R = lcg(ph + 5);
        S.w.vars.set(0xfa, ph);
        play(S, 6, `wait${ph} dt${dt}`, () => (R.next() < 0.5 ? B.RIGHT | B.UP : B.ALT), () => soundNoise(S, R));
      }
    }


    // ---- 9. standing in a fire patch (the rex is put back into it every tick): clip 5 -> 6 while burning, the clip-6 end, then leaving the fire
    for (const dt of [1, 0.5]) {
      const S = newScenario(101, dt), R = lcg(55 + dt), n = S.G.node;
      const kg = keyGen(R, { jump: 0.02, roar: 0.02, lane: 0.03 });
      for (let t = 0; t < 2; t++) {
        const h = R.pick(names(S, 'BURN')), l = laneOf(h.x, n.baseX);
        place(S, h.z - 12, l, 1.0); S.w.vars.set(0xfa, 4);
        const keep = (i) => { if (i >= 10 && i < 130 * (dt === 1 ? 1 : 2)) { place(S, h.z - 1, l); } soundNoise(S, R); };
        play(S, 170 * (dt === 1 ? 1 : 2), `fire${t} dt${dt}`, () => B.RIGHT | (kg() & ~B.LEFT), keep);
      }
    }
    // ---- 10. a rumble that is still on when the arrival run starts (FUN_0076ab2b), the volcano's rumble ended by moving out in x
    for (const dt of [1, 0.5]) {
      const S = newScenario(111, dt), n = S.G.node;
      place(S, 4105, 0, 1.2); S.w.vars.set(0xfa, 4); n.rumbleOn = true; n.rumbleT = 30; n.rumbleS = 60; n.hits = 3;
      let over = 0;
      play(S, 330 * (dt === 1 ? 1 : 2), `arrival rumble dt${dt}`, () => B.RIGHT, () => { if (S.w.vars.get(0xfa) === 7 && ++over > 8) return 'stop'; });
      const V = newScenario(112, dt), R = lcg(3);
      for (const v of names(V, 'VOLC').slice(0, 6)) {
        place(V, v.z - 20, laneOf(v.x, V.G.node.baseX), 1.0); V.w.vars.set(0xfa, 4);
        // the volcano's rumble starts; then the rex is moved out in x only (|dx| > 64), later out in z only
        play(V, 24 * (dt === 1 ? 1 : 2), `volcano x${dt}`, () => B.RIGHT, (i) => { if (i === 3 * (dt === 1 ? 1 : 2)) V.G.run.pepp.x = v.x + 70; if (i === 12 * (dt === 1 ? 1 : 2)) V.G.run.pepp.x = v.x; });
      }
    }
    // ---- 11. record names the shipped zone has no record for (ROCK, STP2, BLDF, YOLK): the probes' switch arms are run on renamed records
    for (const dt of [1, 0.5]) {
      const S = newScenario(121, dt), R = lcg(19 + dt);
      const kg = keyGen(R, { jump: 0.05 });
      for (const nn of ['ROCK', 'STP2', 'BLDF']) {
        for (let t = 0; t < 1; t++) {
          const h = R.pick(names(S, 'STMP', 'FENC', 'LOGS'));
          rename(S, h, nn);
          place(S, h.z - (10 + R.next() * 30), laneOf(h.x, S.G.node.baseX), 0.8 + R.next() * 0.6); S.w.vars.set(0xfa, 4);
          play(S, 55 * (dt === 1 ? 1 : 2), `renamed ${nn} dt${dt}`, () => B.RIGHT | kg(), () => soundNoise(S, R));
        }
      }
      const e = R.pick(names(S, 'EGGS')); rename(S, e, 'YOLK');
      place(S, e.z - 60, laneOf(e.x, S.G.node.baseX), 1.0); S.w.vars.set(0xfa, 4);
      play(S, 90 * (dt === 1 ? 1 : 2), `renamed YOLK dt${dt}`, () => B.RIGHT, () => soundNoise(S, R));
    }
    // ---- 12. the jump key: the original tests bit 0x20 (Alt) only, and so does the port: Ctrl (0x10, what the help text names) does nothing in either
    {
      const S = newScenario(131, 1), n = S.G.node;
      place(S, 1500, 0, 1.0); S.w.vars.set(0xfa, 4);
      step(S, B.RIGHT, 'ctrl warmup');
      const orig = (held) => { const s0 = snapshotWorld(S.G); quantize(S.G); const r = S.H.emuPass(held, () => false); restoreWorld(S.G, s0); const o = r.perNode.get(n).state; return { jumping: o.jumping, clip: r.recs[335]?.m ? null : null }; };
      const a = orig(B.RIGHT | B.CTRL);
      const keep = S.G.sink.on;
      S.w.input.setVirtual(B.RIGHT | B.CTRL); S.w.tick();
      ok(a.jumping === 0 && n.jumping === false, `jump key: Ctrl (0x10): original jumping ${a.jumping}, port jumping ${n.jumping}: neither jumps (only bit 0x20 does)`);
      const T2 = newScenario(132, 1), n2 = T2.G.node;
      place(T2, 1500, 0, 1.0); T2.w.vars.set(0xfa, 4); step(T2, B.RIGHT, 'alt warmup');
      step(T2, B.RIGHT | B.ALT, 'alt jump');
      ok(n2.jumping, 'jump key: Alt (0x20) jumps in both');
    }
    // ---- 13. negative control: a port that is off by a hair must be caught by the comparison
    {
      const S = newScenario(141, 1), n = S.G.node;
      place(S, 1500, 0, 1.0); S.w.vars.set(0xfa, 4);
      const real = bad; let caught = 0;
      step(S, B.RIGHT, 'control warmup');
      const u = n.update.bind(n);
      n.update = (w, rec, c) => { const r = u(w, rec, c); n.speed += 0.001; return r; };
      const before = failures.length;
      step(S, B.RIGHT, 'negative control');
      caught = failures.length - before;
      failures.length = before;
      n.update = u;
      ok(caught > 0, 'negative control: a port with speed off by 0.001 is detected');
    }


    // ---- 14. the HUD strings and the banner: the original's FUN_0076560f (clock "%d:%02d") over every half tick of the clock, FUN_007653be (score "%5d", medal word, lines) for every medal / score
    {
      const H = base.H;
      let bad1 = 0;
      for (let k = 0; k <= 10800; k++) { const clock = k / 2; checked++; const a = clockText(clock), b = H.clockText(clock); if (a !== b && bad1++ < 5) bad(`HUD clock text at ${clock}: port ${a}, original ${b}`); }
      for (const clock of [5399.9, 5370.0001, 29.999, 30, 0.4]) { checked++; const a = clockText(f32(clock)), b = H.clockText(clock); if (a !== b) bad(`HUD clock text at ${clock}: port ${a}, original ${b}`); }
      let nb = 0;
      for (const medal of [0, 1, 2, 3]) {
        for (const score of [0, 250, 2500, 2750, 5000, 5250, 7500, 7750, 9750, 10000, 123456]) {
          const o = H.banner(medal, score);
          const mine = [{ text: String(score).padStart(5, ' '), y: BANNER.SCORE_Y, table: 0 }];
          const word = ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD'][medal];
          if (word) mine.push({ text: word, y: BANNER.MEDAL_Y, table: 'std' });
          for (const [id, y] of BANNER.LINES[medal]) mine.push({ text: id, y, table: 'trx' });
          eq(mine.map((m) => [m.table, m.text, m.y]), o.map((m) => [m.table, m.text, m.y]), `banner medal ${medal} score ${score}: lines (table, text, y)`);
          eq(o.every((m) => m.x === 320 && m.wrap === BANNER.WRAP), true, `banner medal ${medal}: x 320, wrap ${BANNER.WRAP}`);
          nb++;
        }
      }
      notes.push(`HUD: ${10806} clock texts, ${nb} banners (score / medal / lines)`);
    }


    // ---- 15. two worlds side by side, NO resync: the original's own state evolves in emulated memory (float32), the port's in its own world (doubles), the same keys (the bot reads the port) and the
    //          same keyed random numbers. KNOWN DEVIATION (docs/re/m6/z27TRX.md): the port keeps its state in doubles, the original rounds every store to float32 (z, speed, offset ... accumulate with
    //          a rounding of up to half an ulp per tick: at z > 512 that is 3e-5 .. 2e-4 per tick, systematic for a constant speed); the two trajectories drift apart by ~1e-2 and a contact that is
    //          decided within that margin (the bot steers close to hazards) can come out differently. The test follows both worlds until the first discrete difference (counted, with the tick and the
    //          reason, as the known deviation), checks the drift up to then against a bound (0.25 units: anything larger is a bug, not rounding) and, where no divergence happens, the event totals.
    stats.parallel = [];
    for (const [seed, dt, len] of [[7, 1, 12000], [9, 1, 12000], [8, 0.5, 2500]]) {
      const P = newScenario(seed, dt), O = newScenario(seed, dt);
      O.H.freeInit();
      const bot = makeTrxBot(seed === 9 ? { horizon: 120, stay: 70, jumps: false } : {});
      const dr = { max: 0, at: '' };
      const DRIFT = 0;
      const spectators = new Set(P.w.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'trx-anim')).map((r) => r.index));
      let tooFar = null;
      const drift = (a, b, what, label) => { checked++; const d = Math.abs(a - b); if (Math.abs(b) < 1e30 && d > dr.max && d <= DRIFT) { dr.max = d; dr.at = `${label} ${what}`; } if (!(d <= DRIFT) && Math.abs(b) < 1e30) tooFar ??= `${what}: port ${a}, original ${b}`; };
      const evP = {}, evO = {};
      let over = 0, ticks = 0, diverged = null;
      const noise = (sink, tick) => { const h = (Math.imul(tick + 1, 2654435761) >>> 0); if (h % 7 === 0 && sink.on.size) { const a = [...sink.on].sort((x, y) => x - y); sink.on.delete(a[h % a.length]); } };
      for (let i = 0; i < len; i++) {
        const held = maskOf(bot.step(P.w, P.G.node));
        noise(P.G.sink, i); noise(O.G.sink, i);
        const cam = [O.H.mem.f32(0x9da5f4), O.H.mem.f32(0x9da5fc)];
        const out = O.H.emuPass(held, (r) => { const dx = r.x - cam[0], dz = r.z - cam[1]; return dx * dx + dz * dz <= 220 * 220; }, true);
        O.H.readBack(out);
        for (const e of out.log) { const k = e[0] + (e[1] ?? ''); evO[k] = (evO[k] ?? 0) + 1; }
        O.w.tickCount++;
        // the zone game sets the spectators' frustum flag (record flag bit 0) after every tick: here from the same distance decision the original is handed
        for (const r of P.w.records) if (spectators.has(r.index)) { const dx = r.x - cam[0], dz = r.z - cam[1]; r.flags = dx * dx + dz * dz <= 220 * 220 ? r.flags | 1 : r.flags & ~1; }
        P.G.sink.log.length = 0; P.w.input.setVirtual(held); P.w.tick();
        for (const e of P.G.sink.log) { const k = e[0] + (e[1] ?? ''); evP[k] = (evP[k] ?? 0) + 1; }
        ticks++;
        if (i % 20 === 0) {
          const lab = `parallel${seed} dt${dt} t${i}`;
          const np = P.G.node, no = O.H.readNode('trex', 0x31000000 + 335 * 0x100);
          const disc = [[P.w.vars.get(0xfa), P.w.vars.get(0xfb), P.w.vars.get(0xfc), P.w.vars.get(0xfd), P.w.vars.get(0xfe), P.w.vars.get(0xff)], [O.w.vars.get(0xfa), O.w.vars.get(0xfb), O.w.vars.get(0xfc), O.w.vars.get(0xfd), O.w.vars.get(0xfe), O.w.vars.get(0xff)],
            [np.hits, np.lane, np.prevLane, np.stunned ? 1 : 0, np.burning ? 1 : 0, np.jumping ? 1 : 0, np.blink, np.stepState, np.rumbleOn ? 1 : 0], [no.hits, no.lane, no.prevLane, no.stunned, no.burning, no.jumping, no.blink, no.stepState, no.rumbleOn]];
          const rec = [];
          for (const r of P.w.records) {
            if (!r.ctrl && r.index !== 336) continue;
            const q = O.w.records[r.index];
            rec.push([r.index, r.flags & 0xfffe, r.anim?.clip], [r.index, q.flags & 0xfffe, q.anim?.clip]);
            for (const n of r.ctrl?.nodes ?? []) { const kind = KIND_OF_PORT[n.kind]; if (!kind || kind === 'trex') continue; const o = O.H.readNode(kind, 0x31000000 + r.index * 0x100), m = O.H.portNode(kind, n); for (const k of Object.keys(o)) if (/state|owner/.test(k)) { rec.push([r.index, kind, k, m[k]]); rec.push([r.index, kind, k, o[k]]); } }
          }
          const mine = JSON.stringify([disc[0], disc[2], rec.filter((_, j) => j % 2 === 0)]), orig = JSON.stringify([disc[1], disc[3], rec.filter((_, j) => j % 2 === 1)]);
          checked++;
          if (mine !== orig) { diverged = { tick: i, dt, seed, why: ((a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return `${a.slice(Math.max(0, j - 30), j + 40)} vs ${b.slice(Math.max(0, j - 30), j + 40)}`; return ''; })(mine, orig) }; break; }
          for (const k of ['z', 'speed', 'offset', 'clock', 'camZ', 'blinkT', 'jumpTime', 'rumbleT']) drift(np[k], no[k], `rex ${k}`, lab);
          for (const r of P.w.records) { if (!r.ctrl && r.index !== 336) continue; const q = O.w.records[r.index]; for (const k of [12, 13, 14]) drift(r.m[k], q.m[k], `record ${r.index} ${r.name} m[${k}]`, lab); if (r.anim && !spectators.has(r.index)) drift(r.anim.frame, q.anim.frame, `record ${r.index} ${r.name} frame`, lab); }
          // a position that is further apart than rounding explains (a prop one step ahead after a trigger that fired one tick earlier / later) is the same divergence, seen from the other side
          if (tooFar) { diverged = { tick: i, dt, seed, why: tooFar }; break; }
        }
        if (P.w.vars.get(0xfa) === 7 && ++over > 20) break;
        if (failures.length > MAXFAIL) break;
      }
      if (diverged) bad(`parallel${seed} dt${dt}: the two worlds diverge already at tick ${diverged.tick}: ${diverged.why}`);
      if (!diverged) {
        // no divergence: the event totals of the whole game (sounds, speech, rumble) must be the same
        // (the fog call of the arrival camera is the zone game's, hosted only on the original's side)
        const nofog = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('fog')));
        eq(nofog(evP), nofog(evO), `parallel${seed} dt${dt}: event totals over ${ticks} ticks`);
      } else { stats.deviations.floatDivergence = (stats.deviations.floatDivergence ?? 0) + 1; stats.parallel.push(diverged); }
      notes.push(`parallel (no resync) seed ${seed} dt ${dt}: ${ticks} ticks, phase ${P.w.vars.get(0xfa)}/${O.w.vars.get(0xfa)}, hits ${P.G.node.hits}/${O.H.readNode('trex', 0x31000000 + 335 * 0x100).hits}, largest position drift ${dr.max.toExponential(2)} (${dr.at})${diverged ? `; FIRST DISCRETE DIFFERENCE at tick ${diverged.tick}: ${diverged.why}` : '; no discrete difference'}`);
      stats.ticks += ticks;
    }


    if (S0.cov) { const fs = globalThis.process.getBuiltinModule('node:fs'); fs.writeFileSync(process.env.TRX_COV, JSON.stringify([...S0.cov].sort((a, b) => a - b))); }
    notes.push(`visited: phases ${[...stats.phases].sort().join(',')}; rex clips ${[...stats.clips].sort((a, b) => a - b).map((c) => c.toString(16)).join(',')}; node updates ${JSON.stringify(stats.kinds)}; rex states (ticks) ${JSON.stringify(stats.flags)}`);
    notes.push(`events compared (kind+id: count): ${Object.entries(stats.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    notes.push(`KNOWN DEVIATIONS counted: ${JSON.stringify(stats.deviations)} (float32 accumulation drift; the spectators' frustum bit is a distance proxy handed to both sides)`);
    notes.push(`scene matrices (extraction, formats/matrix.ts) against the builder's float32 products: largest difference ${(stats.sceneDiff ?? 0).toExponential(2)}`);
    notes.push(`ticks by scenario: ${JSON.stringify(grp)}`);
    notes.push(`${stats.ticks} ticks compared, original passes ${stats.ms} ms`);
    notes.push(`terrain-height differences: at most ${(stats.hRatio ?? 0).toFixed(2)} ulp of z`);
    return { checked, failures, notes };
  },
};
