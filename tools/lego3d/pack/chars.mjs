// Pack builder "chars": the LEGO 3D characters (docs/re/lego3d.md). Reads the LDraw library and the game folder (to MEASURE: region boxes, skin curves, mesh hashes; nothing of the game's meshes
// or pictures goes into the pack) and writes  chars/tables.json  +  chars/body/<layout>-<lod>.bin  (+ heads, hands, headgear later).
//   node tools/lego3d/pack/build-pack.mjs --only chars
import { loadBody, ringSkin, ringRule, simplifyRings, thinRings, skinError, BONES, SKIN, regionBox } from './chars-core.mjs';
import { PARTS, fitsOf, partTris, cleanPart, decimateSoup, weldSoup, indexedToSoup, lib } from './chars-body.mjs';
import { splitAtPlane } from '../geom.mjs';
import { loft, shapeLevels } from './chars-loft.mjs';
import { footprints, cutSoup, tagTri, prepFootprints, bandLevels, bandGroups, triArea } from './chars-paint.mjs';
import { buildSkeleton, packSkeleton, SKEL_PARTS } from './chars-skel.mjs';
import { decimate } from '../../../src/mods/lego3d/geom/decimate.ts';
import { mergeFlat, meshDeviation } from './chars-geom.mjs';
import { encodeBody } from '../../../src/mods/lego3d/chars/bodypack.ts';
import { assembleBody } from '../../../src/mods/lego3d/chars/body.ts';
import { decodeBody } from '../../../src/mods/lego3d/chars/bodypack.ts';
import { Rig } from '../../../src/mods/lego3d/chars/rig.ts';
import { readOrig } from '../../../src/mods/lego3d/chars/orig.ts';
import { TriSet } from '../../../src/mods/lego3d/chars/geo.ts';
import { hashBytes } from '../../../src/mods/lego3d/chars/hash.ts';
import { archive } from '../lib.mjs';
import { poses as samplePoses, edgeStretch, poseDeviation } from './chars-pose.mjs';
import { loadInventory } from '../chars-inventory.mjs';
import { buildHead, HEAD_LADDER, cleanHead } from './chars-head.mjs';
import { fitHand, cleanHand } from './chars-hand.mjs';
import { buildGear } from './chars-gear.mjs';
import { encodeStatic, decodeStatic, assembleStatic } from '../../../src/mods/lego3d/chars/static.ts';
import { parseMsh } from '../../../src/formats/msh.ts';

/** the layouts: representative zone + meshes, regions the LDraw parts are fitted to (HR, bind pose), roles of the groups per LOD, where the triangles of a part go */
export const LAYOUTS = {
  pepp: {
    zone: 'z02LGI', lods: ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR'], roles: ['SSDDDDDDD', 'SSDDDDDD', 'SSDDDDDD', 'SSDDDDDD'],
    regions: {
      hips: { groups: [0], bones: [0], override: { 0: [-0.72, 0.72], 1: [1.30, 1.59], 2: [-0.36, 0.35] } },
      'leg +x': { groups: [0], bones: [2, 6, 7] }, 'leg -x': { groups: [0], bones: [1, 4, 5] },
      torso: { groups: [1], bones: null },
      'arm +x': { groups: [0], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [0], bones: [12, 15], override: { 0: [-1.12, -0.62] } },
    },
    skinPick: { torso: { groups: [1] }, 'leg +x': { groups: [0] }, 'leg -x': { groups: [0] }, 'arm +x': { groups: [0] }, 'arm -x': { groups: [0] } },
    group: () => ({ hips: 0, 'leg +x': 0, 'leg -x': 0, 'arm +x': 0, 'arm -x': 0, torso: 1 }),
    hrLimit: 1250,   // Pepper's prints (98 triangles in the original) are cut at the skin planes: about 700 of the 1,174
  },
  mfg: {
    zone: 'z02LGI', lods: ['MFG_HR', 'MFG_MR', 'MFG_LR', 'MFG_SLR', 'MFG_BGR'], roles: ['SSSSSS', 'SSSSSS', 'SSSSSS', 'SSSSSS', 'SSSSSS'],
    regions: {
      hips: { groups: [0], bones: [0], override: { 1: [1.30, 1.59] } },
      'leg +x': { groups: [5], bones: [2, 6, 7] }, 'leg -x': { groups: [5], bones: [1, 4, 5] },
      torso: { groups: [1, 2, 3], bones: null },
      'arm +x': { groups: [4], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [4], bones: [12, 15], override: { 0: [-1.12, -0.62] } },
    },
    skinPick: { torso: { groups: [1, 2, 3] }, 'leg +x': { groups: [5] }, 'leg -x': { groups: [5] }, 'arm +x': { groups: [4] }, 'arm -x': { groups: [4] } },
    // the torso: front faces carry the print (group 1), back faces group 3, the rest (sides, top, bottom) group 2
    group: () => ({ hips: 0, 'leg +x': 5, 'leg -x': 5, 'arm +x': 4, 'arm -x': 4, torso: 'torso3' }),
    hrLimit: 1250,
  },
};
/** decal draping per LOD: deviation tolerance, smallest edge, depth (far LODs: coarse) */
export const DECAL = [{ tol: 0.02, minEdge: 0.1, maxDepth: 2, cut: true }, { tol: 0.1, minEdge: 0.3, maxDepth: 0, cut: false }, { tol: 0.1, minEdge: 0.3, maxDepth: 0, cut: false }, { tol: 0.1, minEdge: 0.3, maxDepth: 0, cut: false }, { tol: 0.1, minEdge: 0.3, maxDepth: 0, cut: false }];
export const PART_IDS = Object.keys(PARTS);
/** the hip joint (bones 1 / 2): y of their pivot in the reference pose */
const HIP_Y = 1.123;
const LAYOUT_BB = {
  zone: 'z02LGI', lods: ['BB_HR', 'BB_MR', 'BB_LR', 'BB_SLR', 'BB_BGR'], roles: ['SSSS', 'SSSS', 'SSSS', 'SSSS', 'SSSS'],
  regions: {
    hips: { groups: [0], bones: [0], override: { 1: [1.30, 1.61] } },
    'leg +x': { groups: [0], bones: [2, 6, 7] }, 'leg -x': { groups: [0], bones: [1, 4, 5] },
    torso: { groups: [1, 2], bones: [0, 3, 8] },
    'arm +x': { groups: [1], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [1], bones: [12, 15], override: { 0: [-1.12, -0.62] } },
  },
  skinPick: { torso: { groups: [1, 2] }, 'leg +x': { groups: [0] }, 'leg -x': { groups: [0] }, 'arm +x': { groups: [1] }, 'arm -x': { groups: [1] } },
  group: () => ({ hips: 0, 'leg +x': 'legBB', 'leg -x': 'legBB', 'arm +x': 1, 'arm -x': 1, torso: 'torsoBB' }),
  hrLimit: 1100,
};
LAYOUTS.bb = LAYOUT_BB;
// the astronaut Pepper (z36CNT, z40OGL, z40aPO, z41MAP; one LOD): g2 the white suit, g0 the crotch piece (here: the hip block), g1 the blue arm patches and the boot soles (decals)
LAYOUTS.space = {
  zone: 'z40OGL', lods: ['Space_pep_white'], roles: ['SDS'],
  regions: {
    hips: { groups: [0], bones: [0], override: { 0: [-0.72, 0.72], 1: [1.30, 1.59], 2: [-0.36, 0.35] } },
    'leg +x': { groups: [2], bones: [2, 6, 7] }, 'leg -x': { groups: [2], bones: [1, 4, 5] },
    torso: { groups: [2], bones: [0, 3, 8], override: { 0: [-0.72, 0.72], 1: [1.59, 2.87], 2: [-0.39, 0.39] } },
    'arm +x': { groups: [2], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [2], bones: [12, 15], override: { 0: [-1.12, -0.62] } },
  },
  skinPick: { torso: { groups: [2] }, 'leg +x': { groups: [2] }, 'leg -x': { groups: [2] }, 'arm +x': { groups: [2] }, 'arm -x': { groups: [2] } },
  group: () => ({ hips: 0, 'leg +x': 2, 'leg -x': 2, 'arm +x': 2, 'arm -x': 2, torso: 2 }),
  hrLimit: 1100,
};
const SHARE = { hips: 0.06, 'leg +x': 0.2, 'leg -x': 0.2, torso: 0.2, 'arm +x': 0.17, 'arm -x': 0.17 };

