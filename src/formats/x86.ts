// Minimal 32-bit x86 length decoder + straight-line symbolic interpreter, just enough to read the
// game's zone set-up code (MSVC debug build: long runs of push/mov/call with constant operands).
// The zone tables (meshes, collision, texture-id lists, models, object placement) are not stored in
// data files but compiled into this code, see docs/re/formats.md. Pure, no DOM.
// `interpret(img, start, end, opts)` with `opts` is the extended mode used by zonesetup.ts (docs/re/zone-setup.md 2): forward jumps become
// reaching conditions, record loops / table loops / 16-bit flag read-modify-write / parameters are understood; without `opts` it is the original.

export interface Ins {
  addr: number;
  len: number;
  op: number;      // primary opcode (0x0f00|b for two-byte)
  modrm: number;   // -1 if none
  mod: number; reg: number; rm: number;
  base: number; index: number; scale: number; // for memory operands (-1 none)
  disp: number;
  hasMem: boolean;
  imm: number;     // immediate (sign extended where applicable)
  immSize: number;
  prefix66: boolean; rep: boolean;
  rel: number;     // branch target (absolute) for call/jmp/jcc, else 0
}

const MODRM1 = new Uint8Array(256);
const IMM1 = new Int8Array(256); // immediate size in bytes (-1 = operand-size dependent 4 or 2)
(function init() {
  for (let i = 0; i < 0x40; i++) {
    const lo = i & 7;
    if (lo < 4) MODRM1[i] = 1;
    else if (lo === 4) IMM1[i] = 1;
    else if (lo === 5) IMM1[i] = -1;
  }
  for (const o of [0x62, 0x63, 0x69, 0x6b, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0xc0, 0xc1, 0xc4, 0xc5, 0xc6, 0xc7, 0xd0, 0xd1, 0xd2, 0xd3, 0xf6, 0xf7, 0xfe, 0xff]) MODRM1[o] = 1;
  for (let o = 0xd8; o <= 0xdf; o++) MODRM1[o] = 1;
  IMM1[0x68] = -1; IMM1[0x69] = -1; IMM1[0x6a] = 1; IMM1[0x6b] = 1; IMM1[0x80] = 1; IMM1[0x81] = -1; IMM1[0x82] = 1; IMM1[0x83] = 1;
  IMM1[0xa8] = 1; IMM1[0xa9] = -1; IMM1[0xc0] = 1; IMM1[0xc1] = 1; IMM1[0xc2] = 2; IMM1[0xc6] = 1; IMM1[0xc7] = -1; IMM1[0xca] = 2; IMM1[0xcd] = 1;
  IMM1[0xd4] = 1; IMM1[0xd5] = 1; IMM1[0xe4] = 1; IMM1[0xe5] = 1; IMM1[0xe6] = 1; IMM1[0xe7] = 1; IMM1[0xc8] = 3;
  for (let o = 0xb0; o <= 0xb7; o++) IMM1[o] = 1;
  for (let o = 0xb8; o <= 0xbf; o++) IMM1[o] = -1;
  for (let o = 0x70; o <= 0x7f; o++) IMM1[o] = 1;
  for (let o = 0xe0; o <= 0xe3; o++) IMM1[o] = 1;
  IMM1[0xe8] = 4; IMM1[0xe9] = 4; IMM1[0xeb] = 1;
  IMM1[0xa0] = 4; IMM1[0xa1] = 4; IMM1[0xa2] = 4; IMM1[0xa3] = 4;
})();

