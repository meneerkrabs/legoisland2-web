// StartCSM.c (Common\Z02LGI\c_src): the island's cutscene triggers and box portals (WP4, docs/re/m4/wp4-triggers.md).
//
//   FUN_0051e19c  ctor, waypoint / immediate trigger, vtable 0x8ea070: update FUN_0051dd7e, (1) FUN_0051e0e8 returns 1, destroy FUN_0051e42d,
//                 draw FUN_0051e102 (the default mesh draw), save / load FUN_0051e163 / FUN_0051e13e (the 8 bytes at node +0x38)
//   FUN_0051dc50  the variable operation the trigger applies after its cutscene
//   FUN_0051ea3c  ctor, box portal, vtable 0x8ea088: update FUN_0051e5ab
//   FUN_0051e475  portal vehicle table DAT_05d58688 (set by the roster functions: read from the emulated set-up's memory)
//   FUN_0051e4b0  show the vehicle var 0xbb (PORTAL_VEHICLE) selected from a portal table row (the island arrival code calls it)
// Every update path of both nodes returns 0 (xor eax, eax): the nodes never count as "ran" (no pre-render / draw hooks, the chain continues).
import { NODE_NONE } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { waypoints } from '../../game/walker.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView, recIndexOfPtr } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { vehicles } from '../vehicles/common.ts';
import { ad, sb, ml, fr } from '../../zones/common/f32.ts';
import { BlockIn, BlockOut, CD, CD32, CDF } from '../blockio.ts';

// ----------------------------------------------------------------------------- constants

export const CTOR_STARTCSM = 0x51e19c, CTOR_PORTAL = 0x51ea3c;
/** game variables */
export const VAR_NEXT_ZONE = 5, VAR_INTERACT_ICONS = 0xc, VAR_PEPPER_CONTROL = 0x5e, VAR_PORTAL_VEHICLE = 0xbb;
/** node +0x38 slot markers: -20 = the cutscene was started (apply the variable operation once it ends), -30 = done */
export const SLOT_FIRED = -20, SLOT_DONE = -30;
/** 0x892090: waypoint radius scale (the block's radius is in walker units, the comparison in world units) */
export const RADIUS_SCALE = 8;
/** 0x7e967699: radius^2 of a trigger without waypoints (never used: it fires at once) */
export const NO_RADIUS = 9.999999680285692e+37;
/** Pepper's clip 0x1c (FUN_0043b72b(pepper anim) == 0x1c): an armed trigger waits while it plays */
export const CLIP_BLOCKS_TRIGGER = 0x1c;
/** 0x8921f4: added to |half extents|^2 for the portal's proximity radius (node +0x20) */
export const PORTAL_RADIUS_BIAS = 16;
/** 0x892590: portal spin per tick about x (0.5 degree) */
export const PORTAL_SPIN = 0.008726599626243114;
/** 0x892220: the portal faces the camera + pi / 2 */
export const PORTAL_FACE_OFFSET = 1.5707963705062866;
/** 0x892038: the portal ignores the player for its first 30 ticks (node +0x40 counts by dt) */
export const PORTAL_ARM_TICKS = 30;
/** emulated .bss of FUN_0051e475: 2 rows x 3 record pointers */
export const PORTAL_TABLE_VA = 0x05d58688;
/** FUN_00423xxx record link table (rows of 3 record pointers, count at 0x9da828) used by FUN_004240d1 */
export const LINK_TABLE_VA = 0x009da7e0, LINK_COUNT_VA = 0x009da828;

const PI = 3.1415927410125732, TWO_PI = 6.2831854820251465;
/** the original's one-step wrap (every value a float) */
export function wrapAngle(a: number) { return -PI <= a ? (PI < a ? sb(a, TWO_PI) : a) : ad(a, TWO_PI); }

// ----------------------------------------------------------------------------- shared helpers

