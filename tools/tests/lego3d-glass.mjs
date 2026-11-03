// LEGO 3D "glass" generator (src/mods/lego3d/gen/glass.ts, docs/re/lego3d.md section 16.10): the back of the game's one-sided glass for the meshes the LEGO 3D option does not replace.
// ORACLES: (1) the serialiser is parseMsh's exact inverse: parse -> serialise gives the SAME BYTES for every mesh of every archive (what a game mesh must survive before it is ever changed);
// (2) for every mesh of the table the output differs from the input by the added triangles ONLY: group count / order / flags, GTOM / MATL, every vertex (position, colour, uv, uv2, normal), every index
// and every group of the original, byte for byte, in the same order (the groups after a glass group shifted by the added counts); the added triangles are reversed copies (same corners, colour, uv, uv2,
// negated normals, reversed winding) of triangles that had no partner, in glass groups of the table only, none of them paired before, all of the glass groups paired after (a second run adds nothing);
// (3) the pairing rule equals the one of the sets generator (`addBackFaces` of sets.ts) on every glass group; (4) cost: triangles added per zone, a per-mesh ceiling; the option off (`-glass`) writes
// nothing, a foreign mesh / a skinned mesh / a mesh that does not round-trip / a changed group count is left alone; combined with the studs the output equals the studs' output plus the added triangles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { serialiseMsh, mshRoundTrips, addBackFaces, unpairedTriangles } from '../../src/mods/lego3d/gen/glass.ts';
import { addBackFaces as setsBackFaces } from '../../src/mods/lego3d/gen/sets.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const MAX_PER_MESH = 1000;   // measured maximum is 300; a mesh beyond this would be a table error

const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
/** the vertex `v` of a mesh as one comparable record */
const vert = (m, v, negate = false) => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2], m.colors[v], m.uvs[v * 2], m.uvs[v * 2 + 1], m.uvs2[v * 2], m.uvs2[v * 2 + 1], ...[0, 1, 2].map((c) => (negate ? -m.normals[v * 3 + c] : m.normals[v * 3 + c]))];

/** compares an output mesh with its input: returns the failures; `glass` = the table's glass groups */
function compare(tag, a, b, glass) {
  const f = [];
  if (b.groups.length !== a.groups.length) return [`${tag}: ${a.groups.length} groups became ${b.groups.length}`];
  if (!(a.gtom === null ? b.gtom === null : b.gtom && same([...a.gtom], [...b.gtom]))) f.push(`${tag}: GTOM changed`);
  if (!(a.matl === null ? b.matl === null : b.matl && same([...a.matl], [...b.matl]))) f.push(`${tag}: MATL changed`);
  if (b.svwl) f.push(`${tag}: skin data appeared`);
  const bad = validateMsh(b); if (bad.length) f.push(`${tag}: invalid mesh ${bad.join('; ')}`);
  let added = 0;
  a.groups.forEach((ga, gi) => {
    const gb = b.groups[gi];
    if (ga.flags !== gb.flags) f.push(`${tag}: group ${gi} flags ${ga.flags} -> ${gb.flags}`);
    const isGlass = glass.includes(gi);
    if (!isGlass && (gb.vertexCount !== ga.vertexCount || gb.indexCount !== ga.indexCount)) { f.push(`${tag}: group ${gi} (not glass) changed size`); return; }
    if (gb.vertexCount < ga.vertexCount || gb.indexCount < ga.indexCount) { f.push(`${tag}: group ${gi} shrank`); return; }
    for (let i = 0; i < ga.vertexCount; i++) if (!same(vert(a, ga.firstVertex + i), vert(b, gb.firstVertex + i))) { f.push(`${tag}: group ${gi} vertex ${i} differs`); return; }
    for (let i = 0; i < ga.indexCount; i++) if (a.indices[ga.firstIndex + i] !== b.indices[gb.firstIndex + i]) { f.push(`${tag}: group ${gi} index ${i} differs`); return; }
    const nv = gb.vertexCount - ga.vertexCount, ni = gb.indexCount - ga.indexCount;
    if (!nv && !ni) return;
    if (ni % 3) { f.push(`${tag}: group ${gi} added ${ni} indices`); return; }
    // the new triangles: a reversed copy of an original triangle with no partner (same corners in the other order)
    const un = new Set(unpairedTriangles(a, gi)), used = new Set();
    for (let t = 0; t < ni / 3; t++) {
      const idx = [0, 1, 2].map((k) => b.indices[gb.firstIndex + ga.indexCount + t * 3 + k]);
      if (idx.some((v) => v < ga.vertexCount || v >= gb.vertexCount)) { f.push(`${tag}: group ${gi} added triangle ${t} uses an old vertex`); return; }
      // find its source: the unpaired triangle whose corners (positions, colour, uv, uv2, negated normal) match with the winding reversed
      let src = -1;
      for (const s of un) {
        if (used.has(s)) continue;
        const so = [0, 1, 2].map((k) => a.indices[ga.firstIndex + s * 3 + k] + ga.firstVertex);
        const want = [so[0], so[2], so[1]].map((v) => vert(a, v, true));
        if ([0, 1, 2].every((k) => same(want[k], vert(b, idx[k] + gb.firstVertex)))) { src = s; break; }
      }
      if (src < 0) { f.push(`${tag}: group ${gi} added triangle ${t} is no reversed copy of an unpaired triangle`); return; }
      used.add(src);
    }
    if (used.size !== un.size) f.push(`${tag}: group ${gi}: ${un.size} unpaired triangles, ${used.size} backs`);
    if (nv > used.size * 3) f.push(`${tag}: group ${gi} added ${nv} vertices for ${used.size} triangles`);
    added += ni / 3;
    if (unpairedTriangles(b, gi).length) f.push(`${tag}: group ${gi} still has unpaired triangles`);
  });
  // everything after the last group: nothing else (the vertex / index totals add up)
  const sumV = b.groups.reduce((s, g) => s + g.vertexCount, 0), sumI = b.groups.reduce((s, g) => s + g.indexCount, 0);
  if (sumV !== b.vertexCount || sumI !== b.indices.length) f.push(`${tag}: group totals do not cover the mesh`);
  return f.length ? f : { added };
}

