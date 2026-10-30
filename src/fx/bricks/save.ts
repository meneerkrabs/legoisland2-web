// The brick effect slots of the save game: FUN_00447c90 / FUN_00449a10 (writer) and FUN_00447ca0 / FUN_00449be0 (loader), docs/re/save.md. The writer visits the 64 slots of the FX_Bricks manager
// (DAT_05cb58cc, 0x1730 bytes each) and writes, per slot, ONE byte 0 (slot not in use) or the 0x16aa byte image below; the loader rebuilds every slot from its image (`BrickFxManager.restoreSlot`).
//
//   image  slot (0x1730)   field
//   +0x00  +0x1710         1 = in use
//   +0x01  *(+0x1704)      the record's tag (its first dword = 4 name characters); the loader finds the record again with FUN_0045d5c0 (the first record whose 4 bytes match, strncmp)
//   +0x05  +0x1712         16 function ids, one byte per stage (FUN_00449fe0 stores them; 0 where no stage was set)
//   +0x15  +0x1708         state (0 set up, 1 running, 2 done, 3 waiting)
//   +0x19  +0x1722         a morph is running
//   +0x1a  +0x170c         the game variable index (the stage is `variable % number of models`)
//   +0x1e  +0x1724         one-shot (a burst: no stage step)
//   +0x1f  +0x1728         time of the morph (float32, seconds in ticks of DAT_008b1718)
//   +0x23  +0x000          16 dwords: the record's visibility after a morph into each stage (0 hide, 1 show, 2 leave it, keep drawing the bricks)
//   +0x63  +0x1726         the stage callback has been played
//   +0x64  +0x080          16 x 0x60 bytes: the stage parameter blocks (24 words each, floats and ints mixed)
//   +0x664 +0x1727         the current stage
//   +0x665 +0x172c         the wait after the morph (float32 seconds, used up once)
//   +0x669 +0x1723         the number of models
//   +0x66a +0x680          16 x 0x104 bytes: the model descriptors (the path FUN_00447da0 built, NUL terminated, the rest zero)
//
// Not stored, so it comes back as the loader's zeroed slot: the sound handle +0x1700 (0), the +0x1711 flag of FUN_00449ec0 (0), the swap flag +0x1725 (0), the callback table +0x40 (rebuilt from
// the function ids by FUN_00449f50: EVERY stage gets one, also those that were never set; the original's own slot had none there), the model pointers +0x16c0 (rebuilt from the descriptors).
// What the image cannot say is not guessed: a record tag without a record (the original would crash on the null record) leaves the slot unused; the manager's own slot count
// DAT_05cb58c8 is not touched by the loader (the port has none).
import type { World } from '../../game/world.ts';
import { registerSavePart } from '../../shell/saveparts.ts';
import { tagOf } from '../../shell/saveworld.ts';
import type { BrickFxSlot, SlotImage } from './manager.ts';
import { MAX_SLOTS, MAX_MODELS, DESC_SIZE, BRICK_DATA_ROOT, setBrickDataRoot } from './manager.ts';
import { islandBrickFx } from './island.ts';

export const SLOT_IMAGE_BYTES = 0x16aa;
export const IMG = { FLAG: 0, TAG: 1, FN: 5, STATE: 0x15, RUNNING: 0x19, VAR: 0x1a, ONESHOT: 0x1e, TIME: 0x1f, VIS: 0x23, STARTED: 0x63, PARAMS: 0x64, STAGE: 0x664, WAIT: 0x665, COUNT: 0x669, DESC: 0x66a } as const;

/** FUN_00449a10 for one slot in use: the 0x16aa byte image */
export function slotImage(s: BrickFxSlot): Uint8Array {
  const out = new Uint8Array(SLOT_IMAGE_BYTES), dv = new DataView(out.buffer);
  out[IMG.FLAG] = 1;
  dv.setUint32(IMG.TAG, tagOf(s.record.name), true);
  for (let k = 0; k < MAX_MODELS; k++) out[IMG.FN + k] = (s.fn[k] ?? 0) & 0xff;
  dv.setInt32(IMG.STATE, s.state, true);
  out[IMG.RUNNING] = s.running ? 1 : 0;
  dv.setInt32(IMG.VAR, s.v, true);
  out[IMG.ONESHOT] = s.oneShot ? 1 : 0;
  dv.setFloat32(IMG.TIME, s.time, true);
  for (let k = 0; k < MAX_MODELS; k++) dv.setInt32(IMG.VIS + 4 * k, s.vis[k], true);
  out[IMG.STARTED] = s.started ? 1 : 0;
  for (let k = 0; k < MAX_MODELS; k++) for (let j = 0; j < 24; j++) dv.setInt32(IMG.PARAMS + 0x60 * k + 4 * j, s.iparams[k][j], true);
  out[IMG.STAGE] = s.stage & 0xff;
  dv.setFloat32(IMG.WAIT, s.wait, true);
  out[IMG.COUNT] = s.models.length;
  out.set(s.desc, IMG.DESC);
  return out;
}

