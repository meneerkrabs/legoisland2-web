#!/usr/bin/env node
// Runs the zones' existing browser bots (tools/steps/m*-*.mjs) with the audio recorder of tools/steps/qa-audio-wrap.mjs around them (headless, muted by the browser flag, audio engine ON: the bots'
// own URLs carry mute=1, which is removed here) and prints one summary line per bot: the sounds the zone played (distinct ids / calls), sounds the zone asked for that its list did not hold
// (`missed`), lazy loads, plays dropped because the 16-voice pool was full, files that were missing or undecodable, speech lines / late reads / held ticks, the music that was scheduled, and the bot's own
// FAIL lines. Full JSON of every run: <out>/<name>.json.
//   (sh tools/m4-snapshot-server.sh 5822)   node tools/qa-audio-bots.mjs [--port 5822] [--out /tmp/qa-audio] [--slice A|B] [name,name...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args.splice(i, 2)[1]; };
const port = opt('--port', '5822'), out = opt('--out', '/tmp/qa-audio'), slice = opt('--slice', '');
fs.mkdirSync(out, { recursive: true });
const sel = args.length ? args[0].split(',') : null;

/** [bot file, URL query (no mute=1)] : the invocation in each bot's header, ports replaced */
const BOTS = [
  ['m6-z01BPK', 'zone=z01BPK'], ['m6-z08BKD', 'zone=z08BKD'], ['m6-z09JST', 'zone=z09JST'], ['m6-z10RGB', 'zone=z10RGB'], ['m6-z15SSH', 'zone=z15SSH'], ['m6-z18MMP', 'zone=z18MMP'],
  ['m6-z20DSP', 'zone=z20DSP'], ['m6-z21FSH', 'zone=z21FSH'], ['m6-z22BIP', 'zone=z22BIP'], ['m6-z27TRX', 'zone=z27TRX'], ['m6-z28HAT', 'zone=z28HAT'], ['m6-z42BRP', 'zone=z42BRP'],
  ['m5-z04IFC', 'zone=z04IFC'], ['m5-z05WAB', 'zone=z05WAB'], ['m5-z39ASB', 'zone=z39ASB&debug=1'], ['m5-z41MAP', 'zone=z41MAP'], ['m3-z17WAS', 'zone=z17WAS'], ['m3-z38PAR', 'zone=z38PAR'],
  ['m3-z40aPO', 'zone=z40aPO'], ['m3-z36cnt', 'zone=z36CNT'], ['m3-z50LTC', 'zone=z50LTC'], ['m5-z16PYA', 'zone=z16PYA&node=36&hold=1&debug=1'], ['m5-z40OGL', 'zone=z40OGL&node=64&hold=1&debug=1'],
  ['m5-z13CAI-node33', 'zone=z13CAI&node=33&hold=1&debug=1'], ['m5-z03PPH', 'zone=z02LGI&node=5'],
];
const mine = BOTS.filter(([n], i) => (!sel || sel.includes(n)) && (!slice || (slice === 'A') === (i % 2 === 0)));
for (const [name, q] of mine) {
  const t0 = Date.now();
  const r = spawnSync('sh', ['tools/m5-botslot.sh', 'node', 'tools/browse.mjs', `http://localhost:${port}/?${q}`, 'tools/steps/qa-audio-wrap.mjs', '--size', '800x600', '--out', path.join(out, name)], {
    encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28, env: { ...process.env, INNER: `tools/steps/${name}.mjs` },
  });
  const o = (r.stdout || '') + (r.stderr || '');
  const line = o.split('\n').find((l) => l.startsWith('AUDIOQA '));
  const fails = o.split('\n').filter((l) => /^FAIL|\[inner error\]|\[steps error\]|\[pageerror\]/.test(l)).slice(0, 4).map((l) => l.slice(0, 160));
  if (!line) { console.log(`${name}: NO RESULT (${((Date.now() - t0) / 1000).toFixed(0)} s) ${fails.join(' | ')} ${(o.split('\n').slice(-3).join(' ')).slice(0, 300)}`); continue; }
  const a = JSON.parse(line.slice(8));
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(a, null, 1));
  const calls = a.played.reduce((s, x) => s + Number((/ x(\d+)/.exec(x) || [])[1] || 0), 0);
  const nobuf = a.played.filter((x) => x.includes('NOBUF')).map((x) => x.split(' ')[0]);
  console.log(`${name.padEnd(18)} ${a.firstZone ?? ''}>${a.zone}${a.docs > 1 ? ` (${a.docs} docs)` : ''} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  sounds ${a.played.length}/${calls}  missed [${a.missed}] lazy ${a.host.lazyLoads} pend ${a.host.pendingPlays}  sfx dropped ${a.sfx.dropped} culled ${a.sfx.culled} missingfiles ${a.sfx.missing}${(a.nobuf ?? []).length ? ` silent[${a.nobuf}]` : ''}${nobuf.length ? ` NOBUF[${nobuf}]` : ''}  speech ${a.speech.lines} lines, missing ${a.speech.missing}, late ${a.speech.late}, held ${a.speech.heldTicks}  amb [${(a.amb ?? []).join('; ')}] music ${a.music.length}${a.music[0] ? ` first "${a.music[0]}"` : ''}${fails.length ? `  BOT: ${fails.join(' | ')}` : ''}`);
}
