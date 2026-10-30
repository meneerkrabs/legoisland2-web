// building.c (Common\Z02LGI\c_src): the island's buildings (WP4, docs/re/m4/wp4-triggers.md).
//
//   FUN_00535e80  ctor, door (a mesh sub-object that swings open when Pepper comes near / presses the action button; exit doors write var 5),
//                 vtable 0x8eac58: update FUN_0053594e, (1) FUN_00535dcc, destroy FUN_00536226, draw FUN_00535de6 (default draw)
//   FUN_005364a5  ctor, swinging / spinning sub-object (radar dish, flags, rotors ...), vtable 0x8eac70: update FUN_00536256
//   FUN_00535281  ctor, Constructopedia page (PAG1-4), vtable 0x8eac20: update FUN_00534d98 (pickup, then the page cutscene)
//   FUN_005357cb  ctor, the music house HSE2 (bounces to its music), vtable 0x8eac40: update FUN_00535485, draw FUN_00535550
//   FUN_00533d30  the props that follow a building's visibility (RESQ -> SPBT, POLB -> its vehicles and the jail ...)
//   FUN_005358fc  clamp helper: move an angle towards a limit, report the next state when it got there
//   FUN_00534b89  ctor, the "pop in" node of the era 2 / 3 buildings (SKTP, GRGE, SHP2, PIZB, HSE2; vtable 0x8eac08: update FUN_005341f4, pre-render FUN_00534409, draw FUN_00534918, loader FUN_00534ae0,
//                 saver FUN_00534a0a): a scale / spin animation of the building record. Its constructor gates the node with var 1 & 0 == 1, which never holds (var 1 reads 0), and nothing in the executable re-gates
//                 it: the node never runs in the shipped game (docs/re/m4/wp4-triggers.md). Ported as `PopInNode` with its state, its save block and its update / pre-render code (checked in a duel with the
//                 gate forced open, tools/tests/m8-save-popin.mjs); the draw hook FUN_00534918 is not ported (see the class).
import { NODE_NONE, NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { ad, sb, ml, sq, fr } from '../../zones/common/f32.ts';
import { normalise3, toWorld } from '../../zones/exact.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView, recIndexOfPtr, EMU_RECORD_STRIDE, EMU_RECORDS_BASE } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { FX_NONE, GATE_OFF, GATE_ON, HALF_PI, fxGate, fxMatrix, fxStart, recMatrix, registerFxStart } from '../emitters.ts';
import { partCount, partMatrix, setRotation } from './parts.ts';
import { BlockIn, BlockOut, CD, CD16, CDF, recordTag } from '../blockio.ts';
import { VAR_INTERACT_ICONS, VAR_NEXT_ZONE, VAR_PEPPER_CONTROL } from './startcsm.ts';

export const CTOR_DOOR = 0x535e80, CTOR_SWING = 0x5364a5, CTOR_PAGE = 0x535281, CTOR_MUSIC_HOUSE = 0x5357cb, CTOR_POPIN_DEAD = 0x534b89;

const f32 = (bits: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, bits >>> 0, true); return d.getFloat32(0, true); };

// ----------------------------------------------------------------------------- props (FUN_00533d30)

/** FUN_00533d30: (record field offset of the building, record +0x60 offsets of the props that take its visibility). Byte offsets into the record array as in the decompile. */
const PROP_OFFSETS: [number, number[]][] = [
  [0x2f20, [0x4298]],                                          // RESQ -> SPBT
  [0x3128, [0x46a8, 0x4368, 0x31f0, 0x9850, 0x99f0, 0x9a58]],  // POLB -> PCAR / PHEL / JAIL / FECL x3
  [0x2eb8, [0x2e48, 0x2eb0, 0x3f58]],                          // TOWE -> CTRL, PLAT, SHTL
  [0x3468, [0x43d0]],                                          // HOSP -> AMBU
  [0x31f8, [0x2de0]],                                          // PIZB -> PIZC
  [0x3538, [0x9988, 0x9920, 0x9920]],                          // GRGE -> GAR1 / GAR2
];
/** building record index -> prop record indices */
export const BUILDING_PROPS: ReadonlyMap<number, number[]> = new Map(PROP_OFFSETS.map(([b, ps]) => [b / EMU_RECORD_STRIDE, ps.map((p) => (p - 0x60) / EMU_RECORD_STRIDE)]));

/** FUN_00533d30(rec): the props of a building follow its visibility (record flag 2) */
export function syncProps(w: World, building: GameRecord) {
  const ps = BUILDING_PROPS.get(building.index);
  if (!ps) return;
  for (const i of ps) { const r = w.records[i]; if (!r) continue; if (building.enabled) r.show(); else r.hide(); }
}

/** FUN_005358fc(&v, step, limit, ret): clamp v to the limit in the step's direction; ret when it got there, -1 otherwise */
export function clampTo(v: { angle: number }, step: number, limit: number, ret: number): number {   // (every value a float)
  if (0 <= step) { if (limit < v.angle) { v.angle = limit; return ret; } }
  else if (v.angle < limit) { v.angle = limit; return ret; }
  return -1;
}

// ----------------------------------------------------------------------------- doors (FUN_00535e80 / FUN_0053594e)

