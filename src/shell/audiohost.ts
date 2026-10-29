// Audio for the shell: one GameAudio for the whole session (src/audio), a `world.sfx` sink that loads sounds lazily (the first play of an id
// is dropped, later ones start the slot: docs/engine-api.md), the menu sounds (602..608: FUN_004b0240), the music / ambience keys of every zone
// (docs/re/audio.md 7.8) and the three volume options (Settings[0], [1], [0x16]). Every failure is swallowed: the game plays silently.
import { audio } from '../engine/audio.ts';
import type { GameAudio } from '../audio/index.ts';
import { SND_UI, walkSounds, landSound } from '../audio/footsteps.ts';
import type { SfxSink } from '../game/world.ts';

type Slot = Awaited<ReturnType<GameAudio['sfx']['load2D']>>;

/** music key (and ambience) a zone requests at its init (docs/re/audio.md 7.8); `groove` is the level - 3 the zone sets before playing */
export const ZONE_MUSIC: Record<string, { key?: string; ambience?: string; groove?: number }> = {
  z60FRE: { key: 'menu' }, z03PPH: { key: 'menu' }, z04IFC: { key: 'menu' },
  z01BPK: { key: 'Z01BPK' }, z02LGI: { key: 'Z02LGIM', ambience: 'LGIBirds' },
  z05WAB: { key: 'Z05WAB1' }, z07CSI: { key: 'Z07CSI', ambience: 'Castle', groove: -2 }, z08BKD: { key: 'Z08BKD1' },
  z10RGB: { key: 'z10rgb' }, z13CAI: { key: 'ad2', groove: 0 }, z14OSD: { key: 'ad1T' }, z16PYA: { key: 'ad1T' }, z15SSH: { key: 'z15ssh' },
  z17WAS: { key: 'z17was2' }, z18MMP: { key: 'Z18MMP' }, z20DSP: { key: 'z15ssh' }, z21FSH: { key: 'Z21FSH', ambience: 'Fishing' },
  z22BIP: { key: 'carn' }, z23DIP: { key: 'ad2', groove: -2 }, z27TRX: { key: 'Flying' }, z28HAT: { key: 'z28HAT' },
  z38PAR: { key: 'Z38PAR' }, z39ASB: { key: 'Z38PAR' }, z40aPO: { key: 'Z40APO' }, z40OGL: { key: 'ogel' }, z41MAP: { key: 'Z41MAP' }, z42BRP: { key: 'Z42BRP', groove: -1 },
};

/** sound ids the walk / jump / camera code plays (docs/engine-api.md Audio) */
export const PRELOAD_IDS = [302, 261, 301, 895, 296, 294, 295];

export class AudioHost implements SfxSink {
  ga: GameAudio | null = null;
  readonly mute: boolean;
  private slots = new Map<number, Slot | null | 'loading'>();
  private moveRr = 0;
  private musicKey = '';
  private wanted = { music: 80, sfx: 80, speech: 80 };

  constructor(mute: boolean) { this.mute = mute; }

  static async create(files: { read(path: string): Promise<Uint8Array> }, mute: boolean): Promise<AudioHost> {
    const h = new AudioHost(mute);
    if (mute) return h;
    try {
      const { GameAudio } = await import('../audio/index.ts');
      h.ga = await GameAudio.create(audio.ctx, audio.master, files as never);
      for (const id of [...SND_UI.MENU_MOVE, SND_UI.MENU_SELECT, SND_UI.MENU_BACK, SND_UI.MENU_ONOFF]) h.load(id);
      h.apply();
    } catch (e) { console.warn('audio disabled', e); h.ga = null; }
    return h;
  }

  private load(id: number) {
    if (!this.ga || this.slots.has(id)) return;
    this.slots.set(id, 'loading');
    this.ga.sfx.load2D(id).then((s) => this.slots.set(id, s)).catch(() => this.slots.set(id, null));
  }