/** Decode one instruction at `off` of `buf` (virtual address `addr`); returns null if it looks invalid. */
export function decode(buf: Uint8Array, off: number, addr: number): Ins | null {
  let p = off;
  let prefix66 = false, rep = false;
  for (;;) {
    const b = buf[p];
    if (b === 0x66) { prefix66 = true; p++; } else if (b === 0xf3 || b === 0xf2) { rep = true; p++; } else if (b === 0x2e || b === 0x36 || b === 0x3e || b === 0x26 || b === 0x64 || b === 0x65 || b === 0x67 || b === 0xf0) p++; else break;
    if (p - off > 4) return null;
  }
  let op = buf[p++];
  let modrm = -1, immSize = 0;
  const twoByte = op === 0x0f;
  if (twoByte) {
    op = 0x0f00 | buf[p++];
    const b = op & 0xff;
    if (b >= 0x80 && b <= 0x8f) immSize = 4;
    else if (b === 0x05 || b === 0x0b || b === 0xa2 || b === 0x31 || b === 0x77 || (b >= 0xc8 && b <= 0xcf)) immSize = 0;
    else {
      modrm = 1;
      if ((b >= 0x70 && b <= 0x73) || b === 0xa4 || b === 0xac || b === 0xba || b === 0xc2 || b === 0xc4 || b === 0xc5 || b === 0xc6) immSize = 1;
    }
  } else {
    if (op === 0x0f) return null;
    if (MODRM1[op]) modrm = 1;
    const s = IMM1[op];
    immSize = s === -1 ? (prefix66 ? 2 : 4) : s;
    if (op === 0x9a || op === 0xea) immSize = 6;
  }
  let mod = 0, reg = 0, rm = 0, base = -1, index = -1, scale = 1, disp = 0, hasMem = false;
  if (modrm === 1) {
    const m = buf[p++];
    modrm = m; mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
    if (mod !== 3) {
      hasMem = true;
      if (rm === 4) {
        const sib = buf[p++];
        scale = 1 << (sib >> 6); index = (sib >> 3) & 7; base = sib & 7;
        if (index === 4) index = -1;
        if (base === 5 && mod === 0) { base = -1; disp = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24); p += 4; }
      } else if (rm === 5 && mod === 0) { disp = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24); p += 4; } else base = rm;
      if (mod === 1) { disp = (buf[p] << 24) >> 24; p += 1; } else if (mod === 2) { disp = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24); p += 4; }
    }
    if (!twoByte && (op === 0xf6 || op === 0xf7)) immSize = reg < 2 ? (op === 0xf6 ? 1 : prefix66 ? 2 : 4) : 0;
  }
  let imm = 0;
  if (immSize === 1) imm = (buf[p] << 24) >> 24;
  else if (immSize === 2) imm = (buf[p] | (buf[p + 1] << 8)) << 16 >> 16;
  else if (immSize === 4) imm = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24);
  p += immSize;
  const len = p - off;
  let rel = 0;
  if (op === 0xe8 || op === 0xe9) rel = (addr + len + imm) >>> 0;
  else if (op === 0xeb || (op >= 0x70 && op <= 0x7f)) rel = (addr + len + imm) >>> 0;
  else if ((op & 0xff00) === 0x0f00 && (op & 0xff) >= 0x80 && (op & 0xff) <= 0x8f) rel = (addr + len + imm) >>> 0;
  return { addr, len, op, modrm, mod, reg, rm, base, index, scale, disp, hasMem, imm, immSize, prefix66, rep, rel };
}

// ---------------------------------------------------------------------------------------------------
// Symbolic values

export type Val =
  | { k: 'imm'; v: number }                       // plain 32-bit constant (also float bit patterns)
  | { k: 'glob'; a: number }                      // contents of the 32-bit global at address a
  | { k: 'gptr'; a: number; o: number }           // contents of global a, plus byte offset o
  | { k: 'load'; base: Val; o: number }           // 32-bit load from [base + o]
  | { k: 'ret'; id: number }                      // return value of call #id
  | { k: 'lea'; o: number }                       // address of the frame local at ebp+o
  | { k: 'addr'; a: number }                      // address of a global (a constant pointer) - same as imm but explicit
  // extended mode only (see InterpretOpts):
  | { k: 'iter'; id: number; mul: number; o: number }                 // loop variable of loop `id`: value = iter * mul + o
  | { k: 'giter'; a: number; id: number; mul: number; o: number }    // contents of global a + iter * mul + o (record loops: a = record array, mul = 0x68)
  | { k: 'gvar'; v: number }                                           // the game variable v (`FUN_00417575(v)` read by a caller and passed on as a parameter)
  | { k: 'ld8'; base: Val; o: number }                                   // zero / sign extended byte load from [base + o] (extended mode)
  | { k: 'tab'; a: number; id: number; scale: number }                // address of table[loop variable]: a + iter * scale (a global array indexed by a loop variable)
  | { k: 'tld'; a: number; id: number; scale: number; mul: number; o: number }                   // the u32 at a + iter * scale (a table entry), * mul + o
  | { k: 'gtld'; g: number; a: number; id: number; scale: number; mul: number; o: number }       // contents of global g + table entry * mul + o (g = record array, mul = 0x68)
  | { k: 'out'; id: number; i: number }                              // word i written by call #id into the frame buffer it was given (InterpretOpts.outputs)
  | { k: 'm16'; base: Val | undefined; off: number; frame: boolean; ops: { op: 'and' | 'or' | 'xor' | 'add' | 'sub'; imm: number }[] }; // 16-bit memory value with pending ALU ops (read-modify-write)

/**
 * One conditional jump the code at an event depends on (extended mode): the code is reached when the jump at `at` is not taken (`taken` false, the `if` body)
 * or taken (true, the `else` arm / the target of the jump). The reaching conditions of an event are a disjunction of conjunctions of guards (`alts`);
 * most events have exactly one alternative (`guards`).
 */