/** 0x8925ac: the door point lies 1.22 x the sub-object's right / forward axis away from its pivot */
export const DOOR_AXIS_OFFSET = 1.2200000286102295;
/** node +0x14: radius 6 (no exit) / 12 (exit door), squared */
export const DOOR_RADIUS = 6, DOOR_RADIUS_EXIT = 12;
/** DAT_05d586b0 = 16 (written by the ctor): Pepper is pushed away from an opening / closing door within sqrt(16) */
export const DOOR_PUSH_R2 = 16;
/** DAT_05d586ac = 0x408a71de (written by the ctor): squared distance at which an exit door writes var 5 */
export const DOOR_EXIT_R2 = f32(0x408a71de);
/** 0x892080: the door ignores Pepper more than 4 units above / below the door point */
export const DOOR_DY = 4;
/** 0x8920cc: push speed (units per tick) */
export const DOOR_PUSH = 0.10000000149011612;
/** action button (Shift) */
export const BTN_ACTION = 0x40;

export interface DoorArgs {
  /** +0x00 (node +0x2c = -arg): opening speed, radians per tick */
  rate: number;
  /** +0x04 (node +0x34): sub-object (MATL index) of the record's mesh */
  part: number;
  /** +0x08 (node +0x30 = closed - arg): opening angle */
  angle: number;
  /** +0x0c (node +0x36): 1 = stays open; 0x100 / 0x200 = door point along -/+ right axis, 0x400 / 0x800 along -/+ forward (0x300 / 0xc00 bits) */
  flags: number;
  /** +0x10 (node +0x38): zone written to var 5 at the threshold, -1 = an ordinary door (opens with the action button) */
  exit: number;
}
export const decodeDoor = (a: ArgView): DoorArgs => ({ rate: -a.f32(0), part: a.i32(4), angle: a.f32(8), flags: a.u32(0x0c) & 0xffff, exit: a.i32(0x10) });

export const DOOR_CLOSED = 0, DOOR_OPENING = 1, DOOR_OPEN = 2, DOOR_CLOSING = 3;

export class DoorNode implements BehaviourNode {
  readonly kind = 'building.door';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly a: DoorArgs;
  private init = false;
  /** the constructor found no such sub-object (*node = 1: the gate reads var 1 and the node never runs) */
  dead = false;
  /** node +0x14 / +0x18 */
  r2 = 0; r2big = 0;
  /** node +0x1c..0x24: the door point in the record's frame */
  off: [number, number, number] = [0, 0, 0];
  /** node +0x28 closed angle, +0x30 open angle */
  closed = 0; open = 0;
  /** node +0x3c */
  state = DOOR_CLOSED;
  /** node +0x40: current angle */
  angle = 0;
  constructor(a: DoorArgs) { this.a = a; }

