// WP-VERIFY M7b: the island's rabbits (Bunny.c: ctor FUN_004b2149 RBT0-4, update FUN_004b18fb, pre-render FUN_004b1ffb, helpers FUN_004b1330 / 004b13f4 / 004b15b7 / 004b1647 / 004b1712 / 004b17eb) against the original's
// node code in the island emulation (the ambient oracle tools/lib/m7-isl-veh-ambient.mjs + m7-isl-veh-emu.mjs; the original's rand FUN_004388ae runs natively on a scripted CRT rand which the port's `rand` replays).
import { ambientDuel, CTOR, B, lcg } from './m7-isl-veh-ambient.mjs';
import { giveAnims } from './m7-isl-veh-ambient.mjs';
import { animalGlobals } from '../../src/island/ambient/animals.ts';
import { startIslandNpcs } from '../../src/island/npc/index.ts';

export const BUNNY = 0x4b2149;
export { B, lcg };
/** the node block of the original (FUN_004b2149): offset -> port field */
export const BUNNY_NODE = { range: [0x20, 'f'], range2: [0x24, 'f'], quarter2: [0x28, 'f'], reach: [0x2c, 'f'], speed: [0x30, 'f'], state: [0x34, 'i'], saved: [0x38, 'i'], count: [0x3c, 'i'], off: [0x40, 'i'], burrow: [0x44, 'i'], bored: [0x48, 'i'] };

/** a bunny session: oracle + port, the constructors' world work taken from the original (see `initPort`) */
export function bunnyDuel(ctx, o) {
  const d = ambientDuel(ctx, { keepCtorDraws: true, exact: true, beforeAttach: (emu, duel) => giveAnims(duel, 'RBBT', /^RBT\d$/), node: o.node ?? 2, dt: o.dt, seed: o.seed, kinds: ['Bunny'], ctors: new Set([BUNNY]), keepRecords: (n) => /^RBT\d$/.test(n), maxFail: o.maxFail, failures: o.failures, draw: false });
  // the shared script returns a constant 0.5 once the original's draws of the tick are used up (the port drew more): the bunny's `do s = rand(4) while (s == state)` loops would spin forever on it; keep the over-draw counted but varied
  const rnd = lcg(99), pd = d.script.portDraw.bind(d.script);
  d.script.portDraw = () => { const before = d.script.over, v = pd(); return d.script.over > before ? rnd() : v; };
  startIslandNpcs(d.P.world);      // the port's constructors' world work (Bunny.c FUN_004b2149), in the original's attach order: consumes the draws the oracle's constructors made
  const W = d.P.world, mem = d.emu.cpu.mem;
  d.bunnies = W.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'Bunny')).map((r) => r.index);
  d.hidden = new Set();
  d.P.ictx.inFrustum = (r) => !d.hidden.has(r.index);
  return d;
}

/** the node fields + records of the bunnies, vars, sounds, draws: compared after a tick */
export function compareBunnies(d, cover) {
  const W = d.P.world, mem = d.emu.cpu.mem;
  for (const i of d.bunnies) d.rec(i, 0xfffe);
  d.vars(); d.sounds();
  const s = d.script.settle(); d.eq('rand draws left (original)', 0, s.left); d.eq('rand draws over (port)', 0, s.over);
  for (const i of d.bunnies) {
    const n = W.records[i].name, pn = d.pnode(i, 'Bunny'), a = d.onode(i, BUNNY);
    for (const [f, [off, ty]] of Object.entries(BUNNY_NODE)) { if (ty === 'f') d.cmp(`${n}.${f}`, mem.f32(a + off), pn[f]); else d.eq(`${n}.${f}`, mem.r32(a + off) | 0, pn[f]); }
    for (let k = 0; k < 3; k++) d.cmp(`${n}.home`, mem.f32(a + 0x14 + 4 * k), pn.home[k], 0, `[${k}]`);
    const oa = d.O.world.records[i].anim, pa = W.records[i].anim;
    if (pa && oa) { d.eq(n + ' clip', oa.clip, pa.clip); d.cmp(n + ' frame', oa.frame, pa.frame); }
    cover.states[pn.state] = (cover.states[pn.state] ?? 0) + 1;
  }
  // the burrow table (the constructors' terrain queries: FUN_0043cd62(burrow, 40.0) once, y set to 0 first)
  const g = animalGlobals(W);
  if (g.burrows) for (let b = 0; b < 3; b++) for (let k = 0; k < 3; k++) d.cmp(`burrow ${b}[${k}]`, mem.f32(0x8d9208 + b * 12 + 4 * k), g.burrows[b][k]);
}
