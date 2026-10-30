// WP-SAVE (front end): the ORIGINAL's front end set-up runs natively in the x86 emulation, the port's front end world is built next to it, and the original's writer FUN_00418ec7(-2) (SaveDef.lgo,
// FUN_0041ad71 in the loop FUN_00470ac3) writes the file the port's `captureWorld` is compared with (tools/tests/m8-save-fe.mjs).
// Native (from the user's own executable, addresses only): FUN_00444850 (the shadow set-up: the two variables it writes), FUN_00471070 (the stage: the records placed, every constructor through
// FUN_0042382c / FUN_00423532, the camera through FUN_00422b50 / FUN_0043cc5c), FUN_0042207d(record 0) (Pepper's walker), the writer and the reader. Hosted: the engine (heap with the debug fill 0xCD,
// animation instances: FUN_0047ec85's `clip 1 frame 0` instances of records 0 .. 21 as tokens, particle emitters, fog, sprintf / file calls of the save host, the random source).
import { ZoneEmu, RECORDS_BASE, REC } from './m7-zone-emu.mjs';
import { IslEmu, EXEC, NATIVE_EXTRA, VAR_ARRAY, HEAP_BASE } from './m7-isl-veh-emu.mjs';
import { cdFillHeap, installAnimTokens, freshWalkerTable } from './m8-save.mjs';
import { installSaveHost, installMathHosts } from './m8-save-world.mjs';
import { loadExe, sceneOf } from './engine-load.mjs';
import { buildRecords } from '../../src/game/zone.ts';
import { World } from '../../src/game/world.ts';
import { GameVars } from '../../src/game/vars.ts';
import { readInitialVars } from '../../src/shell/tables.ts';
import { feStageRecords, feStageNodes, feStartWalker, feStartVars } from '../../src/shell/frontend.ts';
import { feTables, rng } from '../../src/shell/fenodes.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';

/** a seeded rand(): the MSVC LCG (FUN_0085daf0: seed * 214013 + 2531011, bits 16..30); `range` = FUN_004388ae's draw */
export class Lcg {
  constructor(seed) { this.s = seed >>> 0; }
  int() { this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0; return (this.s >>> 16) & 0x7fff; }
  next() { return this.int() / 32767; }
  range(x) { return x <= 0 ? 0 : this.next() * x; }
  /** the island rng source's value for the same draw (rng.ts: rand() = floor(v * 32768)) */
  source() { return (this.int() + 0.5) / 32768; }
}

const FE_EXEC = [[0x470000, 0x4731d0], [0x461000, 0x466800], [0x43cb00, 0x43e000], [0x416000, 0x418000], [0x40c000, 0x40d000], [0x444850, 0x444950], [0x419a79, 0x419b17], [0x4b0000, 0x4b4000]];
/** the vtable of every node class of the stage -> its constructor (FUN_00471070's attaches) */
export const FE_CTORS = [0x472743, 0x4729f6, 0x472c45, 0x472fd8, 0x4b2d44];

