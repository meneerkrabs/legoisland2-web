// z23DIP (the Dino island, zone table index 19, z90DIP): the constants of the zone's own code. Every number is read off the decompile (LE2.c) at the address in its comment;
// record indices are the byte offsets of the decompile / 0x68 (checked against the record names in tools/tests/m5-z23DIP.mjs).

/** zone table index of the Dino island (story nodes 47 and 50) */
export const ZONE_INDEX = 19;
/** story nodes of the hub: 47 = the first visit (T-Rex, Pterodactyl), 50 = the return after z27TRX / z28HAT (the balloon, the Rex animations) */
export const NODE_FIRST = 47, NODE_RETURN = 50;

/** game variables the zone's code reads (src/game/vars.ts names in comments) */
export const VAR = {
  /** FSM_CURRENT_STATE */
  STORY: 0x58,
  /** SWITCH_GME_PEPPER_CONTROL */
  CONTROL: 0x5e,
  /** SWITCH_NS_INTERACT_ICONS (the nodes OR their icon bits in, the HUD clears it every frame) */
  ICONS: 0x0c,
  /** the score shown at the top centre ("%04d", FUN_00726610) */
  SCORE: 0x17,
  /** the collected gems: one bit per gem (GEM0..GEM4 gate on bits 1 .. 0x10 of it; FUN_00726610 counts the low 10 bits) */
  GEMS: 0x3c,
} as const;

/** record indices of the scene (decompile byte offset / 0x68 + the field) */
export const REC = {
  PEPP: 16,
  /** SKBD, the skateboard (DAT_009daa7c = 0x1c, FUN_00726e25; the walk-on-the-board code uses `+ 0xb68` = record 0x1c's animation) */
  SKBD: 28,
  /** HALL (+ 0x11b4): the hall's ambient sound 0x30d plays at its position */
  HALL: 43,
  /** PTER (+ 0x51c): the pterodactyl's sound 0x31d */
  PTER: 12,
  /** BRON (+ 0xacc): the brontosaurus's roars 0x321 / 0x322 */
  BRON: 26,
  /** REX1 (+ 0x4b4: the position every REX step sound is played at), REX2 .. REX7 (the records whose animation frame decides the sound) */
  REX1: 11, REX2: 20, REX3: 21, REX4: 22, REX5: 23, REX6: 29, REX7: 30,
  /** the creature positions of the random call sound (FUN_00727360): TRI2 (+ 0x7f4), TRI1 (+ 0x44c), STE2 (+ 0x78c), STE1 (+ 0x3e4), TRX2 (+ 0xd3c), TRX1 (+ 0xcd4) */
  TRI2: 19, TRI1: 10, STE2: 18, STE1: 9, TRX2: 32, TRX1: 31,
  /** LOON, the balloon of story node 50 (the node FUN_007281aa is attached to it: `+ 0x50d8`) */
  LOON: 199,
} as const;

/** record names of the table above (the tests compare them with the scene) */
export const REC_NAMES: Record<number, string> = {
  16: 'PEPP', 28: 'SKBD', 43: 'HALL', 12: 'PTER', 26: 'BRON', 11: 'REX1', 20: 'REX2', 21: 'REX3', 22: 'REX4', 23: 'REX5', 29: 'REX6', 30: 'REX7',
  19: 'TRI2', 10: 'TRI1', 18: 'STE2', 9: 'STE1', 32: 'TRX2', 31: 'TRX1', 199: 'LOON',
};

/** the constructors of the zone (the foundation's survey: docs/re/m5/foundation-ctors.md) */
export const CTOR = {
  /** PeppSw (Common\Z23DIP\c_src\PeppSw.c line 0x24d): Pepper's mode switch, attached to PEPP first (gate var 0x5e, mask 0 / value 0) */
  PEPPSW: 0x727e84,
  /** the second class of the same file (line 0x39b): the balloon LOON of node 50 rises (update FUN_00727fe3) */
  LOON: 0x7281aa,
  /** the third class (line 0x479, update FUN_00728286 over an empty table): attached by no code of the executable (dead) */
  DEAD: 0x728333,
} as const;

