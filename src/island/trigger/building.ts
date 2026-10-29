// building.c (Common\Z02LGI\c_src): the island's buildings (WP4, docs/re/m4/wp4-triggers.md).
//
//   FUN_00535e80  ctor, door (a mesh sub-object that swings open when Pepper comes near / presses the action button; exit doors write var 5),
//                 vtable 0x8eac58: update FUN_0053594e, (1) FUN_00535dcc, destroy FUN_00536226, draw FUN_00535de6 (default draw)
//   FUN_005364a5  ctor, swinging / spinning sub-object (radar dish, flags, rotors ...), vtable 0x8eac70: update FUN_00536256
//   FUN_00535281  ctor, Constructopedia page (PAG1-4), vtable 0x8eac20: update FUN_00534d98 (pickup, then the page cutscene)
//   FUN_005357cb  ctor, the music house HSE2 (bounces to its music), vtable 0x8eac40: update FUN_00535485, draw FUN_00535550
//   FUN_00533d30  the props that follow a building's visibility (RESQ -> SPBT, POLB -> its vehicles and the jail ...)
//   FUN_005358fc  clamp helper: move an angle towards a limit, report the next state when it got there
// Not ported: FUN_00534b89 (vtable 0x8eac08: a building "pop in" scale / spin animation, FUN_005341f4 / FUN_00534409 / FUN_00534918). Its
// constructor sets the node's gate to var 1 & 0 == 1, which never holds (var 1 reads 0), and nothing in the executable re-gates it: the node is
// dead in the shipped game (docs/re/m4/wp4-triggers.md).
import { NODE_NONE, NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView, recIndexOfPtr, EMU_RECORD_STRIDE } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { partCount, partMatrix, setRotation } from './parts.ts';
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
export function clampTo(v: { angle: number }, step: number, limit: number, ret: number): number {
  if (0 <= step) { if (limit < v.angle) { v.angle = limit; return ret; } }
  else if (v.angle < limit) { v.angle = limit; return ret; }
  return -1;
}

// ----------------------------------------------------------------------------- doors (FUN_00535e80 / FUN_0053594e)

/** 0x8925ac: the door point lies 1.22 x the sub-object's right / forward axis away from its pivot */
export const DOOR_AXIS_OFFSET = 1.22;
/** node +0x14: radius 6 (no exit) / 12 (exit door), squared */
export const DOOR_RADIUS = 6, DOOR_RADIUS_EXIT = 12;
/** DAT_05d586b0 = 16 (written by the ctor): Pepper is pushed away from an opening / closing door within sqrt(16) */
export const DOOR_PUSH_R2 = 16;
/** DAT_05d586ac = 0x408a71de (written by the ctor): squared distance at which an exit door writes var 5 */
export const DOOR_EXIT_R2 = f32(0x408a71de);
/** 0x892080: the door ignores Pepper more than 4 units above / below the door point */
export const DOOR_DY = 4;
/** 0x8920cc: push speed (units per tick) */
export const DOOR_PUSH = 0.1;
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

  /** FUN_00535e80 (deferred to the first update: it needs the mesh) */
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    const a = this.a, r = a.exit < 0 ? DOOR_RADIUS : DOOR_RADIUS_EXIT;
    const m = a.part < partCount(w, rec) ? partMatrix(w, rec, a.part) : null;
    if (!m) { this.dead = true; return; }
    const o: [number, number, number] = [m[12], m[13], m[14]];
    if ((a.flags & 0x300) !== 0) {
      const s = (a.flags & 0x100) !== 0 ? -DOOR_AXIS_OFFSET : DOOR_AXIS_OFFSET;
      o[0] += m[0] * s; o[1] += m[1] * s; o[2] += m[2] * s;
    } else if ((a.flags & 0xc00) !== 0) {
      const s = (a.flags & 0x400) !== 0 ? -DOOR_AXIS_OFFSET : DOOR_AXIS_OFFSET;
      o[0] += m[8] * s; o[1] += m[9] * s; o[2] += m[10] * s;
    }
    this.off = o;
    const big = Math.sqrt(o[2] * o[2] + o[1] * o[1] + o[0] * o[0]) + r;
    this.r2big = big * big;
    this.r2 = r * r;
    this.closed = Math.atan2(m[8], m[10]);
    this.open = this.closed - a.angle;
    this.angle = this.closed;
    setRotation(m, 0, this.angle, 0);
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    if (this.dead) return NODE_NONE;
    const a = this.a, V = w.vars, c = tryCtx(w), pep = w.focus;
    if (!pep || c?.cutsceneActive() || !rec.enabled) return NODE_NONE;
    if (!(this.state !== DOOR_CLOSED || a.exit >= 0 || ((w.input.pressed & BTN_ACTION) !== 0 && (V.get(VAR_PEPPER_CONTROL) & 5) !== 0))) return NODE_NONE;
    const p = rec.toWorld(this.off);
    let dx = pep.x - p[0], dy = pep.y - p[1], dz = pep.z - p[2];
    if (Math.abs(dy) > DOOR_DY) return NODE_NONE;
    dy = 0;
    const d2 = dz * dz + dx * dx + 0;
    if (d2 < this.r2 && a.exit >= 0) V.or(VAR_INTERACT_ICONS, 0x20);
    let res = -1, toggle = false;
    const push = () => {
      if (d2 <= DOOR_PUSH_R2 && a.exit < 0) {
        const l = Math.sqrt(dz * dz + dy * dy + dx * dx);
        if (l !== 0) { dx /= l; dz /= l; }
        pep.x += DOOR_PUSH * w.dt * dx; pep.z += DOOR_PUSH * w.dt * dz;
      }
    };
    const v = { angle: this.angle };
    if (this.state === DOOR_OPENING) { push(); v.angle += a.rate * w.dt; res = clampTo(v, a.rate, this.open, DOOR_OPEN); }
    else if (this.state === DOOR_OPEN) { if ((w.input.pressed & BTN_ACTION) !== 0 && a.exit < 0) toggle = true; }
    else if (this.state === DOOR_CLOSING) { push(); v.angle -= a.rate * w.dt; res = clampTo(v, -a.rate, this.closed, DOOR_CLOSED); }
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
  const TWO_PI = 6.2831855;
  if (!(0 <= rate) && !(to <= from)) to -= TWO_PI;
  else if (0 < rate && to < from) to += TWO_PI;
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
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const a = this.a;
    if (!this.init) {
      this.init = true;
      const m = a.part < partCount(w, rec) ? partMatrix(w, rec, a.part) : null;
      if (!m) this.dead = true; else setRotation(m, 0, this.angle, 0);
    }
    if (this.dead) return NODE_NONE;
    const v = { angle: this.angle };
    let r = -1;
    switch (this.state) {
      case 0: this.state = 1;   // falls through
      case 1: v.angle += a.rate * w.dt; r = clampTo(v, a.rate, a.to, 2); break;
      case 2: this.state = 3;   // falls through
      case 3: v.angle -= a.rate * w.dt; r = clampTo(v, -a.rate, a.from, 0); break;
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
export const PAGE_SPIN = 0.1;
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
  constructor(at: Attach) { this.var = at.var; this.pageMask = at.mask; this.pageValue = at.value; }

  /** the constructor's side effects (deferred to the first update): a page collected before hides itself and reveals the next rebuilt building */
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    if ((w.vars.get(this.var) & this.pageMask) !== this.pageValue) {
      rec.hide();
      for (const b of pageBuildings(w)) if (b && !b.enabled) { b.show(); syncProps(w, b); break; }
    }
    rec.flags |= RF_NO_COLLIDE;
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    const V = w.vars, g = V.get(this.var);
    if ((g & this.pageMask) !== this.pageValue) { rec.hide(); return NODE_NONE; }
    if (0 < this.timer) {
      this.timer -= 1 * w.dt;
      if (0 < this.timer) return NODE_STOP;
      this.timer = -1;
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
      const dx = pep.x - rec.x, dz = pep.z - rec.z;
      let dy = pep.y - rec.y;
      dy = dy < -PAGE_DY ? dy + PAGE_DY : dy <= PAGE_DY ? 0 : dy - PAGE_DY;
      if (dz * dz + dy * dy + dx * dx <= PAGE_PICKUP_R2 && rec.enabled) {
        V.add(VAR_NUM_PAGES, 1);
        rec.hide();
        this.timer = PAGE_DELAY;
        tryCtx(w)?.sfx(SND_PAGE);
        return NODE_STOP;
      }
    }
    rec.ry += PAGE_SPIN;
    rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    return NODE_STOP;
  }
}

