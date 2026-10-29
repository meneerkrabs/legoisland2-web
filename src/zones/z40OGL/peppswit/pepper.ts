// Pepper's two nodes of Ogel's island (PeppSwit.c): the mode switch at the head of PEPP's chain and the void fall (docs/re/m5/z40OGL-peppswit.md).
//   PEPP's chain (FUN_007e3bd1): 0 PEPPSWIT (ctor 0x7e4f9c, always)  1 SGwalk (&1)  2 skate (&4)  3 void (ctor 0x7e539e, PEPPER_CONTROL & 0x20)
//   PEPPSWIT  vtable 0x94c730 = { update FUN_007e489b, pre-render FUN_007e4b12, destroy FUN_007e504c, draw FUN_007e4e36 (the default draw, returns 1), load FUN_007e4f1a, save FUN_007e4e72 }
//   void      vtable 0x94c748 = { update FUN_007e5138, pre-render FUN_007e52ea (returns 1), destroy FUN_007e5418, draw FUN_007e5304 (the default draw, returns 1), load FUN_007e5365, save FUN_007e5340 }
// PEPPER_CONTROL (var 0x5e) & 0xfff: 1 walk, 4 skateboard, 8 vehicle, 0x20 void; 0x1000 (interact) survives every change. There is no swimming on this island: below the sea level
// (DAT_009da858 = -96, FUN_007e3bd1) is the void.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import { NODE_CONTINUE, NODE_STOP } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import { RF_ENABLED } from '../../../game/record.ts';
import { waypoints } from '../../../game/walker.ts';
import { tryCtx } from '../../../island/ctx.ts';
import { vehicles, VV, sfx, stopSfx } from '../../../island/vehicles/common.ts';
import { SND_BOARD_ON, SND_BOARD_OFF } from '../../../island/vehicles/pepswitch.ts';
import { oglGlobals, SND, fr, play2d, play3d, stopSound, randInt } from './globals.ts';
import { decorInit, decorEnter, decorTick, decorDestroy } from './decor.ts';

/** the skateboard record SKBD (DAT_009daa7c = 0x1d, FUN_007e3bd1; the node reads its animation through `DAT_00983804 + 0xbd0` = record 29) */
export const BOARD_RECORD = 0x1d;
/** the respawn node of the PATH map (FUN_00462be9(1, 0x3e)) and the height above it Pepper reappears (_DAT_008928ec = 160) */
export const RESPAWN_NODE = 0x3e, RESPAWN_HEIGHT = 160.0;
/** Pepper falls at least this fast (_DAT_00892204 = -2) */
export const MIN_FALL = -2.0;
/** the clips the switch starts: getting on the board (0x16), off it (0x1c), into a vehicle (0x43), after the void (0x1b); the states that keep him off the board */
export const CLIP_BOARD_ON = 0x16, CLIP_BOARD_OFF = 0x1c, CLIP_VEHICLE = 0x43, CLIP_LANDED = 0x1b;
/** mailbox states (DAT_008ae088) that keep Pepper off the skateboard: 1 jump, 2, 'W' 0x57, 0x1f, '8' 0x38 and the clips 99 / 0x62 */
const NO_BOARD_STATES = [1, 2, 0x57, 0x1f, 0x38];
const NO_BOARD_CLIPS = [99, 0x62];

/** the eight skateboard roll handles FUN_007e4b12 stops, in its order: DAT_05d57fe0 fd0 fe8 fcc fdc fd8 fc8 fd4 (the island's FUN_004b0b37 gives the sounds 0x180 0x17f 0x182 0x185 0x185 300 0x181 0x184) */
const ROLL_STOP_ORDER = [0x180, 0x17f, 0x182, 0x185, 0x185, 300, 0x181, 0x184];

/** the 12 lamp records of FUN_007e42b0 (offsets `DAT_00983804 + 0x31f8 ...`: / 0x68) */
const L = (off: number) => off / 0x68;
const LAMPS_A: readonly (readonly [number, number])[][] = [
  // phase 0 / 1 / 2 of the normal blink (story node != 0x40): [record, mode]
  [[L(0x3468), 2], [L(0x3670), 2], [L(0x31f8), 2], [L(0x34d0), 0], [L(0x3608), 0], [L(0x3260), 0], [L(0x3538), 0], [L(0x35a0), 0], [L(13000), 0]],
  [[L(0x3468), 0], [L(0x3670), 0], [L(0x31f8), 0], [L(0x34d0), 2], [L(0x3608), 2], [L(0x3260), 2], [L(0x3538), 0], [L(0x35a0), 0], [L(13000), 0]],
  [[L(0x3468), 0], [L(0x3670), 0], [L(0x31f8), 0], [L(0x34d0), 0], [L(0x3608), 0], [L(0x3260), 0], [L(0x3538), 2], [L(0x35a0), 2], [L(13000), 2]],
];
const LAMPS_B: readonly (readonly [number, number])[][] = [
  // story node 0x40
  [[L(0x35a0), 2], [L(0x3330), 2], [L(0x3608), 0], [L(0x3398), 0], [L(0x3670), 0], [L(0x3400), 0]],
  [[L(0x35a0), 0], [L(0x3330), 0], [L(0x3608), 2], [L(0x3398), 2], [L(0x3670), 0], [L(0x3400), 0]],
  [[L(0x35a0), 0], [L(0x3330), 0], [L(0x3608), 0], [L(0x3398), 0], [L(0x3670), 2], [L(0x3400), 2]],
];

