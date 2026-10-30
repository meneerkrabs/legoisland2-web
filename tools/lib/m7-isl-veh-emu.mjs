// WP-VERIFY M7 (island gameplay node families): the ORIGINAL's node framework and node code run in the x86 emulation (src/formats/x86emu.ts) as an oracle for src/island/**.
// What runs NATIVE (from the user's own executable, addresses only): the node framework (update pass FUN_0042226e, pre-render pass FUN_004225c5, controller creation FUN_0042382c,
// attach FUN_00423532, the distance FUN_0042216f), the node constructors / update / pre-render / draw hooks of the family under test (SGBoat 0x430e6c, SGHeli 0x4325e8, SGCar 0x88fb35,
// speeder 0x538126 / 0x5385d3, Pizza 0x429d1b / 0x42887c, PepSwitc ...), the matrix helpers and the C runtime. The island's machine state (the data / bss pages, the compiled
// waypoint maps, the heap) is the one the original's own set-up FUN_004b6475 left in the emulation of `IslandSetup` (src/formats/emusetup.ts, read-only here): the pages are copied
// into this CPU, so the dock / helipad tables, the sea level, the sound handle globals ... are what the original's code wrote, not what the port assumes.
// Hosted engine services (NOT the subject; each is commented where it is used): game variables (the array DAT_008a2d2c, with the original's vars 1 / 2 read-only rule), collision
// (the port's CollisionWorld over a mirror of the original's records: tools/lib/m7-zone-emu.mjs), animation instances (the port's AnimInstance), sounds / particles / render calls (logged).
// The port world next to it is a second `loadIsland` (tools/lib/island-load.mjs) driven with the same scripted buttons.
import { ZoneEmu, RECORDS_BASE, REC, fr } from './m7-zone-emu.mjs';

export { RECORDS_BASE, REC, fr };
export const HEAP_BASE = 0x20000000;
export const VAR_ARRAY = 0x8a2d2c, VAR_COUNT = 319;
export const B = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80, ENTER: 0x10000 };
/** button bit -> browser key code (the port's InputMapper default bindings) */
export const KEYS = { [B.LEFT]: 'ArrowLeft', [B.RIGHT]: 'ArrowRight', [B.UP]: 'ArrowUp', [B.DOWN]: 'ArrowDown', [B.CTRL]: 'ControlLeft', [B.ALT]: 'AltLeft', [B.SHIFT]: 'ShiftLeft', [B.SPACE]: 'Space', [B.ENTER]: 'Enter' };

// the whole shared node framework + SGGen nodes (0x422000 .. 0x433800: framework, walk, boat, heli, vehicle seat, pizza) run natively; engine functions in the range are hosted below
export const EXEC = [[0x4201aa, 0x433800], [0x4b0000, 0x53e000], [0x88c000, 0x890300]];
/** pure helpers that already live outside the exec ranges */
export const NATIVE_EXTRA = [0x462be9, 0x4630c0, 0x4236f3];