/** the skin rule of every part from the original's weights (position only), simplified to at most `maxRings` control rings (fewer cut planes at the far LODs) */
function skinRules(B, spec, maxRings, minGap = 0) {
  const rules = {};
  rules.hips = SKIN.hips;
  for (const [id, pick] of Object.entries(spec.skinPick)) {
    const reg = spec.regions[id];
    const sel = (v) => pick.groups.includes(B.groupOf[v]) && (!reg.bones || reg.bones.includes(B.sv.bone[v])) && (id !== 'torso' || B.world[v * 3 + 1] > 1.3);
    const full = ringSkin(B, sel);
    let eps = 0.02, R = simplifyRings(full.rings, eps);
    while (R.length > maxRings && eps < 4) { eps *= 1.25; R = simplifyRings(full.rings, eps); }
    if (minGap > 0) R = thinRings(R, minGap);
    rules[id] = ringRule(R);
    rules[id].err = skinError(B, sel, rules[id]);
    rules[id].ringsFull = full.rings.length;
  }
  return rules;
}
/** planes (y) where a part is cut so that the skin blend has vertices to act on: the control rings of the (simplified) weight curve that are inside the part */
function bandPlanes(rule, ylo, yhi) {
  const R = rule.rings;
  return R ? R.map((r) => +r.y.toFixed(3)).filter((y) => y > ylo && y < yhi) : [];
}

