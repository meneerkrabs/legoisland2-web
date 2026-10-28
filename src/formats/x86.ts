// Minimal 32-bit x86 length decoder + straight-line symbolic interpreter, just enough to read the
// game's zone set-up code (MSVC debug build: long runs of push/mov/call with constant operands).
// The zone tables (meshes, collision, texture-id lists, models, object placement) are not stored in
// data files but compiled into this code, see docs/re/formats.md. Pure, no DOM.

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
  | { k: 'addr'; a: number };                     // address of a global (a constant pointer) - same as imm but explicit

export interface CallEv {
  type: 'call';
  at: number;
  target: number;
  id: number;
  /** arguments in call order (arg0 = first parameter = last pushed); known only when cleaned by `add esp,N` */
  args: (Val | undefined)[];
  /** snapshot of frame locals for 'lea' args: map of ebp offset -> constant value */
  locals?: Map<number, number>;
}
export interface StoreEv {
  type: 'store';
  at: number;
  base: Val | undefined;
  off: number;
  value: Val | undefined;
  size: number;
}
export type Ev = CallEv | StoreEv;

const EAX = 0, ECX = 1, EDX = 2, ESP = 4, EBP = 5, EDI = 7;

export interface Image {
  /** read bytes at virtual address (undefined if unmapped) */
  at(va: number): number;
  slice(va: number, len: number): Uint8Array | null;
}

/**
 * Interpret the straight-line code of [start, end) collecting calls and memory stores. Branches are
 * ignored (the zone set-up code has none); unknown instructions invalidate the volatile registers.
 */
