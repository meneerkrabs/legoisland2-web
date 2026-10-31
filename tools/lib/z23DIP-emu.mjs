// Oracle of the z23DIP tests (tools/tests/m5-z23DIP-emu.mjs): the Dino island's own code run in the x86 interpreter after its emulated set-up
// (`IslandSetup.run`, docs/re/m5/foundation.md): PeppSw's update FUN_00727360 / pre-render FUN_007277f1, the balloon's constructor FUN_007281aa / update FUN_00727fe3, the HUD
// function FUN_00726610. The engine functions these call are hosts here (they log what the zone code asked of the engine, the tests compare that with what the port asked of its
// context): sounds (FUN_004435a0 / 004435b0 / 004433f0 / 004434b0), the music groove (FUN_00443310), the ground (FUN_0043cd62: a scripted terrain), the random numbers (FUN_004388ae),
// animation clip / frame readers (FUN_0043b72b / 0043b73f read the instance token's memory), the cutscene flag (FUN_0045c432).
import { emulateZoneSetup, emuSpecOf, RECORDS_BASE } from '../../src/formats/emusetup.ts';
import { loadExe, sceneOf } from './engine-load.mjs';
import { rand as crtRand } from '../../src/game/crt.ts';

// the original runs x87 at 24-bit precision (Direct3D 7 sets control word 0x7f); the Cpu reads M7_CW when it is created (tools/tests/m5-z23DIP-emu.mjs sets it for its run)
export const STRIDE = 0x68;
export const REC = { PEPP: 16, SKBD: 28, LOON: 199 };
const varsOf = (init) => { const m = new Map(Object.entries(init).map(([k, v]) => [+k, v])); return { m, get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }; };

/**
 * @param opts { node, terrain(x, y, z, dy) -> number | null, rand() -> [0, 1), cutscene() -> bool }
 * The returned object: `emu` (the IslandSetup), `ev` (the event log of the last `step`), helper functions to place Pepper / the node and to run the functions.
 */
