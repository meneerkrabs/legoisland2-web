// z40OGL, the Ogel's island (index 27, z90OGL, story nodes 64 and 66): wrapper FUN_007e2321, GameLoop FUN_007e247f, per-frame HUD FUN_007e2ad0, set-up root FUN_007e4222 (-> FUN_007e3bd1).
// M5 hub module (docs/re/m5/z40OGL.md): the zone runs through the shared hub framework (src/hub: emulated set-up, HubContext, HubGame). What this folder adds:
//   * the HUD (hud.ts: FUN_007e2a80 / FUN_007e2ad0), the krystals (krystal.ts: the Overlay constructor 0x7e31fc, x9, FUN_007e2c9a), the wrapper's outfit / phase restore (FUN_00421bbe(5)),
//   * `peppswit/` (another worker): the seven PeppSwit constructors (Pepper's mode switch, the citizens, robots, slugs ...), imported at the end of this file.
// The set-up itself (FUN_007e3bd1 with FUN_007e7c56 / FUN_007e8308, FUN_007e39d9 + FUN_007e36dd, the sound loader FUN_007e3350, the cutscene slots FUN_007e3679) runs in the x86 emulation
// (src/formats/emusetup.ts, spec `z40ogl`): the story function has no loop handler (the loop calls FUN_007e2ad0 = the HUD only), nodes 64 and 66 differ in the set-up alone.
import { registerHub } from '../../hub/index.ts';
import type { HubGame } from '../../hub/index.ts';
import type { World } from '../../game/world.ts';
import type { Pe } from '../../formats/exe.ts';
import './krystal.ts';
import { ensureTwinkle } from './krystal.ts';
import { ZoneParticles } from '../../fx/particles/zone.ts';
import { hudFrame, hudInit, newHudState } from './hud.ts';
import type { OglHudState } from './hud.ts';

const HUD_KEY = 'oglHud';
const hudState = (h: HubGame) => h.ictx.hub[HUD_KEY] as OglHudState;

/** the hub's number for FUN_00421bbe / FUN_00421eb3 (FUN_00421b18: var 0x59 = 0x1b, the zone table index of z90OGL) */
export const OUTFIT_HUB = 5;
/** FUN_00421bbe's tables: DAT_008acdc0 (start, count per hub), DAT_008acdf0 (record index, +4 byte of the second column: the clamp value), DAT_008acb98 (phase table, stride 0x18) */
export const OUTFIT_TABLE = 0x8acdc0, OUTFIT_RECORDS = 0x8acdf0, PHASE_TABLE = 0x8acb98;

/**
 * FUN_00421bbe(5), run by the wrapper after the set-up: every record of the hub's outfit table gets the variant word `phase << 8 | 1 | outfit << 16` (record + 0x64) from the saved phase / outfit bytes
 * (DAT_009d9fd0 / DAT_009d9fd1 per table entry; a new game has zeros), the phase's own model words (the 0xbabababa "unchanged" markers of phase 0 / outfit 0) are not kept by the port.
 * `saved(i)` = [phase, outfit] of table entry i (default: a new game).
 */
export function restoreOutfits(world: World, pe: Pe, saved: (i: number) => [number, number] = () => [0, 0]) {
  const start = pe.u32(OUTFIT_TABLE + OUTFIT_HUB * 8) | 0, count = pe.u32(OUTFIT_TABLE + OUTFIT_HUB * 8 + 4) | 0;
  for (let i = start; i < start + count; i++) {
    let [phase, outfit] = saved(i);
    if ((pe.u32(PHASE_TABLE + phase * 0x18) | 0) < outfit) outfit = (pe.u32(OUTFIT_RECORDS + i * 8 + 4) >>> 8) & 0xff;   // the clamp: `DAT_008acdf5[i * 8]`
    const rec = world.records[pe.u32(OUTFIT_RECORDS + i * 8) | 0];
    if (rec) rec.variant = (phase << 8 | 1 | outfit << 16) >>> 0;
  }
}

registerHub({
  archive: 'z40OGL',
  // FUN_007e2a80 (run by the wrapper before the loop): the HUD's texture set and left icon; the state of the loop's blink counter
  onCreate(h: HubGame) {
    const st = newHudState();
    h.ictx.hub[HUD_KEY] = st;
    hudInit(h.ctx.hud, st);
    // FUN_00442900("z40OGL"): the zone's particle engine (own Particle/ folder); the krystals' TWINKLE01 emitter is created on it (FUN_0044e920 in the first Overlay constructor)
    if (!(h.ictx as { fx?: unknown }).fx) {
      ZoneParticles.create(h.ctx).then((fx) => { if (fx) { Object.assign(h.ictx, { fx }); ensureTwinkle(h.ctx.world); } }).catch((e) => console.warn('z40OGL particles', e));
    }
  },
  // FUN_007e2ad0: every pass of the GameLoop, in every mode
  frame(h: HubGame) { hudFrame(h.ctx.hud, h.ctx.vars, hudState(h), h.ctx.world.dt); },
  afterSetup({ ictx, world }) { restoreOutfits(world, ictx.pe); },
  debug(h: HubGame) { return { hud: { ...hudState(h), left: h.ctx.hud.leftText, centre: h.ctx.hud.centreText, slot: h.ctx.hud.column[0]?.tex } }; },
});

// the seven PeppSwit constructors (0x7e4f9c, 0x7e539e, 0x7e5ea7, 0x7e61e9, 0x7e6498, 0x7e69a2, 0x7e6bb2): worker 'ogl-peppswit' appends its import below
import './peppswit/index.ts';