/**
 * DAT_009da9f8 hi word: what Pepper drives (WP6 `vehicles(w).kind`: -1 car, -2 boat, -3 helicopter, -4 / -5 pizza / Ptera; 0 before any boarding).
 * WP17: this read `ctx.shared.vehicleState`, which nothing writes, so it was always -1 and a trigger without a key mask fired while Pepper still sat in the
 * helicopter / boat she arrived in (era 3 node 52: HSE2's LGIBR08 started in the air). `ctx.shared.vehicleState` still overrides it (tests).
 */
export function vehicleState(w: World): number { const v = tryCtx(w)?.shared.vehicleState; return typeof v === 'number' ? v : vehicles(w).kind; }

/** FUN_004240d1(rec, bits, mode): for the link row that contains `rec`, apply FUN_004238f9(other.ctrl, bits, mode) to the other records (mode 0 OR, 1 AND, 2 ANDNOT, 3 SET of the head node's gate variable, when that is >= 3) */
export function applyLinks(w: World, rec: GameRecord, bits: number, mode: number) {
  const mem = tryCtx(w)?.setup?.mem;
  if (!mem) return;
  const n = mem.u32(LINK_COUNT_VA) | 0;
  for (let row = 0; row < n; row++) {
    const ids = [0, 1, 2].map((i) => recIndexOfPtr(mem.u32(LINK_TABLE_VA + row * 12 + i * 4)));
    if (!ids.includes(rec.index)) continue;
    for (const id of ids) {
      if (id < 0 || id === rec.index) continue;
      const head = w.records[id]?.ctrl?.nodes[0];
      if (!head || head.var < 3) continue;
      if (mode === 0) w.vars.or(head.var, bits);
      else if (mode === 1) w.vars.set(head.var, w.vars.get(head.var) & bits);
      else if (mode === 2) w.vars.andNot(head.var, bits);
      else if (mode === 3) w.vars.set(head.var, bits);
    }
    return;
  }
}

/** FUN_0051dc50(rec, op, var, value): 1 SET, 2 OR, 4 ANDNOT, 0x10 links-OR + OR, 0x20 links-ANDNOT + ANDNOT, 0x40 (+1000 to vars 0xa6 / 0x12, -1 to 0xb0) + SET */
export function applyOp(w: World, rec: GameRecord, op: number, v: number, value: number) {
  const V = w.vars;
  switch (op) {
    case 0x10: applyLinks(w, rec, value, 0); V.or(v, value); break;
    case 2: V.or(v, value); break;
    case 0x20: applyLinks(w, rec, value, 2); V.andNot(v, value); break;
    case 4: V.andNot(v, value); break;
    case 0x40: V.add(0xa6, 1000); V.add(0x12, 1000); V.add(0xb0, -1); V.set(v, value); break;
    case 1: V.set(v, value); break;
    default: break;
  }
}

// ----------------------------------------------------------------------------- the waypoint / immediate trigger

/** the argument block FUN_0051e19c reads (offsets into the block; node offsets in the comments) */
export interface StartCsmArgs {
  /** +0x00: the waypoint list (shorts) when `count` > 0; +0x14 (short): the single waypoint when count == 0 (-1 = none: the trigger fires at once) */
  waypoints: number[];
  /** +0x17 (node +0x19): waypoint map slot (0 ROAD, 1 PATH, 2 CSM, 3 OTH) */
  map: number;
  /** +0x18 (float): radius in walker units; node +0x1c = (r*8)^2, node +0x20 = (2*r*8)^2 (the icon radius) */
  radius: number;
  /** +0x1c / +0x20 / +0x24 (node +0x24 / +0x28 / +0x2c): the variable, the value and the operation (FUN_0051dc50) applied once the cutscene ended */
  opVar: number; opValue: number; op: number;
  /** +0x26 (node +0x2e): put Pepper's walker on the nearest waypoint when it fires (FUN_004625d7) */
  walkTo: boolean;
  /** +0x28 (node +0x38): cutscene slot (< 0 = none) */
  slot: number;
  /** +0x2a (node +0x2f): only while the record is visible */
  needVisible: boolean;
  /** +0x30 (node +0x30): buttons that must go down (0 = walking in is enough) */
  keyMask: number;
  /** +0x34 (node +0x34): bits ORed into INTERACT_ICONS (var 0xc) when near; with a key mask a zero value becomes 2 */
  icon: number;
}

