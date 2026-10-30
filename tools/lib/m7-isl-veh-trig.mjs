// WP-VERIFY M7: the island's trigger families (StartCSM trigger 0x51e19c + box portal 0x51ea3c, building door 0x535e80 / swinging part 0x5364a5 / page 0x535281 / music house 0x5357cb, LGI_FSM 0x4b8c73, hOLO 0x88df51)
// as an oracle for src/island/trigger/*.ts: the original's constructors (the attach FUN_00423532 with the set-up's own argument blocks) and update / pre-render hooks run natively in the IslEmu of
// tools/lib/m7-isl-veh-emu.mjs next to the port's nodes of the same world, with the same scripted Pepper position / buttons / variables; cutscene starts (FUN_0045c40c), walker pins (FUN_004625d7) are hosted loggers.
import { Duel, IslEmu, RECORDS_BASE, REC, VAR_ARRAY, lcg } from './m7-isl-veh-emu.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';

/** a Duel for trigger nodes: both worlds keep only the nodes of the given kinds; the cutscene model (K ticks per started cutscene, both sides), the cutscene-start and walker-pin logs */
// a constructor whose raw argument is 0 gets NULL from the original's set-up (hOLO's `arg == 0` = hide after use); IslEmu.argBlock always hands out the 0x80 byte block: with `argZero` a zero raw argument stays 0
const _argBlock = IslEmu.prototype.argBlock;
IslEmu.prototype.argBlock = function (a) { return (globalThis.__argZero || globalThis.__argZeroCtors?.has(a.ctor)) && a.arg === 0 ? 0 : _argBlock.call(this, a); };
export function trigDuel(ctx, o) {
  globalThis.__bldgHooks = !!o.bldg; globalThis.__argZero = !!o.argZero;
  let d;
  const ba = o.beforeAttach;
  try { d = new Duel(ctx, { pepSwitc: false, seat: false, ...o, beforeAttach: (emu, duel) => { emu.cpu.mem.write(emu.brk, new Uint8Array(0x800000).fill(0xcd)); ba?.(emu, duel); } }); } finally { globalThis.__bldgHooks = false; globalThis.__argZero = false; }
  const emu = d.emu, cpu = emu.cpu, H = cpu.hooks, W = d.P.world, ic = d.P.ictx;
  d.csTicks = o.csTicks ?? 12;
  d.csLeft = 0;
  d.plog = [];
  H.set(0x45c40c, (c) => { emu.log.push(`cs ${c.arg(0) | 0}`); d.csLeft = d.csTicks; emu.cutscene = true; c.eax = 1; });
  H.set(0x4625d7, (c) => { emu.log.push(`pin ${(c.arg(2) << 16) >> 16}`); });
  const start = ic.startCutscene.bind(ic);
  ic.startCutscene = (slot) => { d.plog.push(`cs ${slot}`); ic.cutsceneTicks = 1e9; const r = start(slot); return r; };
  d.pinSpy = (on) => {
    if (on) { d._tp = waypoints.teleport; waypoints.teleport = function (h, n) { d.plog.push(`pin ${n}`); return d._tp.call(this, h, n); }; } else if (d._tp) { waypoints.teleport = d._tp; d._tp = null; }
  };
  // Pepper's walker (afterSetup of the zone game): the StartCSM trigger teleports it
  const pep = d.P.pepper;
  if (pep.ctrl && !pep.ctrl.walker) { try { pep.ctrl.walker = waypoints.create(1, pep, -3); } catch { /* none */ } }
  return d;
}

/** advance one tick of both worlds with the cutscene model; returns { o: original's log lines, p: port's log lines } of this tick */
export function trigTick(d, held) {
  d.plog.length = 0;
  d.tick(held);
  // the original's 3D sound stop (FUN_004434b0, logged 's3') is the port's ctx.stopSfx ('s2')
  d.olog = d.olog.map((l) => (l.startsWith('s3 ') ? `s2 ${l.slice(3)}` : l));
  const o = d.olog.filter((l) => /^(cs|pin) /.test(l)), p = [...d.plog];
  // the cutscene model: both sides count the same ticks (the original's flag via FUN_0045c432, the port's mock via ictx.cutsceneActive)
  if (d.csLeft > 0) { d.csLeft--; if (d.csLeft === 0) d.emu.cutscene = false; }
  const ic = d.P.ictx;
  if (ic.cutsceneLeft > 0) { ic.cutsceneLeft = d.csLeft; } else ic.cutsceneLeft = 0;
  ic.cutsceneLeft = d.csLeft;
  return { o, p };
}

/** sets the same game variable value in both worlds, the same vehicle kind (DAT_009da9f8 hi word) */
export function setKind(d, kind) { d.emu.cpu.mem.w16(0x9da9fa, kind & 0xffff); vehicles(d.P.world).kind = kind; }
/** Pepper's clip in both worlds */
export function setClip(d, clip) { for (const r of [d.O.pepper, d.P.pepper]) r.anim?.start(clip, 0); }
export { RECORDS_BASE, REC, VAR_ARRAY, lcg };

