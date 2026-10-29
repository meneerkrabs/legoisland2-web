// M5 z07CSI, the ORACLE harness: the original's node framework and the castle's nodes run natively in the x86 emulation (src/formats/x86emu.ts) next to the port, like
// tools/lib/m5-z13CAI-emu.mjs does for the Adventure Island.
//   native (the user's own executable, addresses only): the update / pre-render passes FUN_0042226e / FUN_004225c5, the constructors and handlers of the goblets 0x5766fb, the rats
//   0x5763ca, CSIFSM 0x575b44 and Control 0x57a579 (FUN_00579a10 / FUN_00579ebe ...) and the castle's sound loader FUN_00572ef0;
//   hosted (not the subject): game variables, rand (a scripted MSVC LCG shared with the port), collision (the port's CollisionWorld over the oracle world), animation instances (the
//   port's AnimInstance), sounds / particles / render calls (logged). The machine state (data pages: sound handle globals, the PATH map, the roster) is the one the original's own
//   set-up FUN_00573527 left in the emulation of `IslandSetup` (src/formats/emusetup.ts).
// It reuses the island's duel machinery (tools/lib/m7-isl-veh-emu.mjs: IslEmu / Duel's compare helpers) for a hub world.
import { IslEmu, Duel, B, lcg, randomKeys, RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, f32 } from './m7-isl-veh-emu.mjs';
import { loadCsi } from './m5-z07CSI-load.mjs';
import { loadHub } from './hub-load.mjs';
import { loadExe } from './engine-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { baseParts } from '../../src/island/trigger/parts.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';

export { B, lcg, randomKeys, RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, f32, loadCsi };
/** the code of the zone (FUN_00571f80 .. FUN_005b7b68), executed natively on top of the island's ranges */
export const CSI_RANGE = [0x571f80, 0x5b7b68];
/** the constructors the oracle can attach natively */
export const NATIVE_CTORS = { GOBLET: 0x5766fb, RAT: 0x5763ca, CSIFSM: 0x575b44, CONTROL: 0x57a579, SGBOAT: 0x430e6c, HORSE: 0x579178, RIDER: 0x579725, SADDLE: 0x579948 };

/** the C runtime's rand(): LCG 214013 / 2531011, bits 16..30 (the same stream for the port's `rand` and the original's FUN_004388ae) */
export function msvcRand(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; }; }

/**
 * A duel for the castle. o = { node, vars (game variables before the set-up), seed, dt, kinds: constructor addresses the original runs (default: goblet + rat + CSIFSM),
 * maxFail, failures, chain: attach Pepper's own chain natively too }. The port world runs ALL its nodes; the oracle only the listed constructors, so compare only what they own.
 */
