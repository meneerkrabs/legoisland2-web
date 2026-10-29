// The island's "objective" (Common\...: FUN_004241df / FUN_00424270 / FUN_00424230 / FUN_0042419f / FUN_004242b9 set it, FUN_00424e37 resolves it).
// The story handler (FUN_004b7040, story.ts) points it at the next goal of the story node; the original has NO arrow on the HUD for it (the HUD draw
// FUN_0046055f draws two corner icons, three texts, the icon column and the gauge only): the target is what the talking NPCs turn to and point at after
// their line (FUN_004254a5 -> FUN_004627e2(walker, target + 0x30)) and what the hologram (hOLO, FUN_0088d4xx) faces. docs/re/m4/wp8-island.md 3.
//
// Globals: DAT_009da82c = mode, DAT_009da830..83c = up to four record pointers, DAT_008add70 = waypoint node (map 1, PATH) of mode 3,
// DAT_009da840 = radius^2 in units^2 (radius * 8, squared; written only: no reader in the executable).
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';

/** DAT_00892090 = 8.0: world units per "metre" of the radius arguments */
const UNIT = 8;
/** FUN_0042419f: DAT_009da840 = 0x43800000 (256.0) */
const BOX_RADIUS_SQ = 256;
/** constructor of the generic talk NPC whose handler table is PTR_FUN_008adce0 (SGMFIG, FUN_00426151) */
export const TALK_NPC_CTOR = 0x426151;

export const OBJ = { NONE: 0, RECORD: 1, PAIR: 2, NODE: 3, NEAREST4: 4 } as const;

/** a dock / helipad of the vehicle tables (DAT_009da9d4 / 9da9e4 / 9da9fc and DAT_009daa18 / 9daa2c / 9daa50: node, map, taken) */
export interface BerthView { map: number; node: number; taken: boolean }
/** what the vehicle branch of FUN_00424e37 reads: the high word of DAT_009da9f8 (-1 car, -2 boat, -3 helicopter), the free docks / helipads, FUN_00462be9(map, node) */
export interface VehicleObjective { kind: number; docks: readonly BerthView[]; pads: readonly BerthView[]; nodePos(map: number, node: number): readonly number[] | null }

/** a target: the position the NPC / hologram turns to (the translation of the matrix FUN_00424e37 returns) */
export interface ObjectiveTarget { pos: [number, number, number]; record: number }

export class Objective {
  /** DAT_009da82c */
  mode = 0;
  /** DAT_009da830 .. DAT_009da83c: record indices, -1 = null pointer */
  recs = [-1, -1, -1, -1];
  /** DAT_008add70: PATH node of mode 3 (-1 = none) */
  node = -1;
  /** DAT_009da840 (radius * 8)^2: written, never read by the original */
  radiusSq = 0;
  /**
   * DAT_05defbcc: the hologram's alert timer, FUN_0088d2bc sets 90.0 when the story just advanced; the hologram node (hOLO, FUN_0088d41f) counts it down by dt
   * and calls Pepper over when it reaches 0 (DAT_05defbc8 = 1). The hOLO port reads and decrements it.
   */
  holoTimer = 0;

  /** FUN_004241df: clear */
  clear() { this.recs = [-1, -1, -1, -1]; this.node = -1; this.mode = 0; }
  /** FUN_00424270(rec, r): mode 1 when rec != null (else 0) */
  record(rec: number, r: number) { this.clear(); this.mode = rec >= 0 ? OBJ.RECORD : OBJ.NONE; this.recs[0] = rec; this.radiusSq = (r * UNIT) ** 2; }
  /** FUN_00424230(a, b, r): mode 2 (the target is b; a when Pepper rides a vehicle) */
  pair(a: number, b: number, r: number) { this.clear(); this.mode = OBJ.PAIR; this.recs[0] = a; this.recs[1] = b; this.radiusSq = (r * UNIT) ** 2; }
  /** FUN_0042419f(a, b, c, d): mode 4, the nearest visible of the four */
  four(a: number, b: number, c: number, d: number) { this.clear(); this.radiusSq = BOX_RADIUS_SQ; this.mode = OBJ.NEAREST4; this.recs = [a, b, c, d]; }
  /** FUN_004242b9(node, r): mode 3, a node of the PATH waypoint map */
  pathNode(node: number, r: number) { this.clear(); this.mode = OBJ.NODE; this.node = node; this.radiusSq = (r * UNIT) ** 2; }
  /** FUN_0088d2bc */
  alertHolo() { this.holoTimer = 90; }

