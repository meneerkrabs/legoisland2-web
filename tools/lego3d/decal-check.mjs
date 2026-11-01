#!/usr/bin/env node
// Decal visibility of the LEGO 3D bodies over many poses: the decal groups (prints, knee pads, socks ...) are draped on the rebuilt surface at bind pose; when the bones move, a solid surface may
// slide in front of a decal. For every body of every layout and LOD (original next to mod): sample points on the decal triangles, cast a ray from 0.4 in front of the decal along -normal and count the
// samples (area weighted) that hit a SOLID group triangle earlier than the decal itself by more than 0.004 = hidden. Reported as median / p90 / max over the poses.
//   node tools/lego3d/decal-check.mjs [--stride 10] [--layout pepp,mfg,bb,space] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions } from '../../src/formats/anim.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { poses as samplePoses } from './pack/chars-pose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const only = (opt('--layout', '') || '').split(',').filter(Boolean);
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const tables = await pack.json('chars/tables.json');
const P = samplePoses(+opt('--stride', 10), 2);

/** { occluded fraction per pose } for a skinned mesh: roles[g] === 'D' marks decal groups */
export function decalHidden(bytes, roles, poseList) {
  const m = parseMsh(bytes), sv = parseSvwl(m.svwl, m.vertexCount);
  const solid = [], decal = [];
  m.groups.forEach((g, gi) => { if (roles[gi] === 'x') return; for (let t = 0; t < g.indexCount; t += 3) (roles[gi] === 'D' ? decal : solid).push([0, 1, 2].map((k) => m.indices[g.firstIndex + t + k] + g.firstVertex)); });
  if (!decal.length) return null;
  const X = new Float32Array(m.vertexCount * 3), out = [];
  const bary = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
  for (const bones of poseList) {
    skinPositions(m.positions, sv, bones, X);
    const S = solid.map((t) => t.map((i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]));
    let hidden = 0, total = 0;
    for (const t of decal) {
      const [a, b, c] = t.map((i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(...n) / 2; if (area < 1e-9) continue;
      n = n.map((x) => x / (2 * area));
      for (const [u, v, w] of bary) {
        const p = [a[0] * u + b[0] * v + c[0] * w, a[1] * u + b[1] * v + c[1] * w, a[2] * u + b[2] * v + c[2] * w];
        const o = [p[0] + n[0] * 0.4, p[1] + n[1] * 0.4, p[2] + n[2] * 0.4], d = [-n[0], -n[1], -n[2]];
        let best = Infinity;
        for (const [A, B, C] of S) {   // Moeller-Trumbore, front hits only matter (any side: a solid in front is hit first either way)
          const q1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], q2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
          const pv = [d[1] * q2[2] - d[2] * q2[1], d[2] * q2[0] - d[0] * q2[2], d[0] * q2[1] - d[1] * q2[0]], det = q1[0] * pv[0] + q1[1] * pv[1] + q1[2] * pv[2];
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, s = [o[0] - A[0], o[1] - A[1], o[2] - A[2]], uu = (s[0] * pv[0] + s[1] * pv[1] + s[2] * pv[2]) * inv;
          if (uu < 0 || uu > 1) continue;
          const qv = [s[1] * q1[2] - s[2] * q1[1], s[2] * q1[0] - s[0] * q1[2], s[0] * q1[1] - s[1] * q1[0]], vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
          if (vv < 0 || uu + vv > 1) continue;
          const tt = (q2[0] * qv[0] + q2[1] * qv[1] + q2[2] * qv[2]) * inv;
          if (tt > 0 && tt < best) best = tt;
        }
        total += area; if (best < 0.4 - 0.004) hidden += area;
      }
    }
    out.push(total ? hidden / total : 0);
  }
  return out;
}
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = archive('z02LGI');
  const gen = await generateArchive(pack, 'z02LGI', rep, async (n) => archive(n), ['characters']);
  const REPS = { pepp: ['z02LGI', ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR']], mfg: ['z02LGI', ['MFG_HR']], bb: ['z02LGI', ['BB_HR']], space: ['z40OGL', ['Space_pep_white']] };
  const ROLES = { pepp: ['SSDDDDDDD', 'SSDDDDDD', 'SSDDDDDD', 'SSDDDDDD'], mfg: ['SSSSSS'], bb: ['SSSS'], space: ['SDS'] };
  const res = {};
  for (const [layout, [zone, names]] of Object.entries(REPS)) {
    if (only.length && !only.includes(layout)) continue;
    for (const [li, nm] of names.entries()) {
      const a = archive(zone), e = a.find(`Meshes/${nm}.msh`);
      let modBytes = zone === 'z02LGI' ? gen.files.get(e.path) : null;
      if (!modBytes) { const g2 = await generateArchive(pack, zone, a, async (n) => archive(n), ['characters']); modBytes = g2.files.get(e.path); }
      const roles = tables.bodies[`${layout}-${li}`]?.roles ?? ROLES[layout][li];   // the pack's roles: painted decal groups are 'S' (they are part of the surface), only overlays are 'D'
      const o = decalHidden(a.read(e), roles, P), n = modBytes ? decalHidden(modBytes, roles, P) : null;
      if (!o) { console.log(`${layout} ${nm}: no decal groups`); continue; }
      res[`${layout}-${li}`] = { orig: [pct(o, 0.5), pct(o, 0.9), pct(o, 1)], mod: n && [pct(n, 0.5), pct(n, 0.9), pct(n, 1)] };
      const f = (x) => (x * 100).toFixed(1) + '%';
      console.log(`${layout.padEnd(6)} ${nm.padEnd(16)} hidden decal area median/p90/max  original ${res[`${layout}-${li}`].orig.map(f).join(' / ')}  mod ${n ? res[`${layout}-${li}`].mod.map(f).join(' / ') : 'not replaced'}`);
    }
  }
  const jf = opt('--json', ''); if (jf) fs.writeFileSync(jf, JSON.stringify(res, null, 1));
}
