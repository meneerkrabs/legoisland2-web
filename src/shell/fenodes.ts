// Behaviour nodes of the front-end stage z60FRE (FUN_00471070 attaches them; Walk.c of the original), ported exactly from the decompile and the disassembly
// (the decompile hides the x87 parts: the asm of 0x4721f0 / 0x4728e2 / 0x472adb / 0x472d7d was read) and checked tick by tick against the original's code run in
// the x86 interpreter (tools/lib/fe-emu.mjs, tools/tests/m5-audit-fe-emu.mjs). Findings and what is not exact: docs/re/m5/audit-fe.md.
//
//   record 0 PEPP   ctor FUN_00472743, update FUN_004721f0  Pepper rides the skateboard (record 1 SKBD) back and forth, gags, outfit swaps, the shadow (record 45 SHAD)
//   record 8 BBT1   ctor FUN_004729f6, update FUN_004728e2  a stage figure frozen on the first frame of clip 0x74 (the original's countdown never changes, see FeFigureNode)
//   record 44 G002  ctor FUN_00472c45, update FUN_00472adb  the train that crosses the backdrop (its smoke `trainsmoke01` is on: FUN_0044e920 gate (2, 1, 1), matrix = the record's live matrix)
//   record 2 BRIK   ctor FUN_00472fd8, update FUN_00472d7d  the Brickster who pops up at three places (the same effect on bone 10, but its gate (1, 1, 1) is never changed: var 1 is always 0, it never emits)
//   records 35..41 BFS6..BFS0: FUN_004b2d44 = ButterflyNode of src/island/ambient (the island's code), attached by frontend.ts
// Save blocks (the front end writes SaveDef.lgo at its start: FUN_0041ad71 -> FUN_00418ec7(-2); docs/re/save.md): each class has `ctor` = the original constructor and the serializer / loader of its
// vtable (+0x14 / +0x10, both a plain memcpy of a field range of the node block: see each class).
// Field comments give the byte offset of the original's node block. `rand` is FUN_004388ae on the shared generator (src/game/crt.ts).
import type { BehaviourNode, Controller } from '../game/controller.ts';
import { NODE_CONTINUE, registerNode } from '../game/controller.ts';
import type { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { buildMatrix } from '../formats/matrix.ts';
import type { Pe } from '../formats/exe.ts';
import { mulGame } from '../render/math.ts';
import { randF } from '../game/crt.ts';
import { BlockIn, BlockOut } from '../island/blockio.ts';

/** FUN_004388ae(max): `(float)rand() / 32767.0f * max`, every operation a float32 (the x87 at 24 bit), 0 and no draw for max <= 0: the shared C runtime generator of src/game/crt.ts
 *  (tests inject a scripted rand() with `setRandSource` there) */
export const rand = randF;
const f32 = Math.fround;
const ftol = Math.trunc;
/** a float given as the hex immediate the original pushes */
const fh = (bits: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, bits); return d.getFloat32(0); };

/** record indices of the stage (FUN_00471070: the offsets 0x340 / 0xd0 / 0x11e0 / 0x10a8.. divided by 0x68) */
export const FE_REC = { PEPPER: 0, SKATE: 1, BRICKSTER: 2, FIRST_OUTFIT: 3, FIGURE: 8, SUPE: 19, DARR: 21, BUTTERFLY_FIRST: 35, BUTTERFLY_LAST: 41, TRAIN: 44, SHADOW: 45 } as const;

/** the executable's tables (read at run time): gag table 0x8c9198 {Pepper clip, skateboard clip, frames} x 10 and the 18 outfit records at 0x8c9150 */
export const GAG_TABLE_VA = 0x8c9198, OUTFIT_TABLE_VA = 0x8c9150;
export interface FeTables {
  /** the word `n` of gag row `row` (the original indexes the table with the raw gag number, -1 reads the word in front of it) */
  word(row: number, n: number): number;
  outfits: number[];
}
export function feTables(pe: Pe): FeTables {
  const outfits: number[] = [];
  for (let i = 0; i < 18; i++) outfits.push(pe.u32(OUTFIT_TABLE_VA + 4 * i) | 0);
  return { word: (row, n) => pe.u32(GAG_TABLE_VA + 12 * row + 4 * n) | 0, outfits };
}

