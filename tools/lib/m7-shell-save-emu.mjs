// WP-VERIFY M2 shell: the original's save game code run natively in the x86 emulator (src/formats/x86emu.ts) as an ORACLE for src/shell/save.ts.
// Run from the user's executable: the writer FUN_00418ec7 (+ FUN_00417908 vars, FUN_00462d8b walkers, FUN_00421f56 / FUN_00421eb3 decor, FUN_00447c90 / FUN_00449a10 bricks,
// the anim accessors FUN_0043b72b / FUN_0043b73f, FUN_00418e7f checksum, FUN_00418e40 file name), the validation FUN_0041ac8f, the header readers FUN_00419c45 / FUN_0041aa2e,
// the body reader FUN_00419e82 (+ FUN_0041792f vars, FUN_00462e75 walkers, FUN_00421f7b decor, FUN_00419a79 record lookup, FUN_00419b17 skip, FUN_0043b6a3 anim start,
// FUN_0043a4a1 matrix) and the C runtime (memcpy / memset / time-less parts). Hosted (replaced): the file calls (fopen / fwrite / fread / fclose / sprintf / time), the brick
// reader FUN_00449be0 and the walker follow-up FUN_00463f9d (they rebuild live engine objects), and the node serializers / loaders reached through the vtable (+0x14 / +0x10),
// whose payload is synthetic. Nothing of the executable is stored here, only addresses.
import { createGameCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
export const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
export const A = {
  BUF: 0x987e80, VARS: 0x8a2d2c, WALKERS: 0x5d4e1b0, WALKER_SIZE: 0x84, TAG_NOWALKER: 0x5d500b0, TAG_NOREC: 0x5d500a8, CAMERA: 0x9da5e8, FRAME: 0x9da5cc, DECOR: 0x9d9fd0,
  RECN: 0x983800, RECP: 0x983804, BRICK0: 0x5cb6fdc, BRICK_STRIDE: 0x1730, BRICKS: 64, CURSOR: 0x9d9b0c, COUNT: 0x987e7c, LENGTH: 0x9d9c14, SLOT: 0x8a5444,
  CACHE_FLAG: 0x9d9c1a,
};
const BRICK_LO = A.BRICK0 - 0x1710, BRICK_HI = A.BRICK0 + 63 * A.BRICK_STRIDE + 0x40;

export class SaveEmu {
  /** @param pe the executable; @param o { time } the value time() returns */
  constructor(pe, o = {}) {
    const cpu = (this.cpu = createGameCpu(pe));
    const mem = (this.mem = cpu.mem);
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x800000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.time = o.time ?? 0;
    this.files = new Map();      // name -> Uint8Array (what fread returns / fwrite wrote)
    this.handles = new Map();    // handle -> { name, mode, pos }
    this.nextHandle = 0x1000;
    this.log = [];
    this.nodeData = new Map();   // node ptr -> Uint8Array (serializer payload)
    this.loaded = [];            // loader calls: { node, bytes }
    this.brickReads = [];        // FUN_00449be0 calls: { size at cursor }
    this.unhooked = new Map();
    const L = this;
    const H = cpu.hooks;
    H.set(0x45c432, (c) => { c.eax = 0; });                     // demo / network check: normal game
    H.set(0x85d410, (c) => { if (c.arg(0)) mem.w32(c.arg(0), L.time); c.eax = L.time; });       // time(&t)
    // sprintf(dest, fmt, ...): only %02d / %d / %s occur at the save code's call sites
    H.set(0x85ac00, (c) => {
      const fmt = mem.cstr(c.arg(1));
      let ai = 2, out = '';
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] !== '%') { out += fmt[i]; continue; }
        i++;
        let pad = '';
        while (fmt[i] >= '0' && fmt[i] <= '9') pad += fmt[i++];
        const v = c.arg(ai++);
        if (fmt[i] === 'd') out += String(v | 0).padStart(Number(pad) || 0, '0');
        else if (fmt[i] === 's') out += mem.cstr(v);
        else throw new Error(`save-emu: sprintf format ${fmt}`);
      }
      for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
      mem.w8(c.arg(0) + out.length, 0);
      c.eax = out.length;
    });
    H.set(0x85b1d0, (c) => {                                      // fopen(name, mode)
      const name = mem.cstr(c.arg(0)), mode = mem.cstr(c.arg(1));
      L.log.push(`fopen ${name} ${mode}`);
      if (mode[0] === 'r' && !L.files.has(name)) { c.eax = 0; return; }
      if (L.failOpen) { c.eax = 0; return; }
      const h = L.nextHandle++;
      L.handles.set(h, { name, mode, pos: 0 });
      c.eax = h;
    });
    H.set(0x85bbb0, (c) => {                                      // fwrite(buf, size, count, file)
      const f = L.handles.get(c.arg(3));
      const n = c.arg(1) * c.arg(2);
      const bytes = mem.read(c.arg(0), n);
      L.log.push(`fwrite ${f.name} ${n}`);
      L.files.set(f.name, bytes);
      c.eax = c.arg(2);
    });
    H.set(0x85b9e0, (c) => {                                      // fread(buf, size, count, file)
      const f = L.handles.get(c.arg(3));
      const src = L.files.get(f.name) ?? new Uint8Array(0);
      const n = Math.min(c.arg(1) * c.arg(2), src.length - f.pos);
      mem.write(c.arg(0), src.subarray(f.pos, f.pos + n));
      f.pos += n;
      L.log.push(`fread ${f.name} ${n}`);
      c.eax = Math.floor(n / c.arg(1));
    });
    H.set(0x85af50, (c) => { L.handles.delete(c.arg(0)); c.eax = 0; });    // fclose
    // the node types: vtable +0x10 loader, +0x14 serializer (cdecl (node, out))
    this.types = [0, 0, 0].map(() => this.alloc(0x20));
    const ser1 = this.alloc(16), ser2 = this.alloc(16), load = this.alloc(16);
    mem.w32(this.types[1] + 0x14, ser1); mem.w32(this.types[1] + 0x10, load);
    mem.w32(this.types[2] + 0x14, ser2); mem.w32(this.types[2] + 0x10, load);
    // protocol 1: the function returns the size and stores a pointer to the data in *out
    H.set(ser1, (c) => {
      const d = L.nodeData.get(c.arg(0));
      const p = L.alloc(d.length + 4); mem.write(p, d);
      mem.w32(c.arg(1), p);
      c.eax = d.length;
    });
    // protocol 2: *out == 0 -> return -1 ("give me a buffer"); else copy into *out and return the size
    H.set(ser2, (c) => {
      const d = L.nodeData.get(c.arg(0));
      const dst = mem.r32(c.arg(1)) >>> 0;
      if (dst === 0) { c.eax = -1; return; }
      mem.write(dst, d);
      c.eax = d.length;
    });
    H.set(load, (c) => {
      const src = c.arg(1), size = mem.u32(src - 4);
      L.loaded.push({ node: c.arg(0), bytes: mem.read(src, size) });
      c.eax = 0;
    });
    H.set(0x449be0, (c) => { L.brickReads.push({ at: c.arg(0), size: c.arg(1) }); c.eax = 0; });     // rebuilds the live brick slots from the blob
    H.set(0x463f9d, (c) => { L.log.push(`walkerfix ${c.arg(0)}`); c.eax = 0; });                       // path follow-up of a restored walker
    cpu.exec = [[0x417500, 0x417a00], [0x418e00, 0x41b700], [0x421b00, 0x421fa0], [0x43b6a0, 0x43b780], [0x43a4a1, 0x43a5e4], [0x447c90, 0x447cc0], [0x449a10, 0x449bd0], [0x462d8b, 0x462f40], CRT];
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }

  /**
   * write a synthetic live state (see genState): vars, records (+ anim objects, controllers, nodes), walkers, camera, decor, brick slots.
   * Everything the writer reads lives at the original's addresses.
   */
  setState(st) {
    const mem = this.mem;
    for (let i = 0; i < 319; i++) mem.w32(A.VARS + 4 * i, st.vars[i]);
    mem.w32(A.RECN, st.records.length);
    mem.w32(A.RECP, RECORDS_BASE);
    this.nodeData.clear();
    st.records.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      mem.fill(a, REC, 0);
      mem.w32(a, r.tag);
      r.pos.forEach((v, k) => mem.wf32(a + 0x3c + 4 * k, v));
      r.euler.forEach((v, k) => mem.wf32(a + 0x4c + 4 * k, v));
      mem.w16(a + 0x60, r.flags);
      mem.w32(a + 0x64, r.colour ?? 0);
      if (r.anim) {
        // anim object: +8 clip, +0xc clip index, +0x10 frame, +0x1c table { count, clip ptrs }; each clip +8 = frame count
        const an = this.alloc(0x24), tab = this.alloc(4 + 4 * r.anim.clips.length);
        mem.w32(tab, r.anim.clips.length);
        r.anim.clips.forEach((fc, k) => { const clip = this.alloc(0x10); mem.w32(clip + 8, fc); mem.w32(tab + 4 + 4 * k, clip); });
        mem.w32(an + 0x1c, tab);
        mem.w32(an + 0xc, r.anim.state);
        mem.wf32(an + 0x10, r.anim.frame);
        mem.w32(an + 8, mem.r32(tab + 4 + 4 * r.anim.state));
        mem.w32(a + 8, an);
        r.animPtr = an;
      }
      if (r.nodes) {
        const ctl = this.alloc(16);
        mem.w32(a + 0x5c, ctl);
        let prev = 0;
        r.nodePtrs = [];
        for (const n of r.nodes) {
          const p = this.alloc(0x40);
          mem.w32(p + 4, this.types[n.type]);
          mem.w32(p + 8, n.state);
          if (n.data) this.nodeData.set(p, n.data);
          if (prev) mem.w32(prev + 0x10, p); else mem.w32(ctl, p);
          prev = p;
          r.nodePtrs.push(p);
        }
      }
    });
    mem.write(A.WALKERS, st.walkers);
    mem.w32(A.TAG_NOWALKER, st.tagNoWalker); mem.w32(A.TAG_NOREC, st.tagNoRec);
    mem.write(A.CAMERA, st.camera);
    mem.w32(A.FRAME, st.frame);
    mem.write(A.DECOR, st.decor);
    mem.write(BRICK_LO, st.brickMem);
    for (let k = 0; k < A.BRICKS; k++) {
      const b = A.BRICK0 + k * A.BRICK_STRIDE;
      mem.w8(b, st.brickFlags[k]);
      const cell = this.alloc(16); mem.w32(cell, st.brickWord[k]);
      mem.w32(b - 0xc, cell);
    }
    this.time = st.time;
  }

  /** run the writer; returns { ret, name, bytes (the fwritten 0x51c8c bytes or null), buf (the in-memory buffer) } */
  write(slot) {
    this.log = [];
    this.files.clear();
    const ret = this.cpu.call(0x418ec7, [slot >>> 0]) | 0;
    const name = [...this.files.keys()][0] ?? null;
    return { ret, name, bytes: name ? this.files.get(name) : null, buf: this.mem.read(A.BUF, 0x51c8c), log: this.log.slice() };
  }
  /** FUN_0041ac8f over the current buffer */
  validate() { return this.cpu.call(0x41ac8f, []) | 0; }
  /** FUN_00418e7f(upTo) over the current buffer */
  checksum(upTo) { return this.cpu.call(0x418e7f, [upTo]) >>> 0; }
  /** FUN_00418e40(slot): the file name (string) */
  fileName(slot) { const p = this.cpu.call(0x418e40, [slot >>> 0]); return this.mem.cstr(p); }
  /** place a file and run a header reader (FUN_00419c45 `which` = 'load' (logged as 8 byte reads) or FUN_0041aa2e 'menu'); returns { ok, subgame, time, fsm } */
  header(slot, bytes, which = 'menu') {
    const name = this.fileName(slot);
    this.files.set(name, bytes);
    const out = this.alloc(16);
    const fn = which === 'load' ? 0x419c45 : 0x41aa2e;
    const ok = this.cpu.call(fn, [slot, out, out + 4, out + 8]) | 0;
    return { ok, subgame: this.mem.r32(out), time: this.mem.u32(out + 4), fsm: this.mem.r32(out + 8) };
  }
  /** FUN_00419c45 + FUN_00419e82 on `bytes` as the file of `slot` (the in-place load); returns { header, ret } */
  load(slot, bytes) {
    this.loaded = []; this.brickReads = [];
    const header = this.header(slot, bytes, 'load');
    if (!header.ok) return { header, ret: -1 };
    const ret = this.cpu.call(0x419e82, []) | 0;
    return { header, ret };
  }
  /** read back the state globals (after a load, or to see what the writer left) */
  grab() {
    const mem = this.mem;
    const n = mem.r32(A.RECN);
    return {
      vars: Int32Array.from({ length: 319 }, (_, i) => mem.r32(A.VARS + 4 * i)),
      walkers: mem.read(A.WALKERS, 0x1ef0),
      camera: mem.read(A.CAMERA, 0x48), frame: mem.u32(A.FRAME), decor: mem.read(A.DECOR, 0x380),
      records: Array.from({ length: n }, (_, i) => {
        const a = RECORDS_BASE + i * REC;
        const an = mem.u32(a + 8);
        const ctl = mem.u32(a + 0x5c);
        const nodes = [];
        if (ctl) for (let p = mem.u32(ctl); p; p = mem.u32(p + 0x10)) nodes.push({ state: mem.u32(p + 8) });
        return {
          pos: mem.read(a + 0x3c, 12), euler: mem.read(a + 0x4c, 12), flags: mem.r16(a + 0x60), m: mem.read(a + 0xc, 0x40),
          anim: an ? { state: mem.r32(an + 0xc), frame: mem.f32(an + 0x10) } : null, nodes,
        };
      }),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------- synthetic state
/** a seeded generator (LCG, 32 bit) with the helpers the generators need */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  const r = {
    u32: () => next(),
    int: (n) => Math.floor((next() / 4294967296) * n),
    bytes: (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = next() >>> 24; return b; },
    f32: (lo, hi) => Math.fround(lo + (next() / 4294967296) * (hi - lo)),
    pick: (a) => a[Math.floor((next() / 4294967296) * a.length)],
    chance: (p) => next() / 4294967296 < p,
  };
  return r;
}

/** the subgame values (var 0x59) that make FUN_00421b18 return a zone >= 0, the decor refresh path of FUN_00421eb3 */
export const DECOR_SUBGAMES = [2, 0x1f, 0x20, 0x21, 6, 0xb, 0xd, 0x13, 0x1b];

/**
 * a synthetic live game. opts: records (count), nodeKinds (which node types exist), bricks (how many slots in use), decorZone (force a decor refresh subgame),
 * walkersUsed (how many walkers have the active flag)
 */
export function genState(rng, o = {}) {
  const nrec = o.records ?? 12 + rng.int(20);
  const vars = new Int32Array(319);
  for (let i = 0; i < 319; i++) vars[i] = rng.chance(0.3) ? rng.int(100) : rng.u32() | 0;
  vars[0x59] = o.decorZone ? rng.pick(DECOR_SUBGAMES) : rng.chance(0.5) ? rng.pick(DECOR_SUBGAMES) : 1 + rng.int(40);
  vars[0x58] = rng.int(72);
  const used = new Set();
  const records = [];
  for (let i = 0; i < nrec; i++) {
    let tag;
    do { let t = 0; for (let k = 0; k < 4; k++) t |= (0x41 + rng.int(26)) << (8 * k); tag = t >>> 0; } while (used.has(tag));
    used.add(tag);
    const r = { tag, pos: [0, 0, 0].map(() => rng.f32(-5000, 5000)), euler: [0, 0, 0].map(() => rng.f32(-3.2, 3.2)), flags: rng.int(0x10000), colour: rng.u32() };
    if (rng.chance(0.55)) {
      const clips = Array.from({ length: 1 + rng.int(6) }, () => 1 + rng.int(200));
      const state = rng.int(clips.length);
      r.anim = { clips, state, frame: rng.f32(0, clips[state]) };
    }
    if (rng.chance(0.6)) {
      r.nodes = [];
      const kinds = o.nodeKinds ?? [0, 1, 2];
      for (let k = 0, n = rng.int(5); k < n; k++) {
        const type = rng.pick(kinds);
        r.nodes.push({ type, state: rng.chance(0.5) ? rng.int(8) : rng.u32(), data: type ? rng.bytes(rng.chance(0.1) ? 0 : 1 + rng.int(60)) : null });
      }
      if (!r.nodes.length && rng.chance(0.3)) r.nodes = null;      // controller without nodes is never made: keep an empty list rare
    }
    records.push(r);
  }
  const walkers = rng.bytes(0x1ef0);
  const dvw = new DataView(walkers.buffer);
  const wUsed = o.walkersUsed ?? 10;
  for (let w = 0; w < 0x3c; w++) {
    const b = w * 0x84;
    dvw.setUint32(b, w < wUsed ? (rng.u32() | 1) : 0, true);
    const ri = rng.int(nrec + 2);
    dvw.setUint32(b + 0x14, ri < nrec ? RECORDS_BASE + ri * REC : 0, true);
    dvw.setUint32(b + 0xc, rng.chance(0.7) ? records[rng.int(nrec)].tag : rng.u32(), true);
  }
  const nb = o.bricks ?? rng.int(5);
  const brickFlags = new Uint8Array(A.BRICKS);
  for (let i = 0; i < nb; i++) brickFlags[rng.int(A.BRICKS)] = 1 + rng.int(255);
  return {
    vars, records, walkers, tagNoWalker: rng.u32(), tagNoRec: rng.u32(), camera: rng.bytes(0x48), frame: rng.u32(), decor: rng.bytes(0x380),
    brickMem: rng.bytes(BRICK_HI - BRICK_LO), brickFlags, brickWord: Array.from({ length: A.BRICKS }, () => rng.u32()), time: rng.u32(),
  };
}

/**
 * the SaveGame the port needs for `st` plus what the original's writer left in memory (the decor refresh and the brick blob are the original's own result; the rest is derived
 * from the synthetic input by the rules of the decompile). `orig` = emulator.grab() after the write, `blob` = the original's brick blob
 */
export function expectedSave(st, orig, blob) {
  const dv = new DataView(st.walkers.buffer, st.walkers.byteOffset, st.walkers.byteLength);
  const tags = new Uint32Array(0x3c);
  for (let w = 0; w < 0x3c; w++) {
    const flag = dv.getUint32(w * 0x84, true), ptr = dv.getUint32(w * 0x84 + 0x14, true);
    tags[w] = flag === 0 ? st.tagNoWalker : ptr === 0 ? st.tagNoRec : st.records[(ptr - RECORDS_BASE) / REC].tag;
  }
  const objects = st.records.filter((r) => r.anim).map((r) => ({ tag: r.tag, animState: r.anim.state, animFrame: r.anim.frame }));
  const f3 = (a) => Float32Array.from(a);
  const entities = st.records.filter((r) => r.nodes && r.nodes.length).map((r) => ({
    tag: r.tag, pos: f3(r.pos), euler: f3(r.euler), flags: r.flags, nodes: r.nodes.map((n) => ({ state: n.state, data: n.type ? n.data : null })),
  }));
  // bricks: the blob is the original's; split it like the port does (flag 0 = 1 byte, else 0x16aa bytes)
  const bricks = [];
  let p = 0;
  for (let i = 0; i < A.BRICKS; i++) {
    if (blob[p] === 0) { bricks.push(null); p += 1; } else { bricks.push(blob.slice(p, p + 0x16aa)); p += 0x16aa; }
  }
  return {
    length: 0, version: 0xd, subgame: st.vars[0x59], time: st.time, fsmState: st.vars[0x58], vars: st.vars.slice(15, 15 + 304), walkers: st.walkers.slice(), walkerTags: tags,
    camera: st.camera.slice(), frameCounter: st.frame, objects, decor: orig.decor, entities, bricks,
  };
}
