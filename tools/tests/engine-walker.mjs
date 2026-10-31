import {
  WaypointSystem, WalkerNode, MAP_ROAD, MAP_PATH, MAP_CSM, MAP_OTH, MAP_NAMES, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT,
  STEP_ARRIVED, STEP_TURNING, STEP_FACING, STEP_MOVING_TO_POINT, MODE_ROUTE, WF_STOPPED, STATUS_IDLE, STATUS_ROUTE, TO_WALK,
} from '../../src/game/walker.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord } from '../../src/game/record.ts';
import { Controller, createNode, registeredNodes } from '../../src/game/controller.ts';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';

// The waypoint walker (Common\WayPt, src/game/walker.ts) on the real island maps: loading, name lookup, routes, a simulated NPC walking a route
// (speed, turn rate, path shape), the follow / point / heading orders, traffic rules, and the behaviour node inside a World.
const PI = Math.PI;
const angDiff = (a, b) => { let d = a - b; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; };
/** a minimal record: x/y/z/ry/m (+ flags: enabled) */
function fakeRec(name = 'FAKE') {
  const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1;
  return { name, x: 0, y: 0, z: 0, ry: 0, m, flags: 2 };
}
/** distance from (x, z) to the polyline through the points (XZ plane) */
function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][2], bx = pts[i + 1][0], bz = pts[i + 1][2];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}
/** deterministic PRNG */
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

