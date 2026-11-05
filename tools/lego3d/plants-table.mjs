// The plants table (docs/re/lego3d.md section 19, generator `plants`): which of the game's vegetation meshes are rebuilt from LDraw-style parts, and how. The builders (`pineParts`, `oakParts`) turn a few fitted numbers
// into part instances for tools/lego3d/plants.mjs (`buildPlant`); tools/lego3d/plants-fit.mjs finds the numbers (hill climbing on the silhouette IoU against the game's own mesh, 6 views);
// tools/lego3d/pack/plants.mjs writes the pack part. Every number is a measurement of the game's mesh (box, taper); no game triangle goes into the pack.
//
//   pine: a stack of round plates (LDraw 4032a Plate Round 2 x 2, a plain cylinder, scaled to the fitted size; 8 sides like the game's octagonal cone) of decreasing size on a round-brick trunk (3062b) and a round-plate foot
//   oak:  a stack of round plates whose radius follows the game's ball (10 / 8 sides) on the same kind of trunk
const LATHE_PHASE = 22.5;   // the game's cones are octagons with the flats facing +-x / +-z: the first vertex sits half a side round
const CYL = [{ y: 0, r: 1 }, { y: 1, r: 1 }];

/**
 * pine: `layers` stacked round plates (octagons like the game's cone, circumradius from R at the bottom to ~0 at the top: layer i has the radius of the cone at its middle, `bias` shifts the cone) between y0 and y1, on a
 * round-brick trunk (radius `trunk`) and a round-plate foot (radius `foot`). Each layer is a Plate Round (4032a: a plain cylinder), the trunk Brick Round 1 x 1 (3062b: a plain cylinder) scaled to the fitted size.
 */
export function pineParts({ y0, y1, R, bias = 0, layers = 8, foot = 1.35, trunk = 0.74, footTop = 0.5, n = 8 }) {
  const prof = [], h = (y1 - y0) / layers;
  for (let i = 0; i < layers; i++) { const r = R * (1 - (i + 0.5 + bias) / layers); prof.push({ y: y0 + i * h, r }, { y: y0 + (i + 1) * h, r }); }
  return [
    { lathe: true, part: '4032a', profile: prof, n, phase: LATHE_PHASE, box: { y: [y0, y1], r: Math.max(...prof.map((q) => q.r)) }, group: 0 },
    { lathe: true, part: '4032a', profile: CYL, n, phase: LATHE_PHASE, box: { y: [0.03, footTop], r: foot }, group: 1 },
    { lathe: true, part: '3062b', profile: CYL, n, phase: LATHE_PHASE, box: { y: [footTop, y0 + 0.5], r: trunk }, group: 1 },
  ];
}
/**
 * oak: `layers` stacked round plates between y0 and y1 whose radius follows a ball (a circle of radius `r` through the layer's middle; `aspect` stretches z, `phase` turns the polygon), trunk radius `trunk`.
 * body = [y0, y1, r, aspect, phase]
 */
export function oakParts({ body, trunk, layers = 8, n = 10, nT = 8 }) {
  const [y0, y1, r, aspect = 1, phase = 0] = body, prof = [], h = (y1 - y0) / layers, yc = (y0 + y1) / 2;
  for (let i = 0; i < layers; i++) { const ym = y0 + (i + 0.5) * h, t = (ym - yc) / ((y1 - y0) / 2), q = Math.sqrt(Math.max(0.02, 1 - t * t)) * r; prof.push({ y: y0 + i * h, r: q }, { y: y0 + (i + 1) * h, r: q }); }
  return [
    { lathe: true, part: '4032a', profile: prof, n, phase, box: { y: [y0, y1], r: Math.max(...prof.map((x) => x.r)), aspect }, group: 0 },
    { lathe: true, part: '3062b', profile: CYL, n: nT, phase: LATHE_PHASE, box: { y: [-0.1, y0 + 1.0], r: trunk }, group: 1 },
  ];
}

/**
 * The models: the numbers found by plants-fit.mjs against the reference mesh (the pine's far LOD is the near one: the game's own two LODs are the same cone, so a second build would only add a pop) (z02LGI MRPineTree / LRPineTree / MR_OakTree / LR_OakTree; the other zones' copies have the same box).
 * `match`: members (any archive) that are the game's mesh of that model / LOD: name pattern + the box of the reference (+- tol) + they must be used by a record of the zone.
 */
export const MODELS = {
  pine_mr: { build: () => pineParts({ y0: 3.59, y1: 17.9, R: 5.1, bias: -0.03, layers: 8, foot: 1.33, trunk: 0.74 }), match: { re: /^Meshes\/(MRPineTree|Pine_MR|LRPineTree|Pine_LR)\.msh$/i, box: [9.01, 18.57, 9.01] } },
  oak_mr: { build: () => oakParts({ body: [5.8, 18.29, 6.67, 1.03, -2.28], trunk: 1, layers: 8, n: 10 }), match: { re: /^Meshes\/MR_OakTree\.msh$/i, box: [12.93, 19.14, 12.93] } },
  oak_lr: { build: () => oakParts({ body: [5.86, 18.33, 6.41, 1.12, 3.3], trunk: 0.88, layers: 6, n: 10, nT: 6 }), match: { re: /^Meshes\/LR_OakTree\.msh$/i, box: [12.49, 19.26, 14.42], tol: 0.4 } },
};
/** the silhouette gate of the pack build: minimum IoU over the 6 views at 384 px (docs section 19) */
export const GATE = { min: 0.9, views: [[0, 0], [45, 0], [90, 0], [0, 90], [35, 25], [215, 25]], size: 384 };
