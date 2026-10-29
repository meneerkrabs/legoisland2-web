// Helpers of the M4 headless browser bots (tools/steps/m4-*.mjs): state, cutscene skipping, teleporting Pepper next to a record, real key presses.
export function island({ page, wait, log, shot }) {
  const S = {};
  S.state = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const p = z.loaded.pepper, v = z.sh.vars;
    return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), yaw: +p.ry.toFixed(2), node: v.get(0x58), ctrl: v.get(0x5e), cs: !!z.game?.debug?.().cutscene,
      pizzas: v.get(0xb0), bricks: v.get(0x4f), pages: v.get(0xa5), heads: v.get(0x52), phase: v.get(0xad), s277: v.get(0x115), s303: v.get(0x12f), sub: v.get(0x59), next: v.get(5) };
  });
  S.until = async (fn, ms = 60000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(step); } return false; };
  S.waitIsland = async () => { await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2), null, { timeout: 300000 }); };
  S.start = async () => { await S.waitIsland(); if ((await S.state()).mode === 1) await page.keyboard.press('ArrowLeft'); await S.until(async () => (await S.state()).mode === 2, 5000); };
  /** hold Shift taps (the cutscene skip) until no script runs; returns the number of taps */
  S.skipCutscenes = async (max = 80) => { let n = 0; for (; n < max; n++) { const s = await S.state(); if (!s || !s.cs) { await wait(250); if (!(await S.state())?.cs) break; continue; } await tap('ShiftLeft', 60); await wait(120); } return n; };
  const tap = async (k, ms = 80) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };
  S.tap = tap;
  S.hold = async (k, ms) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };
  /** put Pepper `dist` units from the record (on the side towards where it is), facing it, camera behind */
  S.teleportNear = (name, dist = 5, ang = 0) => page.evaluate(([n, d, a]) => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper;
    const r = w.records.find((x) => x.name === n);
    if (!r) return null;
    const px = r.x + Math.sin(a) * d, pz = r.z + Math.cos(a) * d;
    p.x = px; p.z = pz; p.y = r.y + 1;
    const g = w.col.groundRay(px, r.y + 20, pz); if (g > -1e30) p.y = g;
    p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    return [r.x, r.y, r.z].map((x) => +x.toFixed(1));
  }, [name, dist, ang]);
  S.rec = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), z: +r.z.toFixed(1), en: r.enabled } : null; }, name);
  S.vars = (list) => page.evaluate((l) => Object.fromEntries(l.map((i) => [i, window.__zone.sh.vars.get(i)])), list);
  S.setVar = (i, v) => page.evaluate(([i, v]) => window.__zone.sh.vars.set(i, v), [i, v]);
  S.debug = () => page.evaluate(() => window.__zone.game.debug());
  return S;
}

/** stand in the way of a record that drives along a road (the speeder cars): Pepper `ahead` units in front of its direction of travel */
export async function blockRoad(S, page, wait, name, ahead = 24) {
  const a = await S.rec(name); await wait(300); const b = await S.rec(name);
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  await page.evaluate(([n, x, z]) => {
    const zz = window.__zone, w = zz.world, p = zz.loaded.pepper;
    p.x = x; p.z = z; const g = w.col.groundRay(x, 80, z); p.y = g > -1e30 ? g : p.y;
    p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  }, [name, b.x + dx / l * ahead, b.z + dz / l * ahead]);
}

/** PATH map (FUN_00462be9(1, n)) position of node n */
export const pathNode = (page, n) => page.evaluate((i) => { const p = window.__zone.game.ictx.pathPos(i); return p ? [...p] : null; }, n);
/** put Pepper at (x, z) on the ground facing (fx, fz), camera behind */
export const teleportTo = (page, x, z, fx, fz) => page.evaluate(([x, z, fx, fz]) => {
  const zz = window.__zone, w = zz.world, p = zz.loaded.pepper;
  p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g;
  p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
}, [x, z, fx, fz]);
