import { createWalkerEmu, FIELDS, bits } from '../lib/m7-walker-emu.mjs';
import { runApiBattery } from '../lib/m7-walker-api.mjs';
import { createCoverage } from '../lib/m7-walk-emu.mjs';
import { WaypointSystem, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../src/game/walker.ts';
import { GameRecord } from '../../src/game/record.ts';

// M7 / WP-VERIFY: the waypoint walker (src/game/walker.ts) against the original's code (FUN_004630c0 loader, FUN_004614d5 create, FUN_00461c24 go to, FUN_004626d0 step with the route lookup, curve planning,
// steering and traffic rules below it; tools/lib/m7-walker-emu.mjs) on the real island maps (ROAD, PATH and OTH; the CSM map has no route matrices: the original cannot route on it). Several walkers per map
// walk random routes (the WalkerNode's loop: order the next node with the continue flag when the current goal is approached) while random orders interrupt them (go to a node with / without the continue flag,
// follow a record, turn to a heading / node / point, walk to a point, speed / lane / ignore changes, pause / resume, teleport + apply). dt 1 and 0.5. Free mode: both sides run alone for the whole scenario.
// Compared every tick (tolerance 0, bit for bit): the step result, position, yaw, distance, all 26 walker fields, the record after the tick, and the node lists (the walkers standing in each node).
const rng = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (n) => Math.floor(f() * n); return f; };
const fr = Math.fround;
const TOL = Number(process.env.M7_WTOL ?? 0);