/**
 * the particle emitter calls of the nodes (FX_Particles): `start` = FUN_0044e920(name, matrix, pos, rot, var, mask, value), `setMatrix` = FUN_0044ea00(handle, matrix). A matrix is
 * what the original passes: a record's live matrix (`rec + 0xc`) or a stack local of the call (the Brickster's `local_48`: a copy that the engine keeps the ADDRESS of; see FeBricksterNode).
 */
export interface FeFx {
  start(name: string, matrix: (() => Float32Array) | Float32Array | null, pos: readonly number[], rot: readonly number[], gate: readonly [number, number, number]): number;
  setMatrix(handle: number, matrix: (() => Float32Array) | Float32Array): void;
}
/** FUN_0044e920's result when the engine could not start the effect (0xbabababa as an int32: the nodes compare it) */
export const FX_NONE = -0x45454546;

/** the services the nodes use besides the world: the particle engine (src/fx/particles/zone.ts through `feFx` of frontend.ts) and the model swap of the renderer */
export interface FeEnv {
  tables: FeTables;
  fx?: FeFx;
  /** the record's model pointer changed (GameRenderer.setModel) */
  swapModel?(rec: GameRecord): void;
}

/** FUN_0043ad29(matrix, angle): turn the matrix about its y axis (rows 0 and 2 mix), float32 like the original */
export function rotateY(m: Float32Array, angle: number) {
  const c = f32(Math.cos(angle)), s = f32(Math.sin(angle));
  const a0 = m[0], a4 = m[4], a8 = m[8];
  m[0] = s * m[2] + c * m[0];
  m[4] = s * m[6] + c * m[4];
  m[8] = s * m[10] + c * m[8];
  m[2] = c * m[2] + -s * a0;
  m[6] = c * m[6] + -s * a4;
  m[10] = c * m[10] + -s * a8;
}
/** FUN_0043a742 / FUN_0043a5e4 on a record's matrix (euler x / y / z, position, uniform scale) */
const place = (rec: GameRecord, rx: number, ry: number, rz: number, x: number, y: number, z: number, k = 1) => {
  rec.m.set(buildMatrix(rx, ry, rz, x, y, z, k, k, k));
  rec.scale = [k, k, k];
};

// ================================================================================================ record 0: Pepper on the skateboard

export class FePepperNode implements BehaviourNode {
  readonly kind = 'FEPepper';
  ctor = 0x472743;
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  speed = f32(fh(0x3e4ccccd));   // +0x14 (float32): units per tick
  half = fh(0x42200000);         // +0x18 = 40: the crossing runs from -half to +half
  duration = 399;                // +0x1c: ticks of a crossing, ftol(10 / (rand(0.045) + 0.045))
  model: GameRecord['model'] = null;   // +0x20: Pepper's own model (the default outfit)
  flag = 0;                      // +0x24 (always 0: the skateboard follows Pepper's matrix)
  dir = 0;                       // +0x28: 0 = left to right (z 4.8), 1 = back (z 8)
  counter = 0;                   // +0x2c: ftol(timer)
  timer = 0;                     // +0x30 (float32)
  gag = -1;                      // +0x34
  gagLeft = 0;                   // +0x38: frames of the gag clip that are left (ftol(length - frame)), 0 = no gag
  readonly env: FeEnv;
  private inited = false;
  constructor(env: FeEnv) { this.env = env; }

  /** FUN_00472743 (the constructor; the port attaches by name, so it runs at the first update) */
  init(w: World, rec: GameRecord) {
    this.inited = true;
    const recs = w.records, t = this.env.tables;
    rec.anim?.start(t.word(0, 0), 0);            // FUN_0043b6a3(anim, 0x29, 0): the ride clip
    recs[FE_REC.SKATE].anim?.start(2, 0);        // the skateboard's clip 2 until the first crossing starts clip 3
    rotateY(rec.m, fh(0x3fc90fdb));              // FUN_0043ad29(matrix, pi / 2)
    this.half = fh(0x42200000); this.duration = 399; this.speed = f32(fh(0x3e4ccccd));
    this.flag = 0; this.dir = 0; this.counter = 0; this.timer = 0; this.gag = -1; this.gagLeft = 0;
    this.model = rec.model;
    for (const i of t.outfits) { const o = recs[i]; if (o) o.flags = 0; }   // the outfit records are hidden (flags := 0); FUN_00444550 / FUN_004446c0 only set part render attributes
  }

