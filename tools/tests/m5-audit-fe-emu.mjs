// M5 audit, front end z60FRE, the ORACLE test: the original's stage nodes (Pepper on the skateboard FUN_004721f0, the frozen figure FUN_004728e2, the train FUN_00472adb, the Brickster
// FUN_00472d7d with their constructors) run in the x86 interpreter (tools/lib/fe-emu.mjs) next to the TypeScript port (src/shell/fenodes.ts); both get the same random numbers and the
// matrices of the records, the flags, the model pointer, the clip / frame of the animations and the node fields are compared tick by tick.
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { FeEmu } from '../lib/fe-emu.mjs';
import { buildRecords } from '../../src/game/zone.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { World } from '../../src/game/world.ts';
import { ButterflyNode } from '../../src/island/ambient/animals.ts';
import { ArgView } from '../../src/island/args.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';
import { Controller } from '../../src/game/controller.ts';
import { RF_FRUSTUM } from '../../src/game/record.ts';
import { FePepperNode, FeFigureNode, FeTrainNode, FeBricksterNode, feTables, FE_REC } from '../../src/shell/fenodes.ts';
import { setRandSource } from '../../src/game/crt.ts';
import { guarded } from '../lib/inject-guard.mjs';

/** a seeded rand(): the MSVC LCG (FUN_0085daf0: seed * 214013 + 2531011, bits 16..30) */
class Lcg {
  constructor(seed, exact = false) { this.s = seed >>> 0; this.exact = exact; }
  int() { this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0; return (this.s >>> 16) & 0x7fff; }
  next() { return this.int() / 32767; }
  /** `exact`: FUN_004388ae(max) = (float)rand() / 32767 * max, both operations rounded to float32 (0 and no draw for max <= 0), as src/game/crt.ts `randF` draws it; else an unrounded product */
  range(x) { if (x <= 0) return 0; return this.exact ? Math.fround(Math.fround(this.int() / 32767) * Math.fround(x)) : this.next() * x; }
  /** the same draw as the island rng's source value in [0, 1) (rng.ts: rand() = floor(v * 32768)) */
  source() { return (this.int() + 0.5) / 32768; }
}

const NODE_RECORDS = [FE_REC.PEPPER, FE_REC.BRICKSTER, FE_REC.FIGURE, FE_REC.TRAIN];

