import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';

// M4 WP6: the boats (SGBoat FUN_0042f9a2 / FUN_00430749) on the real island world: the Res-Q speedboat SPBT (story node 10, era 1) and the jet ski / dinghy
// (node 2): getting in with Ctrl at the jetty, driving on the sea, the shore stops the boat, the dock (Ctrl) lets Pepper off.
// Run: node tools/test-formats.mjs --only m4-wp6-boat -v

const finite = (r) => [r.x, r.y, r.z, ...r.m].every(Number.isFinite);

export default {
  name: 'm4-wp6-boat',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));

    for (const [node, name, gateVar, clip, engine] of [[10, 'SPBT', 0x82, 0x4c, 0x129], [2, 'JSKI', 0xb2, 0x6f, 0x8d]]) {
      const I = loadIsland(ctx, { node });
      const P = I.pepper, W = I.world, G = vehicles(W);
      const B = I.rec(name);
      const N = B.ctrl.find('SGBoat');
      ok(N && N.var === gateVar, `${name}: SGBoat gated by var 0x${gateVar.toString(16)}`);
      tick(I, 2);
      ok(N.rip && N.wakeR && N.wakeP && N.wakeS && N.rip.name.startsWith('RIP') && N.wakeR.name === 'WAKR', `${name}: argument block -> ${N.rip?.name} WAKR WAKP WAKS`);
      ok(N.dock >= 0 && G.docks[N.dock].taken, `${name}: parked at dock ${N.dock}`);
      ok(N.rip.enabled && !N.wakeR.enabled, `${name}: the ripple shows under the parked boat, the wake is hidden`);
      // Pepper on the jetty (the docks' exit node), Ctrl
      const e = waypoints.nodePos(1, 0x18e);
      P.x = e[0]; P.y = e[1]; P.z = e[2];
      tick(I, 2);
      ok(B.ctrl.distSq < 576, `${name}: Pepper within 24 of the boat (${Math.sqrt(B.ctrl.distSq).toFixed(1)})`);
      press(I, 'ControlLeft');
      ok((W.vars.get(0x5e) & 0xfff) === 8 && W.vars.get(gateVar) === 1, `${name}: Ctrl -> PEPPER_CONTROL 8, MOVE var 1 (${W.vars.get(0x5e).toString(16)} / ${W.vars.get(gateVar)})`);
      ok(G.current === B && G.kind === -2, `${name}: the current vehicle, kind -2 (boat)`);
      ok(P.anim.clip === clip, `${name}: Pepper's clip 0x${clip.toString(16)} (got ${P.anim.clip.toString(16)})`);
      tick(I, 1);
      const d0 = Math.hypot(P.x - B.x, P.y - B.y, P.z - B.z);
      ok(d0 < 3, `${name}: Pepper sits on the seat (${d0.toFixed(2)} from the boat's origin)`);
      ok(!G.docks[N.dock].taken, `${name}: the dock is free while the boat is out`);
      // drive: Space
      const p0 = [B.x, B.z];
      let maxDy = 0, sounds = 0;
      const s0 = I.ictx.sounds.length;
      hold(I, ['Space'], 45, () => { maxDy = Math.max(maxDy, Math.abs(B.y - W.seaLevel)); });
      sounds = I.ictx.sounds.slice(s0).filter((s) => s.id === engine).length;
      const run = Math.hypot(B.x - p0[0], B.z - p0[1]);
      ok(run > 20 && N.speed > 1, `${name}: Space drives (${run.toFixed(1)} units, speed ${N.speed.toFixed(2)})`);
      ok(maxDy < 1e-3, `${name}: the boat stays on the sea level 2.4 (max |y - sea| ${maxDy.toFixed(4)})`);
      ok(sounds > 30, `${name}: the engine sound 0x${engine.toString(16)} plays (${sounds} ticks)`);
      ok(Math.hypot(P.x - B.x, P.z - B.z) < 3, `${name}: Pepper rides along`);
      ok(N.wakeR.enabled && N.wakeS.enabled, `${name}: the wake shows while driving`);
      // the boat camera: 40 behind, 16 up, looking at 8 above the boat
      const c = W.camera.c;
      const back = (c[0] - B.x) * B.m[8] + (c[2] - B.z) * B.m[10];
      ok(Math.abs(c[4] - (B.y + 8)) < 2 && back < -20 && back > -50, `${name}: boat camera behind the boat (${back.toFixed(1)} along the nose)`);
      const yaw0 = B.ry;
      hold(I, ['Space', 'ArrowLeft'], 30);
      ok(B.ry < yaw0 - 0.2 && Math.abs(B.rz) > 0.01, `${name}: Left turns and rolls (yaw ${yaw0.toFixed(2)} -> ${B.ry.toFixed(2)}, roll ${B.rz.toFixed(3)})`);
      ok(finite(B) && finite(P), `${name}: no NaN`);
      // the shore: aim at the island's centre and hold the throttle until the boat stops
      B.ry = Math.atan2(0 - B.x, 0 - B.z); B.setEuler(B.rx, B.ry, B.rz, B.x, B.y, B.z);
      const cs = I.ictx.sounds.length;
      let stopped = -1;
      hold(I, ['Space'], 600, (i) => { if (stopped < 0 && i > 5 && N.speed === 0) stopped = i; });
      const g = W.col.terrainHeight(B.x, 50, B.z, 0);
      ok(stopped > 0, `${name}: the shore stops the boat (tick ${stopped}, at ${B.x.toFixed(0)},${B.z.toFixed(0)}, terrain ${g.toFixed(1)})`);
      ok(I.ictx.sounds.slice(cs).some((s) => s.id === 0x332), `${name}: the crash sound 0x332`);
      ok(g <= W.seaLevel + 1, `${name}: still on the water`);
      // to a free dock: put the boat 10 units off it, Ctrl
      const di = G.docks.findIndex((d) => !d.taken);
      const dp = waypoints.nodePos(1, G.docks[di].node);
      B.setEuler(0, 0, 0, dp[0], W.seaLevel, dp[2] - 10); B.ry = 0;
      tick(I, 2);
      press(I, 'ControlLeft');
      ok(N.state === 2 || (W.vars.get(0x5e) & 0xfff) === 1, `${name}: Ctrl near a dock -> docking (state ${N.state})`);
      let out = -1;
      tick(I, 200, (i) => { if (out < 0 && (W.vars.get(0x5e) & 0xfff) === 1) out = i; });
      const ex = waypoints.nodePos(1, G.docks[di].exit);
      ok(out >= 0 && W.vars.get(gateVar) === 0 && G.current === null, `${name}: moored, Pepper off (tick ${out}, MOVE var ${W.vars.get(gateVar)})`);
      ok(Math.hypot(P.x - ex[0], P.z - ex[2]) < 6, `${name}: Pepper on the dock's exit node (${Math.hypot(P.x - ex[0], P.z - ex[2]).toFixed(1)} off)`);
      ok(W.vars.get(0xc5) === 4 && P.ctrl.find('SGwalk').state === 0x1b, `${name}: PEPPERSSHADOW 4, walking idle`);
      ok(G.docks[di].taken && N.dock === di, `${name}: the boat holds the dock`);
      tick(I, 30);
      ok(!N.wakeR.enabled && N.rip.enabled, `${name}: parked again: ripple on, wake off`);
      notes.push(`${name}: ${run.toFixed(0)} units in 45 ticks, shore at tick ${stopped}, moored after ${out} ticks`);
    }
    return { checked, failures, notes };
  },
};
