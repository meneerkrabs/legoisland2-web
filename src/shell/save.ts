// The original save game format (`_data//Save%02d.lgo`, slots 0..6, and `SaveDef.lgo`), byte exact.
// Writer FUN_00418ec7, header readers FUN_00419c45 / FUN_0041aa2e, body reader FUN_00419e82, validation FUN_0041ac8f, checksum FUN_00418e7f.
// The file is always 0x51c8c bytes (the buffer DAT_00987e80 is memset to 0 and fwritten whole); the sections inside are variable
// length and delimited by marker dwords, `length` (dword 0) is the number of bytes in use. Layout (all little endian):
//
//   0x0000 u32 length (bytes in use, incl. the trailing marker)           0x0004 u32 version = 0xd
//   0x0008 u32 CURRENT_SUBGAME (var 0x59)    0x000c u32 time()    0x0010 u32 FSM node (var 0x58)
//   0x0014 marker 0x8088008
//   0x0018 vars 15..318 (304 x i32 = 0x4c0, FUN_00417908/FUN_0041792f)    0x04d8 marker 0xf0ff00f
//   0x04dc walker blob (FUN_00462d8b): 0x3c walkers x 0x84 raw (0x1ef0, from DAT_05d4e1b0) + 0x3c record tags (u32 each, 0xf0)   0x24bc marker 0xe0ee00e
//   0x24c0 camera 0x48 bytes (DAT_009da5e8) + u32 frame counter (DAT_009da5cc)                                             0x250c marker 0xa0aa00a
//   0x2510 object records, each [tag u32][anim state u32][anim float f32][marker 0xd0dd00d] (FUN_0043b72b / FUN_0043b73f), then marker 0x9099009
//   u32 size = 0x380, decor blob (0x1c0 x {set, variant} bytes, FUN_00421f56), marker 0x6066006
//   entity records until marker 0x7077007: [tag u32][pos 12][euler 12][flags u16] { [node state u32] ([size u32][data][marker 0xb0bb00b])? }* [marker 0xd0dd00d]
//   u32 size, brick blob (64 slots: 1 byte 0, or 0x16aa bytes starting with a non-zero flag; FUN_00447c90 -> FUN_00449a10), marker 0x7077007
//   marker 0xc0cc00c, u32 checksum, marker 0xc0cc00c
//
// A "tag" is the first dword of an object record = its 4 character name (`PEPP`, ...). The reader finds records by that tag (FUN_00419a79).
import type { GameVars } from '../game/vars.ts';

export const SAVE_SIZE = 0x51c8c;
export const SAVE_VERSION = 0xd;
export const SLOT_COUNT = 7;
export const SLOT_DEFAULT = -2;
export const VARS_FIRST = 15;
export const VARS_COUNT = 304;
export const WALKER_COUNT = 0x3c;
export const WALKER_SIZE = 0x84;
export const WALKER_BYTES = WALKER_COUNT * WALKER_SIZE; // 0x1ef0
export const CAMERA_BYTES = 0x48;
export const DECOR_BYTES = 0x380;
export const BRICK_SLOTS = 64;
export const BRICK_SLOT_BYTES = 0x16aa;

export const M = {
  HEADER: 0x8088008, VARS: 0xf0ff00f, WALKERS: 0xe0ee00e, CAMERA: 0xa0aa00a, OBJECT: 0xd0dd00d, DECOR: 0x9099009,
  ENTITIES: 0x6066006, NODE: 0xb0bb00b, ENTITY_END: 0x7077007, END: 0xc0cc00c,
} as const;

/** fixed offsets (cited from FUN_00418ec7: 5 header dwords, marker, vars, ...) */
export const OFF = {
  LENGTH: 0, VERSION: 4, SUBGAME: 8, TIME: 0xc, FSM: 0x10, MARK_HEADER: 0x14, VARS: 0x18, MARK_VARS: 0x18 + VARS_COUNT * 4,
  WALKERS: 0x4dc, MARK_WALKERS: 0x4dc + WALKER_BYTES + WALKER_COUNT * 4, CAMERA: 0x24c0, FRAME: 0x24c0 + CAMERA_BYTES,
  MARK_CAMERA: 0x24c0 + CAMERA_BYTES + 4, OBJECTS: 0x24c0 + CAMERA_BYTES + 8,
} as const;

