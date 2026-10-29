// The decor model sets' era table: FUN_00420674 (no argument: the cheat's FUN_00420674(-1) and the island set-up's FUN_0051c800 push one that is never read).
// The sets are the rows of the table at 0x8acb98 (6 dwords each, ends with a row whose first dword is -1): +0 = the number of VARIANTS the set offers (the Enter cycles through
// them modulo this count: src/island/decor.ts), +4 = its entry list. FUN_00420674 rewrites +0 of every set from the era table at 0x8accd0 (5 dwords per set, one per era column 0..4; the
// column 4 of the data is also the full entry count of the set, and the original writes it as the count when BAATAT selects column 4: odd sets then offer all 64 variants instead of 44):
//   column  = story node (var 0x58): < 0xf -> 0, < 0x21 -> 1, < 0x40 -> 2, else 3, or 4 when DAT_009da5b4 (BAATAT, src/shell/cheats.ts `cheatState.baatat`) is set;
//   offset  = the trophy level of the four medal variables 0x49 / 0x90 / 0xb9 / 0x8f: 3 (default), 2 when all > 0, 1 when all > 1, 0 when all > 2; always 3 while the node is < 0x44;
//   set i's count = table[i][column], minus the offset for EVEN i when the column is 3 or 4.
// Verified on the original (tools/tests/m4-s-island.mjs: the code of FUN_00420674 on the x86 emulator, every node 0..0x60, trophies 0..3, both cheat states).
import type { Pe } from '../formats/exe.ts';

export const DECOR_SETS_VA = 0x8acb98, DECOR_SET_STRIDE = 0x18, DECOR_ERA_VA = 0x8accd0, DECOR_ERA_STRIDE = 0x14;
export const VAR_STORY_NODE = 0x58, TROPHY_VARS = [0x49, 0x90, 0xb9, 0x8f] as const;

/** the initial +0 of every set row (the executable's .data), the terminating -1 row included */
export function readDecorSetGroups(pe: Pe): number[] {
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const v = pe.u32(DECOR_SETS_VA + i * DECOR_SET_STRIDE) | 0;
    out.push(v);
    if (v === -1) break;
  }
  return out;
}

/** the era column FUN_00420674 picks */
export function decorEraColumn(node: number, baatat: boolean): number {
  return node < 0xf ? 0 : node < 0x21 ? 1 : node < 0x40 ? 2 : baatat ? 4 : 3;
}

/** the trophy offset (local_c) */
export function decorTrophyOffset(node: number, get: (v: number) => number): number {
  let c = 3;
  for (const level of [0, 1, 2]) if (TROPHY_VARS.every((v) => level < get(v))) c = 2 - level;
  if (node < 0x44) c = 3;
  return c;
}

/** FUN_00420674: rewrites `groups` (`readDecorSetGroups` plus the earlier rewrites: the loop stops at the first row that is -1 NOW, like the original's) */
export function applyDecorEra(pe: Pe, groups: number[], get: (v: number) => number, baatat: boolean): void {
  const node = get(VAR_STORY_NODE);
  const col = decorEraColumn(node, baatat);
  const off = decorTrophyOffset(node, get);
  for (let i = 0; i < groups.length && groups[i] !== -1; i++) {
    let v = pe.u32(DECOR_ERA_VA + col * 4 + i * DECOR_ERA_STRIDE) | 0;
    if ((i & 1) === 0 && (col === 3 || col === 4)) v -= off;
    groups[i] = v;
  }
}
