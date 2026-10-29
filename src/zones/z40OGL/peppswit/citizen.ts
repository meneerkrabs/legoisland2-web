// The citizens of Ogel's island (PeppSwit.c ctor 0x7e69a2, 5 attaches CIT1..CIT5 at position 1 of the chain, after the record's SGMFIG node that owns the waypoint walker; vtable 0x94c7b0
// = { update FUN_007e6542, pre-render FUN_007e68ee (returns 1), destroy FUN_007e6ac6, draw FUN_007e6908 (the default draw, returns 1), load FUN_007e6969, save FUN_007e6944 }).
// A citizen walks a short patrol on the PATH map (the nodes of one row of the table at 0x94c7c8: entry 0 is unused, the nodes follow from entry 1, ended by -1), is glued to the ground
// below it, and when the ground gives way (the terrain is below the sea) it is put 40 above its next node and falls back onto it. In the first part of the island (DAT_05d5f3bc == 1)
// each citizen has its own 3D sound (the handle of the argument block) that plays at its place while it walks.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import { NODE_STOP } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import type { Attach } from '../../../formats/zonesetup.ts';
import { ArgView } from '../../../island/args.ts';
import { tryCtx } from '../../../island/ctx.ts';
import { pepperSide } from '../../../island/npc/globals.ts';
import { waypoints } from '../../../game/walker.ts';
import type { StepOut } from '../../../game/walker.ts';
import { oglGlobals, soundOfToken, play3dId, stopId } from './globals.ts';
import { fr, f32bits, rotateFromEuler } from './util.ts';

export const CITIZEN = {
  /** the route table: rows of four ints (the VA is read from the executable at run time) */
  TABLE_VA: 0x94c7c8, ROW_BYTES: 0x10,
  /** FUN_004242f0(rec, &d, 576, 0x3f490f94): Pepper within 24 (squared 576), the cone pi / 4 (only its side effect on the controller's flags matters) */
  NEAR2: 576.0, CONE: f32bits(0x3f490f94),
  /** _DAT_00892084 (0.8): how far a falling citizen drops per tick (not scaled by dt) */ FALL: fr(0.8),
  /** _DAT_00892528 (40): the height above the node a citizen reappears at; _DAT_00892080 (4): CIT4 hovers this much higher */ SPAWN_UP: 40.0, CIT4_UP: 4.0,
  /** the walking-state values of +0x28 */ NEW: -1, WALK: 0, FALLING: 2,
} as const;

export class CitizenNode implements BehaviourNode {
  readonly kind = 'PeppCitizen';
  var = 0xa1; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x14 (short): the table row; +0x16 (short): the walking clip (0 = none); +0x18: the speed the constructor read (stored, never used again) */
  row = 0; clip = 0; speed = 0;
  /** +0x1c: the sound handle (a token of the emulated set-up) and the sound id behind it */
  handle = 0; sound = -1;
  /** +0x20: the index into the row (starts at 1); +0x28: -1 new, 0 walking, 2 falling */
  cur = 1; state: number = CITIZEN.NEW;
  private args: ArgView;
  private inited = false;
  private out: StepOut = { yaw: 0, dist: 0 };

  constructor(attach: Attach & { args?: Uint8Array }) { this.args = ArgView.of(attach); }

  private tbl(w: World, i: number): number {
    const pe = tryCtx(w)?.pe;
    return pe ? pe.u32(CITIZEN.TABLE_VA + this.row * CITIZEN.ROW_BYTES + i * 4) | 0 : -1;
  }

  /** FUN_007e69a2: the walker's speed times the argument, the speed scale 1.0, the walking clip */
  private init(w: World, rec: GameRecord, ctrl: Controller) {
    this.inited = true;
    const a = this.args;
    this.row = a.i16(0); this.handle = a.u32(8); this.sound = soundOfToken(w, this.handle);
    const h = ctrl.walker;
    const wk = h ? waypoints.get(h) : null;
    this.speed = fr((wk ? wk.speed : 0) * a.f32(4));
    if (h) waypoints.setSpeedScale(h, 1.0);
    this.clip = a.i16(2);
    if (this.clip !== 0) rec.anim?.start(this.clip, 0);
    this.cur = 1; this.state = CITIZEN.NEW;
  }

