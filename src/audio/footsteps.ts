// Footstep / landing sound ids by polygon surface id (docs/re/formats.md "surface", FUN_0042b8e8 walking, FUN_0042a88f landing).
// `surface` is the id the collision code reports for the polygon under the player's feet.
export const SND_UI = {
  MENU_MOVE: [602, 603, 604, 605], // SND_MENU_MOVE1..4, played round-robin
  MENU_SELECT: 606, MENU_BACK: 607, MENU_ONOFF: 608,
} as const;

const WALK: Record<string, number[]> = {
  grass: [267, 268, 269, 270],
  road: [279, 280, 281, 282],
  sand: [288, 289, 291, 292],
  rock: [283, 285, 286, 287],
  gravel: [263, 264, 265, 266],
  plastic: [275, 276, 277, 278],
};
const LAND: Record<string, number> = { grass: 395, road: 391, sand: 392, rock: 396, gravel: 393, plastic: 394 };

function material(surface: number): string | null {
  switch (surface) {
    case 0: return 'grass';
    case 1: case 8: return 'road';
    case 3: return 'sand';
    case 4: return 'rock';
    case 6: return 'gravel';
    case 7: case 9: return 'plastic';
    default: return null; // 2, 5 (water), 10: silent
  }
}

/** The four SND_WALK_* variants of a surface (null = silent). Gameplay rotates through them. */
export function walkSounds(surface: number): number[] | null {
  const m = material(surface);
  return m ? WALK[m] : null;
}

/** SND_LAND_* of a surface (null = none; surface 9 lands silent although it walks like plastic). */
export function landSound(surface: number): number | null {
  if (surface === 9) return null;
  const m = material(surface);
  return m ? LAND[m] : null;
}