import { baseParts, partMatrix } from '../../src/island/trigger/parts.ts';
/** hooks for the building family: FUN_0043ea40 (part count of a record's model), the draw capture (the record's matrix at FUN_00444480 time: the music house's bounce only lives during the draw) */
// (installed while the Duel is constructed: the constructors that run during the attach need FUN_0043ea40; only when `globalThis.__bldgHooks` is set, so other tests' emulations are unchanged)
const _initHosts = IslEmu.prototype.initHosts;
IslEmu.prototype.initHosts = function () {
  _initHosts.call(this);
  if (!globalThis.__bldgHooks) return;
  const emu = this, mem = emu.cpu.mem, H = emu.cpu.hooks;
  H.set(0x43ea40, (c) => { const idx = ((c.arg(0) - 0x40000000) / 0x100) | 0; c.eax = (emu.o.parts?.(idx) ?? []).length; });
  emu.drawM = new Map();
  const base = H.get(0x444480);
  H.set(0x444480, (c) => { const a = c.arg(0), i = (a - RECORDS_BASE) / REC; emu.drawM.set(i, Array.from({ length: 16 }, (_, k) => mem.f32(a + 0xc + 4 * k))); return base(c); });
};
export function bldgHooks(d) {
  const emu = d.emu, mem = emu.cpu.mem;
  // the original's live part matrix of record i, index k (the buffer FUN_0043ea60 hands out)
  d.origPart = (i, k) => { const tok = 0x40000000 + i * 0x100; const buf = emu.partBufs.get(i); if (!buf) return null; return Array.from({ length: 16 }, (_, q) => mem.f32(buf + k * 0x40 + 4 * q)); };
  d.portPart = (i, k) => partMatrix(d.P.world, d.P.world.records[i], k);
  void baseParts;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// hOLO: the speech / text / camera-hold services the hologram node uses (the original's FUN_00439bf8 text lookup, FUN_00435a11 say, FUN_00435ad3 idle, FUN_00435b07 stop, FUN_0045f750 / 0045f767 camera hold)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { Objective } from '../../src/zones/z02LGI/objective.ts';
import { setObjective, portTarget } from './m7-isl-veh-story.mjs';

/**
 * Host the services on the original side from the SAME message table the port uses (the .str file is the shared input; the lookup semantics are the original's: FUN_00439bf8 returns the text with its 4 character voice
 * field and writes the voice id, or (not found) the key itself and -1) and mirror them on the port's mock island context.
 * @param table the MessageTable of the hologram hints (lihol N.str)
 */
export function holoServices(d, table) {
  const emu = d.emu, mem = emu.cpu.mem, H = emu.cpu.hooks, ic = d.P.ictx;
  d.sayLeft = 0; d.said = []; d.psaid = []; d.camLog = []; d.pcam = [];
  // original: text lookup (the table = DAT_05defbc4 is ignored: one table)
  H.set(0x439bf8, (c) => {
    const key = mem.cstr(c.arg(1)), e = table.find(key);
    if (!e) { mem.w32(c.arg(2), 0xffffffff); c.eax = c.arg(1); return; }
    const v = table.voice(key);
    mem.w32(c.arg(2), v >>> 0);
    const buf = emu.alloc(e.text.length + 8);
    for (let i = 0; i < e.text.length; i++) mem.w8(buf + i, e.text.charCodeAt(i) & 0xff);
    mem.w8(buf + e.text.length, 0);
    c.eax = buf;
  });
  H.set(0x435a11, (c) => { d.said.push(`say v${c.arg(0) | 0}`); d.sayLeft = 60; c.eax = 1; });
  H.set(0x435ad3, (c) => { c.eax = d.sayLeft <= 0 ? 1 : 0; });
  H.set(0x435b07, (c) => { d.said.push('stop'); d.sayLeft = 0; c.eax = 0; });
  H.set(0x45f750, (c) => { mem.w32(0x5d4dcbc, c.arg(0)); d.camLog.push(`camhold ${c.arg(0) | 0}`); });
  H.set(0x45f767, (c) => { c.eax = mem.r32(0x5d4dcbc); });
  H.set(0x45d47f, () => {});    // the subtitle
  // port: the mock context
  ic.text.hol = table;
  // FUN_0088d666 (0x88db12) reads var 9 (speech on): 0 -> no FUN_00435a11 voice call at all (only the subtitle FUN_0045d47f): the port's HoloNode then calls ctx.say(table, id, undefined, false)
  ic.say = (t, id, id2, voice) => { if (voice === false) { if (d.P.world.vars.get(9) !== 0) d.fail(`ctx.say('${id}') without a voice while var 9 != 0`); return true; } if (d.P.world.vars.get(9) === 0) d.fail(`ctx.say('${id}') with a voice while var 9 == 0 (original: no voice call)`); if (ic.sayLeft > 0) return false; d.psaid.push(`say v${t.voice(id)}`); ic.sayLeft = 60; return true; };
  ic.speechIdle = () => ic.sayLeft <= 0;
  ic.stopSpeech = () => { d.psaid.push('stop'); ic.sayLeft = 0; };
  ic.cameraHold = (on) => { d.pcam.push(`camhold ${on ? 2 : 0}`); };
  d.goal = new Objective();
  d.records = d.P.world.records;
  ic.objective = { target: (from) => { const t = portTarget(d, from.index); return t.ok ? { pos: t.pos, record: t.record } : null; }, get holoTimer() { return d.goal.holoTimer; }, set holoTimer(v) { d.goal.holoTimer = v; } };
}
export { setObjective };
