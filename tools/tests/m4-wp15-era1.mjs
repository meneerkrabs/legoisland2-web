// M4 WP15: era 1 after Whack-A-Bot (story nodes 11..14) on the real island world, plus saving / loading in a vehicle (src/zones/z02LGI/savevehicle.ts).
//   node 11: the INFC StartCSM (gate node 0xb, no waypoint) fires at once: slot 5 (LGI06), then S277 = 0x100
//   node 12: the RESQ StartCSM (gate node 0xc, PATH waypoints 0xc9 ..) fires when Pepper walks in: slot 6 (LGI07), then S277 = 0x200
//   node 13: Ctrl at the Res-Q speedboat SPBT: PEPPER_CONTROL 8, MOVE_BOAT 1
//   node 14: the sea portal PORS (gate node 0xe): S302 |= 1, PORTAL_VEHICLE 0 (SPBT), var 5 = 6 (z07CSI)
//   restoreVehicle: a load in mode 8 puts Pepper back into the boat (the save's vehicle entity, else at Pepper's place), never frozen without one
// Run: node tools/test-formats.mjs --only m4-wp15-era1 -v
import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { saveVehicleEntities, restoreVehicle } from '../../src/zones/z02LGI/savevehicle.ts';

const S277 = 0x115, S302 = 0x12e, PC = 0x5e, MOVE_BOAT = 0x82, NEXT = 5, PORTAL_VEHICLE = 0xbb;
const hex = (v) => '0x' + (v >>> 0).toString(16);

function island(ctx, node) {
  const I = loadIsland(ctx, { node, npcFile: 'LI/Data/lifsm8.str' });
  loadIslandWalkMaps(I.archive, I.profile.island);
  startPizzaNodes(I.world);
  startIslandNpcs(I.world);
  return I;
}
function place(I, x, z, fx, fz) {
  const p = I.pepper, w = I.world;
  p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g;
  p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev();
}
/** put the boat at (x, z) facing (fx, fz) */
function placeBoat(b, x, z, fx, fz) { const yaw = Math.atan2(fx - x, fz - z); b.setEuler(0, yaw, 0, x, b.y, z); b.rx = 0; b.ry = yaw; b.rz = 0; b.savePrev(); }

