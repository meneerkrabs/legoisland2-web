// z16PYA, the Pyramid: Pepper's mode switch "PeppSw" (Common\Z16PYA\c_src\PeppSw.c, ctor FUN_00677350, handler table 0x91efc0), docs/re/m5/z16PYA.md.
//   table 0x91efc0 = { update FUN_00676cd0, pre-render FUN_00676d95, destroy FUN_00677438, draw FUN_006772b1 (the default mesh draw), load FUN_00677312 (copies the 0x20 bytes
//   at node + 0x18 from the save and re-runs the roster set-up FUN_00698940), save FUN_006772ed (node + 0x18, 0x20 bytes), FUN_00677474 (a loop over the empty list 0x91eff0) }
// Attached to PEPP by the set-up (FUN_006768ce) first, gate var 0x5e mask 0 / value 0 (always), the rest of Pepper's chain follows (0x62af8d = the scorpion sting mode 0x20,
// SGwalk & 1, sgswim & 2, skate & 4). The second PeppSw class of the same file, FUN_00677521 (node size 0x18, var 2, mask / value 1, table 0x91efd8 = FUN_00677474), is never
// attached by any code of the EXE (dead). It is the Pyramid's copy of the island's PepSwitc (src/island/vehicles/pepswitch.ts, FUN_004bbef8 / FUN_004bb630 / FUN_004bb67d); what differs:
//   * no vehicles (no car: nothing leaves a car at a free spot, no 0x401, no boat / helicopter docks), PORTAL_VEHICLE (var 0xbb) is not cleared, no story node 0x1e hologram timer;
//   * the update plays the temple's 3D sound (record TEMP, DAT_05d5bdb0 = sound 0x307) every tick and one of three 2D sounds now and then (a random draw of the time since
//     the loop started modulo 2000 hits 0x557 / 0x15c / 0x2a7: sounds 0x30b / 0x30a / 0x309); the island's update has neither (its sea loop is in the pre-render);
//   * the pre-render keeps the music's groove level (node + 0x18, level - 3 = FUN_00443310): 1 walking (-2), 2 walking in the clips 0x24 / 0x3f / 0x40 (-1), 3 on the board (0);
//     the island has no sea loop sound here (no FUN_004433f0 of the shore point);
//   * water (sea = -400, DAT_009da858): walking at or below it -> swim (state 0x15, island 0x62); swimming: out of the water when the terrain one unit ahead is ABOVE the sea
//     (`<`, island `<=`) -> walk, state 0x25, Pepper stays where she is (the island puts her onto the shore point and plays sound 0x128); the board: the water check ahead has no
//     "getting on" clip test (island: clip != 0x16);
//   * Enter (button 0x10000): FUN_00698da4 = the island's FUN_0051db5c with the Pyramid's roster (0x925a00: the speedster SPED) and decor group 3; every tick FUN_00698e39 = FUN_0051dbd7.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { tryCtx } from '../../island/ctx.ts';
import { rand } from '../../island/rng.ts';
import { vehicles, sfx, stopSfx } from '../../island/vehicles/common.ts';
import { SKATE_ROLL_SOUNDS } from '../../island/vehicles/skate.ts';
import { newPeppSwTail, packPeppSw, rosterReload, setPeppSwPoll } from '../hubsave.ts';

