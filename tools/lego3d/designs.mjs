#!/usr/bin/env node
// Renders the colour-neutral LEGO surface designs of the textures generator in headless Blender (tools/lego3d/blender/lego_design.py) from LDraw geometry:
//   node tools/lego3d/designs.mjs [--only plain,ring,cross,wall-dark,wall-white] [--out DIR] [--samples N]
// Output per design: <name>.png (looking at it), <name>.bin (raw uint8 field, 128 + 127 f, row 0 = top) and <name>.json ({ w, h }), under $LE2_LEGO3D/designs by default.
// Exports `designFiles(dir)` / `DESIGNS` for the pack builder.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, WORK } from './lib.mjs';
import { weldSmooth } from './geom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
export const STUD_CELL = 256;   // px of one stud cell in the pack (8x the 32 px pitch of a 64 px original: the assembler box-filters it down to 4x)
/** the designs: stud cells (style) and brick walls (bx x rows bricks of 40 x 20 LDU, written at the px of the 4x texture) */
export const DESIGNS = {
  plain: { kind: 'studs', style: 'plain', span: 1, top: 1.0, relief: 1.0 },
  ring: { kind: 'studs', style: 'ring', span: 1, top: -0.3, relief: 0.6 },
  cross: { kind: 'studs', style: 'cross', span: 2, top: 1.0, relief: 1.0 },
  shaded: { kind: 'studs', style: 'shaded', span: 1, top: 0.0, relief: 0.0 },
  'wall-dark': { kind: 'wall', bx: 8, rows: 16, px: [512, 512], joint: 0.85 },
  'wall-white': { kind: 'wall', bx: 4, rows: 4, px: [256, 128], joint: -0.8 },
};

function plateMesh(lib) {
  const f = lib.flatten('41539.dat', { res: 'std' });   // 8 x 8 stud plate, studs at odd multiples of 10 LDU, stud tops y = -4
  const w = weldSmooth(f.tris, 35);
  return { positions: Array.from(w.pos), normals: Array.from(w.nrm), indices: w.idx };
}
function wallMesh(lib, bx, rows, bw, bh) {
  const brick = lib.flatten('3004.dat', { res: 'std' });
  const tri = [];
  for (let r = -2; r < rows + 2; r++) for (let c = -2; c < bx + 2; c++) {
    const x = c * bw + (((r % 2) + 2) % 2 ? bw / 2 : 0), y = -r * bh;   // rows go up (-Y)
    for (let i = 0; i < brick.tris.length; i += 3) tri.push(brick.tris[i] * 0.9375 + x, brick.tris[i + 1] * (bh / 24) * 0.875 + y + 0.5, brick.tris[i + 2]);
  }
  const X0 = -3 * bw, X1 = (bx + 3) * bw, Y0 = -(rows + 3) * bh, Y1 = 3 * bh;
  tri.push(X0, Y0, 14, X0, Y1, 14, X1, Y1, 14, X0, Y0, 14, X1, Y1, 14, X1, Y0, 14);   // the backing behind the joints
  const w = weldSmooth(Float32Array.from(tri), 35, 1e-3);
  return { positions: Array.from(w.pos), normals: Array.from(w.nrm), indices: w.idx };
}

export function designFiles(dir) {
  return Object.fromEntries(Object.keys(DESIGNS).map((n) => [n, path.join(dir, `${n}.bin`)]));
}

export function renderDesign(name, dir, { samples, lib } = {}) {
  const D = DESIGNS[name];
  lib ??= new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  let spec;
  if (D.kind === 'studs') {
    spec = { kind: 'studs', file, studs: { style: D.style, span: D.span, mesh: plateMesh(lib), cell: 20, centre: D.span === 2 ? [0, -4, 0] : [10, -4, 10], px: STUD_CELL * D.span, out: STUD_CELL * D.span, samples: samples ?? 96, ss: 2, relief: D.relief, top: D.top } };
  } else {
    const bw = 40, bh = 20;
    spec = { kind: 'wall', file, wall: { mesh: wallMesh(lib, D.bx, D.rows, bw, bh), bx: D.bx, rows: D.rows, bw, bh, px: D.px, ss: 2, samples: samples ?? 128, joint: D.joint, centre: [D.bx * bw / 2 - bw / 2, -(D.rows * bh) / 2 + bh / 2, 0] } };
  }
  const sf = path.join(dir, `${name}.spec.json`);
  fs.writeFileSync(sf, JSON.stringify(spec));
  execFileSync(BLENDER, ['-b', '-P', path.join(here, 'blender/lego_design.py'), '--', sf], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.rmSync(sf);
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
  const only = (opt('--only', '') || '').split(',').filter(Boolean);
  const out = opt('--out', path.join(WORK, 'designs'));
  const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
  for (const n of Object.keys(DESIGNS)) {
    if (only.length && !only.includes(n)) continue;
    const t0 = Date.now();
    renderDesign(n, out, { samples: opt('--samples', '') ? +opt('--samples', '') : undefined, lib });
    console.log(n, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }
}
