// The script actions and their manager (CParticleActionManager.cpp, CParticleAction.cpp): FUN_00455750 (compile a `.par` script into timed actions),
// FUN_00456600 / FUN_004546a0 (time ordered insertion), FUN_00454780 (execute the actions of the current frame, apply `ForAll` actions to the live particles),
// FUN_004556c0 (restart), the action classes behind the vtables 0x892300 .. 0x892364 (`EndSource`, `ResetScript`, `ExecuteScript`, float / int / vec3 / colour
// ramps, `SetEmiPrimitive`).
//
// Time: an action has a window of FRAMES `[start, end]` = `[frame + trunc(30 t0), start + trunc(30 t1)]` measured on the game's frame counter DAT_009da5cc
// (one count per logic frame; `FrameClock.frame`), it executes once per update while `start <= frame <= end`.
import { type Rec, ftol, r24, type PState } from './core.ts';
import { K, keyId } from './keys.ts';
import type { ParticleDefs } from './defs.ts';
import { AP, EM, BK, APP_SIZE } from './layout.ts';
import type { Block, Particle } from './pool.ts';
import { loadTextLines, scanf, strnicmpEq, type TextLines } from './text.ts';

const f32 = Math.fround;

/** DAT_009da5cc: the frame counter the action windows are measured on */
export interface FrameClock { frame: number }

/** what the actions touch of a source (CParticleSource) */
export interface ActionHost {
  /** the block the actions write to (src + 0x7c) */
  tmpl: Block;
  /** +2: emission ended (EndSource) */
  ended: boolean;
  /** FUN_00455750 with no source (script preparation): the actions are built but write nothing */
  isNull: boolean;
  /** +0x60: pool size (raised by iMaxParticles actions) */
  poolSize: number;
  mgr: Manager;
  ps: PState;
  defs: ParticleDefs;
}

/** a target inside the template block: a dword index into its record */
interface Target { rec: Rec; d: number }

/** byte offsets of the scriptable fields in the block */
const T = {
  SCT: BK.APP_B + 0xbc, SCTINC: BK.APP_B + 0xc0, SPRITE: BK.APP_B + 0x54, ESPRITE: BK.APP_B + 0x58,
  SSIZE: BK.APP_B + 0xa4, ESIZE: BK.APP_B + 0xa8, SCOL: BK.APP_B + 0x64, ECOL: BK.APP_B + 0x74,
  VSCOL: BK.APP_B + 0x94, VECOL: BK.APP_B + 0x98, VSALPHA: BK.APP_B + 0x9c, VEALPHA: BK.APP_B + 0xa0, VSSIZE: BK.APP_B + 0xac, VESIZE: BK.APP_B + 0xb0,
  AIR: BK.MOV_B + 0x64, DAIR: BK.MOV_B + 0x68, BOUNCE: BK.MOV_B + 0x54, DBOUNCE: BK.MOV_B + 0x58, GROUND: BK.MOV_B + 0x5c, DGROUND: BK.MOV_B + 0x60,
  GRAV: BK.MOV_B + 0x11c, DGRAV: BK.MOV_B + 0x128, SPEEDSCALE: BK.MOV_B + 0x50,
  DENS: BK.EMI_B + 0x60, DDENS: BK.EMI_B + 0x64, FORCE: BK.EMI_B + 0x68, DFORCE: BK.EMI_B + 0x6c, INC: BK.EMI_B + 0x70, EXC: BK.EMI_B + 0x74,
  LIFE: BK.EMI_B + 0x58, DLIFE: BK.EMI_B + 0x5c, MAX: BK.EMI_B + 0x50,
};

export abstract class Action {
  next: Action | null = null;
  /** +8 / +0xc: start offset and duration in seconds (float32) */
  t0: number; t1: number;
  /** +0x10 / +0x14: first and last frame */
  start = 0; end = 0;
  /** +0x18: id of the action word, +0x1c: id of the first word of the line (ForNew 43 / ForAll 44) */
  keyId = 0; whenId = 0;
  protected clock: FrameClock;
  constructor(clock: FrameClock, t0: number, t1: number) {
    this.clock = clock;
    this.t0 = f32(t0); this.t1 = f32(t1);
    this.rebase();
  }
  /** FUN_00457390 (and the first half of every reset): `start = frame - ftol(t0 * -30)`, `end = start - ftol(t1 * -30)` */
  rebase(): void {
    this.start = (this.clock.frame - ftol(f32(this.t0 * -30))) | 0;
    this.end = (this.start - ftol(f32(this.t1 * -30))) | 0;
  }
  abstract exec(): void;
  /** vtable[1] */
  reset(): void { this.rebase(); }
}