const __test = {
  name: 'm5-audit-fe-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const scene = sceneOf(ctx, 'z60FRE');
    const archive = ctx.archives.find((a) => a.name === 'z60FRE');
    const blk = (n) => parseBlk(archive.read(archive.find(`anim/${n}.blk`)));
    const mfig = blk('MFIG'), skbd = blk('SKBD');
    const tables = feTables(pe);

    /** the stage records as FUN_0047ec85 / FUN_00471070 leave them: animation instances for records 0 .. 21 (rig MFIG, record 1 SKBD, clip 1), model tokens */
    const stage = () => {
      const data = buildRecords('z60FRE', scene, archive);
      const recs = data.records;
      recs.forEach((r, i) => { r.model = { tok: i }; });
      for (let i = 0; i <= 21; i++) { recs[i].anim = new AnimInstance(i === 1 ? skbd : mfig); recs[i].anim.start(1, 0); }
      return recs;
    };
    const names = ['pepper', 'brickster', 'figure', 'train'];
    const seenFx = {};

    /** the step time of tick t: `dt1` / `dt05` fixed, `real` = the loops' rule (1.0 for the first five frames, then 0.5) */
    const dtOf = (mode, t) => (mode === 'dt1' ? 1 : mode === 'dt05' ? 0.5 : t < 5 ? 1 : 0.5);
    const scenario = (label, seed, ticks, mode = 'dt1') => {
      const portRecs = stage(), emuRecs = stage();
      const w = new World(); w.records = portRecs;
      // both sides draw the same MSVC LCG: the port through the shared generator (src/game/crt.ts `setRandSource`), the oracle's hooked FUN_004388ae through `range` (float32 operations, as the original's x87 at 24 bit)
      const rngP = new Lcg(seed), rngO = new Lcg(seed, true);
      setRandSource(() => rngP.int());
      // the particle calls of the port (FeFx): compared with the original's FUN_0044e920 / FUN_0044ea00 calls recorded by the oracle (tools/lib/fe-emu.mjs `fx`)
      const portFx = [];
      const matOf = (m) => { const a = typeof m === 'function' ? m() : m; const i = portRecs.findIndex((r) => r.m === a); return i >= 0 ? { rec: i } : { local: Array.from(a) }; };
      let handles = 0;
      const env = {
        tables,
        fx: {
          start: (name, matrix, pos, rot, gate) => { portFx.push({ fn: 'start', name, mat: matOf(matrix), pos: Array.from(pos), rot: Array.from(rot), gate: Array.from(gate) }); return 0x100 + handles++; },
          setMatrix: (handle, matrix) => { portFx.push({ fn: 'setMatrix', handle: handle - 0x100, mat: matOf(matrix) }); },
        },
      };
      let fxAt = 0;
      const nodes = { pepper: new FePepperNode(env), figure: new FeFigureNode(env), train: new FeTrainNode(env), brickster: new FeBricksterNode(env) };
      const emu = new FeEmu(pe, emuRecs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags })), new Map(emuRecs.slice(0, 22).map((r, i) => [i, r.anim])), { rng: rngO });
      const recOf = { pepper: 0, brickster: 2, figure: 8, train: 44 };
      // constructors: the original's in the oracle, the port's init (the attach order of FUN_00471070: Pepper, figure, train, Brickster, same as the random draws of the originals)
      for (const k of ['pepper', 'figure', 'train', 'brickster']) {
        emu.construct(k, recOf[k]);
        nodes[k].init(w, portRecs[recOf[k]]);
      }
      let worst = {};
      const fxStats = seenFx;
      const compareFx = (tick) => {
        // the calls since the last comparison: same effect, matrix (record or the local copy's content), position, rotation, gate, in the same order
        const o = emu.fx.slice(fxAt), p = portFx.slice(fxAt);
        fxAt = emu.fx.length;
        checked++;
        if (o.length !== p.length) { if (failures.length < 14) failures.push(`${label}: tick ${tick} particle calls: original ${o.length}, port ${p.length}`); fxAt = portFx.length; return; }
        o.forEach((a, k) => {
          const b = p[k];
          checked++;
          const strip = (x) => JSON.stringify({ ...x, mat: x.mat.rec !== undefined ? x.mat : { local: true } });
          if (strip(a) !== strip(b) && failures.length < 14) failures.push(`${label}: tick ${tick} particle call ${k}: original ${strip(a)} port ${strip(b)}`);
          if (a.mat.local) for (let q = 0; q < 16; q++) { checked++; if (!(Math.abs(a.mat.local[q] - b.mat.local[q]) <= 0) && failures.length < 14) failures.push(`${label}: tick ${tick} particle call ${k} local matrix [${q}]: original ${a.mat.local[q]} port ${b.mat.local[q]}`); }
          if (a.fn === 'start') fxStats[a.name + ':' + a.gate.join(',')] = (fxStats[a.name + ':' + a.gate.join(',')] ?? 0) + 1;
          if (a.fn === 'setMatrix') fxStats['setMatrix:' + (a.mat.rec !== undefined ? 'rec' + a.mat.rec : 'local')] = (fxStats['setMatrix:' + (a.mat.rec !== undefined ? 'rec' + a.mat.rec : 'local')] ?? 0) + 1;
        });
      };
      const cmp = (tick, name, a, b, tol = 0) => {
        checked++;
        const d = Math.abs(a - b);
        worst[name] = Math.max(worst[name] ?? 0, d);
        if (!(d <= tol * Math.max(1, Math.abs(a))) && failures.length < 14) failures.push(`${label}: tick ${tick} ${name}: original ${a} port ${b}`);
      };
      const compare = (tick) => {
        for (const i of [0, 1, 2, 8, 44, 45]) {
          const om = emu.matrix(i), pm = portRecs[i].m;
          for (let k = 0; k < 16; k++) cmp(tick, `rec${i}.m${k}`, om[k], pm[k]);
        }
        for (let i = 0; i <= 21; i++) cmp(tick, `rec${i}.flags`, emu.flags(i), portRecs[i].flags, 0);
        cmp(tick, 'pepper.model', emu.modelOf(0), portRecs[0].model.tok, 0);
        for (const i of [0, 1, 2, 8]) {
          cmp(tick, `anim${i}.clip`, emuRecs[i].anim.clip, portRecs[i].anim.clip, 0);
          cmp(tick, `anim${i}.frame`, emuRecs[i].anim.frame, portRecs[i].anim.frame, 0);
        }
        const P = nodes.pepper;
        cmp(tick, 'pepper.counter', emu.field('pepper', 0, 0x2c), P.counter, 0);
        cmp(tick, 'pepper.gag', emu.field('pepper', 0, 0x34), P.gag, 0);
        cmp(tick, 'pepper.dir', emu.field('pepper', 0, 0x28), P.dir, 0);
        cmp(tick, 'pepper.gagLeft', emu.field('pepper', 0, 0x38), P.gagLeft, 0);
        cmp(tick, 'pepper.duration', emu.field('pepper', 0, 0x1c), P.duration, 0);
        cmp(tick, 'pepper.speed', emu.fieldf('pepper', 0, 0x14), P.speed, 0);
        cmp(tick, 'figure.cnt', emu.field('figure', 8, 0x1c), nodes.figure.cnt, 0);
        cmp(tick, 'train.cnt', emu.field('train', 44, 0x1c), nodes.train.cnt, 0);
        cmp(tick, 'train.phase', emu.field('train', 44, 0x20), nodes.train.phase, 0);
        cmp(tick, 'brickster.cnt', emu.field('brickster', 2, 0x1c), nodes.brickster.cnt, 0);
        cmp(tick, 'brickster.sel', emu.field('brickster', 2, 0x20), nodes.brickster.sel, 0);
      };
      compare(-1);
      compareFx(-1);
      const seen = { gags: new Set(), outfits: new Set(), poses: new Set(), crossings: 0, train: 0, brickster: 0 };
      let lastDir = 0;
      for (let t = 0; t < ticks && failures.length < 14; t++) {
        const dt = dtOf(mode, t);
        w.dt = dt; emu.setDt(dt);
        // the update pass: records in index order (0 Pepper, 2 Brickster, 8 figure, 44 train)
        for (const i of NODE_RECORDS) {
          const k = names[NODE_RECORDS.indexOf(i)];
          emu.update(k, i);
          nodes[k].update(w, portRecs[i], null);
        }
        compare(t);
        compareFx(t);
        if (nodes.pepper.gag >= 0) seen.gags.add(nodes.pepper.gag);
        seen.outfits.add(portRecs[0].model.tok);
        if (portRecs[2].flags & 2) seen.poses.add(nodes.brickster.sel);
        if (nodes.pepper.dir !== lastDir) { seen.crossings++; lastDir = nodes.pepper.dir; }
        if (nodes.train.phase === 1) seen.train++;
      }
      setRandSource(null);
      return { worst, seen, emu };
    };

    /**
     * the seven butterflies BFS0 .. BFS6 (FUN_004b2d44, update FUN_004b24f8, pre-render FUN_004b2539, which does the moving): Pepper moves on a scripted course, Shift is pressed at
     * random ticks (follow / release), the frustum flag of each record flips at random for stretches of up to 400 ticks (the 200-tick freeze and reset)
     */
    const butterflies = (label, seed, ticks, mode = 'dt1') => {
      const portRecs = stage(), emuRecs = stage();
      const w = new World(); w.records = portRecs; w.ext.set('frustum', true); w.focus = portRecs[0];
      const inp = { pressed: 0 }; w.input = inp;
      const rngP = new Lcg(seed), rngO = new Lcg(seed ^ 0x5a5a, true);
      const rngSim = new Lcg(seed + 1);
      rngO.s = rngP.s;                              // both draw the same sequence
      setAmbientRandom(() => rngP.source());
      const emu = new FeEmu(pe, emuRecs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags })), new Map(), { rng: rngO });
      const mem = emu.cpu.mem;
      const arg = emu.alloc(0x80); mem.wf32(arg, 8);
      const ids = [41, 40, 39, 38, 37, 36, 35];
      const ctrls = new Map(), pctrl = new Map(), nodes = new Map();
      for (const i of ids) {
        const c = emu.alloc(0x40); ctrls.set(i, c); mem.w32(emu.recPtr(i) + 0x5c, c);
        nodes.set(i, emu.brk);
        emu.cpu.call(0x4b2d44, [emu.recPtr(i), arg, 0, 0, 2, 1], { maxSteps: 5_000_000 });
        emu.nodes.set('butterfly' + i, nodes.get(i));
        const n = new ButterflyNode(new ArgView(new Uint8Array(new Float32Array([8, ...new Array(31).fill(0)]).buffer)));
        pctrl.set(i, new Controller()); portRecs[i].ctrl = pctrl.get(i);
        nodes.set('p' + i, n);
      }
      mem.w32(0x9da5d0, emu.recPtr(0));
      let worst = 0;
      const cmp = (tick, name, a, b, tol = 0) => {
        checked++;
        const d = Math.abs(a - b);
        worst = Math.max(worst, d);
        if (!(d <= tol * Math.max(1, Math.abs(a))) && failures.length < 14) failures.push(`${label}: tick ${tick} ${name}: original ${a} port ${b}`);
      };
      const inView = new Map(ids.map((i) => [i, true]));
      let seenFollow = 0, seenReset = 0;
      const start = ids.map((i) => [portRecs[i].m[12], portRecs[i].m[13], portRecs[i].m[14]]);
      let travelled = 0;
      for (let t = 0; t < ticks && failures.length < 14; t++) {
        const dt = dtOf(mode, t);
        w.dt = dt; emu.setDt(dt);
        // Pepper: the same matrix on both sides (a slow course along the stage)
        const px = 40 * Math.sin(t / 150), pz = 5 + 3 * Math.sin(t / 60);
        for (const r of [portRecs[0]]) { r.m[12] = px; r.m[13] = 3.2; r.m[14] = pz; }
        mem.wf32(emu.recPtr(0) + 0xc + 4 * 12, px); mem.wf32(emu.recPtr(0) + 0xc + 4 * 13, 3.2); mem.wf32(emu.recPtr(0) + 0xc + 4 * 14, pz);
        // Shift: a short press at random ticks
        const pressed = rngSim.int() % 40 === 0 ? 0x40 : 0;
        inp.pressed = pressed; mem.w32(0x983840, pressed);
        for (const i of ids) {
          if (rngSim.int() % 300 === 0) inView.set(i, !inView.get(i));
          const fl = inView.get(i) ? 3 : 2;               // record flag 1 = in view (+ 2 = enabled)
          // the node sets bit 0x10 itself: keep it out of the comparison by rewriting both sides' flag words
          portRecs[i].flags = fl | (portRecs[i].flags & 0x10); mem.w16(emu.recPtr(i) + 0x60, fl | (mem.r16(emu.recPtr(i) + 0x60) & 0x10));
          // the controller's distance to the focus (FUN_0042226e): squared XZ distance
          const dx = portRecs[i].m[12] - portRecs[0].m[12], dz = portRecs[i].m[14] - portRecs[0].m[14];
          const d2 = Math.fround(dx * dx + dz * dz);
          pctrl.get(i).distSq = d2; mem.wf32(ctrls.get(i) + 0x18, d2);
        }
        for (const i of ids) {
          // update (nearest bookkeeping + the port's lazy init), then the pre-render pass
          nodes.get('p' + i).update(w, portRecs[i], pctrl.get(i));
          emu.cpu.call(0x4b24f8, [emu.recPtr(i), nodes.get(i), ctrls.get(i)]);
        }
        for (const i of ids) {
          nodes.get('p' + i).prerender(w, portRecs[i], pctrl.get(i));
          emu.cpu.steps = 0;
          emu.cpu.call(0x4b2539, [emu.recPtr(i), nodes.get(i)], { maxSteps: 5_000_000 });
        }
        for (const i of ids) {
          const om = emu.matrix(i), pm = portRecs[i].m;
          for (let k = 0; k < 16; k++) cmp(t, `bf${i}.m${k}`, om[k], pm[k], 0);   // the butterflies are the island ButterflyNode (src/island: float32 per operation since WP-ISLAND-FIX)
          const n = nodes.get('p' + i);
          cmp(t, `bf${i}.cnt`, emu.i(nodes.get(i) + 0x3c), n.cnt, 0);
          cmp(t, `bf${i}.cnt2`, emu.i(nodes.get(i) + 0x40), n.cnt2, 0);
          cmp(t, `bf${i}.off`, emu.i(nodes.get(i) + 0x48), n.off, 0);
          cmp(t, `bf${i}.follow`, emu.i(nodes.get(i) + 0x4c) ? 1 : 0, n.follow ? 1 : 0, 0);
          cmp(t, `bf${i}.speed`, emu.f(nodes.get(i) + 0x50), n.speed, 0);
          if (n.follow) seenFollow++;
          if (n.off === 200) seenReset++;
        }
      }
      setAmbientRandom(null);
      ids.forEach((i, k) => { travelled += Math.hypot(portRecs[i].m[12] - start[k][0], portRecs[i].m[13] - start[k][1], portRecs[i].m[14] - start[k][2]); });
      if (travelled < 10) failures.push(`${label}: the butterflies did not move (${travelled})`);
      return { seenFollow, seenReset, worst, travelled };
    };
    const bsum = { follow: 0, reset: 0 };
    for (const mode of ['dt1', 'dt05', 'real']) for (const seed of [3, 17, 404]) { const r = butterflies(`butterflies ${mode} seed ${seed}`, seed, 4000, mode); bsum.follow += r.seenFollow; bsum.reset += r.seenReset; bsum.travelled = (bsum.travelled ?? 0) + r.travelled; }
    notes.push(`butterflies: 3 modes (dt 1, dt 0.5, real) x 3 seeds x 4000 ticks x 7 records, follow ticks ${bsum.follow}, reset ticks ${bsum.reset}, net travel ${bsum.travelled.toFixed(0)}`);

    const runs = [[1, 6000], [7, 6000], [12345, 6000], [99, 6000], [2026, 6000]];
    const agg = { gags: new Set(), outfits: new Set(), poses: new Set(), crossings: 0, train: 0 };
    let unhooked = new Map();
    for (const [seed, ticks, mode] of runs.flatMap(([seed, ticks]) => ['dt1', 'dt05', 'real'].map((mode) => [seed, ticks, mode]))) {
      const r = scenario(`${mode} seed ${seed}`, seed, ticks, mode);
      for (const g of r.seen.gags) agg.gags.add(g);
      for (const g of r.seen.outfits) agg.outfits.add(g);
      for (const g of r.seen.poses) agg.poses.add(g);
      agg.crossings += r.seen.crossings; agg.train += r.seen.train;
      for (const [a, n] of r.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
    }
    notes.push(`${runs.length} seeds x 3 dt modes x ${runs[0][1]} ticks: ${agg.crossings} crossings, gags seen ${[...agg.gags].sort().join(',')}, outfits ${agg.outfits.size}, Brickster poses ${[...agg.poses].sort().join(',')}, train ticks ${agg.train}`);
    notes.push(`particle calls compared with the original's: ${Object.entries(seenFx).map(([k, v]) => `${k} x${v}`).join(', ')}`);
    if (unhooked.size) notes.push(`oracle calls into unhooked engine functions (return 0): ${[...unhooked].map(([a, n]) => `0x${a.toString(16)} x${n}`).join(' ')}`);
    if (agg.crossings < 20) failures.push(`too few crossings (${agg.crossings})`);
    if (agg.gags.size < 4) failures.push(`too few gags seen (${agg.gags.size})`);
    if (agg.train < 100) failures.push('the train never rode');
    return { checked, failures, notes };
  },
};
export default guarded(__test);
