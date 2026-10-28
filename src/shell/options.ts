// Options file `_data\Settings.set`: 23 raw little-endian int32 (92 bytes) at DAT_009833f0 (accessor FUN_004040ec(i), loader FUN_00403e30, writer FUN_0040410f).
// The menu handlers that write them are in FUN_0041b500 (cases 5 and 6). Defaults are read from the immediates of FUN_00403e30 in the executable.
import type { Pe } from '../formats/exe.ts';
import type { GameVars } from '../game/vars.ts';

export const SETTINGS_COUNT = 0x17;
export const SETTINGS_BYTES = SETTINGS_COUNT * 4;
export const SETTINGS_KEY = 'Settings.set';
export const SETTINGS_DEFAULTS_FN = 0x403e30;
export const SETTINGS_ACCESSOR_FN = 0x4040ec;

/** indices into Settings.set */
export const S = {
  MUSIC_VOLUME: 0, SFX_VOLUME: 1, SPEECH_ON: 2, SUBTITLES_ON: 3, KEY_FIRST: 4, KEY_COUNT: 13, KEY_DELETE: 0x11, TEXTURE_QUALITY: 0x12,
  GAMEPAD: 0x13, SENSITIVITY: 0x14, DRAW_DISTANCE: 0x15, SPEECH_VOLUME: 0x16,
} as const;

/** names of the 13 logical keys 4..0x10 in menu order (page 13 "FEKEYS"; input.ts maps them to the gameplay bits) */
export const KEY_NAMES = ['up', 'down', 'left', 'right', 'ctrl', 'alt', 'shift', 'space', 'oem102', 'z', 'x', 'c', 'enter'] as const;

/** what the executable's defaults are (FUN_00403e30), used when the scan of the code fails: volumes 0x50, speech/subtitles on, DIK codes | 0x10000 */
export const FALLBACK_DEFAULTS: readonly number[] = [
  0x50, 0x50, 1, 1, 0x100c8, 0x100d0, 0x100cb, 0x100cd, 0x1001d, 0x10038, 0x1002a, 0x10039, 0x10056, 0x1002c, 0x1002d, 0x1002e, 0x1001c, 0x10053,
  1, 1, 0x2d, 0x32, 0x50,
];

/**
 * The defaults live in straight-line code: `push idx; call 0x4040ec; ... mov [reg], imm32`. Scan that function for the (index, immediate) pairs.
 * Returns null if fewer than 23 were found.
 */
export function readOptionDefaults(pe: Pe): Int32Array | null {
  const out = new Int32Array(SETTINGS_COUNT);
  const seen = new Set<number>();
  const o0 = pe.offset(SETTINGS_DEFAULTS_FN);
  if (o0 < 0) return null;
  const d = pe.data, end = o0 + 0x260;
  for (let o = o0; o < end; o++) {
    if (d[o] !== 0xe8) continue;
    const rel = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24);
    const target = (SETTINGS_DEFAULTS_FN + (o - o0) + 5 + rel) >>> 0;
    if (target !== SETTINGS_ACCESSOR_FN) continue;
    let idx = -1;
    if (d[o - 2] === 0x6a) idx = d[o - 1]; else if (d[o - 5] === 0x68) idx = d[o - 4] | (d[o - 3] << 8);
    if (idx < 0 || idx >= SETTINGS_COUNT) continue;
    for (let k = o + 5; k < o + 30; k++) {
      if (d[k] === 0xc7 && d[k + 1] < 0x08) { out[idx] = d[k + 2] | (d[k + 3] << 8) | (d[k + 4] << 16) | (d[k + 5] << 24); seen.add(idx); break; }
    }
  }
  return seen.size === SETTINGS_COUNT ? out : null;
}

export type OptionsListener = (index: number, value: number) => void;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v | 0));

export class Options {
  readonly a = new Int32Array(SETTINGS_COUNT);
  private listeners = new Set<OptionsListener>();
  private defaults: Int32Array;

  /** `defaults` from `readOptionDefaults(pe)` (falls back to the known constants) */
  constructor(defaults?: Int32Array | null) {
    this.defaults = defaults ? defaults.slice() : Int32Array.from(FALLBACK_DEFAULTS);
    this.a.set(this.defaults);
  }

  static fromExe(pe: Pe): Options { return new Options(readOptionDefaults(pe)); }

  reset() { for (let i = 0; i < SETTINGS_COUNT; i++) this.setRaw(i, this.defaults[i]); }
  defaultOf(i: number): number { return this.defaults[i]; }

