// Direct3D 7 IDirect3DDevice7::ComputeSphereVisibility (src/fx/particles/sprites.ts `planesFromD3d` / `visibleFlags`) against the expected values of Wine's
// `test_compute_sphere_visibility` (dlls/ddraw/tests/ddraw7.c), which are measured on native Windows. The executable's FUN_0088841c / FUN_00416d1a call this method
// and keep a sprite when `(flags & 0xf) == flags`; the layout is the D3DSTATUS clip union (bit i) / intersection (0x1000 << i) layout, not D3DVIS_*.
// Cases 12-15 of Wine's table enable the user clip plane (CLIPPLANEENABLE): the game never does, so they are not run.
import { planesFromD3d, frustumPlanes, visibleFlags } from '../../src/fx/particles/sprites.ts';

const f = Math.fround;
/** row-vector product a * b in float32 */
const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s = f(s + f(a[i * 4 + k] * b[k * 4 + j])); o[i * 4 + j] = s; } return o; };
const M = (...v) => Float32Array.from(v);
const proj1 = M(1.810660, 0, 0, 0, 0, 2.414213, 0, 0, 0, 0, 1.020408, 1, 0, 0, -0.102041, 0);
const proj2 = M(10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 1);
const view1 = M(1, 0, 0, 0, 0, 0.768221, -0.640185, 0, -0, 0.640185, 0.768221, 0, -14.852037, 9.857489, 11.600972, 1);
const id = M(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const tests = [
  [view1, proj1, [[11.461533, -4.761727, -1.171646]], [38.252632], [0x3f]],
  [view1, proj1, [[-3.515620, -1.560661, -12.464638], [14.290396, -2.981143, -24.311312], [1.461626, -6.093709, -13.901010]], [4.354097, 12.500704, 17.251318], [0x103d, 0x3f, 0x3f]],
  [id, proj2, [[0, 0, 0.05]], [0.04], [0]],
  [id, id, [[0, 0, 0.5]], [0.5], [0]],
  [id, id, [[0, 0, 0]], [0], [0]],
  [id, id, [[-1, -1, 0.5]], [0.25], [0x9]],
  [id, id, [[-20, 0, 0.5]], [3], [0x103d]],
  [id, id, [[20, 0, 0.5]], [3], [0x203e]],
  [id, id, [[0, -20, 0.5]], [3], [0x803b]],
  [id, id, [[0, 20, 0.5]], [3], [0x4037]],
  [id, id, [[0, 0, -20]], [3], [0x1001f]],
  [id, id, [[0, 0, 20]], [3], [0x2002f]],
];

export default {
  name: 'd3d-spherevis',
  run() {
    const failures = []; let checked = 0;
    tests.forEach(([view, proj, centres, radii, expected], t) => {
      const planes = planesFromD3d(mul(view, proj));
      centres.forEach((c, j) => {
        checked++;
        const got = visibleFlags(planes, c[0], c[1], c[2], radii[j]);
        if (got !== expected[j]) failures.push(`test ${t} sphere ${j}: expected ${expected[j].toString(16)}, got ${got.toString(16)}`);
      });
    });
    // the GL-clip-space entry point (what the renderer's view-projection gives) finds the same planes: scaled copies of the D3D ones
    for (let t = 0; t < tests.length; t++) {
      const [view, proj] = tests[t];
      const d = mul(view, proj), gl = new Float32Array(d);
      for (let r = 0; r < 4; r++) gl[r * 4 + 2] = d[r * 4 + 2] * 2 - d[r * 4 + 3];   // z_gl = 2 z_d3d - w
      const a = planesFromD3d(d), b = frustumPlanes(gl);
      for (let k = 0; k < 6; k++) {
        checked++;
        const na = Math.hypot(a[k * 4], a[k * 4 + 1], a[k * 4 + 2]), nb = Math.hypot(b[k * 4], b[k * 4 + 1], b[k * 4 + 2]);
        for (let r = 0; r < 4; r++) if (Math.abs(a[k * 4 + r] / na - b[k * 4 + r] / nb) > 1e-5) failures.push(`GL planes ${t} plane ${k} component ${r}: ${a[k * 4 + r] / na} vs ${b[k * 4 + r] / nb}`);
      }
    }
    return { checked, failures, notes: ['Wine / native Windows table of IDirect3DDevice7::ComputeSphereVisibility (12 cases) + GL clip space equivalence'] };
  },
};
