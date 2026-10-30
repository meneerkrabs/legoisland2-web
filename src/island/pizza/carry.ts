// Pizza.c, the "carried prop" node (0x429638..0x429e00): a record held at a bone of another record (the carrier), dropped on the ground with a timer.
// Ported from the decompile of
//   FUN_00429d1b  constructor (node 0x44 bytes, handler table 0x8adf50 { FUN_00429794, -, FUN_00429dd6, FUN_0042992a, load FUN_00429c73, save FUN_00429baa })
//   FUN_00429794  update: carried -> runs (1 / 2 by the gate var's value); dropped -> one push, a ground probe, lying flat until the timer ends
//   FUN_0042992a  draw: the record at the carrier's bone (or at an offset of the carrier's matrix when bone < 1)  -> CarryNode.prerender
//   FUN_00429638  attach to a carrier (the cutscene command at 0x45d2b9 = ATTACH, the story handler FUN_004b7040)     -> attachCarry
//   FUN_004296a2  release by the carrier with a lying time (Turn2Pep FUN_0053004b / MeetPepp FUN_005309c0: 480 ticks)  -> releaseCarry
//   FUN_004295cb  scale of the carrier's matrix (no caller in the executable)                                     -> scaleCarry
// Records: PIZ3 (era 0 / 4: the pizza box, bone 16, offset (0, -1, 0), gate MOVE_PIZ3 (0xb4) & 0 = 0; DAT_009da7d4 = PIZ3 is the box the customers take),
// CNST (the Constructopedia, bone 14, (0, -0.8, 0), gate MOVE_CNST 0xb5), RHCP (bone 16, (0, 0, 0)), BRIK (bone 0, offset 0, carrier 4?), PAPA / MAMA (era 3).
// The carrier pointer of the argument block is 0 everywhere in the island: the cutscenes attach the props (ATTACH <prop> <actor> <bone>).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { CF_ENABLED, NODE_NONE, NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_FRUSTUM } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { eulerRotation, eulerScaledMatrix, toWorld } from '../../zones/exact.ts';
import { ad, ml, sb } from '../../zones/common/f32.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView } from '../args.ts';
import { HALF_PI_F, placeAtBone } from './common.ts';
import { BlockIn, BlockOut } from '../blockio.ts';
import { CD_F32, CD_I32, findByTag, recPtr, recordHeader } from './saveutil.ts';

export const CTOR_CARRY = 0x429d1b;

export const CARRY = {
  /** FUN_004296a2: the release push = carrier forward * 1.4 (0x8920f8) */
  PUSH: 1.399999976158142,
  /** FUN_00429794: ground probe from y + 8 (0x892090) down 40 (0xc2200000), mask 0x43, radius 1.0, skin 0.01 */
  PROBE_UP: 8, PROBE_DOWN: 40, PROBE_MASK: 0x43, PROBE_RADIUS: 1.0, PROBE_SKIN: 0.009999999776482582,
  /** Turn2Pep / MeetPepp release time (0x43f00000) */
  RELEASE_TICKS: 480,
} as const;

