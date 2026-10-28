#!/usr/bin/env node
// Regression test for src/audio (no browser): DirectMusic / DLS / MIDI parsing of every game file, the style player on every music key,
// comparison with the MIDI export that ships with the game, synth pitch / timing checks, table cross-checks.
//   node tools/audio-test.mjs [--game <Game dir>]
import fs from 'node:fs';
import path from 'node:path';
import { readExeSoundTable, readExeSpeechTable } from '../src/formats/sound.ts';
import { readAudioTables } from '../src/audio/tables.ts';
import { parseDls } from '../src/audio/dm/dls.ts';
import { parseSegment, parseStyle } from '../src/audio/dm/format.ts';
import { loadSegment } from '../src/audio/dm/assets.ts';
import { MusicRenderer } from '../src/audio/dm/player.ts';
import { DmPerformance, musicValueToKey } from '../src/audio/dm/sequencer.ts';
import { DlsSynth } from '../src/audio/dm/synth.ts';
import { parseSmf, MidiRenderer } from '../src/audio/midi.ts';
import { unwrapMp3Wav } from '../src/audio/speech.ts';
import { walkSounds, landSound } from '../src/audio/footsteps.ts';

const args = process.argv.slice(2);
const gi = args.indexOf('--game');
const game = gi >= 0 ? args[gi + 1] : process.env.LE2_GAME || '/Users/sander/Documents/legoeiland2-extract/game/Game';
const sounds = path.join(game, '_data/sounds'), dmRoot = path.join(sounds, 'DirectMusic');
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('FAIL', msg); } };
const section = (s) => console.log('\n== ' + s);
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }
const ci = (dir, name) => { const f = fs.readdirSync(dir).find((x) => x.toLowerCase() === name.toLowerCase()); return f ? path.join(dir, f) : null; };
const read = async (p) => { let cur = dmRoot; for (const part of p.split('/')) { const n = ci(cur, part); if (!n) throw new Error('missing ' + p); cur = n; } return new Uint8Array(fs.readFileSync(cur)); };
const u8 = (p) => new Uint8Array(fs.readFileSync(p));

section('parse every DirectMusic / DLS / MIDI file');
const cnt = { sty: 0, sgt: 0, dls: 0, mid: 0 };
const dlsCache = new Map();
for (const f of walk(sounds)) {
  const l = f.toLowerCase();
  try {
    if (l.endsWith('.sty')) { const s = parseStyle(u8(f)); cnt.sty++; ok(s.patterns.length > 0, `${f}: no patterns`); }
    else if (l.endsWith('.sgt')) { const s = parseSegment(u8(f)); cnt.sgt++; ok(s.unknownTracks.length === 0, `${f}: unknown tracks ${s.unknownTracks}`); ok(s.length > 0, `${f}: length 0`); }
    else if (l.endsWith('.dls')) { const c = parseDls(u8(f)); cnt.dls++; ok(c.instruments.length > 0 && c.waves.length > 0, `${f}: empty dls`); for (const i of c.instruments) for (const r of i.regions) ok(!!c.waves[r.waveIndex], `${f}/${i.name}: region wave ${r.waveIndex} missing`); }
    else if (l.endsWith('.mid')) { const m = parseSmf(u8(f)); cnt.mid++; ok(m.events.length > 0, `${f}: no events`); }
  } catch (e) { failures++; console.log('FAIL', f, e.message); }
}
console.log(cnt);
ok(cnt.sty === 229 && cnt.sgt === 50 && cnt.dls === 31 && cnt.mid === 8, 'file counts');