export class IslEmu extends ZoneEmu {
  /**
   * @param pe the executable
   * @param I the ORACLE world: `loadIsland` result (records = the collision mirror, anims = animation instances; `I.profile.island` = the emulated set-up whose memory seeds this CPU)
   * @param o { dt, rng: { range(x) } }
   */
  constructor(pe, I, o) {
    const anims = new Map();
    for (const r of I.world.records) if (r.anim) anims.set(r.index, r.anim);
    super(pe, { records: I.world.records, world: I.world, anims, pepperIndex: I.pepper.index }, { ...o, exec: [...EXEC, ...(o.extraExec ?? [])], soundAddr: {}, native: [...NATIVE_EXTRA, ...(o.extraNative ?? [])] });
    const cpu = this.cpu, mem = cpu.mem;
    if (o.fpu24 !== false) cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the original runs the x87 in 24-bit precision (Direct3D 7 leaves it single): every result rounds to float32
    this.I = I;
    this.setup = I.profile.island;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x4000000, name: 'heap2' });
    this.log = []; this.calls = [];
    // ---- seed the machine with the state the original's own set-up left (data / bss pages and the heap; the record array stays the mirror of the oracle world)
    const src = this.setup.mem;
    let maxHeap = HEAP_BASE;
    for (let pg = 0; pg < src.pages.length; pg++) {
      const p = src.pages[pg];
      if (!p) continue;
      const a = pg << 12;
      if (a >= RECORDS_BASE && a < HEAP_BASE) continue;                 // records: the mirror of the oracle world
      if (a >= HEAP_BASE + 0x4000000) continue;                         // files / stack / thread block of the set-up
      if (a >= HEAP_BASE) maxHeap = Math.max(maxHeap, a + 0x1000);
      mem.pages[pg] = new Uint8Array(p);
    }
    this.brk = Math.max(this.brk, maxHeap);
    // the game variable array: the oracle world's variables (the port's GameVars), same as the set-up used
    for (let i = 0; i < VAR_COUNT; i++) mem.w32(VAR_ARRAY + 4 * i, I.vars.get(i) | 0);
    this.initHosts();
    // the island's sound handles (GameLoop: FUN_004b037e / FUN_004b0f16 load every sound the zone code plays into its globals; the hosted loads hand out handles that remember the sound id)
    cpu.steps = 0;
    cpu.call(0x4b037e, [], { maxSteps: 5_000_000 });
    cpu.steps = 0;
    cpu.call(0x4b0b37, [], { maxSteps: 5_000_000 });    // (the walk node's constructor FUN_0042f470 calls these two)
    cpu.steps = 0;
    cpu.call(0x4b0f16, [], { maxSteps: 5_000_000 });
    this.nodeOf = new Map();       // record index -> [{ ptr, ctor }]
    // PepSwitc's constructor (FUN_004bbef8) calls the vehicle roster FUN_0051c823: it zeroes every record's variant word, runs FUN_00420837(0) (the decor / outfit group: slots DAT_009da350 = -1, variant words),
    // gives the roster vehicles variant 2, hides the decor templates. Run natively; the variant words are then compared with the port's `applyRosterRecords` (the loader's version of the same writes)
    for (let i = 0; i < this.oracle.records.length; i++) mem.w32(RECORDS_BASE + i * REC + 0x64, this.oracle.records[i].variant | 0);
    cpu.steps = 0;
    cpu.call(0x51c823, [], { maxSteps: 20_000_000 });
    this.rosterVariants = this.oracle.records.map((_, i) => mem.r32(RECORDS_BASE + i * REC + 0x64));
    this.rosterFlags = this.oracle.records.map((_, i) => mem.r16(RECORDS_BASE + i * REC + 0x60));
  }

  initHosts() {
    const cpu = this.cpu, mem = cpu.mem, H = cpu.hooks, L = this;
    const logf = (s) => this.log.push(s);
    this.varWrites = [];
    const varIdx = (i) => i | 0;
    H.set(0x417575, (c) => { c.eax = mem.r32(VAR_ARRAY + 4 * varIdx(c.arg(0))); });
    H.set(0x41ad80, (c) => { c.eax = mem.r32(VAR_ARRAY + 4 * varIdx(c.arg(0))); });   // FUN_0041ad80: the save copy only while DAT_009d9c19 == 1 (off here)
    const ro = (i) => i === 1 || i === 2;
    H.set(0x417597, (c) => { const i = varIdx(c.arg(0)); if (!ro(i)) { mem.w32(VAR_ARRAY + 4 * i, c.arg(1)); L.varWrites.push(`set ${i} ${c.arg(1) | 0}`); } });
    H.set(0x4175ca, (c) => { const i = varIdx(c.arg(0)); if (!ro(i)) { mem.w32(VAR_ARRAY + 4 * i, (mem.r32(VAR_ARRAY + 4 * i) + c.arg(1)) | 0); L.varWrites.push(`add ${i} ${c.arg(1) | 0}`); } c.eax = mem.r32(VAR_ARRAY + 4 * i); });
    H.set(0x41761b, (c) => { const i = varIdx(c.arg(0)); if (!ro(i)) { mem.w32(VAR_ARRAY + 4 * i, mem.r32(VAR_ARRAY + 4 * i) | c.arg(1)); L.varWrites.push(`or ${i} ${c.arg(1) >>> 0}`); } c.eax = mem.r32(VAR_ARRAY + 4 * i); });
    H.set(0x41766c, (c) => { const i = varIdx(c.arg(0)); if (!ro(i)) { mem.w32(VAR_ARRAY + 4 * i, mem.r32(VAR_ARRAY + 4 * i) & ~c.arg(1)); L.varWrites.push(`andnot ${i} ${c.arg(1) >>> 0}`); } c.eax = mem.r32(VAR_ARRAY + 4 * i); });
    // FX_Bricks (FUN_00447d20 registers a brick effect for a record and returns its slot; 447da0 / 447d70 / 447ed0 configure it; FUN_00447e60 = its state, 2 = idle): the vehicle test worlds have no brick library
    // (the port's `IslandCtx.brickMorph` is absent: its roster entries have no slot), so the original's roster gets no effect either (slot -1: FUN_00420404 then keeps no busy slot)
    H.set(0x447d20, () => { /* returns eax = 0 below */ });
    H.set(0x447d20, (c) => { c.eax = 0xffffffff; });
    H.set(0x447da0, () => {}); H.set(0x447d70, () => {}); H.set(0x447ed0, () => {}); H.set(0x447cc0, (c) => { c.eax = 1; });
    H.set(0x447e60, (c) => { c.eax = 2; });
    H.set(0x443c70, () => {});                       // FUN_00443c70(4): debug / memory-category marker
    H.set(0x45c432, (c) => { c.eax = L.cutscene ? 1 : 0; });   // FUN_0045c432: a cutscene is running (the test sets `cutscene`)
    // emitters (FX_Particles): FUN_00442960 / FUN_0044e920 (name, matrix, pos, rot, gate) create, FUN_0044ea60(h, var, mask, value) switch, FUN_0044ea00(h, matrix) move, FUN_0044ebd0(h, kind, &v) parameters:
    // logged as `fxg name@record var,mask,value` / `fxm name@record` / `fxp name@record kind` (the creations are not logged: the port creates its emitters lazily)
    this.fxh = new Map();
    const fxCreate = (c) => { const h = 0x100 + L.fxh.size; L.fxh.set(h, { name: mem.cstr(c.arg(0)), owner: (c.arg(1) - 0xc - RECORDS_BASE) / REC }); c.eax = h; };
    H.set(0x442960, fxCreate); H.set(0x44e920, fxCreate);
    // FUN_0044ebb0 (a compiled-out emitter creation) returns the engine's NO_HANDLE 0xbabababa, which every emitter call ignores
    H.set(0x44ebb0, (c) => { c.eax = 0xbabababa; });
    const fxn = (h) => { if ((h >>> 0) === 0xbabababa) return null; const e = L.fxh.get(h); return e ? `${e.name}@${e.owner}` : `?${h}`; };
    const fxl = (pre, h, rest = '') => { const n = fxn(h); if (n) logf(`${pre} ${n}${rest}`); };
    H.set(0x44ea60, (c) => { fxl('fxg', c.arg(0), ` ${c.arg(1) | 0},${c.arg(2) | 0},${c.arg(3) | 0}`); c.eax = 0; });
    H.set(0x442a20, (c) => { fxl('fxg', c.arg(0), ` ${c.arg(1) | 0},${c.arg(2) | 0},${c.arg(3) | 0}`); c.eax = 0; });
    H.set(0x44ea00, (c) => { fxl('fxm', c.arg(0)); c.eax = 0; });
    H.set(0x442a00, (c) => { fxl('fxm', c.arg(0)); c.eax = 0; });
    H.set(0x44ebd0, (c) => { fxl('fxp', c.arg(0), ` ${c.arg(1) | 0}`); c.eax = 0; });
    // FUN_00441b10(rec, &{ from*, delta*, normal*, point*, mask, radius, skin }, 0): the ray / swept ball against ONE record (the pizza's hit test of the targetable records): the engine's collision query, answered
    // by the port's CollisionWorld over the oracle world (not the subject; M1's tests cover the query itself)
    H.set(0x441b10, (c) => {
      L.sync();
      const q = c.arg(1), vec = (a) => [0, 1, 2].map((k) => mem.f32(a + 4 * k));
      const rec = L.oracle.records[(c.arg(0) - RECORDS_BASE) / REC];
      const h = L.oracle.world.col.rayRecord(rec, vec(mem.u32(q)), vec(mem.u32(q + 4)), mem.r32(q + 16), mem.f32(q + 20), mem.f32(q + 24));
      if (!h) { c.eax = 0; return; }
      for (let k = 0; k < 3; k++) { mem.wf32(mem.u32(q + 12) + 4 * k, h.point[k]); mem.wf32(mem.u32(q + 8) + 4 * k, h.normal[k]); }
      c.eax = 1;
    });
    // FUN_00444550(rec, partMask, mode): render mode of a record's parts (render only): logged
    H.set(0x444550, (c) => { logf(`mode ${(c.arg(0) - RECORDS_BASE) / REC} ${c.arg(1)} ${c.arg(2)}`); c.eax = 0; });
    // FUN_00444480(rec, node, a, b): the default mesh draw of a record (render only): the draw pass logs the records drawn (with flag bit 1 / 2 of the draw time)
    this.drawn = [];
    H.set(0x444480, (c) => { const a = c.arg(0); L.drawn.push([(a - RECORDS_BASE) / REC, mem.r16(a + 0x60)]); c.eax = 0; });
    // FUN_0043cd62(&pos, dy) = terrain height (FUN_004425f0 -> the downward ray against the ground record): the engine's collision query, answered by the port's CollisionWorld of the oracle
    // world (the same stand-in as the sweeps of tools/lib/m7-zone-emu.mjs: collision is not the subject here, M1's tests cover it; the mirror holds the original's record state)
    H.set(0x43cd62, (c) => { L.sync(); const p = c.arg(0); c.fpush(L.oracle.world.col.terrainHeight(mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), c.argf(1))); });
    // FUN_004425c0: the surface id of the polygon the last collision query hit (DAT_009deb78 + 4): the oracle world's CollisionWorld keeps the same record of its own queries (hosted collision, see above)
    H.set(0x4425c0, (c) => { c.eax = L.oracle.world.col.lastSurface(); });
    // FUN_004376f9(0, out): the keyboard / pad poll the car's input code (FUN_0088ebe6) repeats: out[0] = the held buttons, out[1] / out[2] = the pad axes (0 on the keyboard); the same buttons as the tick's
    H.set(0x4376f9, (c) => { const p = c.arg(1), h = mem.r32(0x98383c); mem.w32(p, h); mem.w32(p + 4, 0); mem.w32(p + 8, 0); c.eax = h; });
    // the island's emulation of FUN_00462be9 (waypoint node position) runs natively; the maps were loaded by the original's own set-up (pages copied)
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }

  /** the argument block of an attach as the original's set-up built it (the 0x80 bytes emusetup captured), in this machine's heap */
  argBlock(a) {
    const p = this.alloc(0x80);
    for (let k = 0; k < 0x80; k++) this.cpu.mem.w8(p + k, a.args[k]);
    return p;
  }

  /** the original's own attach sequence for one attach of the emulated set-up: FUN_0042382c (controller, create mode) + FUN_004238b7 (flags) + FUN_00423532 (the constructor runs natively) */
  attach(a) {
    const cpu = this.cpu, mem = cpu.mem, rp = this.recPtr(a.record);
    const keep = mem.r32(0x8adc74);
    mem.w32(0x8adc74, 1);
    if (!mem.r32(rp + 0x5c)) {
      cpu.steps = 0;
      cpu.call(0x42382c, [rp], { maxSteps: 1_000_000 });
      mem.w32(mem.r32(rp + 0x5c) + 0xc, a.ctrlFlags ?? 6);
    } else if (a.ctrlFlags !== undefined) mem.w32(mem.r32(rp + 0x5c) + 0xc, a.ctrlFlags);
    const ap = this.argBlock(a);
    cpu.steps = 0;
    // (only the family's nodes of the record are attached here: an index past the end of the shortened list appends, as FUN_00423532 and the port's `Controller.attach` do)
    const have = (this.nodeOf.get(a.record) ?? []).length;
    const pos = a.pos === 0 ? 0 : Math.min(a.pos, have);
    const node = cpu.call(0x423532, [rp, a.ctor, ap, pos, a.var, a.mask, a.value], { maxSteps: 20_000_000 });
    mem.w32(0x8adc74, keep);
    (this.nodeOf.get(a.record) ?? this.nodeOf.set(a.record, []).get(a.record)).push({ ptr: node, ctor: a.ctor });
    return node;
  }

  /** the controller of a record (FUN_0042382c in create mode) with the flags the set-up gave it (no nodes) */
  controller(index, flags) {
    const mem = this.cpu.mem, rp = this.recPtr(index);
    if (!mem.r32(rp + 0x5c)) {
      const keep = mem.r32(0x8adc74);
      mem.w32(0x8adc74, 1);
      this.cpu.steps = 0;
      this.cpu.call(0x42382c, [rp], { maxSteps: 1_000_000 });
      mem.w32(0x8adc74, keep);
    }
    mem.w32(mem.r32(rp + 0x5c) + 0xc, flags);
  }

  /** a stand-in node (a host function as the node's update; pre-render / draw hooks absent): the original's real node whose only effect matters here is replaced by what it writes */
  stub(index, gate, update) {
    const mem = this.cpu.mem, rp = this.recPtr(index), ctrl = mem.r32(rp + 0x5c);
    const fn = this.alloc(32);      // an address in the heap: the hook replaces whatever bytes are there
    this.cpu.hooks.set(fn, (c) => update(c));
    const vt = this.alloc(0x20); mem.w32(vt, fn); mem.w32(vt + 4, 0); mem.w32(vt + 8, 0); mem.w32(vt + 12, 0);
    const node = this.alloc(0x40);
    mem.w32(node, gate.var); mem.w32(node + 4, vt); mem.w32(node + 8, 0xfffffffe); mem.w16(node + 0xc, gate.mask); mem.w16(node + 0xe, gate.value); mem.w32(node + 0x10, 0);
    this.append(index, ctrl, node);
    return node;
  }

  append(index, ctrl, node) {
    const mem = this.cpu.mem;
    let p = mem.r32(ctrl);
    if (!p) mem.w32(ctrl, node); else { while (mem.r32(p + 0x10)) p = mem.r32(p + 0x10); mem.w32(p + 0x10, node); }
    (this.nodeOf.get(index) ?? this.nodeOf.set(index, []).get(index)).push({ ptr: node, ctor: 0 });
  }

  /** a node block built by hand (the constructor is not run: its work is world-level set-up the port's loader does): vtable, gate, size */
  rawNode(index, vtable, size, gate) {
    const mem = this.cpu.mem, ctrl = mem.r32(this.recPtr(index) + 0x5c);
    const node = this.alloc(Math.max(size, 0x40));
    mem.w32(node, gate.var); mem.w32(node + 4, vtable); mem.w32(node + 8, 0xfffffffe); mem.w16(node + 0xc, gate.mask); mem.w16(node + 0xe, gate.value); mem.w32(node + 0x10, 0);
    this.append(index, ctrl, node);
    return node;
  }

  /** the focus record (DAT_009da5d0) and the globals the walk node keeps */
  setFocus(i) { this.cpu.mem.w32(0x9da5d0, this.recPtr(i)); this.pep = i; }

  /** run the original's update pass (FUN_0042226e) then the pre-render pass (FUN_004225c5) over the whole record array */
  passes(held, pressed, opts = {}) {
    const cpu = this.cpu, mem = cpu.mem;
    this.ticks++;
    this.log = []; this.varWrites = []; this.drawn = [];
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x983848, 0); mem.w32(0x98384c, this.axisX ?? 0); mem.w32(0x983850, this.axisY ?? 0);   // (the pad's stick axes: zero unless a test injects them, as the horse test does)
    mem.w32(0x9da5c8, 0);
    this.sync();
    cpu.steps = 0;
    cpu.call(0x42226e, [RECORDS_BASE, this.oracle.records.length], { maxSteps: 50_000_000 });
    // the loop between the update and the pre-render pass: FUN_00427233, the controller probe pass (the deferred sweeps FUN_00427139 registered; the nodes read the result in their pre-render); the loop also sets
    // the camera view basis there (not run: the oracle's camera globals are the nodes' own)
    cpu.steps = 0;
    cpu.call(0x427233, [RECORDS_BASE, this.oracle.records.length], { maxSteps: 50_000_000 });
    cpu.steps = 0;
    cpu.call(0x4225c5, [RECORDS_BASE, this.oracle.records.length], { maxSteps: 50_000_000 });
    if (opts.draw) { cpu.steps = 0; cpu.call(0x42271b, [RECORDS_BASE, this.oracle.records.length, 0, 0], { maxSteps: 50_000_000 }); }
    return this.log;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The duel: the port's island world next to the original's code, ticked with the same buttons, compared tick by tick
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { loadIsland } from './island-load.mjs';
import { loadExe } from './engine-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { baseParts } from '../../src/island/trigger/parts.ts';
import { NODE_STOP, Controller } from '../../src/game/controller.ts';
import { waypoints } from '../../src/game/walker.ts';

