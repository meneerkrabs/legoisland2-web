// The particle engine (FX_Particle.c: FUN_0044e860 create / FUN_0044ec60 constructor, FUN_0044f710 / f7c0 start a source / swirl, FUN_0044f850 attach a matrix,
// FUN_0044f900 gate, FUN_0044f9e0 stop, FUN_0044fa00 collision list, FUN_0044fa30 parameter override, FUN_0044f090 extra source pool, FUN_0044f2c0 / f220 update)
// and the public `fx` hooks the zones call.
//
// Timing: `update(dt, frame)` is called once per logic frame with `dt` = DAT_008b1718 (1.0 at 30 Hz) and `frame` = DAT_009da5cc (the frame counter the script
// windows are measured on). Draw: see draw.ts.
import { initTables, msvcRand, PState, type RandFn } from './core.ts';
import { ParticleDefs, type ParticleFiles } from './defs.ts';
import { initSource, Source, updateSource, type CollNode, type EngineHost, type MatrixSource } from './source.ts';
import { matIdentity } from './mat.ts';
import type { Particle } from './pool.ts';
import type { Rec } from './core.ts';
import { initSwirl, Swirl, updateSwirl } from './swirl.ts';

/** the handle returned for a failed start (0xbabababa) */
export const NO_HANDLE = 0xbabababa;
/** swirl handles are `0x1000 + index` */
export const SWIRL_BASE = 0x1000;
const MAX_SOURCES = 150, MAX_SWIRLS = 150, MAX_DRAW = 0x1000, MAX_MODELS = 0x400;

/** the override slots of `setParam` (FUN_0044fa30: the types the original accepts) */
export const PARAM = { FORCE: 0, LIFE: 2, DLIFE: 3, SIZE: 4, ESIZE: 5, DENSITY: 8, DDENSITY: 9, INC_ANGLE: 10, EXC_ANGLE: 11, AIR: 12, DAIR: 13, BOUNCE: 16, DBOUNCE: 17 } as const;
const PARAM_TYPES = new Set<number>([0, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17]);

export interface EngineOptions {
  /** the C runtime `rand()` (0..32767): inject the shared game RNG (WP-TIME); default an MSVC LCG */
  rand?: RandFn;
  /** FUN_00417575: game variables (the gates of the sources, var 10 = pause) */
  getVar?: (i: number) => number;
  /** swept sphere query against the collision record of a `setCollision` list (FUN_00441b10) */
  collide?: EngineHost['collide'];
  /** the 'PCOL' record test of the collision response */
  isPcol?: EngineHost['isPcol'];
}

export class ParticleEngine implements EngineHost {
  readonly ps: PState;
  readonly defs: ParticleDefs;
  readonly clock = { frame: 0 };
  dt = 1;
  readonly identity = new Float32Array(16);
  /** DAT_05d3b0a0 (set by z27TRX through FUN_0076b070) and the camera position DAT_009da5e8..f0 */
  lod = false;
  readonly camera = new Float32Array(3);
  /** DAT_0089df2c: the camera zoom factor (FOV in radians, 1.0 default) and 1 / zoom */
  zoom = 1;
  invZoom = 1;
  /** FUN_00417575(10) != 0: paused (the sources keep their state, nothing is emitted or moved) */
  paused = false;
  /** see EngineHost.staleApp */
  staleApp: Rec | null = null;
  getVar: (i: number) => number;
  collide?: EngineHost['collide'];
  isPcol?: EngineHost['isPcol'];

  readonly sources: Source[] = [];
  readonly swirls: Swirl[] = [];
  /** the extra sources of the [SPLASH] sections (+8) and their free list (+0xc) */
  extras: Source[] = [];
  private extraFree: Source | null = null;
  /** the lists the draw pass sorts: sprites (+0x20, +0x14 entries) and model particles (+0x28, +0x18) */
  readonly drawList: Particle[] = [];
  readonly modelList: Particle[] = [];

  constructor(files: ParticleFiles, opts: EngineOptions = {}) {
    this.ps = new PState(opts.rand ?? msvcRand());
    initTables(this.ps);
    this.defs = new ParticleDefs(files);
    matIdentity(this.identity);
    this.getVar = opts.getVar ?? (() => 0);
    this.collide = opts.collide;
    this.isPcol = opts.isPcol;
    for (let i = 0; i < MAX_SOURCES; i++) this.sources.push(new Source());
    for (let i = 0; i < MAX_SWIRLS; i++) this.swirls.push(new Swirl());
  }

