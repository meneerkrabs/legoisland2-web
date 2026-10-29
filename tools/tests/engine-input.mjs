import { InputMapper, readKeyTable, DEFAULT_BINDINGS, B } from '../../src/game/input.ts';
import { RAMP_TABLE } from '../../src/game/camera.ts';
import { loadExe, loadZone, run } from '../lib/engine-load.mjs';
import { ST } from '../../src/game/walk.ts';

// Input mapper (key table of the executable) and the input -> velocity model of the walk code (FUN_0042a487 / FUN_0042a654 / FUN_0042a88f).
export default {
  name: 'engine-input',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    // --- key table of the EXE: 13 entries, default keys = arrows, Ctrl, Alt, Shift, Space, <>, Z, X, C, Enter
    const tbl = readKeyTable(pe);
    ok(tbl.length === 13, `key table has ${tbl.length} entries`);
    const want = { 4: 0xc8, 8: 0xd0, 1: 0xcb, 2: 0xcd, 0x10: 0x1d, 0x20: 0x38, 0x40: 0x2a, 0x80: 0x39, 0x1000: 0x56, 0x2000: 0x2c, 0x4000: 0x2d, 0x8000: 0x2e, 0x10000: 0x1c };
    for (const e of tbl) ok(want[e.bit] === e.dik, `button 0x${e.bit.toString(16)} is bound to DIK 0x${e.dik.toString(16)}, expected 0x${(want[e.bit] ?? 0).toString(16)}`);
    ok(JSON.stringify(DEFAULT_BINDINGS.map((b) => [b.dik, b.bit]).sort()) === JSON.stringify(tbl.map((b) => [b.dik, b.bit]).sort()), 'the built-in default table equals the EXE table');
    // ramp table 0x8ae098: 33 floats 0, 8, ... 248, 255
    for (let i = 0; i < 33; i++) {
      const u = pe.u32(0x8ae098 + i * 4), f = new DataView(new ArrayBuffer(4)); f.setUint32(0, u, true);
      ok(near(f.getFloat32(0, true), RAMP_TABLE[i]), `ramp table entry ${i}`);
    }
    // --- mapper: browser codes -> logical bits, edge detection
    const im = new InputMapper(tbl);
    im.setKey('ArrowUp', true); im.update();
    ok(im.held === B.UP && im.pressed === B.UP, 'ArrowUp held + pressed');
    im.update(); ok(im.held === B.UP && im.pressed === 0, 'held stays, no new press');
    im.setKey('KeyD', true); im.setKey('AltLeft', true); im.update();
    ok(im.held === (B.UP | B.RIGHT | B.ALT) && im.pressed === (B.RIGHT | B.ALT), 'WASD alias + Alt: held / pressed masks');
    im.setKey('ArrowUp', false); im.setKey('KeyD', false); im.setKey('AltLeft', false); im.update();
    ok(im.held === 0 && im.pressed === 0, 'all released');
    // the state is read once per tick (the original's poll): a tap between two ticks is not seen; the test-only switch `latchTaps` keeps the old behaviour
    im.setKey('AltLeft', true); im.setKey('AltLeft', false); im.update();
    ok(im.held === 0 && im.pressed === 0, 'a key tap between two ticks is not seen (exact poll)');
    im.latchTaps = true;
    im.setKey('AltLeft', true); im.setKey('AltLeft', false); im.update();
    ok(im.held === B.ALT && im.pressed === B.ALT, 'latchTaps (test-only): the tap counts'); im.update(); ok(im.held === 0, 'and lasts one tick');
    im.latchTaps = false;
    im.setKey('Escape', true); im.update(); ok(im.held === B.ESC, 'Escape = pause bit');
    im.setKey('Escape', false);
    // --- the velocity model on Pepper's house floor (flat, walls far away)
    {
      const L = loadZone(ctx, 'z03PPH', { pos: [-3.75, 0.33, -4] });
      const w = L.world, walk = L.walk;
      run(L, 8);
      ok(walk.state === ST.IDLE && walk.speed === 0, `idle at rest (state 0x${walk.state.toString(16)})`);
      // Up held from rest: the key ramp index goes 16 -> 13 -> 10 -> 7 -> 4 -> 1 -> 0 (3 per tick), stick = table[ramp] - 128; the dead zone is +-32
      const ramps = [13, 10, 7, 4, 1, 0, 0, 0];
      const states = [];
      w.input.setKey('ArrowUp', true);
      for (let i = 0; i < ramps.length; i++) {
        const c = w.camera.c, fx = c[15], fz = c[17];
        w.tick();
        const stick = RAMP_TABLE[ramps[i]] - 128;
        ok(walk.rampY === ramps[i] && walk.stickY === stick, `tick ${i + 1}: ramp ${walk.rampY} stick ${walk.stickY}, expected ${ramps[i]} / ${stick}`);
        // the speed factor of FUN_0042a654: |stick| / 128 times the horizontal part of the camera's forward vector, capped at 1 (zero inside the dead zone)
        const exp = Math.abs(stick) > 32 ? Math.min(1, (Math.abs(stick) / 128) * Math.hypot(fx, fz)) : 0;
        ok(near(walk.speed, exp, 1e-6), `tick ${i + 1}: speed ${walk.speed.toFixed(4)}, expected ${exp.toFixed(4)}`);
        states.push(walk.state);
        // direction: along the camera's forward vector (stick pushed up)
      }
      notes.push(`states while holding Up from rest: ${states.map((s) => '0x' + s.toString(16)).join(' ')}`);
      ok(states[0] === ST.IDLE && states[1] === ST.SNEAK && states[2] === ST.WALK && states[3] === ST.RUN, 'idle -> sneak -> walk -> run in the first four ticks');
      w.input.setKey('ArrowUp', false);
      // released: the ramp returns 4 per tick to the centre (16)
      const rs = [];
      for (let i = 0; i < 5; i++) { w.tick(); rs.push(walk.rampY); }
      ok(JSON.stringify(rs) === JSON.stringify([4, 8, 12, 16, 16]), `ramp after release ${rs}`);
      // opposite keys cancel (ramp goes down and up in the same tick: ends in a different place than either alone, no crash)
      // left / right move along the camera's right vector
      for (const [key, sign] of [['ArrowRight', 1], ['ArrowLeft', -1]]) {
        run(L, 20); // settle
        const c = w.camera.c; const rx = c[9], rz = c[11];
        const x0 = L.pepper.x, z0 = L.pepper.z;
        run(L, 6, [key]);
        const dx = L.pepper.x - x0, dz = L.pepper.z - z0;
        const along = (dx * rx + dz * rz) * sign;
        ok(along > 3, `${key}: moved ${along.toFixed(2)} along the camera's right vector`);
        ok(Math.abs(dx * rz - dz * rx) < 0.5 + 0.1 * Math.abs(along), `${key}: sideways drift ${(dx * rz - dz * rx).toFixed(2)}`);
      }
      // the walk speed is at most one unit per tick (speed factor <= 1, dt = 1)
      run(L, 20);
      let maxStep = 0;
      for (const k of ['ArrowUp']) { w.input.setKey(k, true); }
      let px = L.pepper.x, pz = L.pepper.z;
      for (let i = 0; i < 12; i++) { w.tick(); maxStep = Math.max(maxStep, Math.hypot(L.pepper.x - px, L.pepper.z - pz)); px = L.pepper.x; pz = L.pepper.z; }
      w.input.setKey('ArrowUp', false);
      ok(maxStep <= 1.0001, `a tick moves Pepper ${maxStep.toFixed(3)} units (the speed factor is capped at 1)`);
    }
    return { checked, failures, notes };
  },
};
