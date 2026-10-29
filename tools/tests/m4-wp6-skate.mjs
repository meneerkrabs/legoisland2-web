import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';

// M4 WP6: Pepper's mode switch (PepSwitc FUN_004bb67d) and the skateboard (skate.c FUN_00490e2e) on the real island world (story node 2, the skate park).
// Run: node tools/test-formats.mjs --only m4-wp6-skate -v

const finite = (r) => [r.x, r.y, r.z, ...r.m].every(Number.isFinite);

export default {
  name: 'm4-wp6-skate',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    waypoints.load(archive);

    // ---------------------------------------------------------------- the chain on PEPP
    const I = loadIsland(ctx, { node: 2 });
    const P = I.pepper, W = I.world;
    const kinds = P.ctrl.nodes.map((n) => n.kind);
    ok(['PepSwitc', 'SGwalk', 'sgswim', 'skate', 'SGVehic', 'Ptera'].every((k) => kinds.includes(k)), `PEPP chain has the six mode nodes (${kinds.join(' ')})`);
    const sk = P.ctrl.find('skate');
    ok(sk && sk.mask === 4 && sk.value === 4, 'skateboard gate PEPPER_CONTROL & 4');
    const board = W.records[vehicles(W).board];
    ok(board?.name === 'SBRD' && !board.enabled, 'the board record SBRD (9) is hidden while walking');
    tick(I, 20);
    W.vars.set(0xbb, 5);
    tick(I, 1);
    ok(W.vars.get(0xbb) === 0, 'walking clears PORTAL_VEHICLE (0xbb)');

    // ---------------------------------------------------------------- Ctrl: on the board
    const snd0 = I.ictx.sounds.length;
    press(I, 'ControlLeft');
    ok((W.vars.get(0x5e) & 0xfff) === 4, `Ctrl while walking: PEPPER_CONTROL 4 (got ${W.vars.get(0x5e).toString(16)})`);
    ok(P.anim.clip === 0x16 && sk.state === 0x16, `getting on: clip / state 0x16 (clip ${P.anim.clip.toString(16)}, state ${sk.state.toString(16)})`);
    ok(board.enabled, 'the board is shown');
    ok(I.ictx.sounds.slice(snd0).some((s) => s.id === 0x150), 'the getting-on sound 0x150');
    const start = [P.x, P.y, P.z];
    let states = new Set();
    tick(I, 120, () => states.add(sk.state));
    ok(states.has(0x2d) && sk.speed > 0.7, `0x16 -> push off 0x2d, speed up to 0.75 (states ${[...states].map((s) => s.toString(16))}, speed ${sk.speed.toFixed(2)})`);
    const moved = Math.hypot(P.x - start[0], P.z - start[2]);
    ok(moved > 30, `the board rolls (${moved.toFixed(1)} units in 120 ticks)`);
    ok(Math.abs(board.x - P.x) < 1e-3 && Math.abs(board.z - P.z) < 1e-3 && Math.abs(board.m[8] - P.m[8]) < 1e-5, 'the board follows Pepper\'s matrix');
    let maxOff = 0;
    tick(I, 60, () => { const t = W.col.terrainHeight(P.x, P.y, P.z, 4); if (sk.t === 0 && t > -1e30) maxOff = Math.max(maxOff, Math.abs(P.y - t)); states.add(sk.state); });
    ok(maxOff < 1.5, `rolling stays on the ground (max |y - terrain| ${maxOff.toFixed(2)})`);
    ok(states.has(0x29), 'rolling state 0x29 reached');
    // camera: the eye eases to (0, 12, -14) in Pepper's frame, looking at 4 above him
    const c = W.camera.c;
    const camD = Math.hypot(c[0] - P.x, c[2] - P.z);
    ok(Math.abs(c[4] - (P.y + 4)) < 1e-3 && camD > 6 && camD < 30, `skate camera: target 4 above Pepper, eye ${camD.toFixed(1)} behind`);

    // ---------------------------------------------------------------- steering
    const yaw0 = P.ry;
    hold(I, ['ArrowLeft'], 20);
    ok(P.ry < yaw0 - 0.5, `Left turns (yaw ${yaw0.toFixed(2)} -> ${P.ry.toFixed(2)})`);
    ok(P.anim.clip === 0x51 || P.anim.clip === 0x29 || P.anim.clip === 0x2d, `steering shows the lean pose 0x51 (clip ${P.anim.clip.toString(16)})`);
    tick(I, 10);

    // ---------------------------------------------------------------- Alt: crouch, jump, land
    states = new Set();
    let ymax = -1e9, y0 = null;
    const air = () => { states.add(sk.state); if (sk.state === 0x20) { if (y0 === null) y0 = P.y; ymax = Math.max(ymax, P.y); } };
    hold(I, ['AltLeft'], 25, air);
    tick(I, 60, air);
    ok(states.has(0x2a) && states.has(0x20) && states.has(0x21), `Alt: crouch 0x2a -> air 0x20 -> landing 0x21 (states ${[...states].map((s) => s.toString(16))})`);
    ok(ymax > y0 + 2, `the jump goes up (${(ymax - y0).toFixed(1)} units)`);
    ok(sk.t === 0, 'landed (no time in the air)');
    ok(finite(P) && finite(board), 'no NaN in Pepper / the board');

    // ---------------------------------------------------------------- Ctrl: off the board
    const snd1 = I.ictx.sounds.length;
    press(I, 'ControlLeft');
    ok((W.vars.get(0x5e) & 0xfff) === 1, `Ctrl on the board: walking again (${W.vars.get(0x5e).toString(16)})`);
    ok(P.anim.clip === 0x1c || W.pep.mailbox === 0x1c || P.ctrl.find('SGwalk').state === 0x1c, 'getting off: state 0x1c');
    ok(I.ictx.sounds.slice(snd1).some((s) => s.id === 0x106), 'the getting-off sound 0x106');
    tick(I, 120);
    ok(P.ctrl.find('SGwalk').state === 0x1b && !board.enabled, 'after the getting-off clip: idle, the board hidden by the walk node');

    // ---------------------------------------------------------------- water ahead throws Pepper off
    {
      const J = loadIsland(ctx, { node: 2 });
      const Q = J.pepper, V = J.world;
      // a PATH node on dry land with water 4..8 units ahead in some direction and no vehicle within 30 units (Ctrl would get into it)
      const veh = ['SPBT', 'JSKI', 'DNGY', 'PHEL', 'RHEL', 'AMBU', 'SPD0', 'SPD1', 'SPD2', 'PCAR'].map((n) => J.rec(n)).filter(Boolean);
      let found = false;
      for (let n = 0; n < waypoints.mapCount(1) && !found; n++) {
        const p = waypoints.nodePos(1, n);
        const g = V.col.terrainHeight(p[0], p[1], p[2], 4);
        if (!(g > V.seaLevel + 0.5) || veh.some((r) => Math.hypot(r.x - p[0], r.z - p[2]) < 30)) continue;
        for (let a = 0; a < 16 && !found; a++) {
          const s = Math.sin(a * Math.PI / 8), c = Math.cos(a * Math.PI / 8);
          if (V.col.terrainHeight(p[0] + s * 4, g, p[2] + c * 4, 4) > V.seaLevel) continue;
          if (V.col.terrainHeight(p[0] + s * 8, g, p[2] + c * 8, 4) > V.seaLevel) continue;
          Q.x = p[0]; Q.y = g; Q.z = p[2]; Q.ry = a * Math.PI / 8; Q.rebuildYaw();
          found = true;
        }
      }
      tick(J, 2);
      ok(found, 'a PATH node at the water with no vehicle near');
      press(J, 'ControlLeft');
      ok((V.vars.get(0x5e) & 0xfff) === 4, 'on the board on the jetty');
      let off = -1;
      tick(J, 150, (i) => { if (off < 0 && (V.vars.get(0x5e) & 0xfff) !== 4) off = i; });
      ok(off > 0 && (V.vars.get(0x5e) & 0xfff) === 1, `water 4 units ahead: off the board after the getting-on clip (tick ${off}, mode ${V.vars.get(0x5e).toString(16)})`);
    }
    notes.push(`skate: rolled ${moved.toFixed(0)} units, jump height ${(ymax - y0).toFixed(1)}`);
    return { checked, failures, notes };
  },
};