/** FUN_00457400: EndSource (vtable 0x892310): stops the emission */
class EndSource extends Action {
  private host: ActionHost;
  constructor(clock: FrameClock, host: ActionHost, t0: number) { super(clock, t0, 0); this.host = host; }
  exec(): void { this.host.ended = true; }
}

/** FUN_00457490: ResetScript (vtable 0x89231c): restarts the script (all windows re-based) */
class ResetScript extends Action {
  private host: ActionHost;
  constructor(clock: FrameClock, host: ActionHost, t0: number, t1: number) {
    super(clock, t0, 0);
    this.host = host;
    if (!host.isNull) host.mgr.endFlag = ftol(t1) === 1;
  }
  exec(): void { this.host.mgr.resetFlag = true; }
  reset(): void { super.reset(); this.host.mgr.resetFlag = true; }
}

/** FUN_00457530: ExecuteScript (vtable 0x892328): copies an appearance / movement / emitter record into the block */
export class ExecuteScript extends Action {
  readonly name: string;
  /** +0x12c: 0 `.app`, 1 `.mov`, 2 `.emi`, 3 `.scr`, -1 other */
  readonly type: number;
  /** +0x130 */
  readonly rec: Rec | null;
  private host: ActionHost;
  constructor(clock: FrameClock, host: ActionHost, t0: number, name: string, defs: ParticleDefs) {
    super(clock, t0, 0);
    this.host = host;
    this.name = name;
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '';
    let type = -1;
    let rec: Rec | null = null;
    if (strnicmpEq(ext, '.app', 4)) { type = 0; rec = defs.findApp(name); }
    else if (strnicmpEq(ext, '.mov', 4)) { type = 1; rec = defs.findMov(name); }
    else if (strnicmpEq(ext, '.emi', 4)) { type = 2; rec = defs.findEmi(name); }
    else if (strnicmpEq(ext, '.scr', 4)) type = 3;
    this.type = type; this.rec = rec;
  }
  exec(): void {
    const b = this.host.tmpl;
    if (this.type < 0 || this.type > 2) return;
    if (!this.rec) throw new Error(`ExecuteScript ${this.name}: record not found (the original dereferences a null pointer)`);
    this.copyTo(b);
  }
  /** FUN_004576a0 */
  private copyTo(b: Block): void {
    const r = this.rec!;
    switch (this.type) {
      case 0: b.app.u8.set(r.u8.subarray(0, APP_SIZE)); break;                              // 0x3a dwords -> block + 0x248
      case 1: b.mov.u8.set(r.u8.subarray(0, b.mov.size)); break;                            // 0x51 dwords -> block + 0x104
      case 2: {
        // the emitter's name string (strlen + 1) to block + 0x50, then the fields +0x50 .. +0x74 (+0x54 as a byte); the primitive (+0x78) is not touched
        const e = b.emi;
        const n = r.name.length + 1;
        for (let i = 0; i < n; i++) e.u8[i] = r.u8[i];
        e.i[EM.MAX] = r.i[EM.MAX];
        e.u8[EM.IMMORTAL_B] = r.u8[EM.IMMORTAL_B];
        for (const o of [EM.LIFE, EM.DLIFE, EM.DENS, EM.DDENS, EM.FORCE, EM.DFORCE, EM.INC, EM.EXC]) e.i[o] = r.i[o];
        break;
      }
    }
  }
  /** FUN_00456760: the `ForAll ExecuteScript` form: copy the record into one live particle (appearance and emitter only) */
  applyTo(p: Particle): void {
    if (!this.rec) return;
    if (this.type === 0) p.app.u8.set(this.rec.u8.subarray(0, APP_SIZE));
    else if (this.type === 2) p.emi.u8.set(this.rec.u8.subarray(0, p.emi.size));
  }
}

