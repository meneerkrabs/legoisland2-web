// FUN_004c2d22(PEPP): where Pepper arrives on the island, by the zone she comes from (FUN_0041ad80(0xa3) = PREV_SUBGAME). Called by the set-up FUN_004b6475;
// the x86 emulation runs it too (the PEPP record of `IslandSetup.records`), but its vector normalisation FUN_0043cec0 is a host stub there (returns 0 without
// normalising), so the vehicle arrivals come out 48.8 * |d| away: this port computes the place from the scene and the PATH waypoint map and takes only the
// emulated choices (the vehicle record FUN_0051e4b0 picked by var 0xbb, the PEPPER_CONTROL value) from the emulation.
import type { IslandSetup } from '../../formats/emusetup.ts';

/** DAT_0089258c: distance from the harbour record along the direction to record 123 (PIZB) for the vehicle arrivals */
export const VEHICLE_ARRIVAL_DIST = 48.8;

/** record index of a record pointer `DAT_00983804 + off` */
const R = (off: number) => off / 0x68;

export interface ArrivalRule {
  /** the record the place is relative to (local_1c) */
  base: number;
  /** PATH (map 1) node Pepper stands on, -1 = the vehicle place next to `base` */
  node: number;
  /** PEPPER_CONTROL of the arrival: 1 walking, 8 boat / helicopter, 0x40 Ptera (chosen by the vehicle record) */
  vehicle: 0 | 1 | 2;
}

/** the switch of FUN_004c2d22 on PREV_SUBGAME (zone table index) and the story node */
export function arrivalRule(prev: number, node: number): ArrivalRule {
  switch (prev) {
    case 3: return { base: R(13000), node: 0xef, vehicle: 0 };                 // z03PPH: PHSE, the house door
    case 4: case 5: return { base: R(0x3260), node: 0x10b, vehicle: 0 };       // z04IFC / z05WAB: INFC
    case 6: return { base: R(0x41d0), node: -1, vehicle: 1 };                  // z90CAS (z07CSI): PORS, on the boat (FUN_0051e4b0(1, 0), default SPBT 0x4238)
    case 10: case 11: case 13: case 0x13: return { base: R(0x4168), node: -1, vehicle: 2 };   // z90ADV / z90OSD / z90PYA / z90DIP: PORA, helicopter (default PHEL 0x4308) or Ptera
    case 0x18: return { base: R(0x2de8), node: node < 0x3b ? 0xff : 0xd7, vehicle: 0 };      // z36CNT: CTRL
    case 0x19: return { base: R(0x4238), node: node < 0x3b ? 0xff : 0x18e, vehicle: 0 };     // z38PAR: SPBT
    default: return { base: R(0x34d0), node: 0xf6, vehicle: 0 };               // anywhere else: SKTP, the skate park
  }
}

/** the record the vehicle-direction vector points at (`DAT_00983804 + 0x3234` = translation of record 123) */
export const VEHICLE_DIR_RECORD = (0x3234 - 0x3c) / 0x68;
/** FUN_004c2d22: vehicle record 0x1ad0 (PTER, record 66) -> PEPPER_CONTROL 0x40, other vehicles 8 */
export const PTERA_RECORD = R(0x1ad0);

/** atan2(dx, dz) wrapped into [-pi, pi] like the original (DAT_00892098 / 0089207c / 00892094) */
function yawOf(dx: number, dz: number): number {
  let a = Math.atan2(dx, dz);
  if (a < -Math.PI) a += 2 * Math.PI; else if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export interface Arrival {
  pos: [number, number, number];
  yaw: number;
  /** the vehicle record Pepper sits in (its matrix gets Pepper's), -1 walking */
  vehicle: number;
  /** PEPPER_CONTROL the arrival sets (FUN_00417597(0x5e, ...)) */
  control: number;
}

/**
 * The arrival place. `pos(i)` = position of record i, `pathNode(n)` = FUN_00462be9(1, n), `vehicle` = the record FUN_0051e4b0 returned (the emulation's choice,
 * -1 = the default record of the case).
 */
export function arrival(prev: number, node: number, pos: (i: number) => readonly number[], pathNode: (n: number) => readonly number[] | null, vehicle = -1): Arrival | null {
  const rule = arrivalRule(prev, node);
  const b = pos(rule.base);
  let veh = -1, control = 1;
  if (rule.vehicle === 1) { veh = vehicle >= 0 ? vehicle : R(0x4238); control = 8; }
  if (rule.vehicle === 2) { veh = vehicle >= 0 ? vehicle : R(0x4308); control = veh === PTERA_RECORD ? 0x40 : 8; }
  if (rule.node < 0) {
    const t = pos(VEHICLE_DIR_RECORD);
    let dx = t[0] - b[0], dy = t[1] - b[1], dz = t[2] - b[2];
    const yaw = yawOf(dx, dz);
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 !== 0) { const k = 1 / Math.sqrt(l2); dx *= k; dy *= k; dz *= k; }   // FUN_0043cec0
    const p: [number, number, number] = [Math.fround(dx * VEHICLE_ARRIVAL_DIST + b[0]), Math.fround(dy * VEHICLE_ARRIVAL_DIST + b[1]), Math.fround(dz * VEHICLE_ARRIVAL_DIST + b[2])];
    return { pos: p, yaw, vehicle: veh, control };
  }
  const n = pathNode(rule.node);
  if (!n) return null;
  return { pos: [n[0], n[1], n[2]], yaw: yawOf(n[0] - b[0], n[2] - b[2]), vehicle: -1, control: 1 };
}

/** the vehicle record the emulated FUN_004c2d22 copied Pepper's matrix into (its translation equals Pepper's), -1 none */
export function emulatedVehicle(s: IslandSetup): number {
  const p = s.records[16]?.pos;
  if (!p) return -1;
  for (const c of s.changed) {
    if (c.record === 16 || c.field !== 'pos') continue;
    const q = c.to as number[];
    if (q[0] === p[0] && q[1] === p[1] && q[2] === p[2]) return c.record;
  }
  return -1;
}