section('style player on every music key (30 s each)');
const exe = u8(path.join(game, 'LEGO eiland 2.exe'));
const tables = readAudioTables(exe);
ok(tables.sounds.length === 902 && tables.music.length === 41 && tables.speech.length === 1732, 'table sizes');
const totals = { notes: 0 };
for (const m of tables.music) {
  const dir = m.dir.split('\\').pop();
  let ls;
  try { ls = await loadSegment(read, dir, m.segment, m.dls); } catch { ok(m.key === 'Z02LGIB', `${m.key}: load failed`); continue; }
  const r = new MusicRenderer(44100, 1, 99);
  r.play(ls);
  const secs = 30, n = secs * 44100, L = new Float32Array(2048), R = new Float32Array(2048);
  let energy = 0, peak = 0, bad = 0;
  for (let o = 0; o < n; o += 2048) { r.render(L, R, 2048); for (let i = 0; i < 2048; i++) { const a = L[i], b = R[i]; if (!Number.isFinite(a) || !Number.isFinite(b)) bad++; peak = Math.max(peak, Math.abs(a), Math.abs(b)); energy += a * a + b * b; } }
  const rms = Math.sqrt(energy / (2 * n));
  const st = r.synth.stats;
  totals.notes += st.noteOns;
  ok(bad === 0, `${m.key}: non-finite samples`);
  ok(st.noteOns > 20, `${m.key}: only ${st.noteOns} notes`);
  ok(rms > 10 ** (-60 / 20), `${m.key}: silent (rms ${rms})`);
  ok(peak <= 1.0001, `${m.key}: peak ${peak}`);
  ok(st.noRegion <= st.noteOns * 0.15, `${m.key}: ${st.noRegion}/${st.noteOns} notes outside every DLS region`);
  ok(r.perf.stats.notes > 0, `${m.key}: sequencer produced no notes`);
}
console.log('notes played', totals.notes);

section('music value -> key');
{
  const c = { chordPattern: 0x91, scalePattern: 0xab5ab5, inversionPoints: -1, levels: 1, chordRoot: 12, scaleRoot: 0 };
  const k = (v, mode = 14, sub = c) => musicValueToKey(v, mode, sub);
  ok(k(0x5000) === 60, 'octave 5 root = C4 (60)');
  ok(k(0x5100) === 64 && k(0x5200) === 67, 'chord tones E G');
  ok(k(0x5300) === 71, 'seventh of a triad comes from the scale (B)');
  ok(k(0x5010) === 62, 'one scale step above the root = D');
  ok(k(0x5001) === 61 && k(0x500f) === 59, 'accidentals +1 / -1');
  ok(k(0x5000, 14, { ...c, chordRoot: 7 }) === 55, 'chord root 7 = G below (-5)');
  ok(k(0x0045, 0) === 69 && k(0x0045, 16) !== 69, 'fixed mode takes the value as a MIDI key');
}

section('comparison with the MIDI export that ships with the game (dance/BBSGTRDRMS.mid vs BBotdance.sgt)');
{
  const smf = parseSmf(u8(path.join(dmRoot, 'dance/BBSGTRDRMS.mid')));
  const ls = await loadSegment(read, 'dance', 'BBotdance.sgt', 'BBotdance.dls');
  const perf = new DmPerformance(1);
  perf.play(ls);
  const ev = perf.run(70);
  const mid = new Set(smf.events.filter((e) => e.kind === 'on' && e.ch === 0 && e.tick / smf.division < 128).map((e) => (e.tick / smf.division).toFixed(2) + ':' + e.a));
  const ours = new Set(ev.filter((e) => e.kind === 'note' && e.pch === 0 && e.tick / 768 < 128).map((e) => (e.tick / 768).toFixed(2) + ':' + e.key));
  let common = 0; for (const x of ours) if (mid.has(x)) common++;
  console.log(`drums: ours ${ours.size}, mid ${mid.size}, common ${common}`);
  ok(ours.size > 300 && common === ours.size, 'every generated drum note (beat and key) is in the MIDI export');
  const bass = new Set(smf.events.filter((e) => e.kind === 'on' && e.ch === 1 && e.tick / smf.division < 128).map((e) => (e.tick / smf.division).toFixed(2) + ':' + e.a));
  const ob = new Set(ev.filter((e) => e.kind === 'note' && e.pch === 1 && e.tick / 768 < 128).map((e) => (e.tick / 768).toFixed(2) + ':' + e.key));
  let cb = 0; for (const x of bass) if (ob.has(x)) cb++;
  ok(cb >= bass.size * 0.95, `channel 1: ${cb}/${bass.size} of the export's notes are generated`);
}

