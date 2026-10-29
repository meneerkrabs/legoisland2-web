// Restored feature 'looks' (docs/re/restore-plan.md item 11, docs/re/restore.md): extra vehicle looks for Enter's "change the look" (src/island/vehicles/looks.ts).
//
// ORIGINAL: the SwapText bank has 16 textures that no look of the executable's swap table uses (4, 29, 30, 72, 107, 124, 126, 136-143) and `BrickMorph/policecar01.txt` is referenced by no roster
//   entry (the model list names 00 and 02-07). Looked at in the game, most of them are simply the models' OWN default paint (look 0 of a group is "no swap"): 29 / 30 = the jetski's yellow R.E.S.Q,
//   124 = the police car's black A emblem, 107 = the speedster's red panel, 4 = the ambulance's navy emblem; so they were never needed as looks. The ones that are real extras: 126 (the A emblem on
//   blue = the missing blue police car, with policecar01), 136 / 139-143 (police badges in the six emblem colours: the ambulance emblems are 64 x 64 like them), 72 (yellow stripes of the rescue helicopter). The game's own machinery is reused unchanged: a look is one record of the swap table (parts with a
//   texture list per mesh group), the cycler (`nextLook`), the game variable `part + variant * 256`, the brick effect (stage = variable modulo the number of models).
// RECONSTRUCTION: the PAIRING (which unused texture goes into which look, with which body colour and accessories) is invented: each new look is a copy of an existing look of the same vehicle in which
//   the colour textures are exchanged (the recipes below say which); the brick model of a new look is the model of the look it was copied from (the bricks morph in their colour, the final
//   texture swap shows the new paint), except the blue police car (policecar01). The new looks are appended behind the game's own, so a save with the option off keeps its meaning.
// The roster is built lazily by the game (`ensureLooks`, first pre-render); `islandTick` appends the looks as soon as it exists (once per world).
import type { World } from '../../game/world.ts';
import { looksOf } from '../../island/vehicles/looks.ts';
import type { LookRecord, VehicleLooks } from '../../island/vehicles/looks.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import type { Feature } from '../feature.ts';

/** a new look: copy of look `base` of the roster entry whose record is `rec`, texture ids replaced by `swap` pairs (all lists of all parts); `model` = the brick model file (default: the base look's) */
export interface Recipe { rec: number; base: number; swap: readonly (readonly [number, number])[]; model?: string; note: string }

/** record indices of the roster (the executable's table 0x8e9b28): ambulance, jetski, rescue helicopter, speedsters, police car */
export const REC = { AMBU: 166, JSKI: 171, RHEL: 170, SPD0: 167, SPD1: 168, SPD2: 169, PCAR: 173 } as const;

export const RECIPES: readonly Recipe[] = [
  // ambulance: the default paint (look 0) is the white van with the navy emblem 4 and a red lower band. New: the same white van with a blue band (the red look with swatch 7 -> white 0, emblem 22 -> 4)
  { rec: REC.AMBU, base: 6, swap: [[7, 0], [22, 4]], note: 'ambulance: white, blue band, navy emblem (texture 4)' },
  // ambulance with a police badge: the six colour looks (emblems 13 dark, 15 cream, 18 blue, 19 green, 21 orange, 22 red) with the badge of the same colour instead of the emblem (136 white, 139 cream,
  // 140 blue, 141 green, 142 orange, 143 red: 64 x 64 like the emblems)
  { rec: REC.AMBU, base: 2, swap: [[15, 139]], note: 'ambulance: cream, police badge (139)' },
  { rec: REC.AMBU, base: 3, swap: [[18, 140]], note: 'ambulance: blue, police badge (140)' },
  { rec: REC.AMBU, base: 4, swap: [[19, 141]], note: 'ambulance: green, police badge (141)' },
  { rec: REC.AMBU, base: 5, swap: [[21, 142]], note: 'ambulance: orange, police badge (142)' },
  { rec: REC.AMBU, base: 6, swap: [[22, 143]], note: 'ambulance: red, police badge (143)' },
  { rec: REC.AMBU, base: 1, swap: [[13, 136]], note: 'ambulance: dark, police badge (136)' },
  // jetski: 29 / 30 are the model's own default paint (look 0). The two attempts with 137 / 138 (R.E.S.Q on dark / cream, with a dark / cream band) were looked at and dropped: the dark
  // jetski is almost black against the water and the cream one a muddy tan, neither reads as a clean look.
  // rescue helicopter 72: yellow stripes: the cream look (stripes 73) with the yellow swatch 23
  { rec: REC.RHEL, base: 1, swap: [[14, 23], [73, 72]], note: 'rescue helicopter: yellow, yellow stripes (72)' },
  // police car: the default paint is the A emblem on black (124); 126 = the same on blue + policecar01, the blue brick model of the missing index 01: the red look (swatch 7, emblem 130,
  // lettering 101) with the blue swatch 6, the blue emblem and the white lettering (102)
  { rec: REC.PCAR, base: 3, swap: [[7, 6], [130, 126], [101, 102]], model: 'policecar01.txt', note: 'police car: blue, A emblem on blue (126), brick model policecar01' },
];

/** a look of the entry with `swap` applied to every texture list */
export function derive(base: LookRecord, swap: readonly (readonly [number, number])[]): LookRecord {
  const map = new Map(swap);
  return { variants: base.variants, parts: base.parts.map((p) => ({ n: p.n, list: p.list ? p.list.map((t) => map.get(t) ?? t) : null })) };
}

const KEY = 'restore.looks';

/** append the recipes' looks to the world's roster (idempotent); returns the number of looks added */
export function extendLooks(w: World, looks: VehicleLooks, recipes: readonly Recipe[] = RECIPES): number {
  if (w.ext.get(KEY)) return 0;
  w.ext.set(KEY, true);
  const fx = islandBrickFx(w);
  let added = 0;
  for (const r of recipes) {
    const e = looks.entries.find((x) => x.rec === r.rec);
    const base = e?.looks[r.base];
    if (!e || !base || !base.parts.some((p) => p.list)) continue;
    const n = e.looks.length;
    e.looks.push(derive(base, r.swap));
    // the brick effect: one more model (stage) per look: stage = variable modulo the number of models (src/fx/bricks/manager.ts)
    const s = fx?.slot(e.slot);
    if (fx && s && s.models.length === n && s.models.length < 16) {
      const file = r.model ?? s.models[r.base]?.file ?? s.models[0].file;
      if (fx.addModel(e.slot, file)) { s.vis[n] = s.vis[r.base]; s.fn[n] = n % 2 === 0 ? 10 : 11; s.params[n].set(s.params[r.base]); }
    }
    added++;
  }
  return added;
}

export const feature: Feature = {
  id: 'looks',
  islandTick(g) {
    const w = (g as { ctx: { world: World } }).ctx.world;
    const looks = looksOf(w);
    if (looks) extendLooks(w, looks);
  },
};
