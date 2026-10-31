// z23DIP: Pepper's mode switch "PeppSw" (Common\Z23DIP\c_src\PeppSw.c, ctor FUN_00727e84, handler table 0x935230):
//   { update FUN_00727360, pre-render FUN_007277f1, destroy FUN_00727f6c, draw FUN_00727de5 (the default mesh draw, returns 1), load FUN_00727e46 (copies the 0x18 bytes at
//     node + 0x18 from the save and re-runs the roster set-up FUN_00765180), save FUN_00727e21 (node + 0x18, 0x18 bytes), FUN_00727fe3 .. }
// Attached to PEPP first by the set-up (FUN_00726e25, gate var 0x5e mask 0 / value 0: it always runs), the rest of Pepper's chain follows: SGwalk (& 1), sgswim (& 2), the
// skateboard (& 4). It is the Dino island's copy of the island's PepSwitc (src/island/vehicles/pepswitch.ts, FUN_004bbef8 / FUN_004bb630 / FUN_004bb67d); what differs:
//   * no vehicles at all (no car / boat / helicopter, no free spot to leave a car, no 0x401, PORTAL_VEHICLE is not cleared, no story-node-30 hologram timer);
//   * the update has the zone's 3D sound scape (the hall, the pterodactyl, node 50: the Rex step sounds and the random calls) where the island's has nothing (its sea loop is in
//     the pre-render);
//   * the pre-render keeps the music's groove level (node + 0x18, level - 3 -> FUN_00443310): 1 walking (-2), 2 walking in the clips 0x24 / 0x3f / 0x40 (-1), 3 on the board (0);
//   * the water (the sea is at -80, DAT_009da858) is not entered: walking above it the position is remembered (the last good place, node + 0x24 .. 0x2c), walking at or below
//     it (or "swimming", PEPPER_CONTROL 2) Pepper is put on the ground below (FUN_0043cd62(pos, 4)) or back on the remembered place when there is none, in the swim case with
//     the walk state 0x25; the board: getting on without the island's sea / clip tests, getting off in front of the water ahead (the terrain 4 units ahead is at or below the sea);
//   * Enter (button 0x10000): FUN_00765281 = the island's FUN_0051db5c with the Dino island's roster (0x93d578: empty) and decor group 4; every tick FUN_00765316.
// Node layout (size 0x30): +0 var, +4 table, +8 stamp, +0xc mask, +0xe value, +0x18 level, +0x1c last level, +0x20 byte = story node 50, +0x24 / 0x28 / 0x2c = x / y / z of the last
// good place (the constructor stores (+0x3c, +0x40, +0x44) as +0x24, +0x28, +0x2c: the decompile's param_3[9], [10], [0xb]).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { tryCtx } from '../../island/ctx.ts';
import type { IslandCtx } from '../../island/ctx.ts';
import { randTrunc } from '../../island/rng.ts';
import { vehicles, sfx, stopSfx } from '../../island/vehicles/common.ts';
import { SKATE_ROLL_SOUNDS } from '../../island/vehicles/skate.ts';
import { VAR, REC, SND, SND_BOARD_ON, SND_BOARD_OFF, NO_BOARD_MAILBOX, NO_BOARD_CLIPS, GROOVE2_CLIPS, NODE_RETURN } from './consts.ts';
import type { SoundRef } from './consts.ts';
import { CD8, rosterReload } from '../hubsave.ts';

const fr = Math.fround;
/** _DAT_008920c4: a ground sample at or below it means "no ground" (-9.99999968e37, FUN_0043cd62's miss value) */
const NO_GROUND = fr(-9.999999680285692e37);
/** DAT_00892080 = 4.0: the step ahead of the board's water test, and FUN_0043cd62's dy */
const AHEAD = 4.0, GROUND_DY = 4.0;

