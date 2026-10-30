// WP-SAVE oracle helpers: the original's node serializers (vtable +0x14, loader +0x10) run natively in the x86 emulation next to the port's `saveBlock` / `loadBlock`
// (src/game/controller.ts). The emulator side is an `IslEmu` / `ZoneEmu`-style object (`emu.cpu`, `emu.nodeOf`, `emu.recPtr`, `emu.alloc`), see tools/lib/m7-isl-veh-emu.mjs.
// The writer protocol of FUN_00418ec7 (LE2.c line 11400): saver(node, &cell) with cell = 0: returns the size and leaves a pointer to the bytes in the cell; a size of -1 means "write
// into the file buffer": the saver is then called again with the cell pointing at the destination and returns the size.
export const RECORDS_BASE = 0x10000000, REC = 0x68;

/** the nodes of the record in the order of the controller's list (controller +0 = head, node +0x10 = next): [{ ptr, vt, loader, saver, state }] */
export function nativeNodes(emu, recIndex) {
  const mem = emu.cpu.mem, rp = RECORDS_BASE + recIndex * REC, ctrl = mem.r32(rp + 0x5c);
  const out = [];
  if (!ctrl) return out;
  for (let p = mem.r32(ctrl); p; p = mem.r32(p + 0x10)) {
    const vt = mem.r32(p + 4);
    out.push({ ptr: p, vt, loader: mem.r32(vt + 0x10), saver: mem.r32(vt + 0x14), state: mem.r32(p + 8), ctor: emu.nodeOf?.get(recIndex)?.find((n) => n.ptr === p)?.ctor ?? 0 });
  }
  return out;
}

/** the original's save block of a node: null = the vtable has no saver, else the bytes */
export function origBlock(emu, node) {
  if (!node.saver) return null;
  const cpu = emu.cpu, mem = cpu.mem;
  const cell = emu.alloc(8);
  mem.w32(cell, 0);
  cpu.steps = 0;
  let size = cpu.call(node.saver, [node.ptr, cell], { maxSteps: 5_000_000 }) | 0;
  if (size === -1) {
    const buf = emu.alloc(0x20000);
    mem.w32(cell, buf);
    cpu.steps = 0;
    size = cpu.call(node.saver, [node.ptr, cell], { maxSteps: 5_000_000 }) | 0;
    return mem.read(buf, size);
  }
  return mem.read(mem.r32(cell), size);
}

/** the original's loader on a node (FUN_00419e82: `loader(node, bytes)`); the bytes are copied into the emulator's heap first */
export function origLoad(emu, node, bytes) {
  if (!node.loader) return false;
  const cpu = emu.cpu, mem = cpu.mem;
  const buf = emu.alloc(bytes.length + 16);
  mem.write(buf, bytes);
  cpu.steps = 0;
  cpu.call(node.loader, [node.ptr, buf], { maxSteps: 5_000_000 });
  return true;
}

/**
 * The original is a debug build: FUN_00433d38 -> FUN_00858d30 = __nh_malloc_dbg fills every new block with 0xCD, so a byte a constructor never writes is 0xCD in a real save (the ports keep
 * 0xCD in such fields). The emulator's allocators are bump allocators over zeroed pages: fill the part of the heap that is still unused.
 */
export function cdFillHeap(emu, n = 0x800000) { emu.cpu.mem.write(emu.brk, new Uint8Array(n).fill(0xcd)); }

/**
 * Animation instances for the oracle machine (`o.animTokens` of the builders): FUN_0043b4e2 (create an instance for a rig) returns a fresh 0x24 byte block whose +0xc / +0x10 hold the clip and the frame,
 * FUN_0043b6a3 (start) / FUN_0043b72b / FUN_0043b73f (clip / frame accessors, what the save writer reads) work on that memory. Instances of the machine's own mirror (Pepper's) keep the port's AnimInstance.
 * With them the original's constructors leave their `record + 8` pointers behind, so the writer's object-record section is the original's own.
 */
