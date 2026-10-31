#!/usr/bin/env node
// Writes ATTRIBUTION.txt into the mod folder: every LDraw part (and primitive) the pilot geometry is derived from, with title, author and licence line read from the file headers, as CC BY 2.0 / 4.0 asks
// (creator, URL of the work, licence and its URL, and whether it was modified).
//   node tools/lego3d/attribution.mjs [--mod DIR]
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib, splitMpd } from './ldraw.mjs';
import { LDRAW, EXTRACT } from './lib.mjs';
import { BRICK_MAP } from './brickmap.mjs';

const MOD = process.argv.includes('--mod') ? process.argv[process.argv.indexOf('--mod') + 1] : path.join(EXTRACT, 'mods/lego3d-pilot');
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const omr = path.join(LDRAW, 'omr'); const main = splitMpd(path.join(omr, '6415-1.mpd'), path.join(omr, '6415-1')); lib.addDir(path.join(omr, '6415-1'));
const PILOT_BRICKS = 'fat1x1,fat2x1,fat4x1,fat6x1,fat8x1,fat2x2,fat4x2,thin1x1,thin2x1,thin4x1,thin2x2,thin4x2,fat2x2_45slope,fat1x2_45slope'.split(',');
const roots = ['3815b', '3816', '3817', '973', '3818', '3819', '3626b', '3820', '41539', '3004', 'stud', ...PILOT_BRICKS.map((b) => BRICK_MAP[b])].map((n) => `${n}.dat`);
const files = new Map();
const addAll = (name, res) => { const r = lib.flatten(name, { res }); for (const [f, info] of r.infos) files.set(f, info); };
for (const n of roots) for (const res of ['low', 'std']) addAll(n, res);
addAll(`${main.replace('main.ldr', 'jetski.ldr')}`, 'std'); addAll(`${main.replace('main.ldr', 'jetski.ldr')}`, 'low');
const rel = (f) => path.relative(path.join(LDRAW, 'lib/ldraw'), f);
const list = [...files.entries()].map(([f, i]) => ({ file: rel(f), ...i }));
const parts = list.filter((x) => x.file.startsWith('parts/') && !x.file.startsWith('parts/s/')).sort((a, b) => a.file.localeCompare(b.file));
const rest = list.filter((x) => !parts.includes(x));
const authors = new Map(); for (const x of list) if (x.author) authors.set(x.author, (authors.get(x.author) ?? 0) + 1);
const lic = new Map(); for (const x of list) lic.set(x.license || '(none in header)', (lic.get(x.license || '(none in header)') ?? 0) + 1);
let t = `LEGO 3D PILOT - ATTRIBUTION

The 3D geometry in this mod is derived from the LDraw.org Parts Library (https://www.ldraw.org, https://library.ldraw.org), a library of LEGO(R) part models made by the LDraw community,
and (the jet ski) from the LDraw.org Official Model Repository model 6415-1 "Res-Q Jet-Ski" by Robert Paciorek [bercik] (https://library.ldraw.org/omr/sets/440).

Licence: the Parts Library files are licensed under Creative Commons Attribution 2.0 (CC BY 2.0, "CCAL version 2.0") and/or Creative Commons Attribution 4.0 International (CC BY 4.0), as stated in each
file's header (see the table below), https://creativecommons.org/licenses/by/2.0/ and https://creativecommons.org/licenses/by/4.0/ (LDraw's own summary: CAreadme.txt of the library).
Creators: the authors named in the file headers, listed below.
Modifications: the geometry was converted to the game's .msh format, flattened (sub-files expanded), scaled and fitted to the original game meshes (per-axis scale, rotation, shift), hidden faces removed,
level-of-detail variants made (lower resolution primitives, studs removed, vertex clustering), normals recomputed, vertices skinned to the game's skeleton, and split into texture groups. It is NOT the original
LDraw geometry. No endorsement by LDraw.org or the authors is implied.
LDraw(TM) is a trademark owned and licensed by the Estate of James Jessiman. LEGO(R) is a trademark of the LEGO Group, which does not sponsor, endorse or authorize this work.

Licence lines found in the ${list.length} files used:
${[...lic.entries()].map(([k, v]) => `  ${v} x ${k}`).join('\n')}

Authors (${authors.size}): ${[...authors.keys()].sort().join('; ')}

Parts used (${parts.length}):
${parts.map((p) => `  ${p.file} - ${p.title} - ${p.author} - ${p.license}`).join('\n')}

Primitives and sub-parts used: ${rest.length} files (all under the same library licence; authors above).
`;
fs.writeFileSync(path.join(MOD, 'ATTRIBUTION.txt'), t);
console.log('wrote', path.join(MOD, 'ATTRIBUTION.txt'), 'parts', parts.length, 'files', list.length, 'authors', authors.size);
console.log([...lic.entries()].map(([k, v]) => `${v} x ${k}`).join('\n'));
