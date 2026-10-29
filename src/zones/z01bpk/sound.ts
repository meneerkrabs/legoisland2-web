// z01BPK's sound slots (FUN_00492ec0 loads them at zone start): the wheels are one positional loop (sound 0x94, DAT_05d5804c), the crash (0x1a8) and the stunt sounds
// (0x1aa .. 0x1bb) are plain slots played by FUN_004435a0. The ids are the loads of FUN_00492ec0; the sounds the zone never plays (0x95, 0x97 .. 0x9a, 0xa0, 0x1a9, 0x1b1, 0x1b9,
// 0x1bc .. 0x1c1, 0x2a9 .. 0x2ad: landing / bump / cheer sounds the park's code loads but no handler plays) are not loaded here.
import { SoundBank } from '../parachute/sound.ts';
import type { SoundBackend, SoundDef } from '../parachute/sound.ts';
import type { BpkSounds } from './run.ts';

export const BPK_WHEELS = 0x94;
/** the stunt sounds in slot order (DAT_05d58010 = 0x1aa ... DAT_05d58014 = 0x1bb) and the crash */
export const BPK_SOUND_IDS = [0x1a8, 0x1aa, 0x1ab, 0x1ac, 0x1ad, 0x1ae, 0x1af, 0x1b0, 0x1b2, 0x1b3, 0x1b4, 0x1b5, 0x1b6, 0x1b7, 0x1b8, 0x1ba, 0x1bb] as const;

export const BPK_SOUNDS: Record<string, SoundDef> = {
  wheels: { id: BPK_WHEELS, kind: '3d' },
  ...Object.fromEntries(BPK_SOUND_IDS.map((id) => [`s${id}`, { id, kind: '2d' } as SoundDef])),
};

/** the nodes' view of the bank: by sound id; an id the bank does not know is ignored (silent) */
export class BpkSoundBank implements BpkSounds {
  readonly bank: SoundBank<string>;
  private wheelsOn = false;
  constructor(backend: SoundBackend | null) { this.bank = new SoundBank<string>(BPK_SOUNDS, backend); }
  load() { return this.bank.load(); }
  play(id: number) { if (`s${id}` in BPK_SOUNDS) this.bank.play(`s${id}`); }
  stop(id: number) { if (`s${id}` in BPK_SOUNDS) this.bank.stop(`s${id}`); }
  wheels(on: boolean, pos: readonly number[]) {
    if (on) { this.bank.at('wheels', pos); this.wheelsOn = true; }
    else if (this.wheelsOn) { this.bank.stop('wheels'); this.wheelsOn = false; }
  }
  stopAll() { this.bank.stopAll(); this.wheelsOn = false; }
}
