// WP-VERIFY M7 island ambient nodes (docs/re/m4/wp7-ambient.md): Butterfly 0x4b2d44, Swift leader 0x4b31db / Swift 0x4b3a92, Spin 0x4bdbb2, Brikimal 0x4bd4a8, Music 0x4bc773, SeaAmin 0x4b1212, Sound3d 0x538779,
// BOTMUSIC 0x536e16 / GETO 0x536961 (the Bunny 0x4b2149 belongs to the NPC oracle, tools/lib/m7-isl-npc-emu.mjs). The ORIGINAL's node framework and node code run natively in the island emulation
// (tools/lib/m7-isl-veh-emu.mjs) next to the port's nodes with the same scripted Pepper position / buttons. Randomness: the original's rand FUN_004388ae runs NATIVELY (rand() / 32767 * max in 24-bit precision); the CRT
// rand() it calls (0x85daf0) is hosted by a scripted sequence of 15-bit integers; the port's `rand` (src/island/ambient/common.ts) is fed the same integers through setAmbientRandom: every draw of a tick must match in count and order.
import { Duel, B, REC, RECORDS_BASE, lcg, randomKeys } from './m7-isl-veh-emu.mjs';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';

export { Duel, B, REC, RECORDS_BASE, lcg, randomKeys };
export const CTOR = { BUTTERFLY: 0x4b2d44, SWIFT_LEADER: 0x4b31db, SWIFT: 0x4b3a92, SPIN: 0x4bdbb2, BRIKIMAL: 0x4bd4a8, MUSIC: 0x4bc773, SEAAMIN: 0x4b1212, SOUND3D: 0x538779, BOTMUSIC: 0x536e16, GETO: 0x536961 };
export const KIND = { [0x4b2d44]: 'Butterfly', [0x4b31db]: 'SwiftLeader', [0x4b3a92]: 'Swift', [0x4bdbb2]: 'Spin', [0x4bd4a8]: 'Brikimal', [0x4bc773]: 'Music', [0x4b1212]: 'SeaAmin', [0x538779]: 'Sound3d', [0x536e16]: 'BOTMUSIC', [0x536961]: 'GETO' };

/** the shared random script: `emuDraw()` (the original's CRT rand() = a 15 bit integer) records each draw, `portDraw()` (the port's source in [0, 1)) replays them in order */
export class RandScript {
  constructor(seed) { this.rnd = lcg(seed); this.q = []; this.draws = 0; this.over = 0; }
  emuDraw() { const k = Math.floor(this.rnd() * 32768); this.q.push(k); this.draws++; return k; }
  portDraw() { const k = this.q.shift(); if (k === undefined) { this.over++; return 0.5; } return k / 32768; }
  /** after a tick: how many draws the original made that the port did not (>0) / the port made beyond the original's (over) */
  settle() { const left = this.q.length, over = this.over; this.q.length = 0; this.over = 0; return { left, over }; }
}

/**
 * @param o { dt, seed, kinds: [port kind names], ctors: Set<ctor address> (oracle), pepperFirst: Set<ctor> | null (Music), tolFree, extraExec, extraNative }
 */
export function ambientDuel(ctx, o) {
  const script = new RandScript(o.seed ?? 1);
  setAmbientRandom(() => script.portDraw());                  // (also while the port's constructors run: they draw too; those draws are not compared, see below)
  const d = new Duel(ctx, {
    node: o.node, keepKinds: o.kinds, keepRecords: o.keepRecords ?? (() => true), oracleCtors: o.ctors,
    pepperFirstKinds: o.pepperFirstKinds, pepperFirstCtors: o.pepperFirstCtors, pepSwitc: false, seat: false,
    extraExec: [...(o.extraExec ?? [])], beforeAttach: (emu, duel) => {
      duel.emu = emu;
      // the hooks must be in place BEFORE the constructors run (the decoder caches the hook it saw): FUN_004388ae natively, the CRT rand() scripted
      emu.cpu.hooks.delete(0x4388ae); emu.cpu.hooks.set(0x85daf0, (c) => { c.eax = script.emuDraw(); }); emu.cpu.invalidate();
      o.beforeAttach?.(emu, duel);
    }, extraNative: [0x4388ae, 0x4388e7, 0x43891a, 0x438936, 0x43895b, ...(o.extraNative ?? [])], draw: o.draw ?? true, ...o.duel, dt: o.dt, maxFail: o.maxFail, failures: o.failures, tolFree: o.tolFree ?? 1e-4, exact: o.exact,
  });
  if (!o.keepCtorDraws) { script.q.length = 0; script.over = 0; script.draws = 0; } else script.over = 0;   // (the port's world set-up drew for the constructors of the nodes that are not under test: not compared)
      // the constructors' draws (the nodes' random start values) are not part of the comparison unless the port makes them too (keepCtorDraws: the port's lazy constructor consumes them in its first update)
  d.script = script;
  d.cleanup = () => setAmbientRandom(null);
  return d;
}

