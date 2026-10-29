// Audio for the shell: one GameAudio for the whole session (src/audio), the SoundClass caches of the current zone (the sounds the original loads when a zone
// starts: src/audio/zonesounds.ts, docs/re/audio.md section 11), a `world.sfx` sink on top of them (2D by sound id), the menu sounds (602..608: FUN_004b0240),
// the music / ambience keys of every zone with the moment the original starts them (docs/re/audio.md 7.8, 11.2) and the three volume options (Settings[0], [1], [0x16]).
// Every failure is swallowed: the game plays silently.
//
// Zone start (`enterZone`, awaited by the zone runner before the loop begins): reset (done by `leaveZone`), load the zone's sound list (+ the sets of the constructor
// classes the zone registers), load the music key(s) and start the ones the original starts at init. Play start: the runner reports every loop mode change
// (`modeChange`); the key whose moment is "leaving the intro / the controls help" starts then.
import { audio } from '../engine/audio.ts';
import type { GameAudio } from '../audio/index.ts';
import type { SoundSlot, Vec3 } from '../audio/sfx.ts';
import type { MusicHandle } from '../audio/music.ts';
import { SND_UI } from '../audio/footsteps.ts';
import { ZONE_SOUND_SETUP, SOUND_SETS, ZONE_CLASS_SETS } from '../audio/zonesounds.ts';
import type { SoundLoad } from '../audio/zonesounds.ts';
import { ZONE_MUSIC } from '../audio/zonemusic.ts';
import { LISTENER_AT_TARGET, LISTENER_NOT_SET } from '../audio/listener.ts';
import type { MusicMoment } from '../audio/zonemusic.ts';
import type { SfxSink } from '../game/world.ts';
import { MODE } from './loopmachine.ts';

export { ZONE_MUSIC } from '../audio/zonemusic.ts';
export type { MusicMoment, MusicPlay, ZoneMusicSpec } from '../audio/zonemusic.ts';

type Slot = SoundSlot;
type Kind = '2d' | '3d';
type Bank = Map<number, Slot[]>;

export interface AudioHostLogEntry { t: number; what: string; detail?: string }

export class AudioHost implements SfxSink {
  ga: GameAudio | null = null;
  readonly mute: boolean;
  /** the SoundClass 2D / 3D caches of the current zone: every slot a load call made, by sound id, in load order (a sound loaded n times has n slots) */
  private bank2: Bank = new Map();
  private bank3: Bank = new Map();
  /** sounds a zone asked for that its list did not hold: loaded on demand (the original would have had them in its list; the first play waits for the load instead of being dropped) */
  private lazy = new Map<string, Promise<void>>();
  /** plays waiting for a lazy load: key `2d:id` / `3d:id` -> position (3D) */
  private wanted = new Map<string, Vec3 | null>();
  private moveRr = 0;
  private wantedVol = { music: 80, sfx: 80, speech: 80 };
  private volumesSet = false;
  private lastFrameMs = 0;
  /** the fallback speech tick (kept for the session) */
  speechTimer: ReturnType<typeof setInterval> | null = null;
  private zone = '';
  private zoneToken = 0;
  private zoneReady: Promise<void> = Promise.resolve();
  private mode: number = MODE.FADE_IN;
  private firedMoments = new Set<MusicMoment>();
  private handles = new Map<string, Promise<MusicHandle | null>>();
  private menuLoaded = false;
  readonly log: AudioHostLogEntry[] = [];
  /** ids played / requested that the zone's list did not hold (verification: should stay empty in zones that use the generic sinks) */
  readonly missed = new Set<string>();
  /** the sink's sounds that found no loaded slot while the zone was still loading, or at all */
  stats = { dropped: 0, pendingPlays: 0, lazyLoads: 0 };

  constructor(mute: boolean) {
    this.mute = mute;
    (globalThis as unknown as { __audioHost?: AudioHost }).__audioHost = this;
  }

