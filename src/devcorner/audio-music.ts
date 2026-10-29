// Ontwikkelaarshoek, section 8: the music side that needs no browser (node-testable): which DLS bank a segment / style / MIDI file gets, a playable "segment" for a lone style
// (port extension), and an offline probe that renders a few seconds through the port's own DirectMusic engine (src/audio/dm) to tell whether a file can be played at all.
//  - the original only ever plays the 41 keys of its music table (FUN_00443290 -> segment + DLS of the table row). A segment that is not in the table has no DLS row: the bank
//    is chosen here: the table row of a segment of the same folder, else the folder's only .dls, else the .dls whose name looks like the segment's. NOT original, "bij benadering".
//  - a `.sty` is never played alone by the game (always through a segment's style track). The synthetic segment built here (`styleAssets`) is a port extension: one style
//    reference, the style's first band, the style's tempo, the default chord (C major, like a segment without a chord track) and a command track that steps the groove level
//    through the levels the style's patterns ask for (each level for as many measures as the longest pattern), so every pattern is heard once.
import { loadDlsFile, loadStyleFile } from '../audio/dm/assets.ts';
import type { DmLoadedSegment, DmReadFile } from '../audio/dm/assets.ts';
import { MusicRenderer } from '../audio/dm/player.ts';
import { measureTicks } from '../audio/dm/sequencer.ts';
import type { DmSegment, DmStyle } from '../audio/dm/format.ts';
import type { DlsCollection } from '../audio/dm/dls.ts';
import { MidiRenderer, parseSmf } from '../audio/midi.ts';
import { parseDls } from '../audio/dm/dls.ts';
import type { MusicTableEntry } from '../audio/tables.ts';

const lastSeg = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * the DLS bank for a segment: `dir` = music folder (`z02LGI`), `seg` = segment file, `dlsInDir` = the .dls files of that folder, `table` = the music table.
 * Returns the DLS file name (inside `dir`) and how it was chosen, or null (no bank found).
 */
export function pickDls(dir: string, seg: string, dlsInDir: readonly string[], table: readonly MusicTableEntry[]): { dls: string; how: 'tabel' | 'map' | 'enige' | 'naam' | 'eerste' } | null {
  const d = dir.toLowerCase();
  const rows = table.filter((t) => lastSeg(t.dir).toLowerCase() === d);
  const same = rows.find((t) => t.segment.toLowerCase() === seg.toLowerCase());
  if (same) return { dls: same.dls, how: 'tabel' };
  if (rows[0]) return { dls: rows[0].dls, how: 'map' };
  if (dlsInDir.length === 1) return { dls: dlsInDir[0], how: 'enige' };
  if (dlsInDir.length > 1) {
    const stem = seg.replace(/\.sgt$/i, '').toLowerCase();
    const hit = dlsInDir.find((x) => { const s = x.replace(/\.dls$/i, '').toLowerCase(); return stem.includes(s) || s.includes(stem); });
    return hit ? { dls: hit, how: 'naam' } : { dls: dlsInDir[0], how: 'eerste' };
  }
  return null;
}

/** the DLS bank of a MIDI file: a .dls next to it, else the one of the DirectMusic folder of the same name (`dance/BBSGTRDRMS.mid` -> `DirectMusic/dance/*.dls`); paths relative to `_data/sounds` */
export function pickMidiDls(midiRel: string, allRel: readonly string[]): string | null {
  const dir = midiRel.split('/').slice(0, -1).join('/').toLowerCase();
  const dls = allRel.filter((r) => /\.dls$/i.test(r));
  const next = dls.filter((r) => r.split('/').slice(0, -1).join('/').toLowerCase() === dir);
  if (next.length) return next[0];
  const dmDir = `directmusic/${dir.split('/').pop()}`;
  const dm = dls.filter((r) => r.split('/').slice(0, -1).join('/').toLowerCase() === dmDir);
  return dm[0] ?? null;
}

/** the DLS collections a style's bands name besides the primary one (stale authoring names fall back to the primary), like `loadSegment` */
async function dlsMap(read: DmReadFile, dir: string, dlsFile: string, styles: DmStyle[]): Promise<Map<string, DlsCollection>> {
  const dls = new Map<string, DlsCollection>();
  const primary = await loadDlsFile(read, `${dir}/${dlsFile}`);
  dls.set('', primary);
  dls.set(dlsFile.toLowerCase(), primary);
  const others = new Set<string>();
  for (const st of styles) for (const b of st.bands) for (const i of b.instruments) if (i.ref && i.ref.file && !dls.has(i.ref.file.toLowerCase())) others.add(i.ref.file);
  await Promise.all([...others].map(async (n) => { try { dls.set(n.toLowerCase(), await loadDlsFile(read, `${dir}/${n}`)); } catch { dls.set(n.toLowerCase(), primary); } }));
  return dls;
}

