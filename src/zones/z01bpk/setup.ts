// z01BPK: the parts of the zone loop FUN_00493506 (initial set-up, re-run by FUN_004938e8) and FUN_0048d8bd (the spectators of mode 2) that act on the world: Pepper's start
// matrix and the camera, the animations of the records (Pepper idle 0x1b, the 19 spectators 0x7a / 0x7b, the board's clip 0), the zone's node chain, the spectators' turn towards
// Pepper. DOM-free (the zone game, the node tests and the bots use it).
import type { Pe } from '../../formats/exe.ts';
import type { Blk } from '../../formats/anim.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { buildMatrixF32 } from '../../formats/matrixf32.ts';
import { BpkRun, BpkSwitch, BpkWalk, REC, VAR } from './run.ts';
import { BpkSkate } from './skate.ts';

/** FUN_00493506 / FUN_004938e8 write Pepper's matrix and place with `mov dword [reg + 0xe44 ..], imm32` (the record array + 0xe38 = record 35: +0xc .. +0x34 the matrix rows, +0x3c .. +0x44 the place) */
export const START_FN = [0x493506, 0x493897] as const;
const REC_BASE = REC.PEPPER * 0x68;
const f32 = Math.fround;
/** the offsets of the matrix elements m[0..2], m[4..6], m[8..10] and the translation within the record (+0x0c ..) */
const START_OFFSETS: Record<number, number> = { 0x0c: 0, 0x10: 1, 0x14: 2, 0x1c: 4, 0x20: 5, 0x24: 6, 0x2c: 8, 0x30: 9, 0x34: 10, 0x3c: 12, 0x40: 13, 0x44: 14 };

/** the 12 floats the set-up code stores into Pepper's record (read out of the executable's code), keyed by the matrix index */
export function readStartMatrix(pe: Pe): Map<number, number> {
  const out = new Map<number, number>();
  const dv = new DataView(new ArrayBuffer(4));
  for (let a = START_FN[0]; a < START_FN[1] - 10; a++) {
    if (pe.at(a) !== 0xc7) continue;
    const modrm = pe.at(a + 1);
    if ((modrm & 0xf8) !== 0x80) continue;             // mov dword [reg + disp32], imm32 with reg = eax / ecx / edx / ebx
    const disp = pe.u32(a + 2);
    const off = disp - REC_BASE;
    const idx = START_OFFSETS[off];
    if (idx === undefined || out.has(idx)) continue;
    dv.setUint32(0, pe.u32(a + 6), true);
    out.set(idx, dv.getFloat32(0, true));
  }
  return out;
}

/** the camera of the set-up: target = Pepper + (0, 3, 0), eye = (0, 12, -16) (0x8d2300) in Pepper's frame turned by pi (FUN_0043a5e4(m, 0, 0x40490fdb, 0, pos)) */
export const CAMERA = { TARGET_UP: 3.0, EYE: [0, 12.0, -16.0] as const, TURN: 0x40490fdb };

export interface BpkRigs { MFIG: Blk | null; SKBD: Blk | null }

export interface BpkGame {
  run: BpkRun;
  swc: BpkSwitch;
  walk: BpkWalk;
  skate: BpkSkate;
  pepper: GameRecord;
  board: GameRecord;
  /** the spectator records 37 .. 55 */
  spectators: GameRecord[];
}

/** the f32 of a bit pattern */
export function f32bits(u: number): number { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, u >>> 0, true); return dv.getFloat32(0, true); }

/**
 * FUN_00493506's tail / FUN_004938e8: everything the loop does to the world before mode 7. `world` comes from `setupZone` (the three attaches of FUN_004933c4 are done by it:
 * constructor registry in src/zones/z01BPK.ts). Removes the stub chain `setupZone` adds to a player without SGwalk.
 */