export function installAnimTokens(emu) {
  const H = emu.cpu.hooks, mem = emu.cpu.mem, toks = new Set();
  const wrap = (a, f) => { const o = H.get(a); H.set(a, (c) => (toks.has(c.arg(0) >>> 0) ? f(c) : o ? o(c) : (c.eax = 0))); };
  H.set(0x43b4e2, (c) => { const t = emu.alloc(0x24); toks.add(t); mem.w32(t + 4, c.arg(1)); mem.w32(t + 0xc, 0); mem.wf32(t + 0x10, 0); c.eax = t; });
  wrap(0x43b6a3, (c) => { mem.w32(c.arg(0) + 0xc, c.arg(1)); mem.wf32(c.arg(0) + 0x10, c.argf(2)); c.eax = 1; });
  wrap(0x43b72b, (c) => { c.eax = mem.r32(c.arg(0) + 0xc); });
  wrap(0x43b73f, (c) => { c.fpush(mem.f32(c.arg(0) + 0x10)); });
  emu.animToks = toks;
  return toks;
}

/** the animation instances the zone's LOADER gives records (`loaderRigs`: { record, clip }, from the emulated set-up with `spec.loaderRigs`): tokens in `record + 8`, before the constructors run */
export function putLoaderInstances(emu, loaderRigs) {
  const mem = emu.cpu.mem;
  for (const r of loaderRigs) {
    const t = emu.alloc(0x24);
    emu.animToks.add(t);
    mem.w32(t + 0xc, Math.max(r.clip, 0)); mem.wf32(t + 0x10, 0);
    mem.w32(RECORDS_BASE + r.record * REC + 8, t);
  }
}

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function firstDiff(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; }

/** the port's nodes of a record that belong to the original's list (those the set-up attached by a constructor address) */
export function portNodes(rec) { return (rec.ctrl?.nodes ?? []).filter((n) => n.ctor !== undefined); }

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the whole island in the emulator: every attach of the original's set-up built by the original's own constructors (FUN_00423532), in the set-up's order
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { loadIsland } from './island-load.mjs';
import { loadExe } from './engine-load.mjs';
import { IslEmu } from './m7-isl-veh-emu.mjs';
import { hostFiles, SPLINE_EXEC } from './m7-isl-veh-ambient.mjs';   // the swifts' spline engine (the .man files of the island's archive) runs natively
import './m7-isl-veh-trig.mjs';   // patches IslEmu.initHosts: with `globalThis.__bldgHooks` the building constructors get FUN_0043ea40 (part count of a record's model)
import { baseParts } from '../../src/island/trigger/parts.ts';
import { waypoints, Walker } from '../../src/game/walker.ts';

import { decorStore } from '../../src/island/decor.ts';
/** a fresh process: the walker table is static memory that keeps stale walkers after a reset (FUN_004613d0 only clears the flag words); the oracle machine starts with zeros */
export function freshWalkerTable() { decorStore.blob = null; waypoints.unload(); for (let i = 0; i < waypoints.slots.length; i++) waypoints.slots[i] = Object.assign(new Walker(), { reach: 0, speedScale: 0 }); }
import { islandWorldSetup } from '../../src/zones/z02LGI/index.ts';
import { zoneSetupFor } from '../../src/shell/zonegame.ts';
import '../../src/zones/index.ts';   // registers the zones' set-up hooks and constructors

/**
 * `{ P, O, emu, failed }`: P = the port's island world (`loadIsland`), O = a second port island that is the oracle's collision / animation mirror, emu = the IslEmu with every node of the
 * set-up constructed natively; `failed` lists the attaches whose constructor did not run (a host the emulation lacks).
 */
