// WP6: what Pepper's modes and the island's vehicles share (docs/re/m4/wp6-vehicles.md). The original keeps all of it in globals of SGGen\c_src
// (SGBoat.c / SGHeli.c / SGVehic.c / SGCar.c) and of the island's PepSwitc.c; the port keeps one `VehicleGlobals` per world (world.ext, key VEH_KEY).
//
// Shared with other work packages:
//   * `vehicles(w).current` = DAT_009daa80, the vehicle Pepper sits in (or is getting into). The island's arrival code (FUN_004c2d22, src/zones/z02LGI/arrival.ts)
//     starts Pepper in a vehicle by setting `current` and PEPPER_CONTROL = 8 (the vehicle's own node then turns the engine on, exactly like the original).
//   * `vehicles(w).kind` = the high word of DAT_009da9f8: what Pepper drives (-1 car, -2 boat, -3 helicopter, -4 / -5 set by the pizza / Ptera code);
//     the objective arrow (FUN_00424e37, WP8) points at the nearest free dock / helipad with it.
//   * var 0x0c SWITCH_NS_INTERACT_ICONS: the vehicles OR in their "press Ctrl" icon bits (2 car, 4 helicopter, 8 boat, 0x40 helipad near, 0x80 dock near);
//     the HUD (WP8) shows and clears them.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { waypoints } from '../../game/walker.ts';
import { tryCtx } from '../ctx.ts';
import { partMatrix } from '../trigger/parts.ts';

export const VEH_KEY = 'island.vehicles';

/** game variables the family reads / writes */
export const VV = {
  /** SWITCH_NS_INTERACT_ICONS */
  ICONS: 0x0c,
  /** SWITCH_GME_PEPPER_CONTROL */
  PEPPER_CONTROL: 0x5e,
  /** FSM_CURRENT_STATE (story node) */
  STORY: 0x58,
  /** SWITCH_GME_PEPP_IN_VEHICLE (written by the Ptera, WP7) */
  PEPP_IN_VEHICLE: 0xa9,
  /** SWITCH_GME_PORTAL_VEHICLE (PepSwitc clears it while walking; the portals, WP4, set it) */
  PORTAL_VEHICLE: 0xbb,
  /** SWITCH_GME_PEPPERSSHADOW (4 after leaving a boat / helicopter, 1 in a helicopter) */
  SHADOW: 0xc5,
} as const;

/** interact-icon bits of var 0x0c */
export const ICON = { CAR: 2, HELI: 4, BOAT: 8, PAD: 0x40, DOCK: 0x80 } as const;

/** a boat dock / helipad: a PATH-map (1) node to stop at and the node Pepper steps off to (FUN_004b6475 fills both tables) */
export interface Berth { map: number; node: number; exit: number; taken: boolean }

/**
 * FUN_004b6475 (the island's set-up): DAT_009da9d4 (dock nodes) / DAT_009da9f0 (exit nodes) / DAT_009da9e4 (maps), count DAT_009da9e9 = 4, taken flags
 * DAT_009da9fc; the helipads DAT_009daa18 / DAT_009daa38 / DAT_009daa2c, count DAT_009daa14 = 10, taken DAT_009daa50.
 */
const DOCKS: [number, number][] = [[0x19e, 0x18e], [0x1a0, 0x18e], [0x19f, 0x18e], [0x1b5, 0x1b4]];
const PADS: [number, number][] = [[400, 0x56], [399, 0x9e], [0x1a6, 0x1b7], [0x1a8, 0x1a7], [0x1aa, 0x1a9], [0x1ac, 0x1ab], [0x1ae, 0x1ad], [0x1b0, 0x1af], [0x1b1, 0xf6], [0x1b3, 0x1b2]];

export class VehicleGlobals {
  /** DAT_009daa80: the vehicle Pepper sits in / is getting into (null = none) */
  current: GameRecord | null = null;
  /** DAT_009daa10: a boat was chosen this tick (its pre-render switches Pepper into it) */
  boatEnter = false;
  /** DAT_009daa78: the same for the helicopters (never cleared by the original) */
  heliEnter = false;
  /** DAT_05defbd0: the chosen car asks its pre-render to take Pepper in */
  carEnter = false;
  /** DAT_008ae330: squared distance of the nearest vehicle that wants Pepper this tick (the walk node resets it to 576 = 24^2 every tick, SGVehic to -8) */
  range = 12;
  /** high word of DAT_009da9f8: -1 car (PepSwitc lets Ctrl leave it anywhere), -2 boat, -3 helicopter (both leave at a dock / helipad only) */
  kind = 0;
  /** DAT_008ae1e0 (saved with the game, mirrors `kind`) */
  kind2 = 1;
  docks: Berth[] = DOCKS.map(([node, exit]) => ({ map: 1, node, exit, taken: false }));
  pads: Berth[] = PADS.map(([node, exit]) => ({ map: 1, node, exit, taken: false }));
  /** DAT_009daa7c: the skateboard record (9 = SBRD on the island, FUN_004b4220) */
  board = 9;
  /** DAT_05d57ff8: the surface whose rolling sound the skateboard plays (5 = none) */
  rollSurface = 5;
  /** DAT_05d58008 / DAT_05d58004: the trick score flags of skate.c (the tricks are not ported, docs) */
  trickFlag = 0; trickScore = 0;
}

