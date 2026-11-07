#!/usr/bin/env node
// Totals over the `QA {...}` logs of tools/steps/qa-cutscenes.mjs: node tools/qa-cut-totals.mjs <log> [...]
// per log: scripts played, SayText lines in the scripts / said / audio started / subtitles shown, lines whose audio was not in hand at the request ("late"), ticks held for the audio, worst request -> audio lag (ms)
import fs from 'node:fs';
const T = { scripts: 0, wanted: 0, said: 0, started: 0, subs: 0, late: 0, held: 0, lag: 0, missingFiles: 0, missedSounds: 0, lisBad: 0, lisTicks: 0 };
for (const f of process.argv.slice(2)) {
  const t = { scripts: 0, wanted: 0, said: 0, started: 0, subs: 0, late: 0, held: 0, lag: 0 };
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('QA ')) continue;
    const q = JSON.parse(l.slice(3));
    t.scripts++; t.wanted += q.wanted.length; t.said += q.nSay; t.started += q.starts.length; t.subs += q.subs.length; t.late += q.stats.late; t.held += q.stats.heldTicks;
    t.lag = Math.max(t.lag, ...q.lags.map((x) => x.lag), 0);
    T.missingFiles += q.stats.missing; T.missedSounds += q.missed.length;
    if (q.listener) { T.lisBad += q.listener.bad; T.lisTicks += q.listener.n; }
  }
  console.log(f.split('/').pop().padEnd(22), JSON.stringify(t));
  for (const k of Object.keys(t)) { if (k === 'lag') T.lag = Math.max(T.lag, t.lag); else T[k] += t[k]; }
}
console.log('TOTAL'.padEnd(22), JSON.stringify(T));
