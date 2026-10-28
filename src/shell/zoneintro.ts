// Intro brief and controls help of every mini-game zone, read off the zone loops of the executable (docs/re/m3/ui.md). Each loop has the template of
// docs/re/architecture.md 2.3: mode 1 (intro) draws the panel FUN_00460a3d(0x16, 0x14, 0) with the brief (FUN_00439c6f(zone table, font main, id, 1, 0, 0x140,
// y, wrap) in the loop or a helper) and waits for a button, mode 9 calls FUN_00461155(zone table, n) every frame (help of n `CONTROLn` lines), zone BRP has a
// second help (mode 10). The brief is spoken at the start of the loop (FUN_00439bf8 + FUN_00435a11 before the mode loop, or in mode 0 / 1).
// The values live in the code of the executable (immediates of the calls), so they are written here with their address; `tools/tests/m3-ui.mjs` checks that
// every id exists in the zone's `.str` and that `CONTROL(n-1)` exists.
export interface IntroLine {
  /** message id of the zone table */
  id: string;
  /** y of FUN_00439c6f (640x480 grid, x is always 0x140 = 320) */
  y: number;
  /** wrap width in characters (0x1e = 30 unless noted) */
  wrap: number;
}
export interface ZoneIntro {
  /** the one-line brief of mode 1 (the first of `lines`); null: the zone has no text brief */
  introId: string | null;
  /** all text lines of the intro panel, in drawing order */
  lines: IntroLine[];
  /** ids spoken when the loop starts (FUN_00435a11(a, b)); defaults to the ids of `lines` */
  speech?: string[];
  /** number of `CONTROLn` lines of the mode 9 help: the second argument of FUN_00461155; 0 = the zone has no help screen */
  helpControls: number;
  /** the second help of mode 10 (z42BRP only: the table of the second phase, `BRP2.str`) */
  help2?: number;
}

