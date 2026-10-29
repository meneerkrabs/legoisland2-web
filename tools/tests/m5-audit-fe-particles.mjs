// WP-SHELL, front end z60FRE, the particle emitters (gaps.md R11): the train's smoke and the Brickster's emitter against the ORIGINAL particle engine (tools/lib/particle-oracle.mjs: the engine
// code runs in the x86 interpreter next to the port's ParticleEngine, every frame the draw list, the emitter blocks, the matrices and the random index are compared), started with the
// arguments the node constructors pass (FUN_00472c45: gate (2, 1, 1), pos (10, 12, 0), rot (-pi/2, 0, 0), the record's live matrix; FUN_00472fd8: gate (1, 1, 1), pos (0, -5, 0), the
// matrix of the dead stack local). The calls the port's nodes make are compared with the original's in m5-audit-fe-emu.
//  * train: the record matrix of FUN_00472adb (scale 0.4, turned 0.5236 about x, x = 64 waiting, 180 ticks riding from x = -64 to 64) for 1100 frames
//  * Brickster: the emitter's gate stays (1, 1, 1): for 1500 frames, with the parent matrix a different junk slot per scenario (zeros, identity, a pose, random bit patterns including
//    NaN / infinities / denormals, a matrix that changes every frame), neither engine ever holds a particle: what the engine reads from the dead stack slot never shows
import { runScenario } from '../lib/particle-oracle.mjs';
import { buildMatrix } from '../../src/formats/matrix.ts';

const f32 = Math.fround;
const fh = (bits) => new Float32Array(new Uint32Array([bits]).buffer)[0];
const POS_TRAIN = [fh(0x41200000), fh(0x41400000), 0], POS_BRICK = [0, fh(0xc0a00000), 0], ROT = [fh(0xbfc90fdb), 0, 0];

class Lcg { constructor(s) { this.s = s >>> 0; } u32() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s; } }

export default {
  name: 'm5-audit-fe-particles',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const archive = ctx.archives.find((a) => a.name === 'z60FRE');
    const run = (label, effect, sc, seed) => {
      const r = runScenario(ctx, archive, effect, sc, seed);
      checked += r.checked;
      for (const f of r.failures) failures.push(`${label}: ${f}`);
      return r;
    };

    // ---- the train: FUN_00472c45 / FUN_00472adb
    for (const seed of [7, 11]) {
      const M0 = buildMatrix(fh(0x3f060a63), 0, 0, 64, fh(0x4209999a), -4, fh(0x3ecccccd), fh(0x3ecccccd), fh(0x3ecccccd));
      let live = 0, maxLive = 0;
      globalThis.__pdump = (f, _emu, _list, n) => { live += n > 0 ? 1 : 0; maxLive = Math.max(maxLive, n); };
      const r = run(`train seed ${seed}`, 'trainsmoke01.par', {
        frames: 1100, pos: POS_TRAIN, rot: ROT, gate: [2, 1, 1], matrixAt: 1,
        init: (M) => M.set(M0),
        move: (f, M) => {
          // the node: 300 ticks at x = 64 (phase 0), then 180 ticks with x = (8 - cnt * 16 / 180) * 8 (cnt counts 180 .. 1), then 750 ticks waiting at the last x
          if (f === 1) M.set(M0);
          if (f > 300 && f <= 480) M[12] = f32((8 - ((480 - f + 1) * 16) / 180) * 8);
        },
      }, seed);
      globalThis.__pdump = undefined;
      if (seed === 7) notes.push(`train: ${r.checked} comparisons, particles alive in ${live} of 1100 frames (max ${maxLive})`);
      checked++; if (live === 0) failures.push(`train seed ${seed}: the smoke never showed a particle (the scenario proves nothing)`);
    }

    // ---- the Brickster: FUN_00472fd8 / FUN_00472d7d
    const junk = (kind, rng) => (f, M) => {
      if (kind === 'zero') M.fill(0);
      else if (kind === 'identity') M.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      else if (kind === 'pose') M.set(buildMatrix(0, fh(0x3e860a63), 0, fh(0xc0accccd), 8, fh(0x424ccccd)));
      else if (kind === 'bits') { for (let i = 0; i < 16; i++) { const u = new Uint32Array([rng.u32()]); M[i] = new Float32Array(u.buffer)[0]; } }
      else if (kind === 'moving') M.set(buildMatrix(f * 0.01, 0, f * 0.02, f, 8 + Math.sin(f), -f));
    };
    let anyParticle = 0, frames = 0;
    for (const kind of ['zero', 'identity', 'pose', 'bits', 'moving']) {
      const rng = new Lcg(0x1234 + kind.length);
      globalThis.__pdump = (f, _emu, _list, n, eng) => { frames++; anyParticle += n + eng.drawList.length; };
      run(`Brickster (${kind})`, 'trainsmoke01.par', { frames: 1500, pos: POS_BRICK, rot: ROT, gate: [1, 1, 1], matrixAt: 1, move: junk(kind, rng) }, 3);
      globalThis.__pdump = undefined;
    }
    checked++;
    if (anyParticle !== 0) failures.push(`Brickster: ${anyParticle} particles listed with the gate off (original + port)`);
    notes.push(`Brickster: 5 junk matrices x 1500 frames (${frames} frames compared with the original), 0 particles in either engine`);
    return { checked, failures, notes };
  },
};
