// "pepswitc" of the Adventure Island (z13CAI): the hub's copy of the island's PepSwitc.c, constructor FUN_0061c2a4, handler table 0x912418 = { update FUN_0061c0e0, pre-render
// FUN_0061c1b9, destroy FUN_0061c33f, draw FUN_0061c205 (the default mesh draw), save FUN_0061c266 / FUN_0061c241 }. It sits on the vehicle record Pepper flies (PHEL = police
// helicopter for PORTAL_VEHICLE 0, RHEL for 1, PTER for 2: FUN_0051e4b0 in the set-up) with the gate (PEPPER_CONTROL, mask 0), before the vehicle's own node (SGHeli 0x4325e8 /
// the flying Ptera 0x4bb1a6), and it is NOT Pepper's mode switch: it
//   * update   (every tick, returns 2 = go on with the vehicle's node):
//       - while PEPPER_CONTROL & 1 (the helicopter landed and Pepper stepped off: SGHeli / Ptera set the control word to 1) var 5 (NEXT_SUBGAME) := 0xb: the loop sees it differ from
//         var 0x59 and leaves for the Oasis (story node 33's condition is "var 5 == 11" too);
//       - the 3D sound DAT_05d5bc1c (id 0x2f3, the volcano) at (-248.5, 130.4, -223.3) and the 2D sound DAT_05d5bc2c (0x2f5) are refreshed every tick;
//       - the gull cries: n = trunc(rand * 100): n >= 99 -> sound DAT_05d5bc3c (0x303), n == 98 -> DAT_05d5bc38 (0x302), both 3D at the position of the PTER record (24);
//   * pre-render: Enter (DAT_00983840 & 0x10000) changes the look of PHEL (record 50) when its variant word is 2 (FUN_00627b3f -> FUN_00420570(table 0x914bc8, 50) = the island's
//     look cycler FUN_00420404 over the hub's own one-entry roster), then every tick FUN_00420590 frees the roster's busy slot (src/island/vehicles/looks.ts, table passed in);
//   * destroy  stops the two ambience sounds and frees the roster's cycler (FUN_00420622).
// The constructor (FUN_0061c2a4 -> FUN_006277b9) also gives every record the variant word 0, PHEL 2, and creates PHEL's FX_Bricks effect (var 0xd2, eight brick models
// phel03 00 07 04 01 02 06 05 .txt): the port runs FUN_006277b9 in the emulation after the set-up (`constructRoster`) and the brick registrations land in the manager like the
// island's roster ones.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { tryCtx } from '../../island/ctx.ts';
import { rand } from '../../island/ambient/common.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { VehicleLooks, changeLook, tickLooks, looksOf, LOOKS_KEY, VARIANT_VEHICLE, ROSTER_STRIDE } from '../../island/vehicles/looks.ts';
import type { HubContext } from '../../hub/ctx.ts';

export const CTOR_PEPSWITC_CAI = 0x61c2a4;
/** FUN_0061c2a4's constructor tail (the roster of the hub) and the roster table `DAT_00914bc8` it fills (0x18 bytes per entry: record, record pointer, cycler, SwapText set, game variable, brick effect) */
export const FN_CAI_ROSTER = 0x6277b9, CAI_ROSTER_VA = 0x914bc8;
/** the record FUN_00627b3f changes (`DAT_00983804 + 0x14b4` = record 50's variant word, `FUN_00420570(table, 0x32)`): PHEL */
export const LOOK_RECORD = 0x32;
/** the sound handle globals the loader FUN_0061b000 fills (ids 0x2f3 3D, 0x2f5 2D, 0x302 3D, 0x303 3D; the helicopter's engine DAT_009daa4c is SGHeli's) */
export const SOUND_VAR = { VOLCANO: 0x5d5bc1c, LOOP: 0x5d5bc2c, GULL_A: 0x5d5bc38, GULL_B: 0x5d5bc3c } as const;
const SOUND_ID = { VOLCANO: 0x2f3, LOOP: 0x2f5, GULL_A: 0x302, GULL_B: 0x303 } as const;
/** the position of the volcano sound (locals 0xc3788000 / 0x43026666 / 0xc35f4ccd) */
const F = (u: number): number => new Float32Array(new Uint32Array([u]).buffer)[0];
const VOLCANO_POS: readonly [number, number, number] = [F(0xc3788000), F(0x43026666), F(0xc35f4ccd)];
/** the record whose position the gull cries use: `DAT_00983804 + 0x9fc` = record 24 (PTER) + 0x3c */
const GULL_RECORD = 24;
/** the second argument of FUN_00417597(5, 0xb): NEXT_SUBGAME := the Oasis */
const VAR_NEXT_SUBGAME = 5, ZONE_OASIS = 0xb;