export function interpret(img: Image, start: number, end: number): Ev[] {
  const evs: Ev[] = [];
  const regs: (Val | undefined)[] = new Array(8).fill(undefined);
  const stack: (Val | undefined)[] = [];
  const locals = new Map<number, Val | undefined>();
  let callId = 0;
  let lastCall: CallEv | null = null;
  let pc = start;
  const imm = (v: number): Val => ({ k: 'imm', v: v >>> 0 });
  const readMem = (ins: Ins): { base: Val | undefined; off: number; frame: boolean } => {
    // describe a memory operand as base value + offset
    if (ins.base === EBP && ins.index < 0) return { base: undefined, off: ins.disp, frame: true };
    if (ins.base < 0 && ins.index < 0) return { base: { k: 'addr', a: ins.disp >>> 0 }, off: 0, frame: false };
    if (ins.base >= 0 && ins.index < 0) return { base: regs[ins.base], off: ins.disp, frame: false };
    return { base: undefined, off: ins.disp, frame: false };
  };
  const loadFrom = (m: { base: Val | undefined; off: number; frame: boolean }): Val | undefined => {
    if (m.frame) return locals.get(m.off);
    const b = m.base;
    if (!b) return undefined;
    if (b.k === 'addr') return { k: 'glob', a: b.a + m.off };
    return { k: 'load', base: b, o: m.off };
  };
  const addOff = (v: Val | undefined, n: number): Val | undefined => {
    if (!v) return undefined;
    if (v.k === 'imm') return imm(v.v + n);
    if (v.k === 'glob') return { k: 'gptr', a: v.a, o: n };
    if (v.k === 'gptr') return { k: 'gptr', a: v.a, o: v.o + n };
    if (v.k === 'lea') return { k: 'lea', o: v.o + n };
    if (v.k === 'load') return { k: 'load', base: v.base, o: v.o + n }; // not exact but unused
    return undefined;
  };
  while (pc < end) {
    const o = img.at(pc) === undefined ? -1 : 0;
    if (o < 0) break;
    const win = img.slice(pc, 16);
    if (!win) break;
    const ins = decode(win, 0, pc);
    if (!ins) { pc++; continue; }
    const op = ins.op;
    const next = pc + ins.len;
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
      evs.push(ev);
      regs[EAX] = { k: 'ret', id: ev.id }; regs[ECX] = undefined; regs[EDX] = undefined;
    } else if ((op === 0x83 || op === 0x81) && ins.mod === 3 && ins.rm === ESP && ins.reg === 0) {
      const n = (ins.imm >>> 0) / 4;
      if (lastCall && lastCall.args.length >= n && stack.length >= n) {
        const mine = stack.slice(stack.length - n).reverse();
        lastCall.args = mine;
        stack.length -= n;
        lastCall = null;
      } else stack.length = Math.max(0, stack.length - n);
    } else if (op === 0x8b && ins.modrm >= 0) { // mov r32, r/m32
      if (ins.mod === 3) regs[ins.reg] = regs[ins.rm]; else regs[ins.reg] = loadFrom(readMem(ins));
    } else if (op === 0xa1) regs[EAX] = { k: 'glob', a: ins.imm >>> 0 };
    else if (op === 0xa3) evs.push({ type: 'store', at: pc, base: { k: 'addr', a: ins.imm >>> 0 }, off: 0, value: regs[EAX], size: 4 });
    else if (op === 0x89 && ins.modrm >= 0) { // mov r/m32, r32
      if (ins.mod === 3) regs[ins.rm] = regs[ins.reg];
      else {
        const m = readMem(ins);
        if (m.frame) locals.set(m.off, regs[ins.reg]);
        else evs.push({ type: 'store', at: pc, base: m.base, off: m.off, value: regs[ins.reg], size: 4 });
      }
    } else if (op === 0xc7 && ins.reg === 0 && ins.modrm >= 0) { // mov r/m, imm
      if (ins.mod === 3) regs[ins.rm] = imm(ins.imm);
      else {
        const m = readMem(ins);
        const size = ins.prefix66 ? 2 : 4;
        if (m.frame) locals.set(m.off, size === 4 ? imm(ins.imm) : undefined);
        else evs.push({ type: 'store', at: pc, base: m.base, off: m.off, value: imm(ins.imm), size });
      }
    } else if (op >= 0xb8 && op <= 0xbf) regs[op - 0xb8] = imm(ins.imm);
    else if (op === 0x8d && ins.modrm >= 0 && ins.hasMem) { // lea
      const m = readMem(ins);
      if (m.frame) regs[ins.reg] = { k: 'lea', o: m.off };
      else if (m.base && ins.index < 0) regs[ins.reg] = addOff(m.base.k === 'addr' ? imm(m.base.a) : m.base, m.off);
      else regs[ins.reg] = undefined;
    } else if ((op === 0x83 || op === 0x81) && ins.mod === 3) { // add/sub r, imm
      const r = ins.rm;
      if (ins.reg === 0) regs[r] = addOff(regs[r], ins.imm);
      else if (ins.reg === 5) regs[r] = addOff(regs[r], -ins.imm);
      else if (ins.reg !== 7) regs[r] = undefined; // cmp keeps; others (or/and/xor...) unknown
    } else if (op === 0x05) regs[EAX] = addOff(regs[EAX], ins.imm);
    else if (op === 0x2d) regs[EAX] = addOff(regs[EAX], -ins.imm);
    else if (op === 0x01 && ins.mod === 3) regs[ins.rm] = undefined;
    else if (op === 0x31 && ins.mod === 3 && ins.reg === ins.rm) regs[ins.rm] = imm(0);
    else if (op === 0x33 && ins.mod === 3 && ins.reg === ins.rm) regs[ins.reg] = imm(0);
    else if (op === 0xc3 || op === 0xc2) break;
    else if (op === 0xe9 || op === 0xeb || (op >= 0x70 && op <= 0x7f) || (op >= 0x0f80 && op <= 0x0f8f)) { /* ignore control flow */ }
    else if (ins.rep && op === 0xab) { regs[ECX] = undefined; regs[EDI] = undefined; }
    else if (op === 0xc9 || op === 0x90 || op === 0x9b || op === 0xcc || (op >= 0xd8 && op <= 0xdf) || op === 0x85 || op === 0x39 || op === 0x3b || op === 0x84 || op === 0x38 || op === 0x3a || op === 0x3c || op === 0x3d || op === 0xa8 || op === 0xa9) { /* no tracked effect (x87, compares) */ }
    else if (op === 0xc6 || op === 0x88) { /* byte stores: ignored */ }
    else { volatile(); if (ins.modrm >= 0 && ins.mod === 3) regs[ins.rm] = undefined; if (ins.modrm >= 0 && ins.mod === 3) regs[ins.reg] = undefined; }
    pc = next;
  }
  return evs;
}
