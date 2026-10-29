// WP-VERIFY M7 (fork B): helpers of the Footy.c oracle (football BALL 0x53955e, flowers FLR1 / FLR2 0x5399d8, LOON 0x539d44) on top of tools/lib/m7-isl-veh-emu.mjs.
// Stand-ins (identical in both worlds, NOT the subject): the three kids XXX0 / XXX1 / XXX2 are the other worker's Human1 / Turn2Pep nodes; here each kid record carries ONE head node whose only
// meaning is its game variable (MOVE_XXXn 0x73 / 0x74 / 0x75: the ball reads / sets bits of it: FUN_004238f9 / FUN_004239b3) and the byte +0x36 "falling" (FUN_005389d9's test); the kid's clip
// (kick clip 0x1d, read by FUN_00538e0b through FUN_0043b72b / FUN_0043b73f) and position are scripted by the test.
import { Duel, REC, RECORDS_BASE } from './m7-isl-veh-emu.mjs';
import { Controller, NODE_NONE } from '../../src/game/controller.ts';
import { AnimInstance } from '../../src/game/anim.ts';

/** the kid stand-ins: a head node in the port and in the original's memory (a host-update node with a 0x40 byte block) */
export function installKids(d, names = ['XXX0', 'XXX1', 'XXX2']) {
  const W = d.P.world, emu = d.emu, mem = emu.cpu.mem;
  const kids = [];
  const att = d.O.profile.island.attaches;
  for (const n of names) {
    const idx = W.records.findIndex((r) => r.name === n);
    const a = att.find((x) => x.record === idx);
    const vr = a ? a.var : 0x73;
    const pn = { kind: 'kidstub', var: vr, mask: 0, value: 0, stamp: 0xfffffffe, falling: 0, update: () => NODE_NONE };
    const ctrl = new Controller(); ctrl.flags = 6; ctrl.nodes.push(pn);
    W.records[idx].ctrl = ctrl;
    emu.controller(idx, 6);
    const node = emu.stub(idx, { var: vr, mask: 0, value: 0 }, (c) => { c.eax = 0; });
    // the kids' animation instances (the NPC nodes' constructors create them in the game; the rig is the player's MFIG): one per world, registered in the emulation like IslEmu's constructor does for existing ones
    const rig = d.P.pepper.anim.rig;
    for (const w of [d.P.world, d.O.world]) { w.records[idx].anim = new AnimInstance(rig); w.records[idx].anim.start(0, 0); }
    const aptr = emu.alloc(16);
    emu.anims.set(aptr, d.O.world.records[idx].anim); emu.animRec.set(aptr, idx); mem.w32(RECORDS_BASE + idx * REC + 8, aptr);
    kids.push({ idx, name: n, var: vr, pn, node, kick: -1, fetchLeft: 0, near: 0, nearLeft: 0, fallLeft: 0 });
  }
  void mem; void REC; void RECORDS_BASE;
  return kids;
}

/** put a record at a spot in both worlds */
Duel.prototype.placeRec = function (i, x, y, z, ry) {
  for (const w of [this.P.world, this.O.world]) { const r = w.records[i]; r.setEuler(0, ry, 0, x, y, z); r.rx = 0; r.ry = ry; r.rz = 0; }
  this.emu.putRecord(i, this.O.world.records[i]);
  this.emu.sync();
};

/** set a kid's falling byte in both worlds */
export function setFalling(d, k, v) { k.pn.falling = v; d.emu.cpu.mem.w8(k.node + 0x36, v); }

/** `origDrop(line)` marks lines of the original's call log that are inaudible / not part of the comparison (counted in `silent`): applied before Duel.sounds() compares */
const baseSounds = Duel.prototype.sounds;
Duel.prototype.sounds = function () {
  if (!this.origDrop) return baseSounds.call(this);
  const keep = this.olog;
  this.olog = keep.filter((l) => { if (this.origDrop(l)) { this.silent = (this.silent ?? 0) + 1; return false; } return true; });
  try { return baseSounds.call(this); } finally { this.olog = keep; }
};
