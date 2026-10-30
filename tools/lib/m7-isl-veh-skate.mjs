// WP-VERIFY M7 island skateboard (skate.c, FUN_00490e2e update / FUN_004928d2 pre-render, ctor FUN_00492cc2 through the thunk 0x43310c): the original's code runs natively in the island emulation
// of tools/lib/m7-isl-veh-emu.mjs (the board code range 0x48d000 .. 0x495000 is added to the executed ranges) next to the port's SkateNode with the same scripted buttons. Pepper's chain is the original's
// PepSwitc (Ctrl -> mode 4) + walk stub + the skateboard node. Hosted (engine functions, not the subject): the sweep FUN_00441270 / probe FUN_00441ac0 / terrain ray FUN_0043cd62 (the port's
// CollisionWorld over the oracle world: M1's tests cover it), FUN_00441a90 (= FUN_00441270 with radius 0.01, skin 0: the same host), animation instances (the port's AnimInstance).
import { Duel, B, RECORDS_BASE, REC, lcg, randomKeys } from './m7-isl-veh-emu.mjs';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { cdFillHeap, cdPatchChain } from './m8-save-pepper.mjs';

export { Duel, B, RECORDS_BASE, REC, lcg, randomKeys };
export const CTOR_SKATE = 0x43310c;
/** node fields: [offset, type, port field] */
export const SK = [
  [0x18, 'u8', 'state'], [0x19, 'u8', 'evaluated'], [0x1a, 'u8', 'grounded'], [0x1b, 'u8', 'onPipe'], [0x1c, 'u8', 'trickMid'], [0x1d, 'u8', 'pushes'],
  [0x20, 'i32', 'animResult'], [0x24, 'i32', 'rampX'], [0x28, 'i32', 'steer'], [0x2c, 'i32', 'rampY'], [0x30, 'i32', 'stickY'], [0x38, 'f', 't'], [0x3c, 'f', 'spin'], [0x40, 'f', 'trickRate'],
  [0x54, 'f', 'yaw'], [0x5c, 'f', 'speed'], [0x60, 'f', 'maxSpeed'], [0x64, 'f', 'charge'], [0x68, 'f', 'y0'], [0x6c, 'f', 'jumpY'], [0x70, 'f', 'v0'], [0x74, 'f', 'vy'], [0x78, 'f', 'progress'],
  [0x7c, 'f', 'pushTimer'], [0x8c, 'f', 'vx'], [0x90, 'f', 'vyv'], [0x94, 'f', 'vz'],
];

/** a Duel with the skateboard in Pepper's chain on both sides */
export function skateDuel(ctx, o = {}) {
  const d = new Duel(ctx, {
    keepKinds: [], keepRecords: () => false, pepperKinds: ['skate'], pepperCtors: new Set([CTOR_SKATE]), oracleCtors: new Set([CTOR_SKATE]),
    extraExec: [[0x48d000, 0x495000]], draw: false, beforeAttach: (emu) => cdFillHeap(emu), ...o,
  });
  cdPatchChain(d);       // WP-SAVE: PepSwitc is built by hand here: the constructor's flags word
  const emu = d.emu, cpu = emu.cpu, mem = cpu.mem, W = d.P.world;
  const bi = W.records.findIndex((r) => r.name === 'SBRD');
  d.board = bi;
  // FUN_00441a90(rec, &from, &delta, &normal, &point, mask): FUN_00441270 with radius 0.01, skin 0 (0x3c23d70a)
  const vec = (a) => [0, 1, 2].map((k) => mem.f32(a + 4 * k));
  cpu.hooks.set(0x441a90, (c) => {
    emu.sync();
    const rec = emu.oracle.records[(c.arg(0) - RECORDS_BASE) / REC];
    const hit = emu.oracle.world.col.sweep(rec, vec(c.arg(1)), vec(c.arg(2)), c.arg(5), 0.009999999776482582, 0);
    if (!hit) { c.eax = 0; return; }
    for (let k = 0; k < 3; k++) { mem.wf32(c.arg(3) + 4 * k, hit.normal[k]); mem.wf32(c.arg(4) + 4 * k, hit.point[k]); }
    c.eax = RECORDS_BASE + hit.rec.index * REC;
  });
  // the board record's animation instance: the island loader gives record 9 one (SKBD.blk, clip 1 frame 0: FUN_004f645b @0x519c09); the port's world makes its own on first use
  const arc = d.P.ictx.archive, e = arc.find('anim/SKBD.blk');
  const oa = new AnimInstance(parseBlk(arc.read(e))); oa.start(1, 0);
  d.O.world.records[bi].anim = oa;
  const p = emu.alloc(16); emu.anims.set(p, oa); emu.animRec.set(p, bi); mem.w32(RECORDS_BASE + bi * REC + 8, p);
  d.oBoardAnim = oa;
  d.snode = () => d.pnode(d.P.pepper.index, 'skate');
  d.onodeSkate = () => d.onode(d.O.pepper.index, CTOR_SKATE);
  return d;
}

/** the node block fields of the original -> the port's node (sync mode) */
export function skateToPort(d) {
  const mem = d.emu.cpu.mem, a = d.onodeSkate(), pn = d.snode();
  for (const [off, ty, f] of SK) pn[f] = ty === 'f' ? mem.f32(a + off) : ty === 'u8' ? mem.r8(a + off) : mem.r32(a + off) | 0;
  pn.stamp = mem.r32(a + 8);
}
