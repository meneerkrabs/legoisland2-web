// WP-SAVE (worker F1): the waypoint walker table of the save game (FUN_00462d8b writer / FUN_00462e75 loader, src/game/walkersave.ts) against the original's own code in the x86 emulation.
//  1. set-up: the original's table after the constructors of an island era / hub (the island oracle of tools/lib/m8-save.mjs) against `captureWalkers` of the port's world (REPORT: the slot order is made by
//     the NPC / vehicle constructors of other workers; the first differing slot is listed in the notes; M8W_STRICT=1 makes it a failure);
//  2. gameplay: walkers walk side by side (the scenario machinery of tools/tests/m7-walker-emu.mjs: clustered walkers, random orders, follow orders, frees / re-creates, blocked walkers); at many moments the
//     original's writer (run natively) and `captureWalkers` give identical 0x1fe0 bytes (tolerance 0), and the node lists agree;
//  3. the load: the original's writer output of an earlier moment is loaded into BOTH machines (native FUN_00462e75 / `applyWalkers`) after the state moved on (and after records vanished): the tables
//     must be equal again byte for byte, and the duel goes on comparing equal for several hundred more ticks.
// Record pointers: the walker emulation's records are at 0x30000000 + i * 0x68, the port's convention (the island oracle's) is 0x10000000 + i * 0x68: the words +0x08 / +0x14 are translated by
// that constant before comparing (nothing is masked).
import { createWalkerEmu } from '../lib/m7-walker-emu.mjs';
import { Walker, WaypointSystem, waypoints, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../src/game/walker.ts';
import { GameRecord } from '../../src/game/record.ts';
import { captureWalkers, applyWalkers } from '../../src/game/walkersave.ts';
import { buildIslandOracle, buildHubOracle } from '../lib/m8-save.mjs';

const rng = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (n) => Math.floor(f() * n); return f; };
const fr = Math.fround;
const TABLE = 0x5d4e1b0, STRIDE = 0x84;

/** the original's writer, natively: the 0x1fe0 bytes */
function origTable(cpu, mem, buf) { const n = cpu.call(0x462d8b, [buf]); return mem.read(buf, n); }
function blobBytes(b) { const out = new Uint8Array(0x1ef0 + 4 * 60); out.set(b.walkers, 0); new DataView(out.buffer).setUint32(0, new DataView(b.walkers.buffer, b.walkers.byteOffset).getUint32(0, true), true); for (let k = 0; k < 60; k++) new DataView(out.buffer).setUint32(0x1ef0 + 4 * k, b.tags[k], true); return out; }
const dvOf = (u) => new DataView(u.buffer, u.byteOffset, u.byteLength);
/** first differing byte -> description (slot, field offset) */
function diffTable(a, b, shift = 0) {
  if (a.length !== b.length) return `size original ${a.length} port ${b.length}`;
  const da = dvOf(a), db = dvOf(b);
  for (let o = 0; o < a.length; o += 4) {
    let x = da.getUint32(o, true); const y = db.getUint32(o, true);
    const field = o < 0x1ef0 ? o % STRIDE : -1;
    if (shift && (field === 0x08 || field === 0x14) && x >= 0x30000000) x = (x - shift) >>> 0;   // (the record array of the walker emulation)
    if (x !== y) return o < 0x1ef0 ? `slot ${Math.floor(o / STRIDE)} +0x${(o % STRIDE).toString(16)}: original ${x.toString(16)} port ${y.toString(16)}` : `tag ${(o - 0x1ef0) / 4}: original ${x.toString(16)} port ${y.toString(16)}`;
  }
  return null;
}