export function vehicles(w: World): VehicleGlobals {
  let g = w.ext.get(VEH_KEY) as VehicleGlobals | undefined;
  if (!g) { g = new VehicleGlobals(); w.ext.set(VEH_KEY, g); }
  return g;
}

/** FUN_00462be9(map, node, out): a waypoint's position (0,0,0 when the maps are not loaded) */
export function berthPos(b: Berth, exit = false): number[] { return waypoints.nodePos(b.map, exit ? b.exit : b.node); }

/** FUN_00431260 */
export const fabs = (v: number) => (v <= 0 ? -v : v);

/** FUN_0045c432 (false without an island context) */
export function cutsceneActive(w: World): boolean { return tryCtx(w)?.cutsceneActive() ?? false; }
export function sfx(w: World, id: number) { const c = tryCtx(w); if (c) c.sfx(id); else w.playSound(id); }
export function stopSfx(w: World, id: number) { tryCtx(w)?.stopSfx(id); }
export function sfxFreq(w: World, id: number, hz: number) { tryCtx(w)?.sfxFreq?.(id, hz); }

/** FUN_0043a9e5(out, a, b): out = b * a (row vectors: b is applied first) */
export function mul(b: ArrayLike<number>, a: ArrayLike<number>, out = new Float32Array(16)): Float32Array {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = b[i * 4] * a[j] + b[i * 4 + 1] * a[4 + j] + b[i * 4 + 2] * a[8 + j] + (i === 3 ? a[12 + j] : 0);
  }
  r[15] = 1;
  out.set(r);
  return out;
}

/**
 * The vehicles' matrix: FUN_0043a340(Rz, 0, 0, rz) and FUN_0043a5e4(M, rx, ry, 0, pos) multiplied with FUN_0043a9e5(rec + 0xc, M, Rz) (the roll first).
 * Writes the Euler angles to +0x4c / +0x50 / +0x54.
 */
export function setVehicleMatrix(rec: GameRecord, rx: number, ry: number, rz: number, x: number, y: number, z: number) {
  rec.rx = rx; rec.ry = ry; rec.rz = rz;
  mul(buildMatrix(0, 0, rz, 0, 0, 0), buildMatrix(rx, ry, 0, x, y, z), rec.m);
}

/** FUN_0043ea60(model, i) + translation (+0x30): the local position of part i of the record's mesh (the seat is 1), null when unknown */
export function partPos(w: World, rec: GameRecord, i: number): [number, number, number] | null {
  const m = partMatrix(w, rec, i);
  return m ? [m[12], m[13], m[14]] : null;
}

/** FUN_0043cec0: normalise in place (a zero vector stays zero) */
export function normalize(v: number[]): number[] {
  const l = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (l !== 0) { const k = 1 / Math.sqrt(l); v[0] *= k; v[1] *= k; v[2] *= k; }
  return v;
}

/** FUN_0043b753 / FUN_0043b64d: Pepper's lean pose of a vehicle = frame n + n * s with n = trunc((frames - 1) * 0.5) (the boat and the helicopter truncate) */
export function leanFrame(rec: GameRecord, s: number, trunc: boolean) {
  const a = rec.anim;
  if (!a) return;
  const half = (a.frameCount - 1) * 0.5;
  if (trunc) { const n = Math.trunc(half); a.seek(Math.trunc(n + n * s)); }
  else a.seek(half * s + half);
}

/** DAT_0083850 / DAT_0098384c for the keyboard: the "pad" value -127 / 0 / 127 the vehicles build from two opposite buttons */
export function padAxis(held: number, neg: number, pos: number): number {
  if ((held & neg) !== 0 && (held & pos) === 0) return -0x7f;
  if ((held & pos) !== 0 && (held & neg) === 0) return 0x7f;
  return 0;
}
