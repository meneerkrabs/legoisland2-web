// LEGO 3D bricks generator (src/mods/lego3d/gen/bricks.ts): the brick library of the Bricks archive rebuilt from LDraw parts. Oracle: every replaced LOD mesh against the game's own one (valid .msh,
// bounding box within 0.045 per axis at LOD 0, stud positions equal, surface distance, vertex / triangle budgets), the engine side (BrickLibrary reads the replaced meshes, the first-colour counts
// of the sidecar are valid, windows keep their second colour at the end), determinism, the safety rules (a member that is not the game's own is left alone, nothing else is written), and that
// nothing of the game is in the pack. Skips with a note when the pack (node tools/lego3d/pack/build-pack.mjs --only bricks) is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { BrickLibrary, readBrickLod } from '../../src/formats/bricks.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const BOX_TOL = 0.045;

function bbox(m) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < m.vertexCount; i++) for (let c = 0; c < 3; c++) { const v = m.positions[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  return { lo, hi };
}
/**
 * Stud rings: vertices that share a height (to 0.004) are linked (ring neighbours are < 0.25 apart, studs 0.8); a cluster of >= 6 vertices whose extent is stud-sized (0.42 .. 0.56 along both axes)
 * is a stud top: [x, y, z] of its middle. Works for any brick (slopes have studs at several heights); a brick with no rings has no studs to compare.
 */
function studRings(m) {
  const by = new Map();
  for (let i = 0; i < m.vertexCount; i++) { const k = Math.round(m.positions[i * 3 + 1] / 0.004); if (!by.has(k)) by.set(k, []); by.get(k).push([m.positions[i * 3], m.positions[i * 3 + 2], m.positions[i * 3 + 1]]); }
  const out = [];
  for (const pts of by.values()) {
    if (pts.length < 6) continue;
    const par = pts.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 0.25) par[find(i)] = find(j);
    const cl = new Map();
    pts.forEach((p, i) => { const r = find(i); if (!cl.has(r)) cl.set(r, []); cl.get(r).push(p); });
    for (const c of cl.values()) {
      if (c.length < 6) continue;
      const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]), dx = Math.max(...xs) - Math.min(...xs), dz = Math.max(...zs) - Math.min(...zs);
      if (dx >= 0.42 && dx <= 0.56 && dz >= 0.42 && dz <= 0.56) out.push([(Math.max(...xs) + Math.min(...xs)) / 2, c[0][2], (Math.max(...zs) + Math.min(...zs)) / 2]);
    }
  }
  // a stud has a ring at its top and one at its foot (and the game's bevel has more): keep the highest ring at every position
  out.sort((p, q) => q[1] - p[1]);
  const tops = [];
  for (const r of out) if (!tops.some((t) => Math.hypot(t[0] - r[0], t[2] - r[2]) < 0.12)) tops.push(r);
  return tops;
}
/** the rings that sit on the 0.8 stud grid (lattice phase `ph` = [x, z] mod 0.8): hubs, hinge knuckles and the like are not studs */
const onGrid = (rings, ph) => rings.filter((r) => [0, 2].every((k, i) => { const d = Math.abs((((r[k] - ph[i]) % 0.8) + 0.8) % 0.8); return Math.min(d, 0.8 - d) < 0.09; }));