const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

/**
 * @param ctx test context
 * @param o { node (story node, default 2), dt, keepKinds: constructor names of the family under test ('SGBoat' ...), keepRecords: (name) => bool (the records that keep their nodes),
 *            rng: { range(x), next() } shared random source script }
 */
export class Duel {
  constructor(ctx, o = {}) {
    this.o = o;
    /** bit-exact comparison (tolerance 0): the default of the island tests; the hub duels that borrow `Duel.prototype` (tools/lib/m5-z*-emu.mjs) do not run this constructor and keep their own tolerances */
    this.exactDefault = true;
    this.dt = o.dt ?? 1;
    // the walker table (60 slots) is a process-wide singleton: the previous sessions' walkers are dead, free them (a full table made later sessions of a long shared-runner run get no walker)
    waypoints.reset();
    const pe = (this.pe = loadExe(ctx.dataRoot));
    this.P = loadIsland(ctx, { node: o.node ?? 2, bricks: false });      // the port
    this.O = loadIsland(ctx, { node: o.node ?? 2, bricks: false });      // the oracle world (collision mirror, animation instances, set-up memory)
    const P = this.P, W = P.world;
    const kinds = new Set(o.keepKinds ?? []);
    this.keep = (r) => (o.keepRecords ? o.keepRecords(r.name) : true);
    // ---- the port: only the family's nodes stay (Pepper's chain is reduced to the walk stub below)
    for (const r of W.records) {
      if (!r.ctrl) continue;
      if (r === P.pepper) continue;
      if (!this.keep(r)) { r.ctrl = null; continue; }
      r.ctrl.nodes = r.ctrl.nodes.filter((n) => kinds.has(n.kind));
      if (!r.ctrl.nodes.length) r.ctrl = null;
    }
    W.dt = this.dt;
    W.externalInput = true;
    this.heldNow = 0; this.prevHeld = 0;
    this.psnd = [];
    const ic = P.ictx;
    const rs = ic.sfx.bind(ic), ss = ic.stopSfx.bind(ic);
    ic.sfx = (id) => { this.psnd.push(`p2 #${id}`); rs(id); };
    ic.stopSfx = (id) => { this.psnd.push(`s2 #${id}`); ss(id); };
    ic.sfxFreq = (id, hz) => { this.psnd.push(`r #${id} ${hz | 0}`); };
    ic.sfxAt = (id, pos) => { this.psnd.push(`p3 #${id} ${[...pos].map(f32)}`); };
    ic.partMode = (rec, mask, mode) => { this.psnd.push(`mode ${rec.index} ${mask} ${mode}`); };
    // the port's emitters: the boat's `ctx.particles(name, mode, pos, owner)` (mode 1 / 2 = FUN_0044ea60 gate; mode 0 = follow the record, no call of the original) and the WP5 nodes' `ctx.fx` (ZoneParticles-shaped)
    ic.particles = (name, mode, pos, owner) => { if (mode === 1 || mode === 2) this.psnd.push(`fxg ${name}@${owner} ${mode},1,1`); };
    const fxName = new Map(), fxIdx = (m) => { const f = typeof m === 'function' ? m() : m; return W.records.findIndex((r) => r.m === f); };
    ic.fx = {
      start: (name, matrix) => { const h = fxName.size + 1; fxName.set(h, `${name}@${fxIdx(matrix)}`); return h; },
      startSwirl: (name) => { const h = fxName.size + 1; fxName.set(h, `${name}@-1`); return h; },
      setGate: (h, g) => { this.psnd.push(`fxg ${fxName.get(h)} ${g[0]},${g[1]},${g[2]}`); },
      setMatrix: (h) => { this.psnd.push(`fxm ${fxName.get(h)}`); },
      setParam: (h, type) => { this.psnd.push(`fxp ${fxName.get(h)} ${type}`); },
      stop: () => {}, finish: () => {},
    };
    this.pfx = [];
    // ---- the oracle
    // (FUN_0043ea60's part matrices start as the mesh's MATL entries: parsed by the port's `baseParts` from the same .msh files; this input is shared, the motion applied to them is the original's)
    this.emu = new IslEmu(pe, this.O, { ...(o.emuOpts ?? {}), extraExec: o.extraExec, extraNative: o.extraNative, dt: this.dt, rng: o.rng ?? { range: () => 0 }, parts: (idx) => baseParts(this.O.world, this.O.world.records[idx]) ?? [] });
    const emu = this.emu, att = this.O.profile.island.attaches;
    o.beforeAttach?.(emu, this);          // hosts a family needs while its constructors run (the Duel's own `emu` is not returned yet)
    emu.setFocus(this.O.pepper.index);
    const pe0 = att.find((a) => a.record === this.O.pepper.index);
    emu.controller(this.O.pepper.index, pe0?.ctrlFlags ?? 6);
    for (const a of att) {
      if (a.record === this.O.pepper.index) continue;
      if (!(kinds.has(a.ctorName) || o.oracleCtors?.has(a.ctor)) || !this.keep(this.O.world.records[a.record])) continue;
      if (!a.hasController) continue;
      emu.attach(a);
    }
    // Pepper's chain: PepSwitc (the mode switch, natively: update FUN_004bb630 / pre-render FUN_004bb67d through its handler table 0x8d9d18; its constructor only does world-level set-up),
    // the walk node's one effect on the vehicles (FUN_0042d514 writes DAT_008ae330 = 576 = 24^2 every tick it runs: PEPPER_CONTROL & 1; line 22353 of the decompile), SGVehic (natively)
    const wantSw = o.pepSwitc !== false, wantSeat = o.seat !== false;
    const pi = this.O.pepper.index;
    const pchain = [];
    if (wantSw) { emu.rawNode(pi, 0x8d9d18, 0x28, { var: 0x5e, mask: 0, value: 0 }); }
    emu.stub(pi, { var: 0x5e, mask: 1, value: 1 }, (c) => { emu.cpu.mem.w32(0x8ae330, 0x44100000); c.eax = 1; });
    if (o.pepperCtors) for (const a of att) if (a.record === pi && o.pepperCtors.has(a.ctor)) emu.attach(a);     // extra nodes of Pepper's chain (the skateboard 0x43310c, ...), between the walk stub and SGVehic
    if (wantSeat) for (const a of att) if (a.record === pi && a.ctorName === 'SGVehic') emu.attach(a);
    if (o.pepperFirstCtors) for (const a of att) if (a.record === pi && o.pepperFirstCtors.has(a.ctor)) emu.attach(a);     // nodes at the head of Pepper's chain (Music, pos 0): attached last, at pos 0
    const pctrl = W.focus.ctrl;
    if (pctrl) {
      const old = pctrl.nodes;
      const sw = old.find((n) => n.kind === 'PepSwitc'), seat = old.find((n) => n.kind === 'SGVehic');
      const walkstub = { kind: 'walkstub', var: 0x5e, mask: 1, value: 1, stamp: 0xfffffffe, update: (w) => { vehicles(w).range = 576; return NODE_STOP; } };
      pctrl.nodes = [...old.filter((n) => (o.pepperFirstKinds ?? []).includes(n.kind)), ...(wantSw && sw ? [sw] : []), walkstub, ...old.filter((n) => (o.pepperKinds ?? []).includes(n.kind)), ...(wantSeat && seat ? [seat] : [])];
      pctrl.exclusive = null;
    }
    void pchain;
    // initial camera, as the shell hands it over (both start equal)
    for (let k = 0; k < 6; k++) emu.cpu.mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
    this.t = 0;
    this.nfail = 0; this.checked = 0; this.failures = o.failures ?? [];
    this.worst = new Map();
    this.deviations = new Map();
  }

