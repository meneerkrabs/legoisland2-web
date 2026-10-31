// WP-TIME (FX_Bricks): the brick simulation of the port against the ORIGINAL's FX_Bricks code run natively in the x86 interpreter (tools/lib/brick-sim-emu.mjs), at tolerance 0 (bits).
// Random effect slots (real BrickMorph models and synthetic ones parsed by the port's own loader) with random stage callbacks (appear, vanish, swap, blow away with / without a second spin,
// drop, drop range, the four morphs), parameters, waits, visibility modes; operations per frame: game variable changes, bursts, finish (FUN_00449b00), camera moves, record flags
// (0x2000 pause), the pool of 2048 actions running dry (big models, several effects at once); the frame step dt = 1 / 0.5 / the game's 1.0 x 5 then 0.5; the C runtime's rand() seeded the
// same on both sides. After EVERY frame all bricks (local + world matrix, rotations, rates, place, home, norm, displacement, flags, LOD, partner), all their actions (state, delay, fields), the
// slots (state, time, wait, stage, sound handle), the record flags, the click / drop counters and the sounds are compared bit for bit.
import { loadExe } from '../lib/engine-load.mjs';
import { BrickLibrary, loadBrickModel } from '../../src/formats/bricks.ts';
import { BrickPair } from '../lib/brick-sim-emu.mjs';
import { slotImage } from '../../src/fx/bricks/save.ts';
import { makeRng } from '../lib/m7-shell-save-emu.mjs';
import { setRandSource } from '../../src/game/crt.ts';
import { guarded } from '../lib/inject-guard.mjs';

const FNS = [0, 1, 2, 4, 5, 7, 8, 10, 11, 12, 13];
/** the callbacks whose effect always ends (the others can wait for ever on random parameters, in the original too: `finish` would not return) */
const FINITE = [0, 1, 2, 7, 8];
const F = new Float32Array(1), U = new Uint32Array(F.buffer);
const bitsOf = (x) => { F[0] = x; return U[0]; };

