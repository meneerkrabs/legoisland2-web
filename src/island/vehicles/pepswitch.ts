// Pepper's mode switch of the island and the two passive nodes of his chain (docs/re/m4/wp6-vehicles.md):
//   "PepSwitc" (Common\Z02LGI\PepSwitc.c): ctor FUN_004bbef8, handler table 0x8d9d18 = { update FUN_004bb630, pre-render FUN_004bb67d, destroy FUN_004bbfb2, draw FUN_004bbe59 }
//   "SGVehic"  (SGGen\c_src\SGVehic.c):    ctor FUN_004333c2, table 0x8ae318 = { update FUN_00433160 (returns 1), pre-render FUN_00433173 (Pepper on the seat) }
//   "Ptera"    (the riding half on PEPP):  ctor FUN_004bb582, table 0x8d9c98 = { update FUN_004bb425, pre-render FUN_004bb43f }: both only return 1 (the flying
//              Ptera FUN_004bb1a6 / FUN_004b93b0 moves Pepper itself, WP7)
// PEPPER_CONTROL (var 0x5e) & 0xfff is the mode: 1 walk, 2 swim, 4 skateboard, 8 vehicle, 0x40 Ptera, 0x401 = "leaving a car" (one tick: the update puts
// Pepper on the free spot the pre-render found, then the walk code takes over); 0x1000 (interact) survives every change.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { toWorld } from '../../zones/exact.ts';
import { ST } from '../../game/walk.ts';
import { tryCtx } from '../ctx.ts';
import { waypoints } from '../../game/walker.ts';
import { VV, vehicles, sfx, stopSfx, partPos } from './common.ts';
import { SKATE_ROLL_SOUNDS } from './skate.ts';
import { lookPrerender, restoreLooks } from './looks.ts';
import { SND_LGI_SEA, lgiSeaPosition } from '../../audio/sea.ts';
import { BlockIn, BlockOut } from '../blockio.ts';
import { CD8, CD_F32 } from '../../game/heapfill.ts';

/** sound ids (FUN_004b0f16): DAT_009da978 getting on the board, DAT_009da940 getting off, DAT_009da93c leaving the water */
const fr = Math.fround;
export const SND_BOARD_ON = 0x150, SND_BOARD_OFF = 0x106, SND_OUT_OF_WATER = 0x128;
/** walk states that keep Pepper off the board (jump, jump start, hard landing, second jump, teeter) and his clips 99 / 0x62 (the dive) */
const NO_BOARD_STATES = [ST.JUMP, ST.JUMPSTART, ST.LANDING, ST.JUMP2, ST.TEETER];

/**
 * FUN_0088e030(rec, out, step): a free spot to leave a car. Tries rec - right * r, + right * r, + forward * r, - forward * r with r growing by `step`;
 * a spot counts when the terrain there is above the sea (surface 9 = a roof: the terrain 36 lower is used) and nothing solid is within 56 units below
 * 48 above it (FUN_00441ac0, mask 3). The original multiplies the two vectors by the radius again in every round (so the distances grow 4, 32, 384 ...)
 * and never gives up; the port stops after 6 rounds and then reports the waypoint node 0x1a4 of the PATH map (the original's unreachable fallback).
 */
export function findFreeSpot(w: World, rec: GameRecord, out: number[], step: number): boolean {
  let r = step;
  let rx = rec.m[0], ry = rec.m[1], rz = rec.m[2];
  let fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
  const x = rec.x, y = fr(rec.y + 48.0), z = rec.z;   // DAT_008925e0 = 48
  const sea = w.seaLevel;
  // every value is a float32 (the original's locals / the spot array)
  const tryAt = (px: number, py: number, pz: number): boolean => {
    out[0] = px; out[1] = py; out[2] = pz;
    let t = fr(w.col.terrainHeight(px, py, pz, 0));
    if (sea <= t && w.col.lastSurface() === 9) { out[1] = fr(out[1] - 36.0); t = fr(w.col.terrainHeight(out[0], out[1], out[2], 0)); }   // DAT_0089269c = 36
    if (sea < t) {
      const h = w.col.probe(rec, out, [0, -56, 0], 3);
      if (!h) { out[1] = t; return true; }
    }
    return false;
  };
  for (let round = 0; round < 6; round++) {
    rx = fr(-r * rx); ry = fr(-r * ry); rz = fr(-r * rz);
    fx = fr(fx * r); fy = fr(fy * r); fz = fr(fz * r);
    if (tryAt(fr(x + rx), fr(y + ry), fr(z + rz))) return true;
    if (tryAt(fr(x - rx), fr(y - ry), fr(z - rz))) return true;
    if (tryAt(fr(x + fx), fr(y + fy), fr(z + fz))) return true;
    if (tryAt(fr(x - fx), fr(y - fy), fr(z - fz))) return true;
    r = fr(r + step);
  }
  // FUN_00462be9(1, 0x1a4, out)
  const p = [0, 0, 0];
  const n = waypointsNodePos(0x1a4, p);
  out[0] = n[0]; out[1] = n[1]; out[2] = n[2];
  return true;
}
const waypointsNodePos = (node: number, out: number[]) => waypoints.nodePos(1, node, out);

