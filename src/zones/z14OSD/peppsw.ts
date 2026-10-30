// "PEPPSW" (Common\Z14OSD\c_src\PEPPSW.c): Pepper's mode switch of the Oasis (position 0 of PEPP's node chain, gate none), ctor FUN_0062ba3b, table 0x915050 =
//   { update FUN_0062b3b0, pre-render FUN_0062b483, destroy FUN_0062bb32, draw FUN_0062b99c = FUN_00444480, save FUN_0062b9fd (0x20 bytes at +0x18) + FUN_00655dc0, size FUN_0062b9d8 }.
// Node (0x38 bytes): +0x00 the variable (0x5e PEPPER_CONTROL), +0x18 the music level wanted (1..3), +0x1c the level last sent to the music (FUN_00443310(level - 3)).
// The constructor FUN_0062ba3b also runs FUN_00655de3 (the vehicle-look set-up of the helicopter PHEL, looks.ts) and loads + plays the DirectMusic key "ad1T" (DAT_05d5bcc0: the audio package
// starts it at the zone's init, src/audio/zonemusic.ts z14OSD).
//   update      the three positional ambience loops (the nodes' own records G001 / G000 / G006), returns 2 (the chain goes on)
//   pre-render  (after the probe pass; returns 1) PEPPER_CONTROL & 0xfff = 1 walking: Ctrl (not in the jump / landing states, not in clips 99 / 0x62) -> skateboard (mode 4, clip 0x16, the board's clip 1,
//               board record DAT_009daa7c = 0x40 shown, sound DAT_009da978); standing on or below the sea level -> swimming (mode 2, clip 0x15); the music level is 2 while the clip is
//               0x24 / 0x3f / 0x40 (running) else 1.   2 swimming: the ground one unit ahead (+4 up, FUN_0043cd62(p, 4)) above the sea -> walking (mode 1, clip 0x25, DAT_009da93c).
//               4 skateboard: Ctrl released (and var 0x1000 clear) or the states 0x20 / 0x32 keep it (level 3); else off the board (mode 1, clip 0x1c, the board's clip 2, the rolling sounds stop,
//               DAT_009da940); water 4 ahead (not in the states 0x20 / 0x21) also takes Pepper off the board.   Then Enter: the look change (FUN_006561e9) and the look tick (FUN_0065627e).
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { SKATE_ROLL_SOUNDS } from '../../island/vehicles/skate.ts';
import { stopSfx } from '../../island/ambient/common.ts';
import { H, SND, ctxOf, f32, playAt, playId, posOf } from './common.ts';
import { lookEnter, lookTick } from './looks.ts';
import { newPeppSwTail, packPeppSw, rosterReload, setPeppSwPoll } from '../hubsave.ts';
import type { Controller } from '../../game/controller.ts';

export const CTOR_PEPPSW = 0x62ba3b;
/** DAT_009daa7c = 0x40 (FUN_006290ea): the accessory record, the skateboard SKBD */
export const BOARD_RECORD = 0x40;
/** the records of the three ambience loops: `DAT_00983804 + 0x1c44 / 0x1bdc / 0x2e24` = record 69 / 68 / 113 (+ 0x3c = their position) */
export const AMBIENCE: ReadonlyArray<readonly [number, number]> = [[H.AMB_G001, 69], [H.AMB_G000, 68], [H.AMB_G006, 113]];
/** the walk states that stop Ctrl from taking the board: DAT_008ae088 = 1, 2, 0x57, 0x1f (jump, jump start, landing, second jump) and the clips 99 / 0x62 */
const NO_BOARD_STATES = [ST.JUMP, ST.JUMPSTART, ST.LANDING, ST.JUMP2];
const RUN_CLIPS = [ST.RUN, ST.RUNLEFT, ST.RUNRIGHT];
const SEA_AHEAD_MODE = 4.0;      // _DAT_00892080: the lookahead of the board (4 forward) and the swim exit (+4 up)

export class PeppSwNode implements BehaviourNode {
  readonly kind = 'PepSwitc';
  var = 0x5e; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x18 / +0x1c: the music level wanted / last sent */
  level = 1; sent = 1;

  /** +0x20 .. +0x38 as the constructor left them (see `newPeppSwTail`): kept for the save block, never read by the update / pre-render */
  private tail = newPeppSwTail();

