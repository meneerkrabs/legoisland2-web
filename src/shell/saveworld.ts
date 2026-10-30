// The world's part of the save game: what FUN_00418ec7 writes from the live records and what FUN_00419e82 puts back (docs/re/shell-m2.md section 3, docs/re/save.md).
//   object records   every record with an animation instance: [tag][clip][frame f32][0xd0dd00d] (FUN_0043b72b / FUN_0043b73f; restored with FUN_0043b6a3)
//   entity records   every record with a controller that has nodes: [tag][pos 12][euler 12][flags u16], then per node of the controller's list [node +8 u32] and, when the node's vtable has a
//                    serializer (+0x14), [size][bytes][0xb0bb00b], then 0xd0dd00d
// The tag of a record is its first dword (4 characters of the name); the reader finds the FIRST record of that name (FUN_00419a79), so records that share a name are all restored from the
// last saved one of them (the original's behaviour, kept). The reader walks the LIVE node list of the loaded zone (the file does not say which node has a payload), `applyEntitySection`
// does the same on the port's nodes.
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import type { BehaviourNode } from '../game/controller.ts';
import { eulerRotation } from '../zones/exact.ts';
import { M, CAMERA_BYTES, DECOR_BYTES } from './save.ts';
import type { EntityRecord, ObjectRecord, SaveGame, NewSaveOptions } from './save.ts';
import { saveParts } from './saveparts.ts';

/** the first dword of a record: 4 characters of its name (a shorter name is padded with 0 like the record array of the original) */
export function tagOf(name: string): number {
  let t = 0;
  for (let k = 0; k < 4; k++) t |= (k < name.length ? name.charCodeAt(k) & 0xff : 0) << (8 * k);
  return t >>> 0;
}

/** FUN_00419a79: the first record whose 4 name bytes equal the tag (a tag whose first byte is 0 matches nothing) */
export function recordOfTag(w: World, tag: number): GameRecord | null {
  if ((tag & 0xff) === 0) return null;
  for (const r of w.records) if (tagOf(r.name) === tag) return r;
  return null;
}

/** the nodes of a record that belong to the original's controller list (the set-up attached them by a constructor address; port-only helper nodes such as the walk stub have none) */
export const listedNodes = (rec: GameRecord): BehaviourNode[] => (rec.ctrl?.nodes ?? []).filter((n) => n.ctor !== undefined);

// ---------------------------------------------------------------------------------------------------------------------------------- object records

/** FUN_00418ec7, the first loop: every record that has an animation instance (+8 != 0) */
export function captureObjects(w: World): ObjectRecord[] {
  const out: ObjectRecord[] = [];
  for (const r of w.records) if (r.anim) out.push({ tag: tagOf(r.name), animState: r.anim.clip, animFrame: Math.fround(r.anim.frame) });
  return out;
}

/**
 * FUN_00419e82, the object loop: the record found by the tag (first match) that has an instance gets FUN_0043b6a3(instance, clip, frame). A tag without such a record goes to FUN_00419b17, whose
 * result 1 (a marker was found: always, the file ends with one) makes the reader return 0: the load STOPS there (false), the sections after the objects are not applied. FUN_0043b6a3 refuses a
 * clip outside the rig and a frame outside 0 .. the clip's frame count (the instance keeps its values) without stopping.
 */
