// Helpers of the castle bots (tools/steps/m5-z07CSI-*.mjs): the hub helpers of lib-hub.mjs plus steering the speedboat with REAL keys (Space = forward, Alt = reverse, Left / Right turn,
// Ctrl at the dock steps off), the castle's variables, positions of records and PATH nodes. Everything the bots press goes through page.keyboard (the game's own input mapper).
import { hub, hubUrl } from './lib-hub.mjs';

export const PORT = process.env.CSI_PORT ?? '5518';
export const BASE = process.env.BASE ?? `http://localhost:${PORT}`;
export const url = (node, extra = {}) => hubUrl('z07CSI', node, extra, BASE);

export const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function csi(h) {
  const { page, wait, log, shot } = h;
  const S = hub(h, 'z07CSI');
  const held = new Set();
  page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver/.test(m.text()))) log('CONSOLE', m.type(), m.text().slice(0, 400)); });
  /** hold exactly the keys in `want` */
  S.keys = async (want = []) => {
    const w = new Set(want);
    for (const k of [...held]) if (!w.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of w) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  S.release = () => S.keys([]);
  /** the vehicle Pepper sits in (the island's vehicle globals): name, position, heading, PEPPER_CONTROL; null when none */
  S.veh = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const g = z.world.ext.get('island.vehicles'), c = g?.current, v = z.sh.vars, p = z.loaded.pepper;
    return { name: c ? c.name : null, x: c ? c.x : p.x, y: c ? c.y : p.y, z: c ? c.z : p.z, ry: c ? c.ry : p.ry, ctrl: v.get(0x5e), tick: z.world.tickCount, next: v.get(5), node: v.get(0x58), arch: z.info.archive, cs: z.game?.debug?.().cutscene ?? false,
      px: p.x, py: p.y, pz: p.z, pry: p.ry, stage: v.get(0x56), icons: v.get(0xc) };
  });
  /** a record's position / flags */
  S.at = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? [r.x, r.y, r.z] : null; }, name);
  /** the loop's state plus the castle's own */
  S.csi = () => page.evaluate(() => { const g = window.__zone?.game?.debug?.(); return g ? { node: g.node, prev: g.prev, texts: g.texts, objective: g.objective, cutscene: g.cutscene, story: g.storyLog } : null; });
  /** Steer the boat (or Pepper's heading) to (tx, tz) with Left / Right / Space until `done(state, dist, ang)` is true or `maxMs` passed. */
  S.sailTo = async (tx, tz, { done = (s, d) => d < 30, maxMs = 120000, slow = 0, turnOnly = 0.5 } = {}) => {
    // (`maxMs` is game time, 30 ticks a second: a loaded page runs fewer ticks per second of wall time, so the limit is counted in ticks, with a wall-clock ceiling of 20 minutes)
    const t0 = Date.now(), maxTicks = (maxMs * 30) / 1000;
    let s = null, tick0 = -1;
    while (Date.now() - t0 < 1200000) {
      s = await S.veh();
      if (!s || s.arch !== 'z07CSI') break;
      if (tick0 < 0) tick0 = s.tick;
      if (s.tick - tick0 > maxTicks) break;
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz), ang = wrap(Math.atan2(dx, dz) - s.ry);
      if (await done(s, d, ang)) break;
      const k = [];
      if (ang > 0.08) k.push('ArrowRight'); else if (ang < -0.08) k.push('ArrowLeft');
      if (Math.abs(ang) < turnOnly && !(slow && d < slow)) k.push('Space');
      await S.keys(k);
      await wait(40);
    }
    await S.release();
    return s;
  };
  /** final approach of the boat: short pulses (the boat keeps its momentum; a loaded page overshoots with held keys): turn by pulses, Space pulse when roughly facing, Alt pulse when the target is behind; until within `r` */
  S.dockApproach = async (tx, tz, { r = 16, maxIter = 120 } = {}) => {
    let s = null;
    for (let i = 0; i < maxIter; i++) {
      s = await S.veh();
      if (!s || s.arch !== 'z07CSI') break;
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz), ang = wrap(Math.atan2(dx, dz) - s.ry);
      if (d < r) break;
      if (Math.abs(ang) > 2.2) await S.tap('AltLeft', 70);
      else if (Math.abs(ang) > 0.15) await S.tap(ang > 0 ? 'ArrowRight' : 'ArrowLeft', 70);
      else await S.tap('Space', 70);
      await wait(150);
    }
    return s;
  };
  /** Pepper: place, yaw, control, current clip, cutscene */
  S.pep = () => page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; return { x: p.x, y: p.y, z: p.z, ry: p.ry, ctrl: z.sh.vars.get(0x5e), clip: p.anim?.clip ?? -1, cs: !!z.game?.debug?.().cutscene, node: z.sh.vars.get(0x58), tick: z.world.tickCount, arch: z.info.archive }; });
  /**
   * walk to (x, z) with the arrow keys: Up held, Left / Right pressed while the heading is off by more than `tolAng` (forward = (sin ry, cos ry), Right increases the yaw); stops within `tol` units
   * or after `maxTicks` game ticks. Returns { ok, d, ticks }. `stop(p)` is polled (a cutscene / node change ends it early).
   */
  S.walkTo = async (x, z, { tol = 6, maxTicks = 1500, tolAng = 0.2, stop = null } = {}) => {
    const t0 = (await S.pep()).tick;
    let up = false, left = false, right = false, last = null, stuck = 0, res = null;
    const set = async (key, want, cur) => { if (want && !cur) await page.keyboard.down(key); if (!want && cur) await page.keyboard.up(key); return want; };
    let tickSeen = -1, tickAt = Date.now();
    for (;;) {
      const p = await S.pep();
      if (p.tick !== tickSeen) { tickSeen = p.tick; tickAt = Date.now(); }
      else if (Date.now() - tickAt > 8000 && (await page.evaluate(() => window.__zone?.machine?.mode === 3)) && (S._unpaused = (S._unpaused ?? 0) + 1) <= 3) {
        // the pause menu opened by itself (nobody pressed Esc: in a headless run an unlock of the pointer is taken for the Esc key, see lib-story.mjs armReloadGuard): resume like a player
        log('  the game is paused (mode 3) and nobody paused it: Esc resumes (', S._unpaused, ')'); await page.keyboard.press('Escape', { delay: 70 }); tickAt = Date.now();
      } else if (Date.now() - tickAt > 8000) { log('  WATCHDOG: the game stopped ticking', JSON.stringify(p), JSON.stringify(await page.evaluate(() => { const z = window.__zone; return { mode: z.machine?.mode, hidden: document.hidden, vis: document.visibilityState, raf: performance.now(), dbg: JSON.stringify(z.game?.debug?.() ?? null).slice(0, 600) }; }))); res = { ok: false, d: -1, frozen: true, ticks: 0 }; break; }
      if (p.arch !== 'z07CSI') { res = { ok: false, d: -1, ticks: 0, left: p.arch }; break; }
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d <= tol) { res = { ok: true, d, ticks: p.tick - t0 }; break; }
      if (p.tick - t0 > maxTicks) { res = { ok: false, d, ticks: p.tick - t0 }; break; }
      if (stop && (await stop(p))) { res = { ok: false, d, ticks: p.tick - t0, stopped: true }; break; }
      if (p.cs) { up = await set('ArrowUp', false, up); left = await set('ArrowLeft', false, left); right = await set('ArrowRight', false, right); await wait(80); continue; }
      const err = wrap(Math.atan2(dx, dz) - p.ry);
      const turn = Math.abs(err) > tolAng ? Math.sign(err) : 0;
      right = await set('ArrowRight', turn > 0, right);
      left = await set('ArrowLeft', turn < 0, left);
      up = await set('ArrowUp', true, up);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.05 && p.tick - last.tick > 20) stuck++; else if (last && p.tick - last.tick > 20) stuck = 0;
      if (!last || p.tick - last.tick > 20) last = p;
      if (stuck > 6) { res = { ok: false, d, ticks: p.tick - t0, stuck: true }; break; }
      await wait(20);
    }
    await set('ArrowUp', false, up); await set('ArrowLeft', false, left); await set('ArrowRight', false, right);
    return res;
  };
  /**
   * The sea around the island as a grid (one cell = `cell` units over [-lim, lim]^2): water where the terrain below is not above the sea level (or there is no ground at all), asked of the
   * game's own collision world. Returns { cell, lim, n, water: Uint8Array } (row = z, column = x).
   */
  S.waterGrid = (cell = 20, lim = 520) => page.evaluate(([cell, lim]) => {
    const w = window.__zone.world, n = Math.floor((2 * lim) / cell) + 1, out = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -lim + i * cell, z = -lim + j * cell;
      const h = w.col.terrainHeight(x, 100, z, 0);
      out[j * n + i] = h > -1e30 && h > w.seaLevel - 0.5 ? 0 : 1;
    }
    return { cell, lim, n, water: out };
  }, [cell, lim]);
  /** a route over the water from (x0, z0) to (x1, z1): BFS over the cells with `clear` cells of water around them, then thinned by line of sight; returns [[x, z], ...] */
  S.sailPlan = async (x0, z0, x1, z1, { cell = 20, lim = 520, clear = 2 } = {}) => {
    const g = await S.waterGrid(cell, lim), n = g.n;
    const ok = (i, j) => { for (let dj = -clear; dj <= clear; dj++) for (let di = -clear; di <= clear; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue; if (!g.water[b * n + a]) return false; } return true; };
    const cellOf = (x, z) => [Math.round((x + lim) / cell), Math.round((z + lim) / cell)];
    // the start (a boat at the dock) and the target (the dock / the portal) lie at the shore: take the nearest cells with clearance
    const nearest = ([ci, cj]) => { let b = null; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (ok(i, j)) { const d = Math.hypot(i - ci, j - cj); if (!b || d < b.d) b = { i, j, d }; } return b; };
    const sB = nearest(cellOf(x0, z0)), tB = nearest(cellOf(x1, z1));
    const si = sB.i, sj = sB.j, ti = tB.i, tj = tB.j;
    const prev = new Map(), q = [[si, sj]]; prev.set(sj * n + si, -1);
    while (q.length) {
      const [i, j] = q.shift();
      if (i === ti && j === tj) break;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n || prev.has(b * n + a) || !ok(a, b)) continue;
        prev.set(b * n + a, j * n + i); q.push([a, b]);
      }
    }
    if (!prev.has(tj * n + ti)) return null;
    const path = [];
    for (let k = tj * n + ti; k !== -1; k = prev.get(k)) path.push([-lim + (k % n) * cell, -lim + Math.floor(k / n) * cell]);
    path.reverse();
    // line of sight thinning: keep a point only when the straight segment to the next kept one crosses a cell without clearance
    const clearLine = (a, b) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.ceil(len / (cell / 2)); for (let t = 0; t <= k; t++) { const [i, j] = cellOf(a[0] + ((b[0] - a[0]) * t) / k, a[1] + ((b[1] - a[1]) * t) / k); if (!ok(i, j)) return false; } return true; };
    const out = [path[0]];
    let at = 0;
    while (at < path.length - 1) { let nx = at + 1; for (let k = path.length - 1; k > at + 1; k--) if (clearLine(path[at], path[k])) { nx = k; break; } out.push(path[nx]); at = nx; }
    return out;
  };
  /**
   * the PATH map's route (the original's own hop table, FUN_00463b49 = `waypoints.route`) from the nearest node to Pepper (or to (x, z)) to PATH node `target`: the positions of the nodes on the way.
   * The bots follow it with the arrow keys where the straight line is blocked (the castle island's cliffs, trees and walls).
   */
  S.pathRoute = (target, from = null) => page.evaluate(async ([t, f]) => {
    const { waypoints: wp } = await import('/src/game/walker.ts');
    const z = window.__zone, p = z.loaded.pepper, x = f ? f[0] : p.x, y = f ? f[1] : p.y, zz = f ? f[2] : p.z;
    let a = wp.nearestNode(1, x, y, zz);
    const out = [];
    for (let i = 0; i < 300 && a !== t; i++) { const nx = wp.route(1, a, t); if (nx === a) break; out.push([...wp.nodePos(1, nx)]); a = nx; }
    return out;
  }, [target, from]);
  /** walk / ride along the PATH route to PATH node `target` (nodes closer than `tolNode` count as reached, the last within `tol`); `stop(p)` as in walkTo */
  S.walkRoute = async (target, { tol = 8, tolNode = 7, maxTicks = 9000, stop = null } = {}) => {
    const t0 = (await S.pep()).tick;
    let res = null;
    S._retries = 0;
    const route = await S.pathRoute(target);
    log('  route', route.length, 'nodes', JSON.stringify(route.map((q) => [Math.round(q[0]), Math.round(q[2])])));
    for (let k = 0; k < route.length; k++) {
      const last = k === route.length - 1;
      const left = maxTicks - ((await S.pep()).tick - t0);
      if (left <= 0) { res = { ok: false, timeout: true }; break; }
      res = await S.walkTo(route[k][0], route[k][2], { tol: last ? tol : tolNode, maxTicks: left, stop });
      if (!res.ok) {
        // blocked by something small on the way: try again from where she stands (the route is recomputed from there)
        if (res.stuck) {
          // something stands in the way (a guard, a tree, a wall): back up while turning one way, then go forward turning the other way, as a player steers round it
          const side = S._retries % 2 ? 1 : -1;
          await page.keyboard.down('ArrowDown'); await page.keyboard.down(side > 0 ? 'ArrowRight' : 'ArrowLeft'); await S.untilTicks(async () => false, 20, 15); await page.keyboard.up('ArrowDown'); await page.keyboard.up(side > 0 ? 'ArrowRight' : 'ArrowLeft');
          await page.keyboard.down('ArrowUp'); await page.keyboard.down(side > 0 ? 'ArrowLeft' : 'ArrowRight'); await S.untilTicks(async () => false, 18, 15); await page.keyboard.up(side > 0 ? 'ArrowLeft' : 'ArrowRight');
          await S.untilTicks(async () => false, 30, 15); await page.keyboard.up('ArrowUp');
        }
        if (res.stuck) {
          const again = await S.pathRoute(target);
          if (S._retries >= 3 && again.length > 1) { const q = await S.nudgeTo(again[1][0], again[1][2], [again[Math.min(2, again.length - 1)][0], again[Math.min(2, again.length - 1)][2]]); log('  BOT-HELP: stuck, put on the route node', JSON.stringify(q)); S._retries = 0; }
          route.splice(0, route.length, ...again); k = -1; if (++S._retries > 30) break; continue;
        }
        break;
      }
    }
    return res ?? { ok: true };
  };
  S._retries = 0;
  /** bot navigation aid (logged): put Pepper (or the horse she rides: HORS, PEPPER_CONTROL 0x10) on the ground at (x, z) facing `face` = [fx, fz] */
  S.nudgeTo = (x, z, face) => page.evaluate(([x, z, face]) => {
    const zz = window.__zone, w = zz.world, p = zz.loaded.pepper, riding = (zz.sh.vars.get(0x5e) & 0xff) === 0x10;
    const g = w.col.groundRay(x, p.y + 40, z); if (!(g > -1e30)) return null;
    const ry = Math.atan2(face[0] - x, face[1] - z);
    if (riding) { const r = w.records.find((q) => q.name === 'HORS'); r.setEuler(0, ry, 0, x, g, z); r.rx = 0; r.ry = ry; r.rz = 0; w.camera.init(r); }
    else { p.x = x; p.z = z; p.y = g; p.ry = ry; p.rebuildYaw(); p.savePrev(); w.camera.init(p); }
    return [x, z];
  }, [x, z, face]);
  /** walk straight at (x, z) in chunks; when a chunk made no progress (a tree, a guard, a wall) back up round it like a player and go on */
  S.walkSmart = async (x, z, { tol = 8, maxTicks = 9000, stop = null, chunk = 500 } = {}) => {
    const t0 = (await S.pep()).tick;
    let res = null, prev = Infinity, bad = 0;
    for (;;) {
      const p = await S.pep(), used = p.tick - t0;
      if (used > maxTicks) { res = { ok: false, timeout: true }; break; }
      res = await S.walkTo(x, z, { tol, maxTicks: Math.min(chunk, maxTicks - used), stop });
      if (res.ok || res.stopped || res.left || res.frozen) break;
      const d = res.d;
      if (d > prev - 3) {
        bad++;
        const side = bad % 2 ? 1 : -1;
        await page.keyboard.down('ArrowDown'); await page.keyboard.down(side > 0 ? 'ArrowRight' : 'ArrowLeft'); await S.untilTicks(async () => false, 20, 15); await page.keyboard.up('ArrowDown'); await page.keyboard.up(side > 0 ? 'ArrowRight' : 'ArrowLeft');
        await page.keyboard.down('ArrowUp'); await page.keyboard.down(side > 0 ? 'ArrowLeft' : 'ArrowRight'); await S.untilTicks(async () => false, 30, 15); await page.keyboard.up(side > 0 ? 'ArrowLeft' : 'ArrowRight');
        await S.untilTicks(async () => false, 40, 15); await page.keyboard.up('ArrowUp');
        if (bad % 3 === 0) {
          // a place the arrow keys cannot get round (bot navigation, not the game): put Pepper 30 units on along the line to the target, on the ground there
          const q = await page.evaluate(([tx, tz]) => { const z = window.__zone, w = z.world, p = z.loaded.pepper; const dx = tx - p.x, dz = tz - p.z, l = Math.hypot(dx, dz) || 1;
            const nx = p.x + (dx / l) * 30, nz = p.z + (dz / l) * 30, g = w.col.groundRay(nx, p.y + 40, nz); if (g > -1e30) { p.x = nx; p.z = nz; p.y = g; p.ry = Math.atan2(dx, dz); p.rebuildYaw(); p.savePrev(); w.camera.init(p); return [nx, nz]; } return null; }, [x, z]);
          log('  BOT-HELP: stuck, Pepper put on', JSON.stringify(q));
        }
        if (bad > 25) break;
      }
      prev = Math.min(prev, d);
    }
    return res;
  };
  S.shot = shot; S.log = log; S.wait = wait; S.page = page;
  return S;
}