/** what the Enter key and the every-tick part of the decor do (FUN_00765281 / FUN_00765316): set by the zone module (src/zones/z23DIP/decor.ts) */
export interface DecorHooks {
  /** Enter was pressed this tick (DAT_00983840 & 0x10000): FUN_00765281(Pepper) */
  enter(w: World, pepper: GameRecord): void;
  /** every tick: FUN_00765316(Pepper) (the roster's busy list FUN_00420590 + the decor animation FUN_00420dc4) */
  tick(w: World, pepper: GameRecord): void;
}
const HOOKS_KEY = 'z23DIP.decor';
export function setDecorHooks(w: World, h: DecorHooks | null) { if (h) w.ext.set(HOOKS_KEY, h); else w.ext.delete(HOOKS_KEY); }

/** the sound id behind a handle global: the emulated sound loader's table first (HubContext.soundOf), the constant of the decompile otherwise */
export function soundId(c: IslandCtx | null | undefined, s: SoundRef): number {
  const v = (c as unknown as { soundOf?(a: number): number } | null | undefined)?.soundOf?.(s.addr);
  return v !== undefined && v >= 0 ? v : s.id;
}

export class DipPepSwitch implements BehaviourNode {
  readonly kind = 'PeppSw';
  var: number = VAR.CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node + 0x18: the activity level (1 walking, 2 walking in the clips 0x24 / 0x3f / 0x40, 3 on the board) */
  groove = 1;
  /** node + 0x1c: the level the music was last told about */
  lastGroove = 1;
  /** node + 0x20: the node is the one of story node 50 (the Rex step sounds and the random calls play there) */
  returnVisit = false;
  /** node + 0x24 / 0x28 / 0x2c: the last good place on the ground (the constructor takes Pepper's place at set-up) */
  safe: [number, number, number] | null = null;
  /** the 3 padding bytes after the byte at +0x20 (debug heap fill 0xCD, kept through a load for the save block) */
  private pad: [number, number, number] = [CD8, CD8, CD8];
  private begun = false;