  /** the constructor's mesh work (FUN_00535e80 runs it at construction; the port runs it before the first update, the first save or the first load: whichever comes first) */
  ensureInit(w: World, rec: GameRecord) { if (!this.init) this.setup(w, rec); }
  ctorInit(w: World, rec: GameRecord) { this.ensureInit(w, rec); }
  /** Save block = node +0x3c .. +0x44 (saver FUN_00535e22 returns 8 and points at node + 0x3c, loader FUN_00535e47 is the 8 byte memcpy back): +0 i32 state (0 closed, 1 opening, 2 open, 3 closing), +4 f32 current angle (0 when the sub-object does not exist) */
  saveBlock(w: World, rec: GameRecord): Uint8Array { this.ensureInit(w, rec); return new BlockOut(8).i32(0, this.state).f32(4, this.angle).bytes; }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.ensureInit(w, rec);
    const b = new BlockIn(data);
    this.state = b.i32(0); this.angle = b.f32(4);
  }

  /** FUN_00535e80 (deferred to the first update: it needs the mesh) */
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    const a = this.a, r = a.exit < 0 ? DOOR_RADIUS : DOOR_RADIUS_EXIT;
    const m = a.part < partCount(w, rec) ? partMatrix(w, rec, a.part) : null;
    if (!m) { this.dead = true; return; }
    const o: [number, number, number] = [m[12], m[13], m[14]];
    if ((a.flags & 0x300) !== 0) {
      const s = (a.flags & 0x100) !== 0 ? -DOOR_AXIS_OFFSET : DOOR_AXIS_OFFSET;
      const k = [ml(m[0], DOOR_AXIS_OFFSET), ml(m[1], DOOR_AXIS_OFFSET), ml(m[2], DOOR_AXIS_OFFSET)];
      if (s < 0) { o[0] = sb(o[0], k[0]); o[1] = sb(o[1], k[1]); o[2] = sb(o[2], k[2]); } else { o[0] = ad(k[0], o[0]); o[1] = ad(k[1], o[1]); o[2] = ad(k[2], o[2]); }
    } else if ((a.flags & 0xc00) !== 0) {
      const s = (a.flags & 0x400) !== 0 ? -DOOR_AXIS_OFFSET : DOOR_AXIS_OFFSET;
      const k = [ml(m[8], DOOR_AXIS_OFFSET), ml(m[9], DOOR_AXIS_OFFSET), ml(m[10], DOOR_AXIS_OFFSET)];
      if (s < 0) { o[0] = sb(o[0], k[0]); o[1] = sb(o[1], k[1]); o[2] = sb(o[2], k[2]); } else { o[0] = ad(k[0], o[0]); o[1] = ad(k[1], o[1]); o[2] = ad(k[2], o[2]); }
    }
    this.off = o;
    const big = ad(sq(ad(ad(ml(o[0], o[0]), ml(o[1], o[1])), ml(o[2], o[2]))), r);
    this.r2big = ml(big, big);
    this.r2 = ml(r, r);
    this.closed = fr(Math.atan2(m[8], m[10]));
    this.open = sb(this.closed, a.angle);
    this.angle = this.closed;
    setRotation(m, 0, this.angle, 0);
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    if (this.dead) return NODE_NONE;
    const a = this.a, V = w.vars, c = tryCtx(w), pep = w.focus;
    if (!pep || c?.cutsceneActive() || !rec.enabled) return NODE_NONE;
    if (!(this.state !== DOOR_CLOSED || a.exit >= 0 || ((w.input.pressed & BTN_ACTION) !== 0 && (V.get(VAR_PEPPER_CONTROL) & 5) !== 0))) return NODE_NONE;
    const dt = fr(w.dt);
    const p = toWorld(rec.m, this.off);
    let dx = sb(pep.x, p[0]), dy = sb(pep.y, p[1]), dz = sb(pep.z, p[2]);
    if (Math.abs(dy) > DOOR_DY) return NODE_NONE;
    dy = 0;
    const d2 = ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz));
    if (d2 < this.r2 && a.exit >= 0) V.or(VAR_INTERACT_ICONS, 0x20);
    let res = -1, toggle = false;
    const push = () => {
      if (d2 <= DOOR_PUSH_R2 && a.exit < 0) {
        const n = [dx, dy, dz];
        normalise3(n);   // FUN_0043cec0
        const k = ml(DOOR_PUSH, dt);
        pep.x = ad(ml(k, n[0]), pep.x); pep.y = ad(ml(k, n[1]), pep.y); pep.z = ad(ml(k, n[2]), pep.z);
      }
    };
    const v = { angle: this.angle };
    if (this.state === DOOR_OPENING) { push(); v.angle = ad(ml(a.rate, dt), v.angle); res = clampTo(v, a.rate, this.open, DOOR_OPEN); }
    else if (this.state === DOOR_OPEN) { if ((w.input.pressed & BTN_ACTION) !== 0 && a.exit < 0) toggle = true; }
    else if (this.state === DOOR_CLOSING) { push(); v.angle = sb(v.angle, ml(a.rate, dt)); res = clampTo(v, -a.rate, this.closed, DOOR_CLOSED); }
    this.angle = v.angle;
    switch (this.state) {
      case DOOR_CLOSED: if (d2 < this.r2) this.state = DOOR_OPENING; break;
      case DOOR_OPENING: case DOOR_CLOSING: {
        const m = partMatrix(w, rec, a.part);
        if (m) setRotation(m, 0, this.angle, 0);
        if (res !== -1) this.state = res;
        break;
      }
      case DOOR_OPEN:
        if (toggle) { this.state = DOOR_CLOSING; break; }
        if ((a.flags & 1) !== 0 || ((d2 <= this.r2big || a.exit >= 0) && (d2 <= this.r2 || a.exit < 0))) {
          if (d2 <= DOOR_EXIT_R2 && a.exit >= 0 && (V.get(VAR_PEPPER_CONTROL) & 5) !== 0) V.set(VAR_NEXT_ZONE, a.exit);
        } else this.state = DOOR_CLOSING;
        break;
    }
    return NODE_NONE;
  }
}

// ----------------------------------------------------------------------------- swinging / spinning sub-objects (FUN_005364a5 / FUN_00536256)

export interface SwingArgs {
  /** +0x00 (node +0x18 = -arg): speed per tick */
  rate: number;
  /** +0x04 (node +0x20): sub-object */
  part: number;
  /** +0x08 (node +0x1c = -arg): the far angle; +0x0c (node +0x14 = -arg): the start angle (1e38 = spin for ever) */
  to: number; from: number;
  /** +0x10 short (node +0x22): 0x20 = about y, 0x40 = about z, else about x */
  flags: number;
}
export function decodeSwing(a: ArgView): SwingArgs {
  const rate = -a.f32(0), from = -a.f32(0x0c);
  let to = -a.f32(8);
  if (!(0 <= rate) && !(to <= from)) to = sb(to, 6.2831854820251465);
  else if (0 < rate && to < from) to = ad(to, 6.2831854820251465);
  return { rate, part: a.i32(4), to, from, flags: a.u16(0x10) };
}

