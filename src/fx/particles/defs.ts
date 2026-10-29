// Effect definitions: the `.app` / `.mov` / `.emi` / `.par` / `.swl` files of one particle directory, loaded exactly like FUN_0044fe30 (`ParticleEngine_File.cpp`):
// every file of a kind is read in archive order into a record list, names are the FIRST LINE of the file (not the file name) and are looked up
// case-insensitively and exactly (FUN_0044fb00 / fba0 / fc40 / fce0 / fd80); `.par` scripts are then prepared (FUN_00450c50 -> FUN_00450e20).
import { Rec, ftol } from './core.ts';
import { APP_SIZE, MOV_SIZE, EMI_SIZE, BLK_SIZE, AP, MV, EM } from './layout.ts';
import { loadTextLines, scanf, strnicmpEq, type TextLines } from './text.ts';
import { K, keyId } from './keys.ts';
import { type ActionHost, compileScript, Manager, maxParticlesOf } from './actions.ts';
import { Block } from './pool.ts';

// ---------------------------------------------------------------------------------------------------------------------------
// the three record loaders

/** FUN_00450250: `.app` */
export function loadApp(t: TextLines): Rec {
  const r = new Rec(APP_SIZE);
  r.setName(t.line(0));
  for (const o of [AP.VSCOL, AP.VECOL, AP.VSALPHA, AP.VEALPHA, AP.VSSIZE, AP.VESIZE]) r.f[o] = -1.0;
  let last = 0;                                              // `local_114`: stale when a line has no number (kept from the previous line)
  for (let n = 1; n < t.count; n++) {
    const sc = scanf(t.line(n), '%s = %f %f %f %f');
    const k = sc.eof ? -1 : sc.values.length;
    const nf = k - 1;
    if (nf < 0) continue;
    const v = sc.values;
    if (nf >= 1) last = v[1] as number;
    if (nf < 2) {
      const id = keyId(v[0] as string);
      const x = last;
      switch (id) {
        case K.SCT: r.f[AP.SCT] = x; break;
        case K.SCTINC: r.f[AP.SCTINC] = x; break;
        case K.SSPRITE: r.i[AP.SPRITE] = ftol(x); break;
        case K.ESPRITE: r.i[AP.ESPRITE] = ftol(x); break;
        case K.SSIZE: r.f[AP.SIZE] = x; break;
        case K.ESIZE: r.f[AP.ESIZE] = x; break;
        case K.VSCOLOUR: r.f[AP.VSCOL] = x; break;
        case K.VECOLOUR: r.f[AP.VECOL] = x; break;
        case K.VSALPHA: r.f[AP.VSALPHA] = x; break;
        case K.VEALPHA: r.f[AP.VEALPHA] = x; break;
        case K.VSSIZE: r.f[AP.VSSIZE] = x; break;
        case K.VESIZE: r.f[AP.VESIZE] = x; break;
        case K.USEMODEL: r.i[AP.USEMODEL] = ftol(x); break;
        case K.MATERIAL: r.i[AP.MATERIAL] = ftol(x); break;
      }
    } else if (nf === 4) {
      const id = keyId(v[0] as string);
      if (id === K.SCOLOUR) { r.i[AP.CR] = ftol(v[1] as number); r.i[AP.CG] = ftol(v[2] as number); r.i[AP.CB] = ftol(v[3] as number); r.i[AP.CA] = ftol(v[4] as number); }
      else if (id === K.ECOLOUR) { r.i[AP.ER] = ftol(v[1] as number); r.i[AP.EG] = ftol(v[2] as number); r.i[AP.EB] = ftol(v[3] as number); r.i[AP.EA] = ftol(v[4] as number); }
    }
  }
  r.u8[AP.SPIN_B] = r.f[AP.SCTINC] !== 0 ? 1 : 0;
  return r;
}