  /**
   * FUN_00727e21 (`*out = node + 0x18; return 0x18`): +0x18 level, +0x1c last level, +0x20 byte (story node 50) + 3 padding bytes, +0x24 / +0x28 / +0x2c the last good place. The place is the
   * constructor's (Pepper's position at the set-up) until the first update: `init` is the port's constructor half.
   */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    if (!this.begun) this.init(w, rec);
    const b = new Uint8Array(24), v = new DataView(b.buffer), s = this.safe ?? [0, 0, 0];
    v.setInt32(0, this.groove, true); v.setInt32(4, this.lastGroove, true);
    b[8] = this.returnVisit ? 1 : 0; b[9] = this.pad[0]; b[10] = this.pad[1]; b[11] = this.pad[2];
    v.setFloat32(12, s[0], true); v.setFloat32(16, s[1], true); v.setFloat32(20, s[2], true);
    return b;
  }
  /** FUN_00727e46: a plain copy of the 0x18 bytes, then FUN_00765180 (the decor sets' era table, the (empty) roster's busy list) */
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.begun = true;                       // the node's memory is the file's now: the constructor half must not run again
    this.groove = v.getInt32(0, true); this.lastGroove = v.getInt32(4, true);
    this.returnVisit = data[8] !== 0; this.pad = [data[9], data[10], data[11]];
    this.safe = [v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)];
    rosterReload(w);
  }

  /**
   * FUN_00727e84 (the constructor, run at set-up): `+0x20 = (story node == 0x32)` and the last good place = Pepper's place. A node factory knows neither the world nor the
   * record, so the port does it at the first call (the first tick of the zone: nothing has moved Pepper yet, and the story node does not change before it).
   */
  init(w: World, rec: GameRecord) {
    this.begun = true;
    this.returnVisit = w.vars.get(VAR.STORY) === NODE_RETURN;
    this.safe = [rec.x, rec.y, rec.z];
  }

  /** the framework's `ctorInit` hook (src/hub/game.ts, after the world work of the set-up): the constructor's record-dependent half */
  ctorInit(w: World, rec: GameRecord) { this.init(w, rec); }

  /** FUN_00727360: the zone's sounds, then continue the chain (returns 2) */
  update(w: World, rec: GameRecord): number {
    if (!this.begun) this.init(w, rec);
    const c = tryCtx(w);
    if (!c) return NODE_CONTINUE;
    const R = w.records;
    const pos = (i: number): [number, number, number] => { const r = R[i]; return [r.x, r.y, r.z]; };
    // FUN_004435a0(DAT_05d5d13c): the 2D ambience; FUN_004433f0(DAT_05d5d138, HALL's position): the hall
    c.sfx(soundId(c, SND.AMBIENT));
    c.sfxAt(soundId(c, SND.HALL), pos(REC.HALL));
    if (this.returnVisit) {
      c.sfxAt(soundId(c, SND.PTER), pos(REC.PTER));
      c.sfxAt(soundId(c, SND.REX4), pos(REC.REX4));
      // the Rex records REX1 .. REX7 (the table's order: 11, 20, 21, 22, 23, 29, 30): while the animation's frame is below 4 (ftol of the frame) the step sound plays - at REX1's
      // position, whichever Rex it is (the decompile reads `DAT_00983804 + 0x4b4` for all seven)
      const rex = [REC.REX1, REC.REX2, REC.REX3, REC.REX4, REC.REX5, REC.REX6, REC.REX7];
      for (let k = 0; k < rex.length; k++) {
        const a = R[rex[k]]?.anim;
        if (a && Math.trunc(a.frame) < 4) c.sfxAt(soundId(c, SND.STEP[k]), pos(REC.REX1));
      }
      // FUN_004388ae(300): the brontosaurus roars: 298 -> 0x322 (DAT_05d5d144), 299 / 300 -> 0x321 (DAT_05d5d140), at BRON
      const r1 = randTrunc(300);   // FUN_004388ae(300.0) -> __ftol: the float32 product of src/island/rng.ts on the shared crt.ts rand()
      if (r1 < 299) { if (r1 > 0x129) c.sfxAt(soundId(c, SND.BRON_B), pos(REC.BRON)); }
      else c.sfxAt(soundId(c, SND.BRON_A), pos(REC.BRON));
      // FUN_004388ae(60): the creature whose position the next call plays at: < 10 TRI2, < 20 TRI1, < 30 STE2, < 40 STE1, < 50 TRX2, else TRX1
      const r2 = randTrunc(60);   // FUN_004388ae(60.0) -> __ftol
      const who = r2 < 10 ? REC.TRI2 : r2 < 20 ? REC.TRI1 : r2 < 30 ? REC.STE2 : r2 < 40 ? REC.STE1 : r2 < 50 ? REC.TRX2 : REC.TRX1;
      const at = pos(who);
      // FUN_004388ae(300): 297 -> 0x320, 298 -> 0x31f, 299 / 300 -> 0x31e
      const r3 = randTrunc(300);  // FUN_004388ae(300.0) -> __ftol
      if (r3 < 299) {
        if (r3 < 0x12a) { if (r3 > 0x128) c.sfxAt(soundId(c, SND.CALL_C), at); }
        else c.sfxAt(soundId(c, SND.CALL_B), at);
      } else c.sfxAt(soundId(c, SND.CALL_A), at);
    }
    return NODE_CONTINUE;
  }

  /** FUN_007277f1 */
  prerender(w: World, rec: GameRecord, _ctrl?: Controller): void {
    void _ctrl;
    if (!this.begun) this.init(w, rec);
    const c = tryCtx(w);
    const G = vehicles(w);
    const pressed = w.input.pressed;
    const word = w.vars.get(VAR.CONTROL);
    const base = word & 0xfff;
    const sea = w.seaLevel;
    const mailbox = w.pep.mailbox;
    const clip = rec.anim?.clip ?? -1;
    const skbd = w.records[REC.SKBD] ?? null;      // `DAT_00983804 + 0xb68`
    const board = w.records[G.board] ?? null;      // DAT_009daa7c
    let mode = 0;     // local_14
    let state = 0;    // local_20 (a byte)
    const restore = () => { if (this.safe) { rec.x = this.safe[0]; rec.y = this.safe[1]; rec.z = this.safe[2]; } };
    /** FUN_0043cd62(pos, 4): the ground below Pepper; on a hit Pepper is lifted onto it, otherwise she goes back to the last good place */
    const ground = () => {
      const h = fr(w.col.terrainHeight(rec.x, rec.y, rec.z, GROUND_DY));
      if (h <= NO_GROUND) restore(); else rec.y = h;
    };
    switch (base) {
      case 1: {
        const blocked = (pressed & B.CTRL) === 0 || NO_BOARD_MAILBOX.includes(mailbox) || NO_BOARD_CLIPS.includes(clip);
        if (blocked) this.groove = GROOVE2_CLIPS.includes(clip) ? 2 : 1;
        else {
          // Ctrl: on the skateboard (clip 1 of the board record, shown, the sound DAT_009da978)
          mode = 4; state = 0x16;
          skbd?.anim?.start(1, 0);
          board?.show();
          sfx(w, SND_BOARD_ON);
        }
        if (sea < rec.y) {
          if (!NO_BOARD_MAILBOX.includes(mailbox) && !NO_BOARD_CLIPS.includes(clip)) this.safe = [rec.x, rec.y, rec.z];
        } else ground();
        break;
      }
      case 2:
        ground();
        mode = 1; state = ST.OUTOFWATER;
        break;
      case 4: {
        if (((pressed & B.CTRL) === 0 && (word & 0x1000) === 0) || mailbox === 0x20 || mailbox === 0x32) this.groove = 3;
        else {
          // Ctrl (or the interact bit) gets off: the walk state 0x1c, the board's clip 2, the rolling sounds stop, the getting-off sound
          mode = 1; state = ST.OFFBOARD;
          skbd?.anim?.start(2, 0);
          for (const id of SKATE_ROLL_SOUNDS) stopSfx(w, id);
          sfx(w, SND_BOARD_OFF);
        }
        // the water ahead (4 units along Pepper's forward row, FUN_0043cd62 from 4 above): at or below the sea, and not in the air (mailbox 0x20 / 0x21): get off
        const ax = fr(rec.x + fr(rec.m[8] * AHEAD)), ay = fr(rec.y + fr(rec.m[9] * AHEAD)), az = fr(rec.z + fr(rec.m[10] * AHEAD));
        const h = w.col.terrainHeight(ax, ay, az, GROUND_DY);
        if (h <= sea && mailbox !== 0x20 && mailbox !== 0x21) {
          mode = 1; state = ST.OFFBOARD;
          board?.anim?.start(2, 0);
        }
        break;
      }
      default: break;
    }
    if (state !== 0) { w.pep.mailbox = state; rec.anim?.start(state, 0); }
    if (mode !== 0) w.vars.set(VAR.CONTROL, mode | (word & 0x1000));
    // the music: FUN_00443310(level - 3) when the level changed
    if (this.groove !== this.lastGroove) {
      c?.musicGroove?.(this.groove - 3);
      this.lastGroove = this.groove;
    }
    const hooks = w.ext.get(HOOKS_KEY) as DecorHooks | undefined;
    if ((pressed & B.ENTER) !== 0) hooks?.enter(w, rec);
    hooks?.tick(w, rec);
  }

  /** FUN_00727f6c: the roster's cyclers are freed, the zone's looping sounds stop (the 2D ambience, the hall, the pterodactyl, REX4's) */
  destroy(w: World): void {
    const c = tryCtx(w);
    if (!c) return;
    for (const s of [SND.AMBIENT, SND.HALL, SND.PTER, SND.REX4]) c.stopSfx(soundId(c, s));
  }
}
