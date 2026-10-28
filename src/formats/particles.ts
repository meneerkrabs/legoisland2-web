// Particle system definitions (text): `.par` scripts, `.app` (appearance) / `.emi` (emitter) / `.mov` (movement)
// key/value files and `.swl` swirl lists. Engine module: FX_Particles (CParticleEngine/CParticleAction/...).
// Key names + ids come from the keyword table in the EXE data (0x008b72a4..); documented in
// docs/re/fragments/script-text.md.

/** id, file kind and component count of every key used in `.app` / `.emi` / `.mov` (and in `.par` script actions). */
export const PARTICLE_KEYS: Record<string, { id: number; file: 'app' | 'emi' | 'mov'; n: number; doc: string }> = {
  fSCTIndex: { id: 1, file: 'app', n: 1, doc: 'start colour-table index (0..128)' },
  fSCTIndexInc: { id: 2, file: 'app', n: 1, doc: 'colour-table index increment per second' },
  iSSprite: { id: 3, file: 'app', n: 1, doc: 'start sprite (frame) index in the particle sheet (0..64)' },
  iESprite: { id: 4, file: 'app', n: 1, doc: 'end sprite (frame) index' },
  fSSize: { id: 5, file: 'app', n: 1, doc: 'start size' },
  fESize: { id: 6, file: 'app', n: 1, doc: 'end size' },
  rgbaSColour: { id: 7, file: 'app', n: 4, doc: 'start colour r g b a, 0..65280 (8.8 fixed point, 65280 = 255.0)' },
  rgbaEColour: { id: 8, file: 'app', n: 4, doc: 'end colour r g b a (same scale)' },
  fVSColour: { id: 9, file: 'app', n: 1, doc: 'random variation of the start colour' },
  fVEColour: { id: 10, file: 'app', n: 1, doc: 'random variation of the end colour' },
  fVSAlpha: { id: 11, file: 'app', n: 1, doc: 'random variation of the start alpha' },
  fVEAlpha: { id: 12, file: 'app', n: 1, doc: 'random variation of the end alpha' },
  fVSSize: { id: 13, file: 'app', n: 1, doc: 'random variation of the start size' },
  fVESize: { id: 14, file: 'app', n: 1, doc: 'random variation of the end size' },
  iUseModel: { id: 15, file: 'app', n: 1, doc: 'draw a 3D model instead of a sprite (always 0)' },
  iMaterial: { id: 16, file: 'app', n: 1, doc: 'material / blend mode index (0..2)' },
  fAir: { id: 18, file: 'mov', n: 1, doc: 'air resistance: velocity multiplier per step (0.99 typical)' },
  fDAir: { id: 19, file: 'mov', n: 1, doc: 'random deviation of fAir' },
  fBounce: { id: 20, file: 'mov', n: 1, doc: 'bounce factor on ground contact' },
  fDBounce: { id: 21, file: 'mov', n: 1, doc: 'random deviation of fBounce' },
  fGround: { id: 22, file: 'mov', n: 1, doc: 'ground level / ground flag' },
  fDGround: { id: 23, file: 'mov', n: 1, doc: 'random deviation of fGround' },
  vGravity: { id: 24, file: 'mov', n: 3, doc: 'gravity vector' },
  vDGravity: { id: 25, file: 'mov', n: 3, doc: 'random deviation of vGravity' },
  bRandInitRot: { id: 26, file: 'mov', n: 1, doc: 'randomise the initial rotation' },
  bRandBounceRot: { id: 27, file: 'mov', n: 1, doc: 'randomise the rotation on bounce' },
  bRandBounceAngle: { id: 28, file: 'mov', n: 1, doc: 'randomise the bounce angle' },
  fDensity: { id: 30, file: 'emi', n: 1, doc: 'particles emitted per second' },
  fDDensity: { id: 31, file: 'emi', n: 1, doc: 'random deviation of fDensity' },
  fForce: { id: 32, file: 'emi', n: 1, doc: 'initial speed' },
  fDForce: { id: 33, file: 'emi', n: 1, doc: 'random deviation of fForce' },
  fIncAngle: { id: 34, file: 'emi', n: 1, doc: 'inclusion angle of the emission cone (radians, <= pi)' },
  fExcAngle: { id: 35, file: 'emi', n: 1, doc: 'exclusion angle (inner cone without particles)' },
  fSpeedScale: { id: 36, file: 'emi', n: 1, doc: 'speed scale (in the key table, unused in the data)' },
  fLifespan: { id: 37, file: 'emi', n: 1, doc: 'particle lifetime in seconds (-1 = unlimited)' },
  fDLifespan: { id: 38, file: 'emi', n: 1, doc: 'random deviation of fLifespan' },
  iMaxParticles: { id: 39, file: 'emi', n: 1, doc: 'maximum live particles (4..5000)' },
};
/** Script command words (`.par`), ids from the same table. */
export const PARTICLE_COMMANDS: Record<string, number> = {
  SETEMIPRIMITIVE: 41, SETEMISSIONPARTICLE: 42, FORNEW: 43, FORALL: 44, RESETSCRIPT: 45, ENDSOURCE: 46, EXECUTESCRIPT: 47,
};
/** Emitter primitives of `SetEmiPrimitive` and their sub-properties (table after the key table). */
export const EMI_PRIMITIVES: Record<string, number> = { BOX: 0, LINE: 1, SPHERE: 2, RING: 3, CIRCLE: 4 };
export const EMI_PROPERTIES: Record<string, number> = { SET: -1, EMITMODE: 0, ANGLEMODE: 1, RADIUS: 2, SIZE: 3, POINTS: 4, ANGLE0: 5, ANGLE1: 6, DANGLE0: 7, DANGLE1: 8, LINESTART: 9, LINEEND: 10 };

