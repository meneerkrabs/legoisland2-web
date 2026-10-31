// WP-TIME (particles): the engine advances ONCE PER SIM STEP with that step's own dt, whatever the render rate is (FUN_00442930 -> FUN_0044e8e0 runs once per drawn frame of the original;
// the port's sim step is that frame at the fixed 60 Hz). `tickParticles(world)` (src/fx/particles/ticker.ts) is the per-step call the world's loop makes after `World.tick()` and before
// `advanceDt()`; the render hook (`GameRenderer.particles`) only draws, and a draw that follows several sim steps (a slow display) still owes every one of them its spin step
// (FUN_0044f4c0 spins the visible sprites by that frame's DAT_008b1718 after each draw). Checked on a real effect (twinkle01 has a spin): rendering at 60 Hz, at 20 Hz, twice per step and
// not at all must give the same engine state and the same sprite angles (bits).
import { ZoneParticles, tickParticles } from '../../src/fx/particles/zone.ts';
import { AP } from '../../src/fx/particles/layout.ts';
import { srand, setRandSource } from '../../src/game/crt.ts';
import { guarded } from '../lib/inject-guard.mjs';

/** a WebGL2 stand-in: every method answers with a truthy object (the draw pass only builds its program; nothing is rasterised here) */
const stubGl = () => new Proxy({}, { get: (_t, k) => (k === 'isEnabled' ? () => false : () => ({})) });

