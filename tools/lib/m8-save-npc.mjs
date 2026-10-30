// WP-SAVE (NPC families): the oracle of tools/lib/m8-save.mjs with the port side brought to the state the production zone game has before the first tick. The island loader of the test
// helpers (tools/lib/island-load.mjs) stops after `setupZone`; the zone game (src/zones/z02LGI/index.ts afterSetup) then loads the walker maps and runs the constructors' world work
// (walkers, ground snap, animation instances, the bots' leaders): the shared builders of m8-save.mjs now run it.
import { buildIslandOracle, buildHubOracle, nativeNodes, portNodes, origBlock, origLoad } from './m8-save.mjs';

/** the constructors of this work package (SGMFIG, Human1 / launch, Turn2Pep A B C, MeetPepp, BrickBot family, botPConly, BOTMUSIC / GETO) */
export const NPC_CTORS = new Set([0x426151, 0x4bec00, 0x4bf329, 0x52ff39, 0x5306e5, 0x5308f3, 0x530d69, 0x531d45, 0x5327b1, 0x532acc, 0x533ba8, 0x53de63, 0x536961, 0x536e16]);
export const ZONES = ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];

/** the oracle for a zone ('isl<story node>' or a hub name): the shared builders run the port's real set-up work (islandWorldSetup / the hub's afterSetup) and fill the oracle heap with 0xCD */
export function buildNpcOracle(ctx, zone, o = {}) {
  return zone.startsWith('isl') ? buildIslandOracle(ctx, Number(zone.slice(3)), o) : buildHubOracle(ctx, zone, o);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the duel observer: the existing NPC / bot scenarios (tools/tests/m7-isl-npc-*.mjs, m7-isl-bb-*.mjs) run the original's nodes natively next to the port's (IslNpcEmu, tolerance 0). The observer hooks the
// oracle's node passes (`IslNpcEmu.prototype.runPasses`, called once per tick after the port's tick) and at every tick compares the original's serializer output with the port's `saveBlock` for every node of
// the verified families; every `snapEvery` ticks it runs a load round: every node gets one of the blocks it held earlier (the observer keeps the distinct ORIGINAL blocks of
// every node as its corpus) put back into BOTH machines (the original's loader natively, the port's `loadBlock`); it checks that the port's block equals the loaded bytes and that the blocks agree again. The scenario's own per-tick comparison (compareState: node fields, records, variables, events, random
// draws) then verifies that the nodes go on like the original's nodes loaded from the same bytes.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { IslNpcEmu, G } from './m7-isl-npc-emu.mjs';
import { hex, firstDiff } from './m8-save.mjs';

export const obs = { label: '', failures: [], vary: new Map(), compares: 0, blocks: 0, loads: 0, loadedNodes: 0, restores: 0, distinct: new Map(), perCtor: new Map(), maxFail: 40 };
export function resetObs() { obs.failures.length = 0; obs.compares = obs.blocks = obs.loads = obs.loadedNodes = obs.restores = 0; obs.distinct.clear(); obs.perCtor.clear(); obs.vary.clear(); }
const CORPUS_MAX = 60;
const fail = (m) => { if (obs.failures.length < obs.maxFail) obs.failures.push(m); };

function scratch(E) {
  if (!E._m8) { E._m8 = { tick: 0, cell: E.alloc(16), buf: E.alloc(0x400), round: 0, corpus: new Map() }; }
  return E._m8;
}
/** the original's block of a node, without allocating per call: null = no serializer */
function origBlockFast(E, saver, ptr) {
  if (!saver) return null;
  const S = scratch(E), cpu = E.cpu, mem = E.mem;
  mem.w32(S.cell, 0);
  cpu.steps = 0;
  let size = cpu.call(saver, [ptr, S.cell], { maxSteps: 5_000_000 }) | 0;
  if (size === -1) {
    mem.w32(S.cell, S.buf);
    cpu.steps = 0;
    size = cpu.call(saver, [ptr, S.cell], { maxSteps: 5_000_000 }) | 0;
    return mem.read(S.buf, size);
  }
  return mem.read(mem.r32(S.cell), size);
}
function origLoadFast(E, loader, ptr, bytes) {
  const S = scratch(E), cpu = E.cpu;
  E.mem.write(S.buf, bytes);
  cpu.steps = 0;
  cpu.call(loader, [ptr, S.buf], { maxSteps: 5_000_000 });
}

/** the nodes the oracle built natively from the verified families, aligned with the port's nodes: [{ rec, k, ptr, ctor, saver, loader, port }] */
export function pairNodes(E) {
  const mem = E.mem, out = [];
  for (const r of E.records) {
    const c = E.ctrlOf(r.index);
    if (!c || !r.ctrl) continue;
    const list = E.nodeList(r.index);
    list.forEach((n, k) => {
      if (!n.mine || !NPC_CTORS.has(n.ctor)) return;
      const vt = mem.r32(n.ptr + 4);
      out.push({ rec: r, k, ptr: n.ptr, ctor: n.ctor, saver: mem.r32(vt + 0x14), loader: mem.r32(vt + 0x10), port: r.ctrl.nodes[k] });
    });
  }
  return out;
}

/** compare every verified node's block (and +8 word) right now; returns the number of blocks compared */
export function compareNow(E, label) {
  const mem = E.mem, w = E.w;
  let n = 0;
  obs.compares++;
  for (const o of pairNodes(E)) {
    const p = o.port, id = `${label} rec ${o.rec.index} ${o.rec.name} node ${o.k} ctor 0x${o.ctor.toString(16)}`;
    const key = '0x' + o.ctor.toString(16);
    if ((p.stamp >>> 0) !== (mem.u32(o.ptr + 8) >>> 0)) fail(`${id}: stamp port ${(p.stamp >>> 0).toString(16)} original ${(mem.u32(o.ptr + 8) >>> 0).toString(16)}`);
    if (!!p.loadBlock !== !!o.loader) fail(`${id}: loader: port ${!!p.loadBlock} original ${!!o.loader}`);
    const ob = origBlockFast(E, o.saver, o.ptr);
    const pb = p.saveBlock ? p.saveBlock(w, o.rec, o.rec.ctrl) : null;
    if (ob === null && pb === null) continue;
    n++; obs.blocks++;
    if (ob === null || pb === null) { fail(`${id}: save block: port ${pb ? pb.length + ' bytes' : 'none'} original ${ob ? ob.length + ' bytes' : 'none'}`); continue; }
    if (ob.length !== pb.length) { fail(`${id}: size port ${pb.length} original ${ob.length}`); continue; }
    const d = firstDiff(ob, pb);
    if (d >= 0) fail(`${id}: byte ${d} differs: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`);
    let s = obs.distinct.get(key); if (!s) obs.distinct.set(key, (s = new Set()));
    const hx = hex(ob);
    if (s.size < 5000) s.add(hx);
    // which bytes of the block ever took a second value (a byte that never varies in a run is not exercised by it)
    let vy = obs.vary.get(key); if (!vy) obs.vary.set(key, (vy = { first: Uint8Array.from(ob), varied: new Uint8Array(ob.length) }));
    if (vy.first.length === ob.length) for (let i = 0; i < ob.length; i++) if (ob[i] !== vy.first[i]) vy.varied[i] = 1;
    // the corpus of the node: the distinct blocks (with their +8 word) it has held, the pool the load rounds draw from
    const S = scratch(E), nk = `${o.rec.index}.${o.k}`;
    let cp = S.corpus.get(nk); if (!cp) S.corpus.set(nk, (cp = { seen: new Set(), list: [] }));
    if (!cp.seen.has(hx) && cp.list.length < CORPUS_MAX) { cp.seen.add(hx); cp.list.push({ state: mem.u32(o.ptr + 8), bytes: ob, hx }); }
    obs.perCtor.set(key, (obs.perCtor.get(key) ?? 0) + 1);
  }
  return n;
}

/** the ORIGINAL's blocks and +8 words of every verified node */
export function snapshotNow(E) {
  const mem = E.mem;
  return pairNodes(E).map((o) => ({ rec: o.rec.index, k: o.k, ctor: o.ctor, state: mem.u32(o.ptr + 8), bytes: origBlockFast(E, o.saver, o.ptr) }));
}
/** FUN_00419e82's node step into both machines: the +8 word, then the loader (the original's natively, the port's `loadBlock`) */
export function restoreNow(E, snap) {
  const mem = E.mem, w = E.w;
  const nodes = pairNodes(E);
  let n = 0;
  for (const s of snap) {
    const o = nodes.find((x) => x.rec.index === s.rec && x.k === s.k);
    if (!o || o.ctor !== s.ctor) { fail(`restore: node ${s.k} of record ${s.rec} is not 0x${s.ctor.toString(16)}`); continue; }
    mem.w32(o.ptr + 8, s.state);
    o.port.stamp = s.state >>> 0;
    if (s.bytes && o.loader) { origLoadFast(E, o.loader, o.ptr, s.bytes); o.port.loadBlock?.(w, o.rec, o.rec.ctrl, s.bytes); n++; obs.loadedNodes++; }
  }
  obs.restores++; obs.loads += n;
  return n;
}

let installed = null;
/**
 * hook the oracle: `cfg` = { every (compare every n ticks, default 1), snapEvery (ticks between load rounds, 0 = no loads) }. Returns `uninstall`.
 * Also gives the oracle's speech functions the original's semantics for the speech ids (FUN_00439bf8 writes the number of the table's 4 character field, -1 without one; the mock of m7-isl-npc-emu
 * numbers the lines by first use, which is not what the node's block holds) and FUN_00419a79 (the record by name tag: the BrickBot loader) natively.
 */
export function installObserver(cfg = {}) {
  if (installed) installed();
  const every = cfg.every ?? 1, snapEvery = cfg.snapEvery ?? 13;
  const proto = IslNpcEmu.prototype, origRun = proto.runPasses, origBuild = proto.buildNodes;
  proto.buildNodes = function (att) {
    const L = this, mem = this.mem, H = this.cpu.hooks;
    // the original is a debug build: new blocks are filled with 0xCD (FUN_00433d38 -> __nh_malloc_dbg); the ports keep 0xCD in the fields a constructor never writes
    for (const a of [0x433d38, 0x858d30]) H.set(a, (c) => { const n = c.arg(0) >>> 0, p = L.alloc(n); for (let i = 0; i < n; i++) mem.w8(p + i, 0xcd); c.eax = p; });
    this.cpu.exec.push([0x419a79, 0x419b40]);
    this.cpu.invalidate();
    L.voiceTag = new Map();
    H.set(0x439bf8, (c) => {   // FUN_00439bf8(table, tag, &speechId)
      const tag = mem.cstr(c.arg(1)), t = L.o.text;
      if (!t || t.text(tag) === tag) { mem.w32(c.arg(2), 0xffffffff); c.eax = c.arg(1); return; }
      const v = t.voice(tag);
      mem.w32(c.arg(2), v >>> 0);
      if (v >= 0 && !L.voiceTag.has(v)) L.voiceTag.set(v, tag);
      let p = L.strings.get(tag);
      if (!p) { const s = t.text(tag); p = L.alloc(s.length + 1); for (let i = 0; i < s.length; i++) mem.w8(p + i, s.charCodeAt(i) & 0xff); mem.w8(p + s.length, 0); L.strings.set(tag, p); }
      c.eax = p;
    });
    H.set(0x435a11, (c) => {   // FUN_00435a11(id, id2): speak (the mock's say(): busy = no-op)
      const a = c.arg(0), b = c.arg(1);
      if (L.say.left > 0) { c.eax = 0; return; }
      const nm = (x) => L.voiceTag.get(x | 0) ?? `?${(x >>> 0).toString(16)}`;
      L.log.push(`say ${nm(a)}${b !== 0xffffffff ? `+${nm(b)}` : ''}`);
      L.say.left = L.say.ticks; c.eax = 0;
    });
    return origBuild.call(this, att);
  };
  proto.runPasses = function (trace) {
    const r = origRun.call(this, trace);
    const S = scratch(this);
    S.tick++;
    const label = `${obs.label} #${S.tick}`;
    if (S.tick % every === 0) compareNow(this, label);
    const se = globalThis.__m8SnapEvery ?? snapEvery;     // a scenario of long timers lowers the load cadence (the loads put timers back)
    if (se > 0 && S.tick % se === 0) {
      // a load round: every node gets one of the blocks it held earlier (the corpus, round robin, never the block it holds now), +8 word with it
      compareNow(this, `${label} before load`);
      const snap = [];
      for (const o of pairNodes(this)) {
        const cp = S.corpus.get(`${o.rec.index}.${o.k}`);
        if (!cp || cp.list.length < 2 || !o.saver) continue;
        const cur = hex(origBlockFast(this, o.saver, o.ptr));
        const cand = cp.list.filter((e) => e.hx !== cur);
        if (!cand.length) continue;
        const e = cand[(S.round + o.k) % cand.length];
        snap.push({ rec: o.rec.index, k: o.k, ctor: o.ctor, state: e.state, bytes: e.bytes });
      }
      S.round++;
      restoreNow(this, snap);
      for (const o of pairNodes(this)) {
        const s = snap.find((x) => x.rec === o.rec.index && x.k === o.k);
        if (!s || !s.bytes) continue;
        const pb = o.port.saveBlock(this.w, o.rec, o.rec.ctrl);
        const d = firstDiff(s.bytes, pb);
        if (d >= 0 || pb.length !== s.bytes.length) fail(`${label} after load rec ${o.rec.index} ${o.rec.name} ctor 0x${o.ctor.toString(16)}: port block differs from the loaded bytes at ${d}: loaded ${hex(s.bytes.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`);
      }
      compareNow(this, `${label} after load`);
    }
    return r;
  };
  installed = () => { proto.runPasses = origRun; proto.buildNodes = origBuild; installed = null; };
  return installed;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// block layouts (for the coverage report: which fields of which block were never different in the scenarios) and the random round trip
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const F = (...a) => a.map(([o, n, name]) => ({ o, n, name }));
const hist = []; for (let i = 0; i < 5; i++) { hist.push({ o: 12 * i, n: 12, name: `hist${i}` }); hist.push({ o: 0x3c + 12 * i, n: 12, name: `eul${i}` }); }
export const LAYOUT = {
  0x426151: F([2, 2, 'savedClip'], [6, 1, 'falling'], [7, 1, 'pushed'], [8, 1, 'camDue'], [0xc, 4, 'saved.x'], [0x10, 4, 'saved.y'], [0x14, 4, 'saved.z'], [0x18, 4, 'fallVel'], [0x1c, 4, 'talk'], [0x20, 2, 'talk50'], [0x22, 2, 'slot'], [0x24, 4, 'timer'], [0x28, 1, 'line'], [0x29, 1, 'talks'], [0x2c, 4, 'speechId0'], [0x30, 4, 'speechId1']),
  0x4bec00: F([0, 2, 'passed'], [2, 1, 'index'], [3, 1, 'due'], [4, 4, 'hop'], [8, 1, 'hopping'], [9, 1, 'restartClip'], [0xb, 1, 'stopped'], [0xc, 4, 'wait']),
  0x4bf329: F([0, 2, 'state'], [2, 2, 'arrived']),
  0x52ff39: F([0, 4, 'heading'], [4, 2, 'back'], [6, 2, 'waved'], [8, 4, 'pause'], [0xc, 4, 'delay']),
  0x5306e5: F([0, 4, 'heading'], [4, 4, 'idleTime'], [8, 2, 'back'], [0xa, 2, 'loops']),
  0x5308f3: F([0, 4, 'mode']),
  0x530d69: F([0, 4, 'loops']),
  0x531d45: [...hist, ...F([0x78, 4, 'leaderPtr'], [0x7c, 4, 'idx'], [0x8c, 4, 'gag'], [0x90, 4, 'state'], [0x94, 4, 'leaderClip'], [0x98, 4, 'ownClip'], [0x9c, 4, 'frame'], [0xa0, 4, 'taps'], [0xa4, 4, 'leaderTag'])],
  0x5327b1: F([0, 4, 'scale'], [4, 2, 'count'], [6, 2, 'dying'], [8, 1, 'armed'], [9, 1, 'fresh'], [0xa, 2, 'how'], [0xc, 2, 'victim'], [0xe, 2, 'waving'], [0x10, 4, 'pause']),
  0x532acc: F([0, 4, 'face']),
  0x533ba8: F([0, 4, 'state'], [4, 2, 'prev'], [6, 2, 'ring'], [8, 4, 'away'], [0xc, 4, 'reloc'], [0x10, 4, 'hidden'], [0x14, 4, 'circleOff.x'], [0x18, 4, 'circleOff.y'], [0x1c, 4, 'circleOff.z']),
  0x53de63: F([0, 4, 'lastY'], [4, 4, 'run'], [8, 2, 'which'], [0xa, 1, 'arrived'], [0xb, 1, 'falling']),
  0x536e16: F([0, 4, 'timer'], [4, 64, 'fxMat']),
  0x536961: F([0, 4, 'f18'], [4, 4, 'scale'], [8, 4, 'f20'], [0xc, 4, 'phase']),
};
/** union of the observed varying bytes over several runs: { ctorHex: Uint8Array } */
export const unionVary = new Map();
export function mergeVary() {
  for (const [k, v] of obs.vary) { const u = unionVary.get(k); if (!u) unionVary.set(k, Uint8Array.from(v.varied)); else for (let i = 0; i < u.length; i++) u[i] |= v.varied[i]; }
}
/** the fields of a block that never varied: 'ctor: name, name' */
export function neverVaried() {
  const out = [];
  for (const [k, u] of unionVary) {
    const lay = LAYOUT[Number(k)]; if (!lay) continue;
    const dead = lay.filter((f) => { for (let i = 0; i < f.n; i++) if (u[f.o + i]) return false; return true; });
    if (dead.length) out.push(`${k}: ${dead.map((f) => f.name).join(', ')}`);
  }
  return out;
}

/** the verified nodes of an `IslEmu` oracle (tools/lib/m8-save.mjs) aligned with the port's: same shape as `pairNodes` */
export function m8Nodes(emu, world) {
  const out = [];
  for (const [i, r] of world.records.entries()) {
    const on = nativeNodes(emu, i), pn = portNodes(r);
    if (on.map((n) => n.ctor).join() !== pn.map((n) => n.ctor).join()) continue;
    on.forEach((o, k) => { if (NPC_CTORS.has(o.ctor)) out.push({ rec: r, k, ptr: o.ptr, ctor: o.ctor, saver: o.saver, loader: o.loader, port: pn[k] }); });
  }
  return out;
}

/**
 * the random round trip: every node of `nodes` gets `rounds` random blocks (floats kept finite) loaded into both machines (the original's loader natively, the port's `loadBlock`); then the original's
 * serializer and the port's `saveBlock` must give the same bytes again. Every field of every block (also those no scenario reaches) is thereby checked for offset, width and sign, and the loaders' own work
 * (the BrickBot leader by name tag, the speech ids of SGMFIG) for equal behaviour. `io` = { block(node), load(node, bytes) } of the machine.
 */
export function randomRoundTrip(nodes, io, w, rng, rounds = 6) {
  const fails = []; let n = 0;
  const rndBytes = (len) => {
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = Math.floor(rng() * 256);
    for (let i = 0; i + 4 <= len; i += 4) if ((b[i + 3] & 0x7f) === 0x7f && (b[i + 2] & 0x80)) b[i + 3] &= 0x3f;     // no NaN / Inf words (a NaN payload does not survive a JS number)
    return b;
  };
  for (const o of nodes) {
    if (!o.loader || !o.saver || !o.port.loadBlock) continue;
    const size = io.block(o).length;
    for (let r = 0; r < rounds; r++) {
      const bytes = rndBytes(size);
      io.load(o, bytes);
      o.port.loadBlock(w, o.rec, o.rec.ctrl, bytes);
      const ob = io.block(o), pb = o.port.saveBlock(w, o.rec, o.rec.ctrl);
      n++;
      const d = firstDiff(ob, pb);
      if (d >= 0 || ob.length !== pb.length) { if (fails.length < 20) fails.push(`random load rec ${o.rec.index} ${o.rec.name} node ${o.k} ctor 0x${o.ctor.toString(16)} round ${r}: byte ${d}: loaded ${hex(bytes.subarray(Math.max(0, d - 4), d + 8))} original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`); }
    }
  }
  return { checked: n, fails };
}

/** `io` for an `IslEmu` oracle */
export const m8Io = (emu) => ({ block: (o) => origBlock(emu, o), load: (o, bytes) => origLoad(emu, o, bytes) });
/** `io` for the NPC pair oracle */
export const pairIo = (E) => ({ block: (o) => origBlockFast(E, o.saver, o.ptr), load: (o, bytes) => origLoadFast(E, o.loader, o.ptr, bytes) });
