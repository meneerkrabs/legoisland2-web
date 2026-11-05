#!/usr/bin/env node
// Environment QA shots (docs/re/lego3d.md section 19): the vegetation / rock records of the zones (table ENV, record = "@list index" of the developer corner) through "Camera op dit object"
// (tools/steps/devcorner-objcam.mjs), LEGO 3D off and on, from the four sides and from above, at a distance that follows the size. Headless and muted through the bot slot against a snapshot server.
//   node tools/lego3d/env-shoot.mjs --base http://localhost:5940/ --out DIR [--zones z02LGI] [--only pine,oak] [--views f,e,r,w,t] [--l3d 0,1] [--par "&x=y"] [--list]
// Pictures: DIR/oc-<zone>-r<idx>-az<az>-d<dist>-l<0|1>.png (the objcam naming).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '../..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const base = opt('--base', 'http://localhost:5940/'), out = opt('--out', '/tmp/vq/env');
const zonesOnly = opt('--zones', '')?.split(',').filter(Boolean), only = opt('--only', '')?.split(',').filter(Boolean);
const views = opt('--views', 'f,e,r,w,t').split(','), l3ds = opt('--l3d', '0,1').split(','), par = opt('--par', '');
// zone -> [name, record list index, length, height, flags]; length = the longer horizontal extent, height of the LOD 0 mesh (tools/lego3d/env-inventory.mjs); 5th entry = the views to take instead of --views ('qt' = 3/4 and top)
import { ENV } from './env-table.mjs';
const spec = ([nm, idx, L, H], v) => {
  const M = Math.max(L, H), d = +(1.4 * M + 2).toFixed(1), h = +Math.max(0.35 * L + 0.3 * H, 0.35 * H).toFixed(1), aim = +(H * 0.4).toFixed(1);
  const az = { f: 0, q: 45, e: 90, r: 180, w: 270, t: 0 }[v];
  return v === 't' ? `@${idx}:0:0.3:${+(2.2 * M + 1).toFixed(1)}:0` : `@${idx}:${az}:${d}:${h}:${aim}`;
};
if (a.includes('--list')) { for (const [z, l] of Object.entries(ENV)) console.log(z, l.map((x) => x[0]).join(' ')); process.exit(0); }
const run = (zone, l3d, shots) => new Promise((res) => {
  const env = { ...process.env, ZONE: zone, VIS: '1', L3D: l3d, PREFIX: 'oc', SHOTS: shots.join(';'), PARAMS: par, SETTLE: '1200' };
  const p = spawn('sh', ['tools/m5-botslot.sh', 'node', 'tools/browse.mjs', base, 'tools/steps/devcorner-objcam.mjs', '--profile', `/tmp/vq/prof-env-${zone}-${l3d}`, '--size', '800x600', '--out', out], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', (c) => { console.log(`${zone} l${l3d}: exit ${c}, ${shots.length} shots`); console.log(log.split('\n').filter((l) => /no such record|screenshot:|error|Error/.test(l) && !/GL Driver/.test(l)).map((l) => '  ' + l.replace(out + '/', '')).join('\n')); res(c); });
});
const jobs = [];
for (const [zone, list] of Object.entries(ENV)) {
  if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
  const shots = list.filter(([n]) => !only.length || only.includes(n)).flatMap((v) => (v[4] ? v[4].split('') : views).map((x) => spec(v, x)));
  if (shots.length) for (const l of l3ds) jobs.push([zone, l, shots]);
}
const q = [...jobs]; await Promise.all([0, 1].map(async () => { while (q.length) { const j = q.shift(); await run(...j); } }));