  // ---- EngineHost ---------------------------------------------------------------------------------------------------
  addDraw(p: Particle): void {
    if (p.app.i[0x5c >> 2] === 0) { if (this.drawList.length < MAX_DRAW) this.drawList.push(p); }
    else if (this.modelList.length < MAX_MODELS) this.modelList.push(p);
  }
  /** FUN_0044f1d0 */
  takeExtra(): Source | null {
    const s = this.extraFree;
    if (!s) return null;
    s.flag614 = 1; s.ended = false;
    this.extraFree = (s as Source & { freeNext?: Source | null }).freeNext ?? null;
    return s;
  }
  /** FUN_0044f1f0: pushes the source on the free list (the original does this for ANY ended source whose last particle died) */
  giveExtra(s: Source): void {
    (s as Source & { freeNext?: Source | null }).freeNext = this.extraFree;
    this.extraFree = s;
  }

  // ---- the API the game code uses ----------------------------------------------------------------------------------
  /** FUN_0044f710 (via FUN_0044e920): start the effect `name` (a `.par` by its first line, case-insensitive) at `pos` / `rot` (Euler angles) in the frame of `matrix`
   *  (null = world). The source only emits while `(getVar(var) & mask) == value`. Returns the handle (index) or NO_HANDLE. */
  start(name: string, matrix: MatrixSource | null, pos: ArrayLike<number>, rot: ArrayLike<number>, gateVar: number, gateMask: number, gateValue: number): number {
    for (let i = 0; i < MAX_SOURCES; i++) {
      const s = this.sources[i];
      if (s.active) continue;
      const script = this.defs.findPar(name);
      // (FUN_00454020 on the free slot: a fresh source object; the slot's old particle pools are dropped)
      const fresh = new Source();
      this.sources[i] = fresh;
      if (!initSource(fresh, script, matrix, pos, rot, this)) { this.sources[i] = s; return NO_HANDLE; }
      fresh.started = true;
      fresh.flag614 = 1;
      fresh.gateVar = gateVar; fresh.gateValue = gateValue << 16 >> 16; fresh.gateMask = gateMask << 16 >> 16;
      return i;
    }
    return NO_HANDLE;
  }
  /** FUN_0044f7c0 (via FUN_0044e990): start the swirl list `name` (`.swl`) */
  startSwirl(name: string, _matrix: MatrixSource | null, pos: ArrayLike<number>, rot: ArrayLike<number>, gateVar: number, gateMask: number, gateValue: number): number {
    for (let i = 0; i < MAX_SWIRLS; i++) {
      const s = this.swirls[i];
      if (s.active) continue;
      // (FUN_0044f7c0 does not use the matrix argument: the parent matrix of a swirl comes from `setMatrix`; it does not check that the list exists either)
      initSwirl(s, this.defs.findSwirl(name), pos, rot);
      s.started = true;
      s.gateVar = gateVar; s.gateValue = gateValue << 16 >> 16; s.gateMask = gateMask << 16 >> 16;
      return SWIRL_BASE + i;
    }
    return NO_HANDLE;
  }
  private valid(h: number): boolean {
    if (h === NO_HANDLE || h === 0xbabacaba) return false;
    if ((h & 0x1000) === 0x1000) return h - 0x1000 <= 0x95 && h >= 1;
    return h >= 0 && h <= 0x95;
  }
  /** FUN_0044ea00 / FUN_0044f850: attach `matrix` as the parent matrix of the source / swirl */
  setMatrix(h: number, matrix: MatrixSource): void {
    if (!this.valid(h)) return;
    if ((h & 0x1000) === 0x1000) { const w = this.swirls[h - SWIRL_BASE]; if (w.active && matrix) w.setMatrix(matrix, this.identity); return; }
    const s = this.sources[h];
    if (!s.active || !matrix) return;
    const m = typeof matrix === 'function' ? matrix() : matrix;
    s.prevWorld.set(m);
    s.matrixSrc = matrix;
    s.refreshWorld(this.identity);
  }
  /** FUN_0044ea60 / FUN_0044f900: change the gate. Enabling (value and mask non zero) with a DIFFERENT variable restarts the script. */
  setGate(h: number, gateVar: number, gateMask: number, gateValue: number): void {
    if (!this.valid(h)) return;
    const value = gateValue << 16 >> 16, mask = gateMask << 16 >> 16;
    if ((h & 0x1000) === 0x1000) {
      const w = this.swirls[h - SWIRL_BASE];
      if (w.active) { w.gateVar = gateVar; w.gateValue = value; w.gateMask = mask; }
      return;
    }
    const s = this.sources[h];
    if (!s.active) return;
    if (s.gateVar !== gateVar) {
      s.gateValue = value;
      if (value !== 0) { s.gateMask = mask; if (mask !== 0) s.mgr.resetFlag = true; }
    }
    s.gateVar = gateVar; s.gateValue = value; s.gateMask = mask;
  }
  /** FUN_0044eaf0 / FUN_0044f9e0: ask the script to restart (the manager's reset flag) */
  stop(h: number): void {
    if (!this.valid(h) || h >= SWIRL_BASE) return;
    this.sources[h].mgr.resetFlag = true;
  }
  /** FUN_0044eb50 / FUN_0044fa00 + FUN_00456a90: push a collision record on the source's list (the particles bounce off it) */
  setCollision(h: number, rec: unknown): void {
    if (!this.valid(h) || h >= SWIRL_BASE) return;
    const s = this.sources[h];
    const node: CollNode = { rec, next: s.coll };
    s.coll = node;
  }
  /** FUN_0044ebd0 / FUN_0044fa30: override an emitter parameter (`PARAM.*`) with `value` from now on (re-applied every tick) */
  setParam(h: number, type: number, value: number): void {
    if (!this.valid(h) || h >= SWIRL_BASE || !PARAM_TYPES.has(type)) return;
    const o = this.sources[h].override[type];
    o.flag = true;
    o.value = new Int32Array(new Float32Array([value]).buffer)[0];
  }
  /** FUN_0044f090 (FUN_0044e8d0): after the zone started its effects: allocate the extra sources for the [SPLASH] sections */
  finishSetup(): void {
    let total = 0;
    for (const s of this.sources) if (s.active && s.nSplash !== 0) total += s.poolSize * s.nSplash;
    if (total === 0) { this.extras = []; this.extraFree = null; return; }
    this.extras = [];
    for (let i = 0; i < total; i++) {
      const s = new Source();
      s.active = true; s.gateVar = 2; s.gateMask = 1; s.gateValue = 1;
      this.extras.push(s);
    }
    for (let i = 0; i < total - 1; i++) (this.extras[i] as Source & { freeNext?: Source | null }).freeNext = this.extras[i + 1];
    this.extraFree = this.extras[0];
  }