/** how the far LODs are built: a ladder of lofts, richest first (ring size of the arms, level caps per part kind, level-search tolerance in game units); the first that fits the budget wins */
/** RICH (default; CHARS_BODY=decimated builds the old decimated variant): HR / MR bodies keep the detail of the LDraw parts (rings every `tol` of shape change, more points per ring) */
export const RICH = process.env.CHARS_BODY !== 'decimated';
export const RICH_HR = { K: { arm: 12, other: 8, torso: 8 }, bevel: 0.06, tol: 0.004, shapeAll: true, max: { arm: 14, leg: 14, hips: 3, torso: 6 } };
export const LOFT_LADDER = [
  ...(RICH ? [
    { K: { arm: 10, other: 8, torso: 8 }, bevel: 0.06, tol: 0.006, shapeAll: true, max: { hips: 3, torso: 6, leg: 10, arm: 10 } },
    { K: { arm: 8, other: 6, torso: 8 }, bevel: 0.06, tol: 0.01, shapeAll: true, max: { hips: 2, torso: 4, leg: 8, arm: 8 } },
    { K: { arm: 8, other: 4, torso: 4 }, tol: 0.015, jumps: true, max: { hips: 2, torso: 2, leg: 8, arm: 7 } },
  ] : []),
  { K: { arm: 6, other: 4 }, tol: 0.03, max: { hips: 2, torso: 2, leg: 4, arm: 5 } },
  { K: { arm: 6, other: 4 }, tol: 0.04, max: { hips: 2, torso: 2, leg: 4, arm: 4 } },
  { K: { arm: 4, other: 4 }, tol: 0.05, max: { hips: 2, torso: 2, leg: 3, arm: 4 } },
  { K: { arm: 4, other: 4 }, tol: 0.06, max: { hips: 2, torso: 2, leg: 3, arm: 3 } },
  { K: { arm: 4, other: 4 }, tol: 0.08, max: { hips: 2, torso: 2, leg: 3, arm: 2 } },
  { K: { arm: 4, other: 4 }, tol: 0.1, max: { hips: 2, torso: 2, leg: 2, arm: 2 } },
  { K: { arm: 3, other: 4 }, tol: 0.1, max: { hips: 2, torso: 2, leg: 2, arm: 2 } },
];
export function buildLodGeometry(spec, B, fits, rules, lod, target, res = 'std', L = null, bandY = []) {
  const soups = {}, partPlanes = {};
  const total = Object.values(SHARE).reduce((s, x) => s + x, 0);
  for (const id of Object.keys(PARTS)) {
    let { tris } = partTris(id, fits[id], res);
    const dst = fits[id].dst, ylo = dst.lo[1] - 0.3, yhi = dst.hi[1] + 0.9;
    const mine = id === 'hips' ? [] : bandPlanes(rules[id], Math.max(0, ylo), yhi);
    partPlanes[id] = mine;
    const hrLoft = !L ? (RICH ? RICH_HR : { K: { arm: 8, other: 4 }, tol: 0.01, max: { arm: 10, leg: 8, hips: 2, torso: 2 } }) : null;   // every body part is a loft at every LOD (edge-collapse decimation of the open LDraw shells left spikes and holes)
    if (L || hrLoft) {
      const L2 = L ?? hrLoft;   // far LODs: lofts through the skin planes and the levels where the shape changes
      const lo = dst.lo[1], hi = dst.hi[1];
      const lv = new Set([+lo.toFixed(3), +hi.toFixed(3)]);
      const kind = id.startsWith('arm') ? 'arm' : id.startsWith('leg') ? 'leg' : id;
      const cap = L2.max[kind];
      // the skin planes first (they carry the deformation), then the shape levels by importance, up to `cap` levels in all
      if (kind === 'arm') for (const y of bandY) if (y > lo + 0.02 && y < hi - 0.02) lv.add(y);   // the edge rings of a painted band (chars-paint.mjs bandLevels): the loft has a ring exactly there
      for (const y of mine) if (y > lo + 0.02 && y < hi - 0.02 && lv.size < cap + bandY.length && (!bandY.length || ![...lv].some((q) => Math.abs(q - y) < 0.02))) lv.add(y);
      if ((L2.shapeAll || L2.jumps) && kind === 'leg') {   // steps of the shoe (toe cap, sole): a ring just below and just above every jump of the cross-section, or the loft slants the step into a ramp
        const sl = shapeLevels(tris, lo, hi, L2.tol);
        for (let i = 0; i + 1 < sl.ys.length; i++) { let j = 0; for (let c = 0; c < 4; c++) j = Math.max(j, Math.abs(sl.bb[i + 1][c] - sl.bb[i][c])); if (j > 0.05 && lv.size < cap + 4) { lv.add(+sl.ys[i].toFixed(3)); lv.add(+sl.ys[i + 1].toFixed(3)); } }
      }
      if ((kind !== 'hips' && kind !== 'torso') || L2.shapeAll) for (const y of shapeLevels(tris, lo, hi, L2.tol).ranked) if (y > lo + 0.02 && y < hi - 0.02 && lv.size < cap && ![...lv].some((q) => Math.abs(q - y) < 0.04)) lv.add(+y.toFixed(3));
      const sorted = [...lv].sort((a, b) => a - b);
      soups[id] = loft(tris, sorted, id.startsWith('arm') ? L2.K.arm : (kind === 'torso' || kind === 'hips') && L2.K.torso ? L2.K.torso : L2.K.other, { straighten: id.startsWith('arm'), flatEnds: id.startsWith('arm'), uniform: id.startsWith('arm'), axis: fits[id].axis, bevel: (kind === 'torso' || kind === 'hips') && L2.bevel ? L2.bevel : 0, roundTop: kind === 'leg' && !L ? { cy: HIP_Y, cz: 0, steps: 3 } : null });
      continue;
    }
    for (const y of mine) tris = splitAtPlane(tris, 1, y);
    soups[id] = decimateSoup(tris, Math.max(8, Math.round(target * SHARE[id] / total)), { planes: mine.map((y) => ({ axis: 1, value: y })) });
  }
  return { soups, partPlanes };
}