  static async create(files: { read(path: string): Promise<Uint8Array> }, mute: boolean): Promise<AudioHost> {
    const h = new AudioHost(mute);
    if (mute) return h;
    try {
      const { GameAudio } = await import('../audio/index.ts');
      h.ga = await GameAudio.create(audio.ctx, audio.master, files as never);
      h.apply();
      void h.loadMenu();
      // loops that do not call `frame` (the front end's menu) still need FUN_00435a5e's tick for the options' speech preview: a 30 Hz timer fills in while no loop ticks
      h.speechTimer = setInterval(() => { if (performance.now() - h.lastFrameMs > 150) { try { h.ga?.speech.tick(1); } catch { /* silent */ } } }, 1000 / 30);
    } catch (e) { console.warn('audio disabled', e); h.ga = null; }
    return h;
  }

  private note(what: string, detail?: string) {
    this.log.push({ t: this.ga?.ctx.currentTime ?? 0, what, detail });
    if (this.log.length > 600) this.log.shift();
  }

  // ------------------------------------------------------------------------------------------------ the sound caches

  private bankOf(kind: Kind): Bank { return kind === '2d' ? this.bank2 : this.bank3; }

  /** FUN_00443580 / FUN_004433b0 for a list of loads: one slot per entry, kept in list order; resolves when all are decoded (a missing file leaves a silent slot, like the original's empty buffer) */
  async loadSounds(loads: readonly SoundLoad[]): Promise<void> {
    const ga = this.ga;
    if (!ga) return;
    const token = this.zoneToken;
    const slots = await Promise.all(loads.map(([kind, id]) => (kind === '2d' ? ga.sfx.load2D(id) : ga.sfx.load3D(id)).catch(() => null)));
    if (token !== this.zoneToken) return;     // the zone was left while loading: the engine reset dropped these slots
    loads.forEach(([kind, id], i) => {
      const s = slots[i];
      if (!s) return;
      const bank = this.bankOf(kind);
      const l = bank.get(id);
      if (l) l.push(s); else bank.set(id, [s]);
    });
  }

  /** the menu clicks (FUN_004b0240: loaded by every zone loop through FUN_0041b40e, and by the front end) */
  private loadMenu(): Promise<void> {
    if (this.menuLoaded) return Promise.resolve();
    this.menuLoaded = true;
    return this.loadSounds(SOUND_SETS.MENU.loads);
  }

  /** every slot of a sound id (2D or 3D) in load order */
  slots(kind: Kind, id: number): readonly Slot[] { return this.bankOf(kind).get(id) ?? []; }
  /** the n-th slot a zone's list loaded for this sound (null: not loaded) */
  slot(kind: Kind, id: number, n = 0): Slot | null { return this.bankOf(kind).get(id)?.[n] ?? null; }

  /** which slot a by-id call means when the list loaded the sound several times: the one that already plays (loops are refreshed, not doubled), else the first idle one, else the first */
  private pick(list: readonly Slot[]): Slot {
    if (list.length === 1) return list[0];
    const loop = list[0].entry.loopCount === 0;
    if (loop) { const p = list.find((s) => s.playing); if (p) return p; }
    return list.find((s) => !s.playing) ?? list[0];
  }

  /** a sound the zone's list did not hold: load it and run `then` with its slot (once per id; later requests find it in the bank) */
  private lazyLoad(kind: Kind, id: number) {
    const ga = this.ga;
    if (!ga) return;
    const key = `${kind}:${id}`;
    this.missed.add(key);
    if (this.lazy.has(key)) return;
    this.stats.lazyLoads++;
    const token = this.zoneToken;
    const p = (kind === '2d' ? ga.sfx.load2D(id) : ga.sfx.load3D(id)).then((s) => {
      if (token !== this.zoneToken) return;
      const bank = this.bankOf(kind);
      const l = bank.get(id);
      if (l) l.push(s); else bank.set(id, [s]);
      const want = this.wanted.get(key);
      if (want !== undefined) {
        this.wanted.delete(key);
        this.stats.pendingPlays++;
        try { if (kind === '2d') ga.sfx.play2D(s); else if (want) ga.sfx.play3D(s, want); } catch { /* silent */ }
      }
    }).catch(() => { /* a missing sound stays silent */ });
    this.lazy.set(key, p);
  }