export class IslandPepSwitch implements BehaviourNode {
  readonly kind = 'PepSwitc';
  var: number = VV.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node + 0x18: the spot FUN_0088e030 found to leave a car (the constructor never writes it: the debug heap's 0xCD words until the first car is left) */
  spot = [CD_F32, CD_F32, CD_F32];
  /** node + 0x24: bit 1 = the story-node-30 hologram timer was started */
  flags = 0;

  /**
   * FUN_004bbe95 (vtable +0x14): `*out = node + 0x18; return 0x10` = the spot (3 floats) and the flags dword (+0x24). FUN_004bbeba (+0x10): the 16 byte memcpy back, then FUN_0051c800 =
   * FUN_00420674(0) (the decor sets' era table from the story variables, `applyDecorSets`) + FUN_004202ef (the roster re-applied: every cycler gets its look from the stored game
   * variable, the busy list is cleared: `restoreLooks`).
   */
  saveBlock(): Uint8Array { return new BlockOut(16).f32(0, this.spot[0]).f32(4, this.spot[1]).f32(8, this.spot[2]).u32(12, this.flags).bytes; }
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.spot = [b.f32(0), b.f32(4), b.f32(8)]; this.flags = b.u32(12);
    restoreLooks(w);
  }

  /** FUN_004bb630: while PEPPER_CONTROL has 0x401 (leaving a car) Pepper is put on the free spot */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const word = w.vars.get(VV.PEPPER_CONTROL);
    if ((word & 0x401) === 0x401) { rec.x = this.spot[0]; rec.y = this.spot[1]; rec.z = this.spot[2]; }
    // the top of the walk node's update (FUN_0042d514: _DAT_008ae330 = 576.0) runs right after this node whenever the walk node does
    if ((word & 1) === 1) vehicles(w).range = 576.0;
    return NODE_CONTINUE;
  }

  /** FUN_004bb67d */
  prerender(w: World, rec: GameRecord, _ctrl: Controller): void {
    void _ctrl;
    const G = vehicles(w);
    const pressed = w.input.pressed;
    // Enter: FUN_0051db5c (nearest record: vehicle looks, src/island/vehicles/looks.ts), every tick FUN_0051dbd7
    lookPrerender(w, rec);
    const word = w.vars.get(VV.PEPPER_CONTROL);
    const base = word & 0xfff;
    const ctrlKey = (pressed & B.CTRL) !== 0 || (word & 0x1000) !== 0;
    const mailbox = w.pep.mailbox;
    const board = w.records[G.board] ?? null;
    let mode = 0;      // local_14
    let state = 0;     // local_2c
    let walk = false;
    if (base === 4) {
      // on the skateboard: Ctrl gets off (not in the air: mailbox 0x20 / 0x32)
      if (ctrlKey && mailbox !== 0x20 && mailbox !== 0x32) {
        mode = 1; state = ST.OFFBOARD;
        board?.anim?.start(2, 0);
        for (const id of SKATE_ROLL_SOUNDS) stopSfx(w, id);
        sfx(w, SND_BOARD_OFF);
      }
      // ... and so does water 4 units ahead (not in the air, not while getting on: clip 0x16)
      const ax = fr(fr(rec.m[8] * 4.0) + rec.x), ay = fr(fr(rec.m[9] * 4.0) + rec.y), az = fr(fr(rec.m[10] * 4.0) + rec.z);
      if (w.col.terrainHeight(ax, ay, az, 4.0) <= w.seaLevel && mailbox !== 0x20 && mailbox !== 0x21 && rec.anim?.clip !== 0x16) {
        mode = 1; state = ST.OFFBOARD;
        board?.anim?.start(2, 0);
      }
    } else if (base === 2) {
      // swimming: out of the water where the terrain one unit ahead reaches the sea level
      const px = fr(rec.m[8] + rec.x), pz = fr(rec.m[10] + rec.z), py = fr(fr(rec.m[9] + rec.y) + 4.0);
      if (w.seaLevel <= fr(w.col.terrainHeight(px, py, pz, 4.0))) {
        mode = 1; state = ST.OUTOFWATER;
        sfx(w, SND_OUT_OF_WATER);
        rec.y = py; rec.x = px; rec.z = pz;
      }
    } else if (base === 8) {
      // in a car (kind -1): Ctrl leaves it at a free spot next to it
      if (ctrlKey && G.kind === -1 && findFreeSpot(w, rec, this.spot, 4.0)) {
        G.current = null;
        mode = 0x401; state = ST.IDLE;
      }
    } else if (base === 1) walk = true;
    else if (base === 0x401) { mode = 1; walk = true; }
    if (walk) {
      if ((this.flags & 1) === 0 && w.vars.get(VV.STORY) === 0x1e) {
        this.flags |= 1;
        // FUN_0088d2bc: _DAT_05defbcc = 90.0, the hologram's call timer (WP8's objective.holoTimer)
        const c = tryCtx(w);
        if (c?.objective) c.objective.holoTimer = 90.0;
      }
      w.vars.set(VV.PORTAL_VEHICLE, 0);
      const clip = rec.anim?.clip ?? -1;
      const blocked = (pressed & B.CTRL) === 0 || (NO_BOARD_STATES as readonly number[]).includes(mailbox) || clip === 99 || clip === 0x62 || G.current !== null;
      if (blocked) {
        // a vehicle chose Pepper this tick (Ctrl next to it): the getting-in clip
        if (G.current !== null) state = 0x4c;
      } else {
        // Ctrl: on the skateboard
        mode = 4; state = 0x16;
        board?.anim?.start(1, 0);
        sfx(w, SND_BOARD_ON);
        board?.show();
      }
      if (rec.y < w.seaLevel) { mode = 2; state = 0x62; }
    }
    if (state !== 0) { w.pep.mailbox = state; rec.anim?.start(state, 0); }
    if (mode !== 0) w.vars.set(VV.PEPPER_CONTROL, mode | (word & 0x1000));
    // (the rest: FUN_004bc527(near the sea) is an empty function.) FUN_004433f0(DAT_05d5812c = SND_LGI_SEA, p): the sea loop sits on the nearest shore point of the
    // +-400 square (src/audio/sea.ts), every frame, whatever Pepper does (A3, docs/re/audio.md 3.3)
    tryCtx(w)?.sfxAt(SND_LGI_SEA, lgiSeaPosition(rec.x, rec.z, w.seaLevel));
  }
}