export type SaveErrorReason = 'size' | 'length' | 'version' | 'marker' | 'checksum' | 'truncated' | 'entities' | 'bricks' | 'decor' | 'too-big';
export class SaveError extends Error {
  readonly reason: SaveErrorReason;
  constructor(reason: SaveErrorReason, detail = '') { super(`bad save game: ${reason}${detail ? ' (' + detail + ')' : ''}`); this.name = 'SaveError'; this.reason = reason; }
}

export interface ObjectRecord { tag: number; animState: number; animFrame: number }
export interface EntityNode {
  /** the node's state dword (node + 8) */
  state: number;
  /** serializer blob of the node (null = the node type has no serializer) */
  data: Uint8Array | null;
}
export interface EntityRecord {
  tag: number;
  /** record + 0x3c: translation x y z (float32, own 12 byte buffer) */
  pos: Float32Array;
  /** record + 0x4c: euler rx ry rz */
  euler: Float32Array;
  /** record + 0x60 flags */
  flags: number;
  nodes: EntityNode[];
}

export interface SaveGame {
  /** bytes in use (informational; recomputed by `encodeSave`) */
  length: number;
  version: number;
  subgame: number;
  /** time() when written */
  time: number;
  fsmState: number;
  /** game vars 15..318 (304 values) */
  vars: Int32Array;
  /** 60 raw walker structs (0x84 bytes) of the waypoint walkers, and the tag of the record each walker is attached to */
  walkers: Uint8Array;
  walkerTags: Uint32Array;
  /** 0x48 raw camera bytes and the frame counter */
  camera: Uint8Array;
  frameCounter: number;
  objects: ObjectRecord[];
  /** 0x1c0 x (set, variant) bytes */
  decor: Uint8Array;
  entities: EntityRecord[];
  /** set when the entity section could not be parsed structurally: raw section bytes, authoritative over `entities` */
  entitiesRaw?: Uint8Array;
  /** 64 brick slots: null = unused, else 0x16aa bytes */
  bricks: (Uint8Array | null)[];
  /** raw blob when the slot structure did not match */
  bricksRaw?: Uint8Array;
}

// -- helpers ---------------------------------------------------------------------------------------------------------------------------------

/** FUN_00418e7f: xor of the dwords from offset 8 while i < upTo - 4 (upTo = offset of the checksum dword) */
export function saveChecksum(b: Uint8Array, upTo: number): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let x = 0;
  for (let i = 8; i < upTo - 4; i += 4) x ^= dv.getUint32(i, true);
  return x >>> 0;
}

/** FUN_00418e40 (file name inside `_data//`) */
export function slotFileName(slot: number): string {
  if (slot === SLOT_DEFAULT) return 'SaveDef.lgo';
  return `Save${String(slot).padStart(2, '0')}.lgo`;
}

const f32 = (b: Uint8Array) => { const o = new Float32Array(3); new Uint8Array(o.buffer).set(b.subarray(0, 12)); return o; };

