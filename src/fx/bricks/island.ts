// The island's FX_Bricks (docs/re/m4/wp9-bricks.md): one BrickFxManager per world, built on first use from the brick library the zone game installs
// (`installBrickLibrary`) and the registrations of the emulated set-up (the era sets FUN_004c0ce9 / 004c0471 / 004bfec3 / 004bf737 call FUN_00447cc0,
// 00447d20, 00447da0, 00447d70, 00447ed0, 00447f00: src/formats/emusetup.ts logs them with their parameter blocks). The LGI_FSM node ticks it
// (`tickIslandBrickFx`, the original updates it in the draw pass FUN_00442930 -> FUN_00447de0) and handles switch 0xfe (FUN_00447ef0); the renderer
// draws `manager.drawList()` (src/fx/bricks/draw.ts).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import type { BrickLibrary } from '../../formats/bricks.ts';
import { tryCtx } from '../../island/ctx.ts';
import { islandSoundHandles } from '../../island/ambient/common.ts';
import { BrickFxManager, NO_SLOT } from './manager.ts';
import type { Vec3 } from './sim.ts';

const LIB_KEY = 'brickLibrary', FX_KEY = 'brickFx';
/** FUN_004b4907 / the era sets: DAT_05d58304[k] = the building effects' slots, DAT_008d95f8 = their count + 1 (starts at 1) */
export const BUILDING_SLOTS = 0x05d58304, BUILDING_COUNT = 0x008d95f8;
/** the island set-up's FX_Bricks calls (emusetup host names) */
const FN = { INIT: 0x447cc0, REGISTER: 0x447d20, MODEL: 0x447da0, STAGE: 0x447d70, WAIT: 0x447ed0 } as const;

let randomFn: (() => number) | null = null;
/** tests: a deterministic source for FUN_004388ae (null = Math.random) */
export function setBrickRandom(f: (() => number) | null) { randomFn = f; }
/** FUN_004388ae(max) = rand() / 32767 * max */
export const brickRand = (max: number) => (max <= 0 ? 0 : Math.fround((randomFn ?? Math.random)() * max));

/** the zone game (and tests) install the brick library (`Bricks` + `BrickMorph` archives) before the first tick */
export function installBrickLibrary(w: World, lib: BrickLibrary) { w.ext.set(LIB_KEY, lib); w.ext.delete(FX_KEY); }

/** the world's manager (created on first use when a library is installed; the set-up's registrations are applied then) */
export function islandBrickFx(w: World): BrickFxManager | null {
  const have = w.ext.get(FX_KEY) as BrickFxManager | undefined;
  if (have) return have;
  const lib = w.ext.get(LIB_KEY) as BrickLibrary | undefined;
  if (!lib) return null;
  const ctx = tryCtx(w);
  const handles = islandSoundHandles(lib.pe);
  const fx = new BrickFxManager(lib, {
    vars: w.vars,
    sound(h: number, pos: Vec3 | null, stop?: boolean) {
      const id = handles.get(h)?.id;
      if (id === undefined) return;
      if (stop) ctx?.stopSfx(id); else if (pos) ctx?.sfxAt(id, pos);
    },
    rand: brickRand,
    eye: () => [w.camera.c[0], w.camera.c[1], w.camera.c[2]],
  });
  w.ext.set(FX_KEY, fx);
  if (ctx?.setup) applySetupRegistrations(w, fx, ctx.setup);
  return fx;
}

/** the era set's registrations, in call order (slot numbers as the emulation returned them, which are the manager's in the same order) */
export function applySetupRegistrations(w: World, fx: BrickFxManager, setup: IslandSetup) {
  const map = fx.setupSlots;
  // the era set's effects, then the vehicle roster FUN_0051c823 (PepSwitc's constructor, run when the era set builds Pepper's chain)
  for (const c of [...setup.calls, ...(setup.vehicleRoster ?? [])]) {
    const info = (c.info ?? {}) as Record<string, unknown>;
    if (c.fn === FN.REGISTER) {
      const rec = w.records[info.record as number];
      if (!rec) continue;
      map.set(info.slot as number, fx.register(rec, info.var as number));
    } else if (c.fn === FN.MODEL) {
      const s = map.get(info.slot as number);
      if (s !== undefined && s !== NO_SLOT && typeof info.file === 'string') fx.addModel(s, info.file);
    } else if (c.fn === FN.STAGE) {
      const s = map.get(info.slot as number);
      if (s !== undefined && s !== NO_SLOT) fx.setStageWords(s, info.stage as number, info.fn as number, info.params as number[], info.vis as number);
    } else if (c.fn === FN.WAIT) {
      const s = map.get(info.slot as number);
      if (s !== undefined && s !== NO_SLOT) fx.setWait(s, info.delay as number);
    }
  }
}

/** the emulated set-up's handle of building effect `k` of switch 0xfe (DAT_05d58304[k] for 0 < k < DAT_008d95f8), or -1 */
export function buildingSlot(setup: IslandSetup, k: number): number {
  const n = setup.mem.u32(BUILDING_COUNT) | 0;
  if (!(k > 0 && k < n)) return -1;
  return setup.mem.u32(BUILDING_SLOTS + 4 * k) | 0;
}

/** the per-tick update (FUN_00447de0 -> FUN_0044a180) */
export function tickIslandBrickFx(w: World) { islandBrickFx(w)?.update(w.dt); }

// ---- IslandCtx services of the zone game (src/zones/z02LGI/ctx.ts) and the test mock

/** Brikimal (FUN_004bd4a8): the parameter block of its four stages (locals of the constructor; 0xcccccccc where it leaves the stack fill) */
const FILL = new Float32Array(new Uint32Array([0xcccccccc]).buffer)[0];
export const BRIKIMAL_PARAMS = [0.8, 8.0, 0.3, 0.2, 0.5, 0.3, 0.2, 0.5, 0, 0, 0, FILL, FILL, FILL, FILL, FILL, FILL, FILL, FILL, FILL, 0, -1.0, 0, FILL];

/** IslandCtx.brickMorph: FUN_00447d20(rec, v) + FUN_00447da0 per file + FUN_00447d70(h, k, 10, params, 2) + FUN_00447e90(rec, 6) + FUN_00447e70(h, matrix) */
export function brickMorph(w: World, rec: GameRecord, v: number, files: readonly string[], matrix: Float32Array): { state(): number } | null {
  const fx = islandBrickFx(w);
  if (!fx) return null;
  const h = fx.register(rec, v);
  if (h === NO_SLOT) return null;
  for (const f of files) fx.addModel(h, f);
  for (let k = 0; k < files.length; k++) fx.setStage(h, k, 10, BRIKIMAL_PARAMS, 2);
  fx.burst(rec, 6);
  fx.setParent(h, matrix);
  return { state: () => fx.state(h) };
}
/** IslandCtx.brickBurst: FUN_00447e90(rec, kind) */
export function brickBurst(w: World, rec: GameRecord, kind: number) { islandBrickFx(w)?.burst(rec, kind); }
