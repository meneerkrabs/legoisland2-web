#!/usr/bin/env node
// Drives tools/steps/audio-moments.mjs over every zone (headless, muted, through the bot slots) and checks that the music of each zone is scheduled at the moment
// the decompile says (src/audio/zonemusic.ts), that the zone's sound list was loaded before the loop began and that nothing the generic sinks played was missing.
//   (npx vite --port 5611 --strictPort &)   node tools/audio-moments-all.mjs [zone,zone...] [--port 5611]
import { spawnSync } from 'node:child_process';
import { ZONE_MUSIC } from '../src/audio/zonemusic.ts';
import { ZONE_SOUND_SETUP } from '../src/audio/zonesounds.ts';

const args = process.argv.slice(2);
const pi = args.indexOf('--port'); const port = pi >= 0 ? args.splice(pi, 2)[1] : '5611';
const zones = args.length ? args[0].split(',') : Object.keys({ ...ZONE_SOUND_SETUP }).filter((z) => z !== 'z60FRE');
let bad = 0;
for (const z of zones) {
  const r = spawnSync('sh', ['tools/m5-botslot.sh', 'node', 'tools/browse.mjs', `http://localhost:${port}/?zone=${z}`, 'tools/steps/audio-moments.mjs', '--size', '800x600'], { encoding: 'utf8', timeout: 240000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('AUDIO '));
  if (!line) { console.log(`${z}: NO RESULT ${(r.stdout || '').split('\n').filter((l) => /steps error/.test(l)).join(' ')} ${(r.stderr || '').slice(0, 200)}`); bad++; continue; }
  const a = JSON.parse(line.slice(6));
  const spec = ZONE_MUSIC[z] ?? {};
  const problems = [];
  const plays = a.hostLog.filter((l) => / music /.test(l));
  const want = (spec.plays ?? []).length;
  if (spec.key && plays.length !== want) problems.push(`music plays ${plays.length}, want ${want}: ${plays.join(' | ')}`);
  if (!spec.key && plays.length) problems.push(`unexpected generic music: ${plays.join(' | ')}`);
  for (const p of spec.plays ?? []) {
    const hit = plays.find((l) => new RegExp(` ${p.at}\\b`).test(l));
    if (!hit) { problems.push(`moment ${p.at} missing`); continue; }
    const mode = Number(/loop mode (\d+)/.exec(hit)?.[1]);
    if (p.at === 'init' && ![7, 0].includes(mode)) problems.push(`init play in loop mode ${mode}`);
    if (p.at === 'leaveHelp' && mode !== 2) problems.push(`leaveHelp play in loop mode ${mode}`);
    if (p.at === 'leaveIntro' && ![9, 2].includes(mode)) problems.push(`leaveIntro play in loop mode ${mode}`);
  }
  if (a.missed.length) problems.push(`sounds missing from the zone list: ${a.missed.join(',')}`);
  if (a.stats.dropped) problems.push(`dropped ${a.stats.dropped}`);
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${z.padEnd(7)} key ${String(spec.key ?? '-').padEnd(8)} ${plays.map((l) => l.replace(/^[\d.]+ music /, '')).join(' | ')}  slots ${a.slots.d2}/${a.slots.d3}  ${a.hostLog.find((l) => / zone /.test(l))?.replace(/^[\d.]+ zone /, '') ?? ''}`);
  for (const p of problems) console.log(`       ! ${p}`);
  if (problems.length) bad++;
}
console.log(bad ? `${bad} zones with problems` : 'all zones start their music at the original moment');
process.exit(bad ? 1 : 0);
