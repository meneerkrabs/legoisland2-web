// Miles Sound System (the game's own mss32.dll, public/data/le2/mss32.dll, base 0x21100000) on the x86 emulator: loads the DLL, resolves its import table to host stubs
// (kernel32 heap / file functions on a fake heap and an in-memory file system) and calls exported functions. Used by tools/tests/audio-mss-*.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { createGameCpu, FS_BASE } from '../../src/formats/x86emu.ts';

const HEAP = 0x30000000, HEAP_END = HEAP + 0x10000000, FAKE = 0x50000000;

export function readTables(file) {
  const d = fs.readFileSync(file);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const pe = dv.getUint32(0x3c, true), nsec = dv.getUint16(pe + 6, true), opt = dv.getUint16(pe + 20, true), base = dv.getUint32(pe + 24 + 28, true);
  const secs = [];
  let at = pe + 24 + opt;
  for (let i = 0; i < nsec; i++, at += 40) secs.push({ va: dv.getUint32(at + 12, true), vsize: dv.getUint32(at + 8, true), roff: dv.getUint32(at + 20, true), rsize: dv.getUint32(at + 16, true) });
  const off = (r) => { for (const s of secs) if (r >= s.va && r < s.va + Math.max(s.vsize, s.rsize)) return s.roff + (r - s.va); return -1; };
  const cs = (o) => { let s = ''; while (d[o]) s += String.fromCharCode(d[o++]); return s; };
  const dir = (i) => ({ rva: dv.getUint32(pe + 24 + 96 + i * 8, true), size: dv.getUint32(pe + 24 + 96 + i * 8 + 4, true) });
  const exports = new Map();
  { const eo = off(dir(0).rva), n = dv.getUint32(eo + 24, true), aF = off(dv.getUint32(eo + 28, true)), aN = off(dv.getUint32(eo + 32, true)), aO = off(dv.getUint32(eo + 36, true));
    for (let i = 0; i < n; i++) exports.set(cs(off(dv.getUint32(aN + i * 4, true))), base + dv.getUint32(aF + dv.getUint16(aO + i * 2, true) * 4, true)); }
  const imports = [];
  { let io = off(dir(1).rva);
    for (; ; io += 20) { const nr = dv.getUint32(io + 12, true); if (!nr) break; const dll = cs(off(nr)); let t = off(dv.getUint32(io, true) || dv.getUint32(io + 16, true)); const iat = dv.getUint32(io + 16, true);
      for (let k = 0; ; t += 4, k++) { const v = dv.getUint32(t, true); if (!v) break; imports.push({ dll, name: v & 0x80000000 ? `#${v & 0xffff}` : cs(off(v) + 2), slot: base + iat + k * 4 }); } } }
  return { base, exports, imports };
}

/** argument bytes of the imports the code we run reaches (stdcall); anything else throws when called */
const ARGS = { HeapAlloc: 12, HeapFree: 12, HeapReAlloc: 16, HeapCreate: 12, GlobalAlloc: 8, GlobalFree: 4, GlobalLock: 4, GlobalUnlock: 4, GlobalHandle: 4, VirtualAlloc: 16, VirtualFree: 12,
  CreateFileA: 28, GetFileSize: 8, ReadFile: 20, SetFilePointer: 16, CloseHandle: 4, GetLastError: 0, SetErrorMode: 4, OpenFile: 12, WriteFile: 20, FlushFileBuffers: 4, GetTempPathA: 8, lstrcatA: 8, OutputDebugStringA: 4,
  QueryPerformanceCounter: 4, QueryPerformanceFrequency: 4, GetVersion: 0, Sleep: 4, GetCurrentThread: 0, EnterCriticalSection: 4, LeaveCriticalSection: 4, InitializeCriticalSection: 4, GetProcessHeap: 0, TlsGetValue: 4, TlsSetValue: 8,
  CreateMutexA: 12, WaitForSingleObject: 8, ReleaseMutex: 4, CreateEventA: 16, SetEvent: 4, GetCurrentProcess: 0, DuplicateHandle: 28, GetCurrentProcessId: 0, GetTempPathA: 8 };

