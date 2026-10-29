// The EXE's audio tables (sound ids, speech ids, music keys, MIDI ambience), read from the original EXE bytes.
import { restoreHooks } from '../restore/flag.ts';
import { readExeSoundTable, readExeSpeechTable, readExeMusicTable, readExeAmbienceTable } from '../formats/sound.ts';
import type { SoundTableEntry, MusicTableEntry, AmbienceTableEntry } from '../formats/sound.ts';

export type { SoundTableEntry, MusicTableEntry, AmbienceTableEntry };

export interface AudioTables {
  /** 902 records, index = sound id (SND_* 0..821, CSSND_* 822..901) */
  sounds: SoundTableEntry[];
  /** speech id strings, index = the number in the .str lines ("LECSIN01" ...) */
  speech: string[];
  music: MusicTableEntry[];
  ambience: AmbienceTableEntry[];
  /** lower-case SND_ / CSSND_ name -> id */
  soundByName: Map<string, number>;
  /** upper-case speech id -> first index */
  speechIndex: Map<string, number>;
}

export function readAudioTables(exe: Uint8Array): AudioTables {
  const sounds = readExeSoundTable(exe);
  const speech = readExeSpeechTable(exe);
  const soundByName = new Map<string, number>();
  for (const s of sounds) if (s.name) soundByName.set(s.name.toLowerCase(), s.id);
  restoreHooks.soundPatch?.(sounds);        // restored content (option off: unset)
  restoreHooks.extraSpeech?.(speech);
  const speechIndex = new Map<string, number>();
  speech.forEach((id, i) => { const k = id.toUpperCase(); if (!speechIndex.has(k)) speechIndex.set(k, i); });
  return { sounds, speech, music: readExeMusicTable(exe), ambience: readExeAmbienceTable(exe), soundByName, speechIndex };
}
