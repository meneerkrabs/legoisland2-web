import { loadZone, run, press } from '../lib/engine-load.mjs';
import { ST } from '../../src/game/walk.ts';
import { NO_GROUND } from '../../src/game/collision.ts';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';

// Pepper's walk (SGwalk), scenarios run on the real island / house data (src/game/walk.ts, swim.ts, camera.ts).
export default {
  name: 'engine-walk',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (n) => '0x' + n.toString(16);

    // ============================================================ the island
    {
      const L = loadZone(ctx, 'z02LGI');
      const w = L.world, p = L.pepper, walk = L.walk;
      const ground = (x, z) => w.col.terrainHeight(x, p.y + 20, z, 0);
      run(L, 10);
      ok(walk.state === ST.IDLE, `island start: idle (${hex(walk.state)})`);
      ok(Math.abs(p.y - ground(p.x, p.z)) < 0.5, `standing on the ground: y ${p.y.toFixed(2)} vs ground ${ground(p.x, p.z).toFixed(2)}`);
      // --- jump: arc y = y0 + (v0 + g t) t + g t^2 / 2, t += 0.1 per tick (v0 = 15, g = -10): apex 3.75 after 5 ticks, back on the ground after 10
      const y0 = p.y;
      press(L, 'AltLeft');   // idle -> JUMPSTART (clip 2, 9 frames)
      ok(walk.state === ST.JUMPSTART, `Alt from idle starts the jump-start clip (${hex(walk.state)})`);
      let n = 0; while (walk.state === ST.JUMPSTART && n++ < 30) w.tick();
      ok(walk.state === ST.JUMP, `after the jump-start clip: jump (${hex(walk.state)}) in ${n} ticks`);
      const ys = [];
      const yStart = p.y; let air = 0;
      while (walk.state === ST.JUMP && air++ < 40) { w.tick(); ys.push(p.y - yStart); }
      const apex = Math.max(...ys);
      notes.push(`jump from ${yStart.toFixed(2)}: ${air} ticks in the air, apex +${apex.toFixed(2)}, ys ${ys.slice(0, 11).map((v) => v.toFixed(2)).join(' ')}`);
      ok(Math.abs(apex - 3.75) < 0.2, `jump apex ${apex.toFixed(2)} (formula: 3.75)`);
      ok(air >= 9 && air <= 12, `${air} ticks in the air (formula: 10)`);
      ok(walk.state === ST.LANDING, `landing state after the jump (${hex(walk.state)})`);
      run(L, 40);
      ok(walk.state === ST.IDLE && Math.abs(p.y - y0) < 0.5, `back to idle on the ground (${hex(walk.state)}, y ${p.y.toFixed(2)} vs ${y0.toFixed(2)})`);
      // --- double jump: Alt again in the air restarts the arc with v0 = 17.5
      press(L, 'AltLeft'); n = 0; while (walk.state === ST.JUMPSTART && n++ < 30) w.tick();
      run(L, 3); const yA = p.y; press(L, 'AltLeft');
      ok(walk.state === ST.JUMP2, `Alt in the air: double jump (${hex(walk.state)})`);
      let apex2 = p.y; for (let i = 0; i < 25 && walk.state === ST.JUMP2; i++) { w.tick(); apex2 = Math.max(apex2, p.y); }
      ok(apex2 > yA + 4, `double jump rises above ${(yA + 4).toFixed(1)} (apex ${apex2.toFixed(2)})`);
      run(L, 60);
      ok(walk.state === ST.IDLE, `idle after the double jump (${hex(walk.state)})`);
      // --- footsteps: running on road / grass plays the walk sounds of the surface under the feet
      const sounds = [];
      w.sfx = { play(id) { sounds.push([w.tickCount, id]); } };
      run(L, 40, ['ArrowUp']);
      const ids = new Set(sounds.map((s) => s[1]));
      ok(sounds.length >= 3, `${sounds.length} footstep sounds in 40 ticks of running`);
      ok([...ids].every((id) => (id >= 263 && id <= 292) || (id >= 391 && id <= 396) || id === 302), `sound ids ${[...ids]} are walk / landing / jump sounds`);
      notes.push(`footsteps: ${sounds.length} sounds in 40 ticks, ids ${[...ids].sort((a, b) => a - b).join(',')}, ticks ${sounds.map((s) => s[0]).join(',')}`);
      w.sfx = null;
    }
    // --- ground following over many runs from many places (PATH waypoint nodes of the island, 4 directions): never under the ground, never faster than one unit per tick, the camera stays above the terrain
    {
      const wp = parseCompiledWaypoints(ctx.archives.find((a) => a.name === 'z02LGI').read('Waypoints/W_PATH_C.wpt'));
      let runs = 0, clean = 0, below = 0, camBelow = 0, over = 0, minCam = 1e9, maxCam = 0, bigSteps = 0;
      for (let ni = 5; ni < wp.nodes.length; ni += 23) {
        const nd = wp.nodes[ni];
        if (nd.y > 60) continue;
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const L = loadZone(ctx, 'z02LGI', { pos: [nd.x, nd.y + 0.5, nd.z], yaw });
          const w = L.world, p = L.pepper, walk = L.walk;
          const ground = (x, z) => w.col.terrainHeight(x, p.y, z, 4);
          run(L, 12);
          let lastY = p.y, lx = p.x, lz = p.z, big = false;
          run(L, 120, ['ArrowUp'], () => {
            if (Math.abs(p.y - lastY) > 4.01) big = true; lastY = p.y;
            if (Math.hypot(p.x - lx, p.z - lz) > 1.0001) over++; lx = p.x; lz = p.z;
            if (walk.state === ST.RUN || walk.state === ST.WALK || walk.state === ST.IDLE) { const g = ground(p.x, p.z); if (g > NO_GROUND / 2 && p.y < g - 2.5 && !w.pep.onObject) below++; }
            const c = w.camera.c, d = Math.hypot(c[0] - p.x, c[2] - p.z);
            minCam = Math.min(minCam, d); maxCam = Math.max(maxCam, d);
            const cg = w.col.terrainHeight(c[0], c[1], c[2], 8); if (cg > NO_GROUND / 2 && c[1] < cg + 0.3) camBelow++;
          });
          runs++; if (big) bigSteps++; else clean++;
        }
      }
      notes.push(`ground following: ${runs} runs of 120 ticks from PATH nodes, ${bigSteps} with a step above 4 units (cliffs), camera distance ${minCam.toFixed(1)}..${maxCam.toFixed(1)}`);
      ok(runs >= 40, `${runs} runs`);
      ok(below === 0, `Pepper was more than 2.5 units below the terrain ray in ${below} ticks`);
      ok(over === 0, `${over} ticks moved more than one unit`);
      // (the camera only has height logic, no horizontal pull-in: the original lets it sit inside a hill behind a wall (its wall push, FUN_004229a0, is compiled out))
      notes.push(`the camera eye was below the terrain surface in ${camBelow} of ${runs * 120} ticks`);
      ok(minCam > 11.5 && maxCam < 29.5, `camera distance ${minCam.toFixed(1)}..${maxCam.toFixed(1)} outside 12..28`);
      ok(bigSteps <= runs * 0.15, `${bigSteps} of ${runs} runs had a height step above 4 units in one tick`);
    }
    // --- ledge: running off a drop makes Pepper jump / fall and land lower; no tunnelling through the ground
    {
      const L = loadZone(ctx, 'z02LGI');
      const w = L.world, p = L.pepper, walk = L.walk;
      const hgt = (x, z) => w.col.terrainHeight(x, 200, z, 0);
      // find a cliff edge by scanning: neighbouring samples 1 unit apart that drop by more than 5 on dry land
      let spot = null;
      for (let ix = -450; ix < 450 && !spot; ix += 7) for (let iz = -450; iz < 450 && !spot; iz += 7) {
        const a = hgt(ix, iz), b = hgt(ix + 1.5, iz);
        if (a > 8 && b > 3 && a - b > 5 && a - b < 25 && hgt(ix - 8, iz) > a - 1.5 && Math.abs(hgt(ix - 8, iz) - hgt(ix - 16, iz)) < 1) spot = [ix, a, iz, a - b];
      }
      ok(!!spot, 'found a cliff edge on the island');
      if (spot) {
        // start 12 units before the edge (towards -x), face +x with the Right key (camera looks +z by default after the yaw reset)
        const L2 = loadZone(ctx, 'z02LGI', { pos: [spot[0] - 12, spot[1] + 0.2, spot[2]], yaw: Math.PI / 2 });
        const w2 = L2.world, p2 = L2.pepper, wk = L2.walk;
        run(L2, 15);
        const seen = new Set(); let minAbove = 1e9; const y0 = p2.y;
        run(L2, 120, ['ArrowRight'], () => { seen.add(wk.state); const g = w2.col.terrainHeight(p2.x, p2.y + 10, p2.z, 0); if (g > NO_GROUND / 2) minAbove = Math.min(minAbove, p2.y - g); });
        notes.push(`cliff at ${spot.slice(0, 3).map((v) => v.toFixed(0))} (drop ${spot[3].toFixed(1)}): states ${[...seen].map(hex)}, y ${y0.toFixed(1)} -> ${p2.y.toFixed(1)}, x ${p2.x.toFixed(1)}`);
        ok(seen.has(ST.JUMP) || seen.has(ST.TEETER) || p2.x < spot[0] + 1, 'at the cliff Pepper jumps off or teeters (or is blocked)');
        ok(minAbove > -1.5, `Pepper went ${(-minAbove).toFixed(2)} below the ground`);
      }
      void w; void p; void walk;
    }
    // --- the sea: walk off the beach into the water, swim, come back
    {
      // the land ends at the shore (the terrain ray finds nothing beyond it): east of the island centre around x = 480, z = -90
      const L = loadZone(ctx, 'z02LGI', { pos: [430, 80, -90], yaw: Math.PI / 2 });
      const w = L.world, p = L.pepper, walk = L.walk;
      p.y = w.col.terrainHeight(430, 200, -90, 0) + 0.2;
      run(L, 15);
      ok(Math.abs(p.y - w.col.terrainHeight(p.x, p.y + 20, p.z, 0)) < 1, `on the ground before the beach (y ${p.y.toFixed(2)})`);
      let swimTick = -1; const modes = new Set(); let ySea = true;
      run(L, 200, ['ArrowUp'], (i) => { const m = w.vars.get(0x5e) & 0xfff; modes.add(m); if (m === 2) { if (swimTick < 0) swimTick = i; if (Math.abs(p.y - 2.4) > 1e-6) ySea = false; } });
      notes.push(`beach east: swim mode entered after ${swimTick} ticks, pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)}, clip ${p.anim.clip}`);
      ok(swimTick >= 0 && modes.has(2), 'walking into the water switches to the swim mode (PEPPER_CONTROL 2)');
      ok(ySea, 'while swimming Pepper stays at the sea level');
      ok(p.anim.clip === 9 || p.anim.clip === 0x41 || p.anim.clip === 0x62, `swimming animation (clip ${p.anim.clip})`);
      const xFar = p.x;
      ok(xFar > 475, `swam out to x ${xFar.toFixed(1)}`);
      // turn around (Left turns 5 degrees per tick) and swim back to the beach
      run(L, 36, ['ArrowLeft']);
      let outState = false; const m2 = new Set();
      run(L, 300, ['ArrowUp'], () => { m2.add(w.vars.get(0x5e) & 0xfff); if (walk.state === ST.OUTOFWATER) outState = true; });
      notes.push(`swimming back: modes ${[...m2]}, out-of-water state seen ${outState}, pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)}`);
      ok(outState, 'reaching the shore switches back to walking with the out-of-water state (0x25)');
      ok((w.vars.get(0x5e) & 0xfff) === 1 && p.y > 2.4, `walking again on the beach (mode ${w.vars.get(0x5e)}, y ${p.y.toFixed(2)})`);
    }
    // --- the sea is a loop: swimming past x = 1056 puts Pepper (and the camera) at the opposite edge (FUN_0043363c)
    {
      const L = loadZone(ctx, 'z02LGI', { pos: [1030, 1.5, -90], yaw: Math.PI / 2 });
      const w = L.world, p = L.pepper;
      run(L, 10);
      ok((w.vars.get(0x5e) & 0xfff) === 2, `far out in the sea Pepper swims (mode ${w.vars.get(0x5e)})`);
      let wrapped = false, camJump = false, lx = p.x;
      run(L, 120, ['ArrowUp'], () => { if (p.x < lx - 1000) { wrapped = true; const c = w.camera.c; if (Math.hypot(c[0] - p.x, c[2] - p.z) > 40) camJump = true; } lx = p.x; });
      notes.push(`sea loop: wrapped ${wrapped}, final x ${p.x.toFixed(1)} z ${p.z.toFixed(1)}`);
      ok(wrapped && p.x < -900 && Math.abs(p.z) < 2, 'swimming east past 1056 wraps to the west edge (x = -1040, z = 0)');
      ok(!camJump, 'the camera moves with Pepper across the wrap');
    }
    // ============================================================ Pepper's house
    {
      const L = loadZone(ctx, 'z03PPH');
      const w = L.world, p = L.pepper, walk = L.walk;
      run(L, 10);
      ok(Math.abs(p.y - 0.33) < 0.1, `house floor height ${p.y.toFixed(2)}`);
      // jumping is disabled in the house (sub-game 3)
      press(L, 'AltLeft'); run(L, 20);
      ok(walk.state === ST.IDLE, `Alt does nothing in the house (state ${hex(walk.state)})`);
      // walk in 16 directions: Pepper stays inside the room
      // the room: the box of the interior collision mesh (INTE)
      const inte = w.records.find((r) => r.name === 'INTE').colObj.col;
      const bounds = { x: [inte.center[0] - inte.halfExtents[0] - 0.5, inte.center[0] + inte.halfExtents[0] + 0.5], z: [inte.center[2] - inte.halfExtents[2] - 0.5, inte.center[2] + inte.halfExtents[2] + 0.5] };
      let outside = 0, stopped = 0, total = 0;
      const dirs = [['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight'], ['ArrowUp', 'ArrowLeft'], ['ArrowUp', 'ArrowRight'], ['ArrowDown', 'ArrowLeft'], ['ArrowDown', 'ArrowRight']];
      for (const keys of dirs) {
        const L2 = loadZone(ctx, 'z03PPH'); const p2 = L2.pepper;
        run(L2, 10);
        let moved = 0, px = p2.x, pz = p2.z;
        run(L2, 200, keys, () => { moved += Math.hypot(p2.x - px, p2.z - pz); px = p2.x; pz = p2.z; if (p2.x < bounds.x[0] || p2.x > bounds.x[1] || p2.z < bounds.z[0] || p2.z > bounds.z[1]) outside++; total++; });
        // after 200 ticks of running into the walls Pepper rests against something: the last 20 ticks barely move
        let tail = 0; px = p2.x; pz = p2.z;
        run(L2, 20, keys, () => { tail += Math.hypot(p2.x - px, p2.z - pz); px = p2.x; pz = p2.z; });
        if (tail < 5) stopped++;
        ok(moved > 3, `${keys.join('+')}: Pepper moved ${moved.toFixed(1)}`);
      }
      notes.push(`house: 8 directions x 200 ticks: ${outside} ticks outside the room bounds, ${stopped} of 8 runs ended pressed against a wall or furniture`);
      ok(outside === 0, `${outside} ticks outside the room`);
      ok(stopped >= 6, `only ${stopped} of 8 diagonal / straight runs ended against an obstacle`);
      // wall sliding: up + left runs along the north wall to the north-west corner
      const L3 = loadZone(ctx, 'z03PPH'); const p3 = L3.pepper;
      run(L3, 10); run(L3, 150, ['ArrowUp', 'ArrowLeft']);
      notes.push(`up+left ends at ${p3.x.toFixed(2)},${p3.z.toFixed(2)}`);
      ok(p3.x < -5 && p3.z > 8, `up+left slides to the north-west corner (${p3.x.toFixed(1)}, ${p3.z.toFixed(1)})`);
      void w; void walk; void p;
    }
    return { checked, failures, notes };
  },
};