class Writer {
  readonly buf = new Uint8Array(SAVE_SIZE);
  readonly dv = new DataView(this.buf.buffer);
  pos = 0;
  private need(n: number) { if (this.pos + n > SAVE_SIZE) throw new SaveError('too-big', `${this.pos + n} > ${SAVE_SIZE}`); }
  u32(v: number) { this.need(4); this.dv.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  u8(v: number) { this.need(1); this.buf[this.pos++] = v; }
  u16(v: number) { this.need(2); this.dv.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
  f32(v: number) { this.need(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
  bytes(b: Uint8Array, n = b.length) { this.need(n); this.buf.set(b.subarray(0, n), this.pos); this.pos += n; }
}

function entityBytes(w: Writer, list: EntityRecord[]) {
  for (const e of list) {
    w.u32(e.tag);
    w.bytes(new Uint8Array(e.pos.buffer, e.pos.byteOffset, 12));
    w.bytes(new Uint8Array(e.euler.buffer, e.euler.byteOffset, 12));
    w.u16(e.flags);
    for (const n of e.nodes) {
      w.u32(n.state);
      if (n.data) { w.u32(n.data.length); w.bytes(n.data); w.u32(M.NODE); }
    }
    w.u32(M.OBJECT);
  }
}

export function encodeSave(s: SaveGame): Uint8Array {
  const w = new Writer();
  w.u32(0); // length, patched at the end
  w.u32(SAVE_VERSION);
  w.u32(s.subgame);
  w.u32(s.time);
  w.u32(s.fsmState);
  w.u32(M.HEADER);
  const vars = new Uint8Array(VARS_COUNT * 4);
  new Int32Array(vars.buffer).set(s.vars.subarray(0, VARS_COUNT));
  w.bytes(vars);
  w.u32(M.VARS);
  w.bytes(s.walkers, WALKER_BYTES);
  for (let i = 0; i < WALKER_COUNT; i++) w.u32(s.walkerTags[i] ?? 0);
  w.u32(M.WALKERS);
  w.bytes(s.camera, CAMERA_BYTES);
  w.u32(s.frameCounter);
  w.u32(M.CAMERA);
  for (const o of s.objects) { w.u32(o.tag); w.u32(o.animState); w.f32(o.animFrame); w.u32(M.OBJECT); }
  w.u32(M.DECOR);
  w.u32(DECOR_BYTES);
  w.bytes(s.decor, DECOR_BYTES);
  w.u32(M.ENTITIES);
  if (s.entitiesRaw) w.bytes(s.entitiesRaw); else entityBytes(w, s.entities);
  w.u32(M.ENTITY_END);
  if (s.bricksRaw) { w.u32(s.bricksRaw.length); w.bytes(s.bricksRaw); } else {
    let n = 0;
    for (let i = 0; i < BRICK_SLOTS; i++) n += s.bricks[i] ? BRICK_SLOT_BYTES : 1;
    w.u32(n);
    for (let i = 0; i < BRICK_SLOTS; i++) { const b = s.bricks[i]; if (b) w.bytes(b, BRICK_SLOT_BYTES); else w.u8(0); }
  }
  w.u32(M.ENTITY_END);
  w.u32(M.END);
  w.u32(saveChecksum(w.buf, w.pos));
  w.u32(M.END);
  w.dv.setUint32(0, w.pos, true);
  return w.buf;
}

class Reader {
  pos = 0;
  readonly dv: DataView;
  readonly b: Uint8Array;
  readonly end: number;
  constructor(b: Uint8Array, end: number) { this.b = b; this.end = end; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  private need(n: number) { if (this.pos + n > this.end) throw new SaveError('truncated', `at ${this.pos}`); }
  u32(): number { this.need(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { return this.u32() | 0; }
  bytes(n: number): Uint8Array { this.need(n); const o = this.b.slice(this.pos, this.pos + n); this.pos += n; return o; }
  marker(m: number, what: string) { const at = this.pos; if (this.u32() !== m) throw new SaveError('marker', `${what} at 0x${at.toString(16)}`); }
}

/** header of a slot (what the load/save menus read, FUN_0041aa2e / FUN_00419c45): null when it is not a save file */
export interface SaveHeader { length: number; subgame: number; time: number; fsmState: number }
export function readSaveHeader(b: Uint8Array): SaveHeader | null {
  if (b.length < 0x18) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(4, true) !== SAVE_VERSION || dv.getUint32(0x14, true) !== M.HEADER) return null;
  return { length: dv.getUint32(0, true), subgame: dv.getInt32(8, true), time: dv.getUint32(0xc, true), fsmState: dv.getInt32(0x10, true) };
}

/** FUN_0041ac8f: version, closing marker and checksum. Throws SaveError. */
export function validateSave(b: Uint8Array): number {
  if (b.length !== SAVE_SIZE) throw new SaveError('size', `${b.length} != ${SAVE_SIZE}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const len = dv.getUint32(0, true);
  if (len < 0x30 || len > SAVE_SIZE) throw new SaveError('length', String(len));
  if (dv.getUint32(4, true) !== SAVE_VERSION) throw new SaveError('version', String(dv.getUint32(4, true)));
  if (dv.getUint32(len - 4, true) !== M.END) throw new SaveError('marker', 'closing marker');
  if (saveChecksum(b, len - 8) !== dv.getUint32(len - 8, true)) throw new SaveError('checksum');
  return len;
}

function parseEntities(r: Reader): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (;;) {
    const tag = r.u32();
    if (tag === M.ENTITY_END) { r.pos -= 4; return out; }
    const pos = f32(r.bytes(12)), euler = f32(r.bytes(12));
    const flags = r.dv.getUint16(r.pos, true); r.bytes(2);
    const nodes: EntityNode[] = [];
    for (;;) {
      const state = r.u32();
      if (state === M.OBJECT) break;
      // a node with a serializer is followed by [size][data][0xb0bb00b]; without one the next dword is the next node state or the record end
      let data: Uint8Array | null = null;
      if (r.pos + 4 <= r.end) {
        const size = r.dv.getUint32(r.pos, true);
        if (size !== M.OBJECT && r.pos + 8 + size + 4 <= r.end && r.dv.getUint32(r.pos + 4 + size, true) === M.NODE) {
          r.pos += 4; data = r.bytes(size); r.pos += 4;
        }
      }
      nodes.push({ state, data });
    }
    out.push({ tag, pos, euler, flags, nodes });
  }
}

function parseBricks(blob: Uint8Array): (Uint8Array | null)[] | null {
  const out: (Uint8Array | null)[] = [];
  let p = 0;
  for (let i = 0; i < BRICK_SLOTS; i++) {
    if (p >= blob.length) return null;
    if (blob[p] === 0) { out.push(null); p += 1; } else {
      if (p + BRICK_SLOT_BYTES > blob.length) return null;
      out.push(blob.slice(p, p + BRICK_SLOT_BYTES)); p += BRICK_SLOT_BYTES;
    }
  }
  return p === blob.length ? out : null;
}

export function decodeSave(bytes: Uint8Array): SaveGame {
  const len = validateSave(bytes);
  const r = new Reader(bytes, len);
  r.u32(); // length
  r.u32(); // version
  const subgame = r.i32(), time = r.u32(), fsmState = r.i32();
  r.marker(M.HEADER, 'header');
  const vars = new Int32Array(r.bytes(VARS_COUNT * 4).buffer);
  r.marker(M.VARS, 'vars');
  const walkers = r.bytes(WALKER_BYTES);
  const walkerTags = new Uint32Array(r.bytes(WALKER_COUNT * 4).buffer);
  r.marker(M.WALKERS, 'walkers');
  const camera = r.bytes(CAMERA_BYTES);
  const frameCounter = r.u32();
  r.marker(M.CAMERA, 'camera');
  const objects: ObjectRecord[] = [];
  for (;;) {
    const tag = r.u32();
    if (tag === M.DECOR) break;
    const animState = r.u32(), animFrame = r.dv.getFloat32(r.pos, true); r.pos += 4;
    r.marker(M.OBJECT, 'object record');
    objects.push({ tag, animState, animFrame });
  }
  const decorSize = r.u32();
  if (decorSize !== DECOR_BYTES) throw new SaveError('decor', String(decorSize));
  const decor = r.bytes(DECOR_BYTES);
  r.marker(M.ENTITIES, 'entities');
  const entStart = r.pos;
  let entities: EntityRecord[] = [], entitiesRaw: Uint8Array | undefined;
  try { entities = parseEntities(r); } catch (e) {
    if (!(e instanceof SaveError)) throw e;
    // fall back: the section ends at the 0x7077007 marker whose size field leads exactly to the closing 0x7077007 0xc0cc00c checksum 0xc0cc00c
    let found = -1;
    for (let p = entStart; p + 8 <= len - 16; p++) {
      if (r.dv.getUint32(p, true) !== M.ENTITY_END) continue;
      if (p + 8 + r.dv.getUint32(p + 4, true) === len - 16 && r.dv.getUint32(len - 16, true) === M.ENTITY_END) { found = p; break; }
    }
    if (found < 0) throw new SaveError('entities');
    entitiesRaw = bytes.slice(entStart, found);
    r.pos = found;
  }
  r.marker(M.ENTITY_END, 'entity end');
  const brickSize = r.u32();
  const blob = r.bytes(brickSize);
  r.marker(M.ENTITY_END, 'brick end');
  r.marker(M.END, 'end');
  const bricks = parseBricks(blob);
  const save: SaveGame = { length: len, version: SAVE_VERSION, subgame, time, fsmState, vars, walkers, walkerTags, camera, frameCounter, objects, decor, entities, bricks: bricks ?? [] };
  if (entitiesRaw) save.entitiesRaw = entitiesRaw;
  if (!bricks) save.bricksRaw = blob;
  return save;
}

export interface NewSaveOptions {
  /** the game variable array: 319 values (indices 15..318 are taken) or the 304 values of a save */
  vars: Int32Array;
  subgame: number;
  fsmState: number;
  time?: number;
  camera?: Uint8Array;
  frameCounter?: number;
  objects?: ObjectRecord[];
  decor?: Uint8Array;
  entities?: EntityRecord[];
  bricks?: (Uint8Array | null)[];
  walkers?: Uint8Array;
  walkerTags?: Uint32Array;
}

/** a save game from what the port can produce; sections it cannot produce are valid empty content of the right size (zeros / no records) */
export function newSaveFromGame(o: NewSaveOptions): SaveGame {
  const vars = new Int32Array(VARS_COUNT);
  if (o.vars.length >= VARS_FIRST + VARS_COUNT) vars.set(o.vars.subarray(VARS_FIRST, VARS_FIRST + VARS_COUNT));
  else vars.set(o.vars.subarray(0, VARS_COUNT));
  const bricks: (Uint8Array | null)[] = [];
  for (let i = 0; i < BRICK_SLOTS; i++) bricks.push(o.bricks?.[i] ?? null);
  return {
    length: 0, version: SAVE_VERSION, subgame: o.subgame | 0, time: (o.time ?? Math.floor(Date.now() / 1000)) >>> 0, fsmState: o.fsmState | 0, vars,
    walkers: o.walkers ?? new Uint8Array(WALKER_BYTES), walkerTags: o.walkerTags ?? new Uint32Array(WALKER_COUNT),
    camera: o.camera ?? new Uint8Array(CAMERA_BYTES), frameCounter: (o.frameCounter ?? 0) >>> 0,
    objects: o.objects ?? [], decor: o.decor ?? new Uint8Array(DECOR_BYTES), entities: o.entities ?? [], bricks,
  };
}

/** FUN_0041792f: copy the save's vars 15..318 into the live array */
export function applySaveVars(s: SaveGame, vars: GameVars) { vars.a.set(s.vars, VARS_FIRST); }
/** FUN_00417908 */
export function captureVars(vars: GameVars): Int32Array { return vars.a.slice(VARS_FIRST, VARS_FIRST + VARS_COUNT); }

/** the caption shown for an empty slot (string at 0x8a57d0) */
export const EMPTY_SLOT_CAPTION = '<-------->';

/** FUN_0041ac0e: the `FSMSTATEnn` message id for a slot's FSM node (`captions` = readFsmCaptions(pe)); null when the node has none */
export function fsmCaptionId(fsmState: number, captions: string[]): string | null { return captions[fsmState] ?? null; }

/** caption text of a slot: `lookup(id)` is the FRONTEND.str message lookup (FUN_00439788); header null = empty slot */
export function saveCaption(h: SaveHeader | null, captions: string[], lookup: (id: string) => string | undefined): string {
  if (!h) return EMPTY_SLOT_CAPTION;
  const id = fsmCaptionId(h.fsmState, captions);
  return (id && lookup(id)) || EMPTY_SLOT_CAPTION;
}
