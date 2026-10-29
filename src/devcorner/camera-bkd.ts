// Section 4 "Camera en tekenen": the z08BKD debug visualisers of the original, FUN_005babc9 (LE2.c:119230, 0 callers), as a queue source. Loaded only in z08BKD (dynamic import).
//   FUN_005bab3b(n, points): the closed polygon through n points, white lines (point i -> point i + 1, the last back to the first).
//   FUN_005babc9: polygons of the body quads of the records at 0x208 (record 5, the diver: node +0x88 points, count +0x24: FUN_005c0830), 0x14b8 and 0x2428 .. 0x2560 (the five bricks) and
//     0x1b38, 0x16c0, 0x17f8 .. 0x1ad0 (the ten cannon balls): points at node +0x4c, count +0x18 (FUN_005bfb50 / FUN_005bc6d0); then for every hurt-zone entry (DAT_05d58c78, stride 0xb4, count
//     DAT_05d5ab00) a red X (type 0, size = the anchor radius at +0x1c) at the anchor and a blue X for each of its spheres (+0x2c, stride 0x1c, size at +0x38).
// Port: the diver's quad is `DiverNode.quad`; the quads of the bricks and balls are not stored by the port's nodes: they are recomputed from the record (BRICK_SHAPE / BALL_SHAPE rotated by
// rz + pi/2 and moved to (x, y), what the nodes' update does) and only drawn while the body is active (the original's memory holds stale points for the others): bij benadering.
// The hurt zones are a second `HurtZones` registered with the same records (same templates), updated to the records' current places.
import type { ZoneRun } from './types.ts';
import type { DebugQueue } from './camera-draw.ts';
import { HurtZones } from '../zones/z08bkd/hurt.ts';
import { REC, C } from '../zones/z08bkd/consts.ts';
import { rotateShape } from '../zones/z08bkd/math.ts';
import { BRICK_SHAPE, BALL_SHAPE, BrickNode, BallNode } from '../zones/z08bkd/bodies.ts';
import { DiverNode } from '../zones/z08bkd/diver.ts';

const WHITE = 0xffffffff;

export function bkdSource(run: ZoneRun) {
  const hurt = new HurtZones();
  const recs = run.world.records;
  hurt.registerAll(recs);
  const polygon = (q: DebugQueue, pts: readonly (readonly number[])[], tag: string) => {
    for (let i = 0; i < pts.length; i++) q.line(pts[i], pts[i === pts.length - 1 ? 0 : i + 1], WHITE, WHITE, tag);   // FUN_005bab3b
  };
  return {
    tick(q: DebugQueue, on: (t: string) => boolean) {
      if (!on('bkd')) return;
      const diver = recs[REC.PEPP]?.ctrl?.nodes.find((n) => n instanceof DiverNode) as DiverNode | undefined;
      if (diver && diver.quad.length) polygon(q, diver.quad, 'bkd');
      const body = (idx: number, shape: readonly (readonly number[])[], Cls: typeof BrickNode | typeof BallNode) => {
        const rec = recs[idx];
        const node = rec?.ctrl?.nodes.find((n) => n instanceof Cls) as BrickNode | BallNode | undefined;
        if (!rec || !node || !node.active) return;
        const pts = rotateShape(shape, 4, Math.fround(rec.rz + C.HALF_PI));
        for (const p of pts) { p[0] = Math.fround(p[0] + rec.x); p[1] = Math.fround(p[1] + rec.y); }
        polygon(q, pts, 'bkd');
      };
      for (const i of REC.BRICKS) body(i, BRICK_SHAPE, BrickNode);
      for (const i of REC.BALLS) body(i, BALL_SHAPE, BallNode);
      hurt.update();
      for (const e of hurt.entries) {
        q.shape(e.anchorWorld, 0, e.tpl.anchorRadius, 0xffff0000, 'bkd');
        for (const s of e.spheres) q.shape(s.world, 0, s.radius, 0xff0000ff, 'bkd');
      }
    },
  };
}
