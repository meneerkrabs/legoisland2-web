// The flowing-water node of z13CAI (seabed.c, constructor FUN_00426f55, handler table 0x8ade18 = { update FUN_00426e74 (returns 1), pre-render FUN_00426e87 (returns 1),
// destroy FUN_00426fde, draw FUN_00426e9a, save FUN_00426f2d / FUN_00426f0f (node + 0x1c) }) on the records LAVA (5, argument block {0.0025 = 0x3b23d70a, 0}) and FALL (6,
// {0.01 = 0x3c23d70a, 0}): the set-up attaches it at position 0 with the gate (var 2, mask 1, value 1), so it is always on and stops the record's chain.
// The behaviour is in the DRAW hook FUN_00426e9a: every drawn frame `FUN_0043ebe0(model, 0, &node[6], &node[5])` adds (du, dv) = (node +0x18, node +0x14) to the texture
// coordinates of part 0's mesh, then FUN_0043f1a0 draws that mesh at the record's matrix (no visibility flags, no LOD test). The renderer owns that hook
// (`GameRenderer.flow`, src/game/render.ts, WP-RENDER: it must add (du, dv) ONCE PER SIM STEP = once per drawn frame of the original at 60 Hz (`n = world.tickCount - lastSeen` times per rAF call), NOT scaled by dt or by the elapsed time: FUN_0043ebe0 gets the node's two words by pointer and adds them as they are; it reads the argument words of every attach of this constructor, docs/re/rendering.md section 10); this node is the
// controller half (update = 1 = "ran, stop") so that the attach is not skipped and the controller chain is the original's.
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView } from '../../island/args.ts';
import { BlockIn, BlockOut } from '../z07CSI/blockio.ts';
import type { Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';

export const CTOR_FLOW = 0x426f55;

export class FlowNode implements BehaviourNode {
  readonly kind = 'seabed.c';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** node +0x14 / +0x18: the argument words (the texture shift per drawn frame: the renderer's `flow` entry has the same values) */
  readonly dv: number; readonly du: number;
  constructor(a: ArgView) { this.dv = a.f32(0); this.du = a.f32(4); }
  /** the byte at +0x1c (the constructor writes +0x14 / +0x18 only; the dword at +0x1c is a fresh heap block's): kept so that a loaded block is saved again unchanged */
  byte1c = 0xcd;
  /** save FUN_00426f0f (vtable +0x14): `*out = node + 0x1c; return 1` */
  saveBlock(): Uint8Array { return new BlockOut(1).u8(0, this.byte1c).bytes; }
  /** load FUN_00426f2d (vtable +0x10): memcpy of the byte back to node + 0x1c */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.byte1c = new BlockIn(data).u8(0); }
  /** FUN_00426e74 */
  update(): number { return NODE_STOP; }
  /** FUN_00426e87 */
  prerender(): void { /* returns 1 */ }
}

export const flowFactory = (a: Attach) => new FlowNode(ArgView.of(a as Attach & { args?: Uint8Array }));
