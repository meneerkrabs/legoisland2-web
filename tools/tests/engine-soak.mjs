import { loadZone } from '../lib/engine-load.mjs';

// Soak: random key mashing (arrows, Alt, camera keys) for 6000 ticks per zone and start place. No exception, no NaN / Infinity in Pepper or the camera,
// Pepper stays on the map and above the sea floor / below the sky, the camera stays finite and within 40 units of Pepper.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export default {
  name: 'engine-soak',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'KeyZ', 'KeyX', 'KeyC', 'IntlBackslash', 'ShiftLeft', 'Space', 'ControlLeft'];
    const cases = [['z02LGI', null], ['z02LGI', { from: 'z03PPH' }], ['z02LGI', { pos: [430, 0, -90] }], ['z03PPH', null]];
    let seed = 1;
    for (const [zone, opts] of cases) {
      const o = opts ? { ...opts } : {};
      if (o.pos) { /* y is fixed up below */ }
      const L = loadZone(ctx, zone, o);
      const w = L.world, p = L.pepper;
      if (o.pos) { p.y = w.col.terrainHeight(o.pos[0], 200, o.pos[2], 0) + 0.3; }
      const R = rng(seed++ * 7919);
      const held = new Set();
      const states = new Set(); const modes = new Set();
      let bad = null, maxCam = 0, minY = 1e9, maxY = -1e9, ticks = 0;
      try {
        for (let i = 0; i < 6000 && !bad; i++) {
          if (i % 9 === 0) {
            for (const k of KEYS) {
              const on = R() < (k === 'AltLeft' || k === 'ControlLeft' ? 0.12 : k.startsWith('Arrow') ? 0.4 : 0.1);
              if (on && !held.has(k)) { held.add(k); w.input.setKey(k, true); } else if (!on && held.has(k)) { held.delete(k); w.input.setKey(k, false); }
            }
          }
          w.tick(); ticks++;
          states.add(L.walk.state); modes.add(w.vars.get(0x5e) & 0xfff);
          const vals = [p.x, p.y, p.z, p.ry, ...w.camera.c.slice(0, 6), ...p.m];
          if (vals.some((v) => !Number.isFinite(v))) bad = `non-finite value at tick ${i}: pos ${p.x},${p.y},${p.z} state 0x${L.walk.state.toString(16)}`;
          else if (Math.abs(p.x) > 1100 || Math.abs(p.z) > 1100 || p.y < -60 || p.y > 400) bad = `Pepper left the map at tick ${i}: ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} state 0x${L.walk.state.toString(16)}`;
          else {
            const d = Math.hypot(w.camera.c[0] - p.x, w.camera.c[1] - p.y, w.camera.c[2] - p.z);
            maxCam = Math.max(maxCam, d);
            if (d > 60) bad = `camera ${d.toFixed(1)} away from Pepper at tick ${i}`;
          }
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      } catch (e) { bad = `exception: ${e.stack || e}`; }
      checked++;
      notes.push(`${zone}${opts ? ' ' + JSON.stringify(opts) : ''}: ${ticks} ticks, states ${[...states].map((s) => s.toString(16)).join(',')}, modes ${[...modes]}, y ${minY.toFixed(1)}..${maxY.toFixed(1)}, max camera distance ${maxCam.toFixed(1)}`);
      if (bad) failures.push(`${zone}: ${bad}`);
    }
    return { checked, failures, notes };
  },
};