/** parts -> one indexed mesh with per-vertex skin and per-triangle group */
export function packGeometry(spec, rules, soups, fps = null, partPlanes = {}) {
  const pos = [], bone = [], weight = [], idx = [], tgroup = [], tpart = [];
  const gmap = spec.group();
  const paint = fps && fps.some((f) => f.kind !== 'other') ? prepFootprints(fps) : null;
  for (const [id, soup0] of Object.entries(soups)) {
    const pi = PART_IDS.indexOf(id);
    // painted decals (chars-paint.mjs): the part is cut along the footprints of the front / back prints, the triangles inside a footprint carry the decal's group
    const cut = paint ? cutSoup(soup0, paint) : soup0;
    let w = weldSoup(cut);
    if (process.env.CHARS_DEBUG && paint) console.log(`  part ${id}: soup ${soup0.length / 9} -> cut ${cut.length / 9} -> welded ${w.idx.length / 3}`);
    const tri = (t, W) => Array.from(W.idx.slice(t, t + 3), (i) => [W.pos[i * 3], W.pos[i * 3 + 1], W.pos[i * 3 + 2]]);
    const groupOf = (a) => { const ptag = paint ? tagTri(a, paint) : -1; return ptag >= 0 ? ptag : groupOf0(a); };
    const groupOf0 = (a) => {
      let g = gmap[id];
      if (typeof g === 'string') {
        const u = [a[1][0] - a[0][0], a[1][1] - a[0][1], a[1][2] - a[0][2]], v = [a[2][0] - a[0][0], a[2][1] - a[0][1], a[2][2] - a[0][2]];
        const nz = (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) || 1);
        const cz = (a[0][2] + a[1][2] + a[2][2]) / 3, cy = (a[0][1] + a[1][1] + a[2][1]) / 3;
        if (g === 'torso3') g = nz > 0.35 ? 1 : nz < -0.35 ? 3 : 2;           // MFG: the front carries the print, the back its own group, sides / top / bottom the third
        else if (g === 'torsoBB') g = nz > 0.35 ? 2 : 1;                     // Brickster-bot: the front plane is group 2, the rest shares group 1 with the arms
        else if (g === 'legBB') g = nz > 0.8 && cz > 0.36 && cy < 0.33 ? 3 : 0;   // Brickster-bot: the front of the shoes is group 3, the rest of the legs group 0
      }
      return g;
    };
    let tg = []; for (let t = 0; t < w.idx.length; t += 3) tg.push(groupOf(tri(t, w)));
    if (paint) {   // a print that only grazes a part (the thigh print and the top of the hips, the torso print and the inside of a sleeve) is not painted there: under 15 % of its area
      const area = new Map(); for (let t = 0; t < tg.length; t++) if (paint.some((f) => f.g === tg[t])) area.set(tg[t], (area.get(tg[t]) ?? 0) + triArea(tri(t * 3, w)));
      for (const f of paint) if ((area.get(f.g) ?? 0) < 0.15 * f.area) for (let t = 0; t < tg.length; t++) if (tg[t] === f.g) tg[t] = typeof gmap[id] === 'string' ? groupOf0(tri(t * 3, w)) : gmap[id];
    }
    const openCount = (W) => { const E = new Map(); for (let t = 0; t < W.idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const x = W.idx[t + a], y = W.idx[t + b]; if (x === y) continue; const k = x < y ? `${x}|${y}` : `${y}|${x}`, e = E.get(k) ?? { n: 0, d: 0 }; e.n++; e.d += x < y ? 1 : -1; E.set(k, e); } return [...E.values()].filter((e) => e.n !== 2 || e.d !== 0).length; };
    if (process.env.CHARS_DEBUG === '4') console.log(`    ${id}: open edges after cut+weld ${openCount(w)} (uncut soup ${openCount(weldSoup(soup0))})`);
    if (paint && !process.env.CHARS_NOMERGE) {   // the cuts leave many coplanar slivers: merge them again (group borders and the skin band planes stay)
      if (process.env.CHARS_DEBUG === '2') for (const [crease, maxCost, bw] of [[4, 1e-7, 50], [30, 1e-7, 50], [60, 1e-7, 50], [4, 1e-5, 50], [4, 1e-7, 1], [4, 1e-4, 5]]) { const q = decimate({ pos: w.pos, idx: w.idx, group: tg }, { targetTris: 1, maxCost, crease, borderWeight: bw, planes: (partPlanes[id] ?? []).slice(0, 30).map((value) => ({ axis: 1, value })) }); console.log(`    ${id} crease ${crease} maxCost ${maxCost} bw ${bw}: ${q.stats.after}`); }
      if (process.env.CHARS_DEBUG === '3' && id === 'hips') { const q = decimate({ pos: w.pos, idx: w.idx, group: tg }, { targetTris: 1, maxCost: 1e-7, crease: 4 }); const used = new Set(q.idx); console.log('    hips verts', [...used].map((v) => `(${[0, 1, 2].map((c) => q.pos[v * 3 + c].toFixed(3)).join(',')})`).join(' ')); }
      const r = mergeFlat(w.pos, w.idx, tg, (partPlanes[id] ?? []).map((value) => ({ axis: 1, value })));
      w = { pos: r.pos, idx: r.idx }; tg = Array.from(r.group);
      if (process.env.CHARS_DEBUG === '4') console.log(`    ${id}: open edges after merge ${openCount(w)}`);
      if (process.env.CHARS_DEBUG) { const h = {}; for (const g of tg) h[g] = (h[g] ?? 0) + 1; console.log(`  part ${id}: merged to ${tg.length} triangles, by group ${JSON.stringify(h)}`); }
    }
    const base = pos.length / 3;
    for (let v = 0; v < w.pos.length / 3; v++) {
      const q = [w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]];
      pos.push(...q);
      const inf = rules[id](q).slice(0, 4);
      for (let k = 0; k < 4; k++) { bone.push(inf[k]?.bone ?? 255); weight.push(inf[k]?.w ?? 0); }
    }
    for (let t = 0; t < w.idx.length; t += 3) { idx.push(base + w.idx[t], base + w.idx[t + 1], base + w.idx[t + 2]); tgroup.push(tg[t / 3]); tpart.push(pi); }
  }
  // sort the triangles by group (not needed by the format, tidy)
  return { pos, bone, weight, idx, group: tgroup, part: tpart };
}