export class SwingNode implements BehaviourNode {
  readonly kind = 'building.swing';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly a: SwingArgs;
  private init = false;
  dead = false;
  /** node +0x24: 0 -> 1 (towards `to`) -> 2 -> 3 (back to `from`) -> 0 ... */
  state = 0;
  /** node +0x28 */
  angle: number;
  constructor(a: SwingArgs) { this.a = a; this.angle = a.from; }
  /** the constructor's mesh work (FUN_005364a5 runs it at construction; the port before the first update / save / load). A node without its sub-object keeps the zeroed allocation: angle 0 */
  ensureInit(w: World, rec: GameRecord) {
    const a = this.a;
    if (this.init) return;
    this.init = true;
    const m = a.part < partCount(w, rec) ? partMatrix(w, rec, a.part) : null;
    if (!m) { this.dead = true; this.angle = 0; } else setRotation(m, 0, this.angle, 0);
  }
  ctorInit(w: World, rec: GameRecord) { this.ensureInit(w, rec); }
  /** Save block = node +0x24 .. +0x2c (saver FUN_00536447 returns 8 and points at node + 0x24, loader FUN_0053646c = memcpy back): +0 i32 state, +4 f32 angle */
  saveBlock(w: World, rec: GameRecord): Uint8Array { this.ensureInit(w, rec); return new BlockOut(8).i32(0, this.state).f32(4, this.angle).bytes; }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.ensureInit(w, rec);
    const b = new BlockIn(data);
    this.state = b.i32(0); this.angle = b.f32(4);
  }
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const a = this.a;
    this.ensureInit(w, rec);
    if (this.dead) return NODE_NONE;
    const v = { angle: this.angle };
    let r = -1;
    switch (this.state) {
      case 0: this.state = 1;   // falls through
      case 1: v.angle = ad(ml(a.rate, fr(w.dt)), v.angle); r = clampTo(v, a.rate, a.to, 2); break;
      case 2: this.state = 3;   // falls through
      case 3: v.angle = sb(v.angle, ml(a.rate, fr(w.dt))); r = clampTo(v, -a.rate, a.from, 0); break;
    }
    this.angle = v.angle;
    if (r !== -1) this.state = r;
    const m = partMatrix(w, rec, a.part);
    if (m) {
      if ((a.flags & 0x20) !== 0) setRotation(m, 0, this.angle, 0);
      else if ((a.flags & 0x40) !== 0) setRotation(m, 0, 0, this.angle);
      else setRotation(m, this.angle, 0, 0);
    }
    return NODE_NONE;
  }
}

// ----------------------------------------------------------------------------- Constructopedia pages (FUN_00535281 / FUN_00534d98)

/** FUN_00534d4a's 4 records (the buildings the pages rebuild) and FUN_00534d71's 4 cutscene slots, in the emulated set-up's memory */
export const PAGE_BUILDINGS_VA = 0x05d586b4, PAGE_SLOTS_VA = 0x05d586c4;
export const VAR_NUM_PAGES = 0xa5, VAR_PAGECOUNTER = 0xc4;
/** 0x8eac38: pickup radius^2 (XZ distance of the controller, then 3D with a +-2.5 dead zone in y: 0x8920d0) */
export const PAGE_PICKUP_R2 = 4, PAGE_DY = 2.5;
/** 0x8920cc: spin per tick */
export const PAGE_SPIN = 0.10000000149011612;
/** 0x41700000: ticks between the pickup and the page cutscene */
export const PAGE_DELAY = 15;
/** FUN_004b0f16: DAT_009da96c = FUN_00443580(0x2f0), the pickup sound */
export const SND_PAGE = 0x2f0;

export function pageBuildings(w: World): (GameRecord | null)[] {
  const mem = tryCtx(w)?.setup?.mem;
  return [0, 1, 2, 3].map((i) => { const r = mem ? recIndexOfPtr(mem.u32(PAGE_BUILDINGS_VA + i * 4)) : -1; return r >= 0 ? w.records[r] ?? null : null; });
}
export function pageSlots(w: World): number[] {
  const mem = tryCtx(w)?.setup?.mem;
  return [0, 1, 2, 3].map((i) => (mem ? mem.u32(PAGE_SLOTS_VA + i * 4) | 0 : -1));
}

registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof PageNode) n.startFx(w); });

export class PageNode implements BehaviourNode {
  readonly kind = 'building.page';
  /** the constructor gates the node with the attach's variable, mask 0, value 0 (always runs) and keeps the attach's mask / value at +0x1c / +0x1e */
  var = 0;
  get mask() { return 0; } set mask(_v: number) { /* FUN_00535281: mask 0 */ }
  get value() { return 0; } set value(_v: number) { /* FUN_00535281: value 0 */ }
  stamp = 0xfffffffe;
  /** node +0x1c / +0x1e: this page's bit in PAGES_SET (var 0x26) and its "not collected" value */
  readonly pageMask: number; readonly pageValue: number;
  private init = false;
  /** node +0x20 */
  done = false;
  /** node +0x24: pickup delay */
  timer = 0;
  /** node +0x14 (TWINKLE02, the spinning page's sparkle) / +0x18 (TWINKLE01, the pickup burst): FUN_0044e920 in the constructor, both bound to record 4's matrix (DAT_00983804 + 0x1ac) until the page moves them */
  twinkle2 = FX_NONE; twinkle1 = FX_NONE;
  constructor(at: Attach) { this.var = at.var; this.pageMask = at.mask; this.pageValue = at.value; }
  /** Save block = node +0x20 .. +0x28 (saver FUN_0053519a copies into the buffer it is given (it first answers -1), loader FUN_00535214 = memcpy back): +0 i32 done (0 / 1), +4 f32 pickup timer (0, 15 .. 0, -1 = finished) */
  saveBlock(): Uint8Array { return new BlockOut(8).i32(0, this.done ? 1 : 0).f32(4, this.timer).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.done = b.i32(0) !== 0; this.timer = b.f32(4);
  }

