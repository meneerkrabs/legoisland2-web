// WP-VERIFY M7: the island's story handler FUN_004b7040 and the objective (FUN_00424270 / 230 / 19f / 2b9, FUN_00424e37) as an oracle for src/zones/z02LGI/story.ts + objective.ts + liveStoryEnv (src/zones/z02LGI/index.ts).
// The ORIGINAL's handler runs natively in the x86 emulation (IslEmu of tools/lib/m7-isl-veh-emu.mjs: the island's machine state of the original's own set-up, cpu.cw = 0x7f) with the engine functions the handler calls
// hosted as loggers (text tables FUN_00423fe0 / 423ff6 / 88d280 / 88d296, walker pins FUN_0046140f / 4625d7); the objective setters, FUN_00417597 / 41761b / 41766c (hosted var array) and FUN_00429638 run natively.
// The port side is the real `storyHandler` with the real `liveStoryEnv` over the port world (its own flag / variable / objective glue), a mini island context recording the text calls.
import { Duel, RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT } from './m7-isl-veh-emu.mjs';
import { storyHandler } from '../../src/zones/z02LGI/story.ts';
import { liveStoryEnv } from '../../src/zones/z02LGI/index.ts';
import { Objective } from '../../src/zones/z02LGI/objective.ts';

export const PREV_UNINIT = 0xcccccccc | 0;

/** a Duel at an era-3 story node whose records 12 / 13 (PAPA / MAMA) carry the pizza-carry nodes the node 0x36 branch resets */
export function storyDuel(ctx, o = {}) {
  const d = new Duel(ctx, { node: o.node ?? 0x36, keepKinds: ['Pizza', 'PizzaCarry'], keepRecords: (n) => n === 'PAPA' || n === 'MAMA', dt: o.dt ?? 1, pepSwitc: false, seat: false, maxFail: o.maxFail ?? 40, failures: o.failures });
  const emu = d.emu, cpu = emu.cpu, mem = cpu.mem, H = cpu.hooks;
  const olog = (emu.slog = []);
  const str = (p) => mem.cstr(p);
  H.set(0x423ff6, () => { olog.push('free npc'); });
  H.set(0x88d296, () => { olog.push('free hol'); });
  H.set(0x423fe0, (c) => { olog.push(`npc ${str(c.arg(0))}`); });
  H.set(0x88d280, (c) => { olog.push(`hol ${str(c.arg(0))}`); });
  const ri = (p) => (p - RECORDS_BASE) / REC;
  // FUN_0046140f(walker, node, rec) / FUN_004625d7(walker, rec, node): the walker handle is the record index (the dummy controller's +0x10, see below)
  H.set(0x46140f, (c) => { olog.push(`place ${ri(c.arg(2))} ${c.arg(1)} w${c.arg(0)}`); });
  H.set(0x4625d7, (c) => { olog.push(`pin ${ri(c.arg(1))} ${c.arg(2)} w${c.arg(0)}`); });
  // records without a controller at set-up time (the era-3 walkers of node 0x36 are attached by the NPC worker's families): a dummy controller block, walker handle (+0x10) = the record index
  const spare = emu.alloc(0x20 * 512);
  d.dummyCtrl = (r) => { const at = RECORDS_BASE + r * REC + 0x5c; if (!mem.r32(at)) { const blk = spare + 0x20 * r; mem.w32(blk + 0x10, r); mem.w32(at, blk); } };
  d.records = d.P.world.records;
  // the port side: a mini island context for liveStoryEnv
  const W = d.P.world;
  d.goal = new Objective();
  d.plog = [];
  d.cutsceneOn = false;
  const pe = d.pe;
  d.ictxS = { world: W, goal: d.goal, pe, cutsceneActive: () => d.cutsceneOn, setText: (which, raw) => d.plog.push(raw === null ? `free ${which}` : `${which} ${raw}`) };
  return d;
}

/** the original's FUN_004b7040(&next, &prev, node) with the cutscene flag; returns { ret, next, prev, log } */
export function origStory(d, prev, node, cutscene) {
  const emu = d.emu, cpu = emu.cpu, mem = cpu.mem;
  emu.cutscene = cutscene;
  emu.slog.length = 0; emu.varWrites = [];
  const pn = emu.alloc(16), pp = pn + 8;
  mem.w32(pn, -10); mem.w32(pp, prev);
  cpu.steps = 0;
  const ret = cpu.call(0x4b7040, [pn, pp, node], { maxSteps: 2_000_000 }) | 0;
  return { ret, next: mem.r32(pn) | 0, prev: mem.r32(pp) | 0, log: [...emu.slog], vw: [...emu.varWrites] };
}