export function decodeStartCsm(a: ArgView): StartCsmArgs {
  const count = a.i8(0x16);
  const wps: number[] = [];
  if (count === 0) { const s = a.i16(0x14); if (s >= 0) wps.push(s); }
  else for (let i = 0; i < count; i++) wps.push(a.i16(i * 2));
  const keyMask = a.u32(0x30);
  let icon = a.u32(0x34);
  if (keyMask !== 0 && icon === 0) icon = 2;
  return {
    waypoints: wps, map: wps.length ? a.u8(0x17) : 0, radius: a.f32(0x18), opVar: a.i32(0x1c), opValue: a.i32(0x20), op: a.i16(0x24),
    walkTo: a.u8(0x26) !== 0, slot: a.i16(0x28), needVisible: a.u8(0x2a) !== 0, keyMask, icon,
  };
}

export class StartCsmNode implements BehaviourNode {
  readonly kind = 'StartCSM';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly a: StartCsmArgs;
  /** node +0x1c / +0x20 */
  readonly r2: number; readonly r2icon: number;
  /** node +0x38: the slot, then SLOT_FIRED / SLOT_DONE */
  slot: number;
  /** node +0x3a */
  armed = false;
  /** port only (not saved): the cutscene's voices were asked to be read ahead */
  prefetched = false;
  /** node +0x3c: index of the nearest waypoint (never written by the constructor: 0xCDCDCDCD from the debug heap, the first armed update sets it) */
  nearest = CD32;
  /** node +0x3b: padding byte of the saved block (never written by the original's code: the constructor's allocation leaves it 0) */
  pad3b = CD;
  /**
   * Save block = node +0x38 .. +0x40 (saver FUN_0051e13e returns 8 and points at node + 0x38, loader FUN_0051e163 is an 8 byte memcpy back):
   * +0 i16 slot, +2 u8 armed, +3 pad, +4 i32 nearest waypoint index. Port-only state is none: the saved bytes are the node's own state.
   */
  saveBlock(): Uint8Array {
    return new BlockOut(8).i16(0, this.slot).u8(2, this.armed ? 1 : 0).u8(3, this.pad3b).i32(4, this.nearest).bytes;
  }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.slot = b.i16(0); this.armed = b.u8(2) !== 0; this.pad3b = b.u8(3); this.nearest = b.i32(4);
  }
  constructor(a: StartCsmArgs) {
    this.a = a;
    this.slot = a.slot;
    if (a.waypoints.length) {
      const r = ml(a.radius, RADIUS_SCALE);
      this.r2 = ml(r, r);
      const r2 = ad(r, r);
      this.r2icon = ml(r2, r2);
    } else { this.r2 = NO_RADIUS; this.r2icon = CDF; }   // (node +0x20 is not written without waypoints: 0xCD)
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const a = this.a, V = w.vars;
    if (this.slot === SLOT_DONE) return NODE_NONE;
    const c = tryCtx(w);
    if (!c || c.cutsceneActive()) return NODE_NONE;
    if (!rec.enabled && a.needVisible) return NODE_NONE;
    if (this.slot === SLOT_FIRED) {
      applyOp(w, rec, a.op, a.opVar, a.opValue);
      this.slot = SLOT_DONE;
      return NODE_NONE;
    }
    const pc = V.get(VAR_PEPPER_CONTROL);
    const pep = w.focus;
    if (!this.armed) {
      if (!a.waypoints.length) this.armed = true;
      else {
        if (!pep) return NODE_NONE;
        this.nearest = -1;
        let best = NO_RADIUS;
        const p = [0, 0, 0];
        for (let i = 0; i < a.waypoints.length; i++) {
          waypoints.nodePos(a.map, a.waypoints[i], p);
          const dx = sb(p[0], pep.x), dy = sb(p[1], pep.y), dz = sb(p[2], pep.z);
          const d = ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz));
          if (d <= best) { this.nearest = i; best = d; }
        }
        if (a.keyMask === 0 && a.icon !== 0 && best < this.r2icon) V.or(VAR_INTERACT_ICONS, a.icon);
        // port: Pepper is within twice the trigger's radius: read the cutscene's voices ahead (its first line is said the moment it starts; src/audio/speech.ts)
        if (!this.prefetched && this.slot >= 0 && best < this.r2 * 4) { this.prefetched = true; c.prefetchCutscene?.(this.slot); }
        if (this.r2 < best || (pc & 0x1d) === 0) return NODE_NONE;
        if ((w.input.pressed & a.keyMask) !== a.keyMask) { V.or(VAR_INTERACT_ICONS, a.icon); return NODE_NONE; }
        if (a.keyMask === 0) {
          if ((pc & 8) !== 0 && vehicleState(w) !== -1) return NODE_NONE;
          this.armed = true;
          // not on foot (vehicle / skateboard / swimming): ask the mode node to put Pepper down (0x1000) and fire once he walks
          if ((pc & 0x11) === 0) { V.or(VAR_PEPPER_CONTROL, 0x1000); return NODE_NONE; }
        } else {
          V.set(VAR_PEPPER_CONTROL, 0x100);
          this.armed = true;
        }
      }
    } else if ((pc & 0x11) === 0 || (pc & 0x401) === 0x401 || pep?.anim?.clip === CLIP_BLOCKS_TRIGGER) return NODE_NONE;
    // fire
    V.andNot(VAR_PEPPER_CONTROL, 0x1000);
    if (this.slot >= 0) c.startCutscene(this.slot);
    if (a.walkTo && pep?.ctrl?.walker && a.waypoints.length && this.nearest >= 0) waypoints.teleport(pep.ctrl.walker, a.waypoints[this.nearest]);
    this.slot = SLOT_FIRED;
    return NODE_NONE;
  }
}