/** FUN_00450640: `.mov` */
export function loadMov(t: TextLines): Rec {
  const r = new Rec(MOV_SIZE);
  r.setName(t.line(0));
  let last = 0;
  for (let n = 1; n < t.count; n++) {
    const sc = scanf(t.line(n), '%s = %f %f %f %f');
    const k = sc.eof ? -1 : sc.values.length;
    const v = sc.values;
    if (k >= 2) last = v[1] as number;
    if (k === 2) {
      const x = last;
      switch (keyId(v[0] as string)) {
        case K.AIR: r.f[MV.AIR] = x; break;
        case K.DAIR: r.f[MV.DAIR] = x; break;
        case K.BOUNCE: r.f[MV.BOUNCE] = x; break;
        case K.DBOUNCE: r.f[MV.DBOUNCE] = x; break;
        case K.GROUND: r.f[MV.GROUND] = x; break;
        case K.DGROUND: r.f[MV.DGROUND] = x; break;
        case K.INITROT: r.u8[MV.RAND_INIT_ROT_B] = x === 0 ? 0 : 1; break;
        case K.BOUNCEROT: r.u8[MV.RAND_BOUNCE_ROT_B] = x === 0 ? 0 : 1; break;
        case K.BOUNCEANGLE: r.u8[MV.RAND_BOUNCE_ANGLE_B] = x !== 0 ? 1 : 0; break;
      }
    } else if (k === 4) {
      const id = keyId(v[0] as string);
      if (id === K.GRAV) { r.f[MV.GRAV] = v[1] as number; r.f[MV.GRAV + 1] = v[2] as number; r.f[MV.GRAV + 2] = v[3] as number; }
      else if (id === K.DGRAV) { r.f[MV.DGRAV] = v[1] as number; r.f[MV.DGRAV + 1] = v[2] as number; r.f[MV.DGRAV + 2] = v[3] as number; }
    }
  }
  r.u8[MV.COPY_B] = r.u8[MV.RAND_INIT_ROT_B];
  return r;
}

