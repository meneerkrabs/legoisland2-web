// M4 WP15: era 1 after Whack-A-Bot (story nodes 11..14) on the real island world, plus saving / loading in a vehicle (WP-SAVE: the exact node blocks of src/shell/saveworld.ts; the WP15 approximation savevehicle.ts is gone).
//   node 11: the INFC StartCSM (gate node 0xb, no waypoint) fires at once: slot 5 (LGI06), then S277 = 0x100
//   node 12: the RESQ StartCSM (gate node 0xc, PATH waypoints 0xc9 ..) fires when Pepper walks in: slot 6 (LGI07), then S277 = 0x200
//   node 13: Ctrl at the Res-Q speedboat SPBT: PEPPER_CONTROL 8, MOVE_BOAT 1
//   node 14: the sea portal PORS (gate node 0xe): S302 |= 1, PORTAL_VEHICLE 0 (SPBT), var 5 = 6 (z07CSI)
//   a save made in the boat loaded into a fresh island world: Pepper sits in the boat again, drives it (SGwalk's block names the vehicle record, SGBoat's block its state)
// Run: node tools/test-formats.mjs --only m4-wp15-era1 -v
import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { captureWorld, restoreWorld, captureEntities } from '../../src/shell/saveworld.ts';
import { newSaveFromGame, encodeSave, decodeSave, applySaveVars } from '../../src/shell/save.ts';

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
  p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw();
}
/** put the boat at (x, z) facing (fx, fz) */
function placeBoat(b, x, z, fx, fz) { const yaw = Math.atan2(fx - x, fz - z); b.setEuler(0, yaw, 0, x, b.y, z); b.rx = 0; b.ry = yaw; b.rz = 0; }

export default {
  name: 'm4-wp15-era1',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));
    let savedInBoat = null;

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
      // save in the boat: the boat's entity record is in the file (position, angles, flags, its SGBoat block), the same bytes as a save made anywhere
      const ents = captureEntities(W), be = ents.find((e) => e.nodes.length && e.pos[0] === B.x && e.pos[2] === B.z && e.tag === [...'SPBT'].reduce((a, c, i) => a | (c.charCodeAt(0) << (8 * i)), 0) >>> 0);
      ok(!!be && be.nodes.some((n) => n.data?.length === 0x38), `the save has the boat's entity with its SGBoat block`);
      savedInBoat = encodeSave(newSaveFromGame({ vars: W.vars.a, subgame: W.vars.get(0x59), fsmState: W.vars.get(0x58), ...captureWorld(W) }));
      // node 14: the portal
      I.vars.set(0x58, 14);
      const P = I.rec('PORS');
      placeBoat(B, P.x + 70, P.z + 50, P.x, P.z);
      let left = false;
      hold(I, ['Space'], 200, () => { if (!left && I.vars.get(NEXT) === 6) left = true; });
      ok(left && (I.vars.get(S302) & 1) === 1 && I.vars.get(PORTAL_VEHICLE) === 0, `node 14: PORS -> var 5 = 6, S302 ${I.vars.get(S302)}, PORTAL_VEHICLE ${I.vars.get(PORTAL_VEHICLE)}`);
    }
    // ---- the save made in the boat, loaded into a fresh island world (the load from another zone: variables first, then the world sections)
    {
      const S = decodeSave(savedInBoat);
      const I = island(ctx, 13);
      const W = I.world, G = vehicles(W), B = I.rec('SPBT'), p = I.pepper;
      tick(I, 3);
      applySaveVars(S, W.vars);
      ok(restoreWorld(W, S), 'the whole file was applied');
      ok(G.current === B && I.vars.get(PC) === 8, `the load puts Pepper back into SPBT (current ${G.current?.name}, PEPPER_CONTROL ${hex(I.vars.get(PC))})`);
      tick(I, 20);
      ok(Math.hypot(p.x - B.x, p.z - B.z) < 3, `Pepper sits in the boat again (d ${Math.hypot(p.x - B.x, p.z - B.z).toFixed(2)})`);
      const z0 = B.z; hold(I, ['Space'], 30);
      ok(Math.abs(B.z - z0) + Math.abs(B.x - S.entities.find((e) => e.nodes.length && e.pos[2] === z0)?.pos[0]) > 1 || B.z !== z0, `and drives it (dz ${(B.z - z0).toFixed(1)})`);
    }
    return { checked, failures, notes };
  },
};
