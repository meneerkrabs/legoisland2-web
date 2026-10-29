// The generic box portal of StartCSM.c (constructor FUN_0051ea3c, vtable 0x8ea088, update FUN_0051e5ab): a record that spins / turns to the camera and, when the player
// walks into its box, writes a game variable and the next zone (var 5). z50LTC attaches one to the record PORC (the wormhole back to the island) with the argument
// block FUN_00839748 builds; the node keeps every field of the original so the island's portals can reuse it (docs/re/m3/z50LTC.md).
import { NODE_NONE } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { f32, subf, addf, dist32, wrapAngle32, setRotationExact } from '../f32math.ts';

/** the argument block of the constructor (the words FUN_00839748 stores into its frame buffer at 0x8399xx; `FUN_0051ea3c` copies it into the node) */
export interface PortalArgs {
  /** +0x00 / +0x04 / +0x08 (node +0x14..0x1c): half extents of the box around the portal record (|dx|, |dy|, |dz| of player to record) */
  half: [number, number, number];
  /** +0x0c / +0x10 (node +0x24 / +0x28): a game variable and the bits ORed into it while the player is inside (cleared outside); var index 0 / bits 0 = nothing */
  orVar: number; orBits: number;
  /** +0x14 (node +0x2c): 0 = test the focus record, n > 0 = test the n-th entry of a record table (DAT_05d58688, not used here) */
  table: number;
  /** +0x18 (node +0x2e): the zone written to var 5 when the portal fires (0 = none) */
  target: number;
  /** +0x1a (node +0x30): the record turns to the camera every tick; +0x1b (node +0x31): it spins about its x axis by 0.0087266 rad per tick */
  faceCamera: boolean; spin: boolean;
  /** +0x1c (node +0x34): button mask the player has to press (0 = walking in is enough) */
  keyMask: number;
  /** +0x20 (node +0x38): bits ORed into var 0xc (the interaction icon) while the player is in range */
  iconBits: number;
}

/** 0x8921f4: added to the squared half extents for the proximity radius of node +0x20 */
export const RADIUS_BIAS = 16;
/** 0x892590: spin per tick (0.5 degree), a float constant */
export const SPIN_STEP = Math.fround(0.0087266);
/** 0x892220: turn to the camera + pi / 2 (the float 1.5707964, not 1.5708) */
export const FACE_OFFSET = Math.fround(Math.PI / 2);
/** the node ignores the player for its first 30 ticks (node +0x40 counts up by dt) */
export const ARM_TICKS = 30;

export class PortalNode implements BehaviourNode {
  readonly kind = 'StartCSM.portal';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly a: PortalArgs;
  /** node +0x20 */
  readonly radius2: number;
  /** node +0x3c: squared distance of the previous tick (-1 = none) */
  last = -1;
  /** node +0x40 */
  age = 0;
  /** number of times it fired (diagnostics) */
  fired = 0;
  /** node +0x38: the icon bits (FUN_0051ea3c: with a key mask a zero block value becomes 2) */
  readonly icon: number;
  /** DAT_05d58688: rows of 3 records (FUN_0051e475 fills them from the roster functions): the table variant (`a.table` = row + 1) tests the controller distance of these instead of the focus record */
  table: (GameRecord | null)[][] = [];
  constructor(a: PortalArgs, table: (GameRecord | null)[][] = []) {
    this.a = a;
    this.table = table;
    this.radius2 = Math.fround(a.half[2] * a.half[2] + a.half[1] * a.half[1] + a.half[0] * a.half[0] + RADIUS_BIAS);
    this.icon = a.keyMask === 0 ? a.iconBits : (a.iconBits === 0 ? 2 : a.iconBits);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const a = this.a;
    const distSq = dist32(rec, w.focus);
    this.age = Math.fround(this.age + 1 * w.dt);
    if (a.spin) rec.rx = wrapAngle32(addf(rec.rx, SPIN_STEP));
    if (a.faceCamera) {
      const c = w.camera.c;
      rec.ry = wrapAngle32(rec.ry);
      rec.ry = f32(Math.atan2(subf(rec.x, f32(c[0])), subf(rec.z, f32(c[2]))) + FACE_OFFSET);
    }
    if (a.faceCamera || a.spin) setRotationExact(rec.m, rec.rx, rec.ry, rec.rz);
    if (distSq < this.radius2) {
      if (a.keyMask !== 0 || distSq < this.last) {
        this.last = distSq;
        if (this.age >= ARM_TICKS) {
          if (a.keyMask === 0 && this.icon !== 0) w.vars.or(0xc, this.icon);
          // the record the box is tested against: the focus (table 0), or the last record of row `table - 1` of DAT_05d58688 whose controller is nearer than the radius
          let target: GameRecord | null = w.focus, slot = -1;
          if (a.table > 0) {
            target = null;
            const row = this.table[a.table - 1];
            for (let i = 0; i < 3; i++) { const r = row?.[i]; if (r && r.ctrl && dist32(r, w.focus) < this.radius2) { target = r; slot = i; } }
          }
          if (target) {
            const inBox = Math.abs(subf(rec.x, target.x)) <= a.half[0] && Math.abs(subf(rec.y, target.y)) <= a.half[1] && Math.abs(subf(rec.z, target.z)) <= a.half[2];
            if (inBox) {
              if ((w.input.pressed & a.keyMask) === a.keyMask) {
                if (slot > -1) w.vars.set(0xbb, slot);          // PORTAL_VEHICLE: which of the three records entered
                if (a.keyMask !== 0) w.vars.set(0x5e, 0x100);
                w.vars.or(a.orVar, a.orBits);
                if (a.target !== 0) w.vars.set(5, a.target);
                this.fired++;
              } else w.vars.or(0xc, this.icon);
            }
          }
        }
      } else this.last = distSq;
    } else {
      w.vars.andNot(a.orVar, a.orBits);
      this.last = -1;
    }
    return NODE_NONE;       // every path of FUN_0051e5ab ends with xor eax, eax: the node never counts as having run
  }
}