export interface Guard {
  /** address of the conditional jump */
  at: number;
  /** x86 condition code of the jump: 0 O, 2 B, 3 AE, 4 E, 5 NE, 6 BE, 7 A, 8 S, 9 NS, 0xc L, 0xd GE, 0xe LE, 0xf G; 0xff = not known (indirect jump table) */
  cc: number;
  /** the compared values (cmp lhs, rhs; `test x, x` = x, 0); undefined when not tracked */
  lhs?: Val; rhs?: Val;
  /** false: reached when the jump is NOT taken; true: reached by taking it */
  taken: boolean;
  /** the jump leaves a loop (the loop test or a `break`): not a condition on the code after the loop */
  loopExit?: boolean;
}

export interface CallEv {
  type: 'call';
  at: number;
  target: number;
  id: number;
  /** arguments in call order (arg0 = first parameter = last pushed); known only when cleaned by `add esp,N` */
  args: (Val | undefined)[];
  /** snapshot of frame locals for 'lea' args: map of ebp offset -> constant value */
  locals?: Map<number, number>;
  /** extended mode: the guards in force at the call (outermost first; when the code is reached on several paths `guards` is unset and `alts` lists
   * the alternatives) and the innermost loop (id) the call is in */
  guards?: Guard[];
  alts?: Guard[][];
  loop?: number;
}
export interface StoreEv {
  type: 'store';
  at: number;
  base: Val | undefined;
  off: number;
  value: Val | undefined;
  size: number;
  /** extended mode: a 16-bit read-modify-write of the same address (`flags &= imm`): the operation instead of `value` */
  rmw?: { op: 'and' | 'or' | 'xor' | 'add' | 'sub'; imm: number };
  guards?: Guard[];
  alts?: Guard[][];
  loop?: number;
}
export type Ev = CallEv | StoreEv;

const EAX = 0, ECX = 1, EDX = 2, ESP = 4, EBP = 5, EDI = 7;

export interface Image {
  /** read bytes at virtual address (undefined if unmapped) */
  at(va: number): number;
  slice(va: number, len: number): Uint8Array | null;
}

/**
 * Options of the extended mode (backwards compatible: `interpret(img, start, end)` without options behaves as before).
 * The extended mode also follows forward jumps symbolically (every arm is interpreted, in code order; the reaching condition of every instruction is
 * propagated along the forward edges, so if / else if / else, `&&` / `||` and compare-and-jump chains work, and the events carry the `guards` of the
 * paths that reach them; code no path reaches (behind a `jmp` / `ret`) is skipped), tracks `cmp` / `test` operands, understands loops over the record array (loop variable `iter`, `imul` by 0x68,
 * `base + iter`), 16-bit read-modify-write of record flags, binds `params` to the frame slots [ebp+8 ...] and keeps going after a `ret` that is
 * not the last one of the function.
 */
export interface InterpretOpts {
  /** values of the stack parameters (arg 0 = [ebp+8]); only constants and global-relative values should be passed */
  params?: (Val | undefined)[];
  /** calls (by target address) that fill a frame buffer passed as argument `arg` with `words` dwords: later loads of the buffer give `{ k: 'out' }` values */
  outputs?: Record<number, { arg: number; words: number }>;
}

/** structural equality of two symbolic values */
export function sameVal(a: Val | undefined, b: Val | undefined): boolean {
  if (!a || !b) return false;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'imm': return a.v === (b as typeof a).v;
    case 'glob': return a.a === (b as typeof a).a;
    case 'addr': return a.a === (b as typeof a).a;
    case 'gptr': return a.a === (b as typeof a).a && a.o === (b as typeof a).o;
    case 'lea': return a.o === (b as typeof a).o;
    case 'ret': return a.id === (b as typeof a).id;
    case 'load': return a.o === (b as typeof a).o && sameVal(a.base, (b as typeof a).base);
    case 'iter': return a.id === (b as typeof a).id && a.mul === (b as typeof a).mul && a.o === (b as typeof a).o;
    case 'giter': { const c = b as typeof a; return a.a === c.a && a.id === c.id && a.mul === c.mul && a.o === c.o; }
    case 'gvar': return a.v === (b as typeof a).v;
    case 'ld8': return a.o === (b as typeof a).o && sameVal(a.base, (b as typeof a).base);
    case 'tab': case 'tld': case 'gtld': return JSON.stringify(a) === JSON.stringify(b);
    case 'out': return a.id === (b as typeof a).id && a.i === (b as typeof a).i;
    case 'm16': return false;
  }
}

interface LoopInfo { id: number; start: number; end: number; locals: Set<number> }