const __test = {
  name: 'wptime-bricks-sim',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const full = !!process.env.BRICKSIM_FULL;
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    const pe = loadExe(ctx.dataRoot);
    const real = new BrickLibrary(pe, arc('Bricks'), arc('BrickMorph'));
    const custom = new Map();
    const lib = { types: real.types, dicts: real.dicts, model: (f) => custom.get(f) ?? real.model(f) };
    const files = arc('BrickMorph').entries.map((e) => e.path).filter((p) => /\.txt$/i.test(p)).map((p) => ({ file: p, n: real.model(p).bricks.length })).filter((m) => m.n > 0);
    const small = files.filter((m) => m.n <= 130), big = files.filter((m) => m.n >= 150);
    const typeNames = real.types.filter(Boolean).map((t) => t.name);
    const colourNames = [...real.dicts.colours.keys()], groupNames = [...real.dicts.groups.keys()];

    /** a synthetic model text (the original's file format) -> the port's parse; stored under a made-up file name */
    const synth = (R, name, max = 40) => {
      const nb = 3 + R.int(max), lines = [`NAME ${name}`, 'MODELTYPE HOUSE', R.chance(0.5) ? 'CENTRE AUTO' : `CENTRE VECTOR ${R.int(5)} ${R.int(3)} ${R.int(5)}`];
      for (let i = 0; i < nb; i++) {
        if (R.chance(0.12)) lines.push('NEWLAYER');
        const g = R.chance(0.15) ? 'XXX' : R.pick(groupNames);
        lines.push(`${g} ${R.pick(typeNames)} ${R.int(14) - 3} ${R.int(9)} ${R.int(14) - 3} ${R.pick([0, 90, 180, 270, 45, 17])} ${R.pick([0, 90, 180, 270, 33])} ${R.pick([0, 0, 90])} ${R.pick(colourNames)}${R.chance(0.2) ? ' ' + R.pick(colourNames) : ''}`);
      }
      const data = loadBrickModel(lines.join('\n'), lib);
      custom.set(name, data);
      return { file: name, n: data.bricks.length };
    };

    let loads = 0;
    const rf = (R, lo, hi) => R.f32(lo, hi);
    /** the 24 words of a stage's parameter block for callback `fn` (floats; callback 8 keeps ints at 5 / 6) */
    const words = (R, fn, nBricks, finite) => {
      const w = new Float32Array(24);
      const morph = fn >= 10;
      w[0] = morph ? rf(R, 0.3, 3) : R.chance(0.75) ? rf(R, 0.5, 5) : R.pick([0, -1]);
      w[1] = rf(R, 0.02, 0.4);
      for (let k = 2; k < 11; k++) w[k] = k < 5 ? rf(R, -1.2, 1.2) : rf(R, -0.4, 0.8);          // spin A: target rates, accelerations, random accelerations
      for (let k = 11; k < 20; k++) w[k] = k < 14 ? rf(R, -1.2, 1.2) : rf(R, -0.4, 0.8);        // spin B / float-away acceleration + limit
      for (let k = 20; k < 24; k++) w[k] = rf(R, -3, 3);                                         // fly-out centre / float-away B acceleration
      if (fn === 4) { w[14] = rf(R, 5, 3000); for (let k = 11; k < 14; k++) w[k] = rf(R, 0.05, 1.2); }
      if (fn === 5) for (let k = 20; k < 23; k++) w[k] = rf(R, 0.05, 1.2);
      if (fn === 7 || fn === 8) { w[2] = rf(R, finite ? 0.25 : 0.05, 0.9); w[3] = rf(R, 0, 0.5); w[4] = rf(R, 2, finite ? 10 : 90); }   // (`finish` runs the whole fall in one call: keep it short)
      const u = new Uint32Array(w.buffer);
      if (fn === 8) { const first = R.int(nBricks), last = R.chance(0.3) ? 0xffffffff : Math.min(nBricks, first + 1 + R.int(nBricks)); u[5] = first; u[6] = last >>> 0; }
      return Array.from(u);
    };

    const scenario = (seed, o) => {
      const R = makeRng(seed);
      const nSlots = o.slots ?? 1 + R.int(3);
      let finiteNow = false;
      const pickFile = () => { const pool = o.pool ?? (R.chance(0.35) ? null : o.maxBricks ? small.filter((m) => m.n <= o.maxBricks) : finiteNow ? small.filter((m) => m.n <= 50) : small); return pool ? R.pick(pool) : synth(R, `SYN${seed}_${custom.size}.TXT`, o.maxBricks ?? 40); };
      const records = Array.from({ length: nSlots }, (_, i) => {
        const m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, rf(R, -60, 60), rf(R, 0, 30), rf(R, -60, 60), 1]);
        if (R.chance(0.4)) { const a = rf(R, -3, 3), c = Math.fround(Math.cos(a)), s = Math.fround(Math.sin(a)); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
        return { name: `T${i}AB`, flags: 2 | (R.chance(0.15) ? 0x2000 : 0), m };
      });
      const vars = new Int32Array(319);
      let P = new BrickPair(pe, lib, records, vars);
      setRandSource(null);
      P.seed(1 + R.int(1 << 20));
      const slots = [];
      const finite = o.finite ?? R.chance(0.3);
      finiteNow = finite;
      for (let i = 0; i < nSlots; i++) {
        const v = 0x40 + i;
        const s = P.register(i, v);
        const k = o.models ?? 2 + R.int(3);
        const ms = Array.from({ length: k }, () => pickFile());
        ms.forEach((m) => P.addModel(s, m.file));
        const fns = [];
        for (let st = 0; st < k; st++) {
          const fn = o.fn?.[st % o.fn.length] ?? R.pick(finite ? FINITE : FNS);
          fns.push(fn);
          P.stage(s, st, fn, words(R, fn, ms[st].n, finite), R.int(3));
        }
        if (R.chance(0.5)) P.wait(s, rf(R, 0.2, 3));
        slots.push({ s, v, k, fns, ms });
      }
      const dtMode = o.dt ?? R.pick(['game', 'one', 'half', 'odd', 'odd']);
      const frames = o.frames ?? 260;
      let t = 0;
      const err = [];
      const compare2 = (X, label) => { const d = X.diff(label, process.env.BRICKSIM_VERBOSE ? 80 : 12); checked += 1; if (d.length) { err.push(...d); return false; } return true; };
      const compare = (label) => compare2(P, label);
      if (!compare(`seed ${seed} set-up`)) return err;
      for (; t < frames; t++) {
        P.setDt(dtMode === 'game' ? (t < 5 ? 1 : 0.5) : dtMode === 'one' ? 1 : dtMode === 'odd' ? rf(R, 0.3, 1.4) : 0.5);   // ('odd': an arbitrary step, so that no product by dt is exact)
        if (o.loadAt === t) {
          // FUN_00449be0: every slot is saved as its image (FUN_00449a10 / `slotImage`) and loaded into a fresh pair: the original's loader runs natively, the port's `restoreSlot` replays the same
          // morph (10 x time steps at dt 1/10 with the callback played again); the two must stand in the same state, and go on identically
          const imgs = P.fx.slots.map((sl) => (sl ? slotImage(sl) : null));
          const Q = new BrickPair(pe, lib, records.map((r, i) => ({ name: r.name, flags: P.recs[i].flags, m: P.recs[i].m })), Int32Array.from(P.vars));
          Q.setEye(...P.eye); Q.setDt(P.dt); Q.seed(900 + seed);
          Q.loadImages(imgs);
          loads++;
          if (!compare2(Q, `seed ${seed} load at frame ${t}`)) return err;
          Q.setDt(P.dt);          // (the loader leaves DAT_008b1718 = 1/10: the main loop sets the step again every frame)
          P = Q;
        }
        // operations of this frame
        if (t % (o.period ?? 22) === 3 || R.chance(0.02)) { const sl = R.pick(slots); P.setVar(sl.v, o.vars ? o.vars(sl, t) : R.int(sl.k * 2)); }
        if (R.chance(0.04)) P.burst(R.int(nSlots), R.pick(finite ? [6] : [6, 0xb, 0xc, 0xd, 0xa, 3, 0]));
        if (finite && R.chance(0.03)) { const sl = R.pick(slots); try { P.finish(sl.s); } catch (e) { throw new Error(`seed ${seed} frame ${t}: finish of slot ${sl.s} fns ${sl.fns} models ${sl.ms.map((m) => m.file + ':' + m.n)} flags ${P.recs.map((r) => r.flags.toString(16))} state ${P.fx.slots[sl.s].state} stage ${P.fx.slots[sl.s].stage}: ${e.message}`); } }
        if (R.chance(0.04)) P.setEye(rf(R, -80, 80), rf(R, -10, 60), rf(R, -80, 80));
        if (R.chance(0.03)) { const r = R.int(nSlots); P.setFlags(r, P.recs[r].flags ^ R.pick([0x2000, 0x8000, 0x4000, 2])); }
        P.update();
        if (!compare(`seed ${seed} frame ${t} (dt ${dtMode})`)) break;
      }
      return err;
    };

    // debugging: BRICKSIM_SEED=<seed> BRICKSIM_OPTS='{"loadAt":40,"frames":180,"maxBricks":30,"dt":"half"}' runs one scenario (BRICKSIM_VERBOSE=1: more differences)
    if (process.env.BRICKSIM_SEED) { const e = scenario(Number(process.env.BRICKSIM_SEED), JSON.parse(process.env.BRICKSIM_OPTS ?? '{}')); return { checked, failures: e.slice(0, 40), notes }; }
    // random scenarios
    const N = full ? 120 : 14;
    for (let sd = 1; sd <= N; sd++) {
      const e = scenario(sd * 7919, {});
      failures.push(...e.slice(0, 6));
      if (failures.length > 30) break;
    }
    // every callback alone, both dt, small and synthetic models
    if (failures.length === 0) for (const fn of FNS) for (const dt of ['one', 'half', 'game', 'odd']) {
      const e = scenario(1000 + fn * 10 + (dt === 'one' ? 1 : dt === 'half' ? 2 : dt === 'game' ? 3 : 4), { fn: [fn], slots: 1, models: 2, dt, frames: 230, finite: FINITE.includes(fn) });
      failures.push(...e.slice(0, 6));
    }
    // save / load in the middle of effects: the loader's replay (10 x time steps at dt 0.1, the callback of the target stage played again) against the original's FUN_00449be0
    if (failures.length === 0) for (let sd = 1; sd <= (full ? 40 : 10); sd++) {
      for (const at of [15, 40, 90]) {
        const e = scenario(31000 + sd * 101 + at, { loadAt: at, frames: at + 140, finite: false, period: 18, maxBricks: 30, dt: 'half' });
        failures.push(...e.slice(0, 6));
      }
    }
    // the pool of 2048 actions runs dry: three big effects morphing at once
    if (failures.length === 0 && big.length) {
      const e = scenario(555, { slots: 3, models: 2, pool: big, fn: [10, 11, 12], dt: 'half', frames: 120, period: 1000, vars: () => 1 });
      failures.push(...e.slice(0, 6));
      notes.push(`pool scenario: ${big.length} big models`);
    }
    { const st = BrickPair.stats; notes.push(`coverage: ${st.frames} frames, ${st.bricks} brick states, actions by type ${JSON.stringify(st.act)}, ${st.sounds} sounds, LOD of visible bricks ${st.lod}, pool max ${st.poolMax} (${st.poolFull} frames with an empty pool)`); }
    notes.push(`${loads} save / load round trips (the original's loader against restoreSlot)`);
    notes.push(`${checked} full-state comparisons (every brick, action, slot, sound) at tolerance 0`);
    void bitsOf;
    return { checked, failures, notes };
  },
};
export default guarded(__test);