export class Mss {
  /** @param {string} dll path of mss32.dll; @param {Map<string, Uint8Array>} files the in-memory file system (lower-case path -> bytes) */
  constructor(dll, files = new Map()) {
    this.pe = new Pe(new Uint8Array(fs.readFileSync(dll)));
    this.tables = readTables(dll);
    this.cpu = createGameCpu(this.pe);
    this.mem = this.cpu.mem;
    this.files = files;
    this.log = [];
    this.mem.addRegion({ lo: HEAP, hi: HEAP_END, name: 'heap' });
    this.mem.addRegion({ lo: FAKE, hi: FAKE + 0x10000, name: 'imports' });
    this.brk = HEAP + 0x10000;
    this.handles = new Map();
    { const rec = this.alloc(0x40); this.mem.w32(FS_BASE, rec); this.mem.w32(rec, 0xffffffff); }   // fs:[0]: an SEH registration record (the DLL's _setjmp3 reads its trylevel)
    this.nextHandle = 0x100;
    let k = 0;
    for (const imp of this.tables.imports) {
      const a = FAKE + 16 * k++;
      this.mem.w32(imp.slot, a);
      this.cpu.hooks.set(a, (c) => this.import(imp, c));
    }
  }
  /** the preference defaults (0x21101260, what AIL_startup sets first: MDI service rate 120 Hz ...) */
  initPreferences() { this.cpu.call(0x21101260, []); }
  alloc(n, zero = true) { const p = this.brk; this.brk = (this.brk + n + 31) & ~15; if (this.brk > HEAP_END) throw new Error('heap'); this.sizes ??= new Map(); this.sizes.set(p, n); void zero; return p; }
  cstr(a) { let s = ''; for (let c; (c = this.mem.r8(a++)); ) s += String.fromCharCode(c); return s; }
  import(imp, c) {
    const n = imp.name;
    this.log.push(n);
    const a = (i) => c.arg(i);
    const argBytes = ARGS[n];
    if (argBytes === undefined) throw new Error(`mss32 import ${imp.dll}!${n} called (not modelled)`);
    switch (n) {
      case 'HeapAlloc': case 'GlobalAlloc': c.eax = this.alloc(n === 'HeapAlloc' ? a(2) : a(1)); break;
      case 'HeapReAlloc': { const old = a(2), sz = a(3), p = this.alloc(sz); const osz = this.sizes?.get(old) ?? 0; for (let i = 0; i < Math.min(osz, sz); i++) this.mem.w8(p + i, this.mem.r8(old + i)); c.eax = p; break; }
      case 'HeapCreate': c.eax = 0x7000; break;
      case 'HeapFree': case 'GlobalFree': case 'GlobalUnlock': case 'VirtualFree': c.eax = n === 'GlobalFree' ? 0 : 1; break;
      case 'GlobalLock': case 'GlobalHandle': c.eax = a(0); break;
      case 'VirtualAlloc': c.eax = this.alloc(a(1)); break;
      case 'CreateFileA': { const p = this.cstr(a(0)).replace(/\\/g, '/').toLowerCase(); const f = this.files.get(p); if (!f) { this.lastError = 2; c.eax = 0xffffffff; break; } const h = this.nextHandle++; this.handles.set(h, { f, pos: 0, path: p }); c.eax = h; break; }
      case 'OpenFile': { const p = this.cstr(a(0)).replace(/\\/g, '/').toLowerCase(); const f = this.files.get(p); if (!f) { this.lastError = 2; c.eax = 0xffffffff; break; } const h = this.nextHandle++; this.handles.set(h, { f, pos: 0, path: p }); c.eax = h; break; }
      case 'GetFileSize': { const h = this.handles.get(a(0)); c.eax = h ? h.f.length : 0xffffffff; break; }
      case 'SetFilePointer': { const h = this.handles.get(a(0)); const m = a(3); const d = a(1) | 0; if (!h) { c.eax = 0xffffffff; break; } h.pos = m === 0 ? d : m === 1 ? h.pos + d : h.f.length + d; c.eax = h.pos; break; }
      case 'ReadFile': { const h = this.handles.get(a(0)); const n2 = a(2); const out = a(1); if (!h) { c.eax = 0; break; } const k2 = Math.max(0, Math.min(n2, h.f.length - h.pos)); for (let i = 0; i < k2; i++) this.mem.w8(out + i, h.f[h.pos + i]); h.pos += k2; if (a(3)) this.mem.w32(a(3), k2); c.eax = 1; break; }
      case 'CloseHandle': this.handles.delete(a(0)); c.eax = 1; break;
      case 'GetLastError': c.eax = this.lastError ?? 0; break;
      case 'QueryPerformanceCounter': this.mem.w32(a(0), 1000); this.mem.w32(a(0) + 4, 0); c.eax = 1; break;
      case 'QueryPerformanceFrequency': this.mem.w32(a(0), 1000000); this.mem.w32(a(0) + 4, 0); c.eax = 1; break;
      case 'GetVersion': c.eax = 0x0a280105; break;
      case 'CreateMutexA': case 'CreateEventA': c.eax = this.nextHandle++; break;
      case 'WaitForSingleObject': c.eax = 0; break;
      case 'ReleaseMutex': case 'SetEvent': c.eax = 1; break;
      default: c.eax = 0;
    }
    return argBytes;
  }
  /** call an export (stdcall: the callee pops the arguments) */
  call(name, args = [], opts = {}) {
    const a = this.tables.exports.get(name);
    if (a === undefined) throw new Error(`no export ${name}`);
    return this.cpu.call(a, args, { maxSteps: 2e8, ...opts }) >>> 0;
  }
}
export const mssPath = (dataRoot) => path.join(dataRoot, 'mss32.dll');
