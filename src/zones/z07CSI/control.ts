// "Control" of the castle (Common\Z07CSI\Control.c, ctor FUN_0057a579 -> FUN_005b2a23, table 0x8f86b8 = { update FUN_00579a10, pre-render FUN_00579ebe, destroy FUN_0057a5ff, save FUN_0057a53b /
// size FUN_0057a516 (12 bytes at +0x18) }): Pepper's mode switch, the castle's copy of the island's PepSwitc (src/island/vehicles/pepswitch.ts). It is the FIRST node of Pepper's chain (gate
// PEPPER_CONTROL & 0 = always), before SGwalk (& 1) / sgswim (& 2) / skate (& 4) / SGVehic (& 8) / Horse (& 0x10).
// PEPPER_CONTROL (var 0x5e) & 0xfff is the mode: 1 walk, 2 swim, 4 skateboard, 8 vehicle (the speedboat), 0x10 the horse, 0x401 = "got off the horse" (one tick: the update puts Pepper on the free
// spot the pre-render found); 0x1000 (interact) survives every change.
//   update  FUN_00579a10 (returns 2): 0x401 -> Pepper's translation := the node's spot (+0x18 / +0x1c / +0x20), clip 0x1b; walking (& 1) -> Pepper is visible (flags |= 2).
//   pre-render FUN_00579ebe, every tick: Enter -> the nearest look / decor record (FUN_005b2e9f, looks.ts), the roster / decor ticks (FUN_005b2f34), the two flag sounds (3D 0x2e2 at the
//   records LFG4 / BFG6), the story hook (node 0x11, not on a vehicle and x < -60: var 0x56 := 2), then the mode logic:
//     walking / got off the horse: Ctrl (pressed, not in the air / water states, no vehicle) -> the skateboard (mode 4, clip 0x16, board shown, sound); a vehicle that chose Pepper (DAT_009daa80:
//       the horse HORS = mode 0x10, any other = 8, clip 0x43); the terrain below at or under the sea level -> swimming (mode 2, clip 0x15); Pepper shown, JKIT hidden;
//     swimming: terrain one unit ahead above the sea level -> walking (mode 1, clip 0x25, sound);
//     skateboard: Ctrl or interact off the board (mode 1, clip 0x1c, the board's clip 2, the roll sounds stopped), or water four units ahead;
//     horse: Ctrl (var 0x112 & 0x10 clear) gets off at a free spot FUN_00579a96 finds (mode 0x401, clip 0x1b, the horse record not Pepper's vehicle any more).
//   The writes: the walk mailbox DAT_008ae088 := clip and the clip started (FUN_0043b6a3), PEPPER_CONTROL := mode | (old & 0x1000).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { waypoints } from '../../game/walker.ts';
import { ensureCsiLooks, reloadCsiRoster } from './looks.ts';
import { BlockIn, BlockOut } from './blockio.ts';
import { lookKey, tickLooks } from '../../island/vehicles/looks.ts';
import { f32, fb, ctxOf, playAt, playId, stop } from './common.ts';

export const CTOR_CONTROL = 0x57a579;
/** the debug heap fills a new block with 0xCD: a float never written by the constructor reads as this (0xcdcdcdcd) */
const CD_F = fb(0xcdcdcdcd);
const VAR = { PEPPER_CONTROL: 0x5e, STORY: 0x58, STAGE: 0x56, SWITCH: 0x112 } as const;
/** the records the node touches: JKIT (46: hidden while Pepper walks), HORS (48: the horse), LFG4 (12) / BFG6 (22): where the two ambience sounds sit (`DAT_00983804 + 0x51c / 0x92c` = the record's translation) */
const REC = { JKIT: 46, HORSE: 48, SOUND_A: 12, SOUND_B: 22 } as const;
/** the walk states the node starts: FUN_0043b6a3(Pepper, state, 0) + the mailbox DAT_008ae088 */
const ST = { BOARD_ON: 0x16, OFFBOARD: 0x1c, INTO_WATER: 0x15, OUT_OF_WATER: 0x25, TO_VEHICLE: 0x43, IDLE: 0x1b } as const;
/** the mailbox values that keep Pepper off the board (walking: jump 1, 2, the second jump 0x1f, the hard landing 0x57, the teeter 0x38; swimming clips 99 / 0x62) and the board's own air states (0x20 / 0x21) */
const NO_BOARD_STATES: readonly number[] = [1, 2, 0x57, 0x1f, 0x38], AIR_STATES: readonly number[] = [0x20, 0x21];
/** sound ids FUN_004b0f16 loads into DAT_009da978 (getting on the board) / DAT_009da940 (getting off) / DAT_009da93c (out of the water) */
export const SND = { BOARD_ON: 0x150, BOARD_OFF: 0x106, OUT_OF_WATER: 0x128 } as const;
/** the skateboard's rolling sounds the node stops when Pepper steps off (DAT_05d57fe0, fd0, fe8, fcc, fdc, fd8, fc8, fd4 in this order: the ids FUN_004b0b37 loads into them) */
export const SKATE_ROLL_STOP_ORDER = [0x180, 0x17f, 0x182, 0x185, 0x185, 300, 0x181, 0x184] as const;
/** the handle globals of the castle's loader FUN_00572ef0: DAT_05d58890 / DAT_05d58894 (3D 0x2e2 twice) */
export const H = { FLAG_A: 0x5d58890, FLAG_B: 0x5d58894 } as const;
/** _DAT_008926a0 (-60.0), _DAT_00892080 (4.0), _DAT_008921b0 (80.0), _DAT_0089269c (36.0), _DAT_008925e0 */
const STORY_X = f32(-60.0), FOUR = f32(4.0), SPOT_UP = f32(80.0), ROOF_DROP = f32(36.0), PROBE_DOWN = f32(-88.0);