let POSES = null, POSES_DEV = null;
const hex = (b) => hashBytes(b);
export async function build(ctx) {
  const tables = { v: 1, bind: Array.from(BONES, (x) => +x.toFixed(6)), bodies: {}, members: {}, skipped: [], kept: { bodies: ['MUM_HRbody (z08BKD diver: the PEPD.blk rig of 21 bones, a diving suit, not a minifig body)'], heads: [], hands: [] } };
  const rig = new Rig(BONES);
  for (const [name, spec] of Object.entries(LAYOUTS)) {
    const A = archive(spec.zone);
    const B = loadBody(spec.zone, spec.lods[0] + '.msh');
    const fits = fitsOf(B, spec);
    for (let li = 0; li < spec.lods.length; li++) {
      if (process.env.CHARS_ONLY && !process.env.CHARS_ONLY.split(',').includes(`${name}-${li}`)) continue;   // dev loop only (with a dummy ctx, see chars-try.mjs): never for the real pack build
      const member = `Meshes/${spec.lods[li]}.msh`, origBytes = A.read(A.find(member));
      const origTris = parseMsh(origBytes).indices.length / 3;
      const limit = process.env.CHARS_LIMIT ? +process.env.CHARS_LIMIT : li === 0 ? spec.hrLimit : li === 1 ? Math.round(origTris * 1.5) : origTris;   // LOD > 0: at most the original's triangles; HR: spec.hrLimit (docs/re/lego3d.md: about 2x)
      let best = null;
      // decal groups are PAINTED onto the rebuilt surface (the triangles inside their footprint carry the decal's group, role 'S'); only decals that face up / down (soles) stay overlays ('D')
      const fps = footprints(loadBody(spec.zone, spec.lods[li] + '.msh'), spec.roles[li], !process.env.CHARS_NOWRAP);
      const bandY = bandLevels(fps), bands = bandGroups(fps);
      const attempt = (rules, target, L, tag) => {
        const { soups, partPlanes } = buildLodGeometry(spec, B, fits, rules, li, target, 'std', L, bandY);
        const pk = packGeometry(spec, rules, soups, fps, partPlanes);
        const blob = encodeBody(pk);
        // a decal group that found no host triangle stays an overlay ('D', draped by the assembler)
        const rolesLod = spec.roles[li].split('').map((r, gi) => (r === 'D' && pk.group.includes(gi) ? 'S' : r)).join('');
        const hosts = decalHosts(origBytes, pk, rolesLod, rig);
        const dopt = { roles: rolesLod, hosts, ...DECAL[li], partPlanes: DECAL[li].cut ? PART_IDS.map((id) => partPlanes[id] ?? []) : undefined };
        const res = assembleBody(origBytes, decodeBody(blob), rig, dopt);
        const total = res.stats.solidTris + res.stats.decalTris;
        if (process.env.CHARS_VERBOSE) ctx.log(`${name} ${spec.lods[li]}: ${tag} -> solid ${res.stats.solidTris} + decal ${res.stats.decalTris} = ${total} (limit ${limit})`);
        return { blob, total, res, partPlanes, dopt, rolesLod };
      };
      // the skin ring count is the trade between a faithful blend (rings) and long edges (stretch): every candidate is measured over a sample of all clips, the one with the lowest worst-case stretch wins
      POSES ??= samplePoses(10);
      POSES_DEV ??= samplePoses(25, 2);
      const score = (r) => { const solidGroups = r.rolesLod.split('').map((c, i) => (c === 'D' ? -1 : i)).filter((i) => i >= 0);   // overlay decals ride the surface they lie on: their stretch is the host's, not scored here
        const st = edgeStretch(r.res.bytes, POSES, solidGroups); r.st = st; r.dev = poseDeviation(r.res.bytes, origBytes, POSES_DEV);
        // "no worse than the original": a candidate whose p90 / max stretch exceeds the ORIGINAL's (same groups, same poses) pays dearly; among the rest the one that follows the original's deformation best wins
        const og = (origStretch[solidGroups.join()] ??= edgeStretch(origBytes, POSES, solidGroups));
        r.orig = og;
        // a painted band (Pepper's arm band: an overlay in the game's mesh, whose own stretch is part of `og`) must also be no worse than the original WITHOUT it: the stricter of the two bars
        const plain = solidGroups.filter((g) => !bands.includes(g)), og0 = bands.length ? (origStretch[plain.join()] ??= edgeStretch(origBytes, POSES, plain)) : og;
        const bar = { max: Math.min(og.max, og0.max), p90: Math.min(og.p90, og0.p90) };
        return 50 * (Math.max(0, st.max / bar.max - 1) + Math.max(0, st.p90 / bar.p90 - 1)) + 10 * Math.max(0, r.dev.extra95) + 0.05 * st.max; };
      const origStretch = {};
      const cands = [];
      if (li === 0) {
        for (const [maxRings, minGap] of process.env.CHARS_RINGS ? [[+process.env.CHARS_RINGS, 0]] : [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [9, 0], [4, 0.2], [5, 0.2], [6, 0.2], [9, 0.2]]) {
          const rules = skinRules(B, spec, maxRings, minGap);
          let target = limit * 0.6, got = null;
          for (let iter = 0; iter < 9; iter++) {
            const r = attempt(rules, target, null, `rings<=${maxRings} target ${Math.round(target)}`);
            if (r.total <= limit && (!got || r.total > got.total)) got = r;
            if (r.total <= limit && r.total >= limit * 0.94) break;
            if (target <= 20 && r.total > limit) break;
            if (!process.env.CHARS_DECIMATE_LOOP) break;   // the HR body is a loft: its size does not depend on `target`
            target = Math.max(20, target + (limit - r.total) * 0.8);
          }
          if (got) { got.maxRings = maxRings; got.minGap = minGap; cands.push(got); }
        }
      } else {
        let L0 = null;
        for (const R of [4, 2]) { for (const L of LOFT_LADDER) { const r = attempt(skinRules(B, spec, R), 0, L, `loft K${L.K.arm} tol ${L.tol} rings<=${R}`); if (r.total <= limit) { L0 = L; break; } } if (L0) break; }
        if (L0) for (const [maxRings, minGap] of [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [4, 0.2], [5, 0.2], [6, 0.2]]) { const r = attempt(skinRules(B, spec, maxRings, minGap), 0, L0, `loft K${L0.K.arm} rings<=${maxRings} gap ${minGap}`); if (r.total <= limit) { r.maxRings = maxRings; r.minGap = minGap; cands.push(r); } }
      }
      for (const c of cands) c.score = score(c);
      cands.sort((x, y) => x.score - y.score);
      if (process.env.CHARS_VERBOSE) for (const c of cands) ctx.log(`  cand rings<=${c.maxRings} gap ${c.minGap ?? 0}: score ${c.score.toFixed(2)} st ${c.st.median.toFixed(2)}/${c.st.p90.toFixed(2)}/${c.st.max.toFixed(2)} orig ${c.orig.median.toFixed(2)}/${c.orig.p90.toFixed(2)}/${c.orig.max.toFixed(2)} drift ${c.dev.extra95.toFixed(4)} tris ${c.total}`);
      if (cands.length) { best = cands[0]; ctx.log(`${name} ${spec.lods[li]}: skin rings<=${best.maxRings}${best.minGap ? ' gap ' + best.minGap : ''} chosen: stretch median/p90/max ${best.st.median.toFixed(2)}/${best.st.p90.toFixed(2)}/${best.st.max.toFixed(2)}, drift from the posed original (p95, beyond the bind-pose fit error) ${best.dev.extra95.toFixed(3)} (candidates stretch/drift ${cands.map((c) => `${c.maxRings}${c.minGap ? 'g' : ''}:${c.st.max.toFixed(1)}/${c.dev.extra95.toFixed(2)}`).join(' ')}), ${best.total} triangles`); }
      if (!best) { ctx.log(`${name} ${spec.lods[li]}: NO solution within the original's ${limit} triangles: stays the game's mesh`); tables.skipped.push(`${name}-${li}`); tables.kept.bodies.push(`${spec.lods[li]} (${origTris} triangles: no loft with its prints fits the budget)`); continue; }
      if (process.env.CHARS_DUMP) { (await import('node:fs')).mkdirSync(process.env.CHARS_DUMP, { recursive: true }); (await import('node:fs')).writeFileSync(`${process.env.CHARS_DUMP}/${spec.lods[li]}.msh`, best.res.bytes); }
      ctx.put(`chars/body/${name}-${li}.bin`, best.blob);
      tables.bodies[`${name}-${li}`] = { layout: name, lod: li, limit, origTris, tris: best.total, stretch: [+best.st.median.toFixed(3), +best.st.p90.toFixed(3), +best.st.max.toFixed(3)], drift95: +best.dev.extra95.toFixed(4), maxRings: best.maxRings, minGap: best.minGap ?? 0, roles: best.rolesLod, painted: best.rolesLod.split('').map((r, g) => (r === 'S' && spec.roles[li][g] === 'D' ? g : -1)).filter((g) => g >= 0), blob: `chars/body/${name}-${li}.bin`, hosts: best.dopt.hosts, parts: PART_IDS, partPlanes: DECAL[li].cut ? PART_IDS.map((id) => best.partPlanes[id] ?? []) : null, decal: { tol: DECAL[li].tol, minEdge: DECAL[li].minEdge, maxDepth: DECAL[li].maxDepth } };
    }
  }
  if (process.env.CHARS_ONLY) return;
  // which members of the game are bodies of which layout / LOD: every character model whose HR body has the representative's group structure
  const inv = loadInventory();
  const sig = (h) => { const m = inv.meshes[h]; return m ? JSON.stringify([m.verts, m.groups]) : null; };
  for (const [name, spec] of Object.entries(LAYOUTS)) {
    const A = archive(spec.zone);
    const repHash = (li) => hashBytes(A.read(A.find(`Meshes/${spec.lods[li]}.msh`)));
    const hrSig = sig(repHash(0));
    for (const m of inv.models) {
      if (!m.parts[0]?.hash || sig(m.parts[0].hash) !== hrSig) continue;
      m.parts.forEach((p, li) => {
        const key = `${name}-${li}`;
        if (!p.hash || !tables.bodies[key] || li >= spec.lods.length) return;
        if (sig(p.hash) !== sig(repHash(li))) return;
        ((tables.members[p.member.toLowerCase()] ??= {})[p.hash] = key);
      });
    }
  }
  buildSkeletons(ctx, tables, inv, rig);
  tables.statics = {};
  buildHeads(ctx, tables, inv);
  buildHands(ctx, tables, inv);
  buildGear(ctx, tables, inv, { addStatic, groupBox, archive, parseMsh, assembleStatic, encodeStatic, decodeStatic });
  ctx.use(cleanHead().infos); ctx.use(cleanHand().infos);
  for (const id of PART_IDS) ctx.use(cleanPart(id, 'std').infos);   // the body parts (hips, legs, torso, arms) and everything they reference: licence record
  ctx.put('chars/tables.json', JSON.stringify(tables));
}