  /** the constructor's side effects (deferred to the first update): a page collected before hides itself and reveals the next rebuilt building */
  private flagged = false;
  /** the constructor FUN_00535281's record work (a page collected before hides itself and reveals the next rebuilt building; flag 0x10): right after the set-up, so the record flags saved are the original's */
  ctorInit(w: World, rec: GameRecord): void {
    if (this.flagged) return;
    this.flagged = true;
    if ((w.vars.get(this.var) & this.pageMask) !== this.pageValue) {
      rec.hide();
      for (const b of pageBuildings(w)) if (b && !b.enabled) { b.show(); syncProps(w, b); break; }
    }
    rec.flags |= RF_NO_COLLIDE;
  }
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    this.ctorInit(w, rec);
    this.startFx(w);
  }
  /** the constructor's TWINKLE01 / 02 (idempotent; also run by `finishEmitters`, whatever the page's gate) */
  startFx(w: World) {
    const r4 = w.records[4];
    if (!r4) return;
    if (this.twinkle1 === FX_NONE) this.twinkle1 = fxStart(w, 'TWINKLE01.par', recMatrix(r4), [0, 4.0, 0], [0, 0, 0], GATE_OFF);
    if (this.twinkle2 === FX_NONE) this.twinkle2 = fxStart(w, 'TWINKLE02.par', recMatrix(r4), [0, Math.fround(1.6), 0], [-HALF_PI, 0, 0], GATE_OFF);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    const V = w.vars, g = V.get(this.var);
    if ((g & this.pageMask) !== this.pageValue) { rec.hide(); return NODE_NONE; }
    if (0 < this.timer) {
      this.timer = sb(this.timer, ml(1, fr(w.dt)));
      if (0 < this.timer) return NODE_STOP;
      this.timer = -1;
      fxGate(w, this.twinkle2, GATE_OFF); fxGate(w, this.twinkle1, GATE_OFF);   // FUN_0044ea60(+0x14, 1, 1, 1), (+0x18, 1, 1, 1)
      const n = V.get(VAR_PAGECOUNTER);
      tryCtx(w)?.startCutscene(pageSlots(w)[n] ?? -1);
      this.done = true;
      V.add(VAR_PAGECOUNTER, 1);
    }
    if (this.done) {
      if (this.var > 2) { if (this.pageMask === this.pageValue) V.andNot(this.var, this.pageMask); else V.or(this.var, this.pageMask); }
      return NODE_STOP;
    }
    if (this.timer < 0 || !rec.enabled) {
      // node +0x0c / +0x0e are the node's own gate mask / value (0 / 0): ANDNOT 0, a no-op
      return NODE_NONE;
    }
    const pep = w.focus;
    if (pep && ctrl.distSq <= PAGE_PICKUP_R2 && (V.get(VAR_PEPPER_CONTROL) & 5) !== 0) {
      const dx = sb(pep.x, rec.x), dz = sb(pep.z, rec.z);
      let dy = sb(pep.y, rec.y);
      dy = dy < -PAGE_DY ? ad(dy, PAGE_DY) : dy <= PAGE_DY ? 0 : sb(dy, PAGE_DY);
      if (ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) <= PAGE_PICKUP_R2 && rec.enabled) {
        V.add(VAR_NUM_PAGES, 1);
        rec.hide();
        this.timer = PAGE_DELAY;
        fxMatrix(w, this.twinkle1, recMatrix(rec)); fxGate(w, this.twinkle1, GATE_ON);   // the pickup burst at the page
        tryCtx(w)?.sfx(SND_PAGE);
        return NODE_STOP;
      }
    }
    rec.ry = ad(rec.ry, PAGE_SPIN);
    rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    fxMatrix(w, this.twinkle2, recMatrix(rec)); fxGate(w, this.twinkle2, GATE_ON);   // FUN_0044ea00 + FUN_0044ea60(+0x14, 2, 1, 1): the sparkle follows the spinning page
    return NODE_STOP;
  }
}

// ----------------------------------------------------------------------------- the music house (FUN_005357cb / FUN_00535485 / FUN_00535550)

/** FUN_004b0dxx: DAT_05d5810c = FUN_004433b0(0x8b), the house's 3D music loop */
export const SND_MUSIC_HOUSE = 0x8b;
/** 0x892118: phase speed; 0x892124: z tilt; 0x89208c / 0x892134 / 0x89204c / 0x8925a8: bounce maths */
export const MH_SPEED = 0.4000000059604645, MH_TILT = 0.02500000037252903, MH_SQUASH = 0.5, MH_SQUASH_BASE = 0.9375, MH_BOUNCE = 0.25;

registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof MusicHouseNode) n.startFx(w, r); });

