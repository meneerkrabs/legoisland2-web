// M5 z13CAI, the ORACLE harness: the original's node framework and the Adventure Island's nodes run natively in the x86 emulation (src/formats/x86emu.ts) next to the port.
//   native (the user's own executable, addresses only): the update / pre-render passes FUN_0042226e / FUN_004225c5, the constructors and handlers of pepswitc 0x61c2a4 (FUN_0061c0e0 ...),
//   the circling birds 0x4b4000 (FUN_004b4000 / FUN_004b3bb7), SGHeli 0x4325e8, SGVehic 0x4333c2, the flowing water 0x426f55 and the CAI sound loader FUN_0061b000;
//   hosted (not the subject): game variables, rand (a scripted MSVC LCG shared with the port), collision (the port's CollisionWorld over the oracle world), animation instances (the
//   port's AnimInstance), sounds / particles / render calls (logged). The machine state (the data pages: the helipad table, the sound handle globals, the PATH map) is the one the
//   original's own set-up FUN_0061b1f4 left in the emulation of `IslandSetup` (src/formats/emusetup.ts).
// It reuses the island's duel machinery (tools/lib/m7-isl-veh-emu.mjs: IslEmu / Duel's compare helpers) for a hub world.
import { IslEmu, Duel, B, lcg, randomKeys, RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, f32 } from './m7-isl-veh-emu.mjs';
import { loadCai } from './m5-z13CAI-load.mjs';
import { cdFillHeap } from './m8-save.mjs';
import { loadHub } from './hub-load.mjs';
import { loadExe } from './engine-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { baseParts } from '../../src/island/trigger/parts.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';

export { B, lcg, randomKeys, RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, f32 };
/** the code of the zone (FUN_0061a6bb..FUN_00627a52), executed natively on top of the island's ranges */
export const CAI_RANGE = [0x61a6bb, 0x627a52];
/** the constructors the oracle attaches natively */
export const NATIVE_CTORS = { PEPSWITC: 0x61c2a4, HELI: 0x4325e8, SEAT: 0x4333c2, GULL: 0x4b4000, FLOW: 0x426f55, PTERA_RIDE: 0x4bb582, PTERA: 0x4bb1a6, PORTAL: 0x51ea3c };

/** the C runtime's rand(): LCG 214013 / 2531011, bits 16..30 (the same stream for the port's `rand` and the original's FUN_004388ae) */
export function msvcRand(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; }; }

/**
 * A duel for the Adventure Island. o = { node, vars (game variables before the set-up), seed, dt, kinds: constructor addresses the original runs (default all of NATIVE_CTORS),
 * maxFail, failures }. The port world runs ALL its nodes; the oracle only the listed constructors, so compare only what they own.
 */
export function makeCaiDuel(ctx, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const seed = o.seed ?? 12345;
  const rngP = msvcRand(seed), rngO = msvcRand(seed);
  setAmbientRandom(() => rngP() / 32768);                      // the port's `rand(max)` = floor(r) / 32767 * max (island/ambient/common.ts), r = the LCG's value
  const P = loadCai(ctx, { node: o.node ?? 33, vars: o.vars ?? {} });
  // the oracle world: the record mirror (collision, animation instances) built the same way, without the port's own constructors of the zone
  const O = loadHub(ctx, { zone: 'z13CAI', node: o.node ?? 33, vars: o.vars ?? {} });
  // the oracle machine starts with the variables of the port's world (the framework's arrival writes PEPPER_CONTROL, the loop writes var 0xc5)
  for (let i = 0; i < VAR_COUNT; i++) O.vars.set(i, P.world.vars.get(i));
  const d = Object.create(Duel.prototype);
  d.o = o; d.dt = o.dt ?? 1; d.pe = pe; d.P = P; d.O = O;
  d.heldNow = 0; d.prevHeld = 0; d.psnd = []; d.pfx = []; d.t = 0; d.nfail = 0; d.checked = 0; d.failures = o.failures ?? []; d.worst = new Map(); d.deviations = new Map();
  const W = P.world;
  W.dt = d.dt;
  W.externalInput = true;
  const ic = P.ictx;
  const rs = ic.sfx.bind(ic), ss = ic.stopSfx.bind(ic);
  ic.sfx = (id) => { d.psnd.push(`p2 #${id}`); rs(id); };
  ic.stopSfx = (id) => { d.psnd.push(`s2 #${id}`); ss(id); };
  ic.sfxFreq = (id, hz) => { d.psnd.push(`r #${id} ${hz | 0}`); };
  ic.sfxAt = (id, pos) => { d.psnd.push(`p3 #${id} ${[...pos].map(f32)}`); };
  ic.partMode = (rec, mask, mode) => { d.psnd.push(`mode ${rec.index} ${mask} ${mode}`); };
  ic.particles = (name, mode, pos, owner) => { d.pfx.push(`${name} ${mode} ${owner}`); };
  // the oracle machine
  const I = { world: O.world, pepper: O.pepper, vars: O.vars, profile: { island: O.emu } };
  const emu = new IslEmu(pe, I, { dt: d.dt, rng: { range: (m) => (m <= 0 ? 0 : (rngO() / 32767) * m) }, parts: (idx) => baseParts(O.world, O.world.records[idx]) ?? [] });
  emu.cpu.exec.push(CAI_RANGE);
  // FUN_0043b92a(anim, 1.0): 2 when the clip is about to wrap (`(float) frames < rate * DAT_008b1718 + 1.0 + frame`), the Ptera's wing beats reset on it (hosted: the decompile's three lines, read from LE2.c)
  emu.cpu.hooks.set(0x43b92a, (c) => { const a = emu.anims.get(c.arg(0)); c.eax = a && a.frameCount < Math.fround(c.argf(1) * d.dt) + 1.0 + a.frame ? 2 : 0; });
  d.emu = emu;
  cdFillHeap(emu);   // the original is a debug build: new heap blocks are 0xCD filled (bytes a constructor never writes read 0xCD; docs/re/save.md)
  emu.setFocus(O.pepper.index);
  // the zone's sound loader (FUN_0061b000): the handle globals of this machine
  emu.cpu.steps = 0;
  emu.cpu.call(0x61b000, [], { maxSteps: 1_000_000 });
  const kinds = new Set(o.kinds ?? Object.values(NATIVE_CTORS));
  const pe0 = O.emu.attaches.find((a) => a.record === O.pepper.index);
  emu.controller(O.pepper.index, pe0?.ctrlFlags ?? 6);
  // the original's own attach sequence (FUN_00423532: the constructors run natively), in the set-up's order
  for (const a of O.emu.attaches) {
    if (!kinds.has(a.ctor) || !a.hasController) continue;
    emu.attach(a);
  }
  // DAT_009daa80: the vehicle Pepper sits in (the set-up's `local_10`), as the framework's arrival does for the port
  d.setCurrent(vehicles(W).current?.index ?? -1);
  // the initial camera, as the shell hands it over
  for (let k = 0; k < 6; k++) emu.cpu.mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
  d.rngO = rngO; d.rngP = rngP;
  return d;
}

/** the original's node block of a record for a constructor (0 when it has none) */
export const onodeOf = (d, rec, ctor) => d.emu.nodeOf.get(rec)?.find((n) => n.ctor === ctor)?.ptr ?? 0;