/** FUN_00457850 / 0x892334: float ramp (`value = a + n * step`, then `cur += step`) */
export class FloatAction extends Action {
  a: number; b: number; cur: number; step = 0;
  private target: Target;
  constructor(clock: FrameClock, target: Target, t0: number, t1: number, f: number[]) {
    super(clock, t0, t1);
    this.target = target;
    this.a = f[0]; this.b = f[1]; this.cur = f[0];
    this.init();
  }
  /** FUN_00457930 */
  private init(): void {
    const diff = f32(this.b - this.a);
    if (0 < this.t1) { this.cur = this.a; this.step = f32(diff / f32(this.t1 * 30)); }
    else { this.step = f32(diff); this.cur = this.a; }
  }
  exec(): void {
    if (this.clock.frame === this.start) this.cur = this.a;
    this.target.rec.f[this.target.d] = this.cur;
    this.cur = f32(this.step + this.cur);
  }
  reset(): void { super.reset(); this.cur = this.a; }
}

/** FUN_00457970 / 0x892340: integer ramp */
export class IntAction extends Action {
  a: number; b: number; cur: number; step = 0;
  private target: Target;
  constructor(clock: FrameClock, target: Target, t0: number, t1: number, f: number[]) {
    super(clock, t0, t1);
    this.target = target;
    this.a = ftol(f[0]); this.cur = this.a; this.b = ftol(f[1]);
    this.init();
  }
  /** FUN_00457a60 */
  private init(): void {
    if (0 < this.t1) { this.cur = this.a; this.step = ftol(f32((this.b - this.a) / f32(this.t1 * 30))); }
    else { this.cur = this.a; this.step = (this.b - this.a) | 0; }
  }
  exec(): void {
    if (this.clock.frame === this.start) this.cur = this.a;
    this.target.rec.i[this.target.d] = this.cur;
    this.cur = (this.cur + this.step) | 0;
  }
  reset(): void { super.reset(); this.cur = this.a; }
}

/** FUN_00457ab0 / 0x89234c: vector ramp. NOTE: the first frame already adds a step; the last frame assigns the end vector exactly. */
export class Vec3Action extends Action {
  readonly s = new Float32Array(3); readonly e = new Float32Array(3); readonly step = new Float32Array(3); readonly cur = new Float32Array(3);
  private target: Target;
  constructor(clock: FrameClock, target: Target, t0: number, t1: number, f: number[]) {
    super(clock, t0, t1);
    this.target = target;
    for (let i = 0; i < 3; i++) { this.s[i] = f[i]; this.e[i] = f[3 + i]; }
    this.init();
  }
  /** FUN_00457c10 */
  private init(): void {
    if (0 < this.t1) {
      const den = f32(this.t1 * 30);
      for (let i = 0; i < 3; i++) this.step[i] = f32(f32(this.e[i] - this.s[i]) / den);
    } else for (let i = 0; i < 3; i++) this.step[i] = f32(this.e[i] - this.s[i]);
  }
  exec(): void {
    if (this.clock.frame === this.start) this.cur.set(this.s);
    if (this.clock.frame === this.end) this.cur.set(this.e);
    else for (let i = 0; i < 3; i++) this.cur[i] = f32(this.step[i] + this.cur[i]);
    for (let i = 0; i < 3; i++) this.target.rec.f[this.target.d + i] = this.cur[i];
  }
  reset(): void { super.reset(); this.cur.set(this.s); }
}

/** FUN_00457c70 / 0x892358: colour ramp (four 8.8 integers) */
export class ColourAction extends Action {
  readonly s = new Int32Array(4); readonly e = new Int32Array(4); readonly step = new Int32Array(4); readonly cur = new Int32Array(4);
  private target: Target;
  constructor(clock: FrameClock, target: Target, t0: number, t1: number, f: number[]) {
    super(clock, t0, t1);
    this.target = target;
    for (let i = 0; i < 4; i++) { this.s[i] = ftol(f[i]); this.e[i] = ftol(f[4 + i]); }
    this.init();
  }
  /** FUN_00457e00 */
  private init(): void {
    if (this.t1 <= 0) for (let i = 0; i < 4; i++) this.step[i] = (this.e[i] - this.s[i]) | 0;
    else {
      const den = f32(this.t1 * 30);
      for (let i = 0; i < 4; i++) this.step[i] = ftol(f32((this.e[i] - this.s[i]) / den));
    }
    this.cur.set(this.s);
  }
  exec(): void {
    if (this.clock.frame === this.start) this.cur.set(this.s);
    for (let i = 0; i < 4; i++) this.target.rec.i[this.target.d + i] = this.cur[i];
    for (let i = 0; i < 4; i++) this.cur[i] = (this.cur[i] + this.step[i]) | 0;
  }
  reset(): void { super.reset(); this.cur.set(this.s); }
}