// ----------------------------------------------------------------------------- the box portal

/** the argument block FUN_0051ea3c reads */
export interface PortalArgs {
  /** +0x00 / +0x04 / +0x08 (node +0x14..0x1c): half extents of the box around the portal record */
  half: [number, number, number];
  /** +0x0c / +0x10 (node +0x24 / +0x28): variable ORed with the value while the player is in the box (cleared when out of range) */
  orVar: number; orBits: number;
  /** +0x14 short (node +0x2c): 0 = test the focus record, n > 0 = the records of row n - 1 of the portal vehicle table (FUN_0051e475) */
  table: number;
  /** +0x18 short (node +0x2e): zone written to var 5 (0 = none) */
  target: number;
  /** +0x1a (node +0x30): turn to the camera; +0x1b (node +0x31): spin about x */
  faceCamera: boolean; spin: boolean;
  /** +0x1c (node +0x34): buttons that must go down (0: walking in) */
  keyMask: number;
  /** +0x20 (node +0x38): INTERACT_ICONS bits (with a key mask a zero value becomes 2, node +0x38) */
  iconBits: number;
}
export function decodePortal(a: ArgView): PortalArgs {
  const keyMask = a.u32(0x1c);
  let iconBits = a.u32(0x20);
  if (keyMask !== 0 && iconBits === 0) iconBits = 2;
  return {
    half: [a.f32(0), a.f32(4), a.f32(8)], orVar: a.i32(0x0c), orBits: a.i32(0x10), table: a.i16(0x14), target: a.i16(0x18),
    faceCamera: a.u8(0x1a) !== 0, spin: a.u8(0x1b) !== 0, keyMask, iconBits,
  };
}

/** FUN_0051e475's table row `row` (0-based) as records (null entries for 0 pointers), from the emulated set-up's memory */
export function portalRow(w: World, row: number): (GameRecord | null)[] {
  const mem = tryCtx(w)?.setup?.mem;
  if (!mem || row < 0 || row > 1) return [null, null, null];
  return [0, 1, 2].map((i) => { const r = recIndexOfPtr(mem.u32(PORTAL_TABLE_VA + row * 12 + i * 4)); return r >= 0 ? w.records[r] ?? null : null; });
}