export class FeSaveEmu extends ZoneEmu {
  /** @param W the oracle world (records: the mirror, as the loader leaves them before FUN_00471070) */
  constructor(pe, W, rngO) {
    super(pe, { records: W.records, world: W, anims: new Map(), pepperIndex: 0 }, { dt: 1, rng: rngO, exec: [...EXEC, ...FE_EXEC], soundAddr: {}, native: [...NATIVE_EXTRA] });
    const cpu = this.cpu, mem = cpu.mem, H = cpu.hooks;
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/engine-m1.md 8.1)
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x4000000, name: 'heap2' });
    this.nodeOf = new Map();
    this.cutscene = false;
    IslEmu.prototype.initHosts.call(this);
    for (let i = 0; i < 319; i++) mem.w32(VAR_ARRAY + 4 * i, 0);
    for (const a of [0x442d90, 0x4446c0, 0x41c080, 0x416961, 0x43ebe0, 0x444480]) H.set(a, (c) => { c.eax = 0; });   // fog, part render attributes, UI offsets, SetTransform(view)
    installSaveHost(this); installMathHosts(this);
    cpu.invalidate();
    cdFillHeap(this);
    this.toks = installAnimTokens(this);
  }
  /** the variables as the process holds them before the front end starts */
  putVars(vars) { for (let i = 0; i < 319; i++) this.cpu.mem.w32(VAR_ARRAY + 4 * i, vars.get(i) | 0); }
  /** FUN_0047ec85's instances (asm 0x48aff8 ..: FUN_0043b4e2(rig, 1) + FUN_0043b6a3(instance, 1, 0)) of records 0 .. 21 */
  putInstances() {
    const mem = this.cpu.mem;
    for (let i = 0; i <= 21; i++) {
      const t = this.alloc(0x24);
      this.toks.add(t);
      mem.w32(t + 0xc, 1); mem.wf32(t + 0x10, 0);
      mem.w32(RECORDS_BASE + i * REC + 8, t);
    }
  }
  call(addr, args = [], max = 50_000_000) { this.cpu.steps = 0; return this.cpu.call(addr, args, { maxSteps: max }); }
  /** the loop's start: FUN_00444850, FUN_00471070(1) (via FUN_0047172c), FUN_0042207d(record 0) */
  startFrontEnd() {
    const cpu = this.cpu;
    const attaches = [];
    cpu.watches.set(0x423532, (c) => { attaches.push({ rec: (c.arg(0) - RECORDS_BASE) / REC, ctor: c.arg(1) }); });
    cpu.invalidate();
    this.call(0x444850);
    this.call(0x471070, [1]);
    cpu.watches.delete(0x423532); cpu.invalidate();
    const mem = cpu.mem;
    for (const a of attaches) {
      const ctrl = mem.r32(RECORDS_BASE + a.rec * REC + 0x5c);
      const list = this.nodeOf.get(a.rec) ?? this.nodeOf.set(a.rec, []).get(a.rec);
      // the node this attach appended (a record has one attach here): the list's last node
      let p = mem.r32(ctrl);
      while (mem.r32(p + 0x10)) p = mem.r32(p + 0x10);
      list.push({ ptr: p, ctor: a.ctor });
    }
    this.attaches = attaches;
    mem.w32(0x9da5d0, RECORDS_BASE);   // (FUN_0042207d stores it itself)
    this.call(0x42207d, [RECORDS_BASE]);
  }
}

/**
 * The port's front end world as runFrontEnd builds it (without renderer / audio / menu): the same exported steps (src/shell/frontend.ts), the random sources on `rngP`. Returns { W, restore }.
 * `restore()` puts the nodes' random sources back (call it when the world is no longer ticked).
 */
export function buildFePort(ctx, rngP) {
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, 'z60FRE');
  const archive = ctx.archives.find((a) => a.name === 'z60FRE');
  const v = new GameVars(); v.a.set(readInitialVars(pe));
  const data = buildRecords('z60FRE', scene, archive);
  const W = new World();
  W.vars = v; W.externalInput = true; W.zone = 'z60FRE'; W.records = data.records; W.col.records = data.records;
  W.input = { pressed: 0, held: 0 };
  const prevNext = rng.next;
  rng.next = () => rngP.next();
  setAmbientRandom(() => rngP.source());
  const restore = () => { rng.next = prevNext; setAmbientRandom(null); };
  try {
    feStartVars(W.vars);
    feStageRecords(W, archive);
    feStageNodes(W, { tables: feTables(pe) });
    feStartWalker(W);
  } catch (e) { restore(); throw e; }
  return { W, restore, pe, archive };
}

/**
 * The oracle machine that ran the original's front end start, and the port's front end world next to it. `seed`: the one random stream both draw from.
 * { W, emu, pe, archive, rngP, rngO, restore }
 */
export function buildFeOracle(ctx, seed = 12345) {
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, 'z60FRE');
  const archive = ctx.archives.find((a) => a.name === 'z60FRE');
  freshWalkerTable();   // the process starts with a zero walker table and an empty decor store
  const init = readInitialVars(pe);
  const rngP = new Lcg(seed), rngO = new Lcg(seed);
  // the oracle's records: the loader's state (buildRecords), BEFORE FUN_00471070 places anything
  const O = new World(); O.records = buildRecords('z60FRE', scene, archive).records; O.vars = new GameVars(); O.vars.a.set(init);
  const emu = new FeSaveEmu(pe, O, rngO);
  emu.putVars(O.vars);
  emu.putInstances();
  emu.startFrontEnd();   // (the original's draws come first from the stream: the port's below start from the same seed)
  const P = buildFePort(ctx, rngP);
  return { W: P.W, emu, pe, archive, rngP, rngO, restore: P.restore };
}