  /** world.sfx: 2D one-shot by sound table id */
  play(id: number) {
    if (!this.ga) return;
    try {
      const s = this.slots.get(id);
      if (s === undefined) this.load(id);
      else if (s && s !== 'loading') this.ga.sfx.play2D(s);
    } catch { /* silent */ }
  }

  /** load 2D sounds ahead (a zone's sound set loaded at its start, e.g. z41MAP FUN_00813500): `play` only requests a sound that is not loaded yet and stays silent that time */
  preload(ids: Iterable<number>) { for (const id of ids) this.load(id); }

  /** FUN_004435b0: stop a (looping) sound by sound-table id; no-op while it is not loaded */
  stop(id: number) {
    if (!this.ga) return;
    try {
      const s = this.slots.get(id);
      if (s && s !== 'loading') this.ga.sfx.stop(s);
    } catch { /* silent */ }
  }

  /** FUN_00443600(handle, hz): the playback frequency of a loaded 2D sound (the island's engines); no-op while it is not loaded */
  rate(id: number, hz: number) {
    if (!this.ga) return;
    try {
      const s = this.slots.get(id);
      if (s && s !== 'loading') this.ga.sfx.setRate(s, hz);
    } catch { /* silent */ }
  }

  /** FUN_004435b0 + FUN_004435a0: stop the 2D sound and start it again (a sound that is not loaded yet is only requested) */
  restart(id: number) {
    if (!this.ga) return;
    try {
      const s = this.slots.get(id);
      if (s === undefined) this.load(id);
      else if (s && s !== 'loading') { this.ga.sfx.stop(s); this.ga.sfx.play2D(s); }
    } catch { /* silent */ }
  }

  /** the menu's sound effects (FUN_004b02d4: the four move sounds round-robin) */
  menu(kind: 'move' | 'select' | 'back' | 'onoff') {
    if (kind === 'move') { this.play(SND_UI.MENU_MOVE[this.moveRr]); this.moveRr = (this.moveRr + 1) % 4; }
    else this.play(kind === 'select' ? SND_UI.MENU_SELECT : kind === 'back' ? SND_UI.MENU_BACK : SND_UI.MENU_ONOFF);
  }

  /** the options' volumes (Settings[0] music, [1] sfx, [0x16] speech) */
  setVolumes(music: number, sfx: number, speech: number) {
    this.wanted = { music, sfx, speech };
    this.apply();
  }
  private apply() {
    const ga = this.ga;
    if (!ga) return;
    try { ga.setMusicVolume(this.wanted.music); ga.setSfxVolume(this.wanted.sfx); ga.setSpeechVolume(this.wanted.speech); } catch { /* silent */ }
  }

  /** zone entry: sounds the player code uses, then the zone's music (FUN_00443290 + FUN_004432c0) */
  enterZone(zone: string, opts: { walking?: boolean } = {}) {
    const ga = this.ga;
    if (!ga) return;
    if (opts.walking) {
      const ids = new Set<number>(PRELOAD_IDS);
      for (let surface = 0; surface <= 10; surface++) {
        for (const i of walkSounds(surface) ?? []) ids.add(i);
        const l = landSound(surface);
        if (l !== null) ids.add(l);
      }
      for (const id of ids) this.load(id);
    }
    const m = ZONE_MUSIC[zone];
    if (m?.key && m.key !== this.musicKey) {
      this.musicKey = m.key;
      ga.music.load(m.key).then((h) => { if (h && this.musicKey === m.key) { if (m.groove !== undefined) ga.music.setGroove(m.groove); ga.music.play(h); } }).catch(() => { /* silent */ });
    }
    if (m?.ambience) ga.ambience.start(m.ambience).catch(() => { /* silent */ });
  }

  /** zone exit (FUN_00873f74 / FUN_00874186): stop everything, forget loaded slots */
  leaveZone() {
    try { this.ga?.resetZone(); } catch { /* silent */ }
    this.slots.clear();
    this.musicKey = '';
    for (const id of [...SND_UI.MENU_MOVE, SND_UI.MENU_SELECT, SND_UI.MENU_BACK, SND_UI.MENU_ONOFF]) this.load(id);
  }
}