// ----------------------------------------------------------------------------- the music house (FUN_005357cb / FUN_00535485 / FUN_00535550)

/** FUN_004b0dxx: DAT_05d5810c = FUN_004433b0(0x8b), the house's 3D music loop */
export const SND_MUSIC_HOUSE = 0x8b;
/** 0x892118: phase speed; 0x892124: z tilt; 0x89208c / 0x892134 / 0x89204c / 0x8925a8: bounce maths */
export const MH_SPEED = 0.4, MH_TILT = 0.025, MH_SQUASH = 0.5, MH_SQUASH_BASE = 0.9375, MH_BOUNCE = 0.25;

export class MusicHouseNode implements BehaviourNode {
  readonly kind = 'building.musichouse';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  private base: Float32Array | null = null;
  /** node +0x54 saved rz, +0x58 saved y / 8, +0x60 phase */
  rz0 = 0; y8 = 0; phase = 0;
  private wobbled = false;
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.base) { this.base = rec.m.slice(); this.rz0 = rec.rz; this.y8 = rec.y * 0.125; }
    if (this.wobbled) { rec.m.set(this.base); this.wobbled = false; }   // FUN_00535550 restores the matrix after drawing
    if (!rec.enabled) return NODE_NONE;
    tryCtx(w)?.sfxAt(SND_MUSIC_HOUSE, [rec.x, rec.y, rec.z]);
    this.phase += MH_SPEED * w.dt;
    return NODE_CONTINUE;
  }
  /** FUN_00535550 (a draw hook in the original: the bounced matrix only lives while the house is drawn; the port applies it after the tick and restores it at the next update) */
  prerender(_w: World, rec: GameRecord) {
    const b = this.base;
    if (!b) return;
    const s = Math.sin(this.phase);
    rec.rz = this.rz0 + s * MH_TILT;
    const m = buildMatrix(rec.rx, rec.ry, rec.rz, b[12], b[13], b[14]);
    const a = Math.abs(s), k = a * 0.125 * MH_SQUASH + MH_SQUASH_BASE;
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] *= k;
    m[13] = (a * 0.125 * MH_BOUNCE + this.y8) * 8;
    rec.m.set(m);
    this.wobbled = true;
  }
}

registerCtor(CTOR_DOOR, (at: Attach) => new DoorNode(decodeDoor(ArgView.of(at))));
registerCtor(CTOR_SWING, (at: Attach) => new SwingNode(decodeSwing(ArgView.of(at))));
registerCtor(CTOR_PAGE, (at: Attach) => new PageNode(at));
registerCtor(CTOR_MUSIC_HOUSE, () => new MusicHouseNode());
