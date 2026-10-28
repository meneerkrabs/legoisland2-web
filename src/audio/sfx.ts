// Sound effects with the semantics of the game's SoundClass (docs/re/audio.md section 2 and 3):
//  - a sound is a *slot* made by load2D / load3D (<= 200 slots of each kind); a slot has at most one voice
//  - 16 2D + 16 3D voices; when none is free the play call is dropped (no stealing, no priority)
//  - play on a slot that is already playing only refreshes its volume (no restart); a finished loop-count-0 sound is restarted
//  - volume = tableVolume * sfxSlider / 100 on Miles' 0..127 scale, pan 64 = centre, playback rate in Hz from the table (pitch)
//  - 3D: inverse-distance law with ref distance = table min, the *game* stops the sound beyond table max (cull on every update),
//    listener = camera, no doppler
import { normalizePath, readTolerant } from './files.ts';
import type { AudioFiles } from './files.ts';
import type { SoundTableEntry } from './tables.ts';

export const MAX_VOICES_2D = 16, MAX_VOICES_3D = 16, MAX_SLOTS = 200;

export interface Vec3 { x: number; y: number; z: number }

export interface SoundSlot {
  readonly id: number;
  readonly kind: '2d' | '3d';
  readonly entry: SoundTableEntry;
  /** decoded sound (null: file missing / empty / undecodable: the slot is silent) */
  buffer: AudioBuffer | null;
  /** sample rate of the file as stored (the buffer is resampled to the context rate by decodeAudioData) */
  nativeRate: number;
  /** (int) max distance of a 3D slot */
  maxDist: number;
  playing: boolean;
  voice: Voice | null;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  panner: PannerNode | null;
  slot: SoundSlot;
}

interface Decoded { buffer: AudioBuffer | null; nativeRate: number }