const __test = {
  name: 'wptime-particles-tick',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const arc = ctx.archives.find((a) => a.name === 'GENERICBITS');
    const FOV = 1;
    // a wide perspective-like view-projection (row vectors): clip = (1e-4 x, 1e-4 y, 1e-4 z - 5e-5, z): every sprite of the effect stays inside the frustum
    const viewProj = new Float32Array([0.0001, 0, 0, 0, 0, 0.0001, 0, 0, 0, 0, 0.0001, 1, 0, 0, -0.00005, 0]);
    const make = async () => {
      const world = { vars: { get: (i) => (i === 2 ? 1 : 0) }, tickCount: 0, dt: 1, frame: 100 };
      const gr = { fov: FOV, particles: null };
      const sh = { gl: { gl: stubGl(), texture: () => null }, data: { archive: async () => arc } };
      const fx = await ZoneParticles.create({ sh, gr, world, archive: arc });
      const M = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 50, 1]);
      const h = fx.start('twinkle01.par', M, [0, 0, 0], [0, 0, 0], [2, 1, 1]);
      fx.finish();
      const rend = { viewRect: { w: 640, h: 480 } };
      return { world, gr, fx, h, rend };
    };
    /** one sim step like the world's loop: tick (counters), the particle step, advanceDt */
    const step = (S, i) => { S.world.tickCount++; S.world.frame++; tickParticles(S.world); S.world.dt = i + 1 < 5 ? 1 : 0.5; };
    const draw = (S) => S.gr.particles(S.rend, viewProj);
    const frames = 90;
    const run = async (renderEvery, extra = 0) => {
      srand(7); setRandSource(null);
      const S = await make();
      S.world.dt = 1;
      const seen = [];
      for (let i = 0; i < frames; i++) {
        step(S, i);
        if ((i + 1) % renderEvery === 0) { for (let k = 0; k <= extra; k++) draw(S); const L = S.fx.engine.drawList; seen.push({ i, n: L.length, sct: L.map((p) => p.app.f[AP.SCT]), ang: L.map((p) => p.app.i[AP.ANGLE]), gen: L.map((p) => p.gen), objs: L.slice(), inc: L.map((p) => p.app.f[AP.SCTINC]), vis: S.fx.stats.visible }); }
      }
      return { S, seen };
    };
    const base = await run(1), every3 = await run(3), twice = await run(1, 1), never = await run(1000);
    ok(base.S.fx.ticks === frames && base.S.fx.engine.updates === frames, `60 Hz render: ${frames} sim steps give ${base.S.fx.ticks} / ${base.S.fx.engine.updates} engine updates`);
    ok(every3.S.fx.ticks === frames && twice.S.fx.ticks === frames && never.S.fx.ticks === frames, `render at 20 Hz / twice per step / never: the same ${frames} engine updates (${every3.S.fx.ticks} / ${twice.S.fx.ticks} / ${never.S.fx.ticks})`);
    // the engine's own state does not depend on the render rate
    const key = (S) => { const e = S.fx.engine; return `${e.drawList.length}:${e.ps.idx}:${[...e.drawList.slice(0, 4)].map((p) => [p.mov.f[0xdc / 4], p.mov.f[0xdc / 4 + 1], p.mov.f[0xdc / 4 + 2], p.app.f[AP.SIZE]].map(Math.fround).join(',')).join(';')}`; };
    ok(key(base.S) === key(every3.S) && key(base.S) === key(never.S), 'particle positions / sizes / rng index identical at every render rate');
    // the dt of every step is logged for the spin catch-up: 1.0 for the first 5 frames, then 0.5
    const e0 = base.S.fx.engine;
    ok([30, 60, 89].every((k) => e0.dtAt(k) === 0.5), 'the dt log keeps the last 64 steps (0.5)');
    { const T = await make(); for (let i = 0; i < 12; i++) step(T, i); ok([0, 1, 2, 3, 4].every((k) => T.fx.engine.dtAt(k) === 1) && [5, 6, 11].every((k) => T.fx.engine.dtAt(k) === 0.5), 'the dt log: steps 0..4 at 1.0, then 0.5'); }
    // the sprite angle: a draw after k steps owes k spin steps with the dt of each step to the sprites visible at the previous draw (a skipped step cannot be re-drawn: the sprites visible
    // at the last draw stand in for them); at 60 Hz it is exact. Expected SCT of a sprite = the float32 sequence `sct = (sctinc * dt_t) + sct` over the steps t from its first draw to the
    // step before this one, with dt_t = 1 for the first five steps, then 0.5 (FUN_0044f4c0 spins by DAT_008b1718 after each draw).
    const f32 = Math.fround;
    const dtOf = (t) => (t < 5 ? 1 : 0.5);
    let compared = 0;
    for (const [label, R, every] of [['every step', base, 1], ['every 3rd step', every3, 3]]) {
      // (a pool slot is reused: a sprite is its object AND its generation; its rate is read when it is first seen)
      const lives = new Map();
      for (const d of R.seen) d.objs.forEach((p, k) => { const m = lives.get(p) ?? lives.set(p, new Map()).get(p); if (!m.has(d.gen[k])) m.set(d.gen[k], { f: d.i, s0: d.sct[k], inc: d.inc[k] }); });
      for (const d of R.seen) d.objs.forEach((p, k) => {
        const f = lives.get(p).get(d.gen[k]);
        let e = f.s0;
        for (let t = f.f; t < d.i; t++) e = f32(f32(f.inc * dtOf(t)) + e);
        compared++;
        ok(Object.is(e, d.sct[k]), `${label}: step ${d.i} sprite ${k}: spin ${d.sct[k]} expected ${e} (first drawn at step ${f.f})`);
        ok(d.ang[k] === Math.trunc(f32(d.sct[k] + 256)) % 256 || f.f === d.i, `${label}: step ${d.i} sprite ${k}: angle ${d.ang[k]} of spin ${d.sct[k]}`);
      });
    }
    ok(compared >= 1000, `${compared} sprite states checked against the expected spin sequence`);
    const tw = twice.seen.filter((x) => x.n > 0).length;
    for (const t of twice.seen) { const b = base.seen.find((x) => x.i === t.i); if (b && t.n > 0 && b.n === t.n) ok(b.sct.join() === t.sct.join(), `step ${t.i}: a second draw in the same step changes nothing (${b.sct.slice(0, 3)} vs ${t.sct.slice(0, 3)})`); }
    notes.push(`${compared} spin states compared every step vs every 3rd step, ${tw} with two draws per step`);
    // a host that never calls the per-step hook (a test with its own loop): the draw catches up on the sim steps since the last draw, one engine update each
    {
      srand(7);
      const S = await make();
      for (let i = 0; i < 12; i++) S.world.tickCount++;
      draw(S);
      ok(S.fx.ticks === 12 && S.fx.engine.updates === 12, `fallback: a draw after 12 sim steps without the hook runs 12 updates (${S.fx.ticks})`);
      draw(S); draw(S);
      ok(S.fx.ticks === 12, 'fallback: further draws in the same step run nothing');
    }
    // destroy unregisters the step
    { const S = await make(); S.fx.destroy(S.gr); tickParticles(S.world); ok(S.fx.ticks === 0, 'destroy: the engine no longer follows the sim steps'); }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