  /** put Pepper at a spot in both worlds */
  placePepper(x, y, z, ry = 0) {
    for (const [r, emuSide] of [[this.P.pepper, false], [this.O.pepper, true]]) {
      r.setEuler(0, ry, 0, x, y, z); r.rx = 0; r.ry = ry; r.rz = 0;
    }
    this.emu.putRecord(this.O.pepper.index, this.O.pepper);
    this.emu.sync();
  }

  /** advance both one tick with the buttons `held` (bit mask) */
  tick(held) {
    const W = this.P.world;
    const pressed = (held ^ this.prevHeld) & held;
    this.prevHeld = held;
    W.input.held = held; W.input.pressed = pressed; W.input.prevHeld = held & ~pressed;
    this.psnd.length = 0; this.pfx.length = 0;
    if (this.t > 0) { if (this.syncMode || this.resyncNext) this.syncPort?.(this); else this.syncFree?.(this); }
    this.resyncNext = false;
    // Pepper's clip plays on (the walk node's FUN_0043b76a call: rate 1.0 here; both worlds' AnimInstances advance the same way)
    if (this.o.advancePepper) for (const r of [this.O.pepper, this.P.pepper]) r.anim?.advance(this.o.advancePepper, this.dt);
    this.olog = this.emu.passes(held, pressed, { draw: this.o.draw });
    W.tick();
    this.t++;
  }