  /** world.sfx: FUN_004435a0 on the 2D slot of a sound id (call every frame for loops: refreshes the volume and restarts a stopped loop) */
  play(id: number) {
    if (!this.ga) return;
    try {
      const l = this.bank2.get(id);
      if (l) { this.ga.sfx.play2D(this.pick(l)); return; }
      this.wanted.set(`2d:${id}`, null);
      this.lazyLoad('2d', id);
    } catch { /* silent */ }
  }

  /** FUN_004433f0 on the 3D slot of a sound id: plays / updates / culls by the listener's distance */
  playAt(id: number, pos: Vec3 | ArrayLike<number>) {
    if (!this.ga) return;
    try {
      const p: Vec3 = 'x' in pos ? pos : { x: pos[0], y: pos[1], z: pos[2] };
      const l = this.bank3.get(id);
      if (l) { this.ga.sfx.play3D(this.pick(l), p); return; }
      this.wanted.set(`3d:${id}`, p);
      this.lazyLoad('3d', id);
    } catch { /* silent */ }
  }

  /** load 2D sounds ahead (a zone that loads sounds its generic list does not hold): the slots join the zone's bank */
  preload(ids: Iterable<number>) {
    const loads: SoundLoad[] = [];
    for (const id of ids) if (!this.bank2.has(id)) loads.push(['2d', id]);
    if (loads.length) this.zoneReady = Promise.all([this.zoneReady, this.loadSounds(loads)]).then(() => undefined);
  }

  /** extra loads of a zone (the objects it placed): the slots join the zone's bank; `ready()` waits for them */
  loadExtra(loads: readonly SoundLoad[]) { this.zoneReady = Promise.all([this.zoneReady, this.loadSounds(loads)]).then(() => undefined); }

  /** resolves when the zone's sounds are loaded (a zone game that needs its slots at its first frame awaits it) */
  ready(): Promise<void> { return this.zoneReady; }

  /** FUN_004435b0 / FUN_004434b0: stop a sound by id (every slot of it, 2D and 3D); a play still waiting for a lazy load is withdrawn */
  stop(id: number) {
    if (!this.ga) return;
    this.wanted.delete(`2d:${id}`); this.wanted.delete(`3d:${id}`);
    try {
      for (const s of this.bank2.get(id) ?? []) this.ga.sfx.stop(s);
      for (const s of this.bank3.get(id) ?? []) this.ga.sfx.stop(s);
    } catch { /* silent */ }
  }

  /** FUN_00443600(handle, hz): the playback frequency of the playing 2D slot(s) of a sound id (the island's engines) */
  rate(id: number, hz: number) {
    if (!this.ga) return;
    try { for (const s of this.bank2.get(id) ?? []) this.ga.sfx.setRate(s, hz); } catch { /* silent */ }
  }

  /** FUN_004435b0 + FUN_004435a0: stop the 2D sound and start it again */
  restart(id: number) {
    if (!this.ga) return;
    try {
      const l = this.bank2.get(id);
      if (l) { const s = this.pick(l); this.ga.sfx.stop(s); this.ga.sfx.play2D(s); return; }
      this.wanted.set(`2d:${id}`, null);
      this.lazyLoad('2d', id);
    } catch { /* silent */ }
  }

  /** the menu's sound effects (FUN_004b02d4: the four move sounds round-robin) */
  menu(kind: 'move' | 'select' | 'back' | 'onoff') {
    if (kind === 'move') { this.play(SND_UI.MENU_MOVE[this.moveRr]); this.moveRr = (this.moveRr + 1) % 4; }
    else this.play(kind === 'select' ? SND_UI.MENU_SELECT : kind === 'back' ? SND_UI.MENU_BACK : SND_UI.MENU_ONOFF);
  }