export function prepareBpk(world: World, pepper: GameRecord, rigs: BpkRigs, pe: Pe | null): BpkGame {
  const recs = world.records;
  const chain = pepper.ctrl;
  if (!chain) throw new Error('z01BPK: Pepper has no controller (the zone attaches were not applied)');
  chain.nodes = chain.nodes.filter((n) => n.kind.startsWith('bpk'));
  const swc = chain.nodes.find((n) => n.kind === 'bpkSwitch') as BpkSwitch | undefined;
  const walk = chain.nodes.find((n) => n.kind === 'bpkWalk') as BpkWalk | undefined;
  const skate = chain.nodes.find((n) => n.kind === 'bpkSkate') as BpkSkate | undefined;
  if (!swc || !walk || !skate) throw new Error(`z01BPK: the node chain of PEPP is incomplete (${chain.nodes.map((n) => n.kind).join(' ')})`);
  const run = swc.run;
  // the zone loader reads PEPP_HR.col, SkBoard.col and the other character files with FUN_0043f700 (header only, no polygons): those records are never hit by a sweep (S5: why the board
  // does not lift Pepper). `setupZone` strips them generically (src/game/colshapes.ts `applyHeaderOnlyCols`, the slots read from the loader code), nothing to do here.
  // FUN_004933c4: PEPPER_CONTROL = 1, the state mailbox 0x1b, DAT_009daa7c = the board record 0x24, gravity -10 (0xc1200000), the trick score 0
  world.vars.set(VAR.PEPPER_CONTROL, 1);
  world.pep.mailbox = 0x1b;
  run.board = REC.BOARD;
  world.gravity = f32bits(0xc1200000);
  run.trickScore = 0;
  const board = recs[REC.BOARD];
  if (rigs.SKBD) { board.anim = new AnimInstance(rigs.SKBD); board.anim.start(0, 0); }
  board.hide();                                       // FUN_00493506: flags &= ~2 (the extraction does the same: record 36)
  if (rigs.MFIG) {
    pepper.anim ??= new AnimInstance(rigs.MFIG);
    pepper.anim.start(0x1b, 0);
  }
  // the spectators: pairs of records play the cheer clips 0x7a / 0x7b, the judge (record 0x37 = 55) 0x7a
  const spectators: GameRecord[] = [];
  for (let i = REC.SPECTATOR_FIRST; i <= REC.SPECTATOR_LAST; i++) {
    const r = recs[i];
    if (!r) continue;
    if (rigs.MFIG && !r.anim) r.anim = new AnimInstance(rigs.MFIG);
    spectators.push(r);
  }
  if (rigs.MFIG) {
    for (let i = REC.SPECTATOR_FIRST; i < REC.SPECTATOR_LAST; i += 2) {
      recs[i]?.anim?.start(0x7a, 0);
      recs[i + 1]?.anim?.start(0x7b, 0);
    }
    recs[REC.SPECTATOR_LAST]?.anim?.start(0x7a, 0);
  }
  // Pepper's start matrix and place (read from the code); the extraction already placed him
  if (pe) {
    const st = readStartMatrix(pe);
    for (const [i, v] of st) pepper.m[i] = v;
    pepper.savePrev();
  }
  // the camera of the set-up (FUN_00493506): target 3 above Pepper, the eye (0, 12, -16) in his frame turned half a circle
  const c = world.camera.c;
  c[6] = 0; c[7] = 1; c[8] = 0;
  c[3] = pepper.x; c[4] = pepper.y + CAMERA.TARGET_UP; c[5] = pepper.z;
  const turn = buildMatrix(0, f32bits(CAMERA.TURN), 0, pepper.x, pepper.y, pepper.z);
  const e = CAMERA.EYE;
  c[0] = e[0] * turn[0] + e[1] * turn[4] + e[2] * turn[8] + turn[12];
  c[1] = e[0] * turn[1] + e[1] * turn[5] + e[2] * turn[9] + turn[13];
  c[2] = e[0] * turn[2] + e[1] * turn[6] + e[2] * turn[10] + turn[14];
  world.camera.vehicle = false;
  world.camera.updateView();
  world.camera.savePrev();
  world.focus = pepper;
  return { run, swc, walk, skate, pepper, board, spectators };
}

/** the spectators' turn per tick (0x8924e8 = pi / 8) and the facing test (0x892108 = 0.9) */
export const SPECTATOR = { TURN: f32bits(0x3ec90fdb), FACING: f32bits(0x3f666666) } as const;

/**
 * FUN_0048d8bd case 2: every spectator (records 0x25 .. 0x37) advances its clip by 1 and turns towards Pepper: d = Pepper - spectator, dot = forward . d (not normalised);
 * dot <= 0.9: turn by pi / 8 (minus when dot <= 0, plus otherwise), else the yaw is atan2(dx, dz); the matrix is rebuilt from the yaw.
 */
export function spectatorsTick(world: World, g: BpkGame) {
  const p = g.pepper;
  for (const r of g.spectators) {
    r.anim?.advance(1.0, world.dt);
    // the locals are float32 stores (local_20 / 1c / 18), the dot product and the turn are x87 expressions stored into the record's float +0x50
    const dx = f32(p.x - r.x), dy = f32(p.y - r.y), dz = f32(p.z - r.z);
    const dot = r.m[10] * dz + r.m[9] * dy + r.m[8] * dx;
    if (dot <= SPECTATOR.FACING) {
      if (dot <= 0) r.ry = f32(r.ry - SPECTATOR.TURN * world.dt); else r.ry = f32(SPECTATOR.TURN * world.dt + r.ry);
    } else r.ry = f32(Math.atan2(dx, dz));
    r.m.set(buildMatrixF32(0, r.ry, 0, r.x, r.y, r.z));
  }
}