// ---------------------------------------------------------------- heads
const groupBox = (m, g) => { const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9]; for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[v * 3 + c]); hi[c] = Math.max(hi[c], m.positions[v * 3 + c]); } return { lo, hi }; };
/** registers a static recipe: blob + roles for the member of this hash */
function addStatic(ctx, tables, key, member, hash, bytes, recipe) {
  ctx.put(`chars/static/${key.replace(/[^a-z0-9_-]/gi, '_')}.bin`, bytes);
  tables.statics[key] = { ...recipe, blob: `chars/static/${key.replace(/[^a-z0-9_-]/gi, '_')}.bin` };
  (tables.members[member.toLowerCase()] ??= {})[hash] = key;
}
function buildHeads(ctx, tables, inv) {
  const done = new Set();
  const stats = { replaced: 0, kept: [], tris: [] };
  for (const o of inv.models) {
    const a = o.attach.find((x) => x?.slot === 4);
    if (!a) continue;
    const faceSet = a.face ?? (o.face && o.face.slot === 4 ? o.face : null);
    a.parts.forEach((p, li) => {
      if (!p.hash || done.has(p.hash)) return;
      done.add(p.hash);
      const A = archive(o.zone), orig = A.read(A.find(p.member)), m = parseMsh(orig);
      const origTris = m.indices.length / 3, fi = faceSet?.groups?.[li];
      let skinIdx = -1, roles = null;
      // the skin group of a head with more groups (hair, a band, goggles ...) is the one that has the texture of the model's hands (hands and head are the same skin)
      const handTex = (() => { const h = o.attach.find((x) => x && (x.slot === 6 || x.slot === 8)); return h?.parts[Math.min(li, h.parts.length - 1)]?.tex?.[0]; })();
      if (fi !== undefined && fi >= 0 && fi < m.groups.length) {
        if (m.groups.length === 2) { skinIdx = 1 - fi; roles = 'SS'; }
        else {
          const c = m.groups.map((_, g) => g).filter((g) => g !== fi && p.tex?.[g] === handTex && handTex !== undefined);
          if (c.length === 1) { skinIdx = c[0]; roles = m.groups.map((_, g) => (g === fi || g === skinIdx ? 'S' : 'K')).join(''); }
        }
      }
      if (!roles || skinIdx < 0) { stats.kept.push(`${p.name} (${m.groups.length} groups, face ${fi})`); return; }
      // the Brickster-bots' heads (BBT / BBR / BBG / BBB / BBY) are CUBES with a face plate, not minifig heads: the LDraw head would be the wrong shape
      if (/^BB[A-Z]_/i.test(p.name)) { stats.kept.push(`${p.name}: cube head of a Brickster-bot (not a minifig head)`); return; }
      const skinBox = groupBox(m, m.groups[skinIdx]), fb = groupBox(m, m.groups[fi]);
      const fy = new Set(); { const gf = m.groups[fi]; for (let v = gf.firstVertex; v < gf.firstVertex + gf.vertexCount; v++) fy.add(+m.positions[v * 3 + 1].toFixed(2)); }
      const face = { y0: fb.lo[1], y1: fb.hi[1], fx: fb.hi[0], levels: origTris >= 90 ? [...fy].sort((a, b) => a - b) : [] };   // (the far heads have no room for the extra rings)
      // a neck: the skin group reaches well below the face band (the cylinder under the chin); measured from its vertices (centre, half extents, y range)
      let neck = null;
      if (face.y0 - skinBox.lo[1] > 0.12 && origTris >= 90) {   // (the far heads of 30 - 46 triangles have no room for a tube)
        const g = m.groups[skinIdx], pts = [];
        for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) if (m.positions[v * 3 + 1] < face.y0 - 0.05) pts.push([m.positions[v * 3], m.positions[v * 3 + 2]]);
        if (pts.length >= 4) {
          const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length, r = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
          neck = { top: face.y0, bottom: skinBox.lo[1], cx, cz, rx: r * 0.92, rz: r * 0.92 };   // (a hair under the mean radius: the tube must stay inside the head's bottom bevel where it enters)
        }
      }
      const limit = origTris >= 200 ? Math.min(2 * origTris, 480) : origTris;
      // every ring ladder rung that fits the budget is built; the one that stays closest to the game's own head of this LOD (symmetric mean surface distance) wins: lods that all follow the game's lods pop like they do
      let best = null;
      for (const cfg of HEAD_LADDER) {
        const r = buildHead(skinBox, face, cfg, neck);
        const pos = [], idx = [], group = [];
        // weld by position
        const map = new Map();
        for (let i = 0; i < r.tris.length; i += 3) { const k = `${Math.round(r.tris[i] * 1e5)},${Math.round(r.tris[i + 1] * 1e5)},${Math.round(r.tris[i + 2] * 1e5)}`; let id = map.get(k); if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(r.tris[i], r.tris[i + 1], r.tris[i + 2]); } idx.push(id); }
        r.tags.forEach((tg) => group.push(tg ? fi : skinIdx));
        const bytes = encodeStatic({ pos, idx, group });
        const out = assembleStatic(orig, decodeStatic(bytes), roles, roles === 'SS' ? [[], []].map((_, g) => [1 - g]) : []);
        if (!out || out.stats.tris > limit) continue;
        const dev = meshDeviation(orig, out.bytes);
        if (!best || dev < best.dev - 1e-4) best = { bytes, out, dev, cfg };
      }
      if (best) {
        addStatic(ctx, tables, `head:${p.hash}`, p.member, p.hash, best.bytes, { roles, nrmFrom: roles === 'SS' ? [[1], [0]] : [], kind: 'head', lod: li, limit, origTris, tris: best.out.stats.tris, K: best.cfg[0], dev: +best.dev.toFixed(4) });
        stats.replaced++; stats.tris.push([p.name, origTris, best.out.stats.tris, best.cfg[0], best.dev.toFixed(3)]);
        return;
      }
      stats.kept.push(`${p.name}: no loft within ${limit} triangles`);
    });
  }
  // every member that carries one of these contents (the same head file sits under many names)
  for (const o of inv.models) for (const a of o.attach) if (a?.slot === 4) for (const p of a.parts) if (p.hash && tables.statics[`head:${p.hash}`]) (tables.members[p.member.toLowerCase()] ??= {})[p.hash] = `head:${p.hash}`;
  tables.kept.heads = stats.kept;
  ctx.log(`heads: ${stats.replaced} replaced, kept original: ${stats.kept.join('; ')}`);
  ctx.log(`head triangles (name, original, new, K, mean distance to the game's head): ${stats.tris.slice(0, 80).map((x) => x.join('/')).join(' ')}`);
}

