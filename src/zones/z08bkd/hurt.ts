// The creatures' hurt zones: FUN_005ba570 registers a record with a category and a template of spheres, FUN_005ba5d7 moves the spheres to the record's place every frame
// (before the behaviours run) and FUN_005ba745 tests the diver's collision quad against them (its 4 edges against every sphere of every entry, in registration order).
import type { GameRecord } from '../../game/record.ts';
import { HURT_REGISTRATIONS, HURT_TEMPLATES } from './consts.ts';
import type { HurtTemplate } from './consts.ts';
import { segmentSphere } from './math.ts';

export interface HurtEntry {
  rec: GameRecord;
  /** DAT_05d58d28 + n * 0xb4: 1 shark, 2 manta, 3 swordfish, 4 pirate */
  category: number;
  tpl: HurtTemplate;
  anchorWorld: [number, number, number];
  spheres: { local: [number, number, number]; radius: number; world: [number, number, number] }[];
}

export class HurtZones {
  entries: HurtEntry[] = [];

  /** FUN_005ba570(record, category, template) */
  register(rec: GameRecord, category: number, tpl: HurtTemplate) {
    this.entries.push({ rec, category, tpl, anchorWorld: [0, 0, 0], spheres: tpl.spheres.map((s) => ({ local: s.local, radius: s.radius, world: [0, 0, 0] as [number, number, number] })) });
  }

  /** FUN_005b9430 registers pirates, shark, swordfish, mantas in this order */
  registerAll(records: readonly GameRecord[]) {
    for (const r of HURT_REGISTRATIONS) this.register(records[r.rec], r.category, HURT_TEMPLATES[r.template]);
  }

  /** FUN_005ba5d7: world places of the anchors and spheres (rotate by the record's matrix, add its position); every frame before the update pass */
  update() {
    for (const e of this.entries) {
      e.rec.toWorld(e.tpl.anchor, e.anchorWorld);
      for (const s of e.spheres) e.rec.toWorld(s.local, s.world);
    }
  }

  /**
   * FUN_005ba745(points, n, &record): the category (and the record) of the first entry with a sphere that an edge of the closed polygon crosses (0 < t <= 1); 0 when none.
   * The edges run point i -> point i + 1 (the last back to the first).
   */
  test(poly: readonly (readonly number[])[], n = poly.length): { category: number; rec: GameRecord } | null {
    for (const e of this.entries) {
      for (const s of e.spheres) {
        for (let k = 0; k < n; k++) {
          const t = segmentSphere(poly[k], poly[k === n - 1 ? 0 : k + 1], s.world, s.radius);
          if (t > 0 && t <= 1) return { category: e.category, rec: e.rec };
        }
      }
    }
    return null;
  }
}