export default {
  name: 'm7-walker-emu',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0, ticks = 0, scen = 0;
    const archive = ctx.archives.find((a) => a.name === 'z02LGI');
    const E = createWalkerEmu(ctx, 'z02LGI');
    const starts = E.pe.functionStarts().filter((a) => a >= 0x461000 && a < 0x466100);
    const cov = createCoverage(E, starts.map((a) => [a, `0x${a.toString(16)}`]));
    E.trace = cov.trace;
    const stat = { codes: {}, maxd: {}, firstBad: null, flags: {}, events: {}, listChecks: 0 };
    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
    const num = (name, a, b, msgs) => {
      checked++;
      if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return;
      const d = Math.abs(a - b), sc = Math.max(1, Math.abs(b)), k = name.replace(/^N\d+\./, '');
      if (d / sc > (stat.maxd[k] ?? 0)) stat.maxd[k] = d / sc;
      if (!(d <= TOL * sc)) msgs.push(`${name}: original ${b}, port ${a}`);
    };
    const runScenario = (S) => {
      scen++;
      E.reset(); E.loadMaps(); E.setDt(S.dt);
      const sys = new WaypointSystem(); sys.load(archive); sys.dt = S.dt;
      const r = rng(S.seed);
      const count = sys.mapCount(S.map);
      // clustered starts: every walker starts within 80 units of a few hubs so that they meet (traffic rules)
      const nearOn = (map, c) => { const n0 = sys.node(map, c), out = []; for (let i = 0; i < sys.mapCount(map); i++) { const n = sys.node(map, i); if (Math.hypot(n.x - n0.x, n.z - n0.z) < (S.spread ?? 80)) out.push(i); } return out; };
      // mixed: road and path walkers around the crossings (path nodes of kind 4 linked to road nodes): the crossing rules (road walkers wait for path walkers and the reverse)
      let crossings = null;
      if (S.mixed) { crossings = []; for (let i = 0; i < sys.mapCount(1); i++) { const n = sys.node(1, i); if (n.kind === 4 && n.link >= 0 && n.link < sys.mapCount(0)) crossings.push(i); } }
      const hubs = S.mixed ? [0, 1, 2].map(() => crossings[r.int(crossings.length)]) : [r.int(count), r.int(count), r.int(count)];
      const pools = S.mixed ? hubs.map((c) => ({ 1: nearOn(1, c), 0: nearOn(0, sys.node(1, c).link) })) : hubs.map((c) => nearOn(S.map, c));
      const W = [];
      for (let i = 0; i < S.walkers; i++) {
        const name = 'N' + String(i).padStart(3, '0');
        const rec = new GameRecord(name); rec.flags = 2; rec.index = i;
        const wmap = S.mixed ? (i % 2 ? 0 : 1) : S.map;
        const poolOf = (h) => (S.mixed ? h[wmap] : h);
        const pool = poolOf(pools[r.int(3)]), start = pool[r.int(pool.length)];
        const route = []; for (let k = 0; k < 3 + r.int(4); k++) { const q = poolOf(pools[r.int(3)]); route.push(q[r.int(q.length)]); }
        const wild = S.wild && r() < 0.5;
        const p = {
          speed: fr(NPC_SPEED * (0.5 + r() * 1.5)), turn: fr(NPC_TURN_RATE * (0.5 + r() * 1.5)), lane: r() < 0.7 ? fr((r() - 0.5) * 0.6) : 0, rmin: fr(NPC_RADIUS_MIN * (0.5 + r())), rmax: fr(NPC_RADIUS_MAX * (0.5 + r())),
          rlim: fr(NPC_RADIUS_LIMIT * (0.5 + r())), stop: r() < 0.3 ? fr(1 + r() * 5) : null, ign: r() < 0.25 ? [r.int(2), r.int(2)] : null, scale: r() < 0.2 ? fr(0.5 + r()) : null,
        };
        rec.ry = fr(r() * 6.28 - 3.14);
        E.writeRec(i, rec);
        let nh; try { nh = E.n.create(wmap, i, start); } catch (e) { failures.push(`${S.name}: native create(${wmap}, rec ${i}, node ${start}) failed: ${e.message}`); return; }
        const ph = sys.create(wmap, rec, start);
        if (nh !== ph) { failures.push(`${S.name}: create: original handle ${nh}, port ${ph}`); return; }
        if (!nh) continue;
        for (const [fn, v] of [['setSpeed', p.speed], ['setTurnRate', p.turn], ['setLane', p.lane], ['setRadiusMin', p.rmin], ['setRadiusMax', p.rmax], ['setRadiusLimit', p.rlim]]) { E.n[fn](nh, v); sys[fn](ph, v); }
        if (p.stop !== null) { E.n.setStopDistance(nh, p.stop); sys.setStopDistance(ph, p.stop); }
        if (p.ign) { E.n.setIgnore(nh, p.ign[0], p.ign[1]); sys.setIgnore(ph, p.ign[0], p.ign[1]); }
        if (p.scale !== null) { E.n.setSpeedScale(nh, p.scale); sys.setSpeedScale(ph, p.scale); }
        E.n.apply(nh, i); sys.apply(ph, rec);
        W.push({ i, h: nh, rec, route, index: 0, p, name, wild, map: wmap });
        E.n.goTo(nh, route[0], 0); sys.goTo(ph, route[0], 0);
      }
      const cmpAll = () => {
        const msgs = [];
        for (const w of W) {
          const o = E.readWalker(w.h), pw = sys.get(w.h);
          for (const k of Object.keys(FIELDS)) {
            const pv = /^point\d$/.test(k) ? pw.point[+k[5]] : pw[k];
            num(`${w.name}.${k}`, k === 'flags' ? pv >>> 0 : pv, o[k], msgs);
          }
          const rn = E.readRec(w.i);
          num(`${w.name}.rec.x`, w.rec.x, rn.x, msgs); num(`${w.name}.rec.z`, w.rec.z, rn.z, msgs); num(`${w.name}.rec.ry`, w.rec.ry, rn.ry, msgs);
          for (let k = 0; k < 16; k++) num(`${w.name}.rec.m${k}`, w.rec.m[k], rn.m[k], msgs);
        }
        return msgs;
      };
      const cmpLists = (nodes) => {
        const msgs = [];
        for (const map of S.mixed ? [0, 1] : [S.map]) for (const n of nodes) {
          if (n < 0 || n >= sys.mapCount(map)) continue;
          const o = E.lists(map, n);
          for (let l = 0; l < 3; l++) {
            const pl = []; for (let q = sys.maps[map].heads[n * 3 + l]; q; q = q.link[l]) pl.push(sys.slots.indexOf(q) + 1);
            stat.listChecks++; checked++;
            if (JSON.stringify(pl) !== JSON.stringify(o[l])) msgs.push(`list ${l} of node ${n} (map ${map}): original [${o[l]}], port [${pl}]`);
          }
        }
        // the road map's crossing lists hang at path nodes' links: compared through the road map
        if (S.map === 1) { const road = E.lists(0, 0); void road; }
        return msgs;
      };
      const report = (tick, msgs) => { if (failures.length < 12) failures.push(`${S.name} tick ${tick}: ${msgs.slice(0, 5).join(' | ')}${msgs.length > 5 ? ` (+${msgs.length - 5})` : ''}`); if (!stat.firstBad) stat.firstBad = `${S.name} tick ${tick}`; };
      let msgs = cmpAll(); if (msgs.length) { report(-1, msgs); return; }
      const rr = rng(S.seed ^ 0x9e3779b9);
      const both = (w, name, a, b) => { E.n[name](...a); sys[name](...b); bump(stat.events, name); };
      for (let t = 0; t < S.ticks; t++) {
        for (const w of W) {
          const rec = w.rec, h = w.h, ms = [];
          // random orders
          if (S.wild && w.wild && rr() < 0.04) {
            const k = rr.int(12), other = W[rr.int(W.length)]; w.last = `tick ${t} order ${k} (flags before ${(E.readWalker(h).flags >>> 0).toString(16)}, speed ${E.readWalker(h).speed}, speedReduced ${E.readWalker(h).speedReduced}, curTurn ${E.readWalker(h).curTurn})`;
            const pt = [rec.x + (rr() - 0.5) * 60, rec.y, rec.z + (rr() - 0.5) * 60];
            const ptr = (v) => { const p = E.alloc(16); for (let i = 0; i < 3; i++) E.mem.wf32(p + 4 * i, v[i]); return p; };
            switch (k) {
              case 0: { const nd = rr.int(sys.mapCount(w.map)), c = rr.int(2); both(w, 'goTo', [h, nd, c], [h, nd, c]); break; }
              case 1: both(w, 'followRecord', [h, other.i], [h, other.rec]); break;
              case 2: { const a = fr((rr() - 0.5) * 6.2); both(w, 'turnToHeading', [h, a], [h, a]); break; }
              case 3: { const nd = rr.int(sys.mapCount(w.map)); both(w, 'turnToNode', [h, nd], [h, nd]); break; }
              case 4: { const q = ptr(pt); E.call(0x4627e2, [h, q]); sys.turnToPoint(h, pt.map(fr)); bump(stat.events, 'turnToPoint'); break; }
              case 5: { const q = ptr(pt); E.call(0x462a11, [h, q]); sys.moveToPoint(h, pt.map(fr)); bump(stat.events, 'moveToPoint'); break; }
              case 6: { const v = fr(NPC_SPEED * (0.3 + rr() * 2)); both(w, 'setSpeed', [h, v], [h, v]); break; }
              case 7: { const v = rr() < 0.5 ? 0 : fr((rr() - 0.5) * 0.6); both(w, 'setLane', [h, v], [h, v]); break; }
              case 8: E.call(0x461e69, [h]); sys.pause(h); bump(stat.events, 'pause'); break;
              case 9: E.call(0x461f42, [h]); sys.resume(h); bump(stat.events, 'resume'); break;
              case 10: { const nd = rr.int(sys.mapCount(w.map)); E.n.teleport(h, nd); sys.teleport(h, nd); bump(stat.events, 'teleport'); both(w, 'apply', [h, w.i], [h, rec]); break; }
              case 11: { const a = rr.int(2), b = rr.int(2); both(w, 'setIgnore', [h, a, b], [h, a, b]); break; }
            }
            E.writeRecPose?.(w.i, rec);
            { const on = E.readWalker(h); void on; }
            // the orders that move the record (apply) changed it on both sides: read the original's record back into the port's so that they continue from equal states only when equal
            if (k === 10) { const rn = E.readRec(w.i); num(`${w.name}.apply.x`, rec.x, rn.x, ms); num(`${w.name}.apply.z`, rec.z, rn.z, ms); num(`${w.name}.apply.ry`, rec.ry, rn.ry, ms); if (ms.length) { report(t, ms); return; } }
          }
          // the node's loop (WalkerNode.update) on both sides
          const stoppedN = (E.readWalker(h).flags & 2) !== 0, stoppedP = !sys.isMoving(h);
          if (stoppedN !== stoppedP) ms.push(`stopped: original ${stoppedN}, port ${stoppedP}`);
          if (stoppedN && !S.wild) { E.n.goTo(h, w.route[w.index], 0); sys.goTo(h, w.route[w.index], 0); }
          if (stoppedN && S.wild && rr() < 0.3) { E.n.goTo(h, w.route[w.index], 0); sys.goTo(h, w.route[w.index], 0); }
          const goalP = sys.goalOf(h);
          const on = E.n.step(h, [rec.x, rec.y, rec.z], rec.ry);
          const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
          const code = sys.step(h, pos, rec.ry, out, S.dt);
          num('code', code, on.code, ms); num('pos.x', pos[0], on.x, ms); num('pos.z', pos[2], on.z, ms); num('yaw', out.yaw, on.yaw, ms); num('dist', out.dist, on.dist, ms);
          bump(stat.codes, on.code < 0 ? on.code : 'node');
          const fl = E.readWalker(h).flags; if (fl & 0x1000000) bump(stat.flags, 'blocked'); if (fl & 0x400000) bump(stat.flags, 'ahead-ignored'); bump(stat.flags, `mode ${(fl >>> 28).toString(16)}`);
          rec.ry = out.yaw; rec.x = pos[0]; rec.z = pos[2]; rec.rebuildYaw();
          E.writeRec(w.i, rec); { const a = E.recPtr(w.i); E.mem.wf32(a + 0x3c, on.x); E.mem.wf32(a + 0x44, on.z); E.mem.wf32(a + 0x50, on.yaw); }
          if (code === goalP || code === -1) {
            const last = w.index === w.route.length - 1;
            w.index = last ? 0 : w.index + 1;
            E.n.goTo(h, w.route[w.index], 1); sys.goTo(h, w.route[w.index], 1);
          }
          if (ms.length) { ms.push(`last order: ${w.last}`); report(t, ms); return; }
        }
        ticks++;
        msgs = cmpAll();
        if (!msgs.length) msgs = cmpLists(t % 20 === 0 ? [...Array(Math.max(sys.mapCount(0), sys.mapCount(1), count)).keys()] : [...new Set(W.flatMap((w) => { const o = E.readWalker(w.h); return [o.from, o.to, o.next]; }))]);
        if (msgs.length) { report(t, msgs); return; }
      }
    };
    for (const dt of [1, 0.5]) {
      for (const map of [1, 0, 3]) runScenario({ name: `walkers map ${map}`, map, walkers: 6, ticks: dt === 1 ? 500 : 800, dt, seed: 11 + map });
      for (const map of [1, 0, 3]) for (const seed of [101, 202]) runScenario({ name: `cluster map ${map} seed ${seed}`, map, walkers: 14, ticks: dt === 1 ? 400 : 600, dt, seed, spread: 50 });
      for (const map of [1, 0, 3]) for (const seed of [31, 32, 33]) runScenario({ name: `orders map ${map} seed ${seed}`, map, walkers: 8, ticks: dt === 1 ? 500 : 700, dt, seed, wild: true, spread: 70 });
    }
    for (const dt of [1, 0.5]) for (const seed of [41, 42, 43, 44]) runScenario({ name: `crossings seed ${seed}`, map: 1, mixed: true, walkers: 12, ticks: dt === 1 ? 500 : 700, dt, seed, spread: 40 });
    for (const dt of [1, 0.5]) for (const seed of [51, 52]) runScenario({ name: `crossings + orders seed ${seed}`, map: 1, mixed: true, wild: true, walkers: 10, ticks: dt === 1 ? 500 : 700, dt, seed, spread: 40 });
    // ---- the API battery (tools/lib/m7-walker-api.mjs)
    { let ac = { queries: 0, creates: 0, nearest: 0, ticks: 0, calls: {} };
      for (const seed of [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012]) {
        scen++;
        let res;
        try { res = runApiBattery(E, archive, WaypointSystem, GameRecord, rng, seed, stat); } catch (e) { failures.push(`api battery seed ${seed} crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); continue; }
        checked += res.checked;
        if (res.msgs.length) failures.push(`api battery seed ${seed}: ${res.msgs.slice(0, 6).join(' | ')}${res.msgs.length > 6 ? ` (+${res.msgs.length - 6})` : ''}`);
        ac.queries += res.cov.queries; ac.creates += res.cov.creates; ac.nearest += res.cov.nearest; ac.ticks += res.cov.ticks; for (const [k, v] of Object.entries(res.cov.calls)) ac.calls[k] = (ac.calls[k] ?? 0) + v;
      }
      notes.push(`api battery: ${JSON.stringify(ac)}`); }
    notes.push(`scenarios ${scen}, ticks ${ticks}, checks ${checked} (node list checks ${stat.listChecks})`);
    notes.push(`step results: ${JSON.stringify(stat.codes)}; flags seen: ${JSON.stringify(stat.flags)}; orders: ${JSON.stringify(stat.events)}`);
    notes.push(`tolerance ${TOL}; max relative differences: ${Object.keys(stat.maxd).length ? JSON.stringify(stat.maxd) : 'none (all equal)'}`);
    const rep = cov.report(); notes.push(`branch outcomes of the original's code covered: ${rep.covered} / ${rep.total}: ${rep.per.filter((p) => p.outcomes).map((p) => `${p.name} ${p.covered}/${p.outcomes}`).join(', ')}`);
    if (process.env.M7_COV_MISSING) notes.push(`missing: ${rep.missing.join(' ')}`);
    return { checked, failures, notes };
  },
};