/** the fields FUN_00449be0 reads out of an image */
export function decodeSlotImage(img: Uint8Array): SlotImage {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const vis = new Int32Array(MAX_MODELS), params = new Int32Array(MAX_MODELS * 24);
  for (let k = 0; k < MAX_MODELS; k++) vis[k] = dv.getInt32(IMG.VIS + 4 * k, true);
  for (let k = 0; k < MAX_MODELS * 24; k++) params[k] = dv.getInt32(IMG.PARAMS + 4 * k, true);
  return {
    v: dv.getInt32(IMG.VAR, true), fn: img.slice(IMG.FN, IMG.FN + MAX_MODELS), state: dv.getInt32(IMG.STATE, true),
    running: img[IMG.RUNNING], oneShot: img[IMG.ONESHOT], started: img[IMG.STARTED],
    time: dv.getFloat32(IMG.TIME, true), wait: dv.getFloat32(IMG.WAIT, true), vis, params,
    stage: img[IMG.STAGE], count: img[IMG.COUNT], desc: img.slice(IMG.DESC, IMG.DESC + MAX_MODELS * DESC_SIZE),
  };
}

/** FUN_00449a10: 64 entries, null = the slot is not in use (the original writes a single 0 byte for it) */
export function captureBricks(w: World): (Uint8Array | null)[] {
  const fx = islandBrickFx(w);
  const out: (Uint8Array | null)[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) { const s = fx?.slots[i]; out.push(s ? slotImage(s) : null); }
  return out;
}

/** FUN_0045d5c0: the first record whose first 4 bytes equal `tag` (strncmp: a NUL ends the comparison) */
function recordOfTag4(w: World, tag: number) {
  for (const r of w.records) {
    const t = tagOf(r.name);
    let same = true;
    for (let k = 0; k < 4; k++) {
      const a = (tag >>> (8 * k)) & 0xff, b = (t >>> (8 * k)) & 0xff;
      if (a !== b) { same = false; break; }
      if (a === 0) break;
    }
    if (same) return r;
  }
  return null;
}

/**
 * The model descriptors of a slot image hold the absolute path of the player's install (`<exe folder>_Data\\brickmorph\\<file>`): a file that came from the original game tells which folder that is; the port's own saves then carry it
 * too (the original loads the models by that path), instead of the installer's default folder.
 */
function learnBrickRoot(slots: readonly (Uint8Array | null)[]): void {
  for (const img of slots) {
    if (!img || img[IMG.FLAG] === 0) continue;
    const d = decodeSlotImage(img).desc;
    for (let m = 0; m < 16; m++) {
      let end = 0; while (end < 0x104 && d[m * 0x104 + end] !== 0) end++;
      if (end === 0) continue;
      const path = String.fromCharCode(...d.subarray(m * 0x104, m * 0x104 + end));
      const k = path.toLowerCase().lastIndexOf('brickmorph\\');
      if (k > 1 && path[k - 1] === '\\') { const root = path.slice(0, k - 1); if (root !== BRICK_DATA_ROOT) setBrickDataRoot(root); return; }
    }
  }
}

/** FUN_00449be0: every slot is set from its image (an unused image clears the slot, a used one rebuilds it and lets it continue from the saved moment) */
export function applyBricks(w: World, slots: readonly (Uint8Array | null)[]): void {
  learnBrickRoot(slots);
  const fx = islandBrickFx(w);
  if (!fx) return;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const img = slots[i];
    if (!img || img[IMG.FLAG] === 0) { fx.slots[i] = null; continue; }
    const rec = recordOfTag4(w, new DataView(img.buffer, img.byteOffset, img.byteLength).getUint32(IMG.TAG, true));
    if (!rec) { fx.slots[i] = null; continue; }
    fx.restoreSlot(i, rec, decodeSlotImage(img));
  }
}

registerSavePart('bricks', { capture: captureBricks, apply: applyBricks });
