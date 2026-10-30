// The particle system (src/fx/particles): the port against the ORIGINAL engine code (FX_Particle.c, LE2.EXE 0x44e860..0x458b00) run in the x86 interpreter.
//  1. exact numbers: particle counts / first particle / RNG index of five effects after N ticks, read from the original at control word 0x7f (24-bit x87, as the game runs; seed 7, dt 1, matrix [3 2 -5])
//  2. loaders: every .app / .emi / .mov / .par record of three archives byte for byte (+ the max particle counts, [EMITS] blocks)
//  3. scenarios (original vs port every frame: all draw list particles, emitter blocks, matrices, RNG index): move, dt 0.5 .. 1.3, gates, parameter overrides, stop,
//     floor / PCOL collision, pause, distance LOD; swirls; the draw functions (quad, clip, sort)
// PARTICLES_FULL=1 runs every scenario of every effect (several minutes: /tmp scripts of WP-PART: tools/lib/particle-oracle.mjs `runScenario`).
import { ParticleEngine } from '../../src/fx/particles/engine.ts';
import { msvcRand } from '../../src/fx/particles/core.ts';
import { ParticleDefs } from '../../src/fx/particles/defs.ts';
import { archiveParticleFiles } from '../../src/fx/particles/files.ts';
import { ParticleEmu, G } from '../lib/particle-emu.mjs';
import { runScenario } from '../lib/particle-oracle.mjs';
import { runDrawOracle } from '../lib/particle-draw-oracle.mjs';

const GOLD = [
  ['z02LGI', 'trainsmoke01.par', 40, 5, 1818, ['40156568', '413323be', 'c0a80000'], '40300000', '40e00000'],
  ['z02LGI', 'explode01.par', 6, 50, 2631, ['4042271f', '408e9482', 'c0a33ed4'], '3e4ccccd', '41900000'],
  ['z02LGI', 'twinkle01.par', 30, 30, 2674, ['3fd50a9a', '40c00f7c', 'c0e0c52e'], '3eb3bea2', '41940000'],
  ['z02LGI', 'rocket01.par', 40, 29, 1080, ['405d9849', '40720af4', 'c0a80000'], '3f0d7681', '408a7c95'],
  ['z05WAB', 'bolts01.par', 20, 10, 1751, ['40506c72', 'c0ad3448', 'c05908f7'], '3dcccccd', '42200000'],
];
const SC = {
  move: { frames: 60, move: (f, M) => { M[12] = 3 + f * 0.37; M[13] = 2 + Math.sin(f * 0.2) * 1.5; M[14] = -5 + f * 0.11; } },
  dt: { frames: 50, dt: (f) => 0.5 + (f % 5) * 0.31, move: (f, M) => { M[12] = 3 + f * 0.2; } },
  gate: { frames: 100, gates: [{ frame: 20, var: 1, mask: 1, value: 1 }, { frame: 50, var: 2, mask: 1, value: 1 }, { frame: 80, var: 1, mask: 0, value: 1 }] },
  param: { frames: 70, params: [{ frame: 10, type: 8, value: 3.5 }, { frame: 30, type: 0, value: 0.5 }, { frame: 40, type: 2, value: 0.2 }, { frame: 50, type: 4, value: 0.9 }] },
  stop: { frames: 90, stop: 30 },
  floor: { frames: 80, coll: 'floor', pos: [0, 1.0, 0], rot: [0, 0, 0] },
  pcol: { frames: 50, coll: 'pcol', pos: [0, 1.0, 0], rot: [0, 0, 0] },
  pause: { frames: 60, pause: new Set([20, 21, 22, 23, 24, 25]) },
  lod: { frames: 60, lod: { cam: [3, 2, 150] } },
};
const SUBSET = [['z02LGI', ['trainsmoke01.par', 'rocket01.par', 'explode01.par', 'music01.par'], Object.keys(SC)], ['z05WAB', ['bolts01.par'], ['move', 'gate', 'floor']], ['z08BKD', ['bubble01.par'], ['pcol', 'floor']], ['z10RGB', ['impact01.par'], ['floor', 'move']]];
const SWIRL = [['z02LGI', 'swirl01.swl'], ['z05WAB', 'wabswirl.swl']];

function makeLoaderEmu(ctx, files) {
  const emu = new ParticleEmu(ctx, files);
  emu.loadDir();
  return emu;
}