export function applyObjects(w: World, objects: readonly ObjectRecord[]): boolean {
  for (const o of objects) {
    const r = recordOfTag(w, o.tag);
    if (!r || !r.anim) return false;
    r.anim.start(o.animState | 0, o.animFrame);
    r.anim.prevFrame = r.anim.frame; r.anim.prevClip = r.anim.clip;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------- entity records

/** the node's save block: undefined = the original's node has no serializer (vtable +0x14 == 0) */
export function nodeBlock(w: World, rec: GameRecord, n: BehaviourNode): Uint8Array | null {
  if (!rec.ctrl || !n.saveBlock) return null;
  return n.saveBlock(w, rec, rec.ctrl);
}

/**
 * FUN_00418ec7, the entity loop. Some node classes finish their constructor's work lazily (first update / first block request: a record is moved to its start place, a dock is claimed ...): one
 * pass over every node's block first lets all of them do that, the records are read after it (the original's constructors ran at the set-up).
 */
export function captureEntities(w: World): EntityRecord[] {
  for (const r of w.records) for (const n of listedNodes(r)) nodeBlock(w, r, n);
  const out: EntityRecord[] = [];
  for (const r of w.records) {
    const nodes = listedNodes(r);
    if (!r.ctrl || nodes.length === 0) continue;
    out.push({
      tag: tagOf(r.name),
      pos: new Float32Array([r.m[12], r.m[13], r.m[14]]),
      euler: new Float32Array([r.rx, r.ry, r.rz]),
      flags: r.flags & 0xffff,
      nodes: nodes.map((n) => ({ state: n.stamp >>> 0, data: nodeBlock(w, r, n) })),
    });
  }
  return out;
}

/** why a load stopped (FUN_00419e82 returns 0 there and leaves the world half restored) */
export class LoadAbort extends Error { constructor(why: string) { super(`save load stopped: ${why}`); this.name = 'LoadAbort'; } }

/**
 * FUN_00419e82's entity loop on the bytes of the entity section (the stream after the 0x6066006 marker up to and including the closing 0x7077007, which is the loop's end marker).
 * A record the file names but the world does not have (or that has no controller) stops the load (see `skip`). A node
 * with a loader reads [size][bytes][0xb0bb00b]; every node's +8 state is read. Returns false where the original returns 0 (a marker is wrong / the data ends early).
 */
export function applyEntitySection(w: World, bytes: Uint8Array): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length;
  let p = 0;
  const u32 = (): number => { if (p + 4 > end) throw new LoadAbort('truncated'); const v = dv.getUint32(p, true); p += 4; return v; };
  // FUN_00419b17 (called for a tag without a record, and for a record without a controller) returns 1 whenever a 0xc0cc00c / 0xd0dd00d / 0x9099009 marker follows (the file always ends with one), and the
  // reader answers a non-zero result with `return 0`: an unknown record stops the load, the bricks after the entities are not applied
  const skip = (): never => { throw new LoadAbort('unknown record'); };
  try {
    for (;;) {
      if (p >= end) return true;
      const tag = u32();
      if (tag === M.ENTITY_END) return true;
      const rec = recordOfTag(w, tag);
      if (!rec) return skip();
      if (p + 26 > end) throw new LoadAbort('truncated');
      rec.m[12] = dv.getFloat32(p, true); rec.m[13] = dv.getFloat32(p + 4, true); rec.m[14] = dv.getFloat32(p + 8, true);
      rec.rx = dv.getFloat32(p + 12, true); rec.ry = dv.getFloat32(p + 16, true); rec.rz = dv.getFloat32(p + 20, true);
      eulerRotation(rec.m, rec.rx, rec.ry, rec.rz);
      rec.flags = (rec.flags & ~0xffff) | dv.getUint16(p + 24, true);
      rec.savePrev();
      p += 26;
      const ctrl = rec.ctrl;
      if (!ctrl) return skip();
      for (const n of ctrl.nodes) {
        if (n.ctor === undefined) continue;
        n.stamp = u32();
        if (n.loadBlock) {
          const size = u32();
          if (p + size > end) throw new LoadAbort('truncated node block');
          n.loadBlock(w, rec, ctrl, bytes.subarray(p, p + size));
          p += size;
          if (u32() !== M.NODE) throw new LoadAbort('node marker');
        }
      }
      if (u32() !== M.OBJECT) throw new LoadAbort('entity end marker');
    }
  } catch (e) {
    if (e instanceof LoadAbort) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- the whole world

/** DAT_009da5e8: the 18 floats of the camera struct as the 0x48 bytes the save holds */
export function cameraBytes(w: World): Uint8Array {
  const out = new Uint8Array(CAMERA_BYTES);
  new Float32Array(out.buffer).set(w.camera.c.subarray(0, 18));
  return out;
}

/** every world section of FUN_00418ec7 (walkers, camera + frame counter, object records, decor, entity records, bricks) for the live world */
export function captureWorld(w: World): Partial<NewSaveOptions> {
  const o: Partial<NewSaveOptions> = { camera: cameraBytes(w), frameCounter: w.frame >>> 0, objects: captureObjects(w) };
  const wk = saveParts.walkers?.capture(w);
  if (wk) { o.walkers = wk.walkers; o.walkerTags = wk.tags; }
  o.decor = saveParts.decor?.capture(w) ?? new Uint8Array(DECOR_BYTES);
  o.entities = captureEntities(w);
  const br = saveParts.bricks?.capture(w);
  if (br) o.bricks = br;
  return o;
}

/**
 * FUN_00419e82 after the variables: walkers, camera + frame counter, object records, decor, entity records, bricks, in the original's order. A step that fails stops the load there (the original
 * returns 0 and keeps what it applied); the result says whether the whole file was applied.
 */
export function restoreWorld(w: World, save: SaveGame, o: { bricks?: boolean } = {}): boolean {
  if (saveParts.walkers) saveParts.walkers.apply(w, { walkers: save.walkers, tags: save.walkerTags });
  const cam = new Float32Array(save.camera.buffer.slice(save.camera.byteOffset, save.camera.byteOffset + CAMERA_BYTES));
  w.camera.c.set(cam.subarray(0, 18));
  w.camera.savePrev();
  w.frame = save.frameCounter >>> 0;
  if (!applyObjects(w, save.objects)) return false;
  saveParts.decor?.apply(w, save.decor);
  if (!applyEntitySection(w, save.entityBytes ?? entityBytesOf(save))) return false;
  if (o.bricks !== false) saveParts.bricks?.apply(w, save.bricks);
  return true;
}

/**
 * The brick section of `restoreWorld` on its own: the zone's brick library is installed by the zone game (after the set-up), so a load that waits for a zone change applies everything else when the set-up is done
 * (`restoreWorld(w, save, { bricks: false })`) and the bricks when the zone game exists. `entitiesApplied` = the first part returned true (the original stops the whole load where one of its steps fails).
 */
export function restoreBricks(w: World, save: SaveGame): void { saveParts.bricks?.apply(w, save.bricks); }

/** the entity section of a save that was built in memory (no stored bytes yet) */
function entityBytesOf(save: SaveGame): Uint8Array {
  const out: number[] = [];
  const dv = new DataView(new ArrayBuffer(8));
  const u32 = (v: number) => { dv.setUint32(0, v >>> 0, true); for (let i = 0; i < 4; i++) out.push(dv.getUint8(i)); };
  for (const e of save.entities) {
    u32(e.tag);
    for (const f of [...e.pos, ...e.euler]) { dv.setFloat32(0, f, true); for (let i = 0; i < 4; i++) out.push(dv.getUint8(i)); }
    out.push(e.flags & 0xff, (e.flags >> 8) & 0xff);
    for (const n of e.nodes) {
      u32(n.state);
      if (n.data) { u32(n.data.length); out.push(...n.data); u32(M.NODE); }
    }
    u32(M.OBJECT);
  }
  u32(M.ENTITY_END);
  return Uint8Array.from(out);
}