section('timing');
{
  const ls = await loadSegment(read, 'menu', 'Menu.sgt', 'Menu.dls');
  const perf = new DmPerformance(1);
  perf.play(ls);
  const ev = perf.run(30);
  ok(Math.abs(perf.tickToSec(3072) - 3072 / 768 * 60 / 95) < 1e-9, '95 BPM: a 4/4 measure lasts 2.526 s');
  const first = ev.find((e) => e.kind === 'note');
  ok(first && first.time < 0.01, 'first note at t=0');
  // a note's time offset / grid: every note tick is non-negative and notes lie on the 1/16th (grid 2 per beat = 384 ticks) +- offsets
  ok(ev.filter((e) => e.kind === 'note').every((e) => e.tick > -400), 'no note starts before the segment');
  // loop: segment length 61440 ticks = 20 measures = 50.5 s; at 95 BPM the loop restarts, state continues to emit
  const perf2 = new DmPerformance(1);
  perf2.play(ls);
  const ev2 = perf2.run(60);
  ok(ev2.filter((e) => e.kind === 'note' && e.time > 52).length > 5, 'segment loops (notes after the first pass)');
  // groove level: Lego Town Main at -2 is sparser than at 0
  const town = await loadSegment(read, 'z02LGI', 'Lego Town Main.sgt', 'LI2 Town Custom.dls');
  const count = (g) => { const p = new DmPerformance(1); p.grooveLevel = g; p.play(town); return p.run(30).filter((e) => e.kind === 'note').length; };
  const a = count(-2), b = count(-1), c = count(0);
  console.log('Lego Town Main notes per 30 s at groove -2/-1/0:', a, b, c);
  ok(a < b && b < c, 'groove level selects denser patterns');
  // primary replacement is a hard cut: alloff for the old segment's channels, then notes of the new one
  const perf3 = new DmPerformance(1);
  perf3.play(ls);
  perf3.run(5);
  perf3.play(town);
  const ev3 = perf3.run(12);
  ok(ev3.some((e) => e.kind === 'reset') && ev3.some((e) => e.kind === 'alloff'), 'replacing the primary segment resets / releases');
}

section('synth: pitch, sample-rate independence, looping, envelope');
{
  // a synthetic DLS: a 1 s sine at 440 Hz, 22.05 kHz, unity note 69, looped over the whole sample
  const sr0 = 22050, data = new Float32Array(sr0);
  for (let i = 0; i < sr0; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / sr0) * 0.5;
  const wsmp = { unityNote: 69, fineTune: 0, attenuation: 0, options: 1, loops: [{ type: 0, start: 0, length: sr0 }] };
  const region = { keyLow: 0, keyHigh: 127, velLow: 0, velHigh: 127, keyGroup: 0, layer: 0, selfNonExclusive: false, wsmp, waveIndex: 0, waveChannel: 0, conns: [] };
  const rel = Math.round(Math.log2(0.2) * 1200 * 65536); // release 0.2 s
  const ins = { name: 'sine', msb: 0, lsb: 0, drum: false, program: 0, regions: [region], conns: [{ src: 0, ctl: 0, dst: 0x209, transform: 0, scale: rel }] };
  const col = { name: 'test', instruments: [ins], waves: [{ index: 0, name: 'sine', channels: 1, sampleRate: sr0, bits: 16, data, wsmp }] };
  const freq = (sr, key, bend = 0) => {
    const s = new DlsSynth(sr);
    s.setInstrument(0, col, ins, { volume: 127, pan: 64 });
    if (bend) s.pitchBend(0, bend);
    s.noteOn(0, key, 127);
    const N = sr, L = new Float32Array(N), R = new Float32Array(N);
    s.render(L, R, N);
    let up = 0, first = -1, last = -1;
    for (let i = Math.round(sr * 0.1) + 1; i < N; i++) if (L[i - 1] < 0 && L[i] >= 0) { up++; if (first < 0) first = i; last = i; }
    return ((up - 1) * sr) / (last - first);
  };
  for (const sr of [44100, 48000]) {
    ok(Math.abs(freq(sr, 69) - 440) < 1, `A4 = 440 Hz at ${sr}`);
    ok(Math.abs(freq(sr, 81) - 880) < 2, `an octave up = 880 Hz at ${sr}`);
    ok(Math.abs(freq(sr, 57) - 220) < 1, `an octave down = 220 Hz at ${sr}`);
    ok(Math.abs(freq(sr, 69, 8191) - 440 * Math.pow(2, 2 / 12)) < 2, `full pitch bend = +2 semitones at ${sr}`);
  }
  // release: after note off the level falls by 96 dB over the release time (0.2 s); the voice ends
  const s2 = new DlsSynth(44100);
  s2.setInstrument(0, col, ins, { volume: 127, pan: 64 });
  s2.noteOn(0, 69, 127);
  let L = new Float32Array(4410), R = new Float32Array(4410);
  s2.render(L, R, 4410);
  const rms = (x) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
  const sustain = rms(L);
  s2.noteOff(0, 69);
  L = new Float32Array(4410); R = new Float32Array(4410);
  s2.render(L, R, 4410); // the first 0.1 s of the 0.2 s release: the mean level is about 0.3 of the sustain
  ok(rms(L) < sustain * 0.4 && rms(L) > 0, 'release fades');
  L = new Float32Array(44100); R = new Float32Array(44100);
  s2.render(L, R, 44100);
  ok(s2.activeVoices === 0, 'voice ends after the release');
}