const soundId = (w: World, which: keyof typeof SOUND_VAR): number => {
  const c = tryCtx(w) as unknown as Partial<HubContext> | undefined;
  const id = c?.soundOf?.(SOUND_VAR[which]) ?? -1;
  return id >= 0 ? id : SOUND_ID[which];
};

export class CaiPepSwitch implements BehaviourNode {
  readonly kind = 'pepswitc';
  var = 0x5e; mask = 0; value = 0;
  stamp = 0xfffffffe;

  /** FUN_0061c0e0 */
  update(w: World, _rec: GameRecord, _ctrl: Controller): number {
    void _rec; void _ctrl;
    const c = tryCtx(w);
    if ((w.vars.get(this.var) & 1) !== 0) w.vars.set(VAR_NEXT_SUBGAME, ZONE_OASIS);
    c?.sfxAt(soundId(w, 'VOLCANO'), VOLCANO_POS);
    c?.sfx(soundId(w, 'LOOP'));
    const n = Math.trunc(rand(100.0));                     // RNG: FUN_004388ae(100.0) -> __ftol
    const gull = w.records[GULL_RECORD];
    if (gull) {
      const pos: [number, number, number] = [gull.x, gull.y, gull.z];
      if (n >= 99) c?.sfxAt(soundId(w, 'GULL_B'), pos);
      else if (n >= 98) c?.sfxAt(soundId(w, 'GULL_A'), pos);
    }
    return NODE_CONTINUE;
  }

  /** FUN_0061c1b9 */
  prerender(w: World): void {
    if (!ensureCaiLooks(w)) return;
    if ((w.input.pressed & B.ENTER) !== 0) lookKey(w);            // FUN_00627b3f
    tickLooks(w);                                                 // FUN_00627ba5 -> FUN_00420590(table)
  }

  /** FUN_0061c33f: FUN_00627be0 (the roster's cycler), FUN_004434b0(DAT_05d5bc1c), FUN_004435b0(DAT_05d5bc2c) */
  destroy(w: World): void {
    const c = tryCtx(w);
    c?.stopSfx(soundId(w, 'VOLCANO'));
    c?.stopSfx(soundId(w, 'LOOP'));
  }
}

/** FUN_00627b3f: Enter changes PHEL's look while its variant word is 2 */
export function lookKey(w: World): void {
  const looks = looksOf(w);
  const rec = w.records[LOOK_RECORD];
  if (!looks || !rec) return;
  if (rec.variant === VARIANT_VEHICLE) changeLook(w, looks, rec);
}

/**
 * FUN_006277b9 at the set-up (the constructor tail of FUN_0061c2a4): every record gets the variant word 0 and the roster's record (PHEL) 2, the roster table `DAT_00914bc8` is filled
 * and PHEL's FX_Bricks effect is created (var 0xd2, eight brick models). The effect's registrations are made by RUNNING the original's function in the set-up emulation (`run`):
 * they become part of `setup.calls`, which the brick manager applies when it is created.
 */
export function constructRoster(w: World, run: (fn: number) => unknown): void {
  run(FN_CAI_ROSTER);
  for (const r of w.records) r.variant = 0;
  const w0 = w.records[LOOK_RECORD];
  if (w0) w0.variant = VARIANT_VEHICLE;
}

/** the look cycler of the roster (FUN_004202ef): built at the first pre-render, when the library of the brick effects is installed (the zone game does that after the set-up) */
export function ensureCaiLooks(w: World): VehicleLooks | null {
  const have = looksOf(w);
  if (have) return have;
  const c = tryCtx(w);
  if (!c?.setup) return null;
  const fx = islandBrickFx(w);
  const looks = new VehicleLooks(w, c.pe, (n) => {
    const h = c.setup.mem.u32(CAI_ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0;
    const s = fx?.setupSlots.get(h);
    return s === undefined ? NO_SLOT : s;
  }, CAI_ROSTER_VA);
  w.ext.set(LOOKS_KEY, looks);
  return looks;
}