// ---------------------------------------------------------------- hands
/** the HR hands (one group, 50-90 triangles, slot 6 / 8): the LDraw claw fitted by chamfer distance; MR / LR / SLR / BGR hands (42 / 26 / 10 / 4 triangles) stay the game's */
function buildHands(ctx, tables, inv) {
  const seen = new Set(), rows = [], stat = { hr: 0, mr: 0, kept: 0 };
  const HAND_HR = 120, HAND_CHAMFER = 0.1;
  for (const o of inv.models) for (const a of o.attach) {
    if (!a || (a.slot !== 6 && a.slot !== 8)) continue;
    a.parts.forEach((p, li) => {
      if (!p?.hash || seen.has(p.hash)) return;
      seen.add(p.hash);
      const A = archive(o.zone), orig = A.read(A.find(p.member)), m = parseMsh(orig);
      const tris = m.indices.length / 3, box = groupBox(m, m.groups[0]);
      const size = box.hi.map((x, i) => x - box.lo[i]);
      // the claw (3820) fits the HR hand and the MR hand (a C shape of 42 - 66 triangles); LR (26), SLR (10), BGR (4) are blocks / a cone in the game: a claw decimated that far is lumpier than they are (they stay the game's)
      const isHook = /^HATE/i.test(p.name);
      if (m.groups.length !== 1 || tris < 36 || tris > 90 || Math.max(...size) > 0.9 || isHook) { rows.push(`${p.name}: kept (${m.groups.length} groups, ${tris} tris, ${size.map((x) => x.toFixed(2)).join('x')})`); stat.kept++; return; }
      const f = fitHand(m.positions, Array.from(m.indices));
      if (f.d > HAND_CHAMFER) { rows.push(`${p.name}: kept (chamfer ${f.d.toFixed(3)})`); stat.kept++; return; }
      const limit = li === 0 ? HAND_HR : tris;   // HR: 1.6x the game's 74 (the claw has real tines); the MR hand: at most the original's
      const w = weldSoup(f.tris);
      const r = w.idx.length / 3 > limit ? decimate({ pos: w.pos, idx: w.idx }, { targetTris: limit, crease: 30 }) : { pos: w.pos, idx: w.idx };
      const pos = Array.from(r.pos), idx = Array.from(r.idx), nt = idx.length / 3;
      const bytes = encodeStatic({ pos, idx, group: new Array(nt).fill(0) });
      const out = assembleStatic(orig, decodeStatic(bytes), 'S', []);
      if (!out || out.stats.tris > limit) { rows.push(`${p.name}: kept (${out?.stats.tris} > ${limit})`); stat.kept++; return; }
      addStatic(ctx, tables, `hand:${p.hash}`, p.member, p.hash, bytes, { roles: 'S', kind: 'hand', lod: li, limit, origTris: tris, tris: out.stats.tris, chamfer: +f.d.toFixed(4) });
      rows.push(`${p.name}: ${tris} -> ${out.stats.tris} (chamfer ${f.d.toFixed(3)})`);
      stat[li === 0 ? 'hr' : 'mr']++;
    });
  }
  for (const o of inv.models) for (const a of o.attach) if (a && (a.slot === 6 || a.slot === 8)) for (const p of a.parts) if (p?.hash && tables.statics[`hand:${p.hash}`]) (tables.members[p.member.toLowerCase()] ??= {})[p.hash] = `hand:${p.hash}`;
  tables.kept.hands = rows.filter((r) => r.includes('kept'));
  ctx.log(`hands: ${stat.hr} HR + ${stat.mr} MR replaced, ${stat.kept} kept: ${rows.join('; ')}`);
}