/** FUN_00457f40 / 0x892364: SetEmiPrimitive ... Set: writes the primitive type at COMPILE time (exec does nothing) */
class SetPrimitive extends Action {
  constructor(clock: FrameClock, host: ActionHost, t0: number, t1: number, prim: Rec, d: number, type: number) {
    super(clock, t0, t1);
    if (!host.isNull) prim.i[d] = type;
  }
  exec(): void { /* ret */ }
}

// ---------------------------------------------------------------------------------------------------------------------------
// manager

/** bucket of actions with the same first start time (16 bytes: next bucket, first action, ..., cursor) */
class Bucket { next: Bucket | null = null; actions: Action[]; constructor(a: Action) { this.actions = [a]; } }

/** CParticleActionManager (0x20 bytes): time ordered buckets of actions */
export class Manager {
  buckets: Bucket[] = [];
  /** +0x10: restart requested (ResetScript / gate change) */
  resetFlag = false;
  /** +0x11 */
  endFlag = false;
  /** +0x18: number of actions */
  count = 0;
  host: ActionHost | null = null;
  private head: Bucket | null = null;
  /**
   * FUN_00456600(action, t0): insert into the bucket list. The key of a bucket is the start time of its FIRST action; the walk keeps the last bucket
   * whose key is <= t0 (or the first bucket when every key is larger: a smaller t0 then becomes the SECOND bucket, as in the original).
   */
  insert(a: Action, t0: number): void {
    this.count++;
    if (!this.head) { this.head = new Bucket(a); return; }
    let b1: Bucket = this.head;
    let b5: Bucket | null = this.head;
    while (b5 && b5.actions[0].t0 <= t0) { b1 = b5; b5 = b5.next; }
    if (b1.actions[0].t0 === t0) {
      // FUN_004546a0: after the last action whose duration is <= the new one (the first action is never displaced)
      const l = b1.actions;
      let p = 0, n = 0;
      while (n < l.length && l[n].t1 <= a.t1) { p = n; n++; }
      l.splice(p + 1, 0, a);
      return;
    }
    const nb = new Bucket(a);
    nb.next = b1.next;
    b1.next = nb;
  }
  /** FUN_00455700: finalise after the compile */
  finish(): void {
    this.buckets = [];
    for (let b = this.head; b; b = b.next) this.buckets.push(b);
  }
  /** FUN_004556c0: restart: every action re-bases its window; clears the reset / end flags */
  restart(): void {
    for (const b of this.buckets) for (const a of b.actions) a.reset();
    this.resetFlag = false; this.endFlag = false;
  }
  allActions(): Action[] { const r: Action[] = []; for (const b of this.buckets) for (const a of b.actions) r.push(a); return r; }
}

