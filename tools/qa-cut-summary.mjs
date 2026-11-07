#!/usr/bin/env node
// Condenses the `QA {...}` lines of tools/steps/qa-cutscenes.mjs into a table: node tools/qa-cut-summary.mjs <log> [...]
// columns: script, game seconds, SAYTEXT lines in the script / said / audio started / subtitles shown, max request->audio lag (ms), held ticks, late reads, missed sounds, sub-before-audio (ticks, max), letterbox, notes (runner log lines other than start/end)
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  console.log(`== ${f}`);
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('QA ')) continue;
    const q = JSON.parse(line.slice(3));
    const subT = new Map(), startT = new Map(), sayT = new Map();
    for (const e of q.ev) { if (e.e === 'sub' && e.id && !subT.has(e.id)) subT.set(e.id, e.tk); if (e.e === 'start' && !startT.has(e.id)) startT.set(e.id, e.tk); if (e.e === 'say' && !sayT.has(e.id)) sayT.set(e.id, e.tk); }
    let maxDiff = 0, mismatch = [];
    for (const [id, tk] of subT) { const s = startT.get(id); if (s === undefined) mismatch.push(`${id}:noaudio`); else maxDiff = Math.max(maxDiff, Math.abs(s - tk)); }
    const wanted = new Set(q.wanted);
    const noVoice = q.wanted.filter((id) => !startT.has(id));
    const notes = q.logNew.filter((l) => !/^(start|end) /.test(l));
    const cs = (q.sfx ?? []).filter((x) => /:CS/i.test(x)).map((x) => x.replace(/^(2d|3d):\d+:/, '').replace(/^CS_?SND_/i, ''));
    const nsfx = (q.sfx ?? []).length;
    // skip presses (SKIPLINE): per press the line, ticks until the speech machine is idle again, until the subtitle changes, until the next line's audio starts
    const skips = (q.skipLog ?? []).map((k) => {
      const after = (f) => { const e = q.ev.find((x) => x.tk > k.tk && f(x)); return e ? e.tk - k.tk : null; };
      return `${k.id}: idle +${after((x) => x.e === 'state' && x.v === 0)} sub +${after((x) => x.e === 'sub' && x.id !== k.id)} next +${after((x) => x.e === 'start')}`;
    });
    const lag = Math.max(0, ...q.lags.map((l) => l.lag));
    if (noVoice.length && q.diag) console.log('   diag ' + q.name + ': ' + q.diag.slice(0, 700));
    console.log([q.name.padEnd(10), (q.ticks / 30).toFixed(1).padStart(6) + 's', `say ${q.wanted.length}/${q.nSay}/${q.starts.length}/${q.subs.length}`, `lag ${lag}`, `held ${q.stats.heldTicks}`, `late ${q.stats.late}`, `miss ${q.stats.missing}/${q.missed.length}`, `subdt ${maxDiff}`, `lb ${q.lb}`, `fov ${q.fov}`, q.natural ? 'NAT' : '', q.skipped ? 'SKIP' : '', noVoice.length ? `novoice[${noVoice}]` : '', mismatch.length ? `MISMATCH[${mismatch}]` : '', q.listener ? `lis ${q.listener.bad}/${q.listener.n}` : '', skips.length ? `skip[${skips.join('; ')}]` : '', nsfx ? `sfx${nsfx}` : '', cs.length ? `cs[${cs.join(' ')}]` : '', notes.length ? `LOG[${notes.join(' | ')}]` : ''].filter((x) => x !== '').join('  '));
  }
}
