// The creatures' hurt zones: FUN_005ba570 registers a record with a category and a template of spheres, FUN_005ba5d7 moves the spheres to the record's place every frame
// (before the behaviours run) and FUN_005ba745 tests the diver's collision quad against them (its 4 edges against every sphere of every entry, in registration order).
import type { GameRecord } from '../../game/record.ts';
import { HURT_REGISTRATIONS, HURT_TEMPLATES } from './consts.ts';
import type { HurtTemplate } from './consts.ts';
import { segmentSphere } from './math.ts';
import { rotateVector } from './matrix.ts';
import { ad } from '../common/f32.ts';

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
    // the template immediates of FUN_005ba32c are float32 (0.2 = 0x3e4ccccd, 0.3, 2.7, 2.8 ...): the decimals of the table are rounded here
    const f3 = (v: readonly number[]) => [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])] as [number, number, number];
    const t: HurtTemplate = { anchor: f3(tpl.anchor), anchorRadius: Math.fround(tpl.anchorRadius), spheres: tpl.spheres.map((s) => ({ local: f3(s.local), radius: Math.fround(s.radius) })) };
    this.entries.push({ rec, category, tpl: t, anchorWorld: [0, 0, 0], spheres: t.spheres.map((s) => ({ local: s.local, radius: s.radius, world: [0, 0, 0] as [number, number, number] })) });
  }

  /** FUN_005b9430 registers pirates, shark, swordfish, mantas in this order */
  registerAll(records: readonly GameRecord[]) {
    for (const r of HURT_REGISTRATIONS) this.register(records[r.rec], r.category, HURT_TEMPLATES[r.template]);
  }

  /** FUN_005ba5d7: world places of the anchors and spheres (rotate by the record's matrix, add its position); every frame before the update pass */
  update() {
    for (const e of this.entries) {
      // FUN_005ba5d7: FUN_0043abe6 (rotate, float32 store), then the record's place added (a second float32 store)
      const place = (local: ArrayLike<number>, out: number[]) => { const r = rotateVector(e.rec.m, local); out[0] = ad(r[0], e.rec.m[12]); out[1] = ad(r[1], e.rec.m[13]); out[2] = ad(r[2], e.rec.m[14]); };
      place(e.tpl.anchor, e.anchorWorld);
      for (const s of e.spheres) place(s.local, s.world);
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