export default {
  name: 'particles-oracle',
  run(ctx) {
    const failures = []; const notes = [];
    let checked = 0;
    const arch = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    const full = !!process.env.PARTICLES_FULL;
    // 1. exact numbers
    for (const [an, name, frames, n, idx, pos, size, life] of GOLD) {
      const a = arch(an); if (!a) continue;
      const vars = { 1: 0, 2: 1 };
      const eng = new ParticleEngine(archiveParticleFiles(a), { rand: msvcRand(7), getVar: (i) => vars[i] ?? 0 });
      const M = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, -5, 1]);
      eng.start(name, M, [0.5, 1.5, -0.25], [-1.5707964, 0.3, 0.1], 2, 1, 1);
      eng.finishSetup();
      for (let f = 1; f <= frames; f++) eng.update(1.0, 1000 + f);
      const p = eng.drawList[0];
      const hex = (x) => new Uint32Array(new Float32Array([x]).buffer)[0].toString(16);
      const got = { n: eng.drawList.length, idx: eng.ps.idx, pos: [0, 1, 2].map((k) => hex(p.mov.f[0xdc / 4 + k])), size: hex(p.app.f[0xa4 / 4]), life: hex(p.rec.f[0x2f4 / 4]) };
      checked++;
      const want = { n, idx, pos, size, life };
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${an} ${name} after ${frames} ticks: ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
    }
    // 2. loaders
    for (const an of ['GENERICBITS', 'z02LGI', 'z10RGB']) {
      const a = arch(an); if (!a) continue;
      const files = archiveParticleFiles(a);
      const mine = new ParticleDefs(files);
      const emu = makeLoaderEmu(ctx, files);
      const chk = (what, got, exp) => { checked++; if (got.length !== exp.length || got.some((v, i) => v !== exp[i])) failures.push(`${an} ${what}`); };
      const cnt = [emu.u32(G.nApp), emu.u32(G.nEmi), emu.u32(G.nMov), emu.u32(G.nPar), emu.u32(G.nSwl)];
      chk('record counts', cnt, [mine.apps.length, mine.emis.length, mine.movs.length, mine.pars.length, mine.swirls.length]);
      const cmp = (base, stride, list, kind) => list.forEach((r, i) => chk(`${kind}[${i}] ${r.name}`, Array.from(emu.bytes(emu.u32(base) + i * stride, stride)), Array.from(r.rec.u8)));
      cmp(G.apps, 0xe8, mine.apps, 'app'); cmp(G.emis, 0xb4, mine.emis, 'emi'); cmp(G.movs, 0x144, mine.movs, 'mov');
      const pb = emu.u32(G.pars);
      mine.pars.forEach((d, i) => {
        const f = (o) => emu.mem.r32(pb + i * 0x78 + o);
        chk(`par ${d.name} counts`, [f(0x68), f(0x6c), f(0x70), f(0x74)], [d.maxParticles, d.nEmits, d.nSplash, d.subMax]);
        d.emits.forEach((b, k) => chk(`par ${d.name} emits[${k}]`, Array.from(emu.bytes(f(0x60) + k * 0x350, 0x350)), Array.from(b.u8)));
      });
    }
    // 3. scenarios
    const list = full ? ctx.archives.filter((a) => a.entries.some((e) => /^particle\/.*\.par$/i.test(e.path))).map((a) => [a.name, new ParticleDefs(archiveParticleFiles(a)).pars.map((p) => p.name), Object.keys(SC)]) : SUBSET;
    for (const [an, names, scs] of list) {
      const a = arch(an); if (!a) continue;
      for (const name of names) for (const k of scs) {
        let r;
        try { r = runScenario(ctx, a, name, SC[k]); } catch (e) { r = { checked: 0, failures: [`${an} ${name} [${k}]: ${String(e.message).slice(0, 160)}`] }; }
        checked += r.checked;
        // splash01 + a floor: the original dereferences a NULL parent matrix (the port throws the same way), both sides fault
        const known = /splash01/.test(name) && k === 'floor';
        for (const m of r.failures) if (!known) failures.push(`[${k}] ${m}`);
      }
    }
    for (const [an, name] of SWIRL) {
      const a = arch(an); if (!a) continue;
      for (const sc of [{ frames: 40, swirl: true }, { frames: 40, swirl: true, matrixAt: 5, move: (f, M) => { M[12] = 3 + f * 0.5; } }, { frames: 30, swirl: true, pause: new Set([10, 11, 12]) }]) {
        const r = runScenario(ctx, a, name, sc);
        checked += r.checked; for (const m of r.failures) failures.push(`swirl ${m}`);
      }
    }
    // 4. the draw functions
    { const a = arch('GENERICBITS'); if (a) { const r = runDrawOracle(ctx, archiveParticleFiles(a), full ? 400 : 60); checked += r.checked; failures.push(...r.failures); } }
    notes.push(full ? 'full matrix' : 'subset (PARTICLES_FULL=1 for every effect x scenario)');
    return { checked, failures, notes };
  },
};
