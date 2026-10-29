// The probe pass of the node framework (FUN_00427233, src/game/probe.ts) hooked up to the port's world: every zone loop of the original calls it once per frame between the update pass and the
// pre-render pass. A node arms its controller's probe from its update (`armControllerProbe` = FUN_00427014); `runProbePass` then samples the ground / sweeps the collision world for every armed
// controller, writes the result into the controller (`ctrl.probe.result / start / delta`) and, with flag 2, into the record's position (docs/re/rendering.md section 13 / gaps.md R14).
import type { World } from './world.ts';
import type { GameRecord } from './record.ts';
import type { Controller } from './controller.ts';
import { armProbe, newProbeCtrl, probePass } from './probe.ts';
import type { ProbeCtrl, ProbeEnv, ProbeRecord, ProbeScratch } from './probe.ts';
import { NO_GROUND } from './collision.ts';

/** the controller's probe block (created on first use: the original's controllers are zero-filled blocks) */
export function probeOf(ctrl: Controller): ProbeCtrl { return (ctrl.probe ??= newProbeCtrl()); }

/** FUN_00427014(ctrl, offset, delta, mask, flags): arms the controller's probe for the next probe pass */
export function armControllerProbe(ctrl: Controller, off: ArrayLike<number>, delta: ArrayLike<number>, mask: number, flags: number): ProbeCtrl {
  const p = probeOf(ctrl);
  armProbe(p, off, delta, mask, flags);
  return p;
}

/** FUN_0043ce45(pos, 4.0): FUN_004425f0 with the 300 unit ray `DAT_008b1a40` (FUN_0043cd62 uses `DAT_008b1a30`, 500 units): the ground record's height below pos + (0, dy, 0) */
export function groundHeight300(w: World, x: number, y: number, z: number, dy = 4): number {
  const g = w.col.groundRec;
  if (!g) return NO_GROUND;
  const fr = Math.fround;
  const h = w.col.rayRecord(g, [x, fr(fr(y) + fr(dy)), z], [0, -300, 0], 3, 1.0, 0.1);
  return h ? fr(h.point[1] - fr(0.1)) : NO_GROUND;
}

/** the engine calls the pass makes, on the world's collision (the same functions the walk node uses) */
export function probeEnvOf(w: World): ProbeEnv {
  return {
    dt: w.dt,
    ground: (p) => w.col.terrainHeight(p[0], p[1], p[2], 4),
    ground2: (p) => groundHeight300(w, p[0], p[1], p[2], 4),
    sweep: (owner, from, delta, mask, radius, skin, probe) => {
      const rec = (owner as unknown as { rec: GameRecord }).rec ?? null;
      const hit = probe ? w.col.probe(rec, from, delta, mask) : w.col.sweep(rec, from, delta, mask, radius, skin);
      return hit ? { rec: adapterOf(hit.rec), point: hit.point, normal: hit.normal } : null;
    },
  };
}

// one adapter per record that owns (or is hit as) a probe record: position / flags go through to the record
const adapters = new WeakMap<GameRecord, ProbeRecord & { rec: GameRecord }>();
function adapterOf(rec: GameRecord): ProbeRecord & { rec: GameRecord } {
  let a = adapters.get(rec);
  if (!a) {
    a = {
      rec,
      get x() { return rec.x; }, set x(v: number) { rec.x = v; },
      get y() { return rec.y; }, set y(v: number) { rec.y = v; },
      get z() { return rec.z; }, set z(v: number) { rec.z = v; },
      get flags() { return rec.flags; }, set flags(v: number) { rec.flags = v; },
      get ctrl() { return rec.ctrl?.probe ?? null; },
    };
    adapters.set(rec, a);
  }
  return a;
}

const scratchOf = new WeakMap<World, ProbeScratch>();

/** pass FUN_00427233 for the world: only records whose controller has a probe block take part (an unarmed block does nothing but zero its result) */
export function runProbePass(w: World) {
  let list: (ProbeRecord & { rec: GameRecord })[] | null = null;
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c?.probe) continue;
    // the controller's own words the pass reads: +0x0c flags (bit 2 = enabled) and +0x18 (the squared distance to the focus)
    c.probe.flags = c.flags; c.probe.d18 = c.distSq;
    (list ??= []).push(adapterOf(rec));
  }
  if (!list) return;
  let s = scratchOf.get(w);
  if (!s) scratchOf.set(w, s = { pos: [0, 0, 0], nrm: [0, 0, 0] });
  probePass(list, probeEnvOf(w), s);
}
