import { loadZone } from '../lib/engine-load.mjs';
import { createEmu, colQueries } from '../lib/m7-walk-emu.mjs';
import { collisionInternals as CI } from '../../src/game/collision.ts';
import { rng } from '../lib/m7-walk-run.mjs';

const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
const f32bits = (v) => { FB[0] = v; return UB[0]; };

// M7 / WP-VERIFY: the collision queries of src/game/collision.ts (sweep FUN_00441270, probe FUN_00441ac0, ray FUN_00441b10 with its hit cache, terrain FUN_0043cd62 / 004425f0, the box and
// sphere helpers FUN_0043f810 / 0043f9b0 / 0043d5ec / 0043d159) against the ORIGINAL functions run in the x86 emulation on the zone's real .col data (loaded by the original's own
// loader FUN_0043f370). The port follows the compiled code store by store in float32 (see the header of collision.ts), so every result must be IDENTICAL (tolerance 0): the record, the
// polygon (object, index), the point, the normal, the footstep surface, and the global state afterwards (the hit cache of FUN_00441b10: record, end points, the polygon of the last hit).
// Query kinds: random segments around every collision object (masks 1 / 2 / 3 / 0x43 / 0xc3, radius 0.01 .. 1.4, skin 0 .. 1), walker-like sweeps (feet, chest, head, ledge probe,
// camera ladder), terrain rays and ball rays in sequences with locality (the hit cache only works for repeated nearby rays), interleaved sweeps (they replace the polygon the cache uses).
export default {
  name: 'm7-walk-col',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 25) failures.push(m); else if (failures.length === 25) failures.push('... more failures'); };
    const T0 = Date.now();
    const kinds = {};
    const bump = (k, n = 1) => { kinds[k] = (kinds[k] ?? 0) + n; };
    const f32 = Math.fround;
    const same3 = (a, b) => a.every((v, i) => v === b[i]);

    const zones = [['z02LGI', 3500], ['z03PPH', 1500], ['z50LTC', 1500], ['z10RGB', 1500], ['z18MMP', 1500], ['z28HAT', 1000]];
    for (const [zone, N] of zones) {
      let L;
      try { L = loadZone(ctx, zone); } catch (e) { notes.push(`${zone}: not loadable (${e.message})`); continue; }
      const w = L.world;
      const E = createEmu(ctx, zone, w.records);
      E.syncColObjects(); E.mirrorAll(); E.setGround(w.col.groundRec);
      const Q = colQueries(E);
      const r = rng(zone.charCodeAt(3) * 131 + zone.charCodeAt(4));
      const recs = w.records.filter((x) => x.colObj && x.colObj.radius > 0);
      const polyRecs = recs.filter((x) => x.colObj.col.hasPolys);
      let hits = 0, boxHits = 0, rayHits = 0, cacheTests = 0;
      const compare = (label, a, b, q) => {
        checked += 6;
        const ah = !!a, bh = !!b;
        if (ah !== bh) { bad(`${zone} ${label}: hit original ${ah}, port ${bh} ${q()}`); return; }
        // polygon / cache state after the query: always compared
        const ca = E.readCache(), cb = E.portCache(w.col);
        if (JSON.stringify(ca.poly) !== JSON.stringify(cb.poly) || ca.rec !== cb.rec) bad(`${zone} ${label}: cache state original ${JSON.stringify(ca)}, port ${JSON.stringify(cb)} ${q()}`);
        else if (cb.rec >= 0 && !(same3(ca.from.map(f32), cb.from.map(f32)) && same3(ca.to.map(f32), cb.to.map(f32)))) bad(`${zone} ${label}: cached ray end points differ ${q()}`);
        if (!ah) return;
        hits++;
        if (a.rec !== b.rec) { bad(`${zone} ${label}: record original ${a.rec.name}, port ${b.rec.name} ${q()}`); return; }
        if (!same3(a.point, b.point)) bad(`${zone} ${label}: point original ${a.point}, port ${b.point} ${q()}`);
        if (!same3(a.normal, b.normal)) bad(`${zone} ${label}: normal original ${a.normal}, port ${b.normal} ${q()}`);
        if (a.surface !== b.surface) bad(`${zone} ${label}: surface original ${a.surface}, port ${b.surface} ${q()}`);
        if (b.polygon < 0) boxHits++;
      };
      const fmt = (v) => `[${Array.from(v).map((x) => +x.toFixed(4))}]`;
      // ---- random sweeps / probes
      for (let i = 0; i < N; i++) {
        const rec = recs[r.int(recs.length)];
        const cw = rec.toWorld(rec.colObj.col.center);
        const R = rec.colObj.radius * Math.max(1, rec.scale?.[0] ?? 1) + 4;
        const from = [cw[0] + (r() - .5) * 2 * R, cw[1] + (r() - .5) * 2 * R, cw[2] + (r() - .5) * 2 * R];
        const len = [0.4, 1.5, 6, 20][r.int(4)];
        const d = [(r() - .5) * len, (r() - .5) * len, (r() - .5) * len];
        const k = r.int(6);
        const [mask, rad, skin] = [[3, 0.6, 0.2], [1, 0.6, 0.2], [0xc3, 1, 1], [0x43, 0.4, 0.4], [3, 0.01, 0], [1, 1.4, 0.2]][k];
        const ignore = r() < 0.2 ? rec : null;
        const q = () => `from ${fmt(from)} d ${fmt(d)} mask ${mask} r ${rad} s ${skin} ignore ${ignore?.name}`;
        const probe = k === 4 && r() < 0.5;
        const a = probe ? Q.probe(ignore, from, d, mask) : Q.sweep(ignore, from, d, mask, rad, skin);
        const b = probe ? w.col.probe(ignore, from, d, mask) : w.col.sweep(ignore, from, d, mask, rad, skin);
        bump(probe ? 'probe' : 'sweep');
        compare(probe ? 'probe' : 'sweep', a, b, q);
      }
      // ---- rays with locality: terrain-like (vertical, mask 3, r 1.0 s 0.1), ball-like (mask 2, 0.01, 0), mixed with sweeps that replace the last polygon
      const g = w.col.groundRec ?? polyRecs[0];
      if (g) {
        const cg = g.toWorld(g.colObj.col.center), hg = g.colObj.col.halfExtents;
        let p = [cg[0] + (r() - .5) * hg[0], cg[1] + hg[1] * 0.5, cg[2] + (r() - .5) * hg[2]];
        for (let i = 0; i < N; i++) {
          if (r() < 0.04) p = [cg[0] + (r() - .5) * 2 * hg[0], cg[1] + (r() - .2) * 2 * hg[1] + 5, cg[2] + (r() - .5) * 2 * hg[2]];
          else p = p.map((v, k) => v + (r() - .5) * (k === 1 ? 1.5 : 3));
          const kind = r.int(5);
          if (kind === 0) {
            // the terrain ray (FUN_0043cd62)
            const a = Q.terrain(p[0], p[1], p[2], 4), b = w.col.terrainHeight(p[0], p[1], p[2], 4);
            checked++; bump('terrain');
            const ca = E.readCache(), cb = E.portCache(w.col);
            const ah = a < -1e30, bh = b < -1e30;
            if (ah !== bh || (!ah && f32(a) !== f32(b))) bad(`${zone} terrain at ${fmt(p)}: original ${a}, port ${b}`);
            else if (JSON.stringify(ca.poly) !== JSON.stringify(cb.poly) || ca.rec !== cb.rec) bad(`${zone} terrain at ${fmt(p)}: cache state original ${JSON.stringify(ca)}, port ${JSON.stringify(cb)}`);
            if (!ah) rayHits++;
          } else if (kind === 1) {
            const rec = r() < 0.5 ? g : polyRecs[r.int(polyRecs.length)];
            const d = [(r() - .5) * 6, -r() * 5, (r() - .5) * 6];
            const q = () => `from ${fmt(p)} d ${fmt(d)} on ${rec.name}`;
            const a = Q.ray(rec, p, d, 2, 0.01, 0), b = w.col.rayRecord(rec, p, d, 2, 0.01, 0);
            bump('ray (ball)'); compare('ray', a, b, q); if (a) rayHits++;
          } else if (kind === 2) {
            const rec = r() < 0.7 ? g : polyRecs[r.int(polyRecs.length)];
            const d = [0, -(20 + r() * 80), 0];
            const rad = [1.0, 0.8, 0.01][r.int(3)], sk = rad === 1 ? 0.1 : rad === 0.8 ? 0.08 : 0.01;
            const q = () => `from ${fmt(p)} d ${fmt(d)} on ${rec.name} r ${rad} s ${sk}`;
            const a = Q.ray(rec, p, d, 3, rad, sk), b = w.col.rayRecord(rec, p, d, 3, rad, sk);
            bump('ray (down)'); compare('ray', a, b, q); if (a) rayHits++;
          } else {
            // a walker-like sweep near the same place: replaces the last-hit polygon the cache uses
            const d = r() < 0.5 ? [0, -8, 0] : [(r() - .5) * 2, 0, (r() - .5) * 2];
            const [mask, rad, skin] = [[3, 0.6, 0.2], [1, 0.6, 0.2], [3, 0.01, 0]][r.int(3)];
            const q = () => `from ${fmt(p)} d ${fmt(d)} mask ${mask}`;
            const a = Q.sweep(null, p, d, mask, rad, skin), b = w.col.sweep(null, p, d, mask, rad, skin);
            bump('sweep (near)'); compare('sweep', a, b, q);
          }
        }
      }
      // ---- the helpers on their own (box tests of FUN_0043f9b0 / 0043f810, the box intersection FUN_0043d5ec, the sphere FUN_0043d159, the transforms) natively against the port's functions
      {
        const { cpu, mem } = E;
        const base = E.alloc(512); const pa = base, pb = base + 16, pc = base + 32, ph = base + 48, po = base + 64, pn = base + 80;
        const w3 = (pp, v) => Array.from(v).forEach((x, i) => mem.wf32(pp + 4 * i, x));
        const a = new Float32Array(3), b = new Float32Array(3);
        for (let i = 0; i < 1500; i++) {
          const c = [(r() - .5) * 4, (r() - .5) * 4, (r() - .5) * 4].map(f32), h = [0.2 + r(), 0.2 + r(), 0.2 + r()].map(f32);
          const sc = [0.5, 2, 8][i % 3];
          for (let k = 0; k < 3; k++) { a[k] = c[k] + (r() - .5) * sc * 2; b[k] = c[k] + (r() - .5) * sc * 2; }
          w3(pa, a); w3(pb, b); w3(pc, c); w3(ph, h);
          cpu.steps = 0;
          const ex = cpu.call(0x43f9b0, [pa, pb, pc, ph]) & 0xff, qk = cpu.call(0x43f810, [pa, pb, pc, ph]) & 0xff;
          const pe = CI.segBoxExact(a, b, c[0], c[1], c[2], h[0], h[1], h[2]) ? 1 : 0, pq = CI.segBoxQuick(a, b, c[0], c[1], c[2], h[0], h[1], h[2]) ? 1 : 0;
          checked += 2; bump('box helper');
          if (ex !== pe) bad(`${zone} FUN_0043f9b0 (box exact): original ${ex}, port ${pe} a ${fmt(a)} b ${fmt(b)} c ${fmt(c)} h ${fmt(h)}`);
          if (qk !== pq) bad(`${zone} FUN_0043f810 (box quick): original ${qk}, port ${pq} a ${fmt(a)} b ${fmt(b)} c ${fmt(c)} h ${fmt(h)}`);
          // the crossing function with its out point (failed candidates leave their coordinates in it)
          const aa = [a[0] - c[0], a[1] - c[1], a[2] - c[2]].map(f32), bb = [b[0] - c[0], b[1] - c[1], b[2] - c[2]].map(f32);
          w3(pa, aa); w3(pb, bb); mem.wf32(po, 77); mem.wf32(po + 4, 77); mem.wf32(po + 8, 77);
          cpu.call(0x43d5ec, [pa, pb, ph, po, pn]); const to = cpu.fpop();
          const tp = CI.segAabb(aa[0], aa[1], aa[2], bb[0], bb[1], bb[2], h[0], h[1], h[2]);
          checked += 1; bump('box crossing');
          if (to !== tp) bad(`${zone} FUN_0043d5ec: original t ${to}, port ${tp}`);
        }
        // the ray / sphere function
        for (let i = 0; i < 1500; i++) {
          const c = [(r() - .5) * 20, (r() - .5) * 20, (r() - .5) * 20].map(f32), rad = f32(0.5 + r() * 12);
          for (let k = 0; k < 3; k++) { a[k] = c[k] + (r() - .5) * 40; b[k] = a[k] + (r() - .5) * [2, 30, 200][i % 3]; }
          w3(pa, a); w3(pb, b); w3(pc, c);
          cpu.steps = 0; cpu.call(0x43d159, [pa, pb, pc, f32bits(rad)]); const to = cpu.fpop();
          const tp = CI.raySphereT(a, b, c, rad);
          checked += 1; bump('ray / sphere');
          if (to !== tp && !(Number.isNaN(to) && Number.isNaN(tp))) bad(`${zone} FUN_0043d159: original ${to}, port ${tp} a ${fmt(a)} b ${fmt(b)} c ${fmt(c)} r ${rad}`);
        }
      }
      notes.push(`${zone}: ${recs.length} collision records, hits compared ${hits} (${boxHits} box shapes), terrain / ray hits ${rayHits}`);
    }
    notes.push(`queries: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}; ${Date.now() - T0} ms; compared bit for bit (tolerance 0): record, polygon (object, index), point, normal, surface, hit cache`);
    return { checked, failures, notes };
  },
};