const fr = Math.fround;
/** the constructor (FUN_00677350) */
export const CTOR_PEPPSW = 0x677350;
/** PEPPER_CONTROL (var 0x5e) */
const VAR_CONTROL = 0x5e;
/** the record the update's 3D sound stands at: `DAT_00983804 + 0x994` = record 23 + 0x3c (TEMP, the temple) */
export const TEMPLE_RECORD = 23;
/** sound handle globals (FUN_006762a0) and the sound ids they hold */
export const SND = {
  /** DAT_05d5bdb0 = FUN_004433b0(0x307) (3D) */
  TEMPLE: { addr: 0x5d5bdb0, id: 0x307 },
  /** DAT_05d5bda0 / bda4 / bda8 = FUN_00443580(0x30b / 0x30a / 0x309) (2D) */
  R_557: { addr: 0x5d5bda0, id: 0x30b }, R_15C: { addr: 0x5d5bda4, id: 0x30a }, R_2A7: { addr: 0x5d5bda8, id: 0x309 },
} as const;
/** DAT_009da978 getting on the board, DAT_009da940 getting off (FUN_004b0f16's walk sound set: 0x150 / 0x106) */
const SND_BOARD_ON = 0x150, SND_BOARD_OFF = 0x106;
/** the modulus and hits of the random sound (FUN_00676cd0) */
const RANDOM_MOD = 2000, HIT_557 = 0x557, HIT_15C = 0x15c, HIT_2A7 = 0x2a7;
/** the walk states that keep Pepper off the board: the mailbox values 1, 2, 'W', 0x1f, '8' (jump, jump start, hard landing, second jump, teeter) and the clips 99 / 0x62 (the dive) */
const NO_BOARD_STATES: readonly number[] = [1, 2, 0x57, 0x1f, 0x38];
/** the clips (Pepper's animation id) that raise the groove level to 2: 0x24, 0x3f, 0x40 */
const GROOVE2_CLIPS: readonly number[] = [0x24, 0x3f, 0x40];
/** FUN_00435c91: milliseconds since the loop started (the port counts ticks of 1000 / 30 ms) */
export const msClock = (w: { tickCount: number }) => Math.trunc((w.tickCount * 1000) / 30);

/** what the Enter key and the every-tick part of the roster do (FUN_00698da4 / FUN_00698e39): set by the hub module (the island's vehicle looks with this zone's roster) */
export interface RosterHooks {
  /** Enter was pressed this tick (DAT_00983840 & 0x10000): FUN_00698da4(Pepper) */
  enter(w: World, pepper: GameRecord): void;
  /** every tick: FUN_00698e39(Pepper) */
  tick(w: World, pepper: GameRecord): void;
}
const HOOKS_KEY = 'z16PYA.roster';
export function setRosterHooks(w: World, h: RosterHooks | null) { if (h) w.ext.set(HOOKS_KEY, h); else w.ext.delete(HOOKS_KEY); }

export class PyaPepSwitch implements BehaviourNode {
  readonly kind = 'PeppSw';
  var: number = VAR_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node + 0x18: the activity level (1 walking, 2 walking in clips 0x24 / 0x3f / 0x40, 3 on the board) */
  groove = 1;
  /** node + 0x1c: the level the music was last told about */
  lastGroove = 1;
  /** node + 0x20 = -1, + 0x24 = 0, + 0x2c / + 0x30 = 0: set by the constructor, never read; node + 0x28: FUN_00443370() & 0xff, the music notification poll of the constructor (the image
   *  of the node's bytes +0x20 .. +0x38 for the save block, `newPeppSwTail`) */
  private tail = newPeppSwTail();

  /** the constructor's world half (`registerHub` calls it after the set-up): `+0x28 = FUN_00443370() & 0xff` */
  ctorInit(w: World, _rec: GameRecord) { setPeppSwPoll(this.tail, (tryCtx(w) as { musicNotified?(): number } | null)?.musicNotified?.() ?? 0); }

