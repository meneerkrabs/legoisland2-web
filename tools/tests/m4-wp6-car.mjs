import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles, CAR_DRIVEN, CAR_PLAYER } from '../../src/island/vehicles/index.ts';

// M4 WP6: the cars (SGCar FUN_0088ed56 / FUN_0088f816, leaving through PepSwitc FUN_0088e030) on the real island world (story node 2): the police car PCAR
// and the speedster SPD2 (both with speeder.c's node in front, WP5): getting in, driving on the ground, steering, Ctrl leaves the car at a free spot.
// Run: node tools/test-formats.mjs --only m4-wp6-car -v

const finite = (r) => [r.x, r.y, r.z, ...r.m].every(Number.isFinite);

export default {
  name: 'm4-wp6-car',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));

    for (const [name, gateVar] of [['PCAR', 0x60], ['SPD2', 0x7f]]) {
      const I = loadIsland(ctx, { node: 2 });
      const P = I.pepper, W = I.world, G = vehicles(W);
      const C = I.rec(name);
      const N = C.ctrl.find('SGCar');
      ok(N && N.var === gateVar && N.mask === 0, `${name}: SGCar on var 0x${gateVar.toString(16)}, mask 0`);
      tick(I, 2);
      ok((W.vars.get(gateVar) & CAR_PLAYER) !== 0 && (W.vars.get(gateVar) & CAR_DRIVEN) === 0, `${name}: var bit 0x20000000 set, 0x10000000 clear (${W.vars.get(gateVar).toString(16)})`);
      // Pepper 4 units to the side, Ctrl
      P.x = C.x + C.m[0] * 4; P.z = C.z + C.m[2] * 4; P.y = W.col.terrainHeight(P.x, C.y + 4, P.z, 4);
      tick(I, 3);
      press(I, 'ControlLeft');
      ok((W.vars.get(0x5e) & 0xfff) === 8 && (W.vars.get(gateVar) & CAR_DRIVEN) !== 0 && G.kind === -1 && G.current === C, `${name}: Ctrl -> PEPPER_CONTROL 8, 0x10000000, kind -1`);
      ok(P.anim.clip === 0x4c, `${name}: Pepper's getting-in / driving clip 0x4c (${P.anim.clip.toString(16)})`);
      tick(I, 1);
      ok(Math.hypot(P.x - C.x, P.z - C.z) < 3, `${name}: Pepper on the seat`);
      // drive
      const p0 = [C.x, C.z];
      let maxOff = 0;
      hold(I, ['Space'], 60, () => { const t = W.col.terrainHeight(C.x, C.y, C.z, 4); if (t > -1e30) maxOff = Math.max(maxOff, Math.abs(C.y - t)); });
      const run = Math.hypot(C.x - p0[0], C.z - p0[1]);
      ok(run > 15 && N.speed > 0.5, `${name}: Space drives (${run.toFixed(1)} units, speed ${N.speed.toFixed(2)})`);
      ok(maxOff < 0.5, `${name}: the car stays on the ground (max |y - terrain| ${maxOff.toFixed(2)})`);
      ok(Math.abs(C.m[0] * C.m[4] + C.m[1] * C.m[5] + C.m[2] * C.m[6]) < 1e-3 && C.m[5] > 0.5, `${name}: the matrix stays orthogonal, up ${C.m[5].toFixed(2)}`);
      // the camera: (0, 12, -16) in Pepper's frame, eased by 0.1; at least 6.4 above the car
      const c = W.camera.c;
      const back = (c[0] - P.x) * P.m[8] + (c[2] - P.z) * P.m[10];
      ok(back < -5 && back > -40 && c[1] >= C.y + 6.4 - 1e-3, `${name}: car camera ${back.toFixed(1)} behind, ${(c[1] - C.y).toFixed(1)} above`);
      const yaw0 = C.ry;
      hold(I, ['Space', 'ArrowRight'], 30);
      ok(C.ry > yaw0 + 0.3, `${name}: Right steers while moving (${yaw0.toFixed(2)} -> ${C.ry.toFixed(2)})`);
      hold(I, ['AltLeft'], 90);
      ok(N.speed < 0, `${name}: Alt brakes and reverses (speed ${N.speed.toFixed(2)})`);
      tick(I, 60);
      ok(finite(C) && finite(P), `${name}: no NaN`);
      // Ctrl: out at a free spot
      press(I, 'ControlLeft');
      tick(I, 2);
      ok((W.vars.get(0x5e) & 0xfff) === 1 && G.current === null, `${name}: Ctrl leaves the car (PEPPER_CONTROL ${W.vars.get(0x5e).toString(16)})`);
      const d = Math.hypot(P.x - C.x, P.z - C.z);
      ok(d > 2 && d < 60 && P.y > W.seaLevel, `${name}: Pepper on a free spot ${d.toFixed(1)} from the car, above the sea`);
      tick(I, 2);
      ok((W.vars.get(gateVar) & CAR_DRIVEN) === 0 && (W.vars.get(gateVar) & CAR_PLAYER) !== 0, `${name}: the car is free again (${W.vars.get(gateVar).toString(16)})`);
      const cx = C.x;
      tick(I, 30);
      ok(C.x === cx, `${name}: the empty car stands still`);
      notes.push(`${name}: ${run.toFixed(0)} units in 60 ticks, left ${d.toFixed(1)} from the car`);
    }
    return { checked, failures, notes };
  },
};
