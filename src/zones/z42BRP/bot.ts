// z42BRP: the scripted players of the tests (node and the headless browser runs): a snapshot / restore of the whole simulation state, so a bot can look ahead by running the
// real node code on a copy, and the planner of the roof (Phase2Bot). Pure TypeScript, no DOM, never imported by the game itself (the zone game does not use it); the browser
// steps import it through the dev server (`import('/src/zones/z42BRP/bot.ts')`).
import type { World } from '../../game/world.ts';
import { stateOf, ZoneLoop } from './nodes.ts';
import type { BrpState, BrpEnv } from './nodes.ts';
import { REC, VAR } from './rules.ts';

/** logical buttons (game/input.ts `B`) */
export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80 } as const;

/** one simulation tick holding the logical buttons `mask` (what the shell's input mapper computes once per tick) */
export function tick(w: World, mask = 0) {
  const i = w.input;
  i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask;
  w.tick();
}

const isPlain = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && (Object.getPrototypeOf(o) === Object.prototype || Array.isArray(o));
/** copy the data of a value; class instances (records, animation instances, the world) are shared, not copied */
function copyVal(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return (v as Float32Array).slice();
  if (Array.isArray(v)) return v.map(copyVal);
  if (isPlain(v)) { const o: Record<string, unknown> = {}; for (const k of Object.keys(v)) o[k] = copyVal(v[k]); return o; }
  return v;
}
function copyObj(o: object): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) { if (typeof v === 'function') continue; s[k] = copyVal(v); }
  return s;
}
function putObj(o: object, s: Record<string, unknown>) { for (const k of Object.keys(s)) (o as Record<string, unknown>)[k] = copyVal(s[k]); }

/** a random generator whose state can be captured: the node code only calls `rng()` */
export interface StatefulRng { (): number; state: number }
export function statefulRng(seed: number): StatefulRng {
  const f = (() => { f.state = (Math.imul(f.state, 1664525) + 1013904223) >>> 0; return f.state / 4294967296; }) as StatefulRng;
  f.state = seed >>> 0;
  return f;
}

export interface Snapshot {
  recs: { m: Float32Array; flags: number; rx: number; ry: number; rz: number; anim: { clip: number; frame: number } | null }[];
  nodes: Record<string, unknown>[];
  st: Record<string, unknown>;
  vars: Int32Array;
  tickCount: number; frame: number;
  input: { held: number; prevHeld: number; pressed: number };
  rng: number;
}

const STATE_SKIP = ['env', 'w', 'rigs', 'log', 'sounds', 'spoken', 'pepbrp', 'peptop', 'brickster', 'zonebrp', 'zonetop', 'bots'];
/** snapshot of everything the nodes change: records (matrix, flags, animation), the nodes of the records, the zone state, the game variables, the tick counters */
export function capture(w: World): Snapshot {
  const S = stateOf(w);
  const recs = w.records.map((r) => ({ m: r.m.slice(), flags: r.flags, rx: r.rx, ry: r.ry, rz: r.rz, anim: r.anim ? { clip: r.anim.clip, frame: r.anim.frame } : null }));
  const nodes: Record<string, unknown>[] = [];
  for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) nodes.push(copyObj(n));
  const st = copyObj(S);
  for (const k of STATE_SKIP) delete st[k];
  const rng = (S.env.rng as Partial<StatefulRng>).state ?? 0;
  return { recs, nodes, st, vars: w.vars.a.slice(), tickCount: w.tickCount, frame: w.frame, input: { held: w.input.held, prevHeld: w.input.prevHeld, pressed: w.input.pressed }, rng };
}
export function restore(w: World, snap: Snapshot) {
  const S = stateOf(w);
  w.records.forEach((r, i) => {
    const s = snap.recs[i];
    r.m.set(s.m); r.prev.set(s.m); r.flags = s.flags; r.rx = s.rx; r.ry = s.ry; r.rz = s.rz;
    if (r.anim && s.anim) { r.anim.clip = s.anim.clip; r.anim.frame = s.anim.frame; r.anim.prevClip = s.anim.clip; r.anim.prevFrame = s.anim.frame; }
  });
  let k = 0;
  for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) putObj(n, snap.nodes[k++]);
  putObj(S, snap.st);
  w.vars.a.set(snap.vars);
  w.tickCount = snap.tickCount; w.frame = snap.frame;
  Object.assign(w.input, snap.input);
  const rng = S.env.rng as Partial<StatefulRng>;
  if (rng.state !== undefined) rng.state = snap.rng;
  w.camera.savePrev();
}

