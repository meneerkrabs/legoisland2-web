#!/usr/bin/env node
// Replacement textures for LEGO surfaces (stud plates, brick walls), rendered from LDraw geometry in headless Blender at 4x the original resolution (docs/re/lego3d.md).
//   node tools/lego3d/textures.mjs [--mod DIR] [--only z05WAB#2,...] [--normals]
// Each target names the game's texture (archive, id), what it shows (studs per tile, brick layout), and the surface colour (three numbers: the median colour of the original; the original's
// pixels are not copied). The result is written as <archive>/textures/TextNNN.tga into the mod folder, same tile, same UV mapping, 4x the pixels. --normals also writes a normal map PNG next to the
// mod folder (not used by the game: there is no shader for it yet).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, archive, textureOf, EXTRACT, WORK } from './lib.mjs';
import { weldSmooth } from './geom.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const MOD = opt('--mod', path.join(EXTRACT, 'mods/lego3d-pilot'));
const ONLY = opt('--only', '');
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
// kind 'studs': a 2 x 2 stud tile (40 LDU) of a big plate; kind 'wall': running-bond wall of 1 x 2 bricks (40 x 24 LDU), `bx` bricks wide, `rows` rows, drawn square-pixel as the game's tile (scale to the tile's aspect)
const TARGETS = [
  { zone: 'z05WAB', id: 2, kind: 'studs', note: 'Whack-A-Bot floor, blue stud plate' },
  { zone: 'z05WAB', id: 3, kind: 'studs', note: 'Whack-A-Bot red stud plate' },
  { zone: 'z02LGI', id: 86, kind: 'studs', note: 'island blue stud plate' },
  { zone: 'z02LGI', id: 284, kind: 'studs', note: 'island red stud plate' },
  { zone: 'z02LGI', id: 260, kind: 'studs', note: 'island black stud plate' },
  { zone: 'z02LGI', id: 84, kind: 'studs', note: 'island grey stud plate' },
  { zone: 'z02LGI', id: 277, kind: 'studs', note: 'island dark grey stud plate (ring style)' },
  { zone: 'z02LGI', id: 288, kind: 'studs', note: 'island red stud plate (ring style)' },
  { zone: 'z02LGI', id: 35, kind: 'wall', bx: 8, rows: 16, note: 'island dark grey brick wall' },
  { zone: 'z05WAB', id: 16, kind: 'wall', bx: 4, rows: 4, note: 'white brick wall' },
];
const medianColour = (t) => {
  const ch = [[], [], []];
  for (let i = 0; i < t.rgba.length; i += 4) for (let c = 0; c < 3; c++) ch[c].push(t.rgba[i + c]);
  return ch.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; });
};
const tmp = path.join(WORK, 'textures'); fs.mkdirSync(tmp, { recursive: true });
const outDir = (z) => path.join(MOD, '_data', z, 'textures');
const report = [];
for (const T of TARGETS) {
  const key = `${T.zone}#${T.id}`;
  if (ONLY && !ONLY.split(',').includes(key)) continue;
  const orig = textureOf(archive(T.zone), T.id);
  const color = medianColour(orig).map((v) => (T.kind === 'wall' && v > 245 ? 238 : v));   // a white wall must keep room for the joints to be darker
  const S = 4, W = orig.width * S, H = orig.height * S;
  let tris, spec;
  if (T.kind === 'studs') {
    // 8 x 8 stud plate (3036 is 6 x 8; 41539 8 x 8): the tile is cut from the middle, away from the plate's edge
    const f = lib.flatten('41539.dat', { res: 'std' });
    const w = weldSmooth(f.tris, 35);
    const top = -4;   // stud tops at y = -4 (LDU, -Y up), plate top y = 0: centre the view on the plate surface
    spec = { mesh: { positions: Array.from(w.pos), normals: Array.from(w.nrm), indices: w.idx }, camera: 'top', centre: [0, top, 0], tile: [40, 40], px: [W, H], out: [W, H], color, samples: 16, relief: 0.6 };
    // the game's tile shows 2 x 2 studs: stud centres at +-10 LDU around the tile centre
  } else {
    const brick = lib.flatten('3004.dat', { res: 'std' });
    const tri = [];
    const bw = 40, bh = 24;
    for (let r = -2; r < T.rows + 2; r++) for (let c = -2; c < T.bx + 2; c++) {
      const x = c * bw + (r & 1 ? bw / 2 : 0), y = -r * bh;   // rows go up (-Y)
      for (let i = 0; i < brick.tris.length; i += 3) tri.push(brick.tris[i] * 0.97 + x, brick.tris[i + 1] * 0.96 + y + 0.5, brick.tris[i + 2]);   // a 1 LDU joint between the bricks
    }
    // a backing wall behind the joints (bricks span z -10..10, front at -Z)
    const X0 = -3 * bw, X1 = (T.bx + 3) * bw, Y0 = -(T.rows + 3) * bh, Y1 = 3 * bh;
    tri.push(X0, Y0, 14, X0, Y1, 14, X1, Y1, 14, X0, Y0, 14, X1, Y1, 14, X1, Y0, 14);
    const w = weldSmooth(Float32Array.from(tri), 35, 1e-3);
    // wall front faces -Z of the LDraw brick; the view looks from -Z toward +Z, i.e. "front" in the script maps to Blender -Y = LDraw -Z
    spec = { mesh: { positions: Array.from(w.pos), normals: Array.from(w.nrm), indices: w.idx }, camera: 'front', centre: [T.bx * bw / 2 - bw / 2 + 0, -(T.rows * bh) / 2 + bh / 2 - 0, 0], ambient: 1.0, sun: 2.2, tile: [T.bx * bw, T.rows * bh], px: [T.bx * 64, T.rows * 64 * bh / bw * 1], out: [W, H], color, samples: 32 };
    spec.px = [Math.round(T.bx * 64), Math.round(T.rows * 64 * (bh / bw))];
  }
  spec.file = path.join(outDir(T.zone), `Text${String(T.id).padStart(3, '0')}.tga`);
  fs.mkdirSync(outDir(T.zone), { recursive: true });
  if (args.includes('--normals')) { spec.normal = path.join(WORK, 'textures', `${T.zone}_${T.id}_normal.png`); spec.normal_px = [orig.width * 2, orig.height * 2]; }
  const sf = path.join(tmp, `${T.zone}_${T.id}.json`);
  fs.writeFileSync(sf, JSON.stringify(spec));
  execFileSync('/Applications/Blender.app/Contents/MacOS/Blender', ['-b', '-P', path.join(path.dirname(new URL(import.meta.url).pathname), 'blender/lego_texture.py'), '--', sf], { stdio: ['ignore', 'ignore', 'inherit'] });
  report.push({ tex: key, kind: T.kind, from: `${orig.width}x${orig.height}`, to: `${W}x${H}`, color: color.join(','), note: T.note });
}
console.table(report);