export class MusicHouseNode implements BehaviourNode {
  readonly kind = 'building.musichouse';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  private base: Float32Array | null = null;
  /** node +0x54 saved rz, +0x58 saved y / 8, +0x60 phase */
  rz0 = 0; y8 = 0; phase = 0;
  private wobbled = false;
  /** Save block = node +0x60 (saver FUN_0053576d returns 4 and points at node + 0x60, loader FUN_00535792 = memcpy back): the f32 bounce phase */
  saveBlock(): Uint8Array { return new BlockOut(4).f32(0, this.phase).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.phase = new BlockIn(data).f32(0); }
  /** +0x5c: the notes01 emitter (FUN_00442960 in the constructor: record 127's matrix, offset 0, rotation (-pi / 2), gate (2, 1, 1) = on); the update only switches its gate */
  notesH = FX_NONE;
  /** the constructor's FUN_00442960 (idempotent; also run by `finishEmitters`). The bounce (FUN_00535550) only lives while the house is drawn and the matrix is restored afterwards:
   *  the emitter is bound to the restored (base) matrix. */
  startFx(w: World, rec: GameRecord) {
    if (this.notesH === FX_NONE) this.notesH = fxStart(w, 'notes01.par', () => (this.wobbled && this.base ? this.base : rec.m as Float32Array), [0, 0, 0], [-HALF_PI, 0, 0], GATE_ON);
  }
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.base) { this.base = rec.m.slice(); this.rz0 = rec.rz; this.y8 = ml(rec.y, 0.125); }
    this.startFx(w, rec);
    if (this.wobbled) { rec.m.set(this.base); this.wobbled = false; }   // FUN_00535550 restores the matrix after drawing
    fxGate(w, this.notesH, rec.enabled ? GATE_ON : GATE_OFF);          // FUN_00535485: record flag 2 clear -> (1, 1, 1), else (2, 1, 1)
    if (!rec.enabled) return NODE_NONE;
    tryCtx(w)?.sfxAt(SND_MUSIC_HOUSE, [rec.x, rec.y, rec.z]);
    this.phase = ad(ml(MH_SPEED, fr(w.dt)), this.phase);
    return NODE_CONTINUE;
  }
  /** FUN_00535550 (a draw hook in the original: the bounced matrix only lives while the house is drawn; the port applies it after the tick and restores it at the next update) */
  prerender(_w: World, rec: GameRecord) {
    const b = this.base;
    if (!b) return;
    const sn = Math.sin(this.phase);
    rec.rz = ad(ml(sn, MH_TILT), this.rz0);
    const m = buildMatrix(rec.rx, rec.ry, rec.rz, b[12], b[13], b[14]);
    const a = Math.abs(fr(sn)), a8 = ml(a, 0.125);
    const k = ad(ml(a8, MH_SQUASH), MH_SQUASH_BASE);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] = ml(m[i], k);
    m[13] = ml(ad(ml(a8, MH_BOUNCE), this.y8), 8);
    rec.m.set(m);
    this.wobbled = true;
  }
}

// ----------------------------------------------------------------------------- the "pop in" node (FUN_00534b89 / FUN_005341f4 / FUN_00534409)

/** 0x892030 (0.01): the speed scale of the node's variable; 0x8925a0 (0.333): sine phase speed; 0x89259c (pi / 20): spin step; 0x892220 (pi / 2): the end of the fade angle */
export const POPIN_VAR_SCALE = 0.009999999776482582, POPIN_PHASE_SPEED = 0.3330000042915344, POPIN_SPIN_STEP = 0.15707960724830627;
/** the floats the update (FUN_005341f4) writes: 0xbfc90fdb (-pi / 2) / 0x3fc90fdb (pi / 2) the phase, 0x3f060404 (0.5235...) the fade angle, 0xc1490fdb (-4 pi) the three spin angles */
const PI_2 = 1.5707963705062866, FOUR_PI = 12.566370964050293, POPIN_FADE0 = f32(0x3f060404);

/** pop-in flags (argument +0x00, node +0x14): bits 1 / 2 / 4 scale x / y / z, 8 height bounce, 0x10 / 0x20 / 0x40 spin x / y / z, 0x100 shrink instead of grow */
export const PI_SCALE_X = 1, PI_SCALE_Y = 2, PI_SCALE_Z = 4, PI_BOUNCE = 8, PI_SPIN_X = 0x10, PI_SPIN_Y = 0x20, PI_SPIN_Z = 0x40, PI_SHRINK = 0x100;

