// Ontwikkelaarshoek, section 8: everything the lists need, computed from the running shell's files and EXE (audio-data.ts does the work, this only gathers the inputs).
import type { Shell } from '../shell/shell.ts';
import { readExeMusicTable, readExeSoundTable, readExeSpeechTable } from '../formats/sound.ts';
import type { MusicTableEntry } from '../formats/sound.ts';
import { exeNames, exeStrings, looseSounds, musicFiles, soundFiles, soundTableRows, speechRows } from './audio-data.ts';
import type { LooseSound, MusicFile, SoundFile, SoundTableRow, SpeechRow } from './audio-data.ts';

export interface AudioData {
  files: SoundFile[];
  loose: LooseSound[];
  sgt: MusicFile[];
  sty: MusicFile[];
  unusedSgt: number;
  unusedSty: number;
  musicTable: MusicTableEntry[];
  speech: { rows: SpeechRow[]; missing: string[]; orphans: string[] };
  table: SoundTableRow[];
  /** paths relative to `_data/sounds` of every file */
  allRel: string[];
  /** the .dls files of each DirectMusic folder (lower-case folder -> file names) */
  dlsByDir: Map<string, string[]>;
  exeStrings: number;
}

export async function loadAudioData(sh: Shell): Promise<AudioData> {
  const exe = sh.pe.data;
  const strings = exeStrings(exe);
  const n = exeNames(strings);
  const files = soundFiles(sh.files.list(), (p) => sh.files.size(p));
  const table = readExeSoundTable(exe);
  const loose = looseSounds(files, n, table);
  const m = await musicFiles(files, n, (p) => sh.files.read(p));
  const mp3 = files.filter((f) => f.group === 'speech' && f.ext === 'mp3').map((f) => f.name);
  const speech = speechRows(readExeSpeechTable(exe), mp3);
  const dlsByDir = new Map<string, string[]>();
  for (const f of files) if (f.group === 'DirectMusic' && f.ext === 'dls') { const k = f.sub.toLowerCase(); const l = dlsByDir.get(k); if (l) l.push(f.name); else dlsByDir.set(k, [f.name]); }
  const have = new Set(sh.files.list().map((p) => p.toLowerCase()));
  return {
    files, loose, sgt: m.sgt, sty: m.sty, unusedSgt: m.unusedSgt, unusedSty: m.unusedSty, musicTable: readExeMusicTable(exe), speech,
    table: soundTableRows(table, (p) => have.has(p)), allRel: files.map((f) => f.rel), dlsByDir, exeStrings: strings.length,
  };
}
