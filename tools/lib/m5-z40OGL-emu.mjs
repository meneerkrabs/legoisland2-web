// M5 z40OGL, the ORACLE harness: the original's Overlay node (the krystals: constructor FUN_007e31fc, update FUN_007e2c9a, the zone's sound loader FUN_007e3350) runs natively in the x86 emulation
// (src/formats/x86emu.ts, tools/lib/m7-isl-veh-emu.mjs `IslEmu`: the shared node framework FUN_0042226e / FUN_004225c5 / FUN_00423532 also native) next to the port's `KrystalNode`
// (src/zones/z40OGL/krystal.ts). Hosted: game variables, sounds (every load gets a handle of its own: the log names KST0 .. KST9 by the globals FUN_007e3350 stored them in), particle
// calls (FUN_0044e920 / FUN_0044ea00 / FUN_0044ea60 logged), records (mirror of the oracle world). Pepper is placed by the test in both worlds.
import { IslEmu, VAR_ARRAY, VAR_COUNT, RECORDS_BASE, REC, f32 } from './m7-isl-veh-emu.mjs';
import { loadHub } from './hub-load.mjs';
import { loadExe } from './engine-load.mjs';
import { FakeFx } from './fake-fx.mjs';
import '../../src/zones/index.ts';
import { KST_HANDLES } from '../../src/zones/z40OGL/common.ts';

export { RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, f32, KST_HANDLES };
/** the code of the zone (FUN_007e1b21 .. FUN_007e8800), executed natively on top of the framework's ranges */
export const OGL_RANGE = [0x7e1b21, 0x7e8800];
export const CTOR_OVERLAY = 0x7e31fc;

/** the port's hub world of a story node with the constructors' world half (`ctorInit`, src/hub/game.ts) applied and the audio / particle services of the node replaced by recorders */
export function loadOgl(ctx, opts = {}) {
  const H = loadHub(ctx, { zone: 'z40OGL', node: opts.node ?? 64, vars: opts.vars ?? {} });
  H.log = [];
  const ic = H.ictx, emu = H.emu;
  ic.soundOf = (addr) => emu.soundHandles.find((h) => h.addr === addr)?.id ?? -1;
  ic.sfx = (id) => H.log.push(`p2 #${id}`);
  ic.stopSfx = (id) => H.log.push(`s2 #${id}`);
  ic.sfxAt = (id, pos) => H.log.push(`p3 #${id} ${[...pos].map(f32)}`);
  // the exact 3D slot of a handle (the audio host's `slot('3d', id, n)`): the slot number n names the krystal
  const slots = new Map();
  const audio = {
    slot: (kind, id, n) => (kind === '3d' && id === 615 ? (slots.get(n) ?? slots.set(n, { n }).get(n)) : null),
    ga: { sfx: { play3D: (s, p) => H.log.push(`p3 KST${s.n} ${[p.x, p.y, p.z].map(f32)}`), stop: (s) => H.log.push(`s3 KST${s.n}`) } },
  };
  ic.zoneCtx = { sh: { audio } };
  const fx = new FakeFx(H.world); ic.fx = fx; H.fx = fx;
  if (opts.ctorInit !== false) for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
  return H;
}

/** the fx calls of the port as the oracle logs them: start -> `fxstart`, matrix -> `fxmove`, gate -> `fxgate var,mask,value` */
export function portFxLines(fx) {
  const out = [];
  for (const l of fx.log) {
    if (l.op === 'start') out.push('fxstart');
    else if (l.op === 'matrix') out.push('fxmove');
    else if (l.op === 'gate') out.push(`fxgate ${l.gate[0]},${l.gate[1]},${l.gate[2]}`);
  }
  return out;
}

