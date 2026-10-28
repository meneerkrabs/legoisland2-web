// FUN_00423bf0: the island totals of the story code ("SGSetup" style helper the house loop calls right after FUN_0041b40e, and the hub loops call as well):
// sums the per-mini-game high scores into the island scores / high scores and derives the four island trophies from them. Pure (game variables only).
// docs/re/architecture.md 3.6 lists the thresholds; this is the function itself (LE2.c, 0x423bf0), ported 1:1 with the variable indices of `gamevars.tsv`.
export interface VarAccess { get(i: number): number; set(i: number, v: number): void }

/** game variable indices used by FUN_00423bf0 (names of tools/gamevars.tsv, without the SWITCH_GME_ prefix) */
export const IV = {
  HISCORE_JST: 0x18, HISCORE_RGB: 0x3b, HISCORE_BKD: 0x2f, SCORE_CSI_SUBGAMES: 0x2d, SCORE_CSI: 0xaf, HISCORE_CSI: 0xce, TROPHY_CSI: 0x90,
  HISCORE_SSH: 0x4b, HISCORE_WAS: 0xc8, HISCORE_MMP: 0x14, HISCORE_DSP: 0x1e, HISCORE_FSH: 0x38, HISCORE_BIP: 0x27, HISCORE_TRX: 0x87, HISCORE_HAT: 0x4a,
  SCORE_ADV_SUBGAMES: 0xa0, SCORE_ADV: 0xca, HISCORE_CAI: 0x17, TROPHY_ADV: 0xb9,
  HISCORE_APO: 0x2c, HISCORE_ASB: 0x29, HISCORE_MAP: 0xda, HISCORE_BRP: 0x96, SCORE_OGL_SUBGAMES: 0x9c, SCORE_OGL: 0xc7, HISCORE_OGL: 0x25, TROPHY_OGL: 0x8f,
  HISCORE_WAB: 0x20, HISCORE_CNT: 0x9b, HISCORE_PAR: 0xaa, HISCORE_BPK: 0xc0, SCORE_LGI_SUBGAMES: 0xb8, SCORE_LGI: 0xa6, HISCORE_LGI: 0x12, TROPHY_LGI: 0x49,
} as const;

/** island trophy from the island's high score: `< silver` -> bronze (1) / none (0), `< gold` -> silver, else gold; the thresholds are the immediates of the compares */
export function islandTrophy(score: number, silver: number, gold: number): number {
  return score < gold ? (score < silver ? (score < 1 ? 0 : 1) : 2) : 3;
}

/** thresholds (silver, gold) per island: CSI 0x7531 / 0x88b9 (30001 / 35001), ADV 0xea61 / 0x11171 (60001 / 70001), OGL 0x88b9 / 0xa411 (35001 / 42001), LGI 0xb799 / 0xd6d9 (47001 / 55001) */
export const ISLAND_THRESHOLDS = { CSI: [0x7531, 0x88b9], ADV: [0xea61, 0x11171], OGL: [0x88b9, 0xa411], LGI: [0xb799, 0xd6d9] } as const;

/** FUN_00423bf0 */
export function computeIslandTotals(v: VarAccess): void {
  // Castle island: JST + RGB + BKD
  let t = v.get(IV.HISCORE_JST) + v.get(IV.HISCORE_RGB) + v.get(IV.HISCORE_BKD);
  v.set(IV.SCORE_CSI_SUBGAMES, t);
  t += v.get(IV.SCORE_CSI);
  v.set(IV.HISCORE_CSI, t);
  v.set(IV.TROPHY_CSI, islandTrophy(t, ...ISLAND_THRESHOLDS.CSI));
  // Adventurers' island: SSH + WAS + MMP + DSP + FSH + BIP + TRX + HAT
  t = v.get(IV.HISCORE_SSH) + v.get(IV.HISCORE_WAS) + v.get(IV.HISCORE_MMP) + v.get(IV.HISCORE_DSP) + v.get(IV.HISCORE_FSH) + v.get(IV.HISCORE_BIP) + v.get(IV.HISCORE_TRX) + v.get(IV.HISCORE_HAT);
  v.set(IV.SCORE_ADV_SUBGAMES, t);
  t += v.get(IV.SCORE_ADV);
  v.set(IV.HISCORE_CAI, t);
  v.set(IV.TROPHY_ADV, islandTrophy(t, ...ISLAND_THRESHOLDS.ADV));
  // Ogel island: APO + ASB + MAP + BRP
  t = v.get(IV.HISCORE_APO) + v.get(IV.HISCORE_ASB) + v.get(IV.HISCORE_MAP) + v.get(IV.HISCORE_BRP);
  v.set(IV.SCORE_OGL_SUBGAMES, t);
  t += v.get(IV.SCORE_OGL);
  v.set(IV.HISCORE_OGL, t);
  v.set(IV.TROPHY_OGL, islandTrophy(t, ...ISLAND_THRESHOLDS.OGL));
  // LEGO island: WAB + CNT + PAR + BPK
  t = v.get(IV.HISCORE_WAB) + v.get(IV.HISCORE_CNT) + v.get(IV.HISCORE_PAR) + v.get(IV.HISCORE_BPK);
  v.set(IV.SCORE_LGI_SUBGAMES, t);
  t += v.get(IV.SCORE_LGI);
  v.set(IV.HISCORE_LGI, t);
  v.set(IV.TROPHY_LGI, islandTrophy(t, ...ISLAND_THRESHOLDS.LGI));
}
