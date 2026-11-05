#!/usr/bin/env node
// Building QA shots (docs/re/lego3d.md section 18): the structures of the table BLD (buildings-table.mjs) through the developer corner's "Camera op dit object" (tools/steps/devcorner-objcam.mjs, record picked by its list
// index with "@n"), LEGO 3D off and on, front / three-quarter / side / rear / other side / from above at a distance that follows the size. Headless and muted, through the bot slot, against a snapshot server (sh tools/m4-snapshot-server.sh PORT).
//   node tools/lego3d/buildings-shoot.mjs --base http://localhost:5931/ --out DIR [--zones z02LGI,z07CSI] [--only 116,121] [--views f,q,s,r,l,t] [--l3d 0,1] [--par "&x=y"] [--dscale 0.6]
// Pictures: DIR/oc-<zone>-r<index>-az<az>-d<dist>-l<0|1>.png
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLD } from './buildings-table.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '../..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const base = opt('--base', 'http://localhost:5931/'), out = opt('--out', '/tmp/bq/shots');
const zonesOnly = opt('--zones', '')?.split(',').filter(Boolean), only = opt('--only', '')?.split(',').filter(Boolean);
const views = opt('--views', 'f,q,s,r,l,t').split(','), l3ds = opt('--l3d', '0,1').split(','), par = opt('--par', '');
const DS = +opt('--dscale', '1');   // distance factor: 0.6 = close-ups of the replaced buildings (the name of the picture carries the distance)
export const spec = ([idx, L, H], v) => {
  const d = +(DS * (1.25 * L + 6)).toFixed(1), h = +(DS * (0.45 * H + 2)).toFixed(1), aim = +(H * 0.4).toFixed(1);
  const az = { f: 0, q: 45, s: 90, r: 180, l: 270, t: 0 }[v];
  return v === 't' ? `@${idx}:0:0.3:${+(1.9 * Math.max(L, H) + 1).toFixed(1)}:0` : `@${idx}:${az}:${d}:${h}:${aim}`;
};
const run = (zone, l3d, shots) => new Promise((res) => {
  const env = { ...process.env, ZONE: zone, VIS: '1', L3D: l3d, PREFIX: 'oc', SHOTS: shots.join(';'), PARAMS: par, SETTLE: '1200' };
  const p = spawn('sh', ['tools/m5-botslot.sh', 'node', 'tools/browse.mjs', base, 'tools/steps/devcorner-objcam.mjs', '--profile', `/tmp/bq/prof-${zone}-${l3d}`, '--size', '800x600', '--out', out], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', (c) => { console.log(`${zone} l${l3d}: exit ${c}, ${shots.length} shots`); console.log(log.split('\n').filter((l) => /no such record|screenshot:|error|Error/.test(l) && !/GL Driver/.test(l)).map((l) => '  ' + l.replace(out + '/', '')).join('\n')); res(c); });
});
if (import.meta.url === `file://${process.argv[1]}`) {
  const jobs = [];
  for (const [zone, list] of Object.entries(BLD)) {
    if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
    const shots = list.filter(([i]) => !only.length || only.includes(String(i))).flatMap((v) => views.filter((x) => !v[4] || v[4].includes(x)).map((x) => spec(v, x)));
    if (shots.length) for (const l of l3ds) jobs.push([zone, l, shots]);
  }
  const q = [...jobs]; await Promise.all([0, 1].map(async () => { while (q.length) { const j = q.shift(); await run(...j); } }));
}
