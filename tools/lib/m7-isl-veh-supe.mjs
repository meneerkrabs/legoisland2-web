// WP-VERIFY M7 (island gameplay nodes): the SUPE oracle session. The original's SupaStat constructor FUN_0053c337 / update FUN_0053adc3 (steering FUN_00539eb1, turns FUN_0053a7d8, flight FUN_0053aa8e, camera
// FUN_0053ab93, carry FUN_0053ac79) run NATIVE in the x86 emulation next to the port's SupeNode (src/island/pizza/supe.ts), on the island state the original's own set-up left (the waypoint maps loaded by
// FUN_004630c0 are in the copied pages; the route / node queries FUN_00462bd0 / FUN_00463b49 / FUN_00462c18 / FUN_00462be9 run natively). Hosted (NOT the subject): collision / terrain queries (the port's world),
// the animation instances (the port's AnimInstance), rand FUN_004388ae (one scripted sequence shared by both: `Math.random` of the port is replaced by it), the cutscene test, sounds (logged), game vars.
// Scripted inputs: Pepper's place, the surface under her feet (DAT_009da9ac / w.pep.surfaceAtFeet), the renderer's in-view flag of the SUPE record (flag bit 0 / ictx.inFrustum), the camera eye, the locomotive's record,
// cutscenes. Pepper's walk node is the 576-writer stub of the Duel (src/../m7-isl-veh-emu.mjs).
import { Duel, B, RECORDS_BASE, REC, lcg, fr } from './m7-isl-veh-emu.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { waypoints } from '../../src/game/walker.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { npcRig } from '../../src/island/npc/sgmfig.ts';

export { Duel, B, RECORDS_BASE, REC, lcg };
/** pure map / route functions of the walker module that the node code calls: executed natively from the executable */
export const MAP_NATIVE = [0x4388e7, 0x462bd0, 0x463b49, 0x462c18, 0x462be9];

/**
 * @param ctx test context; o { dt, node, seed, syncMode, failures, label, maxFail, pepper: [x, y, z, ry] }
 */