/** a playable segment around one style (port extension, see the header) */
export function styleSegment(style: DmStyle, styFile: string): DmSegment {
  const mt = measureTicks(style.timeSig);
  const levels = [...new Set(style.patterns.map((p) => p.grooveBottom))].sort((a, b) => a - b).slice(0, 24);
  if (levels.length === 0) levels.push(1);
  const step = Math.min(8, Math.max(1, ...style.patterns.map((p) => p.measures)));   // measures per level: the longest pattern (at most 8)
  const commands = levels.map((lv, i) => ({ time: i * step * mt, measure: i * step, beat: 0, command: 0, grooveLevel: lv, grooveRange: 0, repeatMode: 0 }));
  return {
    name: style.name || styFile, guid: '', repeats: 0, length: levels.length * step * mt, playStart: 0, loopStart: 0, loopEnd: 0, resolution: 0,
    tempos: [{ time: 0, tempo: style.tempo > 0 ? style.tempo : 120 }], chordScale: 0, chords: [], commands, sequence: [], curves: [],
    styles: [{ time: 0, ref: { guid: style.guid, name: style.name, file: styFile, validData: 0 } }],
    bands: style.bands.length ? [{ time: 0, band: style.bands[0] }] : [], mutes: [], timeSigs: [], unknownTracks: [],
  };
}

/** load a style with its DLS bank as a playable segment (port extension) */
export async function loadStyleAssets(read: DmReadFile, dir: string, styFile: string, dlsFile: string): Promise<DmLoadedSegment & { style: DmStyle }> {
  const style = await loadStyleFile(read, `${dir}/${styFile}`);
  const dls = await dlsMap(read, dir, dlsFile, [style]);
  const styles = new Map<string, DmStyle>([[styFile.toLowerCase(), style]]);
  return { seg: styleSegment(style, styFile), styles, dls, dir, style };
}

export interface Probe {
  /** audio rendered (seconds) */
  seconds: number;
  peak: number;
  rms: number;
  /** events the sequencer produced / instruments it could not find in the DLS */
  events: number;
  unresolved: number;
  /** the segment ended inside the probe */
  ended: boolean;
}

/** render `seconds` of a segment offline (22.05 kHz) through the DirectMusic engine: peak / rms of the output, events produced */
export function probeSegment(assets: DmLoadedSegment, seconds = 4, sampleRate = 22050): Probe {
  const r = new MusicRenderer(sampleRate, 1, 64);
  r.play(assets);
  const n = 1024, L = new Float32Array(n), R = new Float32Array(n);
  let peak = 0, sum = 0, count = 0, ended = false;
  const blocks = Math.ceil((seconds * sampleRate) / n);
  for (let b = 0; b < blocks; b++) {
    r.render(L, R, n);
    for (let i = 0; i < n; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; sum += L[i] * L[i] + R[i] * R[i]; count += 2; }
    if (!r.playing && b > 4) { ended = true; break; }
  }
  return { seconds: ((ended ? blocks : blocks) * n) / sampleRate, peak, rms: Math.sqrt(sum / Math.max(1, count)), events: r.stats.events, unresolved: r.stats.unresolvedPatches, ended };
}

/** render `seconds` of a MIDI file through a DLS bank offline */
export function probeMidi(mid: Uint8Array, dls: Uint8Array, seconds = 4, sampleRate = 22050): Probe {
  const r = new MidiRenderer(sampleRate, 32);
  r.loop = false;
  r.start(parseSmf(mid), parseDls(dls), 0);
  const n = 1024, L = new Float32Array(n), R = new Float32Array(n);
  let peak = 0, sum = 0, count = 0, ended = false;
  const blocks = Math.ceil((seconds * sampleRate) / n);
  for (let b = 0; b < blocks; b++) {
    L.fill(0); R.fill(0);
    r.render(L, R, n);
    for (let i = 0; i < n; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; sum += L[i] * L[i] + R[i] * R[i]; count += 2; }
    if (!r.playing) { ended = true; break; }
  }
  return { seconds: blocks * n / sampleRate, peak, rms: Math.sqrt(sum / Math.max(1, count)), events: 0, unresolved: 0, ended };
}