export interface ParticleKV {
  /** first line of the file (its own name) */
  name: string;
  /** key -> numbers (known and unknown keys alike, keys kept as written) */
  values: Record<string, number[]>;
  /** keys not in PARTICLE_KEYS for this file kind (typos in the shipped data are ignored by the game) */
  unknown: string[];
  /** lines that are not `key = values` */
  junk: string[];
}
/** Parse `.app` / `.emi` / `.mov`: line 1 = file name, then `key = n n n` lines (tabs/spaces). */
export function parseParticleKV(text: string, file: 'app' | 'emi' | 'mov'): ParticleKV {
  const L = text.split(/\r\n|\r|\n/);
  const out: ParticleKV = { name: L[0].trim(), values: {}, unknown: [], junk: [] };
  for (let i = 1; i < L.length; i++) {
    const t = L[i].trim();
    if (t === '' || t.startsWith('//')) continue; // `//` lines are comments (commented-out keys exist in the data)
    const m = /^(\w+)\s*=\s*(.*)$/.exec(t);
    if (!m) { out.junk.push(t); continue; }
    const nums = m[2].trim().split(/\s+/).filter((x) => x !== '').map(Number);
    out.values[m[1]] = nums;
    const k = PARTICLE_KEYS[m[1]];
    if (!k || k.file !== file) out.unknown.push(m[1]);
  }
  return out;
}

export interface ParScriptLine {
  /** `ForNew` (applies to newly emitted particles) / `ForAll` (to live particles) or, rarely, the command repeated */
  when: string;
  /** key name (e.g. rgbaEColour) or command word (ExecuteScript, SetEmiPrimitive, EndSource, ResetScript) */
  action: string;
  /** remaining tokens: numbers parsed where numeric, otherwise kept as strings (file names, primitive names) */
  args: (number | string)[];
  line: number;
}
export interface ParScript {
  name: string;
  /** names listed under `[EMITS]` (other `.par` scripts emitted by this one) */
  emits: string[];
  /** names listed under `[SPLASH]` */
  splash: string[];
  script: ParScriptLine[];
}
/** Parse a `.par` script: name line, optional `[EMITS]` / `[SPLASH]` name lists, `[SCRIPT]` section. */
export function parseParScript(text: string): ParScript {
  const L = text.split(/\r\n|\r|\n/);
  const out: ParScript = { name: L[0].trim(), emits: [], splash: [], script: [] };
  let section = '';
  for (let i = 1; i < L.length; i++) {
    const t = L[i].trim();
    if (t === '') continue;
    if (t.startsWith('//')) continue;
    if (/^\[(EMITS|SPLASH|SCRIPT)\]$/i.test(t)) { section = t.slice(1, -1).toUpperCase(); continue; }
    if (section === 'EMITS') { out.emits.push(t); continue; }
    if (section === 'SPLASH') { out.splash.push(t); continue; }
    const tok = t.split(/\s+/);
    if (tok.length < 2) throw new Error(`line ${i + 1}: expected "when action ..." got "${t}"`);
    out.script.push({ when: tok[0], action: tok[1], args: tok.slice(2).map((x) => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(x) ? Number(x) : x)), line: i + 1 });
  }
  return out;
}

export interface SwlRing { app: string; points: number; direction: number; speed: number; radius: number; yawOffset: number; wobbleS: number; wobbleD: number }
export interface Swirl { name: string; rings: SwlRing[] }
/**
 * Parse a `.swl` swirl list: `//` comment lines, then whitespace separated tokens: name, ring count and per ring
 * app file, points, direction (+1/-1), speed, radius, yaw offset, sWobble, dWobble.
 */
export function parseSwirl(text: string): Swirl {
  const toks = text.split(/\r\n|\r|\n/).filter((l) => !l.trim().startsWith('//')).join(' ').split(/\s+/).filter((t) => t !== '');
  let p = 0;
  const name = toks[p++];
  const n = parseInt(toks[p++], 10);
  const rings: SwlRing[] = [];
  const num = () => { const v = Number(toks[p++]); if (!Number.isFinite(v)) throw new Error('swl: bad number'); return v; };
  for (let i = 0; i < n; i++) {
    const app = toks[p++];
    rings.push({ app, points: num(), direction: num(), speed: num(), radius: num(), yawOffset: num(), wobbleS: num(), wobbleD: num() });
  }
  if (p !== toks.length) throw new Error(`swl: ${toks.length - p} unparsed tokens`);
  return { name, rings };
}