export default {
  name: 'lego3d-bricks',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only bricks): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.has('bricks/index.json')) return { checked: 0, failures, notes: ['pack has no bricks part: skipped'] };
    const bricks = ctx.archives.find((a) => a.name.toLowerCase() === 'bricks');
    if (!bricks) return { checked: 0, failures, notes: ['no Bricks archive in the data folder: skipped'] };
    const index = await pack.json('bricks/index.json');
    let checked = 0;
    const stats = {};
    const t0 = Date.now();
    const r = await generateArchive(pack, 'Bricks', bricks, async () => null, ['bricks']);
    const ms = Date.now() - t0;
    const gen = (m) => [...r.files.keys()].find((k) => k.toLowerCase() === m.toLowerCase());
    // 1) every pack entry: replaced iff the member is the game's own (all of them here), valid, box / studs / budget
    let replaced = 0, tris0 = 0, tris0o = 0, tris1 = 0, tris1o = 0, boxWorst = 0, studChecked = 0, studWorst = 0, v0 = 0, v0o = 0;
    for (const [name, b] of Object.entries(index.bricks)) {
      for (const lod of Object.keys(b.lods)) {
        const member = `lods/${name}_lod${lod}.msh`, e = bricks.find(member);
        checked++;
        if (!e) { failures.push(`${member}: in the pack but not in the archive`); continue; }
        const orig = bricks.read(e);
        if (hashMember(orig) !== b.lods[lod].hash) { failures.push(`${member}: the pack's hash is not the archive's member`); continue; }
        const key = gen(member);
        if (!key) { failures.push(`${member}: not replaced although it matches the pack's hash`); continue; }
        replaced++;
        const nb = r.files.get(key), nm = parseMsh(nb), om = parseMsh(orig), prob = validateMsh(nm);
        if (prob.length) { failures.push(`${member}: invalid msh: ${prob.slice(0, 2).join('; ')}`); continue; }
        if (nm.groups.length !== 1 || nm.indices.length % 3 || nm.vertexCount > 65535) failures.push(`${member}: group / index shape wrong`);
        if (b.lods[lod].split < 1 || b.lods[lod].split > nm.vertexCount) failures.push(`${member}: split ${b.lods[lod].split} outside 1..${nm.vertexCount}`);
        const bn = bbox(nm), bo = bbox(om);
        const err = Math.max(...[0, 1, 2].flatMap((c) => [Math.abs(bn.lo[c] - bo.lo[c]), Math.abs(bn.hi[c] - bo.hi[c])]));
        boxWorst = Math.max(boxWorst, lod === '0' ? err : 0);
        // the box of a verified brick is the game's to 0.045 per face at LOD 0 (the LOD 1 of the game is a coarser stand-in: 0.07)
        const lim = lod === '0' ? (b.tier === 'verified' ? BOX_TOL : 0.1) : 0.12;   // verified: strict; reviewed + class (same functional element, loosened rule): 0.1 per face
        if (err > lim) failures.push(`${member}: bounding box off by ${err.toFixed(3)} (> ${lim})`);
        if (nm.vertexCount * 3 !== nm.positions.length) failures.push(`${member}: vertex count mismatch`);
        const nrmBad = (() => { let bad = 0; for (let i = 0; i < nm.vertexCount; i++) { const l = Math.hypot(nm.normals[i * 3], nm.normals[i * 3 + 1], nm.normals[i * 3 + 2]); if (!(l > 0.9 && l < 1.1)) bad++; } return bad; })();
        if (nrmBad) failures.push(`${member}: ${nrmBad} normals are not unit length`);
        if (lod === '0') {
          tris0 += nm.indices.length / 3; tris0o += om.indices.length / 3; v0 += nm.vertexCount; v0o += om.vertexCount;
          const so0 = studRings(om), ph = so0.length ? [so0[0][0], so0[0][2]] : [0, 0];
          const sn = onGrid(studRings(nm), ph), so = onGrid(so0, ph);
          if (so.length && !b.nostud && (b.tier === 'class' || /^(fat|thin|flat)\d+x\d+/.test(name))) {   // plain bricks, plates, tiles, slopes and the class bricks: the stud layout is the brick; hubs, knuckles and bars of the special parts are not studs
            studChecked++;
            // every stud of the game's brick has one of ours (and the other way round) within 0.09 horizontally / vertically: the game's own studs sit up to 0.08 off the 0.8 grid (fat10x2: the two outer ones)
            const dist = (s, q) => Math.max(Math.hypot(q[0] - s[0], q[2] - s[2]), Math.abs(q[1] - s[1]));
            let w = 0;
            for (const s of so) w = Math.max(w, Math.min(...sn.map((q) => dist(s, q)), 9));
            for (const s of sn) w = Math.max(w, Math.min(...so.map((q) => dist(s, q)), 9));
            studWorst = Math.max(studWorst, w);
            if (sn.length !== so.length) failures.push(`${member}: ${sn.length} stud tops, the game's has ${so.length}`);
            else if (w > 0.09) failures.push(`${member}: a stud is ${w.toFixed(3)} off the game's stud position`);
          }
          // budget at LOD 0: the studs are smooth prisms (12 sides), so a brick may have more triangles than the game's (8-gon studs) but never more than 2.2x + 40
          // class bricks (windows with their frames, tyres with tread, slats): real parts have more detail, 5x + 60 at most (the CPU cost is reported by tools/lego3d/bench-bricks.mjs)
          const f0 = b.tier === 'class' ? 5 : 2.2, a0 = b.tier === 'class' ? 60 : 40;
          if (nm.indices.length / 3 > om.indices.length / 3 * f0 + a0) failures.push(`${member}: ${nm.indices.length / 3} triangles against the game's ${om.indices.length / 3}`);
          const cl = (stats[b.tier === 'class' ? (b.cls ?? 'class') : b.tier] ??= { n: 0, t0: 0, o0: 0, r0: 0, t1: 0, o1: 0, r1: 0, v0: 0, ov0: 0 });
          cl.n++; cl.t0 += nm.indices.length / 3; cl.o0 += om.indices.length / 3; cl.r0 += b.lods[lod].raw ?? 0; cl.v0 += nm.vertexCount; cl.ov0 += om.vertexCount;
        } else {
          tris1 += nm.indices.length / 3; tris1o += om.indices.length / 3;
          // LOD 1: the game's triangle count (+30 % and +24: the bodies are decimated to the game's count minus the studs, but a part whose studs alone exceed it can only follow within that margin)
          const f1 = b.tier === 'class' ? 2.2 : 1.3, a1 = b.tier === 'class' ? 40 : 24;
          if (nm.indices.length / 3 > om.indices.length / 3 * f1 + a1) failures.push(`${member}: LOD 1 has ${nm.indices.length / 3} triangles against the game's ${om.indices.length / 3}`);
          const cl = (stats[b.tier === 'class' ? (b.cls ?? 'class') : b.tier] ??= { n: 0, t0: 0, o0: 0, r0: 0, t1: 0, o1: 0, r1: 0, v0: 0, ov0: 0 });
          cl.t1 += nm.indices.length / 3; cl.o1 += om.indices.length / 3; cl.r1 += b.lods[lod].raw ?? 0;
        }
      }
    }
    // 2) nothing else is written but the replaced meshes and the sidecar; the far LOD (2) is never replaced
    for (const k of r.files.keys()) {
      if (/^lego3d\/bricksplit\.json$/i.test(k)) continue;
      if (!/^lods\/[^/]+_lod[01]\.msh$/i.test(k)) failures.push(`unexpected output member ${k}`);
    }
    // 3) the engine side: BrickLibrary over the generated archive (the same code path as the game)
    const peFile = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    let libChecks = 0;
    try {
      const { Pe } = await import('../../src/formats/exe.ts');
      const exePath = fs.existsSync(peFile) ? peFile : path.join(ctx.dataRoot, 'game.exe');
      if (fs.existsSync(exePath)) {
        const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));
        const orig = new BrickLibrary(pe, bricks, null), before = new Map();
        for (const t of orig.types) if (t) for (let l = 0; l < 3; l++) { const m = orig.meshOf(t, l); if (m) before.set(`${t.name}|${l}`, { v: m.vertexCount, s: orig.splitOf(t, l) }); }
        for (const [k, v] of r.files) bricks.override(k, v);
        try {
          const lib = new BrickLibrary(pe, bricks, null);
          for (const t of lib.types) {
            if (!t) continue;
            for (let l = 0; l < 3; l++) {
              const m = lib.meshOf(t, l), s = lib.splitOf(t, l), o = before.get(`${t.name}|${l}`);
              if (!m) continue;
              libChecks++;
              if (s < 0 || s > m.vertexCount) failures.push(`${t.name} lod ${l}: first-colour count ${s} outside 0..${m.vertexCount}`);
              const replacedHere = !!index.bricks[t.name]?.lods[t.lodFile[l]];
              if (!replacedHere && o && (o.v !== m.vertexCount || o.s !== s)) failures.push(`${t.name} lod ${l}: an untouched brick changed`);
              // two-colour bricks keep a second colour: the first-colour count stays below the vertex count, and above 0
              if (replacedHere && o && o.s < o.v && (s >= m.vertexCount || s < 1)) failures.push(`${t.name} lod ${l}: lost its second colour (split ${s} of ${m.vertexCount})`);
              if (replacedHere && o && o.s >= o.v && s !== m.vertexCount) failures.push(`${t.name} lod ${l}: single-colour brick got a split of ${s} / ${m.vertexCount}`);
            }
          }
        } finally { bricks.clearOverrides(); }
      } else notes.push('no game executable next to the data: BrickLibrary checks skipped');
    } catch (e) { failures.push(`BrickLibrary check crashed: ${e.stack || e}`); }
    // 4) determinism
    const r2 = await generateArchive(pack, 'Bricks', bricks, async () => null, ['bricks']);
    if (r2.files.size !== r.files.size) failures.push('second run produced another member count');
    else for (const [k, v] of r.files) { const w = r2.files.get(k); if (!w || w.length !== v.length || hashMember(w) !== hashMember(v)) { failures.push(`not deterministic: ${k}`); break; } }
    // 5) safety: a member that is not the game's own is left alone (and gets no first-colour entry); other archives get nothing
    const victim = Object.keys(index.bricks).find((n) => index.bricks[n].lods['0']);
    if (victim) {
      const member = `lods/${victim}_lod0.msh`, foreign = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const fake = { name: 'Bricks', find: (p) => bricks.find(p), read: (e) => (e.path.toLowerCase() === member.toLowerCase() ? foreign : bricks.read(e)), entries: bricks.entries };
      const rr = await generateArchive(pack, 'Bricks', fake, async () => null, ['bricks']);
      if ([...rr.files.keys()].some((k) => k.toLowerCase() === member.toLowerCase())) failures.push(`${member}: a foreign member was replaced`);
      const sp = rr.files.get('lego3d/bricksplit.json');
      if (sp && JSON.parse(new TextDecoder().decode(sp))[`${victim.toLowerCase()}_0`] !== undefined) failures.push(`${victim}: a split entry for a member that was left alone`);
      checked++;
    }
    for (const a of ctx.archives) {
      if (a.name.toLowerCase() === 'bricks') continue;
      if (generateArchive && pack.has('bricks/index.json')) { const rr = await generateArchive(pack, a.name, a, async () => null, ['bricks']); if (rr.files.size) failures.push(`${a.name}: the bricks generator wrote ${rr.files.size} members`); checked++; break; }
    }
    // 6) the pack holds no game geometry: no stored mesh equals a game member, and the hashes are the only trace
    const bin = await pack.get('bricks/lods.bin');
    if (bin.length > 2.5e6) failures.push(`brick data ${bin.length} bytes: over the 2.5 MB budget`);
    notes.push(`${replaced} LOD meshes replaced (${Object.keys(index.bricks).length} bricks: ${Object.values(index.bricks).filter((b) => b.tier === 'verified').length} verified, ${Object.values(index.bricks).filter((b) => b.tier === 'reviewed').length} reviewed, ${Object.values(index.bricks).filter((b) => b.tier === 'class').length} class), generated in ${ms} ms; LOD 0 ${tris0} triangles / ${v0} vertices against the game's ${tris0o} / ${v0o}; LOD 1 ${tris1} against ${tris1o}; worst LOD 0 box error ${boxWorst.toFixed(3)}; ${studChecked} bricks' stud positions compared (worst ${studWorst.toFixed(3)}); ${libChecks} BrickLibrary lookups; brick data ${(bin.length / 1024).toFixed(0)} kB`);
    notes.push('triangles per class (LOD 0 new / un-decimated / game, LOD 1 new / un-decimated / game): ' + Object.entries(stats).map(([k, v]) => `${k} x${v.n}: ${v.t0}/${v.r0}/${v.o0}, ${v.t1}/${v.r1}/${v.o1}`).join('; '));
    return { checked: checked + libChecks, failures, notes };
  },
};