  /** the options' volumes (Settings[0] music, [1] sfx, [0x16] speech) */
  setVolumes(music: number, sfx: number, speech: number) {
    const speechChanged = this.volumesSet && speech !== this.wantedVol.speech;
    this.wantedVol = { music, sfx, speech };
    this.volumesSet = true;
    this.apply();
    // the options menu's speech slider (FUN_0041b9b1 case 6, menu 0xb item 3): the new value is stored, then FUN_00435a11(8, -1) says speech line 8 as a preview
    // (ignored while speech is active, like every request)
    if (speechChanged) { try { this.ga?.speech.say(8); } catch { /* silent */ } }
  }
  private apply() {
    const ga = this.ga;
    if (!ga) return;
    try { ga.setMusicVolume(this.wantedVol.music); ga.setSfxVolume(this.wantedVol.sfx); ga.setSpeechVolume(this.wantedVol.speech); } catch { /* silent */ }
  }

  /** once per loop frame: the listener from the camera, then the speech state machine (FUN_00435a5e; `dt` in the original's frames) */
  frame(camera: ArrayLike<number>, dt: number) {
    this.lastFrameMs = performance.now();
    this.listen(camera);
    try { this.ga?.speech.tick(dt); } catch { /* silent */ }
  }

  /**
   * FUN_004434d0(pos, front, up) once per frame: the 3D listener is the zone camera's block (`World.camera.c`: eye c[0..2], target c[3..5], up c[12..14], front c[15..17]);
   * z38PAR / z08BKD / z27TRX pass the target (the player) as the position, five zones never set it (src/audio/listener.ts: skipped here). The runner calls it at the end of every loop frame, so it is the pose the zone's 3D sounds of the next frame hear;
   a zone's own `setListener` call in the same frame is overwritten by the same block (the original's call is this one).
   */
  listen(c: ArrayLike<number>) {
    const ga = this.ga;
    if (!ga || LISTENER_NOT_SET.has(this.zone)) return;
    const o = LISTENER_AT_TARGET.has(this.zone) ? 3 : 0;
    try { ga.sfx.setListener({ x: c[o], y: c[o + 1], z: c[o + 2] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] }); } catch { /* silent */ }
  }

  // ------------------------------------------------------------------------------------------------ zones and music

  /** the sounds the original's zone start loads: its sound-setup function, the sets of the constructor classes it registers, then the menu clicks */
  zoneLoads(zone: string): SoundLoad[] {
    const out: SoundLoad[] = [];
    const setup = ZONE_SOUND_SETUP[zone];
    if (setup) out.push(...setup.loads);
    for (const c of ZONE_CLASS_SETS[zone] ?? []) out.push(...SOUND_SETS[c].loads);
    return out;
  }

  private musicHandle(key: string): Promise<MusicHandle | null> {
    const ga = this.ga;
    let p = this.handles.get(key.toLowerCase());
    if (!p && ga) { p = ga.music.load(key).catch(() => null); this.handles.set(key.toLowerCase(), p); }
    return p ?? Promise.resolve(null);
  }

  /**
   * Zone start (FUN_004359d5 reset + the zone's set-up): load its sound list and music key, start the MIDI ambience and the music the original plays at init.
   * Resolves when everything is loaded, so the runner can start the loop with nothing left to load. Calling it again for the same zone returns the same promise.
   */
  enterZone(zone: string, _opts: { walking?: boolean } = {}): Promise<void> {
    void _opts;
    const ga = this.ga;
    if (!ga) return Promise.resolve();
    if (this.zone === zone) return this.zoneReady;
    if (this.zone) this.leaveZone();      // a zone entered without leaving the last one: the reset the zone switch would have made
    this.zone = zone;
    const token = this.zoneToken;         // (`leaveZone` bumps it: loads of the previous zone, the menu clicks included, belong to this zone's caches)
    this.firedMoments.clear();
    const spec = ZONE_MUSIC[zone];
    const t0 = performance.now();
    const work = (async () => {
      const loads = this.zoneLoads(zone);
      this.note('zone', `${zone}: ${loads.length} sounds`);
      await Promise.all([
        this.loadSounds(loads),
        spec?.key ? this.musicHandle(spec.key).then(() => { try { ga.music.warm(); } catch { /* silent */ } }) : Promise.resolve(),
        ...(spec?.preload ?? []).map((k) => this.musicHandle(k)),
      ]);
      if (token !== this.zoneToken) return;
      this.note('ready', `${zone}: ${Math.round(performance.now() - t0)} ms`);
      if (spec?.ambience) ga.ambience.start(spec.ambience).catch(() => { /* silent */ });
      this.moment('init');
      // legacy / late start: the loop is already past the intro and the help (a zone that enters its zone from its own game code)
      if (this.mode === MODE.PLAY) { this.moment('leaveIntro'); this.moment('leaveHelp'); }
    })();
    this.zoneReady = work;
    return work;
  }

  /** the loop changed mode (the runner calls this for every transition): the moments of the original's FUN_004432c0 calls */
  modeChange(prev: number, mode: number) {
    this.mode = mode;
    if (prev === MODE.INTRO && (mode === MODE.HELP || mode === MODE.PLAY)) this.moment('leaveIntro');
    if (prev === MODE.HELP && mode === MODE.PLAY) this.moment('leaveHelp');
    // a zone of the port without that intro / help mode: its music starts when play does
    if (mode === MODE.PLAY) { this.moment('leaveIntro'); this.moment('leaveHelp'); }
  }

  /** run the plays of a moment (once: a moment passes once per zone visit; the original's loop modes do not repeat either) */
  private moment(at: MusicMoment) {
    const ga = this.ga;
    const spec = ZONE_MUSIC[this.zone];
    if (!ga || !spec?.key || this.firedMoments.has(at)) return;
    this.firedMoments.add(at);
    const plays = (spec.plays ?? []).filter((p) => p.at === at);
    if (plays.length === 0) return;
    const token = this.zoneToken;
    const key = spec.key;
    void this.musicHandle(key).then((h) => {
      if (token !== this.zoneToken || !h) return;
      for (const p of plays) {
        try {
          if (p.groove !== undefined) ga.music.setGroove(p.groove);
          this.note('music', `${key} ${at}${p.groove !== undefined ? ` groove ${p.groove}` : ''} (loop mode ${this.mode})`);
          ga.music.play(h);
        } catch { /* silent */ }
      }
    });
  }

  /** FUN_00443290 for keys a zone's own code will play (the island's Music node loads up to 11 at init): parsed now so the play has nothing left to load */
  preloadMusic(keys: Iterable<string>) { for (const k of keys) void this.musicHandle(k); }

  /** FUN_004432c0 for a key the zone's own code plays (z05WAB's end of game, z21FSH's Z21Jaws ...): loads it first when needed */
  playMusic(key: string, groove?: number) {
    const ga = this.ga;
    if (!ga) return;
    const token = this.zoneToken;
    void this.musicHandle(key).then((h) => {
      if (token !== this.zoneToken || !h) return;
      try { if (groove !== undefined) ga.music.setGroove(groove); ga.music.play(h); } catch { /* silent */ }
    });
  }

  /** zone exit (FUN_004359d5 at the next zone's start / FUN_00443300): stop everything, forget the loaded slots and keys */
  leaveZone() {
    this.zoneToken++;
    try { this.ga?.resetZone(); } catch { /* silent */ }
    this.bank2.clear(); this.bank3.clear();
    this.lazy.clear(); this.wanted.clear(); this.handles.clear();
    this.zone = '';
    this.mode = MODE.FADE_IN;
    this.firedMoments.clear();
    this.zoneReady = Promise.resolve();
    this.menuLoaded = false;
    void this.loadMenu();
  }
}
