// z07CSI, the castle island (zone table index 6, z90CAS; story nodes 15-17, 19-22, 24, 25, 27-29): wrapper FUN_00572780, GameLoop FUN_00572910, set-up FUN_00574d9c -> FUN_00573527,
// story handler FUN_00574e40, per-frame HUD FUN_00575ca0, teardown FUN_00574e10 (docs/re/m5/z07CSI.md).
// M5 hub module: the zone runs through the shared hub framework (src/hub: emulated set-up, HubContext, HubGame); this folder adds what the castle has of its own:
//   * the story handler (story.ts) and the loop's HUD (hud.ts);
//   * the hub's constructors (registerCtor by address): the goblets (goblet.ts), the rats (rat.ts) and Pepper's mode switch / the castle's control node, the castle's switch processor CSIFSM ...
//   * the set-up calls the emulation only logged (emitters, render modes).
// The Horse constructors (0x579178 / 0x579725 / 0x579948) are another worker's (./horse/**).
import { registerHub } from '../../hub/index.ts';
import type { HubGame } from '../../hub/game.ts';
import type { HubContext } from '../../hub/ctx.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { csiStory } from './story.ts';
import { CsiHud } from './hud.ts';
import { CTOR_GOBLET, gobletFactory, GobletNode } from './goblet.ts';
import { CTOR_RAT, ratFactory } from './rat.ts';
import { CTOR_CSIFSM, csifsmFactory, CsiFsmNode } from './csifsm.ts';
import { CTOR_CONTROL, CsiControl } from './control.ts';
import { constructCastleRoster, ensureCsiLooks, readHiddenList } from './looks.ts';
import { looksOf } from '../../island/vehicles/looks.ts';
import { tickIslandBrickFx } from '../../fx/bricks/island.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import './horse/index.ts';   // the horse (csi-horse worker): HORS 0x579178, the riders 0x579725, the saddles 0x579948 (registerCtor)

/** the zone game's state kept on the hub context (`HubContext.hub`) */
export interface CsiState { hud: CsiHud }
export const csiState = (ic: HubContext): CsiState => (ic.hub.csi ??= { hud: new CsiHud() } satisfies CsiState) as CsiState;

/**
 * After `setupZone` and the framework's world work (src/hub/game.ts): what the castle's own code adds. Exported for the node tests (tools/lib/m5-z07CSI-load.mjs).
 */
export function applyCsiSetup(ictx: HubContext, world: World, loaded: { pepper: GameRecord }) {
  // Pepper's chain as the original's set-up built it (Control, SGwalk, sgswim, skate, SGVehic, Horse): setupZone's stub guard and the island's mode switch (added because the zone has the swim node
  // but not a PepSwitc) do not exist in the original
  const c = loaded.pepper.ctrl;
  if (c) c.nodes = c.nodes.filter((n) => n.kind !== 'StubGuard' && n.kind !== 'PepSwitc');
  const mem = ictx.setup.mem, G = vehicles(world);
  // FUN_00573527: DAT_009daa7c = 0x44 (the board SKBD); DAT_009da9d4 = 0x6f / DAT_009da9f0 = 0x72 / DAT_009da9e4 = 1 / DAT_009da9e9 = 1: ONE boat dock (PATH node 0x6f, Pepper steps off to node 0x72); no helipads
  const board = mem.u32(0x9daa7c) | 0;
  if (board >= 0 && board < world.records.length) G.board = board;
  const n = mem.r8(0x9da9e9);
  const docks = [];
  for (let i = 0; i < n; i++) docks.push({ map: mem.r8(0x9da9e4 + i), node: mem.r16(0x9da9d4 + 2 * i), exit: mem.r16(0x9da9f0 + 2 * i) });
  G.useTables(docks, [], n, 0);   // (the set-up zeroes the first n dock words; the taken words are static process memory, `useTables`)
  // Control's constructor tail FUN_005b2a23 hides the hidden-list records (the horse set, decor templates, the board ...) when Pepper's chain is attached (0x573936), in the MIDDLE of the set-up; the
  // emulation hosts the attach and does not run constructors, and `setupZone` applies record flag writes in ADDRESS order. The original's final visibility of those records = the last flag write of the
  // set-up code made AFTER that attach (execution order: `EmuAttach.storeIndex`), else hidden. (HORS / the saddles are shown by 0x573cbf ... after it: they end visible on the stages that show them.)
  const ctl = ictx.setup.attaches.find((a) => a.ctor === CTOR_CONTROL && a.record === loaded.pepper.index);
  if (ctl) {
    const stores = ictx.setup.stores.slice(ctl.storeIndex);   // (before the tail run below appends its own)
    for (const i of readHiddenList(ictx.pe)) {
      const rec = world.records[i];
      if (!rec) continue;
      const last = stores.filter((s) => s.record === i && s.field === 0x60).pop();
      if (last && (last.value & 2)) rec.flags |= 2; else rec.flags &= ~2;
    }
  }
  // Control's constructor tail FUN_005b2a23: the variant words, the hidden decor templates, the roster's brick effects (run in the emulation)
  constructCastleRoster(world, ictx.pe, (fn) => ictx.setup.run(fn, []));
}