export function buildIslandOracle(ctx, node, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  freshWalkerTable();   // the walker table is a process-wide singleton (a full table of an earlier build would shift every handle)
  const prevRandom = getIslandRandom();
  setIslandRandom(() => 0);   // the original's rand is scripted to 0 below (`rng`): the port's constructors that draw (the swifts' start timers, SUPE's destination ...) draw the same zeros
  let P, O;
  try { P = loadIsland(ctx, { node, bricks: false }); O = loadIsland(ctx, { node, bricks: false }); } catch (e) { setIslandRandom(prevRandom); throw e; }
  let emu;
  globalThis.__argZeroCtors = new Set([0x88df51]);   // hOLO: a zero raw argument stays NULL like the original's set-up (its `arg == 0` = hide after use)
  globalThis.__bldgHooks = true;   // (WP-SAVE d: the building constructors (0x535e80, 0x5364a5 ...) read the part count FUN_0043ea40 of the record's model in the original's constructor)
  try { emu = new IslEmu(pe, O, { dt: 1, rng: { range: () => 0 }, extraExec: [[0x490000, 0x4a0000], [0x461000, 0x466800], ...SPLINE_EXEC, ...(o.extraExec ?? [])], parts: (idx) => baseParts(O.world, O.world.records[idx]) ?? [] }); } finally { globalThis.__bldgHooks = false; }
  hostFiles(emu, { P });   // (the spline files of the island's archive for FUN_004454e0: the swift leader's constructor)
  // FUN_004040ec(i): the settings word i (the Music node reads the volume): a scratch block of defaults
  const settings = emu.alloc(0x100);
  emu.cpu.hooks.set(0x4040ec, (c) => { c.eax = settings + 4 * (c.arg(0) | 0); });
  emu.cpu.exec.push([0x419a79, 0x419b17]);   // FUN_00419a79: the record lookup by tag the loaders use (runs natively on the record mirror)
  cdFillHeap(emu);
  if (o.animTokens) { installAnimTokens(emu); putLoaderInstances(emu, o.loaderRigs ?? []); }
  for (const h of o.hooks ?? []) emu.cpu.hooks.set(h[0], h[1]);
  emu.setFocus(O.pepper.index);
  const failed = [];
  for (const a of O.profile.island.attaches) {
    if (!a.hasController) continue;
    try { emu.attach(a); } catch (e) { failed.push(`${a.ctorName ?? '?'}@${a.ctor.toString(16)} rec ${a.record}: ${String(e.message ?? e).slice(0, 90)}`); }
  }
  globalThis.__argZeroCtors = null;
  // the port's world work of the zone game (src/zones/z02LGI/index.ts `islandWorldSetup`: walk maps, animation instances, the walkers of the pizza / NPC / vehicle nodes in attach order, Pepper's walker)
  try { islandWorldSetup(P.world, P.L, P.archive); } finally { setIslandRandom(prevRandom); }
  return { P, O, emu, failed, pe };
}

import { loadHub } from './hub-load.mjs';
import { zoneCodeIndex } from '../../src/formats/zonesetup.ts';
import { applyEmulatedArrival } from '../../src/hub/arrival.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';
import { setIslandRandom, getIslandRandom } from '../../src/island/rng.ts';

/** the C runtime's rand(): LCG 214013 / 2531011, bits 16..30 (one stream shape for the port's `rand` and the original's FUN_004388ae, as the m5 duels use it) */
export function msvcRand(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; }; }
/** hubs whose port nodes have a constructor half that draws random numbers (`ctorInit`, run by the hub game after the set-up): the oracle runs it too, both sides on the same LCG stream (WP-SAVE csi / cai) */
const CTOR_INIT_ZONES = new Set([]);   // (the shared structural test draws zeros on both sides; the families' own tests (m8-save-csi ...) drive the LCG stream)

/** the roster / decor constructor tails of the hubs (FUN_00655de3, FUN_00698963, FUN_007651a3, FUN_00811413 ...) lie behind the end of `zoneCodeIndex(zone).hi` */
const HUB_ROSTER_EXEC = { z14OSD: [[0x655000, 0x656500]], z16PYA: [[0x698000, 0x699000]], z23DIP: [[0x765000, 0x765500]], z40OGL: [[0x811000, 0x811700]] };