/** SGVehic (FUN_004333c2): while PEPPER_CONTROL & 8 the update stops Pepper's chain and the pre-render puts him on the vehicle's seat */
export class VehicleSeat implements BehaviourNode {
  readonly kind = 'SGVehic';
  var: number = VV.PEPPER_CONTROL; mask = 8; value = 8;
  stamp = 0xfffffffe;
  /** node +0x15: a byte nothing in the executable writes (the node is 0x18 bytes, the constructor leaves +0x14 .. +0x17 as allocated: the debug heap's 0xCD); the save block carries it as it is */
  b15 = CD8;
  /** FUN_0043337c / FUN_0043339a (vtable +0x14 / +0x10): `*out = node + 0x15; return 1` and the 1 byte memcpy back */
  saveBlock(): Uint8Array { return new BlockOut(1).u8(0, this.b15).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.b15 = new BlockIn(data).u8(0); }
  /** FUN_00433160 */
  update(): number { return NODE_STOP; }
  /** FUN_00433173: Pepper's rotation = the vehicle's, his position = the vehicle's mesh part 1 (the seat) in the vehicle's frame */
  prerender(w: World, rec: GameRecord): void {
    const G = vehicles(w);
    const v = G.current;
    if (!v) return;
    if (this.stamp !== w.frame) G.range = -8.0;      // no other vehicle can take Pepper while he sits in one
    for (let i = 0; i < 11; i++) if (i !== 3 && i !== 7) rec.m[i] = v.m[i];
    const seat = seatPos(w, v);
    const p = toWorld(v.m, seat);
    rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
  }
}
function seatPos(w: World, v: GameRecord): [number, number, number] { return partPos(w, v, 1) ?? [0, 0, 0]; }

/** "Ptera" on PEPP (FUN_004bb582): stops Pepper's chain while he rides the Ptera (PEPPER_CONTROL & 0x40); the Ptera's own node (ptera.ts, WP13) moves him */
export class PteraRide implements BehaviourNode {
  readonly kind = 'Ptera';
  var: number = VV.PEPPER_CONTROL; mask = 0x40; value = 0x40;
  stamp = 0xfffffffe;
  update(): number { return NODE_STOP; }
  prerender(): void { /* FUN_004bb43f: returns 1 */ }
  /**
   * The save block, FUN_004bb495 (vtable +0x14: the cell's buffer protocol, `memcpy(buf, node + 0x18, 8)`) and the loader FUN_004bb50f (`memcpy(node + 0x18, bytes, 8)`): the node's last 8 bytes (the node is
   * 0x20 long). Nothing ever writes them: they stay what the allocation left (0) or a loaded block put there; the bytes are kept as they are.
   */
  private readonly raw = new Uint8Array(8).fill(0xcd);
  saveBlock(): Uint8Array { return this.raw.slice(); }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.raw.set(data.subarray(0, 8)); }
}