export function dipOracle(ctx, opts = {}) {
  const pe = loadExe(ctx.dataRoot), scene = sceneOf(ctx, 'z23DIP');
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z23dip');
  const node = opts.node ?? 50;
  const vars = varsOf({ 0x58: node, 2: 1 });
  const ev = { snd: [], groove: [] };
  let tokenId = new Map();
  const hooks = new Map();
  const posOf = (c, p) => [c.mem.f32(p), c.mem.f32(p + 4), c.mem.f32(p + 8)];
  hooks.set(0x4435a0, (c) => { ev.snd.push(['p2', tokenId.get(c.arg(0) >>> 0) ?? c.arg(0)]); });
  hooks.set(0x4435b0, (c) => { ev.snd.push(['s2', tokenId.get(c.arg(0) >>> 0) ?? c.arg(0)]); });
  hooks.set(0x4434b0, (c) => { ev.snd.push(['s3', tokenId.get(c.arg(0) >>> 0) ?? c.arg(0)]); });
  hooks.set(0x4433f0, (c) => { ev.snd.push(['p3', tokenId.get(c.arg(0) >>> 0) ?? c.arg(0), posOf(c, c.arg(1))]); });
  hooks.set(0x443310, (c) => { ev.groove.push(c.arg(0) << 24 >> 24); });
  hooks.set(0x43b72b, (c) => { c.eax = c.mem.u32(c.arg(0) + 0xc); });
  hooks.set(0x43b73f, (c) => { c.fpush(c.mem.f32(c.arg(0) + 0x10)); });
  hooks.set(0x4388ae, (c) => { c.fpush(Math.fround(Math.fround((opts.rand ?? (() => crtRand() / 32767))()) * c.argf(0))); });
  hooks.set(0x45c432, (c) => { c.eax = opts.cutscene?.() ? 1 : 0; });
  const emu = emulateZoneSetup(pe, scene, { vars, archive, hooks, terrainHeight: (g, x, y, z, dy) => (opts.terrain ? opts.terrain(x, y, z, dy) : null) }, emuSpecOf('z23DIP'));
  const mem = emu.mem;
  for (const h of emu.soundHandles) tokenId.set(mem.u32(h.addr), h.id);
  // the handles of the walk code's sound set (FUN_004b0f16 / FUN_004b0b37, run by SGwalk's constructor: not part of the set-up): fake tokens, ids from the decompile
  const WALK = { 0x9da978: 0x150, 0x9da940: 0x106, 0x5d57fe0: 0x180, 0x5d57fd0: 0x17f, 0x5d57fe8: 0x182, 0x5d57fcc: 0x185, 0x5d57fdc: 0x185, 0x5d57fd8: 300, 0x5d57fc8: 0x181, 0x5d57fd4: 0x184 };
  Object.entries(WALK).forEach(([a, id], k) => { mem.w32(+a, 0x5b000000 + k); tokenId.set(0x5b000000 + k, id); });
  const recPtr = (i) => RECORDS_BASE + i * STRIDE;
  const f32 = (a) => mem.f32(a);
  const O = {
    emu, mem, ev, vars, recPtr, node, pe,
    /** record fields in the emulated machine */
    setPos(i, x, y, z) { mem.wf32(recPtr(i) + 0x3c, x); mem.wf32(recPtr(i) + 0x40, y); mem.wf32(recPtr(i) + 0x44, z); },
    getPos(i) { return [f32(recPtr(i) + 0x3c), f32(recPtr(i) + 0x40), f32(recPtr(i) + 0x44)]; },
    setFwd(i, x, y, z) { mem.wf32(recPtr(i) + 0x2c, x); mem.wf32(recPtr(i) + 0x30, y); mem.wf32(recPtr(i) + 0x34, z); },
    flags(i) { return mem.r16(recPtr(i) + 0x60); },
    setFlags(i, v) { mem.w16(recPtr(i) + 0x60, v); },
    animToken(i) { return mem.u32(recPtr(i) + 8); },
    setClip(i, clip) { mem.w32(O.animToken(i) + 0xc, clip); },
    getClip(i) { return mem.r32(O.animToken(i) + 0xc); },
    setFrame(i, f) { mem.wf32(O.animToken(i) + 0x10, f); },
    setInput(bits) { mem.w32(0x983840, bits >>> 0); },
    setMailbox(v) { mem.w8(0x8ae088, v); },
    getMailbox() { return mem.r8(0x8ae088); },
    /** run one function and collect what it did; the animation starts update the instance tokens like FUN_0043b6a3 does */
    call(fn, args) {
      ev.snd.length = 0; ev.groove.length = 0;
      const r = emu.run(fn, args);
      const starts = r.calls.filter((c) => c.name === 'animStart').map((c) => ({ token: c.args[0] >>> 0, clip: c.args[1] | 0, frame: c.args[2] }));
      for (const s of starts) mem.w32(s.token + 0xc, s.clip);
      return { eax: r.eax, starts, calls: r.calls, stores: r.stores, varWrites: r.varWrites, records: r.records, snd: [...ev.snd], groove: [...ev.groove] };
    },
    /** the PeppSw node: a fresh 0x30 byte block as FUN_00727e84 would leave it (without running the constructor: it calls FUN_007651a3, outside the emulated region) */
    makeNode(story, pos) {
      const n = emu.alloc(0x40);
      mem.w32(n, 0x5e); mem.w32(n + 8, 0xfffffffe); mem.w16(n + 0xc, 0); mem.w16(n + 0xe, 0);
      mem.w32(n + 0x18, 1); mem.w32(n + 0x1c, 1); mem.w8(n + 0x20, story === 50 ? 1 : 0);
      mem.wf32(n + 0x24, pos[0]); mem.wf32(n + 0x28, pos[1]); mem.wf32(n + 0x2c, pos[2]);
      return n;
    },
    /** read the node's state words */
    nodeState(n) { return { groove: mem.r32(n + 0x18), last: mem.r32(n + 0x1c), safe: [f32(n + 0x24), f32(n + 0x28), f32(n + 0x2c)] }; },
  };
  return O;
}