/** the same for a hub zone (src/hub): `{ P, O, emu, failed, pe }`; the hub's own code range, the walker and the skateboard run natively next to the island's */
export function buildHubOracle(ctx, zone, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  freshWalkerTable();
  const hopts = { zone, node: o.node, vars: o.vars };
  const P = loadHub(ctx, { ...hopts, worldWork: o.worldSetup === false });   // (the registered afterSetup hook below is the world work)
  const O = loadHub(ctx, { ...hopts, worldWork: false });   // the scene + the emulated set-up's own arrival: the constructors' world work (NPC ground snaps ...) is the ORACLE's native code, not the port's
  applyEmulatedArrival(O.profile.emu, O.world, O.L);
  for (let i = 0; i < 319; i++) O.vars.set(i, P.world.vars.get(i));
  freshWalkerTable();   // (O's loadHub ran the walkers of the framework's world work on the shared table: the hub's afterSetup below builds the port's own)
  const code = zoneCodeIndex(pe).get(zone.toLowerCase()), osd = zoneCodeIndex(pe).get('z14osd');   // (the Gems / scorpion / Tumblewd code of z16PYA / z23DIP lives in z14OSD's range)
  const I = { world: O.world, pepper: O.pepper, vars: O.vars, profile: { island: O.profile.emu } };
  // the port's set-up work of the hub (src/hub/game.ts `afterSetup`: walk maps, walkers, the constructors' world halves `ctorInit` in record order, the zone's own set-up) runs after the oracle's
  // constructors; both sides draw their random numbers from the same LCG stream (`rngP` / `rngO`; `o.ctorInit` = false: the oracle's random function is 0)
  const ctorInit = o.ctorInit ?? CTOR_INIT_ZONES.has(zone);
  const rngP = msvcRand(o.seed ?? 12345), rngO = msvcRand(o.seed ?? 12345);
  globalThis.__argZeroCtors = new Set([0x88df51]);   // (see buildIslandOracle)
  const emu = new IslEmu(pe, I, { dt: 1, rng: { range: ctorInit ? (m) => (m <= 0 ? 0 : (rngO() / 32767) * m) : () => 0 }, extraExec: [[0x490000, 0x4a0000], [0x461000, 0x466800], [code.lo, code.hi], ...(zone === 'z16PYA' || zone === 'z23DIP' ? [[osd.lo, osd.hi]] : []), ...(HUB_ROSTER_EXEC[zone] ?? []), ...(o.extraExec ?? [])], parts: (idx) => baseParts(O.world, O.world.records[idx]) ?? [] });
  const settings = emu.alloc(0x100);
  emu.cpu.hooks.set(0x4040ec, (c) => { c.eax = settings + 4 * (c.arg(0) | 0); });
  emu.cpu.exec.push([0x419a79, 0x419b17]);
  cdFillHeap(emu);
  if (o.animTokens) { installAnimTokens(emu); putLoaderInstances(emu, o.loaderRigs ?? O.profile.emu.loaderRigs ?? []); }
  for (const h of o.hooks ?? []) emu.cpu.hooks.set(h[0], h[1]);
  emu.setFocus(O.pepper.index);
  const failed = [];
  for (const a of O.profile.emu.attaches) {
    if (!a.hasController) continue;
    try { emu.attach(a); } catch (e) { failed.push(`${a.ctorName ?? '?'}@${a.ctor.toString(16)} rec ${a.record}: ${String(e.message ?? e).slice(0, 90)}`); }
  }
  globalThis.__argZeroCtors = null;
  const hook = zoneSetupFor(zone)?.afterSetup;
  if (hook && o.worldSetup !== false) {
    const prev = getIslandRandom();
    setIslandRandom(ctorInit ? () => rngP() / 32768 : () => 0);
    try { hook(null, P.world, P.L, P.archive); } finally { setIslandRandom(prev); }
  }
  return { P, O, emu, failed, pe };
}

/**
 * Bytes of a block that are process addresses / stack garbage of the ORIGINAL and cannot be reproduced bit for bit (listed with the reason; compared masked). The pointer words of the record
 * tables follow the oracle's convention (record i = 0x10000000 + i * 0x68) and are compared exactly.
 *   0x429d1b (carry)  no carrier: the saver's own stack frame (block 0x2e..0x2f, 0x34..0x47); with a carrier: the carrier's model / animation pointers (0x28..0x2f)
 *   0x88fb35 (SGCar)  four cached part-matrix pointers set by the draw hook (heap addresses), block 0x3c..0x4b
 */
export function maskRanges(ctor, ob) {
  if (ctor === 0x429d1b) { const w = ob[0x24] | (ob[0x25] << 8) | (ob[0x26] << 16) | (ob[0x27] << 24); return (w === 0 || w === 1) ? [[0x2e, 0x30], [0x34, 0x48]] : [[0x28, 0x30]]; }
  if (ctor === 0x88fb35) return [[0x3c, 0x4c]];
  return [];
}

/**
 * Compare every node's save block, the original's against the port's, for the records whose node lists agree (same constructors in the same order). `world` = the port world, `emu` = the oracle machine
 * with the same set-up. Returns { checked, byCtor: Map<ctorHex, { n, bad, first }> , failures: string[] }.
 * `only`: a Set of constructor addresses (numbers) to restrict the comparison to (the workers' focus).
 */