  /**
   * Save block = node +0x24 .. +0x3c (saver FUN_004726fd returns 0x18 and points at node + 0x24, loader FUN_0047271b = 0x18 byte memcpy back): i32 flag (+0x24), i32 dir, i32 counter, f32 timer,
   * i32 gag, i32 gagLeft. (The crossing's speed / duration / half-width and the model are not in the file: a load keeps the running crossing's own.)
   */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    if (!this.inited) this.init(w, rec);
    return new BlockOut(0x18).i32(0, this.flag).i32(4, this.dir).i32(8, this.counter).f32(0xc, this.timer).i32(0x10, this.gag).i32(0x14, this.gagLeft).bytes;
  }
  loadBlock(w: World, rec: GameRecord, _c: Controller, data: Uint8Array): void {
    if (!this.inited) this.init(w, rec);
    const b = new BlockIn(data);
    this.flag = b.i32(0); this.dir = b.i32(4); this.counter = b.i32(8); this.timer = b.f32(0xc); this.gag = b.i32(0x10); this.gagLeft = b.i32(0x14);
  }

  /** FUN_004721f0 */
  update(w: World, rec: GameRecord, _c: Controller): number {
    if (!this.inited) this.init(w, rec);
    const recs = w.records, t = this.env.tables, pa = rec.anim, sa = recs[FE_REC.SKATE].anim, dt = w.dt;
    const fin = pa ? pa.advance(1, dt) : 0;
    sa?.advance(1, dt);
    if (fin !== 0) {
      if (this.gag === -1) {
        if (rand(1) < fh(0x3e99999a)) {
          this.gag = ftol(rand(10));
          if (this.gag === 8) this.gag = ftol(rand(10));
          if (rec.model === recs[FE_REC.SUPE].model && rand(1) < fh(0x3f666666)) this.gag = 8;
          if (rec.model === recs[FE_REC.DARR].model && rand(1) < fh(0x3f19999a)) this.gag = 5;
        }
      } else this.gag = 0;
      if (this.gag < 0) this.gagLeft = 0;
      else {
        pa?.start(t.word(this.gag, 0), 0);
        sa?.start(t.word(this.gag, 1), 0);
        this.gagLeft = t.word(this.gag, 2);
      }
    }
    if (this.counter === 0) {
      this.timer = 0;
      this.flag = 0;
      const r = f32(rand(fh(0x3d3851ec)) + fh(0x3d3851ec));       // fstp float [ebp - 4]
      this.gag = -1;
      pa?.start(t.word(0, 0), 0);
      sa?.start(t.word(0, 1), 0);
      this.duration = ftol(f32(10 / r));
      this.speed = f32(r * 8);
      if (rand(1) >= fh(0x3f666666)) rec.model = this.model;
      else rec.model = recs[t.outfits[ftol(rand(18))]]?.model ?? rec.model;   // the pointer of the outfit record's model
      this.env.swapModel?.(rec);
    }
    if (this.gag !== 5) { this.timer = f32(1 * dt + this.timer); this.counter = ftol(this.timer); }
    let bounce = 0;
    if (this.gagLeft >= 1) {
      const len = t.word(this.gag, 2);
      this.gagLeft = ftol(f32(len - (pa ? pa.frame : 0)));
      bounce = this.gagLeft > ((len / 2) | 0) ? f32(((len - this.gagLeft) * 8) / len) : f32((this.gagLeft * 8) / len);
    }
    const m = rec.m;
    if (this.dir === 0) {
      m[12] = f32(-this.half + f32(this.counter * this.speed));   // 24-bit x87: the product rounds before the sum
      m[13] = f32(fh(0x404ccccd) + bounce);
      m[14] = fh(0x4099999a);
      if (this.counter > this.duration) { this.counter = 0; this.dir = 1; rotateY(m, fh(0x40490fdb)); }
    } else {
      m[12] = f32(this.half - f32(this.counter * this.speed));
      m[13] = f32(0 + bounce);
      m[14] = 8;
      if (this.counter > this.duration) { this.counter = 0; this.dir = 0; rotateY(m, fh(0x40490fdb)); }
    }
    if (this.flag === 0) recs[FE_REC.SKATE].m.set(m);          // FUN_0043b00b(record 1 + 0xc, matrix): the skateboard takes Pepper's matrix
    const sh = recs[FE_REC.SHADOW];
    if (sh) { sh.m[12] = m[12]; sh.m[13] = f32(m[13] - bounce); sh.m[14] = m[14]; }
    return NODE_CONTINUE;
  }
}