/** run `fn` with the zone's sounds / speech / cutscene hooks silenced (a look-ahead must not play anything) */
export function silently<T>(S: BrpState, fn: () => T): T {
  const env = S.env;
  const quiet: BrpEnv = { ...env, sfx: () => {}, sfx3: () => {}, say: () => {}, letterbox: () => {}, startCutscene: () => false, cutsceneActive: () => false };
  S.env = quiet;
  try { return fn(); } finally { S.env = env; }
}

// ------------------------------------------------------------------------------------------------ the roof bot

/** what a candidate plan of the roof is worth after it ran (and 60 more ticks without input): hits on Brickster, not knocked, not fallen, quick */
interface Outcome { hits: number; knocked: boolean; fell: boolean; end: boolean }

export interface Phase2Options {
  /** how far ahead a candidate is followed (ticks) */
  horizon?: number;
}

/**
 * The scripted player of the roof (phase 2): once a decision it plays a macro (walk sideways for m ticks, then throw), chosen by simulating all candidates on a copy of the
 * world with the real node code. Candidates: nothing, left / right for 1..14 ticks, then SPACE; plus avoiding moves when a bot is about to hit. Call `step()` once per tick
 * BEFORE the world's tick; it returns the button mask to hold in this tick. Used by the node tests (win run) and the browser steps.
 */
export class Phase2Bot {
  queue: number[] = [];
  readonly horizon: number;
  plans = 0;
  readonly w: World;
  readonly loop: ZoneLoop;
  constructor(w: World, loop: ZoneLoop = new ZoneLoop(), opts: Phase2Options = {}) { this.w = w; this.loop = loop; this.horizon = opts.horizon ?? 70; }

  private run(masks: number[], extra: number): Outcome {
    const w = this.w, S = stateOf(w);
    const hits0 = S.hits;
    let knocked = false, fell = false;
    const top = S.peptop;
    for (let i = 0; i < masks.length + extra; i++) {
      tick(w, i < masks.length ? masks[i] : 0);
      if (S.knock) knocked = true;
      if (S.respawn || (top && top.fall > 0)) fell = true;
      if (S.endState > 0) break;
    }
    return { hits: S.hits - hits0 + (S.endState > 0 ? 3 : 0), knocked, fell, end: S.endState > 0 };
  }

  /** the best macro from the present state */
  plan(): number[] {
    const w = this.w, S = stateOf(w);
    const snap = capture(w);
    this.plans++;
    const cands: number[][] = [];
    const walk = (dir: number, n: number, after: number) => [...Array(n).fill(dir), ...Array(after).fill(0)];
    for (const dir of [0, BTN.LEFT, BTN.RIGHT]) for (let n = 0; n <= 14; n++) {
      if (dir === 0 && n > 0) continue;
      cands.push([...walk(dir, n, 0), BTN.SPACE | dir]);
    }
    // waiting, then throw (the dodge of a bot is a sidestep, the rest is timing)
    for (let wait = 1; wait <= 12; wait++) cands.push([...Array(wait).fill(0), BTN.SPACE]);
    for (const dir of [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN]) for (let n = 1; n <= 10; n += 3) cands.push(walk(dir, n, 0));
    let best: number[] = [0], bestScore = -1e9;
    for (const c of cands) {
      restore(w, snap);
      const o = silently(S, () => this.run(c, this.horizon));
      const score = o.hits * 100 - (o.knocked ? 60 : 0) - (o.fell ? 200 : 0) - c.length * 0.3 + (o.end ? 50 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    restore(w, snap);
    return best;
  }

  /** the buttons for this tick (plans a new macro when the queue is empty) */
  step(): number {
    const S = stateOf(this.w);
    if (S.endState > 0) return 0;
    if (this.queue.length === 0) this.queue = this.plan();
    return this.queue.shift() ?? 0;
  }
}

/** is the world in the roof phase? */
export const onRoof = (w: World) => w.vars.get(VAR.PHASE) === 2;
export { REC };