const L = (id: string, y: number, wrap = 30): IntroLine => ({ id, y, wrap });
/** key = archive name of the zone (`ZoneInfo.archive`) */
export const ZONE_INTRO: Readonly<Record<string, ZoneIntro>> = {
  // brief: FUN_00465d39 0x465fef (LESGPT01, 0x140, 0x78); speech 0x465ef3; help 0x46698a (6)
  z38PAR: { introId: 'LESGPT01', lines: [L('LESGPT01', 0x78)], helpControls: 6 },
  // brief: 0x56926a (LESGWB11, y 0x64); speech 0x569151; help 0x569981 (4)
  z05WAB: { introId: 'LESGWB11', lines: [L('LESGWB11', 0x64)], helpControls: 4 },
  // brief: helper FUN_005b7ef5 (CASGBD13 y 0x32, CASGBD14 y 200; both spoken in mode 1: 0x5b85d0 / 0x5b85e9); help 0x5b8891 (5)
  z08BKD: { introId: 'CASGBD13', lines: [L('CASGBD13', 0x32), L('CASGBD14', 200)], speech: ['CASGBD13', 'CASGBD14'], helpControls: 5 },
  // brief: 0x5cd543 (CASGJO13, y 0xa0); speech 0x5cd423; help 0x5cd8fe (7)
  z09JST: { introId: 'CASGJO13', lines: [L('CASGJO13', 0xa0)], helpControls: 7 },
  // brief: helper FUN_005f7872 (HOLOA y 200); speech 0x5f4440; help 0x5f46b4 (0xb)
  z10RGB: { introId: 'HOLOA', lines: [L('HOLOA', 200)], helpControls: 0xb },
  // brief: 0x6567de (ADSGSS14, y 0x78); speech 0x6566b3; help 0x657252 (5); leaving the help speaks ADSGSS07 (0x657234)
  z15SSH: { introId: 'ADSGSS14', lines: [L('ADSGSS14', 0x78)], helpControls: 5 },
  // brief: 0x6990c6 (ADSGWS06, y 200, wrap 0x1c); speech 0x698fb8; help 0x699742 (5; CONTROL4 has no button token: drawn raw)
  z17WAS: { introId: 'ADSGWS06', lines: [L('ADSGWS06', 200, 0x1c)], helpControls: 5 },
  // brief: helper FUN_006a2314 (ADSGMM18 y 0x64); speech 0x6a2ae6; help 0x6a2ed2 (5)
  z18MMP: { introId: 'ADSGMM18', lines: [L('ADSGMM18', 0x64)], helpControls: 5 },
  // brief: helper FUN_006bd302 (ADSGDS12 y 0x50); speech 0x6bdf31; help 0x6be1a0 (5)
  z20DSP: { introId: 'ADSGDS12', lines: [L('ADSGDS12', 0x50)], helpControls: 5 },
  // brief: 0x6f3744 (ADSGFI14 y 0x50), speech 0x6f375c; help 0x6f3b32 (4; the table has a fifth line CONTROL4 that is never shown)
  z21FSH: { introId: 'ADSGFI14', lines: [L('ADSGFI14', 0x50)], helpControls: 4 },
  // brief: 0x706de2 (ADSGBI15 y 0x50); speech 0x706c9b; help 0x7071e4 (5)
  z22BIP: { introId: 'ADSGBI15', lines: [L('ADSGBI15', 0x50)], helpControls: 5 },
  // brief: helper FUN_0076537d (ADSGTR12 y 0x78); speech 0x7657ef; help 0x765e2a (6)
  z27TRX: { introId: 'ADSGTR12', lines: [L('ADSGTR12', 0x78)], helpControls: 6 },
  // brief: 0x791287 (ADSGMC19 y 0x78); speech 0x7912a0; help 0x79168a (5)
  z28HAT: { introId: 'ADSGMC19', lines: [L('ADSGMC19', 0x78)], helpControls: 5 },
  // brief: helper FUN_007afff6 (LESGCE01 y 0x78); speech 0x7b0048; help 0x7af595 (4)
  z36CNT: { introId: 'LESGCE01', lines: [L('LESGCE01', 0x78)], helpControls: 4 },
  // brief: helper FUN_007b60e8 (OGSGAB13 y 200); speech 0x7b66b5; help 0x7b69e5 (4)
  z39ASB: { introId: 'OGSGAB13', lines: [L('OGSGAB13', 200)], helpControls: 4 },
  // brief: 0x7cfb10 (OGSGPO12 y 0x78; after the opening cutscene of mode 1); speech 0x7cfad1; help 0x7d0579 (6)
  z40aPO: { introId: 'OGSGPO12', lines: [L('OGSGPO12', 0x78)], helpControls: 6 },
  // brief: 0x811cf2 (OGSGMP14 y 0x78); speech 0x811d13; help 0x8120a4 (7)
  z41MAP: { introId: 'OGSGMP14', lines: [L('OGSGMP14', 0x78)], helpControls: 7 },
  // brief: 0x82017b (OGSGBP34 y 100, wrap 0x20); speech 0x82019d; help 0x8208c3 (3, BRP.str), second help (mode 10) 0x8208f6 (5, BRP2.str)
  z42BRP: { introId: 'OGSGBP34', lines: [L('OGSGBP34', 100, 0x20)], helpControls: 3, help2: 5 },
  // brief: helper FUN_0048d390 (BPK2 y 0x3c); the skate park loop (0x48d8bd) never calls FUN_00461155: no help screen (the table has CONTROL0..5 but nothing draws them)
  z01BPK: { introId: 'BPK2', lines: [L('BPK2', 0x3c)], helpControls: 0 },
};

/** the zone's intro entry (case-insensitive archive name) */
export function zoneIntroFor(archive: string): ZoneIntro | undefined {
  const k = Object.keys(ZONE_INTRO).find((n) => n.toLowerCase() === archive.toLowerCase());
  return k ? ZONE_INTRO[k] : undefined;
}