export default {
  name: 'engine-walker',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, tol) => Math.abs(a - b) <= tol;

    const archive = ctx.archives.find((a) => a.name === 'z02LGI');
    if (!archive) return { checked: 0, failures: ['archive z02LGI not found'], notes };

    // ============================================================ the four maps
    const sys = new WaypointSystem();
    const counts = sys.load(archive);
    notes.push(`island maps (ROAD / PATH / CSM / OTH nodes): ${counts.join(' / ')}`);
    for (let slot = 0; slot < 4; slot++) {
      const e = archive.find(`Waypoints/W_${MAP_NAMES[slot]}_C.wpt`);
      ok(!!e, `W_${MAP_NAMES[slot]}_C.wpt present`);
      const wp = parseCompiledWaypoints(archive.read(e));
      ok(counts[slot] > 0 && counts[slot] === wp.nodes.length, `map ${MAP_NAMES[slot]} loaded: ${counts[slot]} nodes, file ${wp.nodes.length}`);
      ok(sys.mapCount(slot) === wp.nodes.length, `mapCount(${slot})`);
    }
    ok(MAP_ROAD === 0 && MAP_PATH === 1 && MAP_CSM === 2 && MAP_OTH === 3, 'map slots');

    // ============================================================ name lookup / node positions
    const door = sys.findNode(MAP_PATH, 'PHSE_DOOR'), pepp = sys.findNode(MAP_PATH, 'SKPK_PEPP01');
    ok(door === 239, `PHSE_DOOR is PATH node ${door} (expected 239)`);
    ok(pepp === 246, `SKPK_PEPP01 is PATH node ${pepp} (expected 246)`);
    const pd = sys.nodePos(MAP_PATH, door), pp = sys.nodePos(MAP_PATH, pepp);
    ok(near(pd[0], -1.2, 0.1) && near(pd[1], 24.4, 0.1) && near(pd[2], -161.5, 0.1), `PHSE_DOOR at ${pd.map((v) => v.toFixed(2))}`);
    ok(near(pp[0], 153.8, 0.1) && near(pp[1], 13.0, 0.1) && near(pp[2], -62.5, 0.1), `SKPK_PEPP01 at ${pp.map((v) => v.toFixed(2))}`);
    ok(sys.findNode(MAP_PATH, 'PHSE_DO') >= 0 && sys.findNode(MAP_PATH, 'PHSE_DO') <= door, 'prefix match: PHSE_DO finds the first PHSE_DO* node');
    ok(sys.findNode(MAP_PATH, 'NO_SUCH_NODE') === -1, 'unknown name -> -1');
    ok(sys.nearestNode(MAP_PATH, pd[0] + 0.3, pd[1], pd[2] - 0.2) === door, 'nearest node of a point next to PHSE_DOOR');

    // ============================================================ routes (FUN_00463b49) between random node pairs
    {
      const rnd = rng(12345);
      let pairs = 0, reached = 0, unreachable = 0, longest = 0, notAdjacent = 0, chained = 0;
      for (let slot = 0; slot < 4; slot++) {
        const n = sys.mapCount(slot);
        if (sys.maps[slot].wp.matrices.length === 0) {
          // CSM: named points only, no route matrices (route(a, b) = a)
          ok(sys.route(slot, 0, n - 1) === 0, `${MAP_NAMES[slot]}: no route matrices, route stays at the start node`);
          notes.push(`map ${MAP_NAMES[slot]} has no route matrices (${n} stand-alone points)`);
          continue;
        }
        for (let k = 0; k < 400; k++) {
          const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
          if (a === b) continue;
          const nbn = sys.maps[slot].nodes[b];
          if (nbn.group < 0 && sys.maps[slot].nodes[nbn.index]?.group < 0) { chained++; continue; }   // ORBIT1 <-> ORBIT2: linked to each other, no route into them
          pairs++;
          let cur = a, steps = 0, broken = false;
          while (cur !== b && steps <= n) {
            const nx = sys.route(slot, cur, b);
            if (nx < 0 || nx >= n || nx === cur) { broken = true; break; }
            if (!sys.isAdjacent(slot, cur, nx)) notAdjacent++;
            cur = nx; steps++;
          }
          if (cur === b) { reached++; longest = Math.max(longest, steps); }
          else if (broken && sys.route(slot, a, b) < 0) unreachable++;
          else failures.push(`${MAP_NAMES[slot]}: route ${a} -> ${b} stuck at ${cur} after ${steps} hops`);
        }
      }
      checked += pairs;
      ok(reached > pairs * 0.5, `only ${reached} of ${pairs} random routes reach their target`);
      ok(notAdjacent === 0, `${notAdjacent} hops are not between neighbouring nodes`);
      notes.push(`routes: ${pairs} random pairs, ${reached} reached (longest ${longest} hops), ${unreachable} in disconnected parts, ${chained} skipped (targets that only link to another virtual node)`);
      ok(sys.route(MAP_PATH, door, door) === door, 'route(a, a) = a');
      // the doc's route
      let cur = door, hops = 0;
      while (cur !== pepp && hops < 1000) { cur = sys.route(MAP_PATH, cur, pepp); hops++; }
      ok(cur === pepp, `PHSE_DOOR -> SKPK_PEPP01 by hops (${hops})`);
      const nb = sys.neighbors(MAP_PATH, door);
      ok(nb.nodes.length >= 1 && nb.nodes.every((x) => sys.isAdjacent(MAP_PATH, door, x)), `neighbours of PHSE_DOOR: ${nb.nodes.join(',')}`);
    }

    // ============================================================ a walker walking PHSE_DOOR -> SKPK_PEPP01
    const SPEED = NPC_SPEED, TURN = NPC_TURN_RATE;
    const configure = (s, h, extra = {}) => {
      s.setSpeed(h, extra.speed ?? SPEED); s.setTurnRate(h, extra.turn ?? TURN);
      s.setRadiusMin(h, NPC_RADIUS_MIN); s.setRadiusMax(h, NPC_RADIUS_MAX); s.setRadiusLimit(h, NPC_RADIUS_LIMIT);
      if (extra.lane) s.setLane(h, extra.lane);
    };
    // the polyline of the route (node positions)
    const poly = [sys.nodePos(MAP_PATH, door)], ids = [door];
    let polyLen = 0;
    for (let cur = door; cur !== pepp;) {
      const nx = sys.route(MAP_PATH, cur, pepp);
      const p = sys.nodePos(MAP_PATH, nx);
      polyLen += Math.hypot(p[0] - poly.at(-1)[0], p[2] - poly.at(-1)[2]);
      poly.push(p); ids.push(nx); cur = nx;
    }
    {
      const rec = fakeRec('NPC1');
      const h = sys.create(MAP_PATH, rec, door);
      ok(h === 1, `first handle is 1 (${h})`);
      ok(near(rec.x, pd[0], 1e-3) && near(rec.z, pd[2], 1e-3), 'create puts the record on the start node');
      ok(sys.fromOf(h) === door, 'from = start node');
      ok(sys.toOf(h) >= 0 && sys.isAdjacent(MAP_PATH, door, sys.toOf(h)), `to = first neighbour (${sys.toOf(h)})`);
      configure(sys, h);
      ok(sys.status(h) === STATUS_IDLE, 'status idle before an order');
      sys.apply(h, rec);
      const first = sys.nodePos(MAP_PATH, sys.route(MAP_PATH, door, pepp));
      ok(near(rec.m[8], Math.sin(rec.ry), 1e-5), 'apply rebuilt the matrix from the yaw');
      ok(sys.step(h, [rec.x, rec.y, rec.z], rec.ry, { yaw: 0, dist: 0 }) === STEP_ARRIVED, 'a walker without an order reports "arrived" (stopped)');
      sys.goTo(h, pepp, 0);
      ok(sys.goalOf(h) === pepp, 'goal set');
      const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
      let yaw = rec.ry, lastX = pos[0], lastZ = pos[2], lastYaw = yaw;
      let maxStep = 0, maxTurn = 0, maxDev = 0, ticks = 0, code = 0, minStep = Infinity, sumDist = 0, statusOk = true;
      const limit = Math.ceil(polyLen / (SPEED * 8) * 2) + 500;
      for (; ticks < limit; ticks++) {
        code = sys.step(h, pos, yaw, out);
        yaw = out.yaw;
        if (ticks === 3 && sys.status(h) !== STATUS_ROUTE) statusOk = false;
        if (code === STEP_ARRIVED) break;
        const st = Math.hypot(pos[0] - lastX, pos[2] - lastZ);
        maxStep = Math.max(maxStep, st); sumDist += st;
        maxTurn = Math.max(maxTurn, Math.abs(angDiff(yaw, lastYaw)));
        maxDev = Math.max(maxDev, distToPolyline(pos[0], pos[2], poly));
        ok(Math.abs(out.dist * 8 - st) < 1e-3, `out.dist (${out.dist * 8}) equals the distance moved (${st}) at tick ${ticks}`);
        lastX = pos[0]; lastZ = pos[2]; lastYaw = yaw;
        if (!(code >= 0)) { failures.push(`unexpected step code ${code} at tick ${ticks}`); break; }
      }
      checked += 4;
      ok(statusOk, 'status is "route" while walking');
      ok(code === STEP_ARRIVED, `the walker arrived within ${limit} ticks (code ${code}, ${ticks} ticks)`);
      ok(maxStep <= SPEED * 8 + 1e-4, `max step ${maxStep.toFixed(4)} exceeds speed ${(SPEED * 8).toFixed(4)} per tick`);
      ok(maxTurn <= TURN + 1e-5, `max turn ${maxTurn.toFixed(4)} rad per tick exceeds the turn rate ${TURN.toFixed(4)}`);
      ok(maxDev < 12, `path deviates ${maxDev.toFixed(2)} from the route polyline`);
      ok(Math.hypot(pos[0] - pp[0], pos[2] - pp[2]) < 8 * 1.0 + 1, `final position ${pos[0].toFixed(1)},${pos[2].toFixed(1)} is ${Math.hypot(pos[0] - pp[0], pos[2] - pp[2]).toFixed(2)} from the goal node`);
      ok(ticks > polyLen / (SPEED * 8) * 0.9, `arrived implausibly early: ${ticks} ticks for ${polyLen.toFixed(0)} units`);
      ok(sys.status(h) === STATUS_IDLE && (sys.get(h).flags & WF_STOPPED) !== 0, 'stopped after arrival');
      ok(sys.fromOf(h) === pepp, 'from = goal after arrival');
      notes.push(`PHSE_DOOR -> SKPK_PEPP01: ${poly.length} nodes, polyline ${polyLen.toFixed(0)} units, ${ticks} steps at dt 1 (${(ticks / 30).toFixed(0)} game seconds of 30 units), travelled ${sumDist.toFixed(0)}; max step ${maxStep.toFixed(4)} (speed ${(SPEED * 8).toFixed(4)}), max turn ${maxTurn.toFixed(3)} rad (rate ${TURN.toFixed(3)}), max deviation from the polyline ${maxDev.toFixed(2)}, ended ${Math.hypot(pos[0] - pp[0], pos[2] - pp[2]).toFixed(2)} from the node`);

      // --- a new order on the same walker: back to the door, turning around is allowed (continue flag 0)
      sys.goTo(h, door, 0);
      let back = 0;
      for (; back < limit; back++) { code = sys.step(h, pos, yaw, out); yaw = out.yaw; if (code === STEP_ARRIVED) break; }
      ok(code === STEP_ARRIVED && Math.hypot(pos[0] - pd[0], pos[2] - pd[2]) < 9, `walked back to the door in ${back} ticks (ended ${Math.hypot(pos[0] - pd[0], pos[2] - pd[2]).toFixed(1)} away)`);
      // --- unit conversions
      ok(near(TO_WALK, 0.125, 0), 'walker unit scale');
      sys.free(h);
      ok(sys.get(h) === null, 'free');
    }

    // ============================================================ changing the goal on the way (turn around / continue)
    {
      for (const cont of [0, 1]) {
        const s2 = new WaypointSystem(); s2.load(archive);
        const rec = fakeRec('REV'), h = s2.create(MAP_PATH, rec, door);
        configure(s2, h); s2.apply(h, rec); s2.goTo(h, pepp, 0);
        const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
        let yaw = rec.ry, lx = pos[0], lz = pos[2], maxStep = 0, code = 0, t = 0;
        for (; t < 300; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; maxStep = Math.max(maxStep, Math.hypot(pos[0] - lx, pos[2] - lz)); lx = pos[0]; lz = pos[2]; }
        const mid = s2.toOf(h);
        // new goal: back to the door (reverses) or a node further along the route (the second to last)
        const target = cont ? ids.at(-2) : door;
        s2.goTo(h, target, cont);
        const tp = sys.nodePos(MAP_PATH, target);
        for (t = 0; t < 8000; t++) {
          code = s2.step(h, pos, yaw, out); yaw = out.yaw;
          if (code === STEP_ARRIVED) break;
          maxStep = Math.max(maxStep, Math.hypot(pos[0] - lx, pos[2] - lz)); lx = pos[0]; lz = pos[2];
        }
        ok(code === STEP_ARRIVED && Math.hypot(pos[0] - tp[0], pos[2] - tp[2]) < 9, `goal change (continue ${cont}) on the way (to ${mid}): arrived ${Math.hypot(pos[0] - tp[0], pos[2] - tp[2]).toFixed(1)} from the new goal after ${t} ticks`);
        ok(maxStep <= SPEED * 8 + 1e-4, `goal change (continue ${cont}): max step ${maxStep.toFixed(4)}`);
      }
    }

    // ============================================================ lane offset, speed scale
    {
      const rec = fakeRec('LANE'), s2 = new WaypointSystem(); s2.load(archive);
      const h = s2.create(MAP_PATH, rec, door);
      configure(s2, h, { lane: 0.05 });
      s2.apply(h, rec);
      const off = Math.hypot(rec.x - pd[0], rec.z - pd[2]);
      ok(near(off, 0.05 * 8, 0.02), `apply puts a record with lane 0.05 ${off.toFixed(3)} (expected 0.4) beside the node`);
      s2.setSpeedScale(h, 0.5);
      s2.goTo(h, pepp, 0);
      const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
      let yaw = rec.ry, lastX = pos[0], lastZ = pos[2], maxStep = 0, maxDev = 0, maxTurn = 0, lastYaw = yaw;
      for (let t = 0; t < 600; t++) {
        const code = s2.step(h, pos, yaw, out); yaw = out.yaw;
        if (code === STEP_ARRIVED) break;
        maxStep = Math.max(maxStep, Math.hypot(pos[0] - lastX, pos[2] - lastZ)); lastX = pos[0]; lastZ = pos[2];
        maxDev = Math.max(maxDev, distToPolyline(pos[0], pos[2], poly));
        maxTurn = Math.max(maxTurn, Math.abs(angDiff(yaw, lastYaw))); lastYaw = yaw;
      }
      ok(maxStep <= SPEED * 8 * 0.5 + 1e-4, `speed scale 0.5: max step ${maxStep.toFixed(4)}`);
      ok(maxDev <= 0.05 * 8 + 3, `lane 0.05 keeps ${maxDev.toFixed(2)} from the polyline`);
      ok(maxTurn <= TURN * 0.5 + 1e-5, `speed scale halves the turn rate (max ${maxTurn.toFixed(4)})`);
      s2.flipLane(h); ok(s2.get(h).lane === -Math.fround(0.05), 'flipLane');
      s2.flipLanes(MAP_PATH); ok(s2.get(h).lane === Math.fround(0.05), 'flipLanes(map)');
    }

    // ============================================================ follow / point / heading orders (turn on the spot)
    {
      const s2 = new WaypointSystem(); s2.load(archive);
      const rec = fakeRec('TURN'), target = fakeRec('TARG');
      const h = s2.create(MAP_PATH, rec, door);
      configure(s2, h);
      const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
      let yaw = 0;
      // follow a record 50 units to the east-north-east
      target.x = rec.x + 40; target.z = rec.z + 20;
      s2.followRecord(h, target);
      let code = 0, t = 0, maxTurn = 0, lastYaw = yaw;
      for (; t < 100; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; maxTurn = Math.max(maxTurn, Math.abs(angDiff(yaw, lastYaw))); lastYaw = yaw; if (code === STEP_FACING) break; if (code !== STEP_TURNING) break; }
      const want = Math.atan2(40, 20);
      ok(code === STEP_FACING, `follow: facing the record after ${t} ticks (code ${code})`);
      ok(near(angDiff(yaw, want), 0, 1e-5), `follow: yaw ${yaw.toFixed(4)} = atan2(dx, dz) ${want.toFixed(4)}`);
      ok(maxTurn <= TURN + 1e-5, `follow: turn rate respected (${maxTurn.toFixed(4)})`);
      ok(t === Math.floor(want / TURN), `follow: ${t} full turn steps before the snap for ${want.toFixed(3)} rad at ${TURN.toFixed(3)}`);
      ok(near(pos[0], rec.x, 1e-9) && near(pos[2], rec.z, 1e-9), 'follow does not move the walker');
      // the target moves: the walker keeps tracking it
      target.x = rec.x - 30; target.z = rec.z - 10;
      for (t = 0; t < 100; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; if (code === STEP_FACING) break; }
      ok(code === STEP_FACING && near(angDiff(yaw, Math.atan2(-30, -10)), 0, 1e-5), 'follow: tracks a moved record');
      ok(s2.blockerRecord(h) === null, 'no blocker');
      // face a point (FUN_004627e2) and a node (FUN_00462918)
      s2.turnToPoint(h, [rec.x - 10, 0, rec.z + 40]);
      for (t = 0; t < 100; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; if (code === STEP_FACING) break; }
      ok(code === STEP_FACING && near(angDiff(yaw, Math.atan2(-10, 40)), 0, 1e-5), `turnToPoint: yaw ${yaw.toFixed(3)}`);
      const nb = s2.neighbors(MAP_PATH, door).nodes[0], np = s2.nodePos(MAP_PATH, nb);
      s2.turnToNode(h, nb);
      for (t = 0; t < 100; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; if (code === STEP_FACING) break; }
      ok(code === STEP_FACING && near(angDiff(yaw, Math.atan2(np[0] - pos[0], np[2] - pos[2])), 0, 1e-5), 'turnToNode');
      s2.turnToHeading(h, -2.0);
      for (t = 0; t < 100; t++) { code = s2.step(h, pos, yaw, out); yaw = out.yaw; if (code === STEP_FACING) break; }
      ok(code === STEP_FACING && near(angDiff(yaw, -2.0), 0, 1e-5), 'turnToHeading');
      s2.turnToPoint(h, null);
      ok(s2.step(h, pos, yaw, out) === STEP_ARRIVED, 'turnToPoint(null) stops');
      // a goTo after a follow leaves the follow mode (FUN_00461c24 clears mode 2)
      s2.followRecord(h, target);
      s2.goTo(h, pepp, 0);
      ok(s2.status(h) === STATUS_IDLE || (s2.get(h).flags & 0xf0000000) >>> 0 === MODE_ROUTE, 'goTo leaves the follow mode');
      code = s2.step(h, pos, yaw, out);
      ok(code >= 0, `route after follow: step returns the approached node (${code})`);
      // --- move to a point (FUN_00462a11): walks towards the point, step returns -4
      s2.free(h);       // (a stopped walker on the same node would hold the new one back as a walker ahead)
      const h2 = s2.create(MAP_PATH, fakeRec('PT'), door);
      configure(s2, h2);
      const rec2 = s2.get(h2).rec, tp = [rec2.x + 30, 0, rec2.z + 5];
      s2.moveToPoint(h2, tp);
      const p2 = [rec2.x, rec2.y, rec2.z], d0 = Math.hypot(tp[0] - p2[0], tp[2] - p2[2]);
      let y2 = 0, st = 0, minD = d0, maxStep = 0, l2x = p2[0], l2z = p2[2];
      for (t = 0; t < 600; t++) {
        st = s2.step(h2, p2, y2, out); y2 = out.yaw;
        maxStep = Math.max(maxStep, Math.hypot(p2[0] - l2x, p2[2] - l2z)); l2x = p2[0]; l2z = p2[2];
        minD = Math.min(minD, Math.hypot(tp[0] - p2[0], tp[2] - p2[2]));
        if (st !== STEP_MOVING_TO_POINT) break;
      }
      ok(st === STEP_MOVING_TO_POINT, `moveToPoint reports -4 (${st})`);
      ok(minD < 1.5, `moveToPoint gets within ${minD.toFixed(2)} of the point (from ${d0.toFixed(1)})`);
      ok(maxStep <= SPEED * 8 + 1e-4, `moveToPoint max step ${maxStep.toFixed(4)}`);
      s2.moveToPoint(h2, null);
      ok(s2.step(h2, p2, y2, out) === STEP_ARRIVED, 'moveToPoint(null) stops');
      // --- tuning functions
      s2.setSpeed(h2, 0.2); ok(s2.get(h2).speed === Math.fround(0.2), 'setSpeed (a float32 field)');
      s2.setTurnRate(h2, -0.3); ok(s2.get(h2).turnRate === Math.fround(0.3), 'setTurnRate takes the absolute value (a float32 field)');
      s2.setStopDistance(h2, 2); ok(s2.get(h2).stopDist2 === 4, 'setStopDistance squares');
      const h3 = s2.create(MAP_PATH, null, -3);
      ok(h3 > 0 && s2.get(h3).from === 0 && s2.get(h3).to === 0, 'start node -3: from = to = 0');
      // the table holds 60 walkers
      const s3 = new WaypointSystem(); s3.load(archive);
      let last = 0; for (let i = 0; i < 70; i++) { const hh = s3.create(MAP_ROAD, fakeRec('X'), 0); if (!hh) break; last = hh; }
      ok(last === 60, `walker table size ${last} (expected 60)`);
      ok(s3.create(MAP_ROAD, fakeRec('X'), 0) === 0, 'create fails when the table is full');
      s3.free(30); ok(s3.create(MAP_ROAD, fakeRec('X'), 0) === 30, 'a freed slot is reused (handle = index + 1)');
      const s4 = new WaypointSystem();
      ok(s4.create(MAP_PATH, fakeRec('X'), 0) === 0, 'create without a loaded map fails');
    }

    // ============================================================ traffic: a faster walker catches up and has to hold back
    {
      const s2 = new WaypointSystem(); s2.load(archive);
      const ra = fakeRec('CARA'), rb = fakeRec('CARB');
      const ha = s2.create(MAP_PATH, ra, door), hb = s2.create(MAP_PATH, rb, door);
      configure(s2, ha, { speed: 0.012 }); configure(s2, hb, { speed: 0.03 });
      s2.apply(ha, ra); s2.apply(hb, rb);
      s2.goTo(ha, pepp, 0); s2.goTo(hb, pepp, 0);
      const pa = [ra.x, ra.y, ra.z], pb = [rb.x, rb.y, rb.z], out = { yaw: 0, dist: 0 };
      let ya = ra.ry, yb = rb.ry, minGap = Infinity, blockedTicks = 0, ticks = 0, crossed = false;
      for (; ticks < 3000; ticks++) {
        // A starts 200 ticks before B (B waits at the door: its record is simply not stepped)
        const ca = s2.step(ha, pa, ya, out); ya = out.yaw; ra.x = pa[0]; ra.z = pa[2];
        if (ticks >= 200) { s2.step(hb, pb, yb, out); yb = out.yaw; rb.x = pb[0]; rb.z = pb[2]; if (s2.isBlocked(hb)) blockedTicks++; }
        if (ticks > 260) { const gap = Math.hypot(ra.x - rb.x, ra.z - rb.z); minGap = Math.min(minGap, gap); if (gap < 1 && ticks > 600) crossed = true; }
        if (ca === STEP_ARRIVED) break;
      }
      checked += 3;
      ok(blockedTicks > 0, 'the fast walker was held back by the slow one ahead');
      ok(minGap >= Math.sqrt(0.36) * 8 - 1.5, `walkers stay close to the stop distance (min gap ${minGap.toFixed(2)}, stop distance ${(0.6 * 8).toFixed(2)})`);
      ok(!crossed, 'walkers did not pass through each other');
      notes.push(`traffic: slow walker ahead, fast behind: held back in ${blockedTicks} of ${ticks - 200} ticks, min gap ${minGap.toFixed(2)} (stop distance 4.8)`);
      // with the "do not yield" flag the fast walker ignores the one ahead
      const rc = fakeRec('CARC'), hc = s2.create(MAP_PATH, rc, door);
      configure(s2, hc, { speed: 0.03 }); s2.setIgnore(hc, 1, 1); s2.apply(hc, rc);
      ok(s2.getIgnore(hc).noYield && s2.getIgnore(hc).noCross, 'setIgnore / getIgnore');
      s2.goTo(hc, pepp, 0);
      const pc = [rc.x, rc.y, rc.z]; let yc = rc.ry, everBlocked = false;
      for (let t = 0; t < 400; t++) { s2.step(hc, pc, yc, out); yc = out.yaw; rc.x = pc[0]; rc.z = pc[2]; if (s2.isBlocked(hc)) everBlocked = true; }
      ok(!everBlocked, 'a walker with WF_NOYIELD is never blocked');
    }

    // ============================================================ the behaviour node in a World
    {
      ok(registeredNodes().includes('Walker'), 'Walker node is registered');
      const w = new World();
      const sysW = new WaypointSystem(); sysW.load(archive);
      const rec = new GameRecord('NPC1');
      rec.ctrl = new Controller();
      w.records.push(rec);
      const node = createNode('Walker', { system: sysW, map: MAP_PATH, route: ['PHSE_DOOR', 'SKPK_PEPP01'], loop: false, start: 'PHSE_DOOR' });
      ok(node instanceof WalkerNode && node.kind === 'Walker', 'createNode("Walker")');
      rec.ctrl.attach(node, 0);
      const arrivals = [];
      node.args.onNode = (i, n) => arrivals.push([w.tickCount, i, n]);
      let t = 0, maxStep = 0, lx = 0, lz = 0, started = false;
      for (; t < 8000 && !node.done; t++) {
        w.tick();
        if (!started) { started = true; lx = rec.x; lz = rec.z; }
        maxStep = Math.max(maxStep, Math.hypot(rec.x - lx, rec.z - lz)); lx = rec.x; lz = rec.z;
      }
      ok(node.done, `the node finished its route within ${t} ticks`);
      ok(rec.ctrl.walker === node.handle && node.handle > 0, 'ctrl.walker holds the handle');
      ok(Math.hypot(rec.x - pp[0], rec.z - pp[2]) < 9, `record ended ${Math.hypot(rec.x - pp[0], rec.z - pp[2]).toFixed(2)} from SKPK_PEPP01`);
      ok(arrivals.length === 2 && arrivals[0][2] === door && arrivals[1][2] === pepp, `route nodes reported: ${JSON.stringify(arrivals)}`);
      ok(maxStep <= NPC_SPEED * 8 + 1e-3, `node: max step ${maxStep.toFixed(4)}`);
      ok(near(rec.m[8], Math.sin(rec.ry), 1e-4) && near(rec.m[10], Math.cos(rec.ry), 1e-4), 'record matrix follows the yaw');
      ok(near(rec.m[12], rec.x, 1e-6) && near(rec.m[14], rec.z, 1e-6), 'record matrix holds the position');
      node.destroy(w, rec, rec.ctrl);
      ok(sysW.get(1) === null && rec.ctrl.walker === 0, 'destroy frees the walker');
      notes.push(`Walker node (door -> SKPK_PEPP01, loop off): done after ${t} ticks, max step ${maxStep.toFixed(4)}`);

      // a looping route with 3 nodes keeps running and wraps around
      const w2 = new World(), s5 = new WaypointSystem(); s5.load(archive);
      const r2 = new GameRecord('NPC2'); r2.ctrl = new Controller(); w2.records.push(r2);
      const route = [door, sys.route(MAP_PATH, door, pepp), pepp];
      const n2 = createNode('Walker', { system: s5, route, loop: true, start: door, speed: 0.1 });
      r2.ctrl.attach(n2, 0);
      const seen = [];
      n2.args.onNode = (i) => seen.push(i);
      for (let i = 0; i < 1500; i++) w2.tick();
      ok(seen.length >= 3 && seen[0] === 0 && seen[1] === 1 && seen[2] === 2 && seen.slice(0, 6).every((v, i) => v === i % 3), `looping route wraps around: ${seen.slice(0, 8)}`);
      ok(!n2.done, 'looping node is never done');
    }

    return { checked, failures, notes };
  },
};
