// A page-side route follower for the hub bots (WP-RELIABILITY, same idea as lib-pagebot.mjs): the steering decision is taken INSIDE the page, once per game tick (hooked into the input
// mapper's per-tick update), from Pepper's own state and the camera, so it does not depend on the latency of the page round trips of a node-side loop nor on how many ticks a frame runs.
// The arrows are camera relative (FUN_0042a654), so the route is followed by pure pursuit and the arrows are pressed on the wanted direction as the camera sees it.
//   const W = await installRouteBot(page, 'ogl');
//   await W.route(points, { tol: 6, look: 6 });      // points = [[x, z], ...] or [[x, y, z], ...] (the heights re-locate Pepper on the route after a fall)
//   await W.start();  ... W.state() -> { wi, n, falls, done, err, x, y, z, ctrl, tick } ...  await W.stop();
export async function installRouteBot(page, name = 'walk') {
  await page.evaluate((n) => {
    const inp = window.__shell && window.__shell.input;
    const send = (code, on) => { if (inp) inp.setKey(code, on); else window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true })); };
    const held = new Set();
    const W = { on: false, timer: 0, pts: [], ys: [], lastTick: -1, lastRy: 0, rate: 0, wi: 1, avoidN: 0, avoidUntil: -1, stillSince: 0, sx: 0, sz: 0, tol: 8, look: 6, falls: 0, fell: false, done: false, err: 0, presses: 0, msg: '', ring: [], fallTrace: null, calls: 0 };
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const decide = () => {
      const z = window.__zone, want = new Set();
      if (!z || !z.loaded || z.machine.mode !== 2) return want;
      const p = z.loaded.pepper, ctrl = z.sh.vars.get(0x5e);
      if (++W.calls % 6 === 0) { W.ring.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), +p.ry.toFixed(2), W.wi, +W.err.toFixed(2), z.world.tickCount]); if (W.ring.length > 90) W.ring.shift(); }
      if (ctrl & 0x20) { if (!W.fell) W.fallTrace = W.ring.slice(-60); W.fell = true; return want; }                       // falling / being put back (PEPPER_CONTROL 0x20)
      if (W.fell) {   // landed again (the void put Pepper back at the node 0x3e + 160, far from where she fell): find the part of the route she stands next to (3D distance), a few legs earlier
        W.fell = false; W.falls++;
        let best = 0, bd = 1e30;
        for (let k = 0; k + 1 < W.pts.length; k++) {
          const ax = W.pts[k][0], az = W.pts[k][1], bx = W.pts[k + 1][0], bz = W.pts[k + 1][1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)), y = W.ys.length ? W.ys[k] + (W.ys[k + 1] - W.ys[k]) * t : p.y;
          const d = Math.hypot(p.x - (ax + dx * t), p.z - (az + dz * t)) + Math.abs(p.y - y) * 2;
          if (d < bd) { bd = d; best = k; }
        }
        W.wi = best + 1;
      }
      if (z.ctx?.cutscene?.active?.() || (ctrl & 0x100)) return want;
      // pure pursuit along the polyline of the route (not straight at the next node: the corners of a spiral road and the walls beside it are what the straight line cuts)
      const n = W.pts.length, P = W.pts;
      let seg = Math.max(0, Math.min(n - 2, W.wi - 1));
      const proj = (k) => { const ax = P[k][0], az = P[k][1], bx = P[k + 1][0], bz = P[k + 1][1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)); return { t, x: ax + dx * t, z: az + dz * t, d: Math.hypot(p.x - (ax + dx * t), p.z - (az + dz * t)) }; };
      let pr = proj(seg);
      // the next segment when this one is used up (or the next one is the nearer): the route only goes forward
      while (seg < n - 2 && (pr.t >= 1 || proj(seg + 1).d < pr.d - 0.01 && proj(seg + 1).t > 0)) { seg++; pr = proj(seg); }
      W.wi = seg + 1;
      if (seg === n - 2 && Math.hypot(P[n - 1][0] - p.x, P[n - 1][1] - p.z) < W.tol) { W.done = true; return want; }
      // the aim point: `look` units on along the polyline from the projection
      let rem = W.look, ax = pr.x, az = pr.z, k = seg;
      for (;;) {
        const bx = P[k + 1][0], bz = P[k + 1][1], l = Math.hypot(bx - ax, bz - az);
        if (l >= rem || k + 1 >= n - 1) { const f = l > 0 ? Math.min(1, rem / l) : 1; ax += (bx - ax) * f; az += (bz - az) * f; break; }
        rem -= l; ax = bx; az = bz; k++;
      }
      // the arrows are CAMERA RELATIVE (FUN_0042a654: the stick is rotated by the camera's right / forward axes; Pepper then turns towards her velocity): the wanted world direction is
      // split into its forward and right parts as seen from the camera and the arrows are pressed on those, the way a player steers by the screen
      const tick = z.world.tickCount, c = z.world.camera.c;
      const wx = ax - p.x, wz = az - p.z, wl = Math.hypot(wx, wz) || 1, nx = wx / wl, nz = wz / wl;
      const fwd = nx * c[15] + nz * c[17], rgt = nx * c[9] + nz * c[11];
      W.err = Math.atan2(rgt, fwd);                                          // the screen-relative angle of the wanted direction (0 = straight up the screen)
      if (fwd > 0.3) want.add('ArrowUp'); else if (fwd < -0.3) want.add('ArrowDown');
      if (rgt > 0.3) want.add('ArrowRight'); else if (rgt < -0.3) want.add('ArrowLeft');
      // wedged (a citizen / a wall in the way: no movement for 40 ticks while walking): back out turning to one side for a moment, the next time to the other
      if (Math.hypot(p.x - W.sx, p.z - W.sz) > 0.15 || !want.has('ArrowUp')) { W.sx = p.x; W.sz = p.z; W.stillSince = tick; }
      if (W.avoidUntil > tick) { want.clear(); want.add('ArrowDown'); want.add(W.avoidN % 2 ? 'ArrowRight' : 'ArrowLeft'); return want; }
      if (tick - W.stillSince > 40) { W.avoidN++; W.avoidUntil = tick + 25; W.stillSince = tick + 25; W.sx = p.x; W.sz = p.z; }
      return want;
    };
    const sync = () => {
      let want; try { want = decide(); } catch (e) { W.msg = String(e && e.stack || e); want = new Set(); }
      for (const c of [...held]) if (!want.has(c)) { send(c, false); held.delete(c); }
      for (const c of want) if (!held.has(c)) { send(c, true); held.add(c); W.presses++; }
    };
    W.start = () => {
      if (W.on) return; W.on = true;
      if (inp) { W.orig = inp.update; W.hooked = function () { if (W.on) sync(); return W.orig.apply(inp, arguments); }; inp.update = W.hooked; }   // once per game tick, before the tick samples the keys
      else W.timer = setInterval(sync, 4);
    };
    W.release = () => { for (const c of [...held]) { send(c, false); held.delete(c); } };
    W.stop = () => { W.on = false; clearInterval(W.timer); W.release(); if (inp && inp.update === W.hooked) inp.update = W.orig; };
    window[`__walk_${n}`] = W;
  }, name);
  const W = (fn, arg) => page.evaluate(fn, [name, arg]);
  return {
    route: (pts, o = {}) => W(([n, a]) => { const w = window[`__walk_${n}`]; w.pts = a.pts.map((q) => q.length === 3 ? [q[0], q[2]] : q); w.ys = a.pts.every((q) => q.length === 3) ? a.pts.map((q) => q[1]) : []; w.wi = a.wi ?? 1; w.tol = a.tol ?? 8; w.look = a.look ?? 14; w.done = false; }, { pts, ...o }),
    setIndex: (wi) => W(([n, a]) => { window[`__walk_${n}`].wi = a; }, wi),
    start: () => W(([n]) => window[`__walk_${n}`].start()),
    stop: () => W(([n]) => window[`__walk_${n}`].stop()),
    release: () => W(([n]) => window[`__walk_${n}`].release()),
    state: () => W(([n]) => { const w = window[`__walk_${n}`], z = window.__zone, p = z?.loaded?.pepper; return { fallTrace: w.fallTrace, wi: w.wi, n: w.pts.length, falls: w.falls, done: w.done, err: +w.err.toFixed(2), msg: w.msg, presses: w.presses, x: p?.x, y: p?.y, z: p?.z, ry: p?.ry, ctrl: z?.sh.vars.get(0x5e), tick: z?.world.tickCount, node: z?.sh.vars.get(0x58), arch: z?.info.archive }; }),
  };
}
