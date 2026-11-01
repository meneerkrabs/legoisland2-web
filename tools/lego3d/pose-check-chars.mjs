#!/usr/bin/env node
// Skinning stress test of the LEGO 3D character bodies against the originals over ALL clips of the MFIG rig of every zone (distinct clips only), at every LOD of every replaced body:
// per pose the largest edge stretch (edge length / bind length, edges longer than 0.05 in bind), reported as median / p90 / max over poses, original next to mod; plus the shoulder / hip gap
// (how far the top of an arm / leg moves away from the torso / hips surface compared with the bind pose).
//   node tools/lego3d/pose-check-chars.mjs [--stride 3] [--layout pepp,mfg,bb] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, archiveNames } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions, parseBlk, sampleBlk } from '../../src/formats/anim.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { hashBytes } from '../../src/mods/lego3d/chars/hash.ts';
import { BONES } from './pack/chars-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const STRIDE = +opt('--stride', 3);
const only = (opt('--layout', '') || '').split(',').filter(Boolean);
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const REPS = { pepp: ['z02LGI', ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR']], mfg: ['z02LGI', ['MFG_HR', 'MFG_MR', 'MFG_LR', 'MFG_SLR', 'MFG_BGR']], bb: ['z02LGI', ['BB_HR', 'BB_MR', 'BB_LR', 'BB_SLR', 'BB_BGR']], space: ['z40OGL', ['Space_pep_white']], skeleton: ['z17WAS', ['SKEL_HR']], mummy: ['z18MMP', ['MUMM_HR']] };
const tables = await pack.json('chars/tables.json');

import { poses as samplePoses, distinctClips, edgeStretch } from './pack/chars-pose.mjs';
console.log(`distinct MFIG clips over all zones: ${distinctClips().length}`);
const poses = samplePoses(STRIDE);
console.log(`poses: ${poses.length} (every ${STRIDE}th frame of every distinct clip)`);

const gens = new Map();
const get = async (zone, member, modded) => {
  const rep = archive(zone);
  if (!gens.has(zone)) gens.set(zone, await generateArchive(pack, zone, rep, async (n) => archive(n), ['characters']));
  const gen = gens.get(zone), e = rep.find(member);
  const bytes = modded ? gen.files.get(e.path) ?? rep.read(e) : rep.read(e);
  return { bytes, replaced: modded && gen.files.has(e.path) };
};

// painted decals are part of the surface (role S); the overlays that remain (arm bands, soles) ride their host and are left out of BOTH sides (same group indices)
const stats = (bytes, groups) => edgeStretch(bytes, poses, groups);
const out = {};
const fmt = (x) => x.toFixed(2);
console.log('layout lod         tris(orig->mod)   edge stretch median/p90/max  original  ->  mod        replaced');
for (const [layout, [zone, names]] of Object.entries(REPS)) {
  if (only.length && !only.includes(layout)) continue;
  for (const [li, nm] of names.entries()) {
    const member = `Meshes/${nm}.msh`;
    const roles = tables.bodies[`${layout}-${li}`]?.roles, solid = roles ? roles.split('').map((c, i) => (c === 'D' ? -1 : i)).filter((i) => i >= 0) : null;
    const o = stats((await get(zone, member, false)).bytes, solid), mm = await get(zone, member, true), n = stats(mm.bytes, solid);
    out[`${layout}-${li}`] = { orig: { tris: o.tris, median: o.median, p90: o.p90, max: o.max }, mod: { tris: n.tris, median: n.median, p90: n.p90, max: n.max, replaced: mm.replaced } };
    console.log(`${layout.padEnd(5)} ${nm.padEnd(16)} ${String(o.tris).padStart(4)} -> ${String(n.tris).padEnd(5)}  ${fmt(o.median)} / ${fmt(o.p90)} / ${fmt(o.max)}   ->   ${fmt(n.median)} / ${fmt(n.p90)} / ${fmt(n.max)}   ${mm.replaced ? 'mod' : 'ORIGINAL kept'}${solid && solid.length < (roles?.length ?? 0) ? ' (overlay groups left out)' : ''}`);
  }
}
const jf = opt('--json', ''); if (jf) fs.writeFileSync(jf, JSON.stringify(out, null, 1));