/** FUN_004567b0: the largest pool size the actions ask for (iMaxParticles actions and `.emi` ExecuteScripts) */
export function maxParticlesOf(mgr: Manager): number {
  let m = 0;
  for (const a of mgr.allActions()) {
    if (a.keyId === K.MAX) { const ia = a as IntAction; if (m <= ia.a) m = ia.a; if (m <= ia.b) m = ia.b; }
    else if (a.keyId === K.EXECUTESCRIPT && (a as ExecuteScript).type === 2) { const r = (a as ExecuteScript).rec; const v = r ? r.i[EM.MAX] : 0; if (m <= v) m = v; }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------
// compile

/** persistent stack slots of FUN_00455750: the float outputs of the line parser keep their previous value when a line has fewer numbers */
interface Slots { t0: number; t1: number; f: number[] }
export const newSlots = (): Slots => ({ t0: 0, t1: 0, f: new Array(10).fill(0) });

/** the primitive / property name tables (DAT_008b7e78 / DAT_008b8020) */
const PRIMS = ['Box', 'Line', 'Sphere', 'Ring', 'Circle'];
const PROPS: [string, number][] = [['Set', -1], ['EmitMode', 0], ['AngleMode', 1], ['Radius', 2], ['Size', 3], ['Points', 4], ['Angle0', 5], ['Angle1', 6], ['DAngle0', 7], ['DAngle1', 8], ['LineStart', 9], ['LineEnd', 10]];
/** FUN_004545f0 on the 0x54 byte entry tables: id of the first entry that starts with the token (0 when none: Box = 0 is also the "not found" value) */
const primId = (tok: string): number => { for (let i = 0; i < PRIMS.length; i++) if (strnicmpEq(tok, PRIMS[i], tok.length)) return i; return 0; };
const propId = (tok: string): number => { for (const [n, id] of PROPS) if (strnicmpEq(tok, n, tok.length)) return id; return 0; };

/**
 * FUN_00455750(file, src, top, offset): compile the lines after `[SCRIPT]` into actions of `host.mgr`. `offset` is added to every start time (nested scripts).
 * `host.isNull` = preparation (FUN_00450e20): the actions are built but write nothing.
 */
export function compileScript(text: TextLines, host: ActionHost, offset: number, clock: FrameClock, slots: Slots = newSlots()): void {
  // the first line is [SCRIPT]-prefixed: the loop of the original walks to it, the script starts after it
  let i = 0;
  for (let n = 0; n < text.count; n++) {
    i = n + 1;
    if (strnicmpEq(text.line(n), '[SCRIPT]', 8)) break;
  }
  const tm = host.tmpl;
  const tgt = (byteOff: number): Target => ({ rec: tm.rec, d: byteOff >> 2 });
  for (let li = i; li < text.count; li++) {
    const line = text.line(li);
    const sc = scanf(line, '%s %s %f %f %f %f %f %f %f %f %f %f %f %f').values;
    const whenTok = typeof sc[0] === 'string' ? sc[0] : '', actTok = typeof sc[1] === 'string' ? sc[1] : '';
    for (let k = 2; k < sc.length; k++) { const v = sc[k] as number; if (k === 2) slots.t0 = v; else if (k === 3) slots.t1 = v; else slots.f[k - 4] = v; }
    let t0 = f32(slots.t0 + offset);
    slots.t0 = t0;
    let t1 = slots.t1;
    const f = slots.f;
    const id = keyId(actTok);
    let a: Action | null = null;
    const F = (off: number) => new FloatAction(clock, tgt(off), t0, t1, f);
    const I = (off: number) => new IntAction(clock, tgt(off), t0, t1, f);
    const V = (off: number) => new Vec3Action(clock, tgt(off), t0, t1, f);
    const C = (off: number) => new ColourAction(clock, tgt(off), t0, t1, f);
    switch (id) {
      case K.ENDSOURCE: a = new EndSource(clock, host, t0); break;
      case K.RESETSCRIPT: a = new ResetScript(clock, host, t0, t1); break;
      case K.EXECUTESCRIPT: {
        // "%s %s %f %s": the file name is the fourth token
        // (this scan rewrites t0 WITHOUT the script offset)
        const s4 = scanf(line, '%s %s %f %s').values;
        if (typeof s4[2] === 'number') { slots.t0 = s4[2]; t0 = s4[2]; }
        const name = typeof s4[3] === 'string' ? s4[3] : '';
        const ex = new ExecuteScript(clock, host, t0, name, host.defs);
        a = ex;
        if (ex.type === 3) {
          // `.scr`: a nested script from `particle\<name>` (never present in the shipped data)
          const data = host.defs.readFile(name);
          if (data) compileScript(loadTextLines(data), host, t0, clock, slots);
        }
        break;
      }
      case K.SCT: a = F(T.SCT); break;
      case K.SCTINC: a = F(T.SCTINC); break;
      case K.SSPRITE: a = I(T.SPRITE); break;
      case K.ESPRITE: a = I(T.ESPRITE); break;
      case K.SSIZE: a = F(T.SSIZE); break;
      case K.ESIZE: a = F(T.ESIZE); break;
      case K.SCOLOUR: a = C(T.SCOL); break;
      case K.ECOLOUR: a = C(T.ECOL); break;
      case K.VSCOLOUR: a = F(T.VSCOL); break;
      case K.VECOLOUR: a = F(T.VECOL); break;
      case K.VSALPHA: a = F(T.VSALPHA); break;
      case K.VEALPHA: a = F(T.VEALPHA); break;
      case K.VSSIZE: a = F(T.VSSIZE); break;
      case K.VESIZE: a = F(T.VESIZE); break;
      case K.AIR: a = F(T.AIR); break;
      case K.DAIR: a = F(T.DAIR); break;
      case K.BOUNCE: a = F(T.BOUNCE); break;
      case K.DBOUNCE: a = F(T.DBOUNCE); break;
      case K.GROUND: a = F(T.GROUND); break;
      case K.DGROUND: a = F(T.DGROUND); break;
      case K.GRAV: a = V(T.GRAV); break;
      case K.DGRAV: a = V(T.DGRAV); break;
      case K.DENS: a = F(T.DENS); break;
      case K.DDENS: a = F(T.DDENS); break;
      case K.FORCE: a = F(T.FORCE); break;
      case K.DFORCE: a = F(T.DFORCE); break;
      case K.INC: a = F(T.INC); break;
      case K.EXC: a = F(T.EXC); break;
      case K.SPEEDSCALE: a = F(T.SPEEDSCALE); break;
      case K.LIFE: a = F(T.LIFE); break;
      case K.DLIFE: a = F(T.DLIFE); break;
      case K.MAX: {
        a = I(T.MAX);
        // the pool size of the source is raised to the larger value (`+0x60`); with no source the original would dereference NULL (never present in a `.par`)
        if (!host.isNull) host.poolSize = Math.max(host.poolSize, ftol(f[0]));
        break;
      }
      case K.SETEMIPRIMITIVE: {
        const sp = scanf(line, '%s %s %f %f %s %s %f %f %f %f %f %f %f %f').values;
        if (typeof sp[2] === 'number') { slots.t0 = sp[2]; t0 = sp[2]; }
        if (typeof sp[3] === 'number') { slots.t1 = sp[3]; t1 = sp[3]; }
        const primTok = typeof sp[4] === 'string' ? sp[4] : '', propTok = typeof sp[5] === 'string' ? sp[5] : '';
        const ff: number[] = [];
        for (let k = 0; k < 8; k++) ff.push(typeof sp[6 + k] === 'number' ? (sp[6 + k] as number) : 0);
        a = primitiveAction(clock, host, tm, t0, t1, primId(primTok), propId(propTok), ff);
        break;
      }
      case K.SETEMISSIONPARTICLE: break;       // parsed, creates nothing (the original then re-registers the previous action: not used by the data)
      default: throw new Error(`particle script: action "${actTok}" (id ${id}) is not scriptable (the original hits an int3)`);
    }
    if (a) {
      a.keyId = id;
      a.whenId = keyId(whenTok);
      host.mgr.insert(a, t0);
    }
  }
}

/** FUN_00457f80: SetEmiPrimitive <t0> <t1> <primitive> <property> <floats> */
function primitiveAction(clock: FrameClock, host: ActionHost, tm: Block, t0: number, t1: number, prim: number, prop: number, f: number[]): Action | null {
  const pb = BK.EMI_B + EM.PRIM * 4;                       // byte offset of the primitive structure in the block
  const tg = (o: number): Target => ({ rec: tm.rec, d: (pb + o) >> 2 });
  const setp = () => new SetPrimitive(clock, host, t0, t1, tm.rec, pb >> 2, prim);
  const flt = (o: number) => new FloatAction(clock, tg(o), t0, t1, f);
  const int = (o: number) => new IntAction(clock, tg(o), t0, t1, f);
  const vec = (o: number) => new Vec3Action(clock, tg(o), t0, t1, f);
  const clamp11 = () => {
    // Points: both values limited to 0 .. 11 (the original's comparison chain: `if (x > 11 || x >= 0) { if x <= 11 keep else 11 } else 0`)
    for (let i = 0; i < 2; i++) { const x = f[i]; f[i] = (x > 11 || 0 <= x) ? (x <= 11 ? x : 11) : 0; }
  };
  switch (prim) {
    case 0:                                                // Box
      if (prop !== -1) return prop === 3 ? vec(0x1c) : null;
      return setp();
    case 1:                                                // Line
      if (prop === -1) return setp();
      if (prop === 9) return vec(0x1c);
      if (prop === 10) return vec(0x28);
      return null;
    case 2:                                                // Sphere
      switch (prop) {
        case 1: return int(0x20);
        case 2: return flt(0x38);
        case 4: clamp11(); return int(0x34);
        case 5: return flt(0x24);
        case 7: return flt(0x2c);
        case 8: return flt(0x30);
        case -1: return setp();
      }
      return null;
    case 3:                                                // Ring
      switch (prop) {
        case 0: return int(0x1c);
        case 1: return int(0x20);
        case 2: return flt(0x24);
        case 4: clamp11(); return int(0x30);
        case 5: return flt(0x28);
        case 7: return flt(0x2c);
        case -1: return setp();
      }
      return null;
    case 4:                                                // Circle
      if (prop === -1) return setp();
      if (prop === 2) return flt(0x1c);
      return null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// execution (FUN_00454780)

/** the colour variation of a ForAll colour action = FUN_00453220 on the particle with the register value `inv` (1 / remaining life), without the alpha delta */
function colourAll(p: Particle, ps: PState, inv: number): void {
  const a = p.app, ai = a.i, af = a.f;
  if (0 <= af[AP.VSCOL]) {
    const m = f32(f32(ps.rnd() * af[AP.VSCOL]) + f32(1.0 - af[AP.VSCOL]));
    ai[AP.CR] = ftol(f32(ai[AP.CR] * m)); ai[AP.CG] = ftol(f32(ai[AP.CG] * m)); ai[AP.CB] = ftol(f32(ai[AP.CB] * m));
  }
  if (0 <= af[AP.VECOL]) {
    const m = f32(f32(ps.rnd() * af[AP.VECOL]) + f32(1.0 - af[AP.VECOL]));
    ai[AP.ER] = ftol(f32(ai[AP.ER] * m)); ai[AP.EG] = ftol(f32(ai[AP.EG] * m)); ai[AP.EB] = ftol(f32(ai[AP.EB] * m));
  }
  ai[AP.DR] = ftol(f32((ai[AP.ER] - ai[AP.CR]) * inv));
  ai[AP.DG] = ftol(f32((ai[AP.EG] - ai[AP.CG]) * inv));
  ai[AP.DB] = ftol(f32((ai[AP.EB] - ai[AP.CB]) * inv));
}

/** the alpha variation of a ForAll alpha action */
function alphaAll(p: Particle, ps: PState, inv: number): void {
  const a = p.app, ai = a.i, af = a.f;
  if (0 <= af[AP.VSALPHA]) ai[AP.CA] = ftol(f32(f32(f32(ps.rnd() * af[AP.VSALPHA]) + f32(1.0 - af[AP.VSALPHA])) * ai[AP.CA]));
  if (0 <= af[AP.VEALPHA]) ai[AP.EA] = ftol(f32(f32(f32(ps.rnd() * af[AP.VEALPHA]) + f32(1.0 - af[AP.VEALPHA])) * ai[AP.EA]));
  ai[AP.DA] = ftol(f32((ai[AP.EA] - ai[AP.CA]) * inv));
}

/** the size variations of a ForAll size action; the per tick change is recomputed from the REMAINING life */
function sizeAll(p: Particle, ps: PState, inv: number): void {
  const af = p.app.f;
  if (0 <= af[AP.VSSIZE]) af[AP.SIZE] = f32(f32(f32(1.0 - af[AP.VSSIZE]) + f32(ps.rnd() * af[AP.VSSIZE])) * af[AP.SIZE]);
  if (0 <= af[AP.VESIZE]) af[AP.ESIZE] = f32(f32(f32(1.0 - af[AP.VESIZE]) + f32(ps.rnd() * af[AP.VESIZE])) * af[AP.ESIZE]);
  af[AP.DSIZE] = f32(f32(af[AP.ESIZE] - af[AP.SIZE]) * inv);
}

/** FUN_00454780: execute every action whose window contains the current frame; `ForAll` actions then write their (post step) value into all live particles */
export function runActions(mgr: Manager, host: ActionHost, clock: FrameClock): void {
  for (const b of mgr.buckets) {
    for (const a of b.actions) {
      if (clock.frame < a.start || a.end < clock.frame) continue;
      a.exec();
      if (a.whenId !== K.FORALL) continue;
      forAll(a, host);
    }
  }
}

/** the `ForAll` switch of FUN_00454780: `a.cur` (already advanced by exec) goes into every particle of the block's active list */
function forAll(a: Action, host: ActionHost): void {
  const ps = host.ps;
  const fcur = (a as FloatAction).cur;
  const vcur = (a as Vec3Action).cur;
  const ccur = (a as ColourAction).cur;
  for (let p: Particle | null = host.tmpl.head; p; p = p.next) {
    const af = p.app.f, ai = p.app.i, mf = p.mov.f;
    const lifeInv = f32(1.0 / p.rec.f[0x2f4 >> 2]);           // register value `fld 1.0 / fdiv life`
    switch (a.keyId) {
      case K.SSIZE: af[AP.SIZE] = fcur; sizeAll(p, ps, lifeInv); break;
      case K.ESIZE: af[AP.ESIZE] = fcur; sizeAll(p, ps, lifeInv); break;
      case K.VSSIZE: af[AP.VSSIZE] = fcur; sizeAll(p, ps, lifeInv); break;
      case K.VESIZE: af[AP.VESIZE] = fcur; sizeAll(p, ps, lifeInv); break;
      case K.SCOLOUR: for (let i = 0; i < 4; i++) ai[AP.CR + i] = ccur[i]; colourAll(p, ps, lifeInv); break;
      case K.ECOLOUR: for (let i = 0; i < 4; i++) ai[AP.ER + i] = ccur[i]; colourAll(p, ps, lifeInv); break;
      case K.VSCOLOUR: af[AP.VSCOL] = fcur; colourAll(p, ps, lifeInv); break;
      case K.VECOLOUR: af[AP.VECOL] = fcur; colourAll(p, ps, lifeInv); break;
      case K.VSALPHA: af[AP.VSALPHA] = fcur; alphaAll(p, ps, lifeInv); break;
      case K.VEALPHA: af[AP.VEALPHA] = fcur; alphaAll(p, ps, lifeInv); break;
      case K.AIR: mf[(0x15c - 0xf8) >> 2] = fcur; break;
      case K.DAIR: mf[(0x160 - 0xf8) >> 2] = fcur; break;
      case K.BOUNCE: mf[(0x14c - 0xf8) >> 2] = fcur; break;
      case K.DBOUNCE: mf[(0x150 - 0xf8) >> 2] = fcur; break;
      case K.GROUND: mf[(0x154 - 0xf8) >> 2] = fcur; break;
      case K.DGROUND: mf[(0x158 - 0xf8) >> 2] = fcur; break;
      case K.GRAV: mf[(0x214 - 0xf8) >> 2] = vcur[0]; mf[(0x218 - 0xf8) >> 2] = vcur[1]; mf[(0x21c - 0xf8) >> 2] = vcur[2]; break;
      case K.DGRAV: mf[(0x220 - 0xf8) >> 2] = vcur[0]; mf[(0x224 - 0xf8) >> 2] = vcur[1]; mf[(0x228 - 0xf8) >> 2] = vcur[2]; break;
      case K.SPEEDSCALE: {
        mf[(0x148 - 0xf8) >> 2] = fcur;
        const s = mf[(0x148 - 0xf8) >> 2];
        mf[(0x1f0 - 0xf8) >> 2] = r24(s * mf[(0x208 - 0xf8) >> 2]);
        mf[(0x1f4 - 0xf8) >> 2] = r24(s * mf[(0x20c - 0xf8) >> 2]);
        mf[(0x1f8 - 0xf8) >> 2] = r24(s * mf[(0x210 - 0xf8) >> 2]);
        break;
      }
      case K.EXECUTESCRIPT: (a as ExecuteScript).applyTo(p); break;
      default: break;
    }
  }
}
