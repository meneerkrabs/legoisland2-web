// Restored feature 'cues' (docs/re/restore-plan.md item 9, docs/re/restore.md): sounds that the original loads (or maps to a silent file) and never plays.
// ORIGINAL: every sound file and sound-table entry below is the game's own; the flower sounds are even CALLED by the original every tick (FUN_005396af -> FUN_004433f0), only the table maps them to Silence.wav.
// RECONSTRUCTION: for the other cues the original has no call at all; the event each one is tied to is chosen here from the sound's name and the zone code (the comment of each cue says why).
// The zones raise events with `restoreHooks.cue?.('<event>', ctx)` (one guarded line each); this feature turns the events it knows into sounds.
import type { Feature } from '../feature.ts';
import type { CueCtx } from '../cuectx.ts';

/** sound-table ids (docs/re/audio.md; the names of the executable's table) */
export const CUE_SND = {
  FLOWER_GROWING: 0, FLOWER_SHRINK: 2,
  /** z10RGB `SND_HIT_CASTLE` HIT_CASTLE.wav (loaded, never played: docs/re/m6/z10RGB.md s.8) */
  HIT_CASTLE: 0x196,
  /** z17WAS `SND_WAS_BIGTHUMP` "big bonk.wav" (loaded, never played: docs/re/m3/z17WAS.md s.7) */
  WAS_BIGTHUMP: 0x1c8,
  /** z15SSH `SND_WATERFALL` river_amb.wav (loaded, never played) */
  WATERFALL: 0xbc,
  /** z41MAP `SND_MAP_PAPA_CONGRATS` (loaded, never played) */
  MAP_PAPA_CONGRATS: 0x1dc,
  /** z22BIP melon_fly 0x7e, rock_hit 0x2e5 (loaded, never played: docs/re/m6/z22BIP.md s.4) */
  BIP_MELON_FLY: 0x7e, BIP_ROCK_HIT: 0x2e5,
  /** z03PPH `SND_PPH_SWITCHON / SWITCHOFF / COMPUTER` StartComp.wav / Shutoff.wav / computer.wav (a loop), ids 642-644 (loaded, never played: docs/re/m3/z03PPH.md s.7) */
  PPH_SWITCHON: 642, PPH_SWITCHOFF: 643, PPH_COMPUTER: 644,
  /** z28HAT `hatesFinal` 0x2b8 "Horn2" (loaded, never played) */
  HAT_FINAL: 0x2b8,
} as const;

/** the file names of the two flower sounds (z02LGI): ORIGINAL files, unused by the original table (it maps both ids to Silence.wav) */
const FLOWER_FILES: Record<number, string> = { 0: '_Data\\sounds\\\\z02LGI\\GrowBig.wav', 2: '_Data\\sounds\\\\z02LGI\\GrowSmll.wav' };

/** event -> what to play. Each entry names the sound id it plays. */
/** z03PPH: was the computer menu active at the last call (per zone run) */
const computerWas = new WeakMap<object, boolean>();

const HANDLERS: Record<string, (c: CueCtx) => void> = {
  // flowers (the island, src/island/pizza/footy.ts FlowerNode): called every tick of the phase like the original; the sink plays a sound that is already playing only as a volume refresh
  'flower-grow': (c) => c.sfx?.(CUE_SND.FLOWER_GROWING),
  'flower-shrink': (c) => c.sfx?.(CUE_SND.FLOWER_SHRINK),
  // RECONSTRUCTION: HIT_CASTLE when a cannonball lands on the castle `BUNS` (the second ray of FUN_005f8291, the only place the castle is hit)
  'rgb-castle-hit': (c) => { if (c.pos) c.sfxAt?.(CUE_SND.HIT_CASTLE, c.pos); },
  // RECONSTRUCTION: "big bonk" on the hammer's hit of an ordinary snake (not the gem grab); z17WAS big swing (457) stays unused: no event identifiable
  'was-hit': (c) => { if (c.kind === 'snake') c.sfx?.(CUE_SND.WAS_BIGTHUMP); },
  // RECONSTRUCTION: the waterfall bed (river_amb.wav, a loop) placed at the fountain G149, called every tick like the fountain sound (the zone has no waterfall record)
  'ssh-tick': (c) => { if (c.pos) c.sfxAt?.(CUE_SND.WATERFALL, c.pos); },
  // RECONSTRUCTION: Pepper's computer: StartComp.wav when the menu opens, the computer loop (a 2D loop refreshed every tick, like the original's loops) while it is open, Shutoff.wav when it closes.
  // (SCROLL_OK / SCROLL_NA 645 / 646 and the house footsteps 674-677 are not restored: the shell's menu sounds / the walker's footsteps already cover those events)
  'pph-computer': (c) => {
    const k = c.key ?? computerWas, was = computerWas.get(k) ?? false, now = c.active === true;
    computerWas.set(k, now);
    if (now && !was) c.sfx?.(CUE_SND.PPH_SWITCHON);
    if (now) c.sfx?.(CUE_SND.PPH_COMPUTER);
    if (!now && was) { c.stop?.(CUE_SND.PPH_COMPUTER); c.sfx?.(CUE_SND.PPH_SWITCHOFF); }
  },
  // RECONSTRUCTION: Horn2 when Bronty is freed (the FREED state: Mr Hates' last scene)
  'hat-freed': (c) => c.sound?.play('hatesFinal'),
  // RECONSTRUCTION: Papa congratulates when a medal is awarded (the result banner)
  'map-medal': (c) => c.sfx?.(CUE_SND.MAP_PAPA_CONGRATS),
  // RECONSTRUCTION: melon_fly with the throw of a melon (next to chimp_throw), rock_hit when a stone hits the plane (next to the 100 points it costs)
  'bip-melon-throw': (c) => { if (c.pos) c.sound?.at?.('melonFly', c.pos); },
  'bip-stone-hit': (c) => { if (c.pos) c.sound?.at?.('rockHit', c.pos); },
};

export const feature: Feature = {
  id: 'cues',
  /** the flowers' two table entries point at the real files instead of Silence.wav (the other fields stay the original's) */
  soundPatch(sounds) {
    for (const [id, file] of Object.entries(FLOWER_FILES)) {
      const e = sounds[Number(id)];
      if (e && /silence\.wav$/i.test(e.path)) e.path = file;
    }
  },
  cue(name, ctx) { HANDLERS[name]?.((ctx ?? {}) as CueCtx); },
};
