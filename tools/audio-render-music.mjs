#!/usr/bin/env node
// Offline render of the game's DirectMusic music to a WAV file (verification only, output goes to /tmp).
//   node tools/audio-render-music.mjs <music key | dir/segment.sgt> [--seconds 30] [--groove -2..0] [--seed 1] [--rate 44100] [--out /tmp/le2-music] [--game <Game dir>]
// Prints loudness statistics (peak, RMS, clipping, voice use) instead of letting anyone listen.
import fs from 'node:fs';
import path from 'node:path';
import { readExeMusicTable } from '../src/formats/sound.ts';
import { loadSegment } from '../src/audio/dm/assets.ts';
import { MusicRenderer } from '../src/audio/dm/player.ts';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const game = opt('--game', process.env.LE2_GAME || '/Users/sander/Documents/legoeiland2-extract/game/Game');
const seconds = +opt('--seconds', 30), seed = +opt('--seed', 1), rate = +opt('--rate', 44100);
const outDir = opt('--out', '/tmp/le2-music');
const groove = +opt('--groove', 0);
const dmRoot = path.join(game, '_data/sounds/DirectMusic');
const ci = (dir, name) => { const f = fs.readdirSync(dir).find((x) => x.toLowerCase() === name.toLowerCase()); return f ? path.join(dir, f) : null; };
const read = async (p) => {
  let cur = dmRoot;
  for (const part of p.split('/')) { const n = ci(cur, part); if (!n) throw new Error('missing ' + p); cur = n; }
  return new Uint8Array(fs.readFileSync(cur));
};
const exe = new Uint8Array(fs.readFileSync(path.join(game, 'LEGO eiland 2.exe')));
const table = readExeMusicTable(exe);
const keys = args.length ? args : table.map((m) => m.key);
fs.mkdirSync(outDir, { recursive: true });

function wav16(L, R, sr) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

for (const key of keys) {
  let dir, seg, dls, name = key;
  const m = table.find((t) => t.key.toLowerCase() === key.toLowerCase());
  if (m) { dir = m.dir.split('\\').pop(); seg = m.segment; dls = m.dls; }
  else { const parts = key.split('/'); dir = parts[0]; seg = parts[1]; dls = fs.readdirSync(path.join(dmRoot, ci(dmRoot, dir) ? path.basename(ci(dmRoot, dir)) : dir)).find((f) => f.toLowerCase().endsWith('.dls')); name = key.replace(/[\\/ ]/g, '_'); }
  let ls;
  const t0 = Date.now();
  try { ls = await loadSegment(read, dir, seg, dls); } catch (e) { console.log(key.padEnd(10), 'LOAD FAILED', e.message); continue; }
  const r = new MusicRenderer(rate, seed);
  const unres = new Set();
  r.onUnresolved = (p, patch) => unres.add(p + ':0x' + patch.toString(16));
  r.perf.grooveLevel = groove;
  r.play(ls);
  const total = Math.round(seconds * rate), L = new Float32Array(total), R = new Float32Array(total);
  const B = 2048, bl = new Float32Array(B), br = new Float32Array(B);
  for (let o = 0; o < total; o += B) { const n = Math.min(B, total - o); r.render(bl, br, n); L.set(bl.subarray(0, n), o); R.set(br.subarray(0, n), o); }
  let peak = 0, sum = 0, clip = 0;
  const secRms = [];
  for (let s = 0; s < Math.floor(seconds); s++) {
    let e = 0;
    for (let i = s * rate; i < (s + 1) * rate; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); peak = Math.max(peak, a, b); if (a > 1 || b > 1) clip++; e += L[i] * L[i] + R[i] * R[i]; }
    secRms.push(Math.sqrt(e / (2 * rate)));
    sum += e;
  }
  const rms = Math.sqrt(sum / (2 * rate * Math.floor(seconds)));
  const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  if (process.env.VERBOSE) console.log('   keys outside regions:', [...r.synth.stats.outOfRegion].sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x.join('x')).join(' '));
  const file = path.join(outDir, name + '.wav');
  fs.writeFileSync(file, wav16(L, R, rate));
  console.log(key.padEnd(10), `peak ${db(peak)} dBFS rms ${db(rms)} dBFS clip ${clip} voices(peak) ${r.synth.stats.peakVoices} stolen ${r.synth.stats.stolen} notes ${r.synth.stats.noteOns} noInstrument ${r.synth.stats.noInstrument} noRegion ${r.synth.stats.noRegion} of ${r.synth.stats.noteOns} unresolved [${[...unres]}] silentSeconds ${secRms.filter((x) => x < 1e-4).length}/${secRms.length} ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${file}`);
}
