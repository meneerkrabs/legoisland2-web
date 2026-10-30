// M7 / WP-VERIFY: the API battery of the waypoint walker oracle (tools/tests/m7-walker-emu.mjs): the functions of the original's walker interface the random-walk scenarios do not reach, called one by one on
// both sides and compared (results, every walker field, the records, the node lists): the map queries (node count / valid node / position / find by name prefix / route hop / adjacency / neighbours), create with the
// nearest node (-1) / the odd start nodes (-2, -3) / explicit nodes and a record yaw beyond +-pi, apply, status, the accessors (goal / to / from / moving / blocker), lane flips, clear flags, pause / resume,
// set node, clone (with and without the distance delta), unregister / re-register, the ignore flags, free and re-create, the table overflow (60 walkers), unload and reload.
import { FIELDS } from './m7-walker-emu.mjs';

const fr = Math.fround;
const bitsOf = (() => { const f = new Float32Array(1), u = new Uint32Array(f.buffer); return (v) => { f[0] = v; return u[0]; }; })();

export function runApiBattery(E, archive, WaypointSystem, GameRecord, rng, seed, stat) {
  let where = '';
  try { return runApi(E, archive, WaypointSystem, GameRecord, rng, seed, stat, (w) => { where = w; }); } catch (e) { e.message = `${where}: ${e.message}`; throw e; }
}
function runApi(E, archive, WaypointSystem, GameRecord, rng, seed, stat, at) {
  E.reset(); E.loadMaps(); E.setDt(1);
  const sys = new WaypointSystem(); sys.load(archive); sys.dt = 1;
  const r = rng(seed);
  const msgs = []; let checked = 0;
  const eq = (what, o, p) => { checked++; if (JSON.stringify(o) !== JSON.stringify(p)) { if (msgs.length < 12) msgs.push(`${what}: original ${JSON.stringify(o)}, port ${JSON.stringify(p)}`); } };
  const s32 = (v) => v | 0;
  const cstr = (str) => { const p = E.alloc(str.length + 4); for (let i = 0; i < str.length; i++) E.mem.w8(p + i, str.charCodeAt(i)); E.mem.w8(p + str.length, 0); return p; };
  const o3 = E.alloc(16), pg = E.alloc(8), pc = E.alloc(8), pl = E.alloc(4 * 700), pi1 = E.alloc(8), pi2 = E.alloc(8);
  const cov = { queries: 0, creates: 0, nearest: 0, calls: {}, ticks: 0 };
  const bump = (k) => { cov.calls[k] = (cov.calls[k] ?? 0) + 1; };

  // ---- the map queries
  for (let map = 0; map < 4; map++) {
    const cnt = s32(E.call(0x462c34, [map]));
    eq(`map ${map} node count`, cnt, sys.mapCount(map));
    if (cnt <= 0) continue;
    for (let n = 0; n <= cnt + 1; n++) { eq(`map ${map} valid node ${n}`, s32(E.call(0x463880, [map, n])), sys.validNode(map, n) ? 1 : 0); cov.queries++; }
    for (let n = 0; n < cnt; n++) {
      E.call(0x462be9, [map, n, o3]);
      eq(`map ${map} node ${n} position`, [E.mem.f32(o3), E.mem.f32(o3 + 4), E.mem.f32(o3 + 8)], sys.nodePos(map, n)); cov.queries++;
    }
    const names = [];
    for (let n = 0; n < cnt; n++) { const nm = sys.node(map, n).name; names.push(nm, nm.slice(0, 1), nm.slice(0, Math.ceil(nm.length / 2)), nm + 'X'); }
    names.push('ZZZZ', 'W');   // (no empty name: the emulated repe cmpsb of a zero count reads before it looks at the count; the game never asks)
    for (const nm of names.filter((x) => x !== '')) { at(`find ${map} '${nm}'`); eq(`map ${map} find '${nm}'`, s32(E.call(0x462b4e, [cstr(nm), map])), sys.findNode(map, nm)); cov.queries++; }
    if (map === 2) continue;   // (the CSM map has no route matrices: the original cannot route on it)
    for (let k = 0; k < 700; k++) { const a = r.int(cnt + 3), b = r.int(cnt + 3); at(`route ${map} ${a} ${b}`); eq(`map ${map} route ${a} -> ${b}`, s32(E.call(0x463b49, [map, a, b])), sys.route(map, a, b)); cov.queries++; }
    for (let k = 0; k < 700; k++) { const a = r.int(cnt), b = r.int(cnt); eq(`map ${map} adjacent ${a} ${b}`, E.call(0x4639a7, [map, a, b]) & 0xff, sys.isAdjacent(map, a, b) ? 1 : 0); cov.queries++; }
    for (let k = 0; k < 160; k++) {
      const n = k < cnt ? k : r.int(cnt);
      at(`neighbours ${map} ${n}`); E.call(0x462c48, [map, n, pg, pc, pl]);
      const count = s32(E.mem.u32(pc)), nodes = []; for (let q = 0; q < count; q++) nodes.push(s32(E.mem.u32(pl + 4 * q)));
      eq(`map ${map} neighbours of ${n}`, { group: s32(E.mem.u32(pg)), nodes }, sys.neighbors(map, n)); cov.queries++;
    }
  }

  // ---- walkers
  const recs = [], live = [];
  const cmpWalker = (what, h) => {
    const o = E.readWalker(h), pw = sys.get(h);
    if (!pw) { eq(`${what}: port walker exists`, true, false); return; }
    for (const k of Object.keys(FIELDS)) {
      const pv = /^point\d$/.test(k) ? pw.point[+k[5]] : pw[k];
      const a = k === 'flags' ? pv >>> 0 : pv, b = o[k];
      checked++; if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) { if (msgs.length < 12) msgs.push(`${what}: ${k} original ${b}, port ${a}`); }
    }
  };
  const cmpRec = (what, i, full = true) => {
    const rn = E.readRec(i), pr = recs[i];
    eq(`${what}: record x y z`, [rn.x, rn.y, rn.z], [pr.x, pr.y, pr.z]);
    if (full) { eq(`${what}: record ry`, rn.ry, pr.ry); eq(`${what}: record matrix`, rn.m, Array.from(pr.m)); }
  };
  const cmpLists = () => {
    for (const map of [0, 1, 3]) for (let n = 0; n < sys.mapCount(map); n++) {
      const o = E.lists(map, n);
      for (let l = 0; l < 3; l++) { const pl2 = []; for (let q = sys.maps[map].heads[n * 3 + l]; q; q = q.link[l]) pl2.push(sys.slots.indexOf(q) + 1); stat.listChecks++; eq(`map ${map} node ${n} list ${l}`, o[l], pl2); }
    }
  };
  const makeWalker = (map, start, tag) => {
    const i = recs.length;
    const rec = new GameRecord(tag); rec.flags = 2; rec.index = i;
    const nd = sys.node(map, r.int(sys.mapCount(map)));
    const ry = fr((r() - 0.5) * 14);      // wider than +-pi: the heading wrap
    const rx = r() < 0.5 ? fr((r() - 0.5) * 0.4) : 0, rz = r() < 0.5 ? fr((r() - 0.5) * 0.4) : 0;      // a record on a slope keeps its pitch / roll (the apply rebuilds the rotation from all three angles)
    rec.setEuler(rx, ry, rz, fr(nd.x + (r() - 0.5) * 120), fr(nd.y + (r() - 0.5) * 20), fr(nd.z + (r() - 0.5) * 120)); rec.ry = ry; rec.rx = rx; rec.rz = rz;
    recs.push(rec);
    E.writeRec(i, rec);
    const nh = E.n.create(map, i, start), ph = sys.create(map, rec, start);
    eq(`${tag}: create(map ${map}, start ${start}) handle`, nh, ph);
    cov.creates++; if (start === -1) cov.nearest++;
    if (nh) {
      cmpWalker(`${tag} after create`, nh); cmpRec(`${tag} after create`, i);
      live.push({ h: nh, i, map, rec, unsafe: start === -2 });   // (start -2: from = to = -1: a route lookup from node -1 reads the heap in front of the node array: out of the contract)
      E.n.apply(nh, i); sys.apply(nh, rec); cmpWalker(`${tag} after apply`, nh); cmpRec(`${tag} after apply`, i);
    }
    return nh;
  };
  const tagOf = (k) => 'B' + String(k % 1000).padStart(3, '0');
  let tagN = 0;
  for (const map of [0, 1, 3]) {
    const cnt = sys.mapCount(map);
    for (const start of [-1, -1, -1, -2, -3, 0, cnt - 1, r.int(cnt), r.int(cnt)]) makeWalker(map, start, tagOf(tagN++));
  }
  cmpLists();
  const alive = (w) => { const pw = sys.get(w.h); return !!pw && pw.flags !== 0; };
  const tick = (w, tag) => {
    // one tick of the walker loop on both sides (the record follows the original's result)
    const { h, i, rec } = w;
    const on = E.n.step(h, [rec.x, rec.y, rec.z], rec.ry);
    const pos = [rec.x, rec.y, rec.z], out = { yaw: 0, dist: 0 };
    const code = sys.step(h, pos, rec.ry, out, 1);
    { const ow = E.readWalker(h); eq(`${tag}: step result`, [on.code, on.x, on.z, on.yaw, on.dist], [code, pos[0], pos[2], out.yaw, out.dist]); if (on.code !== code) eq(`${tag}: walker after step`, { flags: (ow.flags >>> 0).toString(16), goal: ow.goal, to: ow.to, next: ow.next, from: ow.from, map: ow.map }, null); }
    rec.ry = out.yaw; rec.x = pos[0]; rec.z = pos[2]; rec.rebuildYaw();
    E.writeRec(i, rec); { const a = E.recPtr(i); E.mem.wf32(a + 0x3c, on.x); E.mem.wf32(a + 0x44, on.z); E.mem.wf32(a + 0x50, on.yaw); }
    cov.ticks++;
    return code;
  };
  const other = (w) => { const c = live.filter((x) => x !== w && alive(x) && sys.get(x.h).map === sys.get(w.h).map); return c.length ? c[r.int(c.length)] : null; };
  for (let round = 0; round < 12; round++) {
    for (const w of live.slice()) {
      if (!alive(w)) continue;
      const h = w.h, tag = `walker ${h} round ${round}`;
      w.map = sys.get(h).map; const cnt = sys.mapCount(w.map);
      let op = r.int(16);
      if (w.unsafe && (op <= 4 || op === 14)) op = 11;
      bump(op); at(`${tag} op ${op}`);
      (w.hist ??= []).push(`r${round}:op${op}`); const hs = () => w.hist.slice(-6).join(' ');
      switch (op) {
        case 0: case 1: { const nd = r.int(cnt), c = r.int(2); w.dirty = false; E.n.goTo(h, nd, c); sys.goTo(h, nd, c); cmpWalker(`${tag} goTo [${hs()}]`, h); break; }
        case 2: case 3: case 4: { if (w.dirty) break; cmpLists(); for (const x of live) if (alive(x)) cmpWalker(`${tag} before ticks (walker ${x.h})`, x.h); for (let t = 0; t < 40; t++) { tick(w, `${tag} [${hs()}] tick ${t}`); } cmpWalker(`${tag} after ticks [${hs()}]`, h); break; }
        case 5: eq(`${tag} status`, s32(E.call(0x461b92, [h])), sys.status(h)); eq(`${tag} accessors`, [s32(E.call(0x461e06, [h])), s32(E.call(0x461e27, [h])), s32(E.call(0x461e48, [h]))], [sys.goalOf(h), sys.fromOf(h), sys.toOf(h)]); eq(`${tag} moving`, E.call(0x461f98, [h]) & 0xff, sys.isMoving(h) ? 1 : 0); break;
        case 6: { const p = E.call(0x461f09, [h]) >>> 0; eq(`${tag} blocker`, p ? (p - 0x30000000) / 0x68 : -1, sys.blockerRecord(h)?.index ?? -1); break; }
        case 7: E.call(0x461af9, [h]); sys.flipLane(h); cmpWalker(`${tag} flipLane`, h); break;
        case 8: E.call(0x461b2a, [w.map]); sys.flipLanes(w.map); for (const x of live) if (alive(x)) cmpWalker(`${tag} flipLanes`, x.h); break;
        case 9: E.call(0x461fc0, [h]); sys.clearFlags(h); w.dirty = true;   // (flags = 9: no caller in the executable; a step on such a walker returns what the original leaves in eax)
           cmpWalker(`${tag} clearFlags`, h); break;
        case 10: if (r() < 0.5) { E.call(0x461e69, [h]); sys.pause(h); } else { E.call(0x461f42, [h]); sys.resume(h); } cmpWalker(`${tag} pause / resume`, h); break;
        case 11: { w.unsafe = false; const nd = r.int(cnt); E.call(0x46140f, [h, nd, E.recPtr(w.i)]); sys.setNode(h, nd, w.rec); cmpWalker(`${tag} setNode`, h); cmpRec(`${tag} setNode`, w.i, false); break; }
        case 12: if (r() < 0.5) { E.call(0x46265d, [h]); sys.unregister(h); } else { E.call(0x462686, [h]); sys.reregister(h); } cmpWalker(`${tag} un/register`, h); break;
        case 13: { E.call(0x4618a5, [h, pi1, pi2]); const g = sys.getIgnore(h); eq(`${tag} ignore flags`, [s32(E.mem.u32(pi1)), s32(E.mem.u32(pi2))], [g.noYield ? 1 : 0, g.noCross ? 1 : 0]); const a = r.int(3), b = r.int(3); E.n.setIgnore(h, a, b); sys.setIgnore(h, a, b); cmpWalker(`${tag} setIgnore`, h); break; }
        case 14: { const o = other(w); if (!o) break; const d = [0, 0.01, -0.3, 2.5, 7][r.int(5)]; E.call(0x46248a, [h, o.h, bitsOf(fr(d))]); sys.clone(h, o.h, fr(d)); cmpWalker(`${tag} clone src`, h); cmpWalker(`${tag} clone dst ${o.h}`, o.h); break; }
        case 15: if (r() < 0.25) { E.n.free(h); sys.free(h); eq(`${tag} free`, E.readWalker(h).flags, (sys.get(h)?.flags ?? 0) >>> 0); live.splice(live.indexOf(w), 1); if (r() < 0.8) makeWalker(w.map, [-1, r.int(cnt), -3][r.int(3)], tagOf(tagN++)); } break;
      }
      for (const x of live) if (alive(x)) cmpRec(`${tag} after op ${op}`, x.i, false);
    }
    cmpLists();
  }
  // the table overflow: creating beyond 60 walkers returns 0 on both sides; freeing some and creating again reuses the slots
  for (let k = 0; k < 70; k++) makeWalker(3, [-1, r.int(sys.mapCount(3))][r.int(2)], tagOf(tagN++));
  for (let k = 0; k < 12; k++) { const w = live[r.int(live.length)]; if (alive(w)) { E.n.free(w.h); sys.free(w.h); live.splice(live.indexOf(w), 1); } }
  for (let k = 0; k < 14; k++) makeWalker(1, -1, tagOf(tagN++));
  for (const x of live) if (alive(x)) cmpWalker(`overflow ${x.h}`, x.h);
  cmpLists();
  // unload (FUN_00463701: frees the maps and clears the table) and reload
  E.call(0x463701); sys.unload();
  for (let map = 0; map < 4; map++) eq(`after unload: map ${map} count`, s32(E.call(0x462c34, [map])), sys.mapCount(map));
  eq('after unload: handle 1 flags', E.readWalker(1).flags >>> 0, (sys.get(1)?.flags ?? 0) >>> 0);
  const counts = E.loadMaps(); sys.load(archive);
  for (let map = 0; map < 4; map++) eq(`after reload: map ${map} count`, counts[map], sys.mapCount(map));
  return { msgs, checked, cov };
}