/** the spline engine (FUN_004454e0 / FUN_00445340 / FUN_0043ecd0 / SplineBase.cpp 0x445000..0x447700) runs natively: the .man files come from the island's archive through the hosted file functions, new = the bump heap */
export const SPLINE_EXEC = [[0x43ec00, 0x43ee40], [0x445000, 0x448000]];
export function hostFiles(emu, duel) {
  const cpu = emu.cpu, mem = cpu.mem, arc = duel.P.ictx.archive;
  const files = new Map();
  let next = 0x7001;
  cpu.hooks.set(0x434188, (c) => { c.eax = emu.alloc(c.arg(0)); });                               // operator_new(size)
  cpu.hooks.set(0x435843, (c) => {                                                                // FUN_00435843(path, mode, file, line): open
    const path = mem.cstr(c.arg(0)).replace(/\\/g, '/'); const base = path.split('/').pop(), dir = path.split('/').slice(-2, -1)[0] ?? '';
    const e = arc.find(`${dir.toLowerCase() === 'matanim' ? 'MatAnim' : dir}/${base}`);
    if (!e) { c.eax = 0; return; }
    const h = next++; files.set(h, { data: arc.read(e), pos: 0 }); c.eax = h;
  });
  cpu.hooks.set(0x435350, (c) => {                                                                // FUN_00435350(dst, size, count, handle): fread
    const f = files.get(c.arg(3)); if (!f) { c.eax = 0; return; }
    const want = c.arg(1) * c.arg(2), k = Math.max(0, Math.min(want, f.data.length - f.pos));
    for (let i = 0; i < k; i++) mem.w8(c.arg(0) + i, f.data[f.pos + i]);
    f.pos += k; c.eax = c.arg(1) ? Math.floor(k / c.arg(1)) : 0;
  });
  cpu.hooks.set(0x4358e9, (c) => { files.delete(c.arg(0)); c.eax = 0; });                        // FUN_004358e9(handle, file, line): close
}

import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
/** the island loader (FUN_004f645b @0x519c09..) gives the records of `rig` an animation instance (clip 1 frame 0); the oracle world gets them here (the port's nodes create theirs lazily: `ensureAnim`) */
export function giveAnims(d, rig, names) {
  const emu = d.emu, mem = emu.cpu.mem, arc = d.P.ictx.archive, e = arc.find(`anim/${rig}.blk`);
  for (const r of d.O.world.records) {
    if (!names.test(r.name) || r.anim) continue;
    const a = new AnimInstance(parseBlk(arc.read(e))); a.start(1, 0); r.anim = a;
    const p = emu.alloc(16); emu.anims.set(p, a); emu.animRec.set(p, r.index); mem.w32(RECORDS_BASE + r.index * REC + 8, p);
  }
}

/**
 * Music.c (ctor FUN_004bc773, update FUN_004bc533, FUN_004bc190): the audio engine is NOT the subject: its entry points are hosted and logged (the same text the port's `IslandCtx` music members log): FUN_00443290 (key -> handle),
 * FUN_004432c0 (play a key; handle 0 = nothing: `if (param_1 != 0)`), FUN_00443310 (groove level), FUN_004431e0 (ambience), FUN_00873e00 (mute), FUN_00443370 (the DirectMusic notification: `duel.note`, a byte).
 */
export function hostMusic(emu, duel) {
  const cpu = emu.cpu, mem = cpu.mem, H = cpu.hooks, names = new Map();
  let nh = 0x3001;
  const lg = (s) => emu.log.push(s);
  H.set(0x443230, () => {});
  H.set(0x443290, (c) => { const h = nh++; names.set(h, mem.cstr(c.arg(0))); c.eax = h; });
  H.set(0x4432c0, (c) => { const h = c.arg(0); if (h !== 0) lg(`mus ${names.get(h) ?? '?' + h}`); });
  H.set(0x443310, (c) => { lg(`grv ${(c.arg(0) << 24) >> 24}`); });
  H.set(0x443350, () => {});
  H.set(0x443370, (c) => { c.eax = duel.note | 0; });
  H.set(0x4431e0, (c) => { lg(`amb ${mem.cstr(c.arg(0))}`); });
  H.set(0x873e00, (c) => { lg(`mut ${c.arg(0) & 0xff}`); });   // (a host's return value = the bytes it pops: no expression bodies)
  const scratch = emu.alloc(16);
  H.set(0x4040ec, (c) => { c.eax = scratch; });
  cpu.invalidate();
}
export const MUSIC_RE = /^(mus|grv|amb|mut) /;
/** the port's side: the IslandCtx members log the same text */
export function portMusic(duel) {
  const ic = duel.P.ictx, p = { push: (x) => duel.psnd.push(x) };
  duel.note = 0;
  ic.music = (k) => p.push(`mus ${k}`);
  ic.musicGroove = (l) => p.push(`grv ${l}`);
  ic.musicMute = (on) => p.push(`mut ${on ? 1 : 0}`);
  ic.ambience = (n) => p.push(`amb ${n}`);
  ic.musicNotified = () => duel.note | 0;
}