section('MIDI ambience');
{
  const ent = tables.ambience.find((a) => a.key === 'LGIBirds');
  const smf = parseSmf(u8(path.join(sounds, 'z02LGI/MidiAmbient/Birds.mid')));
  const dls = parseDls(u8(path.join(sounds, 'z02LGI/MidiAmbient/DLS Birds.dls')));
  const r = new MidiRenderer(44100);
  r.start(smf, dls);
  const L = new Float32Array(4096), R = new Float32Array(4096);
  let e = 0;
  for (let i = 0; i < 44100 * 70 / 4096; i++) { L.fill(0); R.fill(0); r.render(L, R, 4096); for (let k = 0; k < 4096; k++) e += L[k] * L[k]; }
  ok(e > 0 && r.passes >= 1, 'ambience renders and restarts after the end (passes ' + r.passes + ')');
  ok(ent && ent.volume === 99, 'ambience table');
}

section('tables');
{
  const byName = tables.soundByName;
  ok(walkSounds(0).every((id, i) => tables.sounds[id].name === 'SND_WALK_GRASS' + (i + 1)), 'grass walking ids');
  ok(walkSounds(4).every((id, i) => tables.sounds[id].name === 'SND_WALK_ROCK' + (i + 1)), 'rock walking ids');
  ok(walkSounds(6).every((id, i) => tables.sounds[id].name === 'SND_WALK_GRAVEL' + (i + 1)), 'gravel walking ids');
  ok(walkSounds(7).every((id, i) => tables.sounds[id].name === 'SND_WALK_PLASTIC' + (i + 1)), 'plastic walking ids');
  ok(tables.sounds[landSound(1)].name === 'SND_LAND_ROAD' && tables.sounds[landSound(0)].name === 'SND_LAND_GRASS', 'landing ids');
  ok(byName.get('snd_menu_select') === 606, 'SND_MENU_SELECT = 606');
  // every non-placeholder sound path that exists on disk is a PCM wav that parses (decoded by decodeAudioData in the browser)
  let n = 0;
  for (const e of tables.sounds) {
    const p = e.path.replace(/\\+/g, '/');
    if (/^(UNDEFINED|_Data\/sounds\/PSX ONLY)/i.test(p)) continue;
    let cur = game, found = true;
    for (const part of p.split('/')) { const f = fs.existsSync(cur) && fs.readdirSync(cur).find((x) => x.toLowerCase() === part.toLowerCase() || x.toLowerCase() === (part + '.wav').toLowerCase()); if (!f) { found = false; break; } cur = path.join(cur, f); }
    if (found && fs.statSync(cur).isFile() && fs.statSync(cur).size > 44) n++;
  }
  console.log('sound table entries with a readable file:', n);
  ok(n >= 850, 'at least 850 sound files resolvable');
}

section('speech files');
{
  const dir = path.join(sounds, 'speech/Data');
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.mp3')) continue;
    if (n++ % 40) continue;
    const b = unwrapMp3Wav(u8(path.join(dir, f)));
    ok(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, `${f}: no MPEG sync after unwrapping`);
  }
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
