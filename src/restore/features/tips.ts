// Restored feature 'tips' (item 4 of docs/re/restore-plan.md, docs/re/restore.md): Darren's tips and his replaced lines on the island.
//
// ORIGINAL (game data / code reused):
//  * Darren is the SGMFIG record `DARR` (src/island/npc/sgmfig.ts). A talk says `<NAME>A` (+ `<NAME>B` when the table has it), the NEXT talk `<NAME>C` (+ `D`), then it starts over (`line` toggles; walking away resets
//    it). Darren's tables only have `DARRA` and `DARRC` (one line each): his "pair" is spread over two talks. The tables are `LI/Data/lifsm8/10/12/13/14/15.str` (bands of the story nodes 10..68); in those
//    six bands the shipped DARRA / DARRC are a TIP pair (speech `LEDTHT17/18, 25/26, 01/02, 19/20, 07/08, 09/10`). The speech table has 15 more tip pairs and 14 clips for the band's regular pair that
//    no table line points at: audio-only files (`sounds/speech/Data`), wired here through the orphan speech indices (overlay.ts).
//  * The choice goes through `IslandContext.say` (`restoreHooks.say`), the voice / text through the overlay tags below (an ordinary MessageTable).
// RECONSTRUCTION (invented, marked below):
//  * which orphan belongs to Darren: the REGULAR pair of a band is the clip pair that fills the numbering hole behind RICH in that band (`LEFMAA21` ... `LEGFAA24/25`, `LEGFBB24`);
//  * the subtitle texts (Whisper transcripts, lines.nl.ts; LEDTHT16 / 37 / 38 / 41 are in DOUBTFUL_LINES);
//  * the tag names `DARRT<nn>A/C` (tip) and `DARRR<band>A..D` (regular pair);
//  * the eligibility ranges (TIPS below: derived from which records the island's era set-ups enable, see the comments) and the rotation rule: per band a talk counter that advances with every talk that starts a pair (the second
//    talk, C, only happens when the NPC has an objective to point at); the pool of a node is [regular pair, the shipped tip, the eligible tips in id order]; the pair is `pool[counter % pool.length]`. No Math.random: the same visit order gives the same tips.
//  * Bands 1, 2, 4..7 (nodes 0..9) have no orphan pairs: Darren says what he says today.
import type { Feature } from '../feature.ts';
import type { MsgEntry, MessageTable } from '../../ui/strings.ts';
import { line, ORPHAN_NAMES } from '../overlay.ts';
import { captureIsland, storyNode } from '../islandenv.ts';

/** a Darren pair: A part(s) and C part(s) as orphan clip names; `null` = the shipped pair of the table */
export interface Pair { key: string; a: string[] | null; c: string[] | null; from: number; to: number; note: string }

/** the last node with a Darren table (lifsm15 stays up behind it) */
export const LAST_NODE = 68;
/** first node of the pool (the bands before it have no orphans) */
export const FIRST_NODE = 10;

/** RECONSTRUCTION: the 14 tip pairs of the 21 audio-only ones that point at something the player can try. Ranges are story nodes (inclusive), taken from the records the era set-ups enable (SPBT from node 10;
 *  SPD0 cars + JSKI + DNGY from node 30, PHEL + PCAR from 31, RHEL / bots BBR / BBG from era 3 = node 52 ...) and from the plan's proposal (docs/re/restore-plan.md item 4). 31/32 (dark corners) has no hook: held back. */
export const TIPS: readonly Pair[] = ([
  [3, 10, 'rabbits jump in the air (Shift near a bunny)'],
  [5, 10, "CD collection at home (Pepper's computer)"],
  [11, 30, 'car paint (Enter changes the look of a car: cars exist from node 30)'],
  [13, 10, 'film night (the computer, movies)'],
  [15, 10, 'island makeover (decor / outfits)'],
  [21, 33, 'far-away countries (after the first hub trips)'],
  [23, 52, 'rails and the Super station master (era 3)'],
  [27, 52, 'silver Brickbots dancing (era 3)'],
  [29, 10, 'general chat'],
  [33, 30, 'jump into a vehicle (cars from node 30)'],
  [35, 31, 'helicopter (PHEL from node 31)'],
  [37, 30, 'jet ski (JSKI from node 30)'],
  [39, 10, 'speedboat (SPBT from node 10)'],
  [41, 52, 'house party (era 3)'],
] as [number, number, string][]).map(([n, from, note]) => {
  const nn = (k: number) => String(k).padStart(2, '0');
  return { key: `T${nn(n)}`, a: [`LEDTHT${nn(n)}`], c: [`LEDTHT${nn(n + 1)}`], from, to: LAST_NODE, note };
});

/** the band of a table: the speech index of its shipped `DARRA` (speech table) -> the number of `lifsmN.str`; RECONSTRUCTION-free (game constants) */
export const BAND_OF_DARRA: ReadonlyMap<number, number> = new Map([[671, 8], [824, 10], [874, 12], [923, 13], [975, 14], [1031, 15]]);
/** the band's story nodes (the tables the story handler selects, `storyHandler`: probe tools/tests/restore-tips.mjs checks it) */
export const BAND_NODES: Readonly<Record<number, [number, number][]>> = {
  8: [[10, 29]], 10: [[30, 51]], 12: [[54, 55]], 13: [[52, 53], [56, 57]], 14: [[58, 61]], 15: [[62, 68]],
};
/** RECONSTRUCTION: the regular pair of each band (orphans filling the numbering hole behind RICH) */
export const REGULAR: Readonly<Record<number, Pair>> = {
  8: { key: 'R8', a: ['LEFMAA21'], c: ['LEFMBB21'], from: 10, to: 29, note: 'band 8' },
  10: { key: 'R10', a: ['LECCAA20'], c: ['LECCBB20'], from: 30, to: 51, note: 'band 10' },
  12: { key: 'R12', a: ['LERSAA21'], c: ['LERSBB23'], from: 54, to: 55, note: 'band 12' },
  13: { key: 'R13', a: ['LESBAA20'], c: ['LESBBB21'], from: 52, to: 57, note: 'band 13' },
  14: { key: 'R14', a: ['LESPAA22'], c: ['LESPBB22', 'LESPBB23'], from: 58, to: 61, note: 'band 14' },
  15: { key: 'R15', a: ['LEGFAA24', 'LEGFAA25'], c: ['LEGFBB24'], from: 62, to: 68, note: 'band 15' },
};
export const SHIPPED: Pair = { key: 'S', a: null, c: null, from: FIRST_NODE, to: LAST_NODE, note: 'the shipped tip pair of the table' };