/** which parts carry a decal group: the parts of the pack triangles nearest to its vertices (at least a fifth of them) */
function decalHosts(origBytes, pk, roles, rig) {
  const o = readOrig(origBytes, rig), out = roles.split('').map(() => null);
  if (!o) return out;
  const solid = new TriSet(pk.pos, pk.idx);
  roles.split('').forEach((r, gi) => {
    if (r !== 'D') return;
    const g = o.m.groups[gi], count = new Map(); let n = 0;
    for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) { const c = solid.closest([o.world[v * 3], o.world[v * 3 + 1], o.world[v * 3 + 2]], null, 0, 0.6); if (c) { const pi = pk.part[c.tri]; count.set(pi, (count.get(pi) ?? 0) + 1); n++; } }
    const parts = [...count].filter(([, k]) => k >= n * 0.2).map(([pi]) => pi).sort((a, b) => a - b);
    out[gi] = parts.length ? parts : null;
  });
  return out;
}

// ---------------------------------------------------------------- skeleton / mummy bodies
/** SKEL_HR / MUMM_HR: LDraw skeleton parts (chars-skel.mjs), rigid skin per region with a 50 / 50 ring at each joint plane; HR only (the game has no other LOD of them) */
const SKEL_LIMIT = 2.6;   // the skeleton is HR only and not capped at the original's triangles (rule of round 2: no ceiling for what is seen close); at most 2.6x
function buildSkeletons(ctx, tables, inv, rig) {
  const done = new Set(), rows = [];
  for (const o of inv.models) {
    const p = o.parts[0];
    if (!p?.hash || !/^(SKEL|MUMM)_HR\.msh$/i.test(p.name) || done.has(p.hash)) continue;
    done.add(p.hash);
    const A = archive(o.zone), orig = A.read(A.find(p.member)), origTris = parseMsh(orig).indices.length / 3;
    const sk = buildSkeleton(o.zone, p.name);
    if (!sk) { rows.push(`${p.name}: no region`); continue; }
    const blob = encodeBody(packSkeleton(sk));
    const roles = 'S', res = assembleBody(orig, decodeBody(blob), rig, { roles, hosts: [null], tol: 0.1, minEdge: 0.3, maxDepth: 0 });
    if (!res || res.stats.solidTris > SKEL_LIMIT * origTris) { rows.push(`${p.name}: NOT replaced (${res?.stats.solidTris} triangles, limit ${SKEL_LIMIT * origTris})`); continue; }
    const key = `skel${done.size}-0`;
    ctx.put(`chars/body/${key}.bin`, blob);
    tables.bodies[key] = { layout: 'skel', lod: 0, limit: Math.round(SKEL_LIMIT * origTris), origTris, tris: res.stats.solidTris, roles, painted: [], blob: `chars/body/${key}.bin`, hosts: [null], parts: SKEL_PARTS.map((x) => x.id), partPlanes: null, decal: { tol: 0.1, minEdge: 0.3, maxDepth: 0 } };
    ((tables.members[p.member.toLowerCase()] ??= {})[p.hash] = key);
    rows.push(`${p.name}: ${origTris} -> ${res.stats.solidTris} (pieces ${sk.pieces.map((x) => `${SKEL_PARTS[x.part].id} ${x.tris.length / 9}`).join(', ')})`);
    ctx.use(lib.flatten('6260.dat', { res: 'std' }).infos); ctx.use(lib.flatten('6265.dat', { res: 'std' }).infos); ctx.use(lib.flatten('6266.dat', { res: 'std' }).infos);
  }
  ctx.log(`skeleton bodies: ${rows.join('; ')}`);
}