export function makeCsiDuel(ctx, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const seed = o.seed ?? 12345;
  const cntRng = { p: 0, o: 0 };                               // calls of each side's `rand()` (a test checks both consume the same numbers)
  let rp0 = msvcRand(seed), ro0 = msvcRand(seed);
  const rngP = () => { cntRng.p++; const v = rp0(); cntRng.pl?.push(v); return v; }, rngO = () => { cntRng.o++; const v = ro0(); cntRng.ol?.push(v); return v; };   // (`pl` / `ol`: a test may keep the values drawn)
  setAmbientRandom(() => rngP() / 32768);                      // the port's `rand(max)` = floor(r) / 32767 * max (island/ambient/common.ts), r = the LCG's value
  const P = loadCsi(ctx, { node: o.node ?? 15, vars: o.vars ?? { 0xa3: 7 } });
  // the oracle world: the record mirror (collision, animation instances) built the same way, without the port's own constructors of the zone
  const O = loadHub(ctx, { zone: 'z07CSI', node: o.node ?? 15, vars: o.vars ?? { 0xa3: 7 } });
  for (let i = 0; i < VAR_COUNT; i++) O.vars.set(i, P.world.vars.get(i));
  const d = Object.create(Duel.prototype);
  d.o = o; d.dt = o.dt ?? 1; d.pe = pe; d.P = P; d.O = O;
  d.heldNow = 0; d.prevHeld = 0; d.psnd = []; d.pfx = []; d.t = 0; d.nfail = 0; d.checked = 0; d.failures = o.failures ?? []; d.worst = new Map(); d.deviations = new Map();
  const W = P.world;
  // the port world runs only the nodes under test (the oracle machine has only those attached): `keepKinds` = the port's node kinds, Pepper's chain is dropped unless `pepperKinds` keeps some
  if (o.keepKinds) {
    for (const r of W.records) {
      if (!r.ctrl) continue;
      const keep = r === P.pepper ? (o.pepperKinds ?? []) : o.keepKinds;
      r.ctrl.nodes = r.ctrl.nodes.filter((n) => keep.includes(n.kind));
      r.ctrl.exclusive = null;
      if (!r.ctrl.nodes.length && r !== P.pepper) r.ctrl = null;
    }
  }
  W.dt = d.dt;
  W.externalInput = true;
  const ic = P.ictx;
  const rs = ic.sfx.bind(ic), ss = ic.stopSfx.bind(ic);
  ic.sfx = (id) => { d.psnd.push(`p2 #${id}`); rs(id); };
  ic.stopSfx = (id) => { d.psnd.push(`s2 #${id}`); ss(id); };
  ic.sfxFreq = (id, hz) => { d.psnd.push(`r #${id} ${hz | 0}`); };
  ic.sfxAt = (id, pos) => { d.psnd.push(`p3 #${id} ${[...pos].map(f32)}`); };
  ic.partMode = (rec, mask, mode) => { d.psnd.push(`mode ${rec.index} ${mask} ${mode}`); };
  // the port's emitter calls in the machine's log vocabulary (`fxg name@record var,mask,value`, `fxm name@record`, `fxp name@record kind`): the FakeFx records them
  const fx = P.fx, fxOwners = new Map();   // the owner is the record the emitter was CREATED on (the machine logs `name@creation owner`; a later FUN_0044ea00 move does not change the name)
  const fxOwner = (h) => fxOwners.get(h) ?? -1;
  const st0 = fx.start.bind(fx);
  fx.start = (name, matrix, pos, rot, gate) => { const h = st0(name, matrix, pos, rot, gate); const f = typeof matrix === 'function' ? matrix() : matrix; fxOwners.set(h, f ? W.records.findIndex((r) => r.m === f) : -1); return h; };
  const fxn = (h) => { const e = fx.emitters.get(h); return e ? `${e.name}@${fxOwner(h)}` : `?${h}`; };
  const sg = fx.setGate.bind(fx), sm = fx.setMatrix.bind(fx), sp = fx.setParam.bind(fx);
  fx.setGate = (h, g) => { d.psnd.push(`fxg ${fxn(h)} ${g[0]},${g[1]},${g[2]}`); sg(h, g); };
  fx.setMatrix = (h, m) => { d.psnd.push(`fxm ${fxn(h)}`); sm(h, m); };
  fx.setParam = (h, t, v) => { d.psnd.push(`fxp ${fxn(h)} ${t}`); sp(h, t, v); };
  ic.musicGroove = (lvl) => { d.psnd.push(`groove ${lvl}`); };
  // the oracle machine
  const I = { world: O.world, pepper: O.pepper, vars: O.vars, profile: { island: O.emu } };
  const emu = new IslEmu(pe, I, { dt: d.dt, rng: { range: (m) => (m <= 0 ? 0 : (rngO() / 32767) * m) }, parts: (idx) => baseParts(O.world, O.world.records[idx]) ?? [] });
  emu.cpu.exec.push(CSI_RANGE);
  for (const r of o.extraExec ?? []) emu.cpu.exec.push(r);        // more native code (the horse test: the waypoint walker 0x461000 .. 0x466800 for the constructor)
  // FUN_00443310(level): the music groove (the argument's low byte, a signed byte)
  emu.cpu.hooks.set(0x443310, (c) => { emu.log.push(`groove ${(c.arg(0) << 24) >> 24}`); c.eax = 0; });
  // FUN_004388ae(max) runs NATIVELY (`fild rand(); fdiv 32767.0f; fmul max` in the 24-bit x87 mode); only the C runtime's rand() (FUN_0085daf0) is the scripted LCG (shared with the port's `rand`)
  emu.cpu.exec.push([0x4388ae, 0x4388e7]);
  emu.cpu.hooks.delete(0x4388ae);
  emu.cpu.hooks.set(0x85daf0, (c) => { c.eax = rngO(); });
  d.emu = emu;
  emu.setFocus(O.pepper.index);
  // the zone's sound loader (FUN_00572ef0): the handle globals of this machine
  emu.cpu.steps = 0;
  emu.cpu.call(0x572ef0, [], { maxSteps: 1_000_000 });
  o.beforeAttach?.(d);                                       // a test may make the oracle's records equal to the port's before the original's constructors run (the horse test)
  const kinds = new Set(o.kinds ?? [NATIVE_CTORS.GOBLET, NATIVE_CTORS.RAT, NATIVE_CTORS.CSIFSM]);
  const pe0 = O.emu.attaches.find((a) => a.record === O.pepper.index);
  emu.controller(O.pepper.index, pe0?.ctrlFlags ?? 6);
  // the original's own attach sequence (FUN_00423532: the constructors run natively), in the set-up's order
  for (const a of O.emu.attaches) {
    if (!kinds.has(a.ctor) || !a.hasController) continue;
    if (o.chain && a.record === O.pepper.index) continue;       // Pepper's own chain is built below in the original's order (Control, the walk stub, then the others: the horse's rider @5)
    emu.attach(a);
  }
  // Pepper's chain: Control (natively, first) and the walk node's one effect on the vehicles (FUN_0042d514 writes DAT_008ae330 = 576 = 24^2 every tick it runs: PEPPER_CONTROL & 1; the port's
  // Control sets it itself, see src/zones/z07CSI/control.ts)
  if (o.chain) {
    const pi = O.pepper.index;
    for (const a of O.emu.attaches) if (a.record === pi && a.ctor === NATIVE_CTORS.CONTROL) emu.attach(a);
    emu.stub(pi, { var: 0x5e, mask: 1, value: 1 }, (c) => { emu.cpu.mem.w32(0x8ae330, 0x44100000); c.eax = 1; });
    for (const a of O.emu.attaches) if (a.record === pi && a.ctor !== NATIVE_CTORS.CONTROL && kinds.has(a.ctor) && a.hasController) emu.attach(a);   // the rest of the chain after the stub (the horse's rider @5)
  }
  if (o.chain) {
    // the real order: the Control constructor (it hides the hidden-list records) runs at the attach in the MIDDLE of the set-up; the set-up code then shows some of them again (HORS, the saddles of the stage).
    // Here the constructor ran after the whole set-up: show again what the set-up's later flag writes show (`EmuAttach.storeIndex`, the same rule as applyCsiSetup in src/zones/z07CSI/index.ts)
    const ctl = O.emu.attaches.find((a) => a.record === O.pepper.index && a.ctor === NATIVE_CTORS.CONTROL);
    if (ctl) for (let va = 0x903230; (O.emu.mem.u32(va) | 0) !== -1; va += 4) {
      const i = O.emu.mem.u32(va) | 0;
      const last = O.emu.stores.slice(ctl.storeIndex).filter((q) => q.record === i && q.field === 0x60).pop();
      if (last && (last.value & 2)) emu.cpu.mem.w16(RECORDS_BASE + i * REC + 0x60, emu.cpu.mem.r16(RECORDS_BASE + i * REC + 0x60) | 2);
    }
  }
  d.setCurrent(vehicles(W).current?.index ?? -1);
  for (let k = 0; k < 6; k++) emu.cpu.mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
  d.rngO = rngO; d.rngP = rngP; d.rngCount = cntRng;
  /** both sides' random streams start again from `s` (the port's own set-up drew numbers the oracle's machine did not: the rats' constructors) */
  d.reseed = (s) => { rp0 = msvcRand(s); ro0 = msvcRand(s); cntRng.p = 0; cntRng.o = 0; };
  // the sound / emitter / music calls of a tick: the original's log against the port's (3D stops (s3) and 2D stops (s2) are one kind here: the port has one stop call)
  d.sounds = function () {
    const norm = (l) => l.replace(/^s3 /, 's2 ').replace(/(cedric\.par)@\S+/, '$1@node');
    const keep = (l) => /^(p2|s2|s3|r|p3|fxg|fxm|fxp|groove) /.test(l);
    const o = d.olog.filter(keep).map(norm), p = d.psnd.filter(keep).map(norm);
    d.checked++;
    if (o.length !== p.length) { d.fail(`${d.label} t${d.t} sound calls: original ${o.join(' | ')} port ${p.join(' | ')}`); return; }
    for (let i = 0; i < o.length; i++) {
      const m = /^(p3 #\d+) (\S+)$/.exec(o[i]), n = /^(p3 #\d+) (\S+)$/.exec(p[i]);
      if (m && n) { if (m[1] !== n[1]) d.fail(`${d.label} t${d.t} sound call ${i}: original ${o[i]} port ${p[i]}`); else { const a = m[2].split(',').map(Number), b = n[2].split(',').map(Number); for (let k = 0; k < 3; k++) d.cmp(m[1], a[k], b[k], 1e-6, `[${k}]`, 1e-4); } continue; }
      if (o[i] !== p[i]) d.fail(`${d.label} t${d.t} sound call ${i}: original ${o[i]} port ${p[i]}`);
    }
  };
  return d;
}

/** the original's node block of a record for a constructor (0 when it has none) */
export const onodeOf = (d, rec, ctor) => d.emu.nodeOf.get(rec)?.find((n) => n.ctor === ctor)?.ptr ?? 0;