  onChange(fn: OptionsListener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private setRaw(i: number, v: number) {
    v |= 0;
    if (this.a[i] === v) return;
    this.a[i] = v;
    for (const l of this.listeners) l(i, v);
  }
  get(i: number): number { return this.a[i]; }
  set(i: number, v: number) { if (i >= 0 && i < SETTINGS_COUNT) this.setRaw(i, v); }

  /** volumes are 0..100 (music FUN_00443350, SFX FUN_004431d0, speech: Miles stream volume v*127/100) */
  get musicVolume() { return this.a[S.MUSIC_VOLUME]; }
  set musicVolume(v: number) { this.setRaw(S.MUSIC_VOLUME, clamp(v, 0, 100)); }
  get sfxVolume() { return this.a[S.SFX_VOLUME]; }
  set sfxVolume(v: number) { this.setRaw(S.SFX_VOLUME, clamp(v, 0, 100)); }
  get speechVolume() { return this.a[S.SPEECH_VOLUME]; }
  set speechVolume(v: number) { this.setRaw(S.SPEECH_VOLUME, clamp(v, 0, 100)); }
  get speechOn() { return this.a[S.SPEECH_ON] !== 0; }
  get subtitlesOn() { return this.a[S.SUBTITLES_ON] !== 0; }
  /** FUN_0041b500 case 5 (page 12): turning speech off while subtitles are off forces subtitles on, and vice versa (at least one stays on) */
  setSpeechOn(on: boolean) {
    this.setRaw(S.SPEECH_ON, on ? 1 : 0);
    if (!on && this.a[S.SUBTITLES_ON] === 0) this.setRaw(S.SUBTITLES_ON, 1);
  }
  setSubtitlesOn(on: boolean) {
    this.setRaw(S.SUBTITLES_ON, on ? 1 : 0);
    if (!on && this.a[S.SPEECH_ON] === 0) this.setRaw(S.SPEECH_ON, 1);
  }
  /** texture detail: 0 = textures halved (page 10 item 2, FUN_0040cf18), 1 = full */
  get textureQuality() { return this.a[S.TEXTURE_QUALITY]; }
  set textureQuality(v: number) { this.setRaw(S.TEXTURE_QUALITY, v); }
  get gamepad() { return this.a[S.GAMEPAD] !== 0; }
  set gamepad(on: boolean) { this.setRaw(S.GAMEPAD, on ? 1 : 0); }
  /** mouse / pad axis sensitivity (page 9 slider; default 45) */
  get sensitivity() { return this.a[S.SENSITIVITY]; }
  set sensitivity(v: number) { this.setRaw(S.SENSITIVITY, clamp(v, 0, 100)); }
  /** draw distance 0..100 (page 10 slider "FOG", FUN_00409792 / FUN_004095ab; default 50) */
  get drawDistance() { return this.a[S.DRAW_DISTANCE]; }
  set drawDistance(v: number) { this.setRaw(S.DRAW_DISTANCE, clamp(v, 0, 100)); }

  /** key binding i (0..12, KEY_NAMES order) or 13 = Del: (device << 16) | DIK */
  binding(i: number): { device: number; dik: number } {
    const v = this.a[i === 13 ? S.KEY_DELETE : S.KEY_FIRST + i] >>> 0;
    return { device: v >>> 16, dik: v & 0xffff };
  }
  setBinding(i: number, device: number, dik: number) { this.setRaw(i === 13 ? S.KEY_DELETE : S.KEY_FIRST + i, ((device & 0xffff) << 16) | (dik & 0xffff)); }

  /** mirrors the menu: var 9 CS_SPEECH_ON = speech, var 0 CS_TEXT_ON = subtitles (FUN_0041b500 case 5) */
  applyToVars(vars: GameVars) { vars.set(9, this.a[S.SPEECH_ON]); vars.set(0, this.a[S.SUBTITLES_ON]); }

  /** FUN_0040410f: 23 little-endian int32 */
  encode(): Uint8Array {
    const out = new Uint8Array(SETTINGS_BYTES), dv = new DataView(out.buffer);
    for (let i = 0; i < SETTINGS_COUNT; i++) dv.setInt32(i * 4, this.a[i], true);
    return out;
  }
  /** FUN_00403e30 (file present): fread(buf, 4, 0x17) - a short file leaves the remaining settings as they are */
  decode(b: Uint8Array) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = Math.min(SETTINGS_COUNT, Math.floor(b.length / 4));
    for (let i = 0; i < n; i++) this.setRaw(i, dv.getInt32(i * 4, true));
  }
}