/**
 * FUN_00579a96(rec, out, step, -1): the free spot to leave the horse. Tries pos - right * r, pos + right * r, pos + forward * r, pos - forward * r (rounds: r = step, then step + step ...; the
 * original multiplies the two vectors by r again in every round, so the distances grow 4, 32, 384 ... and it never gives up) around a point 80 above Pepper; a spot counts when the terrain
 * there is not below the sea (surface 9 = a roof: the terrain 36 lower is used) and nothing solid is within 88 units below it (FUN_00441ac0, mask 3). Always returns 1; when no spot is found
 * the original loops for ever, the port stops after 8 rounds and uses the PATH node 0x72 (the original's code after the loop). Every step is a float32 operation.
 */
export function findHorseSpot(w: World, rec: GameRecord, out: [number, number, number], step: number): boolean {
  let r = f32(step);
  let rx = rec.m[0], ry = rec.m[1], rz = rec.m[2];
  let fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
  const x = rec.m[12], y = f32(rec.m[13] + SPOT_UP), z = rec.m[14];
  const sea = w.seaLevel;
  const tryAt = (px: number, py: number, pz: number): boolean => {
    out[0] = px; out[1] = py; out[2] = pz;
    let t = f32(w.col.terrainHeight(px, py, pz, 0));
    if (t >= sea && w.col.lastSurface() === 9) { out[1] = f32(out[1] - ROOF_DROP); t = f32(w.col.terrainHeight(out[0], out[1], out[2], 0)); }
    if (t > sea) {
      const h = w.col.probe(rec, out, [0, PROBE_DOWN, 0], 3);
      if (!h) { out[1] = t; return true; }
    }
    return false;
  };
  for (let round = 0; round < 8; round++) {
    rx = f32(-r * rx); ry = f32(-r * ry); rz = f32(-r * rz);
    fx = f32(fx * r); fy = f32(fy * r); fz = f32(fz * r);
    if (tryAt(f32(x + rx), f32(y + ry), f32(z + rz))) return true;
    if (tryAt(f32(x - rx), f32(y - ry), f32(z - rz))) return true;
    if (tryAt(f32(x + fx), f32(y + fy), f32(z + fz))) return true;
    if (tryAt(f32(x - fx), f32(y - fy), f32(z - fz))) return true;
    r = f32(r + step);
  }
  const p = waypoints.nodePos(1, 0x72);   // FUN_00462be9(1, 0x72, out)
  out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
  return true;
}

export class CsiControl implements BehaviourNode {
  readonly kind = 'Control';
  var: number = VAR.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node + 0x18 / +0x1c / +0x20: the spot FUN_00579a96 found to leave the horse */
  spot: [number, number, number] = [CD_F, CD_F, CD_F];