  /**
   * FUN_00424e37(&out, from): the target. `pepperControl` = var 0x5e; `pathPos(n)` = FUN_00462be9(1, n) (null when the map is not loaded).
   * Vehicle branch (`veh`, taken when var 0x5e & 8 and the high word of DAT_009da9f8 is not -1: Pepper is in a boat / helicopter): mode 2 targets the first record (DAT_009da830);
   * any other mode looks for the nearest free helipad (kind -3) / dock (kind -2) by the squared XZ distance to `from` and then reads FUN_00462be9(1, INDEX), the PATH
   * node whose number is the berth's index in the table (an original slip: the berth's own node is `Berth.node` of map `Berth.map`, which only the distance loop uses);
   * with no free berth the index stays -1 and FUN_00462be9 reads the 0x20 bytes before the node array (the debug heap header: three pointers read as floats, about 1e-38,
   * i.e. the origin; `[0, 0, 0]` here). The branch always yields a target.
   */
  target(records: readonly GameRecord[], from: GameRecord | null, pepperControl: number, pathPos: (n: number) => readonly number[] | null, veh?: VehicleObjective | null): ObjectiveTarget | null {
    const at = (i: number): ObjectiveTarget | null => { const r = records[i]; return r ? { pos: [r.x, r.y, r.z], record: i } : null; };
    if ((pepperControl & 8) !== 0 && veh && veh.kind !== -1) {
      if (this.mode === OBJ.PAIR) return at(this.recs[0]);
      let idx = -1, best = 1e38;
      const scan = (list: readonly BerthView[]) => {
        for (let k = 0; k < list.length; k++) {
          if (list[k].taken) continue;
          const p = veh.nodePos(list[k].map, list[k].node);
          if (!p) continue;
          const dx = p[0] - (from?.x ?? 0), dz = p[2] - (from?.z ?? 0);
          const d2 = dz * dz + dx * dx;
          if (d2 < best) { idx = k; best = d2; }
        }
      };
      if (veh.kind === -3) scan(veh.pads);
      if (veh.kind === -2) scan(veh.docks);
      const p = idx >= 0 ? pathPos(idx) : null;
      return { pos: p ? [p[0], p[1], p[2]] : [0, 0, 0], record: -1 };
    }
    switch (this.mode) {
      case OBJ.PAIR: return at(this.recs[1]);
      case OBJ.RECORD: return at(this.recs[0]);
      case OBJ.NODE: { const p = pathPos(this.node); return p ? { pos: [p[0], p[1], p[2]], record: -1 } : null; }
      case OBJ.NEAREST4: {
        let best = 1e38, bi = -1;
        for (let k = 0; k < 4; k++) {
          const r = records[this.recs[k]];
          if (!r || !(r.flags & RF_ENABLED) || !r.ctrl) continue;
          if (r.ctrl.distSq < best) { best = r.ctrl.distSq; bi = this.recs[k]; }
        }
        return bi >= 0 ? at(bi) : null;
      }
      default: {
        // the nearest talk NPC that wants to be talked to (controller flags & 0x50, distance^2 > 8: DAT_00892090 compared with +0x18 as is), not `from`
        let best = 1e38, bi = -1;
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (!(r.flags & RF_ENABLED) || !r.ctrl || r === from) continue;
          const c = r.ctrl;
          if ((c.flags & 0x50) === 0 || !(c.distSq < best) || !(UNIT < c.distSq)) continue;
          const head = c.nodes[0] as unknown as { ctor?: number; talk50?: number } | undefined;
          if (!head || head.ctor !== TALK_NPC_CTOR || !head.talk50) continue;
          best = c.distSq; bi = i;
        }
        return bi >= 0 ? at(bi) : null;
      }
    }
  }
}