/** FUN_007e42b0: every 10 ticks the next of three lamp phases (render mode 2 = lit on the phase's records, 0 on the others of the group) */
export function lampBlink(w: World): void {
  const g = oglGlobals(w);
  const c = tryCtx(w);
  const table = w.vars.get(0x58) === 0x40 ? LAMPS_B : LAMPS_A;
  if (0 < g.lampTimer) { g.lampTimer = fr(g.lampTimer - fr(1.0 * w.dt)); return; }   // _DAT_00892020 * DAT_008b1718
  const rows = table[g.lampPhase];
  if (rows) for (const [i, mode] of rows) { const r = w.records[i]; if (r) c?.partMode?.(r, 0xff, mode); }
  else g.lampPhase = 0;
  g.lampPhase++;
  if (2 < g.lampPhase) g.lampPhase = 0;
  g.lampTimer = 10.0;
}

/** PEPPSWIT (ctor 0x7e4f9c) */
export class OglPepSwit implements BehaviourNode {
  readonly kind = 'PeppSwit';
  var: number = VV.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node +0x18 / +0x1c / +0x20: Pepper's position at the last update (the pre-render reads the height for the fall speed) */
  last: [number, number, number] = [0, 0, 0];
  private inited = false;

  /** the constructor's work (FUN_00811413: the decor / roster set-up of hub 5; needs the world): once, before the first update */
  private init(w: World) {
    if (this.inited) return;
    this.inited = true;
    vehicles(w).board = BOARD_RECORD;
    decorInit(w);
  }

  /** FUN_007e489b: the lamp blink, the ambience, random one-liners and the 3D emitters of the island; returns 2 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    this.init(w);
    const g = oglGlobals(w);
    lampBlink(w);
    // RNG: FUN_004388ae(300) / FUN_004388ae(120)
    const a = randInt(300);
    if (a < 299) { if (a < 0x12a) { if (0x128 < a) play2d(w, SND.RAND_297); } else play2d(w, SND.RAND_298); }
    else play2d(w, SND.RAND_299);
    play2d(w, SND.AMBIENCE);
    const pos = (i: number): [number, number, number] => { const r = w.records[i]; return [r.m[12], r.m[13], r.m[14]]; };
    play3d(w, SND.POINT, [20.0, 49.0, 101.0]);
    play3d(w, SND.REC40, pos(40));
    play3d(w, SND.REC42, pos(42));
    play3d(w, SND.REC41, pos(41));
    const b = randInt(120);
    if (b < 0x3b) { if (b < 0x3a) { if (0x38 < b) play3d(w, SND.MNK57, pos(14)); } else play3d(w, SND.MNK58, pos(13)); }
    else play3d(w, SND.MNK_REST, pos(12));
    if (g.part === 2) for (let i = 0; i < 5; i++) play3d(w, SND.CIT[i], pos(6 + i));
    this.last = [rec.m[12], rec.m[13], rec.m[14]];
    return NODE_CONTINUE;
  }

  /** FUN_007e4b12: the mode switch (void / skateboard / vehicle), then the decor swap on Enter and the decor animation */
  prerender(w: World, rec: GameRecord, _ctrl: Controller): void {
    void _ctrl;
    const g = oglGlobals(w), G = vehicles(w);
    const word = w.vars.get(this.var) >>> 0;
    const pressed = w.input.pressed;
    const mailbox = w.pep.mailbox;
    const board = w.records[BOARD_RECORD] ?? null;
    let mode = 0, clip = 0;
    if (rec.y < w.seaLevel) {
      mode = 0x20;
      G.skateReset = 1;                       // DAT_05d58009 = 1 (skate.c restarts its board state)
      g.fall = fr(rec.y - this.last[1]);
    } else if ((word & 0xfff) === 1) {
      const anim = rec.anim?.clip ?? -1;
      const blocked = (pressed & 0x10) === 0 || NO_BOARD_STATES.includes(mailbox) || NO_BOARD_CLIPS.includes(anim) || G.current !== null;
      if (blocked) {
        if (G.current !== null) { mode = 8; clip = CLIP_VEHICLE; }
      } else {
        mode = 4; clip = CLIP_BOARD_ON;
        board?.anim?.start(1, 0);
        const b = w.records[G.board]; if (b) b.flags |= RF_ENABLED;     // `DAT_00983804 + 0x60 + DAT_009daa7c * 0x68 |= 2`
        sfx(w, SND_BOARD_ON);
      }
    } else if ((word & 0xfff) === 4 && ((pressed & 0x10) !== 0 || (word & 0x1000) !== 0) && mailbox !== 0x20 && mailbox !== 0x32) {
      mode = 1; clip = CLIP_BOARD_OFF;
      board?.anim?.start(2, 0);
      for (const id of ROLL_STOP_ORDER) stopSfx(w, id);
      sfx(w, SND_BOARD_OFF);
    }
    if (clip !== 0) { w.pep.mailbox = clip; rec.anim?.start(clip, 0); }
    if (mode !== 0) w.vars.set(this.var, (mode | (word & 0x1000)) >>> 0);
    if ((pressed & 0x10000) !== 0) decorEnter(w, rec);
    decorTick(w, rec);
  }