function wavRate(b: Uint8Array): number {
  if (b.length > 28 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return b[24] | (b[25] << 8) | (b[26] << 16) | (b[27] << 24);
  return 0;
}

export class SoundEngine {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private files: AudioFiles;
  private table: SoundTableEntry[];
  private byName: Map<string, number>;
  private slots2d: SoundSlot[] = [];
  private slots3d: SoundSlot[] = [];
  private voices2d = new Set<Voice>();
  private voices3d = new Set<Voice>();
  private decoded = new Map<string, Promise<Decoded>>();
  /** SFX slider (opt[1], 0..100) */
  sfxVolume = 80;
  /** the game is left-handed (+Z forward), Web Audio right-handed: flip Z for positions and orientation */
  flipZ = true;
  panningModel: PanningModelType = 'equalpower';
  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  stats = { loads: 0, dropped: 0, played: 0, culled: 0, missing: 0 };

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: SoundTableEntry[], byName: Map<string, number>) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table; this.byName = byName;
  }

  idOf(idOrName: number | string): number {
    if (typeof idOrName === 'number') return idOrName;
    const id = this.byName.get(idOrName.toLowerCase());
    if (id === undefined) throw new Error(`unknown sound ${idOrName}`);
    return id;
  }

  private decode(path: string): Promise<Decoded> {
    const k = normalizePath(path).toLowerCase();
    let p = this.decoded.get(k);
    if (!p) {
      p = (async (): Promise<Decoded> => {
        const bytes = await readTolerant(this.files, path);
        if (!bytes || bytes.length < 45) { this.stats.missing++; return { buffer: null, nativeRate: 0 }; }
        const rate = wavRate(bytes);
        try {
          const buffer = await this.ctx.decodeAudioData(bytes.slice().buffer);
          return { buffer, nativeRate: rate || buffer.sampleRate };
        } catch {
          return { buffer: null, nativeRate: rate };
        }
      })();
      this.decoded.set(k, p);
    }
    return p;
  }

  private async load(idOrName: number | string, kind: '2d' | '3d'): Promise<SoundSlot> {
    const id = this.idOf(idOrName);
    const entry = this.table[id];
    if (!entry) throw new Error(`sound id ${id} out of range`);
    const list = kind === '2d' ? this.slots2d : this.slots3d;
    this.stats.loads++;
    // the original returns slot 0 when its cache is full (it never happens in practice)
    if (list.length >= MAX_SLOTS) return list[0];
    const d = /^(UNDEFINED|_Data\\sounds\\PSX ONLY)/i.test(entry.path) ? { buffer: null, nativeRate: 0 } : await this.decode(entry.path);
    const slot: SoundSlot = { id, kind, entry, buffer: d.buffer, nativeRate: d.nativeRate, maxDist: Math.trunc(entry.maxDist), playing: false, voice: null };
    list.push(slot);
    return slot;
  }

  /** FUN_00443580 */
  load2D(idOrName: number | string) { return this.load(idOrName, '2d'); }
  /** FUN_004433b0 */
  load3D(idOrName: number | string) { return this.load(idOrName, '3d'); }

  private sampleVolume(slot: SoundSlot): number { return Math.floor((slot.entry.volume * this.sfxVolume) / 100); }

  private startVoice(slot: SoundSlot, pos: Vec3 | null): boolean {
    const set = slot.kind === '2d' ? this.voices2d : this.voices3d;
    if (set.size >= (slot.kind === '2d' ? MAX_VOICES_2D : MAX_VOICES_3D)) { this.stats.dropped++; return false; }
    const ctx = this.ctx, e = slot.entry;
    const src = ctx.createBufferSource();
    src.buffer = slot.buffer;
    const hz = e.rate > 0 ? e.rate : slot.nativeRate;
    src.playbackRate.value = slot.nativeRate ? hz / slot.nativeRate : 1;
    const gain = ctx.createGain();
    gain.gain.value = this.sampleVolume(slot) / 127;
    src.connect(gain);
    let pan: StereoPannerNode | null = null, panner: PannerNode | null = null;
    if (slot.kind === '2d') {
      pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, (e.pan - 64) / 64));
      gain.connect(pan); pan.connect(this.dest);
    } else {
      panner = ctx.createPanner();
      panner.panningModel = this.panningModel;
      panner.distanceModel = 'inverse';
      panner.refDistance = Math.max(0.0001, e.minDist);
      panner.maxDistance = Math.max(e.maxDist, e.minDist + 1);
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360; panner.coneOuterAngle = 360; panner.coneOuterGain = 0;
      if (pos) this.setPannerPos(panner, pos);
      gain.connect(panner); panner.connect(this.dest);
    }
    const voice: Voice = { src, gain, pan, panner, slot };
    // loop count: 1 = once, 0 = forever, n = n times in total
    const n = e.loopCount;
    if (n !== 1) src.loop = true;
    src.onended = () => {
      if (slot.voice === voice) { slot.voice = null; slot.playing = false; }
      set.delete(voice);
      try { src.disconnect(); gain.disconnect(); pan?.disconnect(); panner?.disconnect(); } catch { /* already gone */ }
    };
    set.add(voice);
    slot.voice = voice; slot.playing = true;
    const t = ctx.currentTime;
    src.start(t);
    if (n > 1 && slot.buffer) src.stop(t + (slot.buffer.duration * n) / src.playbackRate.value);
    this.stats.played++;
    return true;
  }

  private setPannerPos(p: PannerNode, v: Vec3) {
    const z = this.flipZ ? -v.z : v.z;
    if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = z; } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, z);
  }

  private endVoice(slot: SoundSlot) {
    const v = slot.voice;
    if (!v) { slot.playing = false; return; }
    slot.voice = null; slot.playing = false;
    (slot.kind === '2d' ? this.voices2d : this.voices3d).delete(v);
    v.src.onended = null;
    try { v.src.stop(); } catch { /* not started */ }
    try { v.src.disconnect(); v.gain.disconnect(); v.pan?.disconnect(); v.panner?.disconnect(); } catch { /* ignore */ }
  }

  /** FUN_004435a0: play a 2D slot (call every frame for loops: it refreshes the volume and restarts a stopped loop). Returns false when dropped. */
  play2D(slot: SoundSlot): boolean {
    if (!slot.buffer) return false;
    if (!slot.playing) return this.startVoice(slot, null);
    if (slot.voice) slot.voice.gain.gain.value = this.sampleVolume(slot) / 127;
    return true;
  }

  /** FUN_004433f0: play / update a positional slot: updates its position, plays it when within the max distance of the listener, stops (and frees the voice) otherwise. */
  play3D(slot: SoundSlot, pos: Vec3): boolean {
    if (slot.voice?.panner) this.setPannerPos(slot.voice.panner, pos);
    const dx = this.listenerPos.x - pos.x, dy = this.listenerPos.y - pos.y, dz = this.listenerPos.z - pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= slot.maxDist * slot.maxDist) {
      if (!slot.buffer) return false;
      if (!slot.playing) return this.startVoice(slot, pos);
      if (slot.voice) slot.voice.gain.gain.value = this.sampleVolume(slot) / 127;
      return true;
    }
    if (slot.playing) { this.endVoice(slot); this.stats.culled++; }
    return false;
  }

  /** FUN_004435b0 / FUN_004434b0: stop at once. */
  stop(slot: SoundSlot) { this.endVoice(slot); }

  /** FUN_00443600: pitch of a playing 2D sound as an absolute rate in Hz. */
  setRate(slot: SoundSlot, hz: number) {
    if (slot.voice && slot.nativeRate) slot.voice.src.playbackRate.value = hz / slot.nativeRate;
  }

  /** FUN_004435c0: raw volume 0..127 of a playing sound (no table volume, no slider). */
  setVolumeRaw(slot: SoundSlot, v: number) { if (slot.voice) slot.voice.gain.gain.value = Math.max(0, Math.min(127, v)) / 127; }

  /** True when nothing of this slot is sounding. */
  isIdle(slot: SoundSlot): boolean { return !slot.playing; }

  /** FUN_004434d0: the listener (camera eye, forward and up vectors in game coordinates). */
  setListener(pos: Vec3, front: Vec3, up: Vec3) {
    this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    const l = this.ctx.listener, f = this.flipZ ? -1 : 1;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z * f;
      // Web Audio looks along -Z of its own right-handed system; our +Z forward becomes -Z after the flip, so pass the flipped vectors as they are
      l.forwardX.value = front.x; l.forwardY.value = front.y; l.forwardZ.value = front.z * f;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z * f;
    }
  }

  /** The SFX slider (opt[1]) changed: re-apply the volume of everything that plays. */
  setSfxVolume(opt1: number) {
    this.sfxVolume = opt1;
    for (const v of [...this.voices2d, ...this.voices3d]) v.gain.gain.value = this.sampleVolume(v.slot) / 127;
  }

  /** FUN_004359d5: zone change. Stops every voice and drops all slots (the decoded files stay cached). */
  reset() {
    for (const s of [...this.slots2d, ...this.slots3d]) this.endVoice(s);
    this.slots2d = []; this.slots3d = [];
    if (this.decoded.size > 600) this.decoded.clear();
  }

  get activeVoices() { return { d2: this.voices2d.size, d3: this.voices3d.size }; }
  get slotCounts() { return { d2: this.slots2d.length, d3: this.slots3d.length }; }
}
