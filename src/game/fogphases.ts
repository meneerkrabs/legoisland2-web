// Which SetupFog call (FUN_00442d90) is in effect when (docs/re/rendering.md section 3.2, WP-RENDER R8). FUN_00442d90 stores the zone's fog and applies it at once, so the call that
// ran last wins. Every zone loop follows the same template (docs/re/architecture.md 2.3, FUN_005cd33d / FUN_005f418b / FUN_00706bee ... read one by one):
//   start:    the zone's set-up helpers run before the loop (a call in the helper, FUN_005ce27f ...); the fog of the first fade-in (mode 7) is the LAST of them;
//   play:     when the fade-in completes (mode 7, scene visibility >= 1) the loop calls SetupFog with the play values; they stay until the zone is left;
//   restart:  leaving with exit state 3 (restart) calls SetupFog with a black fog after the fade-out and re-runs the set-up helpers; the next fade-in shows that, then the play call again.
// So the play fog is the call of the loop's mode-7 case, which (for every zone below) is also the first call by address that `extractRenderParams` lists; only z40OGL's loop-less hub
// set-up function (FUN_007e3bd1) is different: its first call by address is the branch for 16-bit displays (`DAT_00987660 = (display depth == 16)`), the 32-bit call is the second.
// The three tables give the call addresses (`FogSetup.at`) per zone; a zone not listed keeps `fog[0]` for all three.
export interface FogPhases {
  /** the call in effect from the end of the first fade-in (every frame after it) */
  play: number;
  /** the call in effect while the zone fades in for the first time (the last set-up helper's); defaults to `play` */
  start?: number;
  /** the call in effect while it fades in again after a restart; defaults to `start` */
  restart?: number;
}
export const FOG_PHASES: Record<string, FogPhases> = {
  // mini-games: loop function (play, restart black) and set-up helper (start)
  z08BKD: { play: 0x5b880e, start: 0x5b9464, restart: 0x5b89c4 },            // FUN_005b8368 case 7 / restart, FUN_005b9430 (black, fog on)
  z09JST: { play: 0x5cd876, start: 0x5ce2cb, restart: 0x5cda31 },            // FUN_005cd33d, FUN_005ce27f
  z10RGB: { play: 0x5f4632, start: 0x5f6413, restart: 0x5f6413 },            // FUN_005f418b: FUN_005f690b (0x5f6961, = play) then FUN_005f6340 (800 / 800); the black call is followed by FUN_005f6340 again
  z17WAS: { play: 0x6996c3, start: 0x699cbc, restart: 0x699875 },            // FUN_00698efe, FUN_00699c4e
  z20DSP: { play: 0x6be4b6, start: 0x6bf970, restart: 0x6be63c },            // FUN_006bde34, FUN_006bf929
  z21FSH: { play: 0x6f3ab0, start: 0x6f46ab, restart: 0x6f3ca5 },            // FUN_006f3511, FUN_006f468d
  z22BIP: { play: 0x70757f, start: 0x70852f, restart: 0x7076fe },            // FUN_00706bee, FUN_00708457
  z28HAT: { play: 0x79160c, start: 0x792814, restart: 0x7917bd },            // FUN_00790fc0, FUN_007927b5
  // hubs: the set-up function's 32-bit call
  z40OGL: { play: 0x7e3c43 },                                               // FUN_007e3bd1
};

/** where the loop is: `loopMode` = the machine's mode (7 = fade-in), `playedYet` = a mode other than 7 was seen since the zone started, `restarted` = the shell left this zone with the restart exit (3) just before */
export interface FogState { loopMode: number | undefined; playedYet: boolean; restarted: boolean }
/**
 * The SetupFog call in effect: during the first fade-in (mode 7, before any other mode) the set-up helper's call (`start`) or, when the zone was entered again through the
 * restart exit, the restart call; from then on the play call. `calls` = the extracted SetupFog calls (`at` = call-site address); returns the entry to use, or undefined (no calls).
 */
export function pickFogCall<T extends { at: number }>(zone: string, calls: readonly T[] | undefined, st: FogState): { call: T | undefined; playedYet: boolean } {
  if (!calls || !calls.length) return { call: undefined, playedYet: st.playedYet };
  const ph = FOG_PHASES[zone];
  if (!ph) return { call: calls[0], playedYet: st.playedYet };
  const fadeIn = st.loopMode === 7 && !st.playedYet;
  const playedYet = st.playedYet || (st.loopMode !== undefined && st.loopMode !== 7);
  const at = fadeIn ? (st.restarted ? ph.restart ?? ph.start ?? ph.play : ph.start ?? ph.play) : ph.play;
  return { call: calls.find((f) => f.at === at) ?? calls[0], playedYet };
}