  /** FUN_007e504c: FUN_008115e9 (the decor brick effects), the 2D ambience and the eleven 3D emitters stop */
  destroy(w: World): void {
    decorDestroy(w);
    stopSound(w, SND.AMBIENCE);
    for (const a of [SND.REC40, SND.REC42, SND.REC41, SND.MNK_REST, SND.MNK58, SND.MNK57, ...SND.CIT]) stopSound(w, a);
  }

  /** FUN_007e4e72: the state the save game keeps: Pepper's last position and the fall speed (16 bytes) */
  saveBlob(w: World): Uint8Array {
    const b = new Uint8Array(16), dv = new DataView(b.buffer);
    for (let i = 0; i < 3; i++) dv.setFloat32(4 * i, this.last[i], true);
    dv.setFloat32(12, oglGlobals(w).fall, true);
    return b;
  }
  /** FUN_007e4f1a (and FUN_008113f0: the decor tables are rebuilt) */
  loadBlob(w: World, b: Uint8Array): void {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < 3; i++) this.last[i] = dv.getFloat32(4 * i, true);
    oglGlobals(w).fall = dv.getFloat32(12, true);
  }
}

/** the void (ctor 0x7e539e; gate PEPPER_CONTROL & 0x20): Pepper is put 160 above the respawn node and falls down to it */
export class OglVoidFall implements BehaviourNode {
  readonly kind = 'PeppVoid';
  var: number = VV.PEPPER_CONTROL; mask = 0x20; value = 0x20;
  stamp = 0xfffffffe;
  /** node +0x18 / +0x1c / +0x20: the camera's offset from Pepper */
  off: [number, number, number] = [0, 0, 0];

  /** FUN_007e5138: returns 1 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const g = oglGlobals(w);
    const cam = w.camera, c = cam.c;
    const t = waypoints.nodePos(1, RESPAWN_NODE, [0, 0, 0]);
    if (MIN_FALL < g.fall) g.fall = MIN_FALL;
    if (this.stamp !== w.frame) {
      // the first tick of the fall: the camera keeps its offset, Pepper is put above the respawn point
      this.off = [fr(fr(c[0]) - rec.x), fr(fr(c[1]) - rec.y), fr(fr(c[2]) - rec.z)];     // the original's camera is float32
      rec.y = fr(t[1]); rec.x = fr(t[0]); rec.z = fr(t[2]);
      rec.y = fr(rec.y + RESPAWN_HEIGHT);
    }
    c[4] = rec.y; c[3] = rec.x; c[5] = rec.z;
    c[0] = fr(this.off[0] + rec.x); c[1] = fr(this.off[1] + rec.y); c[2] = fr(this.off[2] + rec.z);
    if (this.stamp !== w.frame) cam.savePrev();     // (the port interpolates the camera between ticks: no swoosh over the teleport)
    rec.y = fr(g.fall + rec.y);
    if (fr(t[1]) <= rec.y) play2d(w, SND.FALL);
    else {
      w.vars.set(this.var, 1);
      w.pep.mailbox = CLIP_LANDED;
      rec.anim?.start(CLIP_LANDED, 0);
      rec.y = fr(t[1]);
      stopSound(w, SND.FALL);
      cam.init(rec);                      // FUN_00422b50(&DAT_009da5e8, rec + 0xc, 0)
    }
    return NODE_STOP;
  }

  /** FUN_007e52ea */
  prerender(): void { /* returns 1 */ }

  /** FUN_007e5340 / FUN_007e5365: the camera offset */
  saveBlob(): Uint8Array {
    const b = new Uint8Array(12), dv = new DataView(b.buffer);
    for (let i = 0; i < 3; i++) dv.setFloat32(4 * i, this.off[i], true);
    return b;
  }
  loadBlob(b: Uint8Array): void { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); for (let i = 0; i < 3; i++) this.off[i] = dv.getFloat32(4 * i, true); }
}