const tag = (p: Pair, part: 'A' | 'C', i: number) => `DARR${p.key}${String.fromCharCode(part.charCodeAt(0) + i)}`;
/** the overlay entries of a pair: A (A, B) / C (C, D) */
function entries(p: Pair): MsgEntry[] {
  const out: MsgEntry[] = [];
  (p.a ?? []).forEach((n, i) => out.push(line(tag(p, 'A', i), n)));
  (p.c ?? []).forEach((n, i) => out.push(line(tag(p, 'C', i), n)));
  return out;
}
/** every orphan mp3 a pair uses (tests) */
export const clipsOf = (p: Pair): string[] => [...(p.a ?? []), ...(p.c ?? [])];

/** the pool of a band at a story node: [regular pair, the shipped tip, the eligible tips in id order]; empty before node 10 / without a band */
export function pool(band: number, node: number): Pair[] {
  if (!(band in REGULAR) || node < FIRST_NODE) return [];
  const n = Math.min(node, LAST_NODE);
  return [REGULAR[band], SHIPPED, ...TIPS.filter((t) => t.from <= n && n <= t.to)];
}
/** the band of a story node (null: no Darren table of the restored pool) */
export function bandOfNode(node: number): number | null {
  const n = Math.min(node, LAST_NODE);
  for (const [b, rs] of Object.entries(BAND_NODES)) if (rs.some(([a, z]) => a <= n && n <= z)) return +b;
  return null;
}
/** the pair of the `counter`-th finished pair of a band at `node` */
export function pickPair(band: number, node: number, counter: number): Pair | null {
  const p = pool(band, node);
  return p.length === 0 ? null : p[counter % p.length];
}

// ---- state (per page session; deterministic: nothing random)
const counters = new Map<number, number>();
let cur: { band: number; pair: Pair; started: boolean } | null = null;
export function resetTips() { counters.clear(); cur = null; }
export const talkCounter = (band: number) => counters.get(band) ?? 0;

type Speak = (table: MessageTable, id: string, id2?: string) => boolean;
function sayDarren(table: MessageTable, id: string, id2: string | undefined, speak: Speak): boolean | undefined {
  if (id !== 'DARRA' && id !== 'DARRC') return undefined;
  const band = BAND_OF_DARRA.get(table.voice('DARRA'));
  if (band === undefined) return undefined;            // bands 1, 2, 4..7: left alone
  if (id === 'DARRA') {
    // a new talk: the next pair of the band's rotation (a retry after a busy channel keeps its pair). The counter advances per talk that started a pair, NOT per finished pair: the second talk (C) only
    // happens when the NPC has an objective to point at (sgmfig.ts resets `line` otherwise), so it cannot drive the rotation.
    if (!(cur && cur.band === band && !cur.started)) {
      const node = storyNode() ?? BAND_NODES[band][0][0];
      const pair = pickPair(band, node, talkCounter(band));
      if (!pair) return undefined;
      cur = { band, pair, started: false };
    }
    const p = cur.pair;
    let ok: boolean;
    if (p.a === null) ok = speak(table, id, id2);        // the shipped tip: the original's own lines through the normal path
    else {
      const t0 = tag(p, 'A', 0), t1 = tag(p, 'A', 1);
      if (!table.has(t0)) return undefined;
      ok = speak(table, t0, p.a.length > 1 && table.has(t1) ? t1 : undefined);
    }
    if (ok) { cur.started = true; counters.set(band, talkCounter(band) + 1); }
    return ok;
  }
  // DARRC: the second talk of the pair that was started
  if (!cur || cur.band !== band || !cur.started) return undefined;
  const p = cur.pair;
  if (p.c === null) return speak(table, id, id2);
  const t0 = tag(p, 'C', 0), t1 = tag(p, 'C', 1);
  if (!table.has(t0)) return undefined;
  return speak(table, t0, p.c.length > 1 && table.has(t1) ? t1 : undefined);
}

/** the overlay of one band's file: every tip pair and the band's regular pair */
const bandEntries = (band: number): MsgEntry[] => [...TIPS.flatMap(entries), ...entries(REGULAR[band])];

export const feature: Feature = {
  id: 'tips',
  messages: Object.fromEntries(Object.keys(REGULAR).map((b) => [`LI/Data/lifsm${b}.str`, () => bandEntries(+b)])),
  say: (table, id, id2, speak) => sayDarren(table, id, id2, speak),
  islandStart: (g) => captureIsland(g),
};

/** every orphan this feature needs exists in the orphan list (tests) */
export const allClips = (): string[] => [...new Set([...TIPS.flatMap(clipsOf), ...Object.values(REGULAR).flatMap(clipsOf)])].filter((n) => ORPHAN_NAMES.includes(n));
