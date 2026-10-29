// M4 WP15: saving / loading while Pepper sits in a vehicle (PEPPER_CONTROL & 8). The port's save (shell.ts saveSlot) used to write Pepper's entity only;
// the original's FUN_00419e82 restores every record's entity (position, angles, flags) and its node blobs, so the boat comes back with Pepper on it. The
// port does not save node blobs: on a load it puts the vehicle back under Pepper (its saved entity when the save has one, else at Pepper's saved place)
// and re-enters it the way the arrival code FUN_004c2d22 does (the vehicle's MOVE var cleared, DAT_009daa80 = the vehicle, PEPPER_CONTROL 8: the vehicle's
// node takes Pepper in on its next update). Without this a load from the front end left Pepper frozen at sea in mode 8 with no vehicle while the parked
// boat, its MOVE_BOAT var restored to 1, drove off by itself; an in-place load left Pepper on the boat where it was, not where the save was made.
// An approximation (no node state is restored); docs/re/m4/wp15-era1.md.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { EntityRecord, SaveGame } from '../../shell/save.ts';
import { V } from '../../game/vars.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { CAR_DRIVEN } from '../../island/vehicles/car.ts';

/** the vehicle nodes Pepper rides with PEPPER_CONTROL 8 (WP6): boats / helicopters (MOVE var 1 = ridden) and cars (bit 0x10000000 of a shared var) */
const KINDS = new Set(['SGBoat', 'SGHeli', 'SGCar']);

const tagOf = (n: string) => (n.charCodeAt(0) | (n.charCodeAt(1) << 8) | (n.charCodeAt(2) << 16) | (n.charCodeAt(3) << 24)) >>> 0;

interface VehicleRef { rec: GameRecord; kind: string; var: number }

function vehicleList(w: World): VehicleRef[] {
  const out: VehicleRef[] = [];
  for (const rec of w.records) {
    const n = rec.ctrl?.nodes.find((x) => KINDS.has((x as { kind?: string }).kind ?? ''));
    if (n) out.push({ rec, kind: (n as { kind: string }).kind, var: n.var });
  }
  return out;
}
const ridden = (w: World, v: VehicleRef) => (v.kind === 'SGCar' ? (w.vars.get(v.var) & CAR_DRIVEN) !== 0 : w.vars.get(v.var) !== 0);

/** the extra entities of a save: the vehicle Pepper sits in */
export function saveVehicleEntities(w: World): EntityRecord[] {
  const cur = vehicles(w).current;
  if (!cur || (w.vars.get(V.PEPPER_CONTROL) & 8) === 0) return [];
  return [{ tag: tagOf(cur.name), pos: new Float32Array([cur.x, cur.y, cur.z]), euler: new Float32Array([cur.rx, cur.ry, cur.rz]), flags: cur.flags, nodes: [] }];
}

/** after a load (in place or from another zone; the save's variables and Pepper's place are applied): put Pepper back into her vehicle */
export function restoreVehicle(w: World, pepper: GameRecord, save: SaveGame): void {
  const list = vehicleList(w);
  const G = vehicles(w);
  const inVehicle = (w.vars.get(V.PEPPER_CONTROL) & 8) !== 0;
  // which one: the saved entity, else the one whose variable says it is ridden
  let pick: VehicleRef | undefined, ent: EntityRecord | undefined;
  for (const v of list) {
    const e = save.entities.find((x) => x.tag === tagOf(v.rec.name));
    if (e) { pick = v; ent = e; break; }
  }
  if (!pick && inVehicle) pick = list.find((v) => ridden(w, v)) ?? (G.current ? list.find((v) => v.rec === G.current) : undefined);
  // nobody drives a vehicle Pepper is not in (FUN_004c2d22 clears the vehicles' MOVE vars on an arrival the same way)
  for (const v of list) {
    if (!ridden(w, v)) continue;
    if (v.kind === 'SGCar') w.vars.andNot(v.var, CAR_DRIVEN); else w.vars.set(v.var, 0);
  }
  G.current = null;
  if (!inVehicle) return;
  if (!pick) { w.vars.set(V.PEPPER_CONTROL, 1); return; }   // no vehicle to sit in: on foot rather than frozen in mode 8
  const r = pick.rec;
  if (ent) r.setEuler(ent.euler[0], ent.euler[1], ent.euler[2], ent.pos[0], ent.pos[1], ent.pos[2]);
  else r.setEuler(0, pepper.ry, 0, pepper.x, pick.kind === 'SGBoat' ? r.y : pepper.y, pepper.z);
  r.rx = ent ? ent.euler[0] : 0; r.ry = ent ? ent.euler[1] : pepper.ry; r.rz = ent ? ent.euler[2] : 0;
  r.savePrev();
  // the node's own state is not in the port's save: the vehicle starts from rest where it was saved
  const node = r.ctrl?.nodes.find((x) => (x as { kind?: string }).kind === pick.kind) as { speed?: number } | undefined;
  if (node && typeof node.speed === 'number') node.speed = 0;
  w.vars.set(V.PEPPER_CONTROL, 8);
  G.current = r;
}