/** argument block (FUN_00429d1b reads 5 words): +0 bone (i32), +4 / +8 / +0xc offset, +0x10 carrier record pointer */
export class CarryNode implements BehaviourNode {
  readonly kind = 'PizzaCarry';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** +0x14..+0x1c: offset in the bone's (or the carrier's) space */
  off: [number, number, number];
  /** +0x20: bone of the carrier (< 1: offset from the carrier's matrix) */
  bone: number;
  /** +0x24: carrier record (null: not carried) */
  carrier: GameRecord | null;
  /** argument record index of the carrier (resolved on the first update) */
  private carrierIdx: number;
  /** +0x28: the gate var's value at the last update (the draw returns 1 when it is 1, else 2); 0xCD words until then (debug heap) */
  varValue = CD_I32;
  /** +0x2c / +0x30: scale the carrier's matrix by `scale` (FUN_004295cb) */
  scaled = false; scale = 1.0;
  /** FUN_00429638(ctrl, a, b) as the story handler calls it (records 12 / 13) */
  storyReset(a: GameRecord | null | 0, b: number) { this.carrier = a || null; this.bone = b; this.timer = 0; this.pushPending = false; }
  /** +0x2e: the push of the release is pending; +0x34: lying time left; +0x38..+0x40: the push */
  pushPending = false; timer = CD_F32; push: [number, number, number] = [CD_F32, CD_F32, CD_F32];

  constructor(args: ArgView, attach?: Pick<Attach, 'var' | 'mask' | 'value'>) {
    this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    this.bone = args.i32(0);
    this.off = [args.f32(4), args.f32(8), args.f32(0xc)];
    this.carrierIdx = args.recIndex(0x10);
    this.carrier = null;
  }

  /**
   * Save block (saver FUN_00429baa, 72 bytes): node +0x20 .. +0x44 raw (0x24 bytes) and then 0x24 more bytes:
   * 0x00 i32 bone (+0x20)   0x04 u32 carrier record pointer (+0x24)   0x08 u32 varValue (+0x28)   0x0c u16 scaled (+0x2c)   0x0e u16 pushPending (+0x2e)   0x10 f32 scale (+0x30)   0x14 f32 timer (+0x34)
   * 0x18 f32[3] push (+0x38).   0x24..0x47: with a carrier the first 0x24 bytes of the carrier's record header (tag, model ptr, animation ptr, six matrix floats); with none (the word is 0 or 1) the
   * saver copies 0x24 bytes starting at its own stack local `local_18` (= the pointer word, then DAT_009da8bc, DAT_009da8c0 + stack padding, local_c = 0x24, then the destination address in the save
   * buffer, saved ebp, return address, the two arguments): 0x24 u32 word, 0x28 DAT_009da8bc (0), 0x2c u16 DAT_009da8c0 (0), 0x30 u32 0x24, the rest is garbage of the process (written as 0; the tests
   * mask 0x2e..0x2f and 0x34..0x47 here, and the model / animation pointers 0x28..0x2f of a carrier header).
   * The fields the constructor never writes keep the debug heap's 0xCD (see the field defaults).
   */
  saveBlock(w: World, _rec: GameRecord, _c: Controller): Uint8Array {
    const b = new BlockOut(0x48);
    const car = this.carrier ?? (this.carrierIdx >= 0 ? w.records[this.carrierIdx] ?? null : null);
    b.i32(0x00, this.bone).u32(0x04, recPtr(car)).u32(0x08, this.varValue).u16(0x0c, this.scaled ? 1 : 0).u16(0x0e, this.pushPending ? 1 : 0).f32(0x10, this.scale).f32(0x14, this.timer);
    for (let k = 0; k < 3; k++) b.f32(0x18 + 4 * k, this.push[k]);
    if (car) recordHeader(car, b.bytes, 0x24);
    else b.u32(0x24, 0).u32(0x30, 0x24);
    return b.bytes;
  }
  /** FUN_00429c73: the 0x24 bytes back, then the pointer word: 0 / 1 stay as they are (the port has no "1"), else the record whose tag it is (FUN_00419a79) */
  loadBlock(w: World, _rec: GameRecord, _c: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.bone = b.i32(0x00); this.varValue = b.i32(0x08); this.scaled = b.u16(0x0c) !== 0; this.pushPending = b.u16(0x0e) !== 0; this.scale = b.f32(0x10); this.timer = b.f32(0x14);
    for (let k = 0; k < 3; k++) this.push[k] = b.f32(0x18 + 4 * k);
    const t = b.u32(0x24);
    this.carrier = t === 0 || t === 1 ? null : findByTag(w, t);
    this.carrierIdx = -1;
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    if (this.carrierIdx >= 0) { this.carrier = w.records[this.carrierIdx] ?? null; this.carrierIdx = -1; }
    if (this.carrier) {
      this.varValue = w.vars.get(this.var);
      return this.varValue === 1 ? NODE_STOP : NODE_CONTINUE;
    }
    if (this.timer > 0) {
      if (this.pushPending) {
        this.pushPending = false;
        rec.x = ad(rec.x, this.push[0]); rec.y = ad(rec.y, this.push[1]); rec.z = ad(rec.z, this.push[2]);
        const h = w.col.sweep(rec, [rec.x, ad(rec.y, CARRY.PROBE_UP), rec.z], [0, -CARRY.PROBE_DOWN, 0], CARRY.PROBE_MASK, CARRY.PROBE_RADIUS, CARRY.PROBE_SKIN);
        if (h) { rec.x = h.point[0]; rec.y = h.point[1]; rec.z = h.point[2]; }
        eulerRotation(rec.m, HALF_PI_F, 0, 0);   // FUN_0043a4a1(m, pi/2, 0, 0): lying flat (translation untouched)
      }
      this.timer = sb(this.timer, ml(1.0, w.dt));
      if (this.timer <= 0) { this.timer = 0; rec.flags &= ~RF_ENABLED; }
    }
    return NODE_NONE;
  }

  /** FUN_0042992a (the draw hook; the port has no node draw pass, the matrix is set after the update instead) */
  prerender(_w: World, rec: GameRecord, _c: Controller) {
    void _w; void _c;
    const car = this.carrier;
    if (!car) return;
    rec.flags |= RF_ENABLED | RF_FRUSTUM;
    const cm = this.scaled ? eulerScaledMatrix(car.rx, car.ry, car.rz, car.x, car.y, car.z, this.scale, this.scale, this.scale) : car.m;
    if (this.bone < 1) {
      rec.m.set(cm);
      const p = toWorld(car.m, this.off);   // FUN_0043ab72(rec + 0x3c, carrier matrix, offset)
      rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
    } else placeAtBone(rec, car, this.bone, this.off, cm);
  }

  /** FUN_00429dd6: DAT_009da870 = 0 (the pizza hand-over target) */
  destroy() { /* the hand-over target lives in PizzaSystem; nothing else to free */ }
}