/** A duel: the port world and the original's code on the krystals. o = { node, vars (game variables before the set-up) } */
export function makeOglDuel(ctx, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const P = loadOgl(ctx, { node: o.node ?? 64, vars: o.vars ?? {} });
  const O = loadHub(ctx, { zone: 'z40OGL', node: o.node ?? 64, vars: o.vars ?? {} });
  for (let i = 0; i < VAR_COUNT; i++) O.vars.set(i, P.world.vars.get(i));
  // the port keeps only the krystals' nodes (Pepper is placed by the test)
  const isKst = (r) => /^KST[0-9]$/.test(r.name);
  for (const r of P.world.records) if (!isKst(r)) r.ctrl = null;
  P.world.dt = o.dt ?? 1;
  P.world.externalInput = true;
  const d = { P, O, pe, t: 0, nfail: 0, checked: 0, failures: o.failures ?? [], label: o.label ?? '', maxFail: o.maxFail ?? 30 };
  const I = { world: O.world, pepper: O.pepper, vars: O.vars, profile: { island: O.emu } };
  const emu = new IslEmu(pe, I, { dt: d.dt ?? o.dt ?? 1, rng: { range: () => 0 }, parts: () => [] });
  emu.cpu.exec.push(OGL_RANGE);
  d.emu = emu;
  const mem = emu.cpu.mem;
  // (the vehicle roster of IslEmu's constructor wrote island record numbers into this zone's records: back to the set-up's state)
  O.world.records.forEach((r, i) => { emu.putRecord(i, r); mem.w32(RECORDS_BASE + i * REC + 0x64, r.variant | 0); });
  // particles of the constructor: handle numbers 0x100 + n, calls logged like the port's
  let nfx = 0;
  emu.cpu.hooks.set(0x44e920, (c) => { emu.log.push('fxstart'); c.eax = 0x100 + nfx++; });
  emu.cpu.hooks.set(0x44ea00, (c) => { emu.log.push('fxmove'); c.eax = 0; });
  emu.cpu.hooks.set(0x44ea60, (c) => { emu.log.push(`fxgate ${c.arg(1) | 0},${c.arg(2) | 0},${c.arg(3) | 0}`); c.eax = 0; });
  emu.setFocus(O.pepper.index);
  // the zone's sound loader: handles named by the globals
  emu.o.soundAddr = Object.fromEntries(KST_HANDLES.map((a, n) => [`KST${n}`, a]));
  emu.cpu.steps = 0;
  emu.loadSounds(0x7e3350);
  // the original's own attach sequence for the krystals
  for (const a of O.emu.attaches) if (a.ctor === CTOR_OVERLAY && a.hasController) emu.attach(a);
  emu.sync();
  d.olog = [...emu.log];   // the constructors' own calls (compared with the port's `ctorInit` before the first tick)
  d.fail = (msg) => { d.nfail++; if (d.failures.length < d.maxFail) d.failures.push(msg); else if (d.failures.length === d.maxFail) d.failures.push('... more failures'); };
  d.eq = (name, orig, port) => { d.checked++; if (orig !== port) d.fail(`${d.label} t${d.t} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); };
  /** Pepper at a place in both worlds */
  d.placePepper = (x, y, z) => {
    for (const r of [P.pepper, O.pepper]) { r.setEuler(0, 0, 0, x, y, z); r.rx = 0; r.ry = 0; r.rz = 0; }
    emu.putRecord(O.pepper.index, O.pepper);
    emu.sync();
  };
  /** one tick of both: the original's update + pre-render passes, the port's world tick */
  d.tick = () => {
    P.log.length = 0; P.fx.log.length = 0;
    d.olog = emu.passes(0, 0, {});
    P.world.tick();
    d.t++;
  };
  d.setVar = (i, v) => { mem.w32(VAR_ARRAY + 4 * i, v); P.world.vars.set(i, v); };
  d.var = (i) => mem.r32(VAR_ARRAY + 4 * i) | 0;
  /** the krystals' records (flags), the variables, the sound calls and the particle calls of the tick */
  d.compare = () => {
    P.world.records.forEach((r, i) => { if (isKst(r)) d.eq(`${r.name}.flags`, mem.r16(RECORDS_BASE + i * REC + 0x60), r.flags & 0xffff); });
    for (const v of [0x31, 0x25, 199, 0x58, 0x5e]) d.eq(`var 0x${v.toString(16)}`, d.var(v), P.world.vars.get(v) | 0);
    const oSnd = d.olog.filter((l) => /^(p2|s2|p3|s3) /.test(l)), pSnd = P.log.filter((l) => /^(p2|s2|p3|s3) /.test(l));
    d.checked++;
    if (oSnd.join('|') !== pSnd.join('|')) d.fail(`${d.label} t${d.t} sound calls: original ${oSnd.join(' | ')} port ${pSnd.join(' | ')}`);
    const oFx = d.olog.filter((l) => /^(fxstart|fxmove|fxgate )/.test(l)), pFx = portFxLines(P.fx);
    d.checked++;
    if (oFx.join('|') !== pFx.join('|')) d.fail(`${d.label} t${d.t} particle calls: original ${oFx.join(' | ')} port ${pFx.join(' | ')}`);
    P.world.records.forEach((r, i) => {
      if (!isKst(r)) return;
      const on = d.emu.nodeOf.get(i)?.find((n) => n.ctor === CTOR_OVERLAY)?.ptr, pn = r.ctrl?.nodes.find((n) => n.kind === 'Overlay');
      if (on && pn) d.eq(`${r.name} state`, mem.r32(on + 0x18), pn.state);
    });
  };
  return d;
}