/**
 * The sound handle globals of the wrapper's sound loader FUN_007267e0 and the sound ids they hold (the emulated loader gives the same: `IslandSetup.soundHandles`;
 * the node asks the context first and falls back to this table). `kind`: 3d = FUN_004433b0 (played with FUN_004433f0 at a position), 2d = FUN_00443580 (FUN_004435a0).
 */
export const SND = {
  /** DAT_05d5d13c = FUN_00443580(0x30c): the zone's 2D ambience, played every tick */
  AMBIENT: { addr: 0x5d5d13c, id: 0x30c, kind: '2d' },
  /** DAT_05d5d138 = FUN_004433b0(0x30d): the hall */
  HALL: { addr: 0x5d5d138, id: 0x30d, kind: '3d' },
  /** DAT_05d5d10c = FUN_004433b0(0x31d): the pterodactyl */
  PTER: { addr: 0x5d5d10c, id: 0x31d, kind: '3d' },
  /** DAT_05d5d108 = FUN_004433b0(0x315): REX4's position (node 50) */
  REX4: { addr: 0x5d5d108, id: 0x315, kind: '3d' },
  /** the step sounds of REX1 .. REX7 while their animation is in its first four frames (node 50): REX1 0x316, REX2 0x317, REX3 0x318, REX4 0x319, REX5 0x31a, REX6 0x31b, REX7 0x31c */
  STEP: [
    { addr: 0x5d5d12c, id: 0x316, kind: '3d' }, { addr: 0x5d5d134, id: 0x317, kind: '3d' }, { addr: 0x5d5d118, id: 0x318, kind: '3d' }, { addr: 0x5d5d11c, id: 0x319, kind: '3d' },
    { addr: 0x5d5d110, id: 0x31a, kind: '3d' }, { addr: 0x5d5d114, id: 0x31b, kind: '3d' }, { addr: 0x5d5d120, id: 0x31c, kind: '3d' },
  ],
  /** DAT_05d5d140 / DAT_05d5d144 = 0x321 / 0x322: the brontosaurus roars (one in 300 ticks each, at BRON) */
  BRON_A: { addr: 0x5d5d140, id: 0x321, kind: '3d' }, BRON_B: { addr: 0x5d5d144, id: 0x322, kind: '3d' },
  /** DAT_05d5d128 / 130 / 124 = 0x31e / 0x31f / 0x320: the random call of one of six creatures (one in 100 ticks) */
  CALL_A: { addr: 0x5d5d128, id: 0x31e, kind: '3d' }, CALL_B: { addr: 0x5d5d130, id: 0x31f, kind: '3d' }, CALL_C: { addr: 0x5d5d124, id: 0x320, kind: '3d' },
} as const;
export type SoundRef = { readonly addr: number; readonly id: number; readonly kind: string };

/** DAT_009da978 / DAT_009da940: getting on / off the skateboard (FUN_004b0f16's walk sound set, shared with the island) */
export const SND_BOARD_ON = 0x150, SND_BOARD_OFF = 0x106;

/** Pepper's mailbox values (DAT_008ae088) and clips that keep her off the board: 1, 2, 'W', 0x1f, '8' / 99, 0x62 */
export const NO_BOARD_MAILBOX: readonly number[] = [0x01, 0x02, 0x57, 0x1f, 0x38];
export const NO_BOARD_CLIPS: readonly number[] = [99, 0x62];
/** the clips (Pepper's animation id) that raise the music's activity level to 2 */
export const GROOVE2_CLIPS: readonly number[] = [0x24, 0x3f, 0x40];

/** the balloon (FUN_007281aa / FUN_00727fe3): constants 0x8928f4, 0x89286c, 0x892118, 0x8928f0, 0x89228c */
export const LOON = { LIFT: 17.600000381469727, TOP: 56.0, VMAX: 0.4000000059604645, ACCEL: 0.03200000151991844, DRIFT_FROM: 6.0 } as const;

/** FUN_00726610: the HUD's texture indices of the interaction icon (Overlays/z14OSD: the wrapper's FUN_007265c0 loads that set, not a z23DIP one) */
export const HUD = { OVERLAY: 'z14OSD', GEM_ICON: 0, ICON_ALT: 3, ICON_1: 2, ICON_1E: 1, BLINK_A: 4, BLINK_B: 5 } as const;