  /** FUN_00579a10 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const word = w.vars.get(VAR.PEPPER_CONTROL);
    if ((word & 0x401) === 0x401) {
      rec.m[13] = this.spot[1]; rec.m[12] = this.spot[0]; rec.m[14] = this.spot[2];
      rec.anim?.start(ST.IDLE, 0);                                    // FUN_0043b6a3(rec + 8, 0x1b, 0)
    }
    if ((word & 1) !== 0) rec.flags |= 2;
    // the top of the walk node's update (FUN_0042d514: _DAT_008ae330 = 576.0) runs right after this node whenever the walk node does: the vehicles' range
    if ((word & 1) === 1) vehicles(w).range = 576.0;
    return NODE_CONTINUE;
  }

  /** FUN_00579ebe */
  prerender(w: World, rec: GameRecord, _ctrl: Controller): void {
    void _ctrl;
    const G = vehicles(w);
    const pressed = w.input.pressed;
    const story = w.vars.get(VAR.STORY);
    const word = w.vars.get(VAR.PEPPER_CONTROL);
    let mode = 0, state = 0;
    // Enter: FUN_005b2e9f (the nearest record's look / decor swap), every tick FUN_005b2f34 (the roster's busy slots, the decor animation)
    if (ensureCsiLooks(w)) {
      if ((pressed & B.ENTER) !== 0) lookKey(w, rec);
      tickLooks(w);
    }
    // FUN_00443230 (the audio frame) is the audio host's; FUN_004433f0(DAT_05d58890 / 94, the records' translations): the flags' ambience
    const a = w.records[REC.SOUND_A], b = w.records[REC.SOUND_B];
    if (a) playAt(w, H.FLAG_A, [a.m[12], a.m[13], a.m[14]]);
    if (b) playAt(w, H.FLAG_B, [b.m[12], b.m[13], b.m[14]]);
    if (story === 0x11 && word !== 8 && rec.m[12] < STORY_X) w.vars.set(VAR.STAGE, 2);
    const base = word & 0xfff;
    const mailbox = w.pep.mailbox;
    const board = w.records[G.board] ?? null;
    const horse = w.records[REC.HORSE], jkit = w.records[REC.JKIT];
    let walking = false;
    if (base === 4) {
      // on the skateboard: Ctrl (or the interact bit) gets off, not in the air
      if (((pressed & B.CTRL) !== 0 || (word & 0x1000) !== 0) && !AIR_STATES.includes(mailbox)) {
        mode = 1; state = ST.OFFBOARD;
        board?.anim?.start(2, 0);
        for (const id of SKATE_ROLL_STOP_ORDER) ctxOf(w)?.stopSfx(id);
        playId(w, SND.BOARD_OFF);
      }
      // ... and so does water four units ahead
      const ax = f32(f32(rec.m[8] * FOUR) + rec.m[12]), ay = f32(f32(rec.m[9] * FOUR) + rec.m[13]), az = f32(f32(rec.m[10] * FOUR) + rec.m[14]);
      if (w.col.terrainHeight(ax, ay, az, 4.0) <= w.seaLevel && !AIR_STATES.includes(mailbox)) {
        mode = 1; state = ST.OFFBOARD;
        board?.anim?.start(2, 0);
      }
    } else if (base === 2) {
      // swimming: out of the water where the terrain one step ahead (+ 4 up) is above the sea level
      const px = f32(rec.m[8] + rec.m[12]), py = f32(f32(rec.m[9] + rec.m[13]) + FOUR), pz = f32(rec.m[10] + rec.m[14]);
      if (w.col.terrainHeight(px, py, pz, 4.0) > w.seaLevel) {
        mode = 1; state = ST.OUT_OF_WATER;
        playId(w, SND.OUT_OF_WATER);
      }
    } else if (base === 0x10) {
      // the horse: Ctrl (the cutscene switch 0x112 & 0x10 clear) gets off at a free spot
      if ((pressed & B.CTRL) !== 0 && (w.vars.get(VAR.SWITCH) & 0x10) === 0 && findHorseSpot(w, rec, this.spot, 4.0)) {
        G.current = null;
        rec.flags |= 2;
        if (jkit) jkit.flags &= ~2;
        mode = 0x401; state = ST.IDLE;
      }
    } else if (base === 1 || base === 0x401) {
      if (base === 0x401) mode = 1;
      walking = true;
    }
    if (walking) {
      const clip = rec.anim?.clip ?? -1;
      const blocked = (pressed & B.CTRL) === 0 || NO_BOARD_STATES.includes(mailbox) || clip === 99 || clip === 0x62 || G.current !== null;
      if (blocked) {
        // a vehicle chose Pepper this tick: the horse (mode 0x10) or the speedboat (8), the getting-in clip
        if (G.current !== null) {
          mode = G.current === horse ? 0x10 : 8; state = ST.TO_VEHICLE;
        }
      } else {
        // Ctrl: on the skateboard
        mode = 4; state = ST.BOARD_ON;
        board?.anim?.start(1, 0);
        if (board) board.flags |= 2;
        playId(w, SND.BOARD_ON);
      }
      w.col.terrainHeight(rec.m[12], rec.m[13], rec.m[14], 4.0);      // FUN_0043cd62(rec + 0x3c, 4.0) (the result is not used: the next test reads the record's own y)
      if (rec.m[13] <= w.seaLevel) { mode = 2; state = ST.INTO_WATER; }
      rec.flags |= 2;
      if (jkit) jkit.flags &= ~2;
    }
    if (state !== 0) { w.pep.mailbox = state; rec.anim?.start(state, 0); }
    if (mode !== 0) w.vars.set(VAR.PEPPER_CONTROL, mode | (word & 0x1000));
  }

  /** save FUN_0057a516 (vtable +0x14): `*out = node + 0x18; return 0xc` = the spot (x, y, z floats) */
  saveBlock(): Uint8Array { return new BlockOut(12).f32(0, this.spot[0]).f32(4, this.spot[1]).f32(8, this.spot[2]).bytes; }
  /** load FUN_0057a53b (vtable +0x10): memcpy of the 12 bytes to node + 0x18, then FUN_005b2a00 (the decor era table and the roster re-derived from the variables) */
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.spot = [b.f32(0), b.f32(4), b.f32(8)];
    reloadCsiRoster(w);
  }

  /** FUN_0057a5ff: FUN_005b2f7d (the roster's cyclers freed), FUN_004434b0(DAT_05d58890), FUN_004434b0(DAT_05d58894) */
  destroy(w: World): void {
    stop(w, H.FLAG_A); stop(w, H.FLAG_B);
  }
}