export class PopInNode implements BehaviourNode {
  readonly kind = 'building.popin';
  /** the constructor's own gate (var 1, mask 0, value 1: never open); the set-up writes the attach's gate over it: ignored (`unlockGate` is for the tests, which drive the node's code with an open gate) */
  private gv = 1; private gm = 0; private gval = 1;
  get var() { return this.gv; } set var(_v: number) { if (this.unlocked) this.gv = _v; }
  get mask() { return this.gm; } set mask(_v: number) { if (this.unlocked) this.gm = _v; }
  get value() { return this.gval; } set value(_v: number) { if (this.unlocked) this.gval = _v; }
  private unlocked = false;
  unlockGate(v: number, m: number, val: number) { this.unlocked = true; this.gv = v; this.gm = m; this.gval = val; }
  stamp = 0xfffffffe;
  /** node +0x14: the flags (argument +0), +0x18: the speed variable (argument +0xc, < 2 = none) */
  readonly flags: number; readonly speedVar: number;
  /** argument +8: the record the node animates (0 = the record that owns the node) */
  private readonly argRec: number;
  /** node +0x1c / +0x1e: the node's own mask / value for the variable the controller passes (the constructor never writes them) */
  m1c = CD16; v1e = CD16;   // (0xCD from the debug heap: the update's own gate (var & mask) == value never matches, a second reason the node is dead; the tests set both to 0)
  private init = false;
  /** the animated record (node +0x40) */
  target: GameRecord | null = null;
  /** node +0x20 clock, +0x24 sine phase, +0x28 / +0x2c / +0x30 spin angles, +0x34 / +0x38 / +0x3c the record's position at the start, +0x44 / +0x48 target / base scale, +0x4c fade angle, +0x50 / +0x54 / +0x58 scale, +0x5c bounce */
  // (f20 / f24 / f4c are never written by the constructor: 0xCDCDCDCD from the debug heap; the first update sets them)
  f20 = CDF; f24 = CDF; f28 = 0; f2c = 0; f30 = 0; f34 = 0; f38 = 0; f3c = 0; f44 = 1; f48 = 0; f4c = CDF; f50 = 1; f54 = 1; f58 = 1; f5c = 0;
  /** node +0x60: running */
  active = 0;
  /** node +0x61 .. +0x63: padding of the saved range (the zeroed allocation) */
  pad = [CD, CD, CD];
  constructor(at: Attach) {
    const a = ArgView.of(at);
    this.flags = a.u32(0); this.speedVar = a.i32(0x0c); this.argRec = a.recIndex(8);
  }
  /** the constructor's reads of the world (the record's position, the speed variable); the port runs them before the first update / save / load */
  ensureInit(w: World, rec: GameRecord) {
    if (this.init) return;
    this.init = true;
    const t = this.argRec >= 0 ? w.records[this.argRec] ?? rec : rec;
    this.target = t;
    this.f50 = this.f54 = this.f58 = 1; this.f48 = 0; this.f44 = 1;
    if (this.speedVar > 1) { this.f44 = ml(w.vars.get(this.speedVar) | 0, POPIN_VAR_SCALE); this.f58 = this.f44; this.f54 = this.f58; this.f50 = this.f54; }
    this.f34 = t.m[12]; this.f38 = t.m[13]; this.f3c = t.m[14];
  }
  ctorInit(w: World, rec: GameRecord) { this.ensureInit(w, rec); }
  /**
   * Save block = node +0x20 .. +0x64 then the tag (the first dword = the 4 name characters) of the record at +0x40 (saver FUN_00534a0a; the loader FUN_00534ae0 copies the 0x44 bytes back and
   * replaces +0x40 by FUN_00419a79(tag), the FIRST record of that name): 0x44 bytes: +0x00 f20 .. +0x10 f30, +0x14 f34 f38 f3c, +0x20 the record pointer (the process address of the record: the
   * emulation's 0x10000000 + index * 0x68; the real process's heap address cannot be known and the loader overwrites it), +0x24 f44 f48 f4c, +0x30 f50 f54 f58, +0x3c f5c, +0x40 u8 active + 3 pad bytes; +0x44 u32 tag.
   */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    this.ensureInit(w, rec);
    const o = new BlockOut(0x48);
    o.f32(0, this.f20).f32(4, this.f24).f32(8, this.f28).f32(0xc, this.f2c).f32(0x10, this.f30).f32(0x14, this.f34).f32(0x18, this.f38).f32(0x1c, this.f3c);
    o.u32(0x20, this.target ? (EMU_RECORDS_BASE + this.target.index * EMU_RECORD_STRIDE) >>> 0 : 0);
    o.f32(0x24, this.f44).f32(0x28, this.f48).f32(0x2c, this.f4c).f32(0x30, this.f50).f32(0x34, this.f54).f32(0x38, this.f58).f32(0x3c, this.f5c);
    o.u8(0x40, this.active).u8(0x41, this.pad[0]).u8(0x42, this.pad[1]).u8(0x43, this.pad[2]);
    o.u32(0x44, this.target ? recordTag(this.target.name) : 0);
    return o.bytes;
  }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.ensureInit(w, rec);
    const b = new BlockIn(data);
    this.f20 = b.f32(0); this.f24 = b.f32(4); this.f28 = b.f32(8); this.f2c = b.f32(0xc); this.f30 = b.f32(0x10); this.f34 = b.f32(0x14); this.f38 = b.f32(0x18); this.f3c = b.f32(0x1c);
    this.f44 = b.f32(0x24); this.f48 = b.f32(0x28); this.f4c = b.f32(0x2c); this.f50 = b.f32(0x30); this.f54 = b.f32(0x34); this.f58 = b.f32(0x38); this.f5c = b.f32(0x3c);
    this.active = b.u8(0x40); this.pad = [b.u8(0x41), b.u8(0x42), b.u8(0x43)];
    // FUN_00419a79(tag): the first record with these 4 name characters (a tag whose first byte is 0 matches nothing)
    const tag = b.u32(0x44);
    this.target = null;
    if ((tag & 0xff) !== 0) for (const r of w.records) if (recordTag(r.name) === tag) { this.target = r; break; }
  }

  /** FUN_005341f4 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    this.ensureInit(w, rec);
    const v = w.vars.get(this.gv) | 0;
    if (((v & (this.m1c << 16 >> 16)) | 0) !== (this.v1e << 16 >> 16)) { this.active = 0; return this.speedVar > 1 ? NODE_CONTINUE : NODE_NONE; }
    const t = this.target!;
    if (this.active === 0) {
      this.active = 1;
      if (this.speedVar < 2) { this.f48 = 0; this.f44 = 1; } else this.f44 = ml(w.vars.get(this.speedVar) | 0, POPIN_VAR_SCALE);
      this.f24 = -PI_2; this.f4c = POPIN_FADE0; this.f28 = -FOUR_PI; this.f2c = -FOUR_PI; this.f30 = -FOUR_PI;
      this.f38 = t.m[13]; this.f34 = t.m[12]; this.f3c = t.m[14];
      t.show();
      this.f20 = 0;
      this.f24 = (this.flags & PI_SHRINK) === 0 ? -PI_2 : PI_2;
    }
    t.show();
    return NODE_CONTINUE;
  }

  /** FUN_0053436c(target, node): the target's matrix from the node's angles / position / scale */
  private applyMatrix(t: GameRecord) {
    t.m.set(buildMatrix(ad(this.f28, t.rx), ad(this.f2c, t.ry), ad(this.f30, t.rz), this.f34, ad(this.f5c, this.f38), this.f3c, this.f50, this.f54, this.f58));
  }

  /** FUN_00534409 (the pre-render hook: the animation step) */
  prerender(w: World, rec: GameRecord) {
    this.ensureInit(w, rec);
    if (this.active === 0) return;
    const t = this.target!, F = this.flags, dt = fr(w.dt);
    let done = 0, want = 0;
    this.f5c = 0;
    const d14 = sb(this.f44, this.f48);
    this.f58 = this.f54 = this.f50 = 1;
    let v20 = 0;
    if ((F & 0xf) !== 0) {
      want = 1;
      let v4: number, v10: number;
      if ((F & PI_SHRINK) !== 0) { v4 = sb(1, Math.sin(this.f4c)); v10 = v4; }
      else { v4 = fr(Math.sin(this.f4c)); v10 = sb(1, v4); }
      v20 = ad(ml(Math.sin(this.f24), v10), v4);
      this.f24 = ad(ml(POPIN_PHASE_SPEED, dt), this.f24);
      this.f20 = ad(ml(1, dt), this.f20);
      if (!(this.f20 < 10)) {
        this.f4c = ad(ml(POPIN_VAR_SCALE, dt), this.f4c);
        if (!(this.f4c < PI_2)) { v20 = (F & PI_SHRINK) !== 0 ? 0 : 1; done = 1; }
      }
      if ((F & PI_SCALE_X) !== 0) this.f50 = v20;
      if ((F & PI_SCALE_Y) !== 0) this.f54 = v20;
      if ((F & PI_SCALE_Z) !== 0) this.f58 = v20;
      if ((F & PI_BOUNCE) !== 0) this.f5c = fr(Math.abs(ml(ml(Math.sin(this.f24), v10), 10)));
    }
    this.f50 = ad(ml(d14, this.f50), this.f48); this.f54 = ad(ml(d14, this.f54), this.f48); this.f58 = ad(ml(d14, this.f58), this.f48);
    if ((F & 0x70) !== 0) {
      if ((F & PI_SPIN_X) !== 0) { this.f28 = ad(this.f28, POPIN_SPIN_STEP); want |= 2; if (this.f28 > 0) { this.f28 = 0; done |= 2; } }
      if ((F & PI_SPIN_Y) !== 0) { this.f2c = ad(this.f2c, POPIN_SPIN_STEP); want |= 4; if (this.f2c > 0) { this.f2c = 0; done |= 4; } }
      if ((F & PI_SPIN_Z) !== 0) { this.f30 = ad(this.f30, POPIN_SPIN_STEP); want |= 8; if (this.f30 > 0) { this.f30 = 0; done |= 8; } }
    }
    if (done === want || !tryCtx(w)?.cutsceneActive()) {
      if ((F & PI_SHRINK) !== 0) t.hide();
      this.f58 = this.f54 = this.f50 = 1;
      this.f50 = ad(ml(d14, this.f50), this.f48); this.f54 = ad(ml(d14, this.f54), this.f48); this.f58 = ad(ml(d14, this.f58), this.f48);
      this.f48 = this.f44;
      syncProps(w, t);
      this.f30 = 0; this.f2c = 0; this.f28 = 0; this.f5c = 0; this.active = 0;
      if (this.gv > 2) {
        if ((this.m1c << 16 >> 16) === (this.v1e << 16 >> 16)) w.vars.andNot(this.gv, this.m1c << 16 >> 16); else w.vars.or(this.gv, this.m1c << 16 >> 16);
      }
    }
    if (this.speedVar < 2) this.applyMatrix(t);
  }
  // (draw hook FUN_00534918: for a node without a speed variable (every shipped attach: argument +0xc = -1) it is the record's default draw (FUN_00444480 with 100), which the renderer does; the
  // variable-driven branch (speed variable >= 2: the record's visibility follows the variable, the matrix is built around the draw) is not ported: no set-up of the game attaches such a node)
}

registerCtor(CTOR_DOOR, (at: Attach) => new DoorNode(decodeDoor(ArgView.of(at))));
registerCtor(CTOR_SWING, (at: Attach) => new SwingNode(decodeSwing(ArgView.of(at))));
registerCtor(CTOR_PAGE, (at: Attach) => new PageNode(at));
registerCtor(CTOR_MUSIC_HOUSE, () => new MusicHouseNode());
registerCtor(CTOR_POPIN_DEAD, (at: Attach) => new PopInNode(at));
