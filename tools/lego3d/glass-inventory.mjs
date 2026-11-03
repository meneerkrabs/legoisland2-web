#!/usr/bin/env node
// Inventory of the translucent glass of the game's static meshes (docs/re/lego3d.md section 16.10): per zone archive, which meshes have glass groups, how many glass triangles, how many have no partner facing
// the other way yet (what the "glass" generator adds), which are covered already (replaced by the sets generator, or drawn from both sides), which are left out and why.
//   node tools/lego3d/glass-inventory.mjs [--list] [zone ...]
import { archiveNames } from './lib.mjs';
import { scanArchive } from './pack/glass.mjs';

const args = process.argv.slice(2), list = args.includes('--list'), only = args.filter((a) => !a.startsWith('--'));
const T = { zones: 0, meshes: 0, tris: 0, glassTris: 0, unpaired: 0, paired: 0, covered: 0, coveredUnpaired: 0, coveredKept: 0, skinned: 0, skinnedUnpaired: 0, other: 0, otherTris: 0, otherMeshes: 0 };
const rows = [];
for (const an of archiveNames()) {
  if (!/^z\d\d/i.test(an) || (only.length && !only.includes(an))) continue;
  const scan = await scanArchive(an); if (!scan) continue;
  const Z = { zone: an, meshes: 0, glassMeshes: 0, glassGroups: 0, glassTris: 0, unpaired: 0, twoSided: 0, covered: 0, coveredUnpaired: 0, coveredKept: 0, skinned: 0, skinnedUnpaired: 0, build: 0, buildMeshes: 0, otherGroups: 0, otherTris: 0 };
  for (const s of scan) {
    const glass = s.groups.filter((g) => g.glass), other = s.groups.filter((g) => !g.glass);
    Z.otherGroups += other.length; Z.otherTris += other.reduce((q, g) => q + g.tris, 0);
    if (!glass.length) continue;
    const gt = glass.reduce((q, g) => q + g.tris, 0), un = glass.reduce((q, g) => q + g.unpaired, 0);
    Z.glassMeshes++; Z.glassGroups += glass.length; Z.glassTris += gt; Z.unpaired += un; Z.twoSided += gt - un;
    if (s.covered) { Z.covered++; Z.coveredUnpaired += un; const kp = glass.filter((g) => s.kinds[g.gi] === 'keep').reduce((q, g) => q + g.unpaired, 0); Z.coveredKept += kp; Z.build += kp; if (kp) Z.buildMeshes++; }
    else if (s.skinned) { Z.skinned++; Z.skinnedUnpaired += un; }
    else if (un > 0) { Z.build += un; Z.buildMeshes++; }
    if (list) rows.push(`${an} ${s.member}: ${s.covered ? 'COVERED(sets) ' : ''}${s.skinned ? 'SKINNED ' : ''}${s.tris} tris; glass groups ${glass.map((g) => `${g.gi}[flags ${g.flags}, tex ${g.tex.join('/')}, ${g.tris} tris, ${g.unpaired} unpaired]`).join(' ')}${other.length ? ` | other translucent ${other.map((g) => `${g.gi}[flags ${g.flags} tex ${g.tex.join('/')} ${g.tris}]`).join(' ')}` : ''}`);
  }
  Z.meshes = scan.length;
  console.log(`${an}: meshes with translucent groups ${Z.meshes}, with glass ${Z.glassMeshes} (${Z.glassGroups} groups, ${Z.glassTris} triangles: ${Z.twoSided} already paired, ${Z.unpaired} unpaired); covered by sets ${Z.covered} (${Z.coveredUnpaired} unpaired in the game's mesh, ${Z.coveredKept} of them in groups the sets generator keeps); skinned ${Z.skinned} (${Z.skinnedUnpaired}); to do: ${Z.buildMeshes} meshes, +${Z.build} triangles; other translucent groups not called glass: ${Z.otherGroups} (${Z.otherTris} triangles)`);
  T.zones++; for (const k of ['glassMeshes', 'glassTris', 'unpaired', 'covered', 'coveredUnpaired', 'coveredKept', 'skinned', 'skinnedUnpaired', 'build', 'buildMeshes', 'otherGroups', 'otherTris']) T[k] = (T[k] ?? 0) + Z[k];
}
if (list) console.log(rows.join('\n'));
console.log('TOTAL', JSON.stringify(T));