export function compareBlocks(world, emu, label, only = null) {
  const out = { checked: 0, failures: [], byCtor: new Map() };
  const stat = (c) => { const k = '0x' + c.toString(16); let s = out.byCtor.get(k); if (!s) out.byCtor.set(k, (s = { n: 0, bad: 0, first: '', saver: 0, loader: 0, size: -1 })); return s; };
  for (const [i, r] of world.records.entries()) {
    const on = nativeNodes(emu, i), pn = portNodes(r);
    if (on.map((n) => n.ctor).join() !== pn.map((n) => n.ctor).join()) continue;   // structure differences are reported by the structure check
    on.forEach((o, k) => {
      const p = pn[k];
      if (only && !only.has(o.ctor)) return;
      const s = stat(o.ctor);
      s.n++;
      out.checked++;
      s.saver = o.saver; s.loader = o.loader;
      const fail = (m) => { s.bad++; const msg = `${label} rec ${i} ${r.name} node ${k} ctor 0x${o.ctor.toString(16)}: ${m}`; if (!s.first) s.first = msg; if (out.failures.length < 400) out.failures.push(msg); };
      if ((p.stamp >>> 0) !== (o.state >>> 0)) fail(`stamp port ${(p.stamp >>> 0).toString(16)} original ${(o.state >>> 0).toString(16)}`);
      const ob = origBlock(emu, o);
      if (ob) s.size = ob.length;
      const pb = p.saveBlock ? p.saveBlock(world, r, r.ctrl) : null;
      if (!!p.loadBlock !== !!o.loader) fail(`loader: port ${!!p.loadBlock} original ${!!o.loader}`);
      if (ob === null && pb === null) return;
      if (ob === null || pb === null) { fail(`save block: port ${pb ? pb.length + ' bytes' : 'none'} original ${ob ? ob.length + ' bytes' : 'none'}`); return; }
      if (ob.length !== pb.length) { fail(`size port ${pb.length} original ${ob.length}`); return; }
      const ma = Uint8Array.from(ob), mb = Uint8Array.from(pb);
      for (const [lo, hi] of maskRanges(o.ctor, ob)) for (let q = lo; q < hi && q < ma.length; q++) { ma[q] = 0; mb[q] = 0; }
      const d = firstDiff(ma, mb);
      if (d >= 0) fail(`byte ${d} (+0x${(d + 0x30).toString(16)}?) differs: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`);
    });
  }
  return out;
}

/** every node's original state word and save block right now: [{ i (record), k (node index in the original's list), ctor, state, bytes (null = no serializer) }] */
export function snapshotBlocks(emu, world, only = null) {
  const out = [];
  for (const [i] of world.records.entries()) nativeNodes(emu, i).forEach((n, k) => { if (!only || only.has(n.ctor)) out.push({ i, k, ctor: n.ctor, state: n.state, bytes: origBlock(emu, n) }); });
  return out;
}

/**
 * Put a snapshot back into BOTH machines the way FUN_00419e82 does for the nodes: the +8 word, then the loader (the original's natively, the port's `loadBlock` with the same bytes).
 * Returns the number of nodes loaded; throws when the two node lists differ.
 */
export function restoreBlocks(world, emu, snap) {
  let n = 0;
  for (const s of snap) {
    const o = nativeNodes(emu, s.i)[s.k], rec = world.records[s.i], p = portNodes(rec)[s.k];
    if (!o || !p || o.ctor !== s.ctor || p.ctor !== s.ctor) throw new Error(`restoreBlocks: node ${s.k} of record ${s.i} is not constructor 0x${s.ctor.toString(16)}`);
    emu.cpu.mem.w32(o.ptr + 8, s.state);
    p.stamp = s.state >>> 0;
    if (s.bytes && o.loader) { origLoad(emu, o, s.bytes); p.loadBlock?.(world, rec, rec.ctrl, s.bytes); n++; }
  }
  return n;
}

import { sceneOf } from './engine-load.mjs';
import { emulateZoneSetup, ISLAND_SPEC } from '../../src/formats/emusetup.ts';

/** the island loader's animation instances (FUN_004f645b ...): the island's set-up emulated once more with the loader's rig calls recorded (`spec.loaderRigs`), for the vars the oracle's world has */
export function islandLoaderRigs(ctx, node) {
  const pe = loadExe(ctx.dataRoot), scene = sceneOf(ctx, 'z02LGI');
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
  const I = loadIsland(ctx, { node, bricks: false });
  const vars = { get: (i) => I.vars.get(i), set: (i, v) => I.vars.set(i, v) };
  // the island loader (FUN_004f645b @0x519c09 ..) starts every instance it creates with FUN_0043b6a3(instance, 1, 0): the set-up emulation records no start for them (clip -1)
  return emulateZoneSetup(pe, scene, { vars, archive }, { ...ISLAND_SPEC, loaderRigs: true }).loaderRigs.map((r) => ({ ...r, clip: r.clip < 0 ? 1 : r.clip }));
}