export function supeSession(ctx, o) {
  const rnd = lcg(o.seed ?? 4242), rndP = lcg(o.seed ?? 4242);   // the i-th draw of the original = the i-th draw of the port
  const realRandom = Math.random;
  // one scripted random source for both: the original's FUN_004388ae(x) = rnd * x (the `rng.range` host), the port's Math.random
  const d = new Duel(ctx, { node: o.node ?? 2, keepKinds: ['supe'], keepRecords: (n) => n === 'SUPE', dt: o.dt, maxFail: o.maxFail ?? 30, failures: o.failures, tolFree: 1e-4, grazeMax: o.grazeMax ?? 4, pepSwitc: false, seat: false,
    rng: { range: (x) => { const v = rnd(); d.lastRnd.push(v); return v * x; } } });
  d.lastRnd = [];
  d.drew = false;
  Math.random = () => { const v = rndP(); d.lastRnd.push(v); d.drew = true; return v; };
  d.restore = () => { Math.random = realRandom; };
  d.label = o.label; d.syncMode = !!o.syncMode;
  const cpu = d.emu.cpu, mem = cpu.mem, W = d.P.world;
  for (const a of MAP_NATIVE) cpu.native.add(a);
  cpu.invalidate();
  const supe = W.records.findIndex((r) => r.name === 'SUPE');
  d.supe = supe;
  d.viewFlag = true;
  d.P.ictx.inFrustum = () => d.viewFlag;
  d.setSurface = (s) => { mem.w32(0x9da9ac, s); W.pep.surfaceAtFeet = s; };
  d.setSurface(0);
  // SUPE's animation instance (+8): the original's loader gives every NPC record one; the port's SGMFIG node (not run here) creates it. Same rig in both worlds, clip 0x78 (his idle: SGMFIG's argument)
  { const rig = npcRig(W);
    if (rig) {
      const emu = d.emu, pm = AnimInstance;
      d.P.world.records[supe].anim = new pm(rig); d.P.world.records[supe].anim.start(0x78, 0);
      d.O.world.records[supe].anim = new pm(rig); d.O.world.records[supe].anim.start(0x78, 0);
      const ptr = emu.alloc(16); emu.anims.set(ptr, d.O.world.records[supe].anim); emu.animRec.set(ptr, supe); mem.w32(RECORDS_BASE + supe * REC + 8, ptr);
    } }
  d.setCamera = (eye, at) => { const c = [...eye, ...at]; for (let k = 0; k < 6; k++) { W.camera.c[k] = c[k]; mem.wf32(0x9da5e8 + 4 * k, c[k]); } };
  // Pepper is placed BEFORE the constructor runs (FUN_0053c337 reads her z): the original's attach here, the port's node initialises at its first update
  d.placePepper(...(o.pepper ?? [0, 20, 0, 0]));
  const att = d.O.profile.island.attaches.find((a) => a.record === supe && a.ctorName === 'SupaStat');
  d.node = d.emu.attach(att);
  // the oracle's record state of SUPE after the constructor is what the port's init writes at the first update; the two are compared from the first tick on
  const prevTick = d.tick.bind(d);
  d.tick = (held) => {
    // the renderer's frustum flag of SUPE (bit 0) as the scripted view says; both worlds
    const a = RECORDS_BASE + supe * REC;
    mem.w16(a + 0x60, (mem.r16(a + 0x60) & ~1) | (d.viewFlag ? 1 : 0));
    mem.w32(0x9da9ac, W.pep.surfaceAtFeet);
    prevTick(held);
  };
  const pn = d.pnode(supe, 'supe');
  /** the SUPE node's fields: original block vs the port's node */
  d.nodeCompare = () => {
    const n = d.pnode(supe, 'supe'), a = d.node;
    d.eq('SUPE state', mem.r8(a + 0x38), n.state);
    d.eq('SUPE mode', mem.r8(a + 0x3b), n.mode);
    d.eq('SUPE dest', mem.r32(a + 0x28), n.dest); d.eq('SUPE goal', mem.r32(a + 0x2c), n.goal); d.eq('SUPE next', mem.r32(a + 0x30), n.next);
    d.eq('SUPE steerBits', mem.r8(a + 0x3a) << 24 >> 24, n.steerBits);
    d.cmp('SUPE speed', mem.f32(a + 0x34), n.speed);
    d.cmp('SUPE zoneA', mem.f32(a + 0x14), n.zoneA); d.cmp('SUPE zoneB', mem.f32(a + 0x18), n.zoneB);
    return n;
  };
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the Ptera / glider session (Ptera.c: ctor FUN_004bb1a6, update FUN_004b93b0, pre-render FUN_004baf1b) with PepSwitc natively as Pepper's mode switch
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { ensureAnim, setAmbientRandom } from '../../src/island/ambient/common.ts';

/** @param o { dt, node (52 / 61), seed, syncMode, failures, label } */
export function pteraSession(ctx, o) {
  // every third draw is small: the 1-in-16 chance of the glide clip at a loop end (rand(16) < 1) is then taken often enough to be seen
  const gen = (seed) => { const r = lcg(seed); let i = 0; return () => (i++ % 3 === 0 ? 0.01 : r()); };
  const rnd = gen(o.seed ?? 99), rndP = gen(o.seed ?? 99);
  const d = new Duel(ctx, { node: o.node ?? 52, keepKinds: ['Ptera'], keepRecords: (n) => n === 'PTER' || n === 'GLDR', dt: o.dt, maxFail: o.maxFail ?? 30, failures: o.failures, tolFree: 1e-4, grazeMax: o.grazeMax ?? 3, seat: false,
    // FUN_004388ae(x) = rand() / 32767 * x with rand() = a 15 bit integer: the port's `rand` (ambient/common.ts) floors source() * 32768: the same scripted source for both
    rng: { range: (x) => (Math.floor(rnd() * 32768) / 32767) * x } });
  d.label = o.label; d.syncMode = !!o.syncMode;
  setAmbientRandom(rndP);
  d.restore = () => setAmbientRandom(null);
  const mem = d.emu.cpu.mem, W = d.P.world;
  for (const a of MAP_NATIVE) d.emu.cpu.native.add(a);
  d.emu.cpu.invalidate();
  // FUN_0043b92a(anim, rate): 2 when the clip would wrap with this tick's advance: frameCount < (1.0 + frame) + rate * dt (all float32), read from the decompile / the asm (0x43b92a); the instance itself is the port's AnimInstance
  d.emu.cpu.hooks.set(0x43b92a, (c) => { const a = d.emu.anims.get(c.arg(0)); c.eax = a && a.frameCount > 0 && fr(fr(1 + a.frame) + fr(fr(c.argf(1)) * fr(d.dt))) > a.frameCount ? 2 : 0; });
  d.vehicle = {};
  for (const name of ['PTER', 'GLDR']) {
    const i = W.records.findIndex((r) => r.name === name);
    d.vehicle[name] = i;
    // PTER's animation instance (the original's loader gives the record its rig; the port's node creates it through `ensureAnim` at its first update): the same in both worlds, clip 1, registered with the emulation's host
    if (name === 'PTER') {
      const ap = ensureAnim(d.P.world, d.P.world.records[i]), ao = ensureAnim(d.O.world, d.O.world.records[i]);
      if (ap && ao) { ap.start(1, 0); ao.start(3, 0);   /* the constructor's FUN_0043b6a3(anim, 3, 0) ran at the attach, before this instance existed here */  const ptr = d.emu.alloc(16); d.emu.anims.set(ptr, ao); d.emu.animRec.set(ptr, i); mem.w32(RECORDS_BASE + i * REC + 8, ptr); }
    }
  }
  /** put a record at a place in both worlds (the oracle through putRecord) */
  d.putVehicle = (name, x, y, z, ry = 0, rx = 0) => {
    const i = d.vehicle[name];
    for (const w of [d.P.world, d.O.world]) { const r = w.records[i]; r.setEuler(rx, ry, 0, x, y, z); r.rx = rx; r.ry = ry; r.rz = 0; }
    d.emu.putRecord(i, d.O.world.records[i]); d.emu.sync();
  };
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the PepSwitc / looks session: Pepper's mode switch (PepSwitc update FUN_004bb630 / pre-render FUN_004bb67d: walk, swim, skateboard, Enter-looks FUN_0051db5c / FUN_0051dbd7) with scripted
// walk-node state (mailbox DAT_008ae088, PEPPER_CONTROL), Pepper's clip, her place, the view flags of the records, the held / pressed keys.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { parseBlk } from '../../src/formats/anim.ts';
import { ensureLooks, looksOf } from '../../src/island/vehicles/looks.ts';

export function switchSession(ctx, o) {
  const d = new Duel(ctx, { node: o.node ?? 2, keepKinds: [], keepRecords: () => false, dt: o.dt, maxFail: o.maxFail ?? 30, failures: o.failures, tolFree: 1e-4, seat: false });
  d.label = o.label; d.syncMode = false;
  const mem = d.emu.cpu.mem, W = d.P.world, emu = d.emu;
  // the SwapText cycler (FUN_00443810(set, model) -> a 0x14 byte object: +0 look count, +4 the swap table record, +8 model, +0xc look, +0x10 variant): the texture work of the engine is not the subject
  // (hosted: the object is built as in the decompile, without the texture lists); the cycler's logic FUN_00443b00 / FUN_004439f0 (the look / variant counters) / FUN_004439c0 run NATIVE
  mem.w32(0x9e06ec, 1);
  emu.cpu.hooks.set(0x443810, (c) => {
    const set = c.arg(0) | 0, p = emu.alloc(0x14);
    mem.w32(p + 8, c.arg(1)); mem.w32(p + 4, 0x8b5028 + set * 0x18);
    let n = 0; for (let va = 0x8b5028 + set * 0x18; (mem.r32(va) | 0) > 0; va += 0x18) n++;
    mem.w32(p, n); mem.w32(p + 0xc, 0); mem.w32(p + 0x10, 0); c.eax = p;
  });
  for (const a of [0x443b00, 0x4439f0, 0x4439c0]) emu.cpu.native.add(a);
  for (const a of MAP_NATIVE) emu.cpu.native.add(a);
  emu.cpu.invalidate();      // (decoded instructions are cached with their hook / fallback decision)
  // the roster constructor again, now with the cycler handles (the Duel's own run had none: FUN_00443810 was unhosted)
  for (let c = 0; (mem.r32(0x8e9b28 + c * 0x18) | 0) !== -1; c++) mem.w32(0x8e9b28 + c * 0x18 + 8, 0xbabababa);   // the table's initial handle: FUN_004202ef creates the cycler only for it
  emu.cpu.steps = 0; emu.cpu.call(0x51c823, [], { maxSteps: 20_000_000 });
  // the board's animation instance (SKBD.blk, clip 3 as the original's loader / the port's SkateNode leave it): the same in both worlds
  const bi = 9;
  { const e = d.P.ictx.archive.find('anim/SKBD.blk');
    if (e) { const rig = parseBlk(d.P.ictx.archive.read(e));
      for (const w of [d.P.world, d.O.world]) { w.records[bi].anim = new AnimInstance(rig); w.records[bi].anim.start(3, 0); }
      const ptr = emu.alloc(16); emu.anims.set(ptr, d.O.world.records[bi].anim); emu.animRec.set(ptr, bi); mem.w32(RECORDS_BASE + bi * REC + 8, ptr); } }
  d.board = bi;
  d.P.ictx.objective = { holoTimer: 0 };
  d.viewSet = new Set();
  d.P.ictx.inFrustum = (rec) => d.viewSet.has(rec.index);
  const prevTick = d.tick.bind(d);
  d.tick = (held) => {
    for (let i = 0; i < d.O.world.records.length; i++) { const a = RECORDS_BASE + i * REC + 0x60, f = mem.r16(a); const want = d.viewSet.has(i) ? 1 : 0; if ((f & 1) !== want) mem.w16(a, (f & ~1) | want); }
    prevTick(held);
  };
  /** the port's roster after its first pre-render, with valid brick effect slots (as a game with the brick library: the original's host hands out a handle for every entry) */
  d.armLooks = () => { const L = ensureLooks(W); if (L) L.entries.forEach((e, i) => { e.slot = i; }); return L; };
  d.setPC = (v) => { mem.w32(VAR_ARRAY_ADDR + 4 * 0x5e, v); W.vars.set(0x5e, v); };
  d.setPepperClip = (clip) => { d.O.pepper.anim?.start(clip, 0); d.P.pepper.anim?.start(clip, 0); };
  return d;
}
const VAR_ARRAY_ADDR = 0x8a2d2c;
