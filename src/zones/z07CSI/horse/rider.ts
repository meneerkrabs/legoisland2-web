// The riders and the saddles that follow the horse (Common\Z07CSI\Horse.c, the other two constructors of the file).
//
// Rider (ctor FUN_00579725, node 0x18 bytes, handler table 0x8f85e8 = { update FUN_00579379, pre-render FUN_005793c1, destroy FUN_0057979f, draw FUN_0057968b (default draw), save
// FUN_005796ec (1 byte at +0x15), size FUN_005796c7 }): two attaches, on Pepper (PEPP = 7, position 5 of her chain, gate PEPPER_CONTROL & 0x10 == 0x10) and on the jockey kit JKIT (46, gate
// always open). The pose of the rider = the horse's: its matrix and Euler angles are copied from HORS (the translation / angles at `DAT_00983804 + 0x13bc / 0x13cc`: the record +0x3c / +0x4c)
// and the animation clip is chosen from the horse's clip (0xb8 / 0xb7 / 0xb1 / 0xb9 normally, 0xbc / 0xc6 / 0xb1 / 0x8b in the stages 22 .. 24) at the horse's frame.
//   update: the record is visible while PEPPER_CONTROL & 0x10 (returns 1 = stop the chain, the node is the last of Pepper's chain);
//   pre-render: story node 22 .. 24 (the jousting stages, var 0x58) shows the jockey kit instead of Pepper: PEPP visible unless the story is 22..24, JKIT the other way round.
//
// Saddle (ctor FUN_00579948, node 0x20 bytes, handler table 0x8f8600 = { update FUN_005797cf, pre-render FUN_0057987e (returns 1), destroy FUN_005799d9, draw FUN_00579898, save FUN_0057990f
// (1 byte at +0x1c), size FUN_005798ea }): RSAD / GSAD / CLOK (51 / 52 / 53, gate var 2 & 1 == 1 = always open): the horse's cloth and saddle parts copy the horse's matrix (the 16 dwords at
// `+ 0x138c`), its Euler angles and its animation (clip and frame) every tick. The attach's argument block holds two dwords (+0x14 / +0x18: 21 / 25 for the saddles, 22 / 24 for the cloak) the
// handlers never read.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import type { Attach } from '../../../formats/zonesetup.ts';
import { NODE_STOP } from '../../../game/controller.ts';
import { f } from './math.ts';
import { setEulerExact } from './math.ts';
import { REC_HORSE } from './hors.ts';
import { applyEmulatedSetupState } from './setup.ts';
import { BlockIn, BlockOut } from '../blockio.ts';

export const CTOR_RIDER = 0x579725, CTOR_SADDLE = 0x579948;
/** the record PEPP (`DAT_00983804 + 0x2d8` = 7) */
const REC_PEPPER = 7;
/** var 0x58 (FSM_CURRENT_STATE): the stages 22 .. 24 show the jockey kit (`0x16 <= node <= 0x18`) */
const VAR_STORY = 0x58;

/** the clip of the rider for the horse's clip (`FUN_0043b72b(HORS)`: 3 gallop, 4 the stop, 6 the jump): in the stages 22 .. 24 (var 0x58) the jousting kit's clips, else Pepper's */
const JOUST_CLIPS = { 3: 0xc6, 4: 0xb1, 6: 0x8b, other: 0xbc } as const;
const NORMAL_CLIPS = { 3: 0xb7, 4: 0xb1, 6: 0xb9, other: 0xb8 } as const;

export class RiderNode implements BehaviourNode {
  readonly kind = 'Horse';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** the byte at +0x15 (inside the dword +0x14 that the constructor never writes: a fresh heap block's byte); only kept so that a loaded block is saved again unchanged */
  byte15 = 0xcd;
  constructor(_a?: Pick<Attach, 'var' | 'mask' | 'value'>) { void _a; }
  /** save FUN_005796c7 (vtable +0x14): `*out = node + 0x15; return 1` */
  saveBlock(): Uint8Array { return new BlockOut(1).u8(0, this.byte15).bytes; }
  /** load FUN_005796ec (vtable +0x10): memcpy of the byte back to node + 0x15 */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.byte15 = new BlockIn(data).u8(0); }

  /** FUN_00579379(rec, node, ctrl, var value): visible while the variable's 0x10 bit is set */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const on = (w.vars.get(this.var) & 0x10) !== 0;
    if (on) rec.flags |= 2; else rec.flags &= ~2;
    return on ? NODE_STOP : 0;
  }

  /** FUN_005793c1(rec, node) */
  prerender(w: World, rec: GameRecord, _ctrl: Controller): void {
    void _ctrl;
    const story = w.vars.get(VAR_STORY) | 0;
    const normal = story < 0x16 || 0x18 < story;                 // not a jousting stage
    const pepper = rec === w.records[REC_PEPPER];
    if (pepper && normal) rec.flags |= 2;
    else if (pepper || normal) rec.flags &= ~2;
    else rec.flags |= 2;
    const horse = w.records[REC_HORSE];
    const hc = horse.anim?.clip ?? 0, hf = horse.anim?.frame ?? 0;
    const T = normal ? NORMAL_CLIPS : JOUST_CLIPS;
    const clip = hc === 3 ? T[3] : hc === 4 ? T[4] : hc === 6 ? T[6] : T.other;
    rec.anim?.start(clip, hf);
    rec.rx = horse.rx; rec.ry = horse.ry; rec.rz = horse.rz;     // +0x4c .. +0x54 := HORS's
    setEulerExact(rec, rec.rx, rec.ry, rec.rz, horse.m[12], horse.m[13], horse.m[14]);
  }
}

export class SaddleNode implements BehaviourNode {
  readonly kind = 'Horse';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** +0x14 / +0x18: the attach's two argument dwords */
  arg0 = 0; arg1 = 0;
  constructor(a?: Pick<Attach, 'var' | 'mask' | 'value'> & { argWords?: ArrayLike<number> }) {
    if (a?.argWords) { this.arg0 = a.argWords[0] | 0; this.arg1 = a.argWords[1] | 0; }
  }
  /** the set-up's final visibility is applied once, at the first update (setup.ts; tests that place the record themselves set it) */
  setupApplied = false;
  /** the byte at +0x1c (past the two argument dwords; the constructor never writes it: a fresh heap block's byte); only kept so that a loaded block is saved again unchanged */
  byte1c = 0xcd;
  /** save FUN_005798ea (vtable +0x14): `*out = node + 0x1c; return 1` */
  saveBlock(): Uint8Array { return new BlockOut(1).u8(0, this.byte1c).bytes; }
  /** load FUN_0057990f (vtable +0x10): memcpy of the byte back to node + 0x1c */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.byte1c = new BlockIn(data).u8(0); }

  /** FUN_005797cf(rec, ...): the horse's matrix, angles and animation */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    if (!this.setupApplied) { this.setupApplied = true; applyEmulatedSetupState(w, rec); }   // the cloth / saddle parts are shown or hidden by the stage's set-up
    const horse = w.records[REC_HORSE];
    rec.m.set(horse.m);
    rec.rx = horse.rx; rec.ry = horse.ry; rec.rz = horse.rz;
    if (rec.anim && horse.anim) rec.anim.start(horse.anim.clip, f(horse.anim.frame));
    return (rec.flags & 2) !== 0 ? NODE_STOP : 0;                // returns whether the record is visible
  }
  prerender(): void { /* FUN_0057987e returns 1 */ }
}

export const riderFactory = (a: Attach) => new RiderNode(a);
export const saddleFactory = (a: Attach) => new SaddleNode(a);
