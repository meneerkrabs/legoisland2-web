// The music keys of every zone and the moments of the original's FUN_004432c0 (Play) calls (docs/re/audio.md 7.8 and 11.2). Pure data: the shell's AudioHost acts on it.

/** when in the zone loop the original calls FUN_004432c0 (Play): at the zone's init, when the intro (mode 1) is left, or when the controls help (mode 9) is left */
export type MusicMoment = 'init' | 'leaveIntro' | 'leaveHelp';
export interface MusicPlay { at: MusicMoment; /** FUN_00443310 right before the play */ groove?: number }
export interface ZoneMusicSpec {
  /** the key the zone loads at init (FUN_00443290); absent: the zone's own code loads and plays (island, z18MMP) */
  key?: string;
  /** every FUN_004432c0 the zone's loop makes for that key, in order of the moments; a second play of the same segment starts it over */
  plays?: readonly MusicPlay[];
  /** MIDI ambience bed (FUN_004431e0) the zone starts at init */
  ambience?: string;
  /** further keys the zone loads at init (FUN_00443290) and plays from its own code */
  preload?: readonly string[];
}

/**
 * Music keys and the moments of their FUN_004432c0 calls, per zone (docs/re/audio.md 7.8 / 11.2). "line" = LE2.c line of the call.
 * Zones that start no key here either have none (z09JST, z36CNT) or load / play from their own code (z02LGI: Music node; z05WAB: z05WAB/game.ts; z18MMP: the puzzle).
 */
export const ZONE_MUSIC: Readonly<Record<string, ZoneMusicSpec>> = {
  z60FRE: { key: 'menu', plays: [{ at: 'init' }] },                                                      // 61024 (mode 0)
  z03PPH: { key: 'menu', plays: [{ at: 'init' }] },                                                      // 94631 (loop mode 0)
  z04IFC: { key: 'menu', plays: [{ at: 'init' }] },                                                      // 98831 (loop mode 0)
  z01BPK: { key: 'Z01BPK', plays: [{ at: 'leaveIntro' }] },                                              // 67567 (mode 1 -> 2)
  z02LGI: {},                                                                                            // Music node + ambience (src/island/ambient/music.ts)
  z05WAB: { key: 'Z05WAB1', plays: [{ at: 'leaveHelp' }] },                                              // 104071 (mode 9 -> 2); 103970 replays it when the game ends (z05WAB/game.ts)
  z07CSI: { key: 'Z07CSI', plays: [{ at: 'init', groove: -2 }], ambience: 'Castle' },                    // 106911-106912 in the zone function
  z08BKD: { key: 'Z08BKD1', plays: [{ at: 'leaveHelp' }] },                                              // 118236
  z10RGB: { key: 'z10rgb', plays: [{ at: 'leaveHelp' }] },                                               // 132604
  z13CAI: { key: 'ad2', plays: [{ at: 'init' }, { at: 'leaveIntro', groove: 0 }] },                      // 139466 (init) + 139005 (mode 1 -> 2)
  z14OSD: { key: 'ad1T', plays: [{ at: 'init' }] },                                                      // 144770 (the object's constructor)
  z15SSH: { key: 'z15ssh', plays: [{ at: 'leaveHelp' }] },                                               // 150157
  z16PYA: { key: 'ad1T', plays: [{ at: 'init', groove: -2 }] },                                          // 157767-157768 (+ 158606 after the load)
  z17WAS: { key: 'z17was2', plays: [{ at: 'leaveHelp' }] },                                              // 162498
  z18MMP: {},                                                                                            // Hotep / Z18MMP / Z18MMPPre / Z28HAT by the puzzle's events (z18MMP.ts)
  z20DSP: { key: 'z15ssh', plays: [{ at: 'leaveHelp' }] },                                               // 174301
  z21FSH: { key: 'Z21FSH', plays: [{ at: 'leaveHelp' }], ambience: 'Fishing', preload: ['Z21Jaws'] },       // 188342 (+ Z21Jaws by the zone's phase, 190705)
  z22BIP: { key: 'carn', plays: [{ at: 'leaveHelp' }] },                                                 // 194550
  z23DIP: { key: 'ad2', plays: [{ at: 'init', groove: -2 }] },                                           // 204360-204361
  z27TRX: { key: 'Flying', plays: [{ at: 'leaveHelp' }], ambience: 'TRex' },                             // 212791
  z28HAT: { key: 'z28HAT', plays: [{ at: 'leaveHelp' }] },                                               // 220929
  z38PAR: { key: 'Z38PAR', plays: [{ at: 'leaveHelp' }] },                                               // 57316
  z39ASB: { key: 'Z38PAR', plays: [{ at: 'leaveHelp' }] },                                               // 232273 (the zone's game starts the `Asteroid` bed itself, z39ASB/game.ts)
  z40aPO: { key: 'Z40APO', plays: [{ at: 'leaveIntro' }] },                                              // 238850 (mode 1 -> 9)
  z40OGL: { key: 'ogel', plays: [{ at: 'init' }] },                                                      // 244926 (loop mode 0)
  z41MAP: { key: 'Z41MAP', plays: [{ at: 'leaveIntro' }] },                                              // 251776 (mode 1 -> 9)
  z42BRP: { key: 'Z42BRP', plays: [{ at: 'leaveHelp', groove: -1 }] },                                   // 256833-256834 (groove 0 again at the second help, z42BRP/game.ts)
  z50LTC: { key: 'ad2', plays: [{ at: 'init' }, { at: 'leaveIntro' }] },                                 // 264390 (init) + 264073 (mode 1 -> 2)
};
