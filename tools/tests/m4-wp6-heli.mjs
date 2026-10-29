import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';
import { partOverrides } from '../../src/island/trigger/parts.ts';

// M4 WP6: the helicopters (SGHeli FUN_00431425 / FUN_00432421) on the real island world (story node 52, era 3): getting in, take-off to 40 above the
// ground, flying, the altitude band, the rotors (mesh part matrices), landing on a helipad with Ctrl.
// Run: node tools/test-formats.mjs --only m4-wp6-heli -v

const finite = (r) => [r.x, r.y, r.z, ...r.m].every(Number.isFinite);

export default {
  name: 'm4-wp6-heli',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));

    for (const [name, gateVar] of [['RHEL', 0xbe], ['PHEL', 0x3e]]) {
      const I = loadIsland(ctx, { node: 52 });
      const P = I.pepper, W = I.world, G = vehicles(W);
      const H = I.rec(name);
      const N = H.ctrl.find('SGHeli');
      ok(N && N.var === gateVar, `${name}: SGHeli gated by var 0x${gateVar.toString(16)}`);
      tick(I, 2);
      ok(N.pad >= 0 && G.pads[N.pad].taken, `${name}: parked on helipad ${N.pad}`);
      const ex = waypoints.nodePos(1, G.pads[N.pad].exit);
      P.x = ex[0]; P.y = ex[1]; P.z = ex[2];
      tick(I, 2);
      ok(H.ctrl.distSq < 576, `${name}: Pepper at the pad's exit node, ${Math.sqrt(H.ctrl.distSq).toFixed(1)} from the helicopter`);
      press(I, 'ControlLeft');
      ok((W.vars.get(0x5e) & 0xfff) === 8 && W.vars.get(gateVar) === 1 && G.kind === -3, `${name}: Ctrl -> PEPPER_CONTROL 8, MOVE var 1, kind -3`);
      ok(P.anim.clip === 0x4c && W.vars.get(0xc5) === 1, `${name}: Pepper's clip 0x4c, PEPPERSSHADOW 1`);
      // take-off: climbs until 40 above the ground, then state 1
      const y0 = H.y;
      let t1 = -1;
      tick(I, 200, (i) => { if (t1 < 0 && N.state === 1) t1 = i; });
      const g = Math.max(W.col.terrainHeight(H.x, H.y, H.z, 4), W.seaLevel);
      ok(t1 > 0 && H.y - g > 39, `${name}: take-off -> flying at tick ${t1}, ${(H.y - g).toFixed(1)} above the ground (from ${y0.toFixed(1)})`);
      ok(!G.pads[N.pad].taken, `${name}: the pad is free while flying`);
      ok(Math.hypot(P.x - H.x, P.z - H.z) < 4 && Math.abs(P.y - H.y) < 6, `${name}: Pepper sits in the helicopter`);
      const parts = partOverrides(W, H);
      ok(parts && parts.size >= 1 && [...parts.values()].every((m) => m.every(Number.isFinite)), `${name}: the rotor part matrices turn (${parts?.size ?? 0} live)`);
      ok(N.rotorMain > 50, `${name}: main rotor angle ${N.rotorMain.toFixed(1)}`);
      // forward (Space tilts the nose down)
      const p0 = [H.x, H.z];
      let minAlt = 1e9;
      hold(I, ['Space'], 90, () => { const gg = Math.max(W.col.terrainHeight(H.x, H.y, H.z, 160), W.seaLevel); minAlt = Math.min(minAlt, H.y - gg); });
      const run = Math.hypot(H.x - p0[0], H.z - p0[1]);
      ok(run > 60 && H.rx > 0.4, `${name}: Space flies forward (${run.toFixed(0)} units, pitch ${H.rx.toFixed(2)})`);
      ok(minAlt >= 15.9, `${name}: never below 16 above the ground (min ${minAlt.toFixed(1)})`);
      const c = W.camera.c;
      const back = (c[0] - H.x) * H.m[8] + (c[2] - H.z) * H.m[10];
      ok(back < -30 && back > -70 && c[4] === H.y, `${name}: helicopter camera ${back.toFixed(1)} behind, looking at the helicopter`);
      const yaw0 = H.ry;
      hold(I, ['ArrowRight'], 30);
      ok(H.ry > yaw0 + 1, `${name}: Right turns (${yaw0.toFixed(2)} -> ${H.ry.toFixed(2)})`);
      // Down = climb (the pad's y axis): capped at 160
      let maxY = -1e9;
      hold(I, ['ArrowDown'], 400, () => { maxY = Math.max(maxY, H.y); });
      ok(maxY > 120 && maxY < 162, `${name}: Down climbs, capped near 160 (max ${maxY.toFixed(1)})`);
      ok(finite(H) && finite(P), `${name}: no NaN`);
      // land: 30 units off a free pad, 50 above it, Ctrl
      const pi = G.pads.findIndex((p, i) => !p.taken && i !== 1);
      const pp = waypoints.nodePos(1, G.pads[pi].node);
      H.setEuler(0, 0, 0, pp[0] + 30, pp[1] + 50, pp[2]); H.ry = 0; H.rx = 0; H.rz = 0; N.vx = 0; N.vy = 0; N.vz = 0;
      W.camera.c[0] = H.x; W.camera.c[1] = H.y + 24; W.camera.c[2] = H.z - 56;
      tick(I, 1);
      press(I, 'ControlLeft');
      ok(N.state === 2, `${name}: Ctrl -> landing (state ${N.state})`);
      let out = -1;
      tick(I, 900, (i) => { if (out < 0 && (W.vars.get(0x5e) & 0xfff) === 1) out = i; });
      const pe = waypoints.nodePos(1, G.pads[pi].exit);
      ok(out > 0 && W.vars.get(gateVar) === 0 && G.current === null && N.state === 0, `${name}: landed, Pepper off (tick ${out})`);
      ok(Math.hypot(P.x - pe[0], P.z - pe[2]) < 1 && W.vars.get(0xc5) === 4, `${name}: Pepper on the pad's exit node, PEPPERSSHADOW 4`);
      ok(Math.hypot(H.x - pp[0], H.z - pp[2]) < 17 && G.pads[pi].taken, `${name}: the helicopter stands on the pad (${Math.hypot(H.x - pp[0], H.z - pp[2]).toFixed(1)} off)`);
      notes.push(`${name}: airborne after ${t1} ticks, ${run.toFixed(0)} units in 90 ticks forward, landed after ${out} ticks`);
    }
    return { checked, failures, notes };
  },
};
