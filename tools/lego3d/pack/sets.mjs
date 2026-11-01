// Pack builder "sets": the game's vehicle meshes (jet ski, ambulance, ...) rebuilt from the LDraw OMR set models of which they are versions (docs/re/lego3d.md section 3.3).
//   Input : tools/lego3d/sets-table.mjs, the OMR .mpd files + LDraw library, the player's zone archives (MEASURING: the fit of the set onto the game's LOD 0, which brick belongs to which group)
//   Output: sets/arch/<archive>.json (per game mesh: member, hash of the game's member, blob, per group what to do) + sets/b/<name>.bin (LDraw-derived geometry per group in the group's own frame)
// Nothing of the game's geometry is written. Decals, placeholder groups, UVs, GTOM / MATL, group order and flags come from the player's own mesh at run time.
import fs from 'node:fs';
import path from 'node:path';
import { archive, scene, memberOf, WORK } from '../lib.mjs';
import { SETS, LOD_POLICY } from '../sets-table.mjs';
import { loadOmr, prepareSet, gameGroups, fitSet, buildMeshGroups, pruneInstances, refineScale } from '../setlib.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { encodeMesh, hashMember } from '../../../src/mods/lego3d/meshpack.ts';

const NEAR = 45;   // LODs that start within this many units are built at full detail   // LOD 0 ceiling: 5.2x the game's triangles, at least 1600 (a 270-triangle jet ski is a 12-brick model)
const flatTexture = new Map(), picTexture = new Map();
/** is the texture of a group a flat colour (any UV is fine)? alpha counts: a translucent colour is still flat */
function isFlat(arch, id) {
  if (id < 0) return true;
  const k = `${arch.name}:${id}`;
  if (flatTexture.has(k)) return flatTexture.get(k);
  let flat = true;
  const n = String(id).padStart(3, '0');
  const e = arch.find(`textures/Text${n}.tga`) ?? arch.find(`textures/text${n}.tga`) ?? arch.find(`textures/Text${n}.wib`);
  if (e && /\.tga$/i.test(e.path)) {
    const t = parseTgaLazy(arch.read(e));
    flat = t.flat; picTexture.set(k, t.pic);
  } else if (e) flat = false;
  flatTexture.set(k, flat);
  return flat;
}
import { parseTga } from '../../../src/formats/tga.ts';
function parseTgaLazy(bytes) {
  const t = parseTga(bytes), px = t.rgba;
  const min = [255, 255, 255, 255], max = [0, 0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) { if (px[i + c] < min[c]) min[c] = px[i + c]; if (px[i + c] > max[c]) max[c] = px[i + c]; }
  const range = Math.max(...max.slice(0, 3).map((v, c) => v - min[c]));
  return { flat: Math.max(...max.map((v, c) => v - min[c])) <= 12, pic: range >= 60 && t.width >= 16 && t.height >= 16 };
}

export async function build(ctx) {
  const only = process.env.SETS_ONLY ? process.env.SETS_ONLY.split(',') : null;
  const { blobs, byArch, report } = await buildSpecs(ctx, SETS, { only });
  return { blobs, byArch, report };
}