registerHub({
  archive: 'z07CSI',
  story: csiStory,
  ctors: [[CTOR_GOBLET, gobletFactory], [CTOR_RAT, ratFactory], [CTOR_CSIFSM, csifsmFactory], [CTOR_CONTROL, () => new CsiControl()]],
  bricks: true,   // FX_Bricks: the speedboat's look change morphs through the brick manager (looks.ts)
  afterSetup({ ictx, world, loaded }) { applyCsiSetup(ictx, world, loaded); },
  onCreate(h: HubGame) {
    const st = csiState(h.ictx);
    st.hud.init(h.ctx.hud);
    // the wrapper's FUN_00421bbe(1): the stored decor applied to the castle's records, and the roster's stored looks (FUN_004202ef): before the first frame
    ensureCsiLooks(h.ctx.world);
    // SwapText (FUN_004437d0 / FUN_004439f0): the look of the boats replaces the model's textures (island/vehicles/looks.ts, the cycler is the castle's roster)
    h.ctx.sh?.data?.archive('SwapText').then((arc) => {
      h.ctx.gr.swapArchive = arc;
      h.ctx.gr.swapTextures = (rec, lod) => looksOf(h.ctx.world)?.textures(rec, lod) ?? null;
    }).catch((e: unknown) => console.warn('z07CSI swaptext', e));
    // the constructors' emitters in the order the attaches ran: the first goblet creates the shared TWINKLE01.par
    const fx = h.ictx.fx;
    if (fx) {
      let twinkle = false;
      for (const rec of h.ctx.world.records) for (const n of rec.ctrl?.nodes ?? []) {
        if (n instanceof GobletNode && !twinkle) twinkle = n.startEmitter(fx, rec);
        else if (n instanceof CsiFsmNode) n.startEmitter(fx);
      }
      // (FUN_0044e8d0, `fx.finish()`, runs after the first tick's constructors: the island's `finishEmitters`, called by the framework's probe pass, starts the set-up's own emitters and the boat's plume first)
    }
  },
  // FUN_00572910 calls FUN_00575ca0 on every pass of the loop (any mode)
  frame(h: HubGame, mode: number) {
    csiState(h.ictx).hud.update(h.ctx.hud, h.ctx.vars, h.ctx.world.dt);
    // FX_Bricks: the effects are updated in the draw pass (FUN_00442930 -> FUN_00447de0): the speedboat's look change morphs through it
    if (mode === 2) tickIslandBrickFx(h.ctx.world);
  },
  debug(h: HubGame) { return { csi: { blink: csiState(h.ictx).hud.blink } }; },
});
