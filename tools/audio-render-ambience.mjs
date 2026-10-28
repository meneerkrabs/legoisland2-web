#!/usr/bin/env node
// Offline render of the MIDI ambience beds (Miles XMIDI in the game) through the DLS synth; stats only, WAV under /tmp.
//   node tools/audio-render-ambience.mjs [--seconds 30] [--out /tmp/le2-music] [--game <Game dir>] [key ...]
import fs from 'node:fs';
import path from 'node:path';
import { readExeAmbienceTable } from '../src/formats/sound.ts';
import { parseSmf, MidiRenderer } from '../src/audio/midi.ts';
import { parseDls } from '../src/audio/dm/dls.ts';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const game = opt('--game', process.env.LE2_GAME || '/Users/sander/Documents/legoeiland2-extract/game/Game');
const seconds = +opt('--seconds', 30), outDir = opt('--out', '/tmp/le2-music'), rate = 44100;
fs.mkdirSync(outDir, { recursive: true });
const ci = (p) => { // case-insensitive path, '\' or '/', "Ambience MIDI" may be "Ambience_MIDI" on disk
  let cur = game;
  for (const part of p.split(/[\\/]+/).filter(Boolean)) {
    const f = fs.readdirSync(cur).find((x) => x.toLowerCase() === part.toLowerCase() || x.toLowerCase() === part.toLowerCase().replace(/ /g, '_'));
    if (!f) throw new Error('missing ' + p);
    cur = path.join(cur, f);
  }
  return cur;
};
const exe = new Uint8Array(fs.readFileSync(path.join(game, 'LEGO eiland 2.exe')));
for (const a of readExeAmbienceTable(exe)) {
  if (args.length && !args.map((x) => x.toLowerCase()).includes(a.key.toLowerCase())) continue;
  const smf = parseSmf(new Uint8Array(fs.readFileSync(ci(a.midi))));
  const dls = parseDls(new Uint8Array(fs.readFileSync(ci(a.dls))));
  const r = new MidiRenderer(rate);
  r.gain = (a.volume * 80 / 100) / 127; // tableVol * opt[1](80) / 100 on the 0..127 scale
  r.start(smf, dls);
  const total = seconds * rate, L = new Float32Array(total), R = new Float32Array(total), B = 4096;
  const bl = new Float32Array(B), br = new Float32Array(B);
  for (let o = 0; o < total; o += B) { const n = Math.min(B, total - o); bl.fill(0); br.fill(0); r.render(bl, br, n); L.set(bl.subarray(0, n), o); R.set(br.subarray(0, n), o); }
  let peak = 0, e = 0;
  for (let i = 0; i < total; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); e += L[i] * L[i] + R[i] * R[i]; }
  const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  const noteOns = smf.events.filter((x) => x.kind === 'on').length;
  console.log(a.key.padEnd(10), `division ${smf.division} events ${smf.events.length} noteOns ${noteOns} length ${r.length.toFixed(1)}s passes ${r.passes} peak ${db(peak)} rms ${db(Math.sqrt(e / (2 * total)))} dBFS noInstrument ${r.synth.stats.noInstrument} noRegion ${r.synth.stats.noRegion} of ${r.synth.stats.noteOns}`);
}