export default {
  name: 'lego3d-glass',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    // (1) the byte-level round trip of every mesh of every archive
    let meshes = 0, rt = 0;
    for (const { archive, entry, data } of ctx.entries(/\.msh$/i)) {
      let m; try { m = parseMsh(data); } catch { continue; }   // (the format test covers the parse itself)
      meshes++; checked++;
      let back; try { back = serialiseMsh(m); } catch (e) { failures.push(`${archive.name}/${entry.path}: serialise threw ${e.message}`); continue; }
      if (back.length === data.length && back.every((v, i) => v === data[i])) rt++; else failures.push(`${archive.name}/${entry.path}: parse -> serialise is not byte-identical (${data.length} -> ${back.length} bytes)`);
      if (!mshRoundTrips(data)) failures.push(`${archive.name}/${entry.path}: mshRoundTrips disagrees`);
    }
    notes.push(`round trip: ${rt} of ${meshes} meshes of ${ctx.archives.length} archives parse -> serialise byte for byte`);
    if (!fs.existsSync(PACK)) return { checked, failures, notes: [...notes, 'LEGO 3D pack absent: the table part skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const tables = pack.names('glass/arch/');
    if (!tables.length) return { checked, failures, notes: [...notes, 'pack has no glass part (node tools/lego3d/pack/build-pack.mjs --only glass): the table part skipped'] };
    let nMesh = 0, nTris = 0, maxMesh = 0, nVerts = 0, nBytes = 0, setsDiff = 0, setsGroups = 0, coveredKept = 0;
    const per = [];
    for (const tn of tables) {
      const table = await pack.json(tn), arch = ctx.archives.find((a) => a.name.toLowerCase() === table.archive.toLowerCase());
      if (!arch) { notes.push(`${table.archive}: archive not in the data folder, skipped`); continue; }
      const r = await generateArchive(pack, arch.name, arch, async () => null, ['glass']);
      const off = await generateArchive(pack, arch.name, arch, async () => null, ['-glass']);
      if ([...off.by.values()].includes('glass')) failures.push(`${arch.name}: -glass still writes glass members`);
      const key = (m) => [...r.files.keys()].find((k) => k.toLowerCase() === m.toLowerCase());
      let zTris = 0;
      for (const e of table.meshes) {
        checked++;
        const tag = `${arch.name}/${e.m}`, ent = arch.find(e.m);
        if (!ent) { failures.push(`${tag}: in the table but not in the archive`); continue; }
        const orig = arch.read(ent);
        if (hashMember(orig) !== e.h) { failures.push(`${tag}: the table's hash is not the archive's member`); continue; }
        const am = parseMsh(orig);
        if (am.groups.length !== e.c) failures.push(`${tag}: ${am.groups.length} groups, the table has ${e.c}`);
        const k = key(e.m);
        if (!k) { failures.push(`${tag}: not generated`); continue; }
        if (r.by.get(k) !== 'glass') failures.push(`${tag}: written by ${r.by.get(k)}`);
        const out = r.files.get(k), bm = parseMsh(out);
        const c = compare(tag, am, bm, e.g);
        if (Array.isArray(c)) { failures.push(...c); continue; }
        if (c.added !== e.t) failures.push(`${tag}: ${c.added} triangles added, the table says ${e.t}`);
        if (c.added > MAX_PER_MESH) failures.push(`${tag}: ${c.added} triangles added (ceiling ${MAX_PER_MESH})`);
        if (!mshRoundTrips(out)) failures.push(`${tag}: the output does not round-trip`);
        nMesh++; nTris += c.added; zTris += c.added; maxMesh = Math.max(maxMesh, c.added); nVerts += bm.vertexCount - am.vertexCount; nBytes += out.length - orig.length;
        // (3) the pairing rule of the sets generator, group by group
        for (const gi of e.g) {
          const g = am.groups[gi], v0 = g.firstVertex;
          const pos = am.positions.slice(v0 * 3, (v0 + g.vertexCount) * 3), nrm = am.normals.slice(v0 * 3, (v0 + g.vertexCount) * 3), uv = am.uvs.slice(v0 * 2, (v0 + g.vertexCount) * 2);
          const old = setsBackFaces(pos, nrm, uv, Array.from(am.indices.subarray(g.firstIndex, g.firstIndex + g.indexCount)));
          setsGroups++; if (old.added !== unpairedTriangles(am, gi).length) { setsDiff++; failures.push(`${tag} group ${gi}: the sets rule adds ${old.added}, the glass rule ${unpairedTriangles(am, gi).length}`); }
        }
        // idempotent: the output has nothing left to add
        if (addBackFaces(bm, e.g)) failures.push(`${tag}: a second run still adds triangles`);
      }
      per.push(`${arch.name} +${zTris}`);
    }
    notes.push(`${nMesh} meshes, +${nTris} triangles (+${nVerts} vertices, +${(nBytes / 1024).toFixed(1)} KiB), at most +${maxMesh} per mesh; per zone: ${per.join(', ')}`);
    notes.push(`pairing rule against sets.ts addBackFaces: ${setsGroups} glass groups, ${setsDiff} differ`);

    // (4) the safety rules, on one real mesh of the island's table
    const t0 = await pack.json('glass/arch/z02lgi.json'), a0 = ctx.archives.find((a) => a.name === 'z02LGI');
    if (a0) {
      const e = t0.meshes.find((x) => /shop02_LOD1/i.test(x.m)) ?? t0.meshes[0], ent = a0.find(e.m), orig = a0.read(ent);
      const run = async () => generateArchive(pack, a0.name, a0, async () => null, ['glass']);
      const wrote = async () => [...(await run()).files.keys()].some((k) => k.toLowerCase() === ent.path.toLowerCase());
      try {
        const m = parseMsh(orig);
        checked++;
        // a mod's own mesh (another hash) is left alone
        const alt = serialiseMsh({ ...m, positions: m.positions.map((v, i) => (i === 0 ? v + 0.5 : v)) });
        a0.override(ent.path, alt); if (await wrote()) failures.push('a foreign mesh (other hash) was changed');
        a0.clearOverrides();
        // a mesh that does not round-trip (trailing bytes) is refused by the check the generator makes before it changes anything
        const longer = new Uint8Array(orig.length + 4); longer.set(orig);
        if (mshRoundTrips(longer)) failures.push('a mesh with trailing bytes counts as round-tripping');
        // skin weights: refused by addBackFaces
        let threw = false; try { addBackFaces({ ...m, svwl: new Uint8Array(m.vertexCount * 8) }, e.g); } catch { threw = true; }
        if (!threw) failures.push('a skinned mesh was not refused');
        // groups that are not consecutive: refused
        const bent = { ...m, groups: m.groups.map((g, i) => (i === 1 ? { ...g, firstVertex: g.firstVertex + 1 } : g)) };
        threw = false; try { addBackFaces(bent, e.g); } catch { threw = true; }
        if (!threw) failures.push('a mesh with non-consecutive groups was not refused');
        // the normal run still writes it (the overrides are gone)
        if (!(await wrote())) failures.push(`${e.m}: not written after the overrides were cleared`);
      } finally { a0.clearOverrides(); }
      // with the studs: the glass output is the studs' output plus the added triangles only
      const studs = await generateArchive(pack, a0.name, a0, async () => null, ['studs']);
      const both = await generateArchive(pack, a0.name, a0, async () => null, ['studs', 'glass']);
      let combined = 0;
      for (const e2 of t0.meshes) {
        const k = [...studs.files.keys()].find((x) => x.toLowerCase() === e2.m.toLowerCase());
        if (!k) continue;
        const bk = [...both.files.keys()].find((x) => x.toLowerCase() === e2.m.toLowerCase());
        const c = bk ? compare(`${e2.m} (studs + glass)`, parseMsh(studs.files.get(k)), parseMsh(both.files.get(bk)), e2.g) : [`${e2.m}: lost in the combined run`];
        checked++; combined++;
        if (Array.isArray(c)) failures.push(...c);
      }
      notes.push(`with the studs: ${combined} meshes of the island carry both, each equal to the studs' mesh plus the added triangles`);
      // nothing else of the archive is written by the glass generator
      const only = await run();
      for (const [m, g] of only.by) if (g === 'glass' && !t0.meshes.some((x) => x.m.toLowerCase() === m.toLowerCase())) failures.push(`${m}: written but not in the table`);
    }
    return { checked, failures, notes };
  },
};