  /** FUN_007e6542: returns 1 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    const h = ctrl.walker;
    if (this.state === CITIZEN.FALLING) {
      const t = waypoints.nodePos(1, this.tbl(w, this.cur), [0, 0, 0]);
      if (rec.y <= t[1]) {
        rec.y = t[1];
        this.state = CITIZEN.WALK;
        waypoints.teleport(h, this.tbl(w, this.cur));       // FUN_004625d7: the walker stands on the node again
        waypoints.setSpeedScale(h, 1.0);                    // FUN_004621c7
        this.cur++;
        if (this.tbl(w, this.cur) === -1) this.cur = 1;
        waypoints.goTo(h, this.tbl(w, this.cur), 0);        // FUN_00461c24(handle, node, 0)
        this.state = CITIZEN.WALK;
      } else rec.y = fr(rec.y - CITIZEN.FALL);
    } else {
      pepperSide(w, rec, ctrl, CITIZEN.NEAR2, CITIZEN.CONE);    // FUN_004242f0: its flag side effects on the controller
      if (this.state !== CITIZEN.WALK) { this.state = CITIZEN.WALK; waypoints.goTo(h, this.tbl(w, this.cur), 0); }
      const pos = [rec.m[12], rec.m[13], rec.m[14]];
      this.out.yaw = rec.ry; this.out.dist = 0;
      const code = waypoints.step(h, pos, rec.ry, this.out, w.dt);   // FUN_004626d0
      const yaw = this.out.yaw;
      let y = w.col.terrainHeight(pos[0], pos[1], pos[2], 4.0);      // FUN_0043cd62(&pos, 4): the ground below
      if (y < w.seaLevel) {
        // no ground: above the node it is walking to, to fall back onto it
        const t = waypoints.nodePos(1, this.tbl(w, this.cur), [0, 0, 0]);
        pos[0] = t[0]; y = t[1]; pos[2] = t[2];
        y = fr(y + CITIZEN.SPAWN_UP);
        this.state = CITIZEN.FALLING;
      }
      if (code === this.tbl(w, this.cur) || code === -1) {
        this.cur++;
        if (this.tbl(w, this.cur) === -1) this.cur = 1;
        waypoints.goTo(h, this.tbl(w, this.cur), 0);
      }
      rec.m[13] = fr(y); rec.m[12] = fr(pos[0]); rec.m[14] = fr(pos[2]); rec.ry = fr(yaw);
      rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
      if (rec.name.startsWith('CIT4')) rec.m[13] = fr(rec.m[13] + CITIZEN.CIT4_UP);
      if (this.clip !== 0) rec.anim?.advance(1.0, w.dt);
    }
    w.col.debug?.shape('zone', [rec.m[12], rec.m[13], rec.m[14]], 0, 3, 0xffff00ff);   // FUN_00445c70(pos, 0, 3.0, magenta) at the end of FUN_007e6542 (LE2.c:246986; Ontwikkelaarshoek)
    if (oglGlobals(w).part === 1) {
      if (this.state === CITIZEN.WALK) play3dId(w, this.sound, [rec.m[12], rec.m[13], rec.m[14]]);
      else stopId(w, this.sound);
    }
    return NODE_STOP;
  }

  /** FUN_007e6944 / FUN_007e6969: +0x20..+0x2b (the index, an unused word, the state) */
  saveBlob(): Uint8Array {
    const b = new Uint8Array(12), dv = new DataView(b.buffer);
    dv.setInt32(0, this.cur, true); dv.setInt32(8, this.state, true);
    return b;
  }
  loadBlob(b: Uint8Array): void { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.cur = dv.getInt32(0, true); this.state = dv.getInt32(8, true); }
}
