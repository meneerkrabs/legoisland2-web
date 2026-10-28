#!/usr/bin/env node
// Structural check of the DirectMusic playback: runs the sequencer on every music-table entry (or the ones named) and prints
// note counts, key ranges, tempo and the PChannels whose band entry has no DLS (default GM set, not shipped).
//   node tools/audio-dm-stats.mjs [--game <Game dir>] [--seconds 60] [--seed 1] [key ...]
import fs from 'node:fs';
import path from 'node:path';
import { readExeMusicTable } from '../src/formats/sound.ts';
import { loadSegment } from '../src/audio/dm/assets.ts';
import { DmPerformance } from '../src/audio/dm/sequencer.ts';
import { resolveInstrument } from '../src/audio/dm/instruments.ts';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const game = opt('--game', process.env.LE2_GAME || '/Users/sander/Documents/legoeiland2-extract/game/Game');
const seconds = +opt('--seconds', 60), seed = +opt('--seed', 1);
const dmRoot = path.join(game, '_data/sounds/DirectMusic');
const ci = (dir, name) => { const f = fs.readdirSync(dir).find((x) => x.toLowerCase() === name.toLowerCase()); return f ? path.join(dir, f) : null; };
const read = async (p) => {
  let cur = dmRoot;
  for (const part of p.split('/')) { const n = ci(cur, part); if (!n) throw new Error('missing ' + p); cur = n; }
  return new Uint8Array(fs.readFileSync(cur));
};
const exe = new Uint8Array(fs.readFileSync(path.join(game, 'LEGO eiland 2.exe')));
const table = readExeMusicTable(exe);
const want = args.map((a) => a.toLowerCase());
for (const m of table) {
  if (want.length && !want.includes(m.key.toLowerCase())) continue;
  const dir = m.dir.split('\\').pop();
  let ls;
  try { ls = await loadSegment(read, dir, m.segment, m.dls); } catch (e) { console.log(m.key.padEnd(10), 'LOAD FAILED', e.message); continue; }
  const perf = new DmPerformance(seed);
  perf.play(ls);
  const ev = perf.run(seconds);
  const notes = ev.filter((e) => e.kind === 'note');
  const by = {};
  for (const n of notes) { const b = (by[n.pch] ||= { n: 0, lo: 999, hi: -1 }); b.n++; b.lo = Math.min(b.lo, n.key); b.hi = Math.max(b.hi, n.key); }
  // instruments that resolve to no DLS instrument (default GM set, not shipped) on channels that play notes
  const miss = new Map();
  const patches = new Map();
  for (const e of ev) if (e.kind === 'patch') { const r = resolveInstrument(e.inst, ls.dls); patches.set(e.pch, { inst: e.inst, r }); }
  for (const [c, { inst, r }] of patches) if (!r && by[c]) miss.set(c, '0x' + inst.patch.toString(16));
  const gmUsed = [...miss].map(([c, p]) => `${c}:${p}x${by[c].n}`);
  const bad = notes.filter((n) => n.key < 0 || n.key > 127).length;
  console.log(m.key.padEnd(10), `${ls.seg.name || m.segment}`.padEnd(24), `notes ${notes.length}`.padEnd(12), `bpm ${perf.bpm}`.padEnd(9), `windows ${perf.stats.windows}`.padEnd(13), `chans ${Object.keys(by).length}`.padEnd(9), `GMchans-with-notes [${gmUsed}]`, `outOfRange ${bad}`, `last ${ev.length ? ev[ev.length - 1].time.toFixed(1) : '-'}s`);
  if (want.length) for (const [c, b] of Object.entries(by)) console.log('   pch', c, b);
}