const carryOf = (rec: GameRecord): CarryNode | null => (rec.ctrl?.nodes.find((n) => n instanceof CarryNode) as CarryNode | undefined) ?? null;

/** FUN_00429638(ctrl, carrier, bone) as the cutscene ATTACH (FUN_0045d2b9) calls it: also enables the prop's controller (flags |= 2). False when the record has no carry node. */
export function attachCarry(rec: GameRecord, carrier: GameRecord | null, bone: number): boolean {
  const n = carryOf(rec);
  if (!n) return false;
  n.carrier = carrier; n.bone = bone; n.timer = 0; n.pushPending = false;
  if (rec.ctrl) rec.ctrl.flags |= CF_ENABLED;
  return true;
}

/** FUN_00429638(ctrl, carrier, bone) alone (the story handler's call, FUN_00429638(ctrl, 0, 0)): carrier, bone, timer and push flag are written, the controller flags stay */
export function storyResetCarry(rec: GameRecord, carrier: GameRecord | null, bone: number): boolean {
  const n = carryOf(rec);
  if (!n) return false;
  n.carrier = carrier; n.bone = bone; n.timer = 0; n.pushPending = false;
  return true;
}

/** FUN_004296a2(ctrl, carrier, ticks): only when `carrier` holds it; ticks > 0: pushed by the carrier's forward * 1.4 and lying there for `ticks` */
export function releaseCarry(rec: GameRecord, carrier: GameRecord, ticks: number): boolean {
  const n = carryOf(rec);
  if (!n || n.carrier !== carrier) return false;
  n.carrier = null; n.bone = 0;
  n.timer = ticks;
  if (ticks > 0) n.pushPending = true;
  n.push = [ml(carrier.m[8], CARRY.PUSH), ml(carrier.m[9], CARRY.PUSH), ml(carrier.m[10], CARRY.PUSH)];
  return true;
}

/** FUN_004295cb(ctrl, s) */
export function scaleCarry(rec: GameRecord, s: number) {
  const n = carryOf(rec);
  if (!n) return;
  n.scale = s; n.scaled = s !== 1.0;
}

/** DAT_009da7d4: the pizza box the customers take (PIZ3 with its carry node; eras 0 and 4), null when the era has none */
export function carriedPizza(w: World): GameRecord | null {
  const r = w.records.find((x) => x.name === 'PIZ3');
  return r && carryOf(r) ? r : null;
}

/** the carry node of a record (tests, WP2's ATTACH) */
export const carryNodeOf = carryOf;

registerCtor(CTOR_CARRY, (a) => new CarryNode(ArgView.of(a), a));
