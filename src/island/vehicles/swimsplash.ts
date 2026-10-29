// The swim splash ring of the island (gaps S3, docs/re/m4/wp13-ptera.md): the node `sgswim` of SPLH, constructor FUN_0088d1f6 (Common\S...c, attached to SPLH with the gate
// PEPPER_CONTROL (0x5e), mask 0), handler table 0x982b68 = { update FUN_0088cfa5 (returns 1), pre-render FUN_0088cfb8 (returns 1), destroy FUN_0088d258, draw FUN_0088cfcb }.
// The behaviour is all in the DRAW hook (FUN_0088cfcb(rec, node, ...), which returns 1 = handled, i.e. the record is drawn only when the hook draws it itself):
//   var 0x5e & 2 == 0 (not swimming): nothing is drawn; when PEPPERSSHADOW (0xc5) is -1 it is set to 4 (the blob shadow comes back after the swim)
//   swimming: var 0xc5 := -1 (no blob shadow in the water), the record's yaw := Pepper's yaw, its matrix := rotation y at (Pepper x, sea level DAT_009da858, Pepper z)
//             scaled by DAT_00982b80 (1.0), then moved by (DAT_05defbb4 - d2 * DAT_00982b84) times Pepper's forward row (+0x2c..0x34) with d2 = the squared XZ distance
//             Pepper moved since the previous draw (the globals DAT_05defbb8 / bc / c0 hold his position at the previous call; DAT_05defbb4 is never written: 0, DAT_00982b84 = 1.0),
//             i.e. the ring trails the swimmer by his squared speed; then FUN_00444480 draws the record.
//   every call (swimming or not) stores Pepper's position into the globals.
// The port has no node draw API in its renderer: the node does the same work in its pre-render (once per tick, which is once per drawn frame of the original's loop,
// FUN_004afaf7: update, pre-render, draw) and shows "not drawn" with the record flag 0x8000 (RF_NO_DRAW, the same bit the original's hooks use to suppress a draw).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_DRAW } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { V } from '../../game/vars.ts';

export const CTOR_SWIMSPLASH = 0x88d1f6;
/** DAT_00982b80 / DAT_00982b84 (both 1.0), DAT_05defbb4 (a global nothing writes: 0.0) */
const SCALE = 1.0, K = 1.0, BASE = 0.0;

export class SwimSplashNode implements BehaviourNode {
  readonly kind = 'swimSplash';
  var = 0x5e; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** DAT_05defbb8 / DAT_05defbbc / DAT_05defbc0: Pepper's position at the previous draw (BSS, 0) */
  prev: [number, number, number] = [0, 0, 0];

  /** FUN_0088cfa5 */
  update(): number { return NODE_STOP; }

  /** FUN_0088cfcb, the draw hook */
  prerender(w: World, rec: GameRecord, _ctrl?: Controller): void {
    void _ctrl;
    const pep = w.focus;
    if (!pep) return;
    if ((w.vars.get(this.var) & 2) === 0) {
      if (w.vars.get(V.PEPPERSSHADOW) === -1) w.vars.set(V.PEPPERSSHADOW, 4);
      rec.flags |= RF_NO_DRAW;
    } else {
      w.vars.set(V.PEPPERSSHADOW, -1);
      rec.ry = pep.ry;
      // FUN_0043a742(rec + 0xc, 0, ry, 0, x, sea, z, s, s, s)
      rec.setEuler(0, rec.ry, 0, pep.x, w.seaLevel, pep.z);
      if (SCALE !== 1) for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) rec.m[i] *= SCALE;
      const dx = this.prev[0] - pep.x, dz = this.prev[2] - pep.z;
      const d2 = dz * dz + dx * dx + 0.0;
      const k = BASE - d2 * K;
      rec.m[12] += k * pep.m[8]; rec.m[13] += k * pep.m[9]; rec.m[14] += k * pep.m[10];
      rec.flags &= ~RF_NO_DRAW;
    }
    this.prev = [pep.x, pep.y, pep.z];
  }
}