export default {
  name: 'm4-wp15-era1',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));

    // ---- node 11: the mainframe cutscene starts at once and completes the node
    {
      const I = island(ctx, 11);
      I.ictx.cutsceneTicks = 20;
      tick(I, 3);
      ok(I.ictx.cutscenes.some((c) => c.slot === 5), `node 11: INFC's trigger starts slot 5 at once (${JSON.stringify(I.ictx.cutscenes)})`);
      tick(I, 30);
      ok(I.vars.get(S277) === 0x100, `node 11: S277 = 0x100 after the cutscene (${hex(I.vars.get(S277))})`);
      ok((I.vars.get(PC) & 0xfff) === 1, `node 11: Pepper walks afterwards (PEPPER_CONTROL ${hex(I.vars.get(PC))})`);
      ok(I.story.complete(), 'node 11 is complete');
    }
    // ---- node 12: walk into the Res-Q trigger
    {
      const I = island(ctx, 12);
      tick(I, 3);
      ok(!I.ictx.cutscenes.length, 'node 12: nothing fires while Pepper is far away');
      const n = waypoints.nodePos(1, 0xc9), r = I.rec('RESQ');
      const dx = n[0] - r.x, dz = n[2] - r.z, l = Math.hypot(dx, dz);
      place(I, n[0] + dx / l * 10, n[2] + dz / l * 10, n[0], n[2]);
      hold(I, ['ArrowUp'], 40);
      tick(I, 5);
      ok(I.ictx.cutscenes.some((c) => c.slot === 6), `node 12: the RESQ trigger starts slot 6 (${JSON.stringify(I.ictx.cutscenes)})`);
      ok(I.vars.get(S277) === 0x200 && I.story.complete(), `node 12: S277 = 0x200, node complete (${hex(I.vars.get(S277))})`);
    }
    // ---- nodes 13 / 14: the boat and the sea portal
    {
      const I = island(ctx, 13);
      const W = I.world, G = vehicles(W), B = I.rec('SPBT');
      tick(I, 3);
      const e = waypoints.nodePos(1, 0x18e);
      place(I, e[0], e[2], B.x, B.z); tick(I, 2); place(I, e[0], e[2], B.x, B.z);
      press(I, 'ControlLeft'); tick(I, 40);
      ok(G.current === B && I.vars.get(PC) === 8 && I.vars.get(MOVE_BOAT) === 1, `node 13: Ctrl at the jetty -> SPBT (PEPPER_CONTROL ${hex(I.vars.get(PC))}, MOVE_BOAT ${I.vars.get(MOVE_BOAT)})`);
      ok(I.story.complete(), 'node 13 is complete (PEPPER_CONTROL == 8)');
      // save in the boat
      const ents = saveVehicleEntities(W);
      ok(ents.length === 1 && ents[0].pos[0] === B.x, `the save gets the boat's entity (${ents.length})`);
      // node 14: the portal
      I.vars.set(0x58, 14);
      const P = I.rec('PORS');
      placeBoat(B, P.x + 70, P.z + 50, P.x, P.z);
      let left = false;
      hold(I, ['Space'], 200, () => { if (!left && I.vars.get(NEXT) === 6) left = true; });
      ok(left && (I.vars.get(S302) & 1) === 1 && I.vars.get(PORTAL_VEHICLE) === 0, `node 14: PORS -> var 5 = 6, S302 ${I.vars.get(S302)}, PORTAL_VEHICLE ${I.vars.get(PORTAL_VEHICLE)}`);
    }
    // ---- loading in mode 8 (savevehicle.ts)
    {
      // a load from another zone: PEPPER_CONTROL 8 and MOVE_BOAT 1 come from the save, the boat is parked at its dock, no current vehicle
      const I = island(ctx, 14);
      const W = I.world, G = vehicles(W), B = I.rec('SPBT'), p = I.pepper;
      tick(I, 3);
      const dock = [B.x, B.z];
      I.vars.set(PC, 8); I.vars.set(MOVE_BOAT, 1);
      place(I, B.x + 5, B.z + 150, B.x, B.z + 300); p.y = B.y + 0.5;
      restoreVehicle(W, p, { entities: [] });
      ok(G.current === B && I.vars.get(PC) === 8 && I.vars.get(MOVE_BOAT) === 0, `no vehicle entity: SPBT re-entered (current ${G.current?.name}, MOVE_BOAT ${I.vars.get(MOVE_BOAT)})`);
      ok(Math.hypot(B.x - p.x, B.z - p.z) < 0.01, 'the boat is put under Pepper');
      tick(I, 20);
      ok(I.vars.get(MOVE_BOAT) === 1 && Math.hypot(p.x - B.x, p.z - B.z) < 3, `Pepper sits in the boat again (MOVE_BOAT ${I.vars.get(MOVE_BOAT)}, d ${Math.hypot(p.x - B.x, p.z - B.z).toFixed(2)})`);
      const z0 = B.z; hold(I, ['Space'], 30);
      ok(B.z > z0 + 5 && Math.hypot(p.x - B.x, p.z - B.z) < 3, `and drives it (dz ${(B.z - z0).toFixed(1)})`);
      // with the boat's entity in the save
      const tag = [...'SPBT'].reduce((a, c, i) => a | (c.charCodeAt(0) << (8 * i)), 0) >>> 0;
      restoreVehicle(W, p, { entities: [{ tag, pos: new Float32Array([dock[0] + 1, B.y, dock[1] + 200]), euler: new Float32Array([0, 1, 0]), flags: B.flags, nodes: [] }] });
      ok(G.current === B && Math.abs(B.x - (dock[0] + 1)) < 0.01 && Math.abs(B.ry - 1) < 1e-6, `the saved entity puts the boat back (${B.x.toFixed(1)}, ${B.z.toFixed(1)}, ry ${B.ry})`);
      ok(B.ctrl.find('SGBoat').speed === 0, 'and from rest');
      // mode 8 with no vehicle at all: on foot
      I.vars.set(MOVE_BOAT, 0); G.current = null; I.vars.set(PC, 8);
      restoreVehicle(W, p, { entities: [] });
      ok(I.vars.get(PC) === 1 && G.current === null, `mode 8 without a vehicle -> walking (${hex(I.vars.get(PC))})`);
      // walking save: nothing to do
      ok(saveVehicleEntities(W).length === 0, 'a walking save has no vehicle entity');
      notes.push(`dock ${dock.map((x) => x.toFixed(1))}`);
    }
    return { checked, failures, notes };
  },
};
