// Game audio: sound effects (SoundClass semantics), speech, DirectMusic music, MIDI ambience. See docs/engine-api.md "Audio".
//   const ga = await GameAudio.create(audio.ctx, audio.master, files);   // files: GameFiles (needs `_data/sounds/**` and the EXE)
//   const slot = await ga.sfx.load2D('SND_MENU_SELECT'); ga.sfx.play2D(slot);
//   const m = await ga.music.load('menu'); ga.music.play(m); ga.music.setGroove(-2);
//   ga.speech.sayId('LECSPP02');
import { readAudioTables } from './tables.ts';
import type { AudioTables } from './tables.ts';
import type { AudioFiles } from './files.ts';
import { SoundEngine } from './sfx.ts';
import { SpeechEngine } from './speech.ts';
import { MusicEngine } from './music.ts';
import { AmbienceEngine } from './ambience.ts';

export * from './tables.ts';
export * from './files.ts';
export * from './sfx.ts';
export * from './speech.ts';
export * from './music.ts';
export * from './ambience.ts';
export * from './stream.ts';
export * from './midi.ts';
export * from './footsteps.ts';
export { MusicRenderer } from './dm/player.ts';
export { DmPerformance } from './dm/sequencer.ts';
export { DlsSynth } from './dm/synth.ts';
export { parseDls } from './dm/dls.ts';
export { parseSegment, parseStyle } from './dm/format.ts';
export { loadSegment } from './dm/assets.ts';

/** Option values of the original (0..100, default 80 each): music opt[0], sfx opt[1], speech opt[0x16]. */
export interface AudioOptions { music: number; sfx: number; speech: number }

export class GameAudio {
  readonly ctx: BaseAudioContext;
  readonly tables: AudioTables;
  readonly sfx: SoundEngine;
  readonly speech: SpeechEngine;
  readonly music: MusicEngine;
  readonly ambience: AmbienceEngine;
  readonly options: AudioOptions = { music: 80, sfx: 80, speech: 80 };

  private constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, tables: AudioTables) {
    this.ctx = ctx;
    this.tables = tables;
    this.sfx = new SoundEngine(ctx, dest, files, tables.sounds, tables.soundByName);
    this.speech = new SpeechEngine(ctx, dest, files, tables.speech);
    this.music = new MusicEngine(ctx, dest, files, tables.music);
    this.ambience = new AmbienceEngine(ctx, dest, files, tables.ambience);
  }

  /** `exeFileName` is the installed EXE ("LEGO eiland 2.exe"); the tables are read from it. */
  static async create(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, exeFileName = 'LEGO eiland 2.exe'): Promise<GameAudio> {
    const tables = readAudioTables(await files.read(exeFileName));
    return new GameAudio(ctx, dest, files, tables);
  }

  setMusicVolume(v: number) { this.options.music = v; this.music.setVolume(v); }
  /** The SFX slider also scales the MIDI ambience (as in the game). */
  setSfxVolume(v: number) { this.options.sfx = v; this.sfx.setSfxVolume(v); this.ambience.setSfxVolume(v); }
  setSpeechVolume(v: number) { this.options.speech = v; this.speech.setVolume(v); }

  /** Zone exit: stop and unload everything the zone loaded (FUN_004359d5 + music/ambience stop). */
  resetZone() { this.sfx.reset(); this.music.stopAll(); this.music.setFade(1); this.ambience.stop(); this.speech.stop(); }   // FUN_00873e26 also puts the music fade scale back to 1.0
}