  // ---- comparison helpers
  /** a KNOWN DEVIATION of the port (reported with the evidence of its first occurrence; the test then makes the port's state equal to the original's and goes on, so that everything else stays strict) */
  deviation(id, detail) { const e = this.deviations.get(id); if (e) e.count++; else this.deviations.set(id, { count: 1, first: `t${this.t} ${detail}` }); }
  fail(msg) { this.nfail++; if (this.failures.length < (this.o.maxFail ?? 40)) this.failures.push(msg); else if (this.failures.length === (this.o.maxFail ?? 40)) this.failures.push('... more failures'); }
  /**
   * float comparison: |orig - port| <= tol * max(1, |orig|) + abs. The original keeps every intermediate in float32, the port in doubles (rounded to float32 only where a record matrix is
   * stored): tol = 2e-5 relative covers the accumulated rounding of the integrators; `abs` is the float32 noise floor of a coordinate (world coordinates reach 500: 1 ulp = 3e-5, a sum
   * of a few terms such as the eased camera or a matrix translation = 3e-4); quantities near 0 that are differences of such coordinates need it.
   */
  cmp(name, orig, port, tol, idx = '', abs = 1e-6) {
    if (this.exactDefault && this.o.exact !== false) { tol = 0; abs = 0; }       // WP-ISLAND-FIX: bit for bit (the port's island code is float32 per operation like the original's 24-bit x87)
    tol ??= this.syncMode ? 5e-6 : (this.o.tolFree ?? 2e-5);
    this.checked++;
    const d = Math.abs(orig - port);
    if (d > (this.worst.get(name) ?? 0)) this.worst.set(name, d);
    if (!(d <= tol * Math.max(1, Math.abs(orig)) + abs)) this.fail(`${this.label} t${this.t} ${name}${idx}: original ${orig} port ${port}`);
  }
  eq(name, orig, port, idx = '') {
    this.checked++;
    if (orig !== port) this.fail(`${this.label} t${this.t} ${name}${idx}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`);
  }
  /** a record against the original's memory: matrix, Euler angles, flags (& mask) */
  rec(i, flagMask = 0xffff, tol, enabledOnly = false) {
    const mem = this.emu.cpu.mem, a = RECORDS_BASE + i * REC, r = this.P.world.records[i];
    // enabledOnly: the pose of a HIDDEN record is not observable (nothing draws it): only its flags are compared then
    if (enabledOnly && (mem.r16(a + 0x60) & 2) === 0 && (r.flags & 2) === 0) { this.eq(r.name + '.flags', mem.r16(a + 0x60) & flagMask, r.flags & flagMask); return; }
    const nm = r.name + '.m';
    // rotation elements: the Euler angles are accumulated unwrapped in float32 (ulp = 1.2e-7 * angle), so sin / cos of them carry an absolute error ~ 25 ulps of the angle; translations 3e-4 (float32 noise of a coordinate)
    // (sync mode: the port's state is set to the original's before every tick, so only one step of float noise is left: far tighter bounds)
    const rotAbs = this.exactDefault && this.o.exact !== false ? 0 : this.syncMode ? (this.o.rotAbsSync ?? 5e-7) : 3e-6 * (1 + Math.abs(r.rx) + Math.abs(r.ry) + Math.abs(r.rz));
    for (let k = 0; k < 16; k++) this.cmp(nm, mem.f32(a + 0xc + 4 * k), r.m[k], tol, `[${k}]`, k >= 12 ? (this.syncMode ? 1e-4 : 3e-4) : k === 3 || k === 7 || k === 11 ? 1e-6 : rotAbs);
    this.cmp(r.name + '.rx', mem.f32(a + 0x4c), r.rx, tol); this.cmp(r.name + '.ry', mem.f32(a + 0x50), r.ry, tol); this.cmp(r.name + '.rz', mem.f32(a + 0x54), r.rz, tol);
    this.eq(r.name + '.flags', mem.r16(a + 0x60) & flagMask, r.flags & flagMask);
    // the animation instance (the oracle world's instance is the one the original's FUN_0043b6a3 / 0043b76a / 0043b64d calls drive): clip and frame
    const oa = this.O.world.records[i].anim, pa = r.anim;
    if (oa && pa && !(enabledOnly && (mem.r16(a + 0x60) & 2) === 0 && (r.flags & 2) === 0)) { this.eq(r.name + '.clip', oa.clip, pa.clip); this.cmp(r.name + '.frame', oa.frame, pa.frame); }
  }
  vars(skip = []) {
    const mem = this.emu.cpu.mem, W = this.P.world.vars;
    for (let i = 3; i < VAR_COUNT; i++) {
      if (skip.length && skip.includes(i)) continue;
      this.checked++;
      const o = mem.r32(VAR_ARRAY + 4 * i), p = W.get(i) | 0;
      if (o !== p) this.fail(`${this.label} t${this.t} var ${i}: original ${o} port ${p}`);
    }
  }
  camera() {
    const mem = this.emu.cpu.mem, c = this.P.world.camera.c;
    for (let k = 0; k < 6; k++) this.cmp('camera', mem.f32(0x9da5e8 + 4 * k), c[k], undefined, `[${k}]`, this.syncMode ? 1e-4 : 3e-4);
  }
  /** the vehicle globals: current vehicle, kind, enter flags, range, mailbox */
  globals() {
    const mem = this.emu.cpu.mem, G = vehicles(this.P.world), W = this.P.world;
    const cur = mem.r32(0x9daa80);
    this.eq('DAT_009daa80 current', cur ? (cur - RECORDS_BASE) / REC : -1, G.current ? G.current.index : -1);
    this.eq('kind (DAT_009da9f8 hi)', mem.r16(0x9da9fa) << 16 >> 16, G.kind);
    this.eq('DAT_009daa10 boatEnter', mem.r32(0x9daa10) !== 0, G.boatEnter);
    this.cmp('DAT_008ae330 range', mem.f32(0x8ae330), G.range, undefined, '', 1e-3);
    this.eq('mailbox', mem.r32(0x8ae088), W.pep.mailbox);
  }
  /**
   * the sound calls of a tick: play / stop / rate (Hz) / 3D position. Stops of the same sound id within a tick count once (the original stops handle by handle: the rolling sounds 0x185 have two handles);
   * rates compare to +-1 Hz (the original's pitch state is float32, the port's a double: the truncation to whole Hz differs by 1 when the value sits on a boundary); positions with the float tolerance
   */
  sounds() {
    const keep = (l) => /^(p2|s2|r|p3|fxg|fxm|fxp) /.test(l);
    const dedupe = (l) => { const out = []; const seen = new Set(); for (const x of l) { if (x.startsWith('s2 ')) { if (seen.has(x)) continue; seen.add(x); } out.push(x); } return out; };
    const o = dedupe(this.olog.filter(keep)), p = dedupe(this.psnd.filter(keep));
    // port-only calls that are a KNOWN DEVIATION (`portOnly(line)` -> deviation id): dropped from the comparison and counted
    // original-only calls that are a KNOWN DEVIATION of the port (`origOnly(line, portList)` -> deviation id)
    if (this.origOnly) for (let i = o.length - 1; i >= 0; i--) { const id = this.origOnly(o[i], p); if (id) { this.deviation(id, `original-only '${o[i]}'`); o.splice(i, 1); } }
    if (this.portOnly) for (let i = p.length - 1; i >= 0; i--) { const id = this.portOnly(p[i], o); if (id) { this.deviation(id, `port-only '${p[i]}'`); p.splice(i, 1); } }
    // the same for calls only the ORIGINAL makes (`origOnly(line, portLines)` -> deviation id)
    if (this.origOnly) for (let i = o.length - 1; i >= 0; i--) { const id = this.origOnly(o[i], p); if (id) { this.deviation(id, `original-only '${o[i]}'`); o.splice(i, 1); } }
    if (this.soundKnown) for (let i = 0; i < o.length && i < p.length; i++) { const id = this.soundKnown(o[i], p[i]); if (id) { this.deviation(id, `original '${o[i]}' port '${p[i]}'`); p[i] = o[i]; } }
    const split = (l) => { let m = /^(p3 #\d+) (\S+)$/.exec(l); if (m) return [m[1], m[2].split(',').map(Number), 3e-4]; m = /^(r #\d+) (\d+)$/.exec(l); return m ? [m[1], [+m[2]], this.exactDefault && this.o.exact !== false ? 0 : 1] : [l, null, 0]; };
    this.checked++;
    if (o.length !== p.length) { this.fail(`${this.label} t${this.t} sound calls: original ${o.join(' | ')} port ${p.join(' | ')}`); return; }
    for (let i = 0; i < o.length; i++) {
      const [a, pa, ab] = split(o[i]), [b, pb] = split(p[i]);
      if (a !== b) { this.fail(`${this.label} t${this.t} sound call ${i}: original ${o[i]} port ${p[i]}`); continue; }
      if (pa) for (let k = 0; k < pa.length; k++) this.cmp(a, pa[k], pb[k], undefined, `[${k}]`, ab);
      // (exact mode: `cmp` compares positions bit for bit; the rate in whole Hz is an integer compare through the same path)
    }
  }
}

Duel.prototype.setVar = function (i, v) { this.emu.cpu.mem.w32(VAR_ARRAY + 4 * i, v); this.P.world.vars.set(i, v); };
Duel.prototype.getVar = function (i) { return this.P.world.vars.get(i) | 0; };
/** DAT_009daa80: the vehicle Pepper sits in / is getting into (both worlds) */
Duel.prototype.setCurrent = function (i) { this.emu.cpu.mem.w32(0x9daa80, i < 0 ? 0 : RECORDS_BASE + i * REC); vehicles(this.P.world).current = i < 0 ? null : this.P.world.records[i]; };

/** sync mode: copy the original's record state (matrix, Euler angles) into the port's record (the port keeps unwrapped angles in doubles, the original in float32: the free-running difference is float noise, not logic) */
Duel.prototype.recToPort = function (i) {
  const mem = this.emu.cpu.mem, a = RECORDS_BASE + i * REC, r = this.P.world.records[i];
  for (let k = 0; k < 16; k++) r.m[k] = mem.f32(a + 0xc + 4 * k);
  r.rx = mem.f32(a + 0x4c); r.ry = mem.f32(a + 0x50); r.rz = mem.f32(a + 0x54);
};

Duel.prototype.cameraToPort = function () { const mem = this.emu.cpu.mem, c = this.P.world.camera.c; for (let k = 0; k < 6; k++) c[k] = mem.f32(0x9da5e8 + 4 * k); };
/** copy the original's float fields of a node block into the port's node: `map` = { portField: [offset, type] } (type 'f' float32, 'i' int32) */
Duel.prototype.nodeToPort = function (pn, a, map) { const mem = this.emu.cpu.mem; for (const [f, [off, ty]] of Object.entries(map)) pn[f] = ty === 'f' ? mem.f32(a + off) : mem.r32(a + off); };

/** the port's node of a kind on a record, the original's node block of the same record (the constructor `ctor`) */
Duel.prototype.pnode = function (i, kind) { return this.P.world.records[i].ctrl?.nodes.find((n) => n.kind === kind); };
Duel.prototype.onode = function (i, ctor) { return this.emu.nodeOf.get(i)?.find((n) => n.ctor === ctor)?.ptr ?? 0; };
/** a tiny seeded generator (the scenarios' random buttons) */
export function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
/** random button scripts: each pick holds for 2..`maxHold` ticks; `pool` = [bits...] to choose from */
export function randomKeys(rnd, pool, maxHold = 14) {
  let cur = 0, left = 0;
  return () => { if (left-- <= 0) { cur = pool[Math.floor(rnd() * pool.length)]; left = 2 + Math.floor(rnd() * (maxHold - 1)); } return cur; };
}

/** Pepper's walk state / clip in both worlds (the mailbox DAT_008ae088 and the animation) */
Duel.prototype.setState = function (st, start = true) {
  this.emu.cpu.mem.w32(0x8ae088, st); this.P.world.pep.mailbox = st;
  if (start) { this.O.pepper.anim?.start(st, 0); this.P.pepper.anim?.start(st, 0); }
};
/** Space as the walk node handles it: both implementations (the port's `walkSpace`, the original's code), the next state compared, then applied */
Duel.prototype.space = function (state) {
  const nOrig = this.emu.walkSpace(state);
  const nPort = this.o.portSpace(this.P.world, this.P.pepper, state);
  this.eq('Space: next walk state', nOrig, nPort);
  if (nOrig) this.setState(nOrig);
  return nOrig;
};
/** a targetable record (controller flags 0x43: enabled, targetable) in both worlds */
Duel.prototype.makeTarget = function (i) {
  const r = this.P.world.records[i];
  r.ctrl = new Controller(); r.ctrl.flags = 0x43;
  this.emu.controller(i, 0x43);
};

/** a cutscene runs (FUN_0045c432 / the island context): both worlds */
Duel.prototype.cutscene = function (on) { this.emu.cutscene = on; this.P.ictx.held = on; };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the walk node's Space branch (FUN_0042d514, 0x42da7d .. 0x42dbed): the pizza throw glue, from the original's machine code (the walk node itself is M1's: its Space branch is what the pizza family hangs on)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const FBITS = new Float32Array(1), UBITS = new Uint32Array(FBITS.buffer);
export const bitsOf = (v) => { FBITS[0] = v; return UBITS[0]; };
/** Space pressed with the walk state `state` (DAT_008ae088 mirror): returns the next state (0 = unchanged); calls the prelude FUN_00427c15, the launch FUN_004277d0 / the hand-over FUN_00428a0a natively */
IslEmu.prototype.walkSpace = function (state) {
  const cpu = this.cpu, mem = cpu.mem;
  if (state === 1 || state === 0x1f || state === 0x57) return 0;
  cpu.steps = 0;
  const r = cpu.call(0x427c15, [this.recPtr(this.pep)], { maxSteps: 1_000_000 });
  let next = 0;
  if (r === 1) {
    const play = (addr) => cpu.call(0x4435a0, [mem.r32(addr)]);
    if (state === 8 || state === 0xd || state === 0x1b) { next = 0xb; play(0x9da960); cpu.call(0x4277d0, [bitsOf(14), bitsOf(42)], { maxSteps: 1_000_000 }); }
    else if (state === 0x24 || state === 0x3f || state === 0x40) { next = 0x42; play(0x9da984); cpu.call(0x4277d0, [bitsOf(4), bitsOf(10)], { maxSteps: 1_000_000 }); }
  } else if (r === 2) { next = 0xc; cpu.call(0x428a0a, [10, 0x28], { maxSteps: 1_000_000 }); }
  return next;
};

/**
 * Free-running sessions accumulate float32 (original, FPU at 24 bit) against double (port) noise of ~1e-5; a swept collision test that grazes a wall decides differently once in a while (one side crashes, the other
 * slides on): a discrete divergence that is float noise, not logic (the sync-mode sessions, which copy the original's continuous state into the port before every tick, check the logic strictly). `grazeBegin()` before a tick's
 * comparison, `grazeEnd(mark)` after: the FIRST tick with mismatches after a clean tick is taken back (counted in `grazes`, first one described) and the port is re-synced to the original's state for the next tick;
 * mismatches on the tick after a re-sync stay failures (a real difference persists).
 */
Duel.prototype.grazeBegin = function () { return { n: this.nfail, f: this.failures.length, w: new Map(this.worst) }; };
Duel.prototype.grazeEnd = function () { /* WP-ISLAND-FIX: no re-sync of float noise any more: every difference is a failure (the port is float32 per operation) */ };