/** builds the given set specs (same record format as sets-table.mjs SETS): returns { blobs, byArch, report }; the caller writes the table (`sets/arch/<archive>.json`, or `.b.json` for the second table) */
export async function buildSpecs(ctx, specs, { only = null } = {}) {
  const blobs = new Map(), byArch = {}, report = [];
  for (const spec of specs) {
    if (only && !only.includes(spec.key)) continue;
    const om = loadOmr(spec.set, { skipFiles: spec.skip, entry: spec.entry });
    ctx.log(`${spec.key}: ${om.instances.length} part instances`);
    // fit once, on the LOD 0 mesh of the first archive
    const prepStd = prepareSet(om, 'std'), prepLow = prepareSet(om, 'low');
    for (const p of [...prepStd]) ctx.use(p.infos);
    let fit = null;
    const prunedCache = new Map();
    for (const [zone, names] of Object.entries(spec.archives)) {
      const a = archive(zone), sc = scene(zone);
      const metas = names.map((n) => {
        const p = sc.meshPaths.find((x) => x.toLowerCase().endsWith(`\\${n.toLowerCase()}.msh`));
        if (!p) throw new Error(`${zone}: no mesh ${n}`);
        return { name: n, member: memberOf(p) };
      });
      for (let li = 0; li < metas.length; li++) {
        const mt = metas[li], entry = a.find(mt.member), bytes = a.read(entry), msh = parseMsh(bytes);
        const pol = LOD_POLICY[Math.min(li, LOD_POLICY.length - 1)], prep = pol.res === 'std' ? prepStd : prepLow;
        if (!fit) {
          const gg = gameGroups(msh);
          const all = Float32Array.from(prepStd.flatMap((g) => [...g.tris])), gtris = Float32Array.from(gg.flatMap((g) => [...g.tris]));
          fit = fitSet(all, gtris, { rotations: spec.rot ? [spec.rot] : null });
          if (spec.stretch) {
            fit.post = refineScale(all, fit, gtris, { uniform: spec.stretch === 'uniform' });
            ctx.log(`${spec.key}: stretch ${spec.stretch}: scale ${fit.post.s.map((v) => v.toFixed(3)).join(',')}, chamfer ${fit.post.before.toFixed(3)} -> ${fit.post.after.toFixed(3)}`);
          }
          ctx.log(`${spec.key}: fit rot ${fit.rot.join(',')} score ${fit.score.toFixed(3)} shift ${fit.shift.map((v) => v.toFixed(2)).join(',')}`);
        }
        const sc0 = scene(zone), model0 = sc0.models.find((m) => m.parts.some((p) => p && sc0.meshPaths[p.mesh].toLowerCase().endsWith(`\\${mt.name.toLowerCase()}.msh`)));
        const lodDist = model0?.parts.find((p) => p && sc0.meshPaths[p.mesh].toLowerCase().endsWith(`\\${mt.name.toLowerCase()}.msh`))?.lod ?? 0;
        const part0 = model0?.parts.find((p) => p && sc0.meshPaths[p.mesh].toLowerCase().endsWith(`\\${mt.name.toLowerCase()}.msh`)), tl0 = part0 ? sc0.texLists[part0.texList] : [];
        // ROUND 2 rule (no triangle ceiling for what is seen close): LOD 0 and every LOD that starts within NEAR units are built at the LDraw standard with real studs (12 / 8 sides) and a tiny collapse
        // cost (coplanar merges only: 0.004 = 0.06 units); the far LODs use the low-resolution primitives and a cost that grows with the distance the LOD starts at (3 px of error at 800 px / 60 degrees:
        // (0.0044 x distance)^2), tried at 1x, 3x and 9x of it: the first within 3x of the game's triangle count of that mesh wins, else the smallest. Reported per LOD: the undecimated count (what the set
        // gives after hidden-face removal, studs included) and the decimated count.
        const near = li === 0 || lodDist <= NEAR;
        const budgetTris = near ? 1e9 : Math.round(msh.indices.length / 3);
        const farCost = Math.max(pol.costs[0], (0.0044 * lodDist) ** 2);
        const attempts = near ? [['std', 4e-3]] : [['low', farCost], ['low', farCost * 3], ['low', farCost * 9]];
        const studsMax = near ? (li === 0 ? 12 : 8) : 0;
        let r = null, used = null;
        for (const [res, ic] of attempts) {
          const pr = res === 'std' ? prepStd : prepLow;
          if (!prunedCache.has(res)) { const t0 = Date.now(); prunedCache.set(res, pruneInstances(pr, fit)); ctx.log(`${spec.key}: ${res} bricks pruned in ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
          const keepGroups = spec.keepTextures ? new Set(tl0.map((t, gi) => (spec.keepTextures.includes(t) ? gi : -1)).filter((g) => g >= 0)) : null;
          const cur = buildMeshGroups(om, pr, fit, msh, { keepGroups, pruned: prunedCache.get(res), studs: studsMax, budget: budgetTris, maxCost: ic });
          cur.report.undecimated = Math.round(cur.report.bodyTotal) + cur.report.studCount * (cur.report.studSides ? cur.report.studSides * 3 - 2 : 0);
          ctx.log(`   attempt ${res} maxCost ${ic.toFixed(3)}: ${cur.report.total} triangles (undecimated ${cur.report.undecimated}, studs ${cur.report.studSides}x${cur.report.studCount})`);
          if (!r || cur.report.total < r.report.total) { r = cur; used = { res, maxCost: ic }; }
          if (near || cur.report.total <= 3 * (msh.indices.length / 3)) { r = cur; used = { res, maxCost: ic }; break; }
        }
        // a far LOD that the per-brick decimation leaves at more than 5x the game's count: the closed outside shell (voxel + surface nets + quadric decimation) to 3x the game's count (at least 150)
        if (!near && lodDist >= 80 && r.report.total > 5 * (msh.indices.length / 3)) {
          const target = Math.max(150, 3 * (msh.indices.length / 3));
          const t0 = Date.now();
          const cur = buildMeshGroups(om, prepLow, fit, msh, { keepGroups: spec.keepTextures ? new Set(tl0.map((t, gi) => (spec.keepTextures.includes(t) ? gi : -1)).filter((g) => g >= 0)) : null, pruned: prunedCache.get('low'), studs: 0, budget: target, maxCost: 1, farShell: { target, maxCost: Math.max(1, (0.0088 * lodDist) ** 2) } });
          cur.report.undecimated = r.report.undecimated;
          ctx.log(`   shell remesh (voxel ${cur.report.shellVoxel?.toFixed(3)}): ${cur.report.total} triangles in ${((Date.now() - t0) / 1000).toFixed(0)} s (per-brick decimation gave ${r.report.total})`);
          r = cur; used = { res: 'low', shell: true };
        }
        // table row: per group the kind and the UV policy
        const sc2 = scene(zone), model = sc2.models.find((m) => m.parts.some((p) => p && sc2.meshPaths[p.mesh].toLowerCase().endsWith(`\\${mt.name.toLowerCase()}.msh`)));
        const part = model?.parts.find((p) => p && sc2.meshPaths[p.mesh].toLowerCase().endsWith(`\\${mt.name.toLowerCase()}.msh`));
        const tl = part ? sc2.texLists[part.texList] : [];
        const kinds = [];
        const groups = r.groups.map((g, gi) => {
          if (g.kind === 'keep') { kinds.push(g.gkind === 'decal' ? 'decal' : 'keep'); return { kind: 1 }; }
          const flat = isFlat(a, tl[gi] ?? -1);
          kinds.push(flat ? 'flat' : picTexture.get(`${a.name}:${tl[gi] ?? -1}`) ? 'pic' : 'uv');
          return { kind: 0, flags: flat ? 0 : 1, pos: g.pos, nrm: g.nrm, idx: g.idx };
        });
        const blob = encodeMesh(groups), bh = hashMember(blob), bname = `sets/b/${bh}.bin`;
        blobs.set(bname, blob);
        (byArch[zone] ??= []).push({ member: mt.member, hash: hashMember(bytes), blob: bname, kinds, tris: r.report.total, game: msh.indices.length / 3, set: spec.set, ...(spec.gap ? { gap: spec.gap } : {}) });
        report.push({ key: spec.key, zone, mesh: mt.name, attempt: used, game: msh.indices.length / 3, mine: r.report.total, undecimated: r.report.undecimated, lodDist, groups: msh.groups.length, kinds: kinds.join(','), studSides: r.report.studSides, studCount: r.report.studCount });
        ctx.log(`${zone}/${mt.name} (LOD from ${lodDist}): ${msh.indices.length / 3} -> ${r.report.total} triangles (undecimated ${r.report.undecimated}) (${used.res}, maxCost ${used.maxCost}), studs ${r.report.studSides} sides x ${r.report.studCount}, kinds ${kinds.join(',')}`);
      }
    }
    ctx.useSet({ set: spec.set, title: spec.title, author: 'LDraw.org Official Model Repository', license: 'CCAL version 2.0', url: `https://library.ldraw.org/omr/sets/${spec.set}-1`, file: `${spec.set}-1.mpd` });
  }
  return { blobs, byArch, report };
}