  /** FUN_006772ed (`*out = node + 0x18; return 0x20`) */
  saveBlock(): Uint8Array { return packPeppSw(this.tail, this.groove, this.lastGroove); }
  /** FUN_00677312: a plain copy of the 0x20 bytes, then FUN_00698940 (the decor sets' era table, the look roster re-read) */
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.groove = v.getInt32(0, true); this.lastGroove = v.getInt32(4, true);
    this.tail.set(data.subarray(0, 32));
    rosterReload(w);
  }

  /** FUN_00676cd0 */
  update(w: World): number {
    const c = tryCtx(w);
    if (c) {
      // FUN_004433f0(DAT_05d5bdb0, record 23 + 0x3c): the temple's 3D sound (played / updated / culled by the distance to the listener)
      const t = w.records[TEMPLE_RECORD];
      if (t) c.sfxAt(this.id(c, SND.TEMPLE), [t.x, t.y, t.z]);
      // ftol(FUN_004388ae((float)(GetTickCount - start))) % 2000: FUN_004388ae(x) = rand() / 32767 * x
      const r = Math.trunc(rand(fr(msClock(w)))) % RANDOM_MOD;   // RNG: shared MSVC rand port later (src/island/rng.ts)
      if (r === HIT_557) c.sfx(this.id(c, SND.R_557));
      else if (r === HIT_15C) c.sfx(this.id(c, SND.R_15C));
      else if (r === HIT_2A7) c.sfx(this.id(c, SND.R_2A7));
    }
    return NODE_CONTINUE;
  }

  private id(c: NonNullable<ReturnType<typeof tryCtx>>, s: { addr: number; id: number }): number {
    const v = (c as { soundOf?(addr: number): number }).soundOf?.(s.addr);   // HubContext.soundOf: the handle global the emulated FUN_006762a0 filled
    return v !== undefined && v >= 0 ? v : s.id;
  }

  /** FUN_00676d95 */
  prerender(w: World, rec: GameRecord, _ctrl?: Controller): void {
    void _ctrl;
    const G = vehicles(w);
    const pressed = w.input.pressed;
    const word = w.vars.get(VAR_CONTROL);
    const base = word & 0xfff;
    const sea = w.seaLevel;
    const board = w.records[G.board] ?? null;
    const mailbox = w.pep.mailbox;
    const clip = rec.anim?.clip ?? -1;
    let mode = 0;      // local_14
    let state = 0;     // local_24
    if (base === 1) {
      if ((pressed & B.CTRL) === 0 || NO_BOARD_STATES.includes(mailbox) || clip === 99 || clip === 0x62) {
        this.groove = GROOVE2_CLIPS.includes(clip) ? 2 : 1;
      } else {
        // Ctrl: on the skateboard (the board record's clip 1, shown, the sound DAT_009da978)
        mode = 4; state = 0x16;
        board?.anim?.start(1, 0);
        board?.show();
        sfx(w, SND_BOARD_ON);
      }
      if (rec.y <= sea) { mode = 2; state = 0x15; }
    } else if (base === 2) {
      // swimming: the terrain one unit ahead (4 above the water line) is above the sea: back to walking (no sound, Pepper stays)
      const px = fr(rec.m[8] + rec.x), pz = fr(rec.m[10] + rec.z), py = fr(rec.m[9] + rec.y + 4.0);
      const t = fr(w.col.terrainHeight(px, py, pz, 4.0));
      if (sea < t) { mode = 1; state = 0x25; }
    } else if (base === 4) {
      if (((pressed & B.CTRL) === 0 && (word & 0x1000) === 0) || mailbox === 0x20 || mailbox === 0x32) {
        this.groove = 3;
      } else {
        // Ctrl (or the interact bit): off the board (clip 2 of the board, its rolling sounds stop, sound DAT_009da940)
        mode = 1; state = 0x1c;
        board?.anim?.start(2, 0);
        for (const id of SKATE_ROLL_SOUNDS) stopSfx(w, id);
        sfx(w, SND_BOARD_OFF);
      }
      // ... and so does water 4 units ahead (not in the air: mailbox 0x20 / 0x21)
      const ax = fr(rec.x + fr(rec.m[8] * 4.0)), ay = fr(rec.y + fr(rec.m[9] * 4.0)), az = fr(rec.z + fr(rec.m[10] * 4.0));
      if (w.col.terrainHeight(ax, ay, az, 4.0) <= sea && mailbox !== 0x20 && mailbox !== 0x21) {
        mode = 1; state = 0x1c;
        board?.anim?.start(2, 0);
      }
    }
    if (state !== 0) { w.pep.mailbox = state; rec.anim?.start(state, 0); }
    if (mode !== 0) w.vars.set(VAR_CONTROL, mode | (word & 0x1000));
    if (this.groove !== this.lastGroove) {
      // FUN_00443310((byte)(level - 3)): GUID_PerfMasterGrooveLevel, one signed byte
      tryCtx(w)?.musicGroove?.(this.groove - 3);
      this.lastGroove = this.groove;
    }
    const roster = w.ext.get(HOOKS_KEY) as RosterHooks | undefined;
    if (roster) {
      if ((pressed & B.ENTER) !== 0) roster.enter(w, rec);
      roster.tick(w, rec);
    }
  }
}
