// One brick, start to finish (shared by the pack builder, the search and the QA sheets): the LDraw part(s) fitted to the game's LOD 0 (rotation by measurement), split into the game's colour classes
// (two-colour bricks: which LDraw colour is the game's second colour is decided by the nearest game surface), built for LOD 0 (12-sided studs) and LOD 1 (4-sided studs, low-resolution primitives),
// and measured against the game's own LODs. Node only.
import { BrickLibrary } from '../../src/formats/bricks.ts';
import { exe, archive } from './lib.mjs';
import { gameBrick, fitToGame, measureMesh, isVerified, reason, studDiff } from './brickfit.mjs';
import { flattenPart, buildLod, colourClasses, splitByClass } from './brickmesh.mjs';
import { soup } from './qa-raster.mjs';

export const STUD0 = 12, STUD1 = 4;   // sides of a stud at LOD 0 (measured frame cost, see the docs) and at LOD 1 (the game's own 10-triangle stud)
/** build options from a flag string ("trans,fit,b0=3,b1=1.5,mc0=1e-6"): trans = LDraw transparent colours are the second colour, fit = per-axis fit of the body to the game's box, b0 / b1 = triangle budgets (x the game's, 0 = none), mc0 / mc1 = merge cost of the decimation */
export function parseFlags(str = '') {
  const fl = str.split(',').filter(Boolean), o = { fitScale: fl.includes('fit'), second: fl.includes('trans') ? 'trans' : null, nostud: fl.includes('nostud') };
  for (const f of fl) { const m = f.match(/^(b0|b1|mc0|mc1|bc1)=([\d.e+-]+)$/); if (m) o[m[1]] = +m[2]; }
  return o;
}
let _lib = null;
/** the engine's own BrickLibrary over the player's Bricks archive: first-colour counts (`splitOf`) of the game's meshes */
export function gameLib() { return (_lib ??= new BrickLibrary(exe(), archive('Bricks'), null)); }
export function gameSplit(name, lod) {
  const t = gameLib().types.find((x) => x && x.name === name);
  return t ? gameLib().splitOf(t, lod) : null;
}

/** opts: { lods: [0, 1], used(infos), studs0, studs1 }. Returns { fit, lods: {0: mesh, 1: mesh}, refs, ms, classes, row } or { row } when no rotation fits */
export function buildBrickAll(lib, a, name, partNames, opts = {}) {
  const wantLods = opts.lods ?? [0, 1];
  const used = opts.used;
  const ref0 = gameBrick(a, name, 0, gameSplit(name, 0));
  if (!ref0) return { row: { name, status: 'no LOD 0 in the archive' } };
  // a part name ending in "!" is a glass part: all of it is the game's second colour (the pane), whatever its LDraw colour
  const glass = partNames.map((p) => p.endsWith('!'));
  partNames = partNames.map((p) => p.replace(/!$/, ''));
  const full = [];
  for (const p of partNames) { const f = lib.flatten(`${p}.dat`, { res: 'std' }); for (const v of f.tris) full.push(v); used?.(f.infos); }
  const fit = fitToGame(Float32Array.from(full), ref0);
  if (!fit) return { row: { name, status: 'no rotation with a similar bounding box' } };
  // colour classes from the std flatten of every part (LDraw colour -> 0 | 1), reused at LOD 1
  const std = partNames.map((p) => flattenPart(lib, p, 'std'));
  let map = null, votes = null;
  if (ref0.secondTris) {
    map = new Map(); votes = new Map();
    for (const [fi, f] of std.entries()) { if (glass[fi]) continue; const c = colourClasses(f, f.studs, ref0, fit.rot, fit.shift, opts.second ?? null); if (c) for (const [k, v] of c.map) if (!map.has(k) || v) map.set(k, v); if (c) for (const [k, v] of c.votes) votes.set(k, v); }
  }
  const classesOf = (flats) => {
    if (!map) return flats.map((f) => ({ tris: f.tris, studs: f.studs, second: false }));
    return flats.flatMap((f, fi) => (glass[fi] ? [{ tris: f.tris, studs: [], second: true }] : splitByClass(f, f.studs, map, !!opts.second || glass.some(Boolean))));
  };
  const lods = {}, refs = {}, ms = {};
  for (const l of wantLods) {
    const ref = l === 0 ? ref0 : gameBrick(a, name, l, gameSplit(name, l));
    if (!ref) continue;
    const flats = l === 0 ? std : partNames.map((p) => { const f = flattenPart(lib, p, 'low'); used?.(f.infos); return f; });
    const parts = classesOf(flats);
    // budgets: LOD 0 may use 2.2x the game's triangles + 40 (its 12-sided studs are smooth prisms against the game's flat 8-gons, the vertex count stays near the game's), LOD 1 at most the game's own count
    // opts.b0 / opts.b1 (class bricks): triangle budget as a multiple of the game's count (+ 40 at LOD 0); 0 = no budget (only the coplanar / collinear merges)
    const m0 = opts.b0 ?? 2.2, m1 = opts.b1 ?? 1;
    const bo = l === 0 ? { studSides: opts.studs0 ?? STUD0, ...(opts.mc0 !== undefined ? { maxCost: opts.mc0 } : {}), budget: m0 ? Math.floor(ref.triCount * m0 + 40) - 4 : 0 } : { studSides: opts.studs1 ?? STUD1, maxCost: opts.mc1 ?? 1e-3, budget: m1 ? Math.ceil(ref.triCount * m1) : 0, budgetCost: opts.bc1 ?? 2e-2 };
    if (opts.fitScale) { bo.scale = [0, 1, 2].map((c) => (fit.boxErr <= 0.12 ? ref.box.size[c] / fit.size[c] : 1)); bo.scaleAbout = [0, 1, 2].map((c) => (ref.box.lo[c] + ref.box.hi[c]) / 2); }
    lods[l] = buildLod(parts, fit.rot, fit.shift, bo);
    refs[l] = ref; ms[l] = measureMesh(soup(lods[l].pos, lods[l].idx), ref);
  }
  const m0 = ms[0], L0 = lods[0];
  const studs = opts.nostud ? null : studDiff(L0.pos, ref0.msh.positions);   // nostud: the game's ring-shaped vertex clusters are a dome apex, not studs
  const row = {
    name, status: 'ok', parts: partNames, rot: fit.rot.join(','), twoColour: !!map, colourMap: map ? [...map.entries()].map(([k, v]) => `${k}:${v}`).join(' ') : undefined,
    studs, split0: L0.split, raw0: L0.raw, verts0: L0.pos.length / 3,
    lod0: { raw: L0.raw, box: +m0.boxErr.toFixed(3), mean: +m0.dev.mean.toFixed(4), far: +m0.dev.far.toFixed(3), verts: L0.pos.length / 3, tris: L0.tris, game: ref0.triCount, gameVerts: ref0.vertexCount, verified: isVerified({ boxErr: m0.boxErr, dev: m0.dev }), why: reason({ boxErr: m0.boxErr, dev: m0.dev }) },
  };
  if (lods[1]) row.lod1 = { raw: lods[1].raw, box: +ms[1].boxErr.toFixed(3), mean: +ms[1].dev.mean.toFixed(4), verts: lods[1].pos.length / 3, tris: lods[1].tris, game: refs[1].triCount, gameVerts: refs[1].vertexCount };
  return { fit, lods, refs, ms, row };
}