  // ---- per frame -----------------------------------------------------------------------------------------------------
  /** FUN_0044f2c0 (FUN_0044f220 while paused): advance every source by `dt` ticks at frame counter `frame`; fills `drawList` */
  update(dt: number, frame: number): void {
    this.dt = Math.fround(dt);                       // DAT_008b1718 is a float32 global
    this.clock.frame = frame;
    this.invZoom = 1.0 / this.zoom;
    this.drawList.length = 0; this.modelList.length = 0;
    if (this.paused) { this.repaint(); return; }
    for (const s of this.sources) if (s.active && s.started) updateSource(s, this);
    for (const w of this.swirls) if (w.started) updateSwirl(w, this);
    for (const s of this.extras) {
      if (!s.active) continue;
      if (s.mgr.resetFlag) s.mgr.restart();
      if (s.started) updateSource(s, this);
    }
  }
  /** FUN_0044f220: the paused frame: re-list the particles that exist */
  private repaint(): void {
    for (const s of this.sources) if (s.started) this.relist(s);
    for (const w of this.swirls) if (w.started) w.relist(this);
    for (const s of this.extras) if (s.started) this.relist(s);
  }
  /** FUN_004522b0 */
  private relist(s: Source): void {
    const b = s.cur;
    for (let p = b.startIter(); p; p = b.advance()) this.addDraw(p);
  }
  /** is the effect (handle) still alive: any live particle, or it keeps emitting */
  liveParticles(h: number): number {
    if (!this.valid(h) || h >= SWIRL_BASE) return 0;
    return this.sources[h].tmpl.count;
  }
}