// ================================================================================================ record 8: the figure that never moves

/**
 * FUN_004729f6 / FUN_004728e2. The constructor starts clip 0x74 at frame 0, places the record at (-5.4, 8, 51.2) turned by 0.2625 and draws `+0x1c = ftol(rand(300) + 300)` (the
 * decompile drops the `+ 300`). The update counts `+0x1c` down by one and then, in the same call, overwrites it with `ftol(+0x18)`, where `+0x18` is the float copy of the
 * constructor's value and never changes: the count stays at its first value (300 .. 599) forever, so the `else` branch (advance the clip, redraw 300 .. 599) never runs and the
 * figure stands on the first frame of clip 0x74 for ever. Ported as it is.
 */
export class FeFigureNode implements BehaviourNode {
  readonly kind = 'FEFigure';
  ctor = 0x4729f6;
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  fl = 0;      // +0x18 (float32)
  cnt = 0;     // +0x1c
  private inited = false;
  readonly env: FeEnv;
  constructor(env: FeEnv) { this.env = env; }
  init(_w: World, rec: GameRecord) {
    this.inited = true;
    rec.anim?.start(0x74, 0);
    place(rec, 0, fh(0x3e860a63), 0, fh(0xc0accccd), 8, fh(0x424ccccd));   // FUN_0043a5e4(rec + 0xc, 0, 0.2625, 0, -5.4, 8, 51.2)
    this.cnt = ftol(f32(rand(300) + 300));
    this.fl = this.cnt;
  }
  /** Save block = node +0x18 .. +0x20 (saver FUN_004729b0 returns 8 and points at node + 0x18, loader FUN_004729ce = 8 byte memcpy back): f32 fl (+0x18), i32 cnt (+0x1c) */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    if (!this.inited) this.init(w, rec);
    return new BlockOut(8).f32(0, this.fl).i32(4, this.cnt).bytes;
  }
  loadBlock(w: World, rec: GameRecord, _c: Controller, data: Uint8Array): void {
    if (!this.inited) this.init(w, rec);
    const b = new BlockIn(data);
    this.fl = b.f32(0); this.cnt = b.i32(4);
  }
  update(w: World, rec: GameRecord, _c: Controller): number {
    if (!this.inited) this.init(w, rec);
    if (this.cnt > 0) {
      this.cnt = ftol(f32(this.cnt - f32(1 * w.dt)));
      this.cnt = ftol(this.fl);
    } else if ((rec.anim ? rec.anim.advance(1, w.dt) : 0) !== 0) {
      this.cnt = ftol(f32(rand(300) + 300));
      this.fl = this.cnt;
    }
    return NODE_CONTINUE;
  }
}

// ================================================================================================ record 44: the train

