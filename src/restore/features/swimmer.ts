// Restored feature 'swimmer' (docs/re/restore-plan.md item 12, docs/re/restore.md): the swimming Brikimal BML2 (record 367, kind 2).
//
// ORIGINAL: the record BML2 (367, never placed: it sits at (0, 0, 0) with flags 0x20, exactly what the Brikimal constructor writes to its own record), the Brikimal behaviour node
//   (`BrikimalNode`, src/island/ambient/brikimal.ts = FUN_004bd4a8 / FUN_004bcc1b, which has the kind-2 branch `animal !== 2` that skips the terrain snap = the animal swims), the kind-2 rows of the
//   movement table at 0x8d9f10, the morph files animal04 / 01 / 05 / 03, and the game variable SWITCH_GME_MOVE_BML2 (0x2e) that is the animal's shape counter like 0xc3 / 0xe0 for BML1 / BML3.
//   The world set-up attaches the node to BML1 and BML3 only; this feature attaches it to BML2 the same way (same ctor, gate mask 0).
// RECONSTRUCTION: WHERE it swims (the original has no position) and in which eras (all). The place is derived at run time from the island's own terrain data: the open sea (no ground within
//   `CLEAR` units, so the animal's wander radius of about 35 stays in water) that lies nearest to the pair BML3 / BML4, its kind-1 siblings on the north-east coast; the animal floats at the sea level.
import { Controller } from '../../game/controller.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { BrikimalNode } from '../../island/ambient/brikimal.ts';
import type { Feature } from '../feature.ts';

/** ORIGINAL: record 367 = BML2 (kind 2), its shape counter SWITCH_GME_MOVE_BML2, the records of the kind-1 pair BML3 / BML4 */
export const REC_BML2 = 367, VAR_BML2 = 0x2e, REC_BML3 = 368, REC_BML4 = 369;
/** RECONSTRUCTION: radius around the swimmer's home that must be free of ground (the wander radius is about speed / turn rate x 3 = 35: kind 2 shapes move at 0.1 .. 0.2 per tick, turn 0.0175) */
export const CLEAR = 60;
/** RECONSTRUCTION: the animal floats this far below the sea level (its model origin is at the feet) */
export const FLOAT = 0.3;

/** is there water at (x, z): no ground, or ground below the sea level (the terrain mesh has no sea floor: the sea is where the ground ray misses) */
export function isSea(w: World, x: number, z: number): boolean {
  const g = w.col.groundRay(x, 300, z);
  return g < -1e30 || g <= w.seaLevel;
}
/** is the disc of radius `r` around (x, z) all water (centre + 16 directions x 3 radii) */
export function openSea(w: World, x: number, z: number, r: number): boolean {
  if (!isSea(w, x, z)) return false;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8, cx = Math.sin(a), cz = Math.cos(a);
    for (const f of [1 / 3, 2 / 3, 1]) if (!isSea(w, x + cx * r * f, z + cz * r * f)) return false;
  }
  return true;
}
/** the open sea nearest to (x, z): rings of 10 units, 72 directions each, the first free spot wins (deterministic); null when there is none within `maxR` */
export function nearestOpenSea(w: World, x: number, z: number, r = CLEAR, maxR = 1500): [number, number] | null {
  for (let d = 0; d <= maxR; d += 10) {
    const n = d === 0 ? 1 : 72;
    for (let k = 0; k < n; k++) {
      const a = (k * 2 * Math.PI) / n, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (openSea(w, px, pz, r)) return [px, pz];
    }
  }
  return null;
}

/** the swimmer's home for this world (also used by the test) */
export function swimmerHome(w: World): [number, number] | null {
  const a = w.records[REC_BML3], b = w.records[REC_BML4];
  if (!a || !b) return null;
  return nearestOpenSea(w, (a.x + b.x) / 2, (a.z + b.z) / 2);
}

/**
 * The original's kind-2 branch never writes the height (FUN_004bcc1b: `local_20 = DAT_009da858` and nothing else), so the per-tick bob `y += sin(phase) * amplitude` would pile up: the animal would
 * drift away into the sky. RECONSTRUCTION: the height is put back to the floating level before every update, so the bob / jump of each shape stays a bob over the water.
 */
export class SwimmingBrikimal extends BrikimalNode {
  readonly baseY: number;
  constructor(baseY: number) { super(); this.baseY = baseY; }
  override update(w: World, rec: GameRecord, c: Controller): number { rec.y = this.baseY; return super.update(w, rec, c); }
}

/** put BML2 on the sea and attach the Brikimal node (like the set-up does for BML1 / BML3); returns the node, or null when the record is missing / already has a node / no sea was found */
export function placeSwimmer(w: World): SwimmingBrikimal | null {
  const rec: GameRecord | undefined = w.records[REC_BML2];
  if (!rec || rec.name !== 'BML2' || rec.ctrl?.nodes.some((n) => n.kind === 'Brikimal')) return null;
  const home = swimmerHome(w);
  if (!home) return null;
  rec.x = home[0]; rec.y = w.seaLevel - FLOAT; rec.z = home[1]; rec.ry = 0; rec.rebuildYaw();
  const node = new SwimmingBrikimal(rec.y);
  node.var = VAR_BML2; node.mask = 0; node.value = 0;
  if (!rec.ctrl) rec.ctrl = new Controller();
  rec.ctrl.attach(node, 0);
  return node;
}

export const feature: Feature = {
  id: 'swimmer',
  islandStart(g) { placeSwimmer((g as { ctx: { world: World } }).ctx.world); },
};
