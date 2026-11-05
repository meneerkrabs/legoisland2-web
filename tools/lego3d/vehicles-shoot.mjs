#!/usr/bin/env node
// Vehicle QA shots (docs/re/lego3d.md section 17): every vehicle-like record of the zones (table VEH) through the developer corner's "Camera op dit object" (tools/steps/devcorner-objcam.mjs), LEGO 3D off and on,
// front / three-quarter / side / rear / from above, at a distance that follows the vehicle's size. Headless and muted, through the bot slot, against a snapshot server (sh tools/m4-snapshot-server.sh PORT).
//   node tools/lego3d/vehicles-shoot.mjs --base http://localhost:5931/ --out DIR [--zones z02LGI,z07CSI] [--only JSKI,AMBU] [--views f,q,s,r,t] [--l3d 0,1] [--par "&x=y"]
// Pictures: DIR/oc-<zone>-<REC>[#n]-az<az>-d<dist>-l<0|1>.png (the objcam naming); `sheet` of each vehicle: tools/lego3d/vehicles-sheet.mjs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '../..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const base = opt('--base', 'http://localhost:5931/'), out = opt('--out', '/tmp/vq/shots');
const zonesOnly = opt('--zones', '')?.split(',').filter(Boolean), only = opt('--only', '')?.split(',').filter(Boolean);
const views = opt('--views', 'f,q,s,r,t').split(','), l3ds = opt('--l3d', '0,1').split(','), par = opt('--par', '');
// zone -> [record (#n = nth match of the filter), length, height, options]; length = the longer horizontal extent, height of the LOD 0 mesh (tools/lego3d/vehicles-inventory.mjs)
export const VEH = {
  z02LGI: [['JSKI', 7.1, 3.0], ['AMBU', 10.7, 6.9], ['SPD0', 11.2, 3.7], ['SPBT', 18.3, 5.0], ['DNGY', 9.3, 4.0], ['RHEL', 14.6, 7.6], ['PHEL', 13.5, 6.7], ['BHEL', 13.5, 6.7], ['TRNL', 22.0, 9.9], ['TRNT', 12.3, 6.3], ['TRNC', 14.2, 3.9],
    ['PCAR', 8.3, 6.4], ['GLDR', 12.8, 6.4], ['PTER', 9.8, 4.1], ['SHTL', 28.2, 28.2], ['SBRD', 3.4, 1.0], ['LOON', 18.0, 17.8], ['RIPB', 20.9, 0.5, 'qt'], ['RIPD', 14.1, 0.5, 'qt'], ['RIPJ', 14.8, 0.5, 'qt'], ['WAKP', 2.0, 0.5, 'qt'], ['WAKR', 5.8, 0.5, 'qt'], ['WAKS', 2.9, 0.5, 'qt']],
  z07CSI: [['JSKI', 7.1, 3.0], ['SPBT', 18.7, 5.0], ['DNGY', 9.3, 4.3], ['SKBD', 3.4, 1.0]],
  z13CAI: [['G010', 9.6, 3.7], ['G011', 15.3, 7.8], ['RHEL', 14.7, 7.6], ['PHEL', 13.5, 6.7], ['PTER', 9.8, 4.1]],
  z14OSD: [['G000', 14.4, 7.7], ['G001', 23.8, 12.0], ['RHEL', 14.7, 7.6], ['PHEL', 13.5, 6.7], ['SKBD', 3.8, 1.5], ['RIPP', 19.1, 0.5, 'qt'], ['PTER', 9.8, 4.1]],
  z16PYA: [['SPED', 11.2, 3.7], ['SKBD', 3.8, 1.5]],
  z22BIP: [['SEPL', 42.7, 11.1], ['PROP', 8.4, 7.2], ['PROP#1', 5.9, 5.1]],
  z23DIP: [['SEPL', 23.8, 12.0], ['BIPL', 14.4, 7.7], ['LOON', 18.0, 17.8], ['SKBD', 3.4, 1.0]],
  z38PAR: [['PLNE', 31.9, 23.8], ['BOAT', 18.7, 5.0], ['PARA', 15.0, 12.4], ['BALL', 25.6, 25.6]],
  z40aPO: [['SHTL', 28.2, 28.2], ['G001', 41.0, 41.0], ['PARA', 13.4, 4.0]],
  z40OGL: [['SKBD', 4.6, 2.5], ['G001', 41.0, 41.0], ['G242', 28.2, 28.2]],
  z28HAT: [['HOTB', 18.0, 17.8]],
  z10RGB: [['CC00', 6.1, 5.1]],
  z08BKD: [['DLPH', 3.8, 3.0], ['CBOT', 21.0, 5.7]],
};
const spec = ([rec, L, H], v) => {
  const d = +(1.1 * L + 2).toFixed(1), h = +(0.35 * L + 0.3 * H).toFixed(1), aim = +(H * 0.4).toFixed(1);
  const az = { f: 0, q: 45, s: 90, r: 180, t: 0 }[v];
  return v === 't' ? `${rec}:0:0.3:${+(1.9 * Math.max(L, H) + 1).toFixed(1)}:0` : `${rec}:${az}:${d}:${h}:${aim}`;
};
const run = (zone, l3d, shots) => new Promise((res) => {
  const env = { ...process.env, ZONE: zone, VIS: '1', L3D: l3d, PREFIX: 'oc', SHOTS: shots.join(';'), PARAMS: par, SETTLE: '1200' };
  const p = spawn('sh', ['tools/m5-botslot.sh', 'node', 'tools/browse.mjs', base, 'tools/steps/devcorner-objcam.mjs', '--profile', `/tmp/vq/prof-${zone}-${l3d}`, '--size', '800x600', '--out', out], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  p.on('close', (c) => { console.log(`${zone} l${l3d}: exit ${c}, ${shots.length} shots`); console.log(log.split('\n').filter((l) => /no such record|screenshot:|error|Error/.test(l) && !/GL Driver/.test(l)).map((l) => '  ' + l.replace(out + '/', '')).join('\n')); res(c); });
});
const jobs = [];
for (const [zone, list] of Object.entries(VEH)) {
  if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
  const shots = list.filter(([r]) => !only.length || only.includes(r.split('#')[0])).flatMap((v) => views.filter((x) => !v[3] || v[3].includes(x)).map((x) => spec(v, x)));
  if (shots.length) for (const l of l3ds) jobs.push([zone, l, shots]);
}
// two bot slots: run the jobs two at a time
const q = [...jobs]; await Promise.all([0, 1].map(async () => { while (q.length) { const j = q.shift(); await run(...j); } }));