/** the port's handler through liveStoryEnv, the env's effects logged */
export function portStory(d, prev, node, cutscene) {
  const W = d.P.world, vars = W.vars, log = [], vw = [];
  d.cutsceneOn = cutscene; d.plog.length = 0;
  const env = liveStoryEnv(d.ictxS);
  const e2 = { ...env };
  e2.vars = {
    get: (i) => vars.get(i),
    set: (i, v) => { vw.push(`set ${i} ${v | 0}`); vars.set(i, v); },
    or: (i, v) => { vw.push(`or ${i} ${v | 0}`); vars.or(i, v); },
    andNot: (i, v) => { vw.push(`andnot ${i} ${v | 0}`); vars.andNot(i, v); },
  };
  e2.walkerPin = (r, n) => { log.push(`place ${r} ${n} w${r}`); log.push(`pin ${r} ${n} w${r}`); env.walkerPin(r, n); };
  e2.pizzaReset = (r) => { log.push(`pizzaReset ${r}`); env.pizzaReset(r); };
  e2.holoAlert = () => { log.push('holo'); env.holoAlert(); };
  const ref = { prev, next: -10 };
  const ret = storyHandler(e2, ref, node);
  // text calls come from the mini context: free npc / free hol as the original's two calls, then the files
  const texts = d.plog.map((l) => l.replace(/^free (npc|hol)$/, 'free $1').replace(/^(npc|hol) (.*)$/, (_, k, p) => `${k} ${p}`));
  return { ret, next: ref.next, prev: ref.prev, texts, log, vw };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// FUN_00424e37(&out, from): the objective's target (Objective.target of src/zones/z02LGI/objective.ts) against the original's code
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { pathPositions } from '../../src/zones/z02LGI/index.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { waypoints } from '../../src/game/walker.ts';
import { bitsOf } from './m7-isl-veh-emu.mjs';

/** the original's objective setters (native) and the port's, same arguments: `spec` = { mode, a, b, c, d, node, r } (records as indices, -1 = null) */
export function setObjective(d, spec) {
  const emu = d.emu, cpu = emu.cpu, g = d.goal;
  const rp = (i) => (i >= 0 ? emu.recPtr(i) : 0);
  cpu.steps = 0;
  switch (spec.kind) {
    case 'record': cpu.call(0x424270, [rp(spec.a), bitsOf(16)], { maxSteps: 100000 }); g.record(spec.a, 16); break;
    case 'pair': cpu.call(0x424230, [rp(spec.a), rp(spec.b), bitsOf(8)], { maxSteps: 100000 }); g.pair(spec.a, spec.b, 8); break;
    case 'four': cpu.call(0x42419f, [rp(spec.a), rp(spec.b), rp(spec.c), rp(spec.d)], { maxSteps: 100000 }); g.four(spec.a, spec.b, spec.c, spec.d); break;
    case 'node': cpu.call(0x4242b9, [spec.node, bitsOf(16)], { maxSteps: 100000 }); g.pathNode(spec.node, 16); break;
    default: throw new Error('objective kind');
  }
}

/** original FUN_00424e37 -> { ok, pos[3], record } */
export function origTarget(d, fromIndex) {
  const emu = d.emu, cpu = emu.cpu, mem = cpu.mem;
  const out = emu.alloc(16);
  mem.w32(out, 0);
  cpu.steps = 0;
  const ok = (cpu.call(0x424e37, [out, emu.recPtr(fromIndex)], { maxSteps: 1_000_000 }) & 0xff) !== 0;
  const m = mem.r32(out);
  if (!ok && !m) return { ok: false };
  const idx = m >= RECORDS_BASE && m < RECORDS_BASE + REC * d.records.length ? ((m - 0xc - RECORDS_BASE) / REC) : -1;
  return { ok, written: true, pos: [mem.f32(m + 0x30), mem.f32(m + 0x34), mem.f32(m + 0x38)], record: idx };
}

/** the port's Objective.target with the arguments the island context passes (ctx.ts `objective.target` / `vehicleObjective`) */
export function portTarget(d, fromIndex) {
  const W = d.P.world, G = vehicles(W);
  d.pathPos ??= pathPositions(d.O.archive);
  const veh = { kind: G.kind, docks: G.docks, pads: G.pads, nodePos: (map, node) => waypoints.nodePos(map, node) };
  const t = d.goal.target(W.records, W.records[fromIndex], W.vars.get(0x5e), d.pathPos, veh);
  return t ? { ok: true, pos: t.pos, record: t.record } : { ok: false };
}
