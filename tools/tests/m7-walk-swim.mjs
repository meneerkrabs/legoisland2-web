import { loadZone } from '../lib/engine-load.mjs';
import { createWalkHarness, CAM } from '../lib/m7-walk-emu.mjs';
import { makeScript, constScript } from '../lib/m7-walk-run.mjs';
import { SwimNode } from '../../src/game/swim.ts';
import { PC, V } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

// M7 / WP-VERIFY: swimming (sgswim, FUN_0088c740 with FUN_00422c7e / FUN_00422ddc / FUN_0043363c, run natively in the emulation) against the port's SwimNode (src/game/swim.ts):
// the dive clip, speed ramp, turning, the pad stick, the two sweeps against the coast, the sea loop, the camera, the sounds. Sync mode, tolerance 0.
export default {
  name: 'm7-walk-swim',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0, ticks = 0, scen = 0; const ev = { wrap: 0, blocked: 0, slide: 0, pad: 0, dive: 0, stroke: 0, sound: 0 };
    const fr = Math.fround;
    const run1 = (S) => {
      scen++;
      const L = loadZone(ctx, 'z02LGI', { pos: S.pos, yaw: S.yaw, subgame: S.subgame });
      const w = L.world; w.dt = S.dt; if (S.subgame !== undefined) w.vars.set(V.CURRENT_SUBGAME, S.subgame);
      const H = createWalkHarness(ctx, L, { zone: 'z02LGI' });
      const { E } = H, { cpu, mem } = E, rec = L.pepper;
      cpu.exec.push([0x88c700, 0x88cea0], [0x422000, 0x423000], [0x433000, 0x434000]); cpu.invalidate();
      const swim = new SwimNode(); swim.accessory = L.walk.accessory ?? null;
      rec.ctrl.nodes = [swim]; w.vars.set(V.PEPPER_CONTROL, PC.SWIM);
      rec.y = w.seaLevel;
      rec.ry = fr(rec.ry); rec.rebuildYaw();
      if (S.phase1) { rec.anim.start(0x41, 0); swim.phase = 2; swim.stamp = w.frame; swim.speed = fr(S.speed ?? 0); } else rec.anim.start(0x62, 0);
      S.setup?.(w, swim);
      const SW = E.alloc(0x40); H.fn = 0x88c740; H.nodeArg = SW;
      w.externalInput = true;
      const sounds = []; w.sfx = { play: (id) => sounds.push(id) };
      let prev = 0, nbad = 0, px0 = rec.x, pz0 = rec.z;
      for (let t = 0; t < S.held.length; t++) {
        const held = S.held[t], pressed = held & ~prev; prev = held;
        w.input.held = held; w.input.pressed = pressed; w.input.prevHeld = held;
        S.inject?.(t, w, L.walk, swim);
        H.push(held, pressed);
        mem.w32(SW + 8, swim.stamp >>> 0); mem.w8(SW + 0x18, swim.phase); mem.wf32(SW + 0x1c, swim.speed);
        let o;
        try { H.run(); o = H.pull(); } catch (e) { failures.push(`${S.name} tick ${t}: the original failed: ${e.message}`); return; }
        const op = { phase: mem.r8(SW + 0x18), speed: mem.f32(SW + 0x1c), accY: swim.accessory ? mem.f32(E.recPtr(swim.accessory) + 0x40) : 0 };
        sounds.length = 0; w.tick();
        const mine = H.portState();
        const mp = { phase: swim.phase, speed: swim.speed, accY: swim.accessory ? swim.accessory.y : 0 };
        ticks++;
        { const dx = o.rec.m[12] - px0, dz = o.rec.m[14] - pz0, d = Math.hypot(dx, dz), want = op.speed * w.dt; px0 = o.rec.m[12]; pz0 = o.rec.m[14];
          if (d > 100) ev.wrap++; else if (op.phase && want > 0.1 && d < 0.2 * want) ev.blocked++; else if (op.phase && want > 0.1 && d < 0.95 * want) ev.slide++;
          if (!op.phase) ev.dive++; if (S.name.includes('pad') && op.speed > 1) ev.pad++; ev.sound += o.sounds.length; if (o.sounds.length && op.phase) ev.stroke++; }
        const msgs = [];
        const eq = (n, a, b) => { checked++; if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) msgs.push(`${n}: original ${b}, port ${a}`); };
        eq('phase', mp.phase, op.phase); eq('speed', mp.speed, op.speed); eq('accessory.y', mp.accY, op.accY);
        for (let i = 0; i < 16; i++) eq(`rec.m${i}`, mine.rec.m[i], o.rec.m[i]);
        for (let i = 0; i < 3; i++) eq(`rec.e${i}`, mine.rec.e[i], o.rec.e[i]);
        eq('rec.flags', mine.rec.flags, o.rec.flags); eq('acc.flags', mine.accessoryFlags, o.accessoryFlags);
        if (!S.noCamera) { for (let i = 0; i < 18; i++) eq(`camera[${i}]`, mine.camera[i], o.camera[i]); }
        eq('anim.clip', mine.anim.clip, o.anim.clip); eq('anim.frame', mine.anim.frame, o.anim.frame);
        checked++; if (JSON.stringify(sounds) !== JSON.stringify(o.sounds)) msgs.push(`sounds: original ${JSON.stringify(o.sounds)}, port ${JSON.stringify(sounds)}`);
        if (msgs.length) { nbad++; if (nbad <= 2) failures.push(`${S.name} tick ${t} (held 0x${held.toString(16)}): ${msgs.slice(0, 6).join(' | ')}${msgs.length > 6 ? ` (+${msgs.length - 6})` : ''}`); if (nbad > 2) break; }
      }
    };
    const L0 = loadZone(ctx, 'z02LGI'); const sea = L0.world.seaLevel;
    notes.push(`sea level ${sea}`);
    const UP = [[B.UP, 40], [B.UP | B.LEFT, 12], [B.UP | B.RIGHT, 12], [B.LEFT, 6], [B.RIGHT, 6], [0, 20]];
    const script = (seed, n, dir = UP) => makeScript(seed, n, { dir, jump: 0, camera: false });
    // the coast: from the island's centre outwards in 16 directions to the first sea point; Pepper starts 14 units out, facing the island
    const coast = [];
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, dx = Math.cos(a), dz = Math.sin(a);
      for (let d = 20; d < 900; d += 2) { const x = dx * d, z = dz * d; if (L0.world.col.terrainHeight(x, 80, z, 0) < sea - 1) { coast.push({ x: x + dx * 14, z: z + dz * 14, yaw: Math.atan2(-dx, -dz) }); break; } }
    }
    notes.push(`coast starts found: ${coast.length}`);
    for (const dt of [1, 0.5]) {
      run1({ name: 'swim: dive then random strokes', dt, pos: [700, sea, 0], yaw: 1.2, held: script(7, dt === 1 ? 260 : 340) });
      for (const [i, c] of coast.entries()) if (i % 3 === 0 || dt === 1 && i % 2 === 0) run1({ name: `swim: coast ${i} into the island`, dt, phase1: true, speed: 0.4, pos: [c.x, sea, c.z], yaw: c.yaw, held: script(20 + i, dt === 1 ? 120 : 180, [[B.UP, 60], [B.UP | B.LEFT, 8], [B.UP | B.RIGHT, 8], [0, 10]]) });
      // the sea loop (FUN_0043363c) in every sub-game variant, and the camera's own wrap at +-1840
      for (const [sg, edge] of [[0, 1040], [6, 880], [10, 1840], [0x16, 1840]]) for (const [px, pz, yaw] of [[edge, 0, Math.PI / 2], [-edge, 20.5, -Math.PI / 2], [30.25, edge, 0], [-12.5, -edge, Math.PI]])
        run1({ name: `swim: sea loop edge ${edge} sub-game 0x${sg.toString(16)} from ${px},${pz}`, dt, phase1: true, speed: 0.8, subgame: sg, pos: [px - Math.sign(px) * 4, sea, pz - Math.sign(pz) * 4], yaw, held: constScript([[B.UP, dt === 1 ? 40 : 70]]) });
      // the pad stick, the camera presets, the vehicle flag, a stale stamp (the dive restarts)
      run1({ name: 'swim: pad stick sweep', dt, phase1: true, speed: 0.3, pos: [700, sea, 0], yaw: 0.3, held: new Array(220).fill(0), inject: (t, w, walk, swim) => { const k = Math.floor(t / 20) % 11; walk.padX = swim.padX = [0, 25, -25, 60, -90, 127, -128, 18, 0, -21, 40][k]; walk.padY = swim.padY = [0, -25, -60, -127, 0, -21, -19, 30, -128, -40, 0][(k * 3) % 11]; } });
      for (let p = 0; p < 6; p++) run1({ name: `swim: camera preset ${p}`, dt, phase1: true, speed: 0.5, pos: [700, sea, 0], yaw: 0.9, held: script(40 + p, 100), setup: (w) => { w.camera.preset = p; w.camera.vehicle = p % 2 === 1; } });
      run1({ name: 'swim: resume with a stale stamp', dt, phase1: true, speed: 0.5, pos: [700, sea, 0], yaw: 0.9, held: script(55, 60), inject: (t, w, walk, swim) => { if (t === 0) swim.stamp = 99; } });
    }
    return { checked, failures, notes: [`events (original): ${JSON.stringify(ev)}`, `scenarios ${scen}, ticks ${ticks}, checks ${checked}`, ...notes] };
  },
};