export default {
  name: 'm8-save-walkers',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0, moments = 0, loads = 0, ticks = 0, scen = 0, dropped = 0, stale = 0, blockers = 0, follows = 0;
    const archive = ctx.archives.find((a) => a.name === 'z02LGI');
    const fail = (m) => { if (failures.length < 40) failures.push(m); };

    // ------------------------------------------------------------------------------------------------------------ 1. the set-up of the island eras and hubs
    const SETUP = process.env.M8W_ZONES ? process.env.M8W_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
    for (const z of SETUP) {
      let B;
      waypoints.unload(); for (const sl of waypoints.slots) Object.assign(sl, new Walker(), { reach: 0, speedScale: 0 });   // (every zone starts from the all-zero static table)
      try { B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), { extraExec: [[0x419a79, 0x419b17]] }) : buildHubOracle(ctx, z, { extraExec: [[0x419a79, 0x419b17]] }); } catch (e) { fail(`${z}: oracle build failed: ${e.message}`); continue; }
      const emu = B.emu, mem = emu.cpu.mem, buf = emu.alloc(0x2000);
      mem.w32(0x983800, B.P.world.records.length); mem.w32(0x983804, 0x10000000);
      const ot = origTable(emu.cpu, mem, buf);
      const active = (() => { let n = 0; for (let k = 0; k < 60; k++) if (dvOf(ot).getUint32(k * STRIDE, true)) n++; return n; })();
      // the loader on the original's own bytes changes nothing (the records exist, the lists are rebuilt in slot order)
      const nb = emu.alloc(0x2000); mem.write(nb, ot); emu.cpu.call(0x462e75, [nb]);
      const again = origTable(emu.cpu, mem, buf); checked++;
      const dRound = diffTable(ot, again); if (dRound) notes.push(`set-up ${z}: the original's loader does not give back its own set-up table (stale list entries of the set-up are rebuilt clean): ${dRound}`);
      const pt = captureWalkers(B.P.world), pb = blobBytes(pt);
      const d = diffTable(ot, pb);
      const pAct = pt.walkers.length ? (() => { let n = 0; for (let k = 0; k < 60; k++) if (dvOf(pt.walkers).getUint32(k * STRIDE, true)) n++; return n; })() : 0;
      notes.push(`set-up ${z}: original ${active} walkers, port ${pAct}; ${d ? 'first difference: ' + d : 'table identical'}`);
      if (d && process.env.M8W_DUMP) { const sl = Number(/slot (\d+)/.exec(d)?.[1] ?? 0), hx = (u, o) => Array.from({ length: 0x84 / 4 }, (_, i) => dvOf(u).getUint32(o + 4 * i, true).toString(16)).join(' '); notes.push(`   orig slot ${sl}: ${hx(ot, sl * STRIDE)}`); notes.push(`   port slot ${sl}: ${hx(pb, sl * STRIDE)}`); }
      checked++;
      if (d && process.env.M8W_STRICT) fail(`${z}: set-up table differs: ${d}`);
      // the port's loader on the original's set-up bytes gives what the original's loader gave (port-only walkers of the set-up are overwritten like the original's table is)
      { const blob = { walkers: ot.slice(0, 0x1ef0), tags: new Uint32Array(60) }; for (let k = 0; k < 60; k++) blob.tags[k] = dvOf(ot).getUint32(0x1ef0 + 4 * k, true);
        applyWalkers(B.P.world, blob); checked++;
        const dl = diffTable(again, blobBytes(captureWalkers(B.P.world))); if (dl) fail(`${z}: port loader on the original's set-up table: ${dl}`); else loads++; }
    }

    // ------------------------------------------------------------------------------------------------------------ 2 + 3. gameplay and load round trips
    const E = createWalkerEmu(ctx, 'z02LGI');
    const { cpu, mem } = E;
    cpu.exec.push([0x419a79, 0x419b17]); cpu.invalidate();                // FUN_00419a79 (the record lookup by tag) runs natively
    const buf = E.alloc(0x2000), lbuf = E.alloc(0x2000);
    const NREC = 80;

    const runScenario = (S) => {
      scen++;
      E.reset(); E.loadMaps(); E.setDt(S.dt);
      for (let i = 0; i < 0x1ef0; i += 4) mem.w32(TABLE + i, 0);          // (static BSS: the table starts all zero)
      const sys = new WaypointSystem(); sys.load(archive); sys.dt = S.dt;
      const r = rng(S.seed);
      const world = { records: [] };
      const count = sys.mapCount(S.map);
      const nearOn = (map, c) => { const n0 = sys.node(map, c), out = []; for (let i = 0; i < sys.mapCount(map); i++) { const n = sys.node(map, i); if (Math.hypot(n.x - n0.x, n.z - n0.z) < (S.spread ?? 80)) out.push(i); } return out; };
      const pools = [r.int(count), r.int(count), r.int(count)].map((c) => nearOn(S.map, c));
      const W = [];
      const mkRec = (i, name) => { const rec = new GameRecord(name); rec.flags = 2; rec.index = i; world.records[i] = rec; return rec; };
      const recNameOf = (i) => 'N' + String(i % 1000).padStart(3, '0');
      for (let i = 0; i < NREC; i++) { const rec = mkRec(i, recNameOf(i)); rec.ry = fr(r() * 6.28 - 3.14); E.writeRec(i, rec); }
      mem.w32(0x983800, NREC); mem.w32(0x983804, 0x30000000);
      const mkWalker = (i, wild) => {
        const rec = world.records[i];
        const pool = pools[r.int(3)], start = pool[r.int(pool.length)];
        const route = []; for (let k = 0; k < 3 + r.int(4); k++) { const q = pools[r.int(3)]; route.push(q[r.int(q.length)]); }
        const p = { speed: fr(NPC_SPEED * (0.5 + r() * 1.5)), turn: fr(NPC_TURN_RATE * (0.5 + r() * 1.5)), lane: r() < 0.7 ? fr((r() - 0.5) * 0.6) : 0, rmin: fr(NPC_RADIUS_MIN * (0.5 + r())), rmax: fr(NPC_RADIUS_MAX * (0.5 + r())), rlim: fr(NPC_RADIUS_LIMIT * (0.5 + r())) };
        const nh = E.n.create(S.map, i, start), ph = sys.create(S.map, rec, start);
        if (nh !== ph) { fail(`${S.name}: create: original handle ${nh}, port ${ph}`); return null; }
        if (!nh) return null;
        for (const [fn, v] of [['setSpeed', p.speed], ['setTurnRate', p.turn], ['setLane', p.lane], ['setRadiusMin', p.rmin], ['setRadiusMax', p.rmax], ['setRadiusLimit', p.rlim]]) { E.n[fn](nh, v); sys[fn](ph, v); }
        E.n.apply(nh, i); sys.apply(ph, rec);
        E.n.goTo(nh, route[0], 0); sys.goTo(ph, route[0], 0);
        return { i, h: nh, rec, route, index: 0, wild, map: S.map };
      };
      for (let i = 0; i < S.walkers; i++) { const w = mkWalker(i, S.wild && r() < 0.6); if (w) W.push(w); }
      let nextRec = S.walkers;
      const cmpLists = () => {
        for (let n = 0; n < sys.mapCount(S.map); n++) {
          const o = E.lists(S.map, n);
          for (let l = 0; l < 3; l++) { const pl = []; for (let q = sys.maps[S.map].heads[n * 3 + l]; q; q = q.link[l]) pl.push(sys.slots.indexOf(q) + 1); checked++; if (JSON.stringify(pl) !== JSON.stringify(o[l])) return `list ${l} of node ${n}: original [${o[l]}], port [${pl}]`; }
        }
        return null;
      };
      const cmpTable = (what) => {
        const ot = origTable(cpu, mem, buf), pt = blobBytes(captureWalkers(world, sys));
        checked++; moments++;
        const d = diffTable(ot, pt, 0x20000000);
        if (d) { fail(`${S.name} ${what}: ${d}`); return false; }
        const dl = cmpLists(); if (dl) { fail(`${S.name} ${what}: ${dl}`); return false; }
        const dv = dvOf(ot);
        for (let k = 0; k < 60; k++) { if (dv.getUint32(k * STRIDE + 0x10, true)) blockers++; if (dv.getUint32(k * STRIDE + 0x14, true)) follows++; if (dv.getUint32(k * STRIDE, true) === 0 && dv.getUint32(k * STRIDE + 0x08, true)) stale++; }
        return true;
      };
      const rr = rng(S.seed ^ 0x9e3779b9);
      const mirror = (w, on) => { const rec = w.rec; E.writeRec(w.i, rec); const a = E.recPtr(w.i); mem.wf32(a + 0x3c, on.x); mem.wf32(a + 0x44, on.z); mem.wf32(a + 0x50, on.yaw); };
      const tickAll = (t) => {
        for (const w of W) {
          const rec = w.rec, h = w.h;
          if (!sys.get(h) || sys.get(h).flags === 0) continue;
          const stoppedN = (mem.u32(TABLE + (h - 1) * STRIDE) & 2) !== 0;
          if (stoppedN) { E.n.goTo(h, w.route[w.index], 0); sys.goTo(h, w.route[w.index], 0); }
          const goalP = sys.goalOf(h);
          const on = E.n.step(h, [rec.x, rec.y, rec.z], rec.ry);
          const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
          const code = sys.step(h, pos, rec.ry, out, S.dt);
          if (code !== on.code || pos[0] !== on.x || pos[2] !== on.z || out.yaw !== on.yaw) { fail(`${S.name} tick ${t}: step differs (original ${on.code} ${on.x} ${on.z}, port ${code} ${pos[0]} ${pos[2]})`); return false; }
          rec.ry = out.yaw; rec.x = pos[0]; rec.z = pos[2]; rec.rebuildYaw();
          mirror(w, on);
          if (code === goalP || code === -1) { w.index = w.index === w.route.length - 1 ? 0 : w.index + 1; E.n.goTo(h, w.route[w.index], 1); sys.goTo(h, w.route[w.index], 1); }
        }
        ticks++;
        return true;
      };
      const orders = (t) => {
        for (const w of W) {
          const h = w.h, rec = w.rec;
          if (!sys.get(h) || sys.get(h).flags === 0 || !w.wild || rr() >= 0.05) continue;
          const k = rr.int(9), other = W[rr.int(W.length)];
          const pt = [rec.x + (rr() - 0.5) * 60, rec.y, rec.z + (rr() - 0.5) * 60];
          const ptr = (v) => { const p = E.alloc(16); for (let i = 0; i < 3; i++) mem.wf32(p + 4 * i, v[i]); return p; };
          switch (k) {
            case 0: { const nd = rr.int(count), c = rr.int(2); E.n.goTo(h, nd, c); sys.goTo(h, nd, c); break; }
            case 1: if (other && sys.get(other.h)?.flags) { E.n.followRecord(h, other.i); sys.followRecord(h, other.rec); } break;
            case 2: { const a = fr((rr() - 0.5) * 6.2); E.n.turnToHeading(h, a); sys.turnToHeading(h, a); break; }
            case 3: { const nd = rr.int(count); E.n.turnToNode(h, nd); sys.turnToNode(h, nd); break; }
            case 4: { const q = ptr(pt); E.call(0x4627e2, [h, q]); sys.turnToPoint(h, pt.map(fr)); break; }
            case 5: { const q = ptr(pt); E.call(0x462a11, [h, q]); sys.moveToPoint(h, pt.map(fr)); break; }
            case 6: E.call(0x461e69, [h]); sys.pause(h); break;
            case 7: E.call(0x461f42, [h]); sys.resume(h); break;
            case 8: { const nd = rr.int(count); E.n.teleport(h, nd); sys.teleport(h, nd); E.n.apply(h, w.i); sys.apply(h, rec); const rn = E.readRec(w.i); rec.x = rn.x; rec.z = rn.z; rec.ry = rn.ry; rec.rebuildYaw(); E.writeRec(w.i, rec); break; }
          }
        }
        // frees and re-creates: the slots the original leaves stale (flags 0, the rest of the struct and the list links stay)
        if (S.churn && rr() < 0.03 && W.length) {
          const w = W[rr.int(W.length)];
          if (sys.get(w.h)?.flags) { E.n.free(w.h); sys.free(w.h); }
          else if (nextRec < NREC) { const nw = mkWalker(nextRec++, true); if (nw) { W.splice(W.indexOf(w), 1, nw); } }
        }
      };
      let snap = null;
      const compare = (t, tag) => cmpTable(`tick ${t} ${tag}`);
      if (!compare(-1, 'start')) return;
      for (let t = 0; t < S.ticks; t++) {
        orders(t);
        if (!tickAll(t)) return;
        if (t % 10 === 0 && !compare(t, 'walking')) return;
        if (t === S.snapAt) snap = origTable(cpu, mem, buf).slice();
        if (snap && t === S.loadAt) {
          // the load: the original's section bytes of the earlier moment into both machines; the records of `vanish` do not exist any more (their walkers are dropped)
          const rec = snap.slice();
          // (the words +0x08 / +0x14 of the walker emulation's record array are translated to the port's convention for the port's loader; the original's loader gets its own bytes)
          const prec = snap.slice(); { const dv = dvOf(prec); for (let k = 0; k < 60; k++) for (const f of [0x08, 0x14]) { const v = dv.getUint32(k * STRIDE + f, true); if (v >= 0x30000000) dv.setUint32(k * STRIDE + f, (v - 0x20000000) >>> 0, true); } }
          if (S.vanish) for (const i of S.vanish) { world.records[i].name = 'ZZ' + i; E.writeRec(i, world.records[i]); }
          mem.write(lbuf, rec); cpu.call(0x462e75, [lbuf]);
          const blob = { walkers: prec.slice(0, 0x1ef0), tags: new Uint32Array(60) };
          for (let k = 0; k < 60; k++) blob.tags[k] = dvOf(rec).getUint32(0x1ef0 + 4 * k, true);
          applyWalkers(world, blob, sys);
          loads++;
          const nd = (() => { const dv = dvOf(origTable(cpu, mem, buf)); let n = 0; for (let k = 0; k < 60; k++) if (dvOf(snap).getUint32(k * STRIDE, true) && !dv.getUint32(k * STRIDE, true)) n++; return n; })();
          dropped += nd;
          if (!compare(t, 'after the load')) return;
          // handles of dropped walkers are gone on both sides: the scenario forgets them
          for (let q = W.length - 1; q >= 0; q--) if (!sys.get(W[q].h)) W.splice(q, 1);
          // the records of the walkers kept: the position of the record is the current one on both sides; the original's walker state is the snapshot's: both keep going the same
        }
      }
    };
    for (const map of [1, 0, 3]) {
      for (const seed of [11, 12]) runScenario({ name: `walk map ${map} seed ${seed}`, map, walkers: 8, ticks: 520, dt: 1, seed, spread: 60, snapAt: 120, loadAt: 260 });
      for (const seed of [21, 22]) runScenario({ name: `cluster map ${map} seed ${seed}`, map, walkers: 16, ticks: 560, dt: 1, seed, spread: 40, snapAt: 100, loadAt: 300 });
      for (const seed of [31, 32, 33]) runScenario({ name: `orders map ${map} seed ${seed}`, map, walkers: 12, ticks: 600, dt: 1, seed, wild: true, churn: true, spread: 60, snapAt: 150, loadAt: 330 });
      for (const seed of [41, 42]) runScenario({ name: `vanish map ${map} seed ${seed}`, map, walkers: 12, ticks: 600, dt: 1, seed, wild: true, churn: true, spread: 60, snapAt: 130, loadAt: 300, vanish: [1, 3, 4] });
    }
    for (const seed of [51, 52]) runScenario({ name: `half step seed ${seed}`, map: 1, walkers: 14, ticks: 800, dt: 0.5, seed, wild: true, churn: true, spread: 50, snapAt: 200, loadAt: 400, vanish: [2] });
    notes.push(`scenarios ${scen}, ticks ${ticks}, table moments compared ${moments} (tolerance 0), loads ${loads} (walkers dropped by a vanished record: ${dropped}), checks ${checked}; words seen: blocker pointers ${blockers}, follow records ${follows}, stale slots ${stale}`);
    return { checked, failures, notes };
  },
};