/** FUN_0051e4b0(group, hideOthers): show the vehicle var 0xbb selects from row group - 1 (hiding the others when asked); returns it (null when the slot is empty) */
export function showPortalVehicle(w: World, group: number, hideOthers: boolean): GameRecord | null {
  const row = portalRow(w, group - 1), sel = w.vars.get(VAR_PORTAL_VEHICLE);
  if (hideOthers) row.forEach((r, i) => { if (i !== sel && r) r.hide(); });
  const r = row[sel] ?? null;
  r?.show();
  return r;
}

export class PortalNode implements BehaviourNode {
  readonly kind = 'StartCSM.portal';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly a: PortalArgs;
  /** node +0x20 */
  readonly radius2: number;
  /** node +0x3c: distance^2 of the previous tick (-1 = out of range) */
  last = -1;
  /** node +0x40 */
  age = 0;
  fired = 0;
  /**
   * Save block = node +0x3c .. +0x44 (saver FUN_0051e9de returns 8 and points at node + 0x3c, loader FUN_0051ea03 is the 8 byte memcpy back): +0 f32 last distance^2 (-1 = out of range), +4 f32 age (ticks).
   */
  saveBlock(): Uint8Array { return new BlockOut(8).f32(0, this.last).f32(4, this.age).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.last = b.f32(0); this.age = b.f32(4);
  }
  constructor(a: PortalArgs) {
    this.a = a;
    this.radius2 = ad(ad(ad(ml(a.half[0], a.half[0]), ml(a.half[1], a.half[1])), ml(a.half[2], a.half[2])), PORTAL_RADIUS_BIAS);
  }
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const a = this.a, V = w.vars;
    this.age = ad(ml(1, fr(w.dt)), this.age);
    if (a.spin) rec.rx = wrapAngle(ad(rec.rx, PORTAL_SPIN));
    if (a.faceCamera) {
      const c = w.camera.c;
      rec.ry = wrapAngle(rec.ry);
      rec.ry = fr(Math.atan2(sb(rec.x, c[0]), sb(rec.z, c[2])) + PORTAL_FACE_OFFSET);   // (the sum of the unrounded atan2 and the constant, rounded once)
    }
    if (a.faceCamera || a.spin) rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    if (ctrl.distSq < this.radius2) {
      if (a.keyMask !== 0 || ctrl.distSq < this.last) {
        this.last = ctrl.distSq;
        if (this.age >= PORTAL_ARM_TICKS) {
          if (a.keyMask === 0 && a.iconBits !== 0) V.or(VAR_INTERACT_ICONS, a.iconBits);
          let t: GameRecord | null = null, sel = -1;
          if (a.table < 1) t = w.focus;
          else {
            portalRow(w, a.table - 1).forEach((r, i) => { if (r?.ctrl && r.ctrl.distSq < this.radius2) { t = r; sel = i; } });
            if (!t) return NODE_NONE;
          }
          const p = t as GameRecord | null;
          if (p && Math.abs(sb(rec.x, p.x)) <= a.half[0] && Math.abs(sb(rec.y, p.y)) <= a.half[1] && Math.abs(sb(rec.z, p.z)) <= a.half[2]) {
            if ((w.input.pressed & a.keyMask) === a.keyMask) {
              if (sel >= 0) V.set(VAR_PORTAL_VEHICLE, sel);
              if (a.keyMask !== 0) V.set(VAR_PEPPER_CONTROL, 0x100);
              V.or(a.orVar, a.orBits);
              if (a.target !== 0) V.set(VAR_NEXT_ZONE, a.target);
              this.fired++;
            } else V.or(VAR_INTERACT_ICONS, a.iconBits);
          }
        }
      } else this.last = ctrl.distSq;
    } else {
      V.andNot(a.orVar, a.orBits);
      this.last = -1;
    }
    return NODE_NONE;
  }
}

registerCtor(CTOR_STARTCSM, (at: Attach) => new StartCsmNode(decodeStartCsm(ArgView.of(at))));
registerCtor(CTOR_PORTAL, (at: Attach) => new PortalNode(decodePortal(ArgView.of(at))));