/** FUN_00472c45 / FUN_00472adb: the record (scale 0.4) waits at x = 64 for 300 ticks, then rides from x = -64 to 64 in 180 ticks, then waits 750 ticks, and so on */
export class FeTrainNode implements BehaviourNode {
  readonly kind = 'FETrain';
  ctor = 0x472c45;
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  fl = 300;       // +0x18 (float32)
  cnt = 300;      // +0x1c
  phase = 0;      // +0x20 (0 waits, 1 rides)
  fx = FX_NONE;   // +0x14: the smoke emitter's handle
  private inited = false;
  readonly env: FeEnv;
  constructor(env: FeEnv) { this.env = env; }
  init(_w: World, rec: GameRecord) {
    this.inited = true;
    place(rec, fh(0x3f060a63), 0, 0, 64, fh(0x4209999a), -4, fh(0x3ecccccd));   // FUN_0043a742(rec + 0xc, 0.5236, 0, 0, 64, 34.4, -4, 0.4 x3)
    this.phase = 0; this.cnt = 300; this.fl = 300;
    // FUN_0044e920("trainsmoke01.par", rec + 0xc, 10, 12, 0, -pi/2, 0, 0, var 2, mask 1, value 1): ON, on the record's live matrix; FUN_0044ea00 twice (the second call makes the emitter's previous matrix the current one)
    const fx = this.env.fx;
    this.fx = fx ? fx.start('trainsmoke01.par', () => rec.m as Float32Array, [fh(0x41200000), fh(0x41400000), 0], [fh(0xbfc90fdb), 0, 0], [2, 1, 1]) : FX_NONE;
    fx?.setMatrix(this.fx, () => rec.m as Float32Array); fx?.setMatrix(this.fx, () => rec.m as Float32Array);
  }
  /** Save block = node +0x18 .. +0x24 (saver FUN_00472bff returns 0xc and points at node + 0x18, loader FUN_00472c1d = 12 byte memcpy back): f32 fl (+0x18), i32 cnt (+0x1c), i32 phase (+0x20) */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    if (!this.inited) this.init(w, rec);
    return new BlockOut(0xc).f32(0, this.fl).i32(4, this.cnt).i32(8, this.phase).bytes;
  }
  loadBlock(w: World, rec: GameRecord, _c: Controller, data: Uint8Array): void {
    if (!this.inited) this.init(w, rec);
    const b = new BlockIn(data);
    this.fl = b.f32(0); this.cnt = b.i32(4); this.phase = b.i32(8);
  }
  update(w: World, rec: GameRecord, _c: Controller): number {
    if (!this.inited) this.init(w, rec);
    if (this.phase === 0) {
      this.fl = f32(this.fl - 1 * w.dt);
      this.cnt = ftol(this.fl);
      if (this.cnt === 0) { this.cnt = 180; this.fl = 180; this.phase = 1; }
    } else {
      rec.m[12] = f32(f32(8 - f32(f32(this.cnt * 16) / 180)) * 8);   // 24-bit x87: every operation rounds
      this.fl = f32(this.fl - 1 * w.dt);
      this.cnt = ftol(this.fl);
      if (this.cnt === 0) { this.cnt = 750; this.fl = 750; this.phase = 0; }
    }
    return NODE_CONTINUE;
  }
}

// ================================================================================================ record 2: the Brickster

/** the three poses (DAT_05d57eb0 + n * 0x48, built by the constructor): FUN_0043a5e4 args, clip */
const BRICK_POSES: { e: [number, number, number]; p: [number, number, number]; clip: number }[] = [
  { e: [0, fh(0x3e860a63), 0], p: [fh(0xc0accccd), 8, fh(0x424ccccd)], clip: 0x74 },
  { e: [0, 0, 0], p: [fh(0xc0400000), fh(0x41380000), 50], clip: 0x7f },
  { e: [0, 0, fh(0xbe860a63)], p: [fh(0x40933333), fh(0x40d9999a), 50], clip: 0x7d },
];

/**
 * FUN_00472fd8 / FUN_00472d7d. Hidden (flags 0) while counting down ftol(rand(300) + 300) ticks; then it shows (flags 2) at pose `sel` (1 .. 3 from the constructor's draw, afterwards 0 .. 3; the table has three rows: pose 3 reads the memory behind it, see audit-fe.md)
 * and plays the pose's clip once at rate 1; when the clip ends it hides again, picks pose 1 or 2 (5 % pose 0) and waits 300 .. 600 ticks.
 */