/** Linear pre-scan of [start, end): backward branches are loops; the frame slots written inside a loop are its loop-carried variables. */
function findLoops(img: Image, start: number, end: number): LoopInfo[] {
  const ins: Ins[] = [];
  for (let pc = start; pc < end;) {
    const win = img.slice(pc, 16);
    if (!win) break;
    const i = decode(win, 0, pc);
    if (!i) { pc++; continue; }
    ins.push(i);
    pc += i.len;
  }
  const loops: LoopInfo[] = [];
  for (const i of ins) {
    const isJmp = i.op === 0xe9 || i.op === 0xeb || (i.op >= 0x70 && i.op <= 0x7f) || (i.op >= 0x0f80 && i.op <= 0x0f8f);
    if (isJmp && i.rel < i.addr && i.rel >= start) loops.push({ id: loops.length, start: i.rel, end: i.addr, locals: new Set() });
  }
  for (const l of loops) {
    for (const i of ins) {
      if (i.addr < l.start || i.addr > l.end) continue;
      if (!(i.hasMem && i.base === EBP && i.index < 0)) continue;
      const writes = i.op === 0x89 || i.op === 0xc7 || i.op === 0x88 || i.op === 0xc6 || i.op === 0x01 || i.op === 0x29 || ((i.op === 0xff || i.op === 0xfe) && i.reg < 2) ||
        ((i.op === 0x83 || i.op === 0x81 || i.op === 0x80) && i.reg !== 7) || (i.op >= 0xd8 && i.op <= 0xdf && (i.reg === 2 || i.reg === 3));
      if (writes) l.locals.add(i.disp);
    }
  }
  return loops;
}

/**
 * Interpret the straight-line code of [start, end) collecting calls and memory stores. Branches are
 * ignored (the zone set-up code has none) unless `opts` is given (extended mode, see InterpretOpts);
 * unknown instructions invalidate the volatile registers.
 */