/** FUN_004509b0: `.emi` */
export function loadEmi(t: TextLines): Rec {
  const r = new Rec(EMI_SIZE);
  r.setName(t.line(0));
  let last = 0;
  for (let n = 1; n < t.count; n++) {
    const sc = scanf(t.line(n), '%s = %f %f %f');
    const k = sc.eof ? -1 : sc.values.length;
    if (k >= 2) last = sc.values[1] as number;
    if (k === 2) {
      const x = last;
      switch (keyId(sc.values[0] as string)) {
        case K.DENS: r.f[EM.DENS] = x; break;
        case K.DDENS: r.f[EM.DDENS] = x; break;
        case K.FORCE: r.f[EM.FORCE] = x; break;
        case K.DFORCE: r.f[EM.DFORCE] = x; break;
        case K.INC: r.f[EM.INC] = x; break;
        case K.EXC: r.f[EM.EXC] = x; break;
        case K.LIFE: r.f[EM.LIFE] = x; r.u8[EM.IMMORTAL_B] = 0 <= x ? 0 : 1; break;
        case K.DLIFE: r.f[EM.DLIFE] = x; break;
        case K.MAX: r.i[EM.MAX] = ftol(x); break;
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------------
// `.par` scripts

/** the script structure (0x78 bytes of the original) */
export class ParDef {
  name = '';
  /** +0x50: the parsed file (lines) */
  text!: TextLines;
  /** +0x54 / +0x58 / +0x5c: the records its `ExecuteScript` lines name (first match) */
  app: Rec | null = null;
  emi: Rec | null = null;
  mov: Rec | null = null;
  /** +0x60: [EMITS] blocks (0x350 each, `nEmits` allocated, the found ones compacted at the front) */
  emits: Rec[] = [];
  /** +0x64: [SPLASH] script snapshots (null = never written: uninitialised memory in the original) */
  splash: (ParDef | null)[] = [];
  /** +0x68: pool size (the largest iMaxParticles of its actions / emitter files) */
  maxParticles = 0;
  /** +0x6c / +0x70: number of lines of the [EMITS] / [SPLASH] sections */
  nEmits = 0;
  nSplash = 0;
  /** +0x74: sum of the iMaxParticles of the [EMITS] effects */
  subMax = 0;
  /** a copy of the struct as it is NOW (the [SPLASH] copy of FUN_00450e20: 0x1e dwords at the time of the call) */
  snapshot(): ParDef {
    const c = new ParDef();
    c.name = this.name; c.text = this.text; c.app = this.app; c.emi = this.emi; c.mov = this.mov;
    c.emits = this.emits; c.splash = this.splash; c.maxParticles = this.maxParticles; c.nEmits = this.nEmits; c.nSplash = this.nSplash; c.subMax = this.subMax;
    return c;
  }
}

/** swirl list (`.swl`, FUN_00451320): parsed in swirl.ts */
export interface SwlRing { appRec: Rec | null; points: number; direction: number; speed: number; radius: number; yawOffset: number; wobbleS: number; wobbleD: number }
export class SwirlDef { name = ''; rings: SwlRing[] = []; }

/** where the files of a particle directory come from: archive order */
export interface ParticleFiles {
  /** all files whose name ends with `ext` (without dot) in the particle directory, in the directory's order */
  list(ext: string): { name: string; data: Uint8Array }[];
  /** a single file (relative to the particle directory), case-insensitive; null when missing */
  read(name: string): Uint8Array | null;
}

const findByName = <T extends { name: string }>(list: T[], name: string): T | null => {
  // FUN_0044fb00 & friends: `strnicmp(name, stored, strlen(stored)) == 0 && strnicmp(name, stored, strlen(name)) == 0` = case-insensitive equality
  for (const e of list) if (strnicmpEq(name, e.name, e.name.length) && strnicmpEq(name, e.name, name.length)) return e;
  return null;
};
class NamedRec {
  name: string; rec: Rec;
  constructor(name: string, rec: Rec) { this.name = name; this.rec = rec; }
}

/** one particle directory */
export class ParticleDefs {
  readonly apps: NamedRec[] = [];
  readonly movs: NamedRec[] = [];
  readonly emis: NamedRec[] = [];
  readonly pars: ParDef[] = [];
  readonly swirls: SwirlDef[] = [];
  private files: ParticleFiles;

  constructor(files: ParticleFiles) {
    this.files = files;
    // FUN_0044fe30 order: .app, .mov, .emi, .par (+ scripts prepared), .swl
    for (const f of files.list('app')) { const r = loadApp(loadTextLines(f.data)); this.apps.push(new NamedRec(r.name, r)); }
    for (const f of files.list('mov')) { const r = loadMov(loadTextLines(f.data)); this.movs.push(new NamedRec(r.name, r)); }
    for (const f of files.list('emi')) { const r = loadEmi(loadTextLines(f.data)); this.emis.push(new NamedRec(r.name, r)); }
    for (const f of files.list('par')) this.pars.push(this.scanPar(loadTextLines(f.data)));
    for (const d of this.pars) this.prepare(d);
    for (const f of files.list('swl')) this.swirls.push(this.loadSwl(loadTextLines(f.data)));
  }

  findApp(name: string): Rec | null { return findByName(this.apps, name)?.rec ?? null; }
  findMov(name: string): Rec | null { return findByName(this.movs, name)?.rec ?? null; }
  findEmi(name: string): Rec | null { return findByName(this.emis, name)?.rec ?? null; }
  findPar(name: string): ParDef | null { return findByName(this.pars, name); }
  findSwirl(name: string): SwirlDef | null { return findByName(this.swirls, name); }
  readFile(name: string): Uint8Array | null { return this.files.read(name); }

  /** FUN_00450c80: name, file, and the first `ExecuteScript`-like line (`%s %s %f %s` with t = 0) that resolves in the app / emi / mov lists */
  private scanPar(t: TextLines): ParDef {
    const d = new ParDef();
    d.text = t; d.name = t.line(0);
    const first = (find: (n: string) => Rec | null): Rec | null => {
      for (let n = 1; n < t.count; n++) {
        const sc = scanf(t.line(n), '%s %s %f %s');
        if (sc.values.length === 4 && sc.values[2] === 0) { const r = find(sc.values[3] as string); if (r) return r; }
      }
      return null;
    };
    d.app = first((n) => this.findApp(n));
    d.emi = first((n) => this.findEmi(n));
    d.mov = first((n) => this.findMov(n));
    return d;
  }

  /** FUN_00450e20: sections, [EMITS] blocks, [SPLASH] snapshots, pool size */
  private prepare(d: ParDef): void {
    const t = d.text;
    const L = (i: number) => (i >= 0 && i < t.count ? t.line(i) : '');
    const is = (i: number, w: string) => strnicmpEq(L(i), w, w.length);
    d.maxParticles = 0; d.nEmits = 0; d.nSplash = 0; d.subMax = 0;
    d.emits = []; d.splash = [];
    let emitStart = 0, splashStart = 0;
    let i9 = 0;
    // do { ... } while (lines[i9] is not "[SCRIPT]")
    for (;;) {
      let i10: number;
      if (is(i9 + 1, '[EMITS]')) {
        emitStart = i9 + 2; i10 = emitStart;
        for (;;) {
          d.nEmits++;
          i10++;
          if (is(i10, '[SCRIPT]')) break;
          if (is(i10, '[SPLASH]')) break;
        }
      } else i10 = i9 + 1;
      i9 = i10;
      if (is(i9, '[SPLASH]')) {
        splashStart = i9 + 1; i9 = splashStart;
        for (;;) {
          d.nSplash++;
          i9++;
          if (is(i9, '[SCRIPT]')) break;
          if (is(i9, '[EMITS]')) break;
        }
      }
      if (is(i9, '[SCRIPT]')) break;
      if (i9 > t.count + 4) throw new Error(`particle script ${d.name}: no [SCRIPT] section`);
    }
    if (d.nEmits === 0) d.emits = [];
    else {
      for (let k = 0; k < d.nEmits; k++) d.emits.push(new Rec(BLK_SIZE));
      let slot = 0;
      for (let k = emitStart; k < d.nEmits + emitStart; k++) {
        const f = this.findPar(L(k));
        if (!f) continue;
        const b = d.emits[slot];
        b.setName(f.name);
        if (f.app) b.u8.set(f.app.u8.subarray(0, APP_SIZE), 0x248);
        if (f.mov) b.u8.set(f.mov.u8.subarray(0, MOV_SIZE), 0x104);
        if (f.emi) { b.u8.set(f.emi.u8.subarray(0, EMI_SIZE), 0x50); d.subMax += f.emi.i[EM.MAX]; }
        slot++;
      }
    }
    // FUN_00454760(file, 0) + FUN_004567b0: the compile with no source; its largest iMaxParticles
    const mgr = new Manager();
    const host: ActionHost = { tmpl: new Block(), ended: false, isNull: true, poolSize: 0, mgr, ps: null as never, defs: this };
    compileScript(d.text, host, 0, { frame: 0 });
    mgr.finish();
    d.maxParticles = maxParticlesOf(mgr);
    if (d.nSplash === 0) d.splash = [];
    else {
      for (let k = splashStart; k < d.nSplash + splashStart; k++) {
        const f = this.findPar(L(k));
        d.splash.push(f ? f.snapshot() : null);
      }
    }
  }

  private loadSwl(t: TextLines): SwirlDef {
    const s = new SwirlDef();
    s.name = t.line(0);
    const n = scanf(t.line(1), '%i').values[0] as number | undefined;
    const count = Math.min(n ?? 0, 8);
    for (let k = 0; k < count; k++) {
      const base = 2 + k * 7;
      const ring: SwlRing = {
        appRec: this.findApp(t.line(base)),
        points: (scanf(t.line(base + 1), '%i').values[0] as number) | 0,
        direction: (scanf(t.line(base + 2), '%i').values[0] as number) | 0,
        speed: scanf(t.line(base + 3), '%f').values[0] as number,
        radius: scanf(t.line(base + 4), '%f').values[0] as number,
        yawOffset: scanf(t.line(base + 5), '%f').values[0] as number,
        wobbleS: scanf(t.line(base + 6), '%f %f').values[0] as number,
        wobbleD: scanf(t.line(base + 6), '%f %f').values[1] as number,
      };
      s.rings.push(ring);
    }
    return s;
  }
}