  constructor(_a?: Pick<Attach, 'var' | 'mask' | 'value'>) { void _a; }

  /** the constructor's world half (`registerHub` calls it after the set-up): `+0x28 = FUN_00443370() & 0xff`, the music notification poll */
  ctorInit(w: World, _rec: GameRecord) { setPeppSwPoll(this.tail, ctxOf(w)?.musicNotified?.() ?? 0); }

  /** FUN_0062b9d8 (`*out = node + 0x18; return 0x20`) */
  saveBlock(): Uint8Array { return packPeppSw(this.tail, this.level, this.sent); }
  /** FUN_0062b9fd: a plain copy of the 0x20 bytes, then FUN_00655dc0 (the decor sets' era table, the look roster re-read) */
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.level = v.getInt32(0, true); this.sent = v.getInt32(4, true);
    this.tail.set(data.subarray(0, 32));
    rosterReload(w);
  }

  /** FUN_0062b3b0 */
  update(w: World): number {
    for (const [handle, record] of AMBIENCE) {
      const r = w.records[record];
      if (r) playAt(w, handle, posOf(r));
    }
    return NODE_CONTINUE;
  }

  /** FUN_0062b483 */
  prerender(w: World, rec: GameRecord): void {
    const word = w.vars.get(this.var);
    const base = word & 0xfff;
    const board = w.records[BOARD_RECORD] ?? null;
    const pressed = w.input.pressed;
    const mailbox = w.pep.mailbox;
    const sea = w.seaLevel;
    const clip = rec.anim?.clip ?? -1;
    let mode = 0, state = 0;
    if (base === 1) {
      if ((pressed & B.CTRL) !== 0 && !(NO_BOARD_STATES as readonly number[]).includes(mailbox) && clip !== 99 && clip !== 0x62) {
        mode = 4; state = 0x16;
        board?.anim?.start(1, 0);
        if (board) board.flags |= 2;
        playId(w, SND.BOARD_ON);
      }
      this.level = (RUN_CLIPS as readonly number[]).includes(clip) ? 2 : 1;
      if (rec.m[13] <= sea) { mode = 2; state = 0x15; }
    } else if (base === 2) {
      // FUN_0043cd62(&(fx + x, fy + y + 4, fz + z), 4.0): the terrain one step ahead
      const px = f32(rec.m[8] + rec.m[12]), pz = f32(rec.m[10] + rec.m[14]), py = f32(f32(rec.m[9] + rec.m[13]) + SEA_AHEAD_MODE);
      const h = w.col.terrainHeight(px, py, pz, 4.0);
      if (sea < h) { mode = 1; state = 0x25; playId(w, SND.OUT_OF_WATER); }
    } else if (base === 4) {
      const ctrlKey = (pressed & B.CTRL) !== 0 || (word & 0x1000) !== 0;
      if (!ctrlKey || mailbox === 0x20 || mailbox === 0x32) this.level = 3;
      else {
        mode = 1; state = 0x1c;
        board?.anim?.start(2, 0);
        for (const id of SKATE_ROLL_SOUNDS) stopSfx(w, id);
        playId(w, SND.BOARD_OFF);
      }
      const ax = f32(f32(rec.m[8] * SEA_AHEAD_MODE) + rec.m[12]), ay = f32(f32(rec.m[9] * SEA_AHEAD_MODE) + rec.m[13]), az = f32(f32(rec.m[10] * SEA_AHEAD_MODE) + rec.m[14]);
      if (w.col.terrainHeight(ax, ay, az, 4.0) <= sea && mailbox !== 0x20 && mailbox !== 0x21) {
        mode = 1; state = 0x1c;
        board?.anim?.start(2, 0);
      }
    }
    if (state !== 0) { w.pep.mailbox = state; rec.anim?.start(state, 0); }
    if (mode !== 0) w.vars.set(this.var, mode | (word & 0x1000));
    if (this.level !== this.sent) {
      ctxOf(w)?.musicGroove?.(this.level - 3);      // FUN_00443310
      this.sent = this.level;
    }
    if ((pressed & B.ENTER) !== 0) lookEnter(w, rec);   // FUN_006561e9
    lookTick(w);                                          // FUN_0065627e
  }

  /** FUN_0062bb32: the look cycler is freed (FUN_006562c7), the music handle released */
  destroy(): void { /* frees the node */ }
}