export function interpret(img: Image, start: number, end: number, opts?: InterpretOpts): Ev[] {
  const ext = opts !== undefined;
  const evs: Ev[] = [];
  const regs: (Val | undefined)[] = new Array(8).fill(undefined);
  const stack: (Val | undefined)[] = [];
  const locals = new Map<number, Val | undefined>();
  let callId = 0;
  let lastCall: CallEv | null = null;
  let pc = start;
  const imm = (v: number): Val => ({ k: 'imm', v: v >>> 0 });
  // extended mode state
  /** reaching conditions of the instruction at pc: a disjunction of conjunctions of guards ([] = not reachable, [[]] = always) */
  let cur: Guard[][] = [[]];
  const pending = new Map<number, Guard[][]>();
  let lastCmp: { lhs?: Val; rhs?: Val } | undefined;
  const loops = ext ? findLoops(img, start, end) : [];
  const enteredLoops = new Set<number>();
  if (ext && opts!.params) opts!.params.forEach((p, i) => { if (p) locals.set(8 + 4 * i, p); });
  const loopAt = (a: number): number | undefined => {
    let best: LoopInfo | undefined;
    for (const l of loops) if (a >= l.start && a <= l.end && (!best || l.end - l.start < best.end - best.start)) best = l;
    return best?.id;
  };
  const decorate = <T extends Ev>(e: T): T => {
    if (!ext) return e;
    if (cur.length === 1) { if (cur[0].length) e.guards = cur[0].slice(); } else e.alts = cur.map((a) => a.slice());
    const l = loopAt(e.at);
    if (l !== undefined) e.loop = l;
    return e;
  };
  const addOff = (v: Val | undefined, n: number): Val | undefined => {
    if (!v) return undefined;
    if (v.k === 'imm') return imm(v.v + n);
    if (v.k === 'glob') return { k: 'gptr', a: v.a, o: n };
    if (v.k === 'gptr') return { k: 'gptr', a: v.a, o: v.o + n };
    if (v.k === 'lea') return { k: 'lea', o: v.o + n };
    if (v.k === 'load') return { k: 'load', base: v.base, o: v.o + n }; // not exact but unused
    if (ext && v.k === 'iter') return { ...v, o: v.o + n };
    if (ext && v.k === 'giter') return { ...v, o: v.o + n };
    if (ext && (v.k === 'tld' || v.k === 'gtld')) return { ...v, o: v.o + n };
    return undefined;
  };
  const addVals = (a: Val | undefined, b: Val | undefined): Val | undefined => {
    if (!a || !b) return undefined;
    if (b.k === 'imm') return addOff(a, b.v | 0);
    if (a.k === 'imm') return addOff(b, a.v | 0);
    const gl = (v: Val) => (v.k === 'glob' ? { a: v.a, o: 0 } : v.k === 'gptr' ? { a: v.a, o: v.o } : null);
    const ga = gl(a), gb = gl(b);
    if (ga && b.k === 'iter') return { k: 'giter', a: ga.a, id: b.id, mul: b.mul, o: ga.o + b.o };
    if (gb && a.k === 'iter') return { k: 'giter', a: gb.a, id: a.id, mul: a.mul, o: gb.o + a.o };
    if (ga && b.k === 'tld') return { k: 'gtld', g: ga.a, a: b.a, id: b.id, scale: b.scale, mul: b.mul, o: ga.o + b.o };
    if (gb && a.k === 'tld') return { k: 'gtld', g: gb.a, a: a.a, id: a.id, scale: a.scale, mul: a.mul, o: gb.o + a.o };
    return undefined;
  };
  const readMem = (ins: Ins): { base: Val | undefined; off: number; frame: boolean } => {
    // describe a memory operand as base value + offset
    if (ins.base === EBP && ins.index < 0) return { base: undefined, off: ins.disp, frame: true };
    if (ins.base < 0 && ins.index < 0) return { base: { k: 'addr', a: ins.disp >>> 0 }, off: 0, frame: false };
    if (ins.base >= 0 && ins.index < 0) return { base: regs[ins.base], off: ins.disp, frame: false };
    if (ext && ins.base >= 0 && ins.index >= 0 && ins.scale === 1) return { base: addVals(regs[ins.base], regs[ins.index]), off: ins.disp, frame: false };
    if (ext && ins.base < 0 && ins.index >= 0) {
      // table[iter]: [iter * scale + table]
      const ix = regs[ins.index];
      if (ix && ix.k === 'iter') return { base: { k: 'tab', a: (ins.disp + ix.o * ins.scale) >>> 0, id: ix.id, scale: ix.mul * ins.scale }, off: 0, frame: false };
    }
    return { base: undefined, off: ins.disp, frame: false };
  };
  const loadFrom = (m: { base: Val | undefined; off: number; frame: boolean }): Val | undefined => {
    if (m.frame) return locals.get(m.off);
    const b = m.base;
    if (!b) return undefined;
    if (b.k === 'addr') return { k: 'glob', a: b.a + m.off };
    if (b.k === 'tab') return { k: 'tld', a: b.a, id: b.id, scale: b.scale, mul: 1, o: 0 };
    return { k: 'load', base: b, o: m.off };
  };
  const rmVal = (ins: Ins): Val | undefined => (ins.mod === 3 ? regs[ins.rm] : loadFrom(readMem(ins)));
  const enterLoop = (l: LoopInfo) => {
    if (enteredLoops.has(l.id)) return;
    enteredLoops.add(l.id);
    for (const off of l.locals) locals.set(off, { k: 'iter', id: l.id, mul: 1, o: 0 });
  };
  const key = (g: Guard) => g.at * 2 + (g.taken ? 1 : 0);
  /** drops alternatives implied by others and merges `A && c` with `A && !c` into `A` */
  const simplify = (alts: Guard[][]): Guard[][] => {
    const list = alts.map((a) => ({ a, k: new Set(a.map(key)) }));
    const subset = (x: Set<number>, y: Set<number>) => { for (const v of x) if (!y.has(v)) return false; return true; };
    for (let changed = true; changed;) {
      changed = false;
      outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (subset(A.k, B.k)) { list.splice(j, 1); changed = true; break outer; }
        if (subset(B.k, A.k)) { list.splice(i, 1); changed = true; break outer; }
        if (A.k.size === B.k.size) {
          const onlyA = [...A.k].filter((v) => !B.k.has(v)), onlyB = [...B.k].filter((v) => !A.k.has(v));
          if (onlyA.length === 1 && onlyB.length === 1 && (onlyA[0] >> 1) === (onlyB[0] >> 1)) {
            const a = A.a.filter((g) => key(g) !== onlyA[0]);
            list[i] = { a, k: new Set(a.map(key)) }; list.splice(j, 1); changed = true; break outer;
          }
        }
      }
    }
    return list.map((x) => x.a);
  };
  const merge = (a: Guard[][], b: Guard[][]): Guard[][] => {
    const m = simplify([...a, ...b]);
    // too many paths: give up on being exact (an unknown condition keeps the code from being treated as unconditional)
    return m.length > 24 ? [[{ at: pc, cc: 0xff, taken: false }]] : m;
  };
  while (pc < end) {
    const o = img.at(pc) === undefined ? -1 : 0;
    if (o < 0) break;
    const win = img.slice(pc, 16);
    if (!win) break;
    if (ext) {
      const pend = pending.get(pc);
      if (pend) { pending.delete(pc); cur = merge(cur, pend); }
      for (const l of loops) if (l.start === pc) enterLoop(l);
    }
    const ins = decode(win, 0, pc);
    if (!ins) { pc++; continue; }
    const op = ins.op;
    const next = pc + ins.len;
    if (ext && cur.length === 0) { pc = next; continue; }   // not reachable on any path
    const volatile = () => { regs[EAX] = undefined; regs[ECX] = undefined; regs[EDX] = undefined; };
    if (op >= 0x50 && op <= 0x57) stack.push(regs[op - 0x50]);
    else if (op >= 0x58 && op <= 0x5f) { stack.pop(); regs[op - 0x58] = undefined; }
    else if (op === 0x68 || op === 0x6a) stack.push(imm(ins.imm));
    else if (op === 0xff && ins.reg === 6) { // push r/m
      if (ins.mod === 3) stack.push(regs[ins.rm]); else stack.push(loadFrom(readMem(ins)));
    } else if (op === 0xe8) {
      const ev: CallEv = { type: 'call', at: pc, target: ins.rel, id: callId++, args: [] };
      lastCall = ev;
      // provisional args: everything currently on the stack (top first); trimmed by the following add esp
      ev.args = stack.slice().reverse();
      // frame snapshot for lea args
      if (ev.args.some((a) => a && a.k === 'lea')) {
        const snap = new Map<number, number>();
        for (const [k, v] of locals) if (v && v.k === 'imm') snap.set(k, v.v);
        ev.locals = snap;
      }
      evs.push(decorate(ev));
      const outp = ext ? opts!.outputs?.[ev.target] : undefined;
      if (outp) { const b = ev.args[outp.arg]; if (b && b.k === 'lea') for (let i = 0; i < outp.words; i++) locals.set(b.o + 4 * i, { k: 'out', id: ev.id, i }); }
      regs[EAX] = { k: 'ret', id: ev.id }; regs[ECX] = undefined; regs[EDX] = undefined;
    } else if ((op === 0x83 || op === 0x81) && ins.mod === 3 && ins.rm === ESP && ins.reg === 0) {
      const n = (ins.imm >>> 0) / 4;
      if (lastCall && lastCall.args.length >= n && stack.length >= n) {
        const mine = stack.slice(stack.length - n).reverse();
        lastCall.args = mine;
        stack.length -= n;
        lastCall = null;
      } else stack.length = Math.max(0, stack.length - n);
    } else if (op === 0x8b && ins.modrm >= 0) { // mov r32, r/m32 (or r16, r/m16)
      if (ext && ins.prefix66) {
        // 16-bit load: keep the address for a following read-modify-write store (`flags &= imm`)
        if (ins.mod === 3) regs[ins.reg] = regs[ins.rm];
        else { const m = readMem(ins); regs[ins.reg] = { k: 'm16', base: m.base, off: m.off, frame: m.frame, ops: [] }; }
      } else if (ins.mod === 3) regs[ins.reg] = regs[ins.rm]; else regs[ins.reg] = loadFrom(readMem(ins));
    } else if (op === 0xa1) regs[EAX] = { k: 'glob', a: ins.imm >>> 0 };
    else if (op === 0xa3) evs.push(decorate({ type: 'store', at: pc, base: { k: 'addr', a: ins.imm >>> 0 }, off: 0, value: regs[EAX], size: 4 }));
    else if (op === 0x89 && ins.modrm >= 0) { // mov r/m32, r32 (or r/m16, r16)
      if (ins.mod === 3) regs[ins.rm] = regs[ins.reg];
      else {
        const m = readMem(ins);
        const v = regs[ins.reg];
        if (ext && ins.prefix66) {
          if (!m.frame) {
            const st: StoreEv = { type: 'store', at: pc, base: m.base, off: m.off, value: undefined, size: 2 };
            if (v && v.k === 'm16' && v.ops.length === 1 && !v.frame && sameVal(v.base, m.base) && v.off === m.off) st.rmw = v.ops[0];
            else if (v && v.k !== 'm16') st.value = v;
            evs.push(decorate(st));
          } else locals.set(m.off, undefined);
        } else if (m.frame) locals.set(m.off, v);
        else evs.push(decorate({ type: 'store', at: pc, base: m.base, off: m.off, value: v, size: 4 }));
      }
    } else if (op === 0xc7 && ins.reg === 0 && ins.modrm >= 0) { // mov r/m, imm
      if (ins.mod === 3) regs[ins.rm] = imm(ins.imm);
      else {
        const m = readMem(ins);
        const size = ins.prefix66 ? 2 : 4;
        if (m.frame) locals.set(m.off, size === 4 ? imm(ins.imm) : undefined);
        else evs.push(decorate({ type: 'store', at: pc, base: m.base, off: m.off, value: imm(ins.imm), size }));
      }
    } else if (op >= 0xb8 && op <= 0xbf) regs[op - 0xb8] = imm(ins.imm);
    else if (op === 0x8d && ins.modrm >= 0 && ins.hasMem) { // lea
      const m = readMem(ins);
      if (m.frame) regs[ins.reg] = { k: 'lea', o: m.off };
      else if (m.base && ins.index < 0) regs[ins.reg] = addOff(m.base.k === 'addr' ? imm(m.base.a) : m.base, m.off);
      else regs[ins.reg] = undefined;
    } else if (ext && (op === 0x83 || op === 0x81) && ins.reg === 7) { // cmp r/m, imm
      lastCmp = ins.prefix66 ? undefined : { lhs: rmVal(ins), rhs: imm(ins.imm) };
    } else if (ext && (op === 0x83 || op === 0x81) && ins.prefix66 && ins.mod === 3 && ins.reg !== 2 && ins.reg !== 3) { // 16-bit and / or / xor / add / sub of a loaded flag word
      const r = regs[ins.rm];
      const name = (['add', 'or', '', '', 'and', 'sub', 'xor'] as const)[ins.reg];
      if (r && r.k === 'm16' && name) regs[ins.rm] = { ...r, ops: [...r.ops, { op: name, imm: ins.imm & 0xffff }] };
      else regs[ins.rm] = undefined;
      lastCmp = undefined;
    } else if (ext && op === 0x80 && ins.mod === 3 && ins.reg !== 7) { // 8-bit and / or / xor of the low (`and dl, 0xfd`) or high (`or ch, 2`) byte of a loaded 16-bit flag word
      const hi = ins.rm >= 4, ri = ins.rm & 3;
      const r = regs[ri];
      const name = (['add', 'or', '', '', 'and', 'sub', 'xor'] as const)[ins.reg];
      const b = ins.imm & 0xff;
      if (r && r.k === 'm16' && name) regs[ri] = { ...r, ops: [...r.ops, { op: name, imm: hi ? (name === 'and' ? 0x00ff | (b << 8) : b << 8) : (name === 'and' ? 0xff00 | b : b) }] };
      else regs[ri] = undefined;
      lastCmp = undefined;
    } else if (ext && (op === 0x24 || op === 0x0c || op === 0x34 || op === 0x04 || op === 0x2c || ((op === 0x25 || op === 0x0d || op === 0x35) && ins.prefix66))) { // and / or / xor / add / sub al|ax, imm
      const r = regs[EAX];
      const byte = op < 0x30 ? (op & 7) === 4 : op === 0x34;
      const kind = op === 0x24 || op === 0x25 ? 'and' : op === 0x0c || op === 0x0d ? 'or' : op === 0x34 || op === 0x35 ? 'xor' : op === 0x04 ? 'add' : 'sub';
      if (r && r.k === 'm16') regs[EAX] = { ...r, ops: [...r.ops, { op: kind, imm: byte ? (kind === 'and' ? 0xff00 | (ins.imm & 0xff) : ins.imm & 0xff) : ins.imm & 0xffff }] };
      else regs[EAX] = undefined;
      lastCmp = undefined;
    } else if ((op === 0x83 || op === 0x81) && ins.mod === 3) { // add/sub r, imm
      const r = ins.rm;
      if (ins.reg === 0) regs[r] = addOff(regs[r], ins.imm);
      else if (ins.reg === 5) regs[r] = addOff(regs[r], -ins.imm);
      else if (ins.reg !== 7) regs[r] = undefined; // cmp keeps; others (or/and/xor...) unknown
      if (ext && ins.reg !== 7) lastCmp = undefined;
    } else if (ext && op === 0x3d) lastCmp = { lhs: regs[EAX], rhs: imm(ins.imm) };
    else if (ext && op === 0x39 && ins.modrm >= 0) lastCmp = { lhs: rmVal(ins), rhs: regs[ins.reg] };
    else if (ext && op === 0x3b && ins.modrm >= 0) lastCmp = { lhs: regs[ins.reg], rhs: rmVal(ins) };
    else if (ext && op === 0x85 && ins.modrm >= 0) lastCmp = ins.mod === 3 && ins.reg === ins.rm ? { lhs: regs[ins.reg], rhs: imm(0) } : undefined;
    else if (ext && (op === 0x84 || op === 0x38 || op === 0x3a || op === 0x3c || op === 0xa8 || op === 0xa9 || op === 0x80)) lastCmp = undefined;
    else if (ext && op === 0x03 && ins.modrm >= 0) { regs[ins.reg] = addVals(regs[ins.reg], rmVal(ins)); lastCmp = undefined; }
    else if (ext && (op === 0x0fbe || op === 0x0fb6) && ins.modrm >= 0) { // movsx / movzx r32, r/m8: a byte of a record (`record.name[1] == 'A'`)
      if (ins.hasMem) { const m = readMem(ins); regs[ins.reg] = !m.frame && m.base ? { k: 'ld8', base: m.base, o: m.off } : undefined; } else regs[ins.reg] = undefined;
      lastCmp = undefined;
    }
    else if (ext && op === 0x6b || ext && op === 0x69) { // imul r, r/m, imm
      const s = rmVal(ins);
      if (s && (s.k === 'iter' || s.k === 'tld')) regs[ins.reg] = { ...s, mul: s.mul * ins.imm, o: s.o * ins.imm };
      else if (s && s.k === 'imm') regs[ins.reg] = imm(s.v * ins.imm);
      else regs[ins.reg] = undefined;
      lastCmp = undefined;
    } else if (op === 0x05) regs[EAX] = addOff(regs[EAX], ins.imm);
    else if (op === 0x2d) regs[EAX] = addOff(regs[EAX], -ins.imm);
    else if (op === 0x01 && ins.mod === 3) { regs[ins.rm] = ext ? addVals(regs[ins.rm], regs[ins.reg]) : undefined; if (ext) lastCmp = undefined; }
    else if (op === 0x31 && ins.mod === 3 && ins.reg === ins.rm) regs[ins.rm] = imm(0);
    else if (op === 0x33 && ins.mod === 3 && ins.reg === ins.rm) regs[ins.reg] = imm(0);
    else if (op === 0xc3 || op === 0xc2) {
      if (!ext) break;
      // extended: a `ret` that is followed only by padding or by the next function's prologue ends the function, otherwise the code goes on (several exits)
      let more = false;
      for (let a = next; a < Math.min(end, next + 16); a++) { const b = img.at(a); if (b !== 0xcc && b !== 0x90) { more = true; break; } }
      if (img.at(next) === 0x55 && img.at(next + 1) === 0x8b && img.at(next + 2) === 0xec) more = false; // the next function's frame prologue
      if (!more) break;
      cur = [];
    }
    else if (ext && op === 0xff && ins.reg === 4) {
      // indirect jump (switch table): the case bodies behind it are reached under a condition the interpreter does not know
      cur = [[{ at: pc, cc: 0xff, taken: false }]];
    }
    else if (op === 0xe9 || op === 0xeb || (op >= 0x70 && op <= 0x7f) || (op >= 0x0f80 && op <= 0x0f8f)) {
      /* control flow: ignored unless extended; then the reaching condition travels along the forward edges */
      if (ext && ins.rel > next) {
        const uncond = op === 0xe9 || op === 0xeb;
        if (uncond && loops.some((l) => l.start === next)) for (const l of loops) if (l.start === next) enterLoop(l); // `for`: the jump over the increment block
        if (uncond) { pending.set(ins.rel, merge(pending.get(ins.rel) ?? [], cur)); cur = []; }
        else {
          const lp = loopAt(pc);
          const exit = lp !== undefined && ins.rel > loops[lp].end;
          const g = (taken: boolean): Guard => { const x: Guard = { at: pc, cc: op & 0xf, lhs: lastCmp?.lhs, rhs: lastCmp?.rhs, taken }; if (exit) x.loopExit = true; return x; };
          pending.set(ins.rel, merge(pending.get(ins.rel) ?? [], cur.map((a) => [...a, g(true)])));
          cur = simplify(cur.map((a) => [...a, g(false)]));
        }
      } else if (ext && (op === 0xe9 || op === 0xeb)) cur = []; // backward jump: the end of a loop body
    }
    else if (ins.rep && op === 0xab) { regs[ECX] = undefined; regs[EDI] = undefined; }
    else if (op === 0xc9 || op === 0x90 || op === 0x9b || op === 0xcc || (op >= 0xd8 && op <= 0xdf) || op === 0x85 || op === 0x39 || op === 0x3b || op === 0x84 || op === 0x38 || op === 0x3a || op === 0x3c || op === 0x3d || op === 0xa8 || op === 0xa9) { /* no tracked effect (x87, compares) */ }
    else if (op === 0xc6 || op === 0x88) { /* byte stores: ignored */ }
    else { volatile(); if (ins.modrm >= 0 && ins.mod === 3) regs[ins.rm] = undefined; if (ins.modrm >= 0 && ins.mod === 3) regs[ins.reg] = undefined; if (ext) lastCmp = undefined; }
    pc = next;
  }
  return evs;
}