export class FeBricksterNode implements BehaviourNode {
  readonly kind = 'FEBrickster';
  ctor = 0x472fd8;
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  fl = 0;       // +0x18 (float32)
  cnt = 0;      // +0x1c
  sel = 0;      // +0x20
  fx = FX_NONE; // +0x14: the emitter's handle
  private inited = false;
  readonly env: FeEnv;
  constructor(env: FeEnv) { this.env = env; }
  init(_w: World, rec: GameRecord) {
    this.inited = true;
    rec.flags = 0;
    this.cnt = ftol(f32(rand(300) + 300));
    this.fl = this.cnt;
    this.sel = ftol(f32(rand(2) + 1));
    // FUN_0044e920("trainsmoke01.par", rec + 0xc, 0, -5, 0, -pi/2, 0, 0, var 1, mask 1, value 1): the gate (1, 1, 1) is OFF for good (var 1 always reads 0 and nothing of the node
    // changes the gate, no SetGate in the .par): the emitter never emits. Then bone 10's world matrix `local_48 = FUN_0043a9e5(local_48, rec + 0xc, FUN_0043bc58(anim, 10))` is handed
    // to FUN_0044ea00 twice (here and every tick of the clip in the update): the engine keeps the ADDRESS of that stack local, which is dead after the call, so what it reads later is
    // whatever the stack holds; with the gate off nothing it reads is ever used (tools/tests/m5-audit-fe-particles.mjs runs the original engine with garbage there: no particle, ever).
    const fx = this.env.fx;
    this.fx = fx ? fx.start('trainsmoke01.par', () => rec.m as Float32Array, [0, fh(0xc0a00000), 0], [fh(0xbfc90fdb), 0, 0], [1, 1, 1]) : FX_NONE;
    if (fx) { this.follow(rec); fx.setMatrix(this.fx, this.local); fx.setMatrix(this.fx, this.local); }
  }
  /** the stack local of the original's calls (one buffer per node: the engine reads it where the original reads dead stack) */
  readonly local = new Float32Array(16);
  /** `local_48 = FUN_0043a9e5(local_48, rec + 0xc, FUN_0043bc58(*(rec + 8), 10))` */
  /** FUN_0043bc58(model, 10) + FUN_0043a9e5(local, record matrix, bone): the bone in world space, 24-bit x87 (`mulGame`); without a pose the record's own matrix */
  private follow(rec: GameRecord) {
    const p = rec.anim?.pose(1);
    if (!p || p.length < 176) this.local.set(rec.m); else mulGame(p.subarray(160, 176), rec.m, this.local);
  }
  /** Save block = node +0x18 .. +0x24 (saver FUN_00472f92 returns 0xc and points at node + 0x18, loader FUN_00472fb0 = 12 byte memcpy back): f32 fl (+0x18), i32 cnt (+0x1c), i32 sel (+0x20) */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    if (!this.inited) this.init(w, rec);
    return new BlockOut(0xc).f32(0, this.fl).i32(4, this.cnt).i32(8, this.sel).bytes;
  }
  loadBlock(w: World, rec: GameRecord, _c: Controller, data: Uint8Array): void {
    if (!this.inited) this.init(w, rec);
    const b = new BlockIn(data);
    this.fl = b.f32(0); this.cnt = b.i32(4); this.sel = b.i32(8);
  }
  update(w: World, rec: GameRecord, _c: Controller): number {
    if (!this.inited) this.init(w, rec);
    if (this.cnt <= 0) {
      const fin = rec.anim ? rec.anim.advance(1, w.dt) : 0;    // the rate of the pose is 1.0 (the constructor writes 0x3f800000 into every row)
      if (fin !== 0) {
        rec.flags = 0;
        this.sel = rand(1) <= fh(0x3f733333) ? ftol(f32(rand(2) + 1)) : 0;
        this.cnt = ftol(f32(rand(300) + 300));
        this.fl = this.cnt;
      } else if (this.fx !== FX_NONE && this.env.fx) { this.follow(rec); this.env.fx.setMatrix(this.fx, this.local); }
    } else {
      this.fl = f32(this.fl - 1 * w.dt);
      this.cnt = ftol(this.fl);
      if (this.cnt === 0) {
        this.fl = this.cnt;
        rec.flags = 2;
        const p = BRICK_POSES[this.sel] ?? BRICK_POSES[0];
        rec.m.set(buildMatrix(p.e[0], p.e[1], p.e[2], p.p[0], p.p[1], p.p[2]));
        rec.anim?.start(p.clip, 0);
        if (this.sel === 1) rec.m[12] = f32(rand(6) + rec.m[12]);
        if (this.sel === 2) rec.m[13] = f32(rand(4) + rec.m[13]);
      }
    }
    return NODE_CONTINUE;
  }
}

registerNode('FEPepper', (a) => new FePepperNode(a as unknown as FeEnv));
registerNode('FEFigure', (a) => new FeFigureNode(a as unknown as FeEnv));
registerNode('FETrain', (a) => new FeTrainNode(a as unknown as FeEnv));
registerNode('FEBrickster', (a) => new FeBricksterNode(a as unknown as FeEnv));
