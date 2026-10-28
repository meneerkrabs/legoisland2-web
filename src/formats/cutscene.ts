// Cutscene scripts: `Cutscene/<name>.txt` (source text) and `Cutscene/<name>.cut` (compiled form).
// Both formats are fully documented in docs/re/fragments/script-text.md. The compiled layout and the
// semantics were taken from the game EXE: text compiler FUN_00459c46 / FUN_00459fc6 (0x00459c46/0x00459fc6),
// binary loader FUN_0045d68a (0x0045d68a), scheduler FUN_00459119 / FUN_00459597, command name table FUN_0045988b.
import { Reader, latin1 } from './reader.ts';

/** Command ids, as registered by FUN_0045988b (name -> id). */
export const CUT_COMMANDS: Record<string, number> = {
  SETVISIBILITY: 0, SETANIM: 1, SAYTEXT: 2, SETTARGET: 3, MOVETARGET: 4, SETPOSITION: 5, MOVEPOSITION: 6,
  FOLLOW: 7, SETSWITCH: 8, WAV: 9, MIDI: 9, SETMOVESPEED: 10, SETTARGETSPEED: 11, SETFOV: 12,
  SETEXPRESSION: 13, ATTACH: 14, ENABLEAI: 15,
};
export const CUT_COMMAND_NAMES: string[] = [
  'SETVISIBILITY', 'SETANIM', 'SAYTEXT', 'SETTARGET', 'MOVETARGET', 'SETPOSITION', 'MOVEPOSITION', 'FOLLOW',
  'SETSWITCH', 'WAV/MIDI', 'SETMOVESPEED', 'SETTARGETSPEED', 'SETFOV', 'SETEXPRESSION', 'ATTACH', 'ENABLEAI',
];
/** Size in bytes of the fixed body record that follows the 4-char actor code, per command id. */
export const CUT_BODY_SIZE: Record<number, number> = {
  0: 0x28, 1: 0x30, 2: 0x3c, 3: 0x38, 4: 0x70, 5: 0x38, 6: 0x70, 7: 0x2c, 8: 0x2c, 9: 0x38,
  10: 0x28, 11: 0x28, 12: 0x28, 13: 0x28, 14: 0x2c, 15: 0x28,
};
/** target kinds for SETTARGET/SETPOSITION/MOVETARGET/MOVEPOSITION (table at 0x05d4d34c). */
export const CUT_TARGET_KINDS = ['waypoint', 'actor', 'spline'] as const;
/** side keywords of `setposition actor <code> <side>` (table at 0x05d48334): stored at body+0x2c; a missing or unknown word gives 0 as well. */
export const CUT_SIDES: Record<string, number> = { '': 0, HEAD: 0, FRONT: 1, BEHIND: 2, LSIDE: 3, RSIDE: 4 };
/** SETEXPRESSION keywords (table at 0x05d4d348). Numeric values 0..15 are also accepted. */
export const CUT_EXPRESSIONS: Record<string, number> = { HAPPY: 10, SAD: 12, ANGRY: 11, AFRAID: 13, SPECIAL1: 14, SPECIAL2: 15 };
/** ATTACH bone keywords (table at 0x05d48330). */
export const CUT_BONES: Record<string, number> = { GOB: 0, RIGHTHAND: 14, LEFTHAND: 16 };
/** SETMOVESPEED / SETTARGETSPEED keywords: SLOW/MED/FAST exist as a table but the compiler reads two ints. */

export interface CutCommand {
  cmd: number;
  name: string;
  /** 4-char actor code as stored (upper case), or `SWCH` / `CMRA` / `ACTO`...: see docs. */
  actor: string;
  /** body+8 (u16): the command starts when no running command still has this id as its signalId; 0 = immediately. */
  waitId: number;
  /** body+10 (u16): id this command signals when finished (0 = none). */
  signalId: number;
  /** body+0x0c: delay in seconds after the wait condition is released. */
  delay: number;
  /** body+0x10: duration in seconds (moveposition/movetarget), optional second float. */
  duration: number;
  /** body+0x24 for visibility/enableai (bool). */
  flag?: boolean;
  /** SETANIM animation name. */
  anim?: string;
  /** SAYTEXT message id (e.g. LECSPP02, resolved through messages/<lang>/*.str). */
  textId?: string;
  /** targeting commands: 'waypoint' | 'actor' | 'spline'. */
  targetKind?: 'waypoint' | 'actor' | 'spline';
  /** waypoint name, 4-char actor code, or spline `.man` path. */
  target?: string;
  /** SETPOSITION actor: side 0..4 (see CUT_SIDES). */
  side?: number;
  /** spline movement: the two u32 that follow the name (first/last index into the spline name table). */
  splineFirst?: number;
  splineCount?: number;
  /** FOLLOW / ATTACH: the other actor code. */
  other?: string;
  /** ATTACH: bone id. */
  bone?: number;
  /** SETSWITCH name / value (body+0x28). */
  switchName?: string;
  switchValue?: number;
  /** SETMOVESPEED / SETTARGETSPEED: two u16 at body+0x24 / +0x26. */
  speedA?: number;
  speedB?: number;
  /** SETFOV: f32 at body+0x24 (degrees? radians? see doc). */
  fov?: number;
  /** SETEXPRESSION: u8 at body+0x24. */
  expression?: number;
  /** raw body (CUT_BODY_SIZE bytes). */
  body: Uint8Array;
  /** the two u32 after the body (compiler artefact: results of two __ftol calls; ignored by the loader). */
  trailer: [number, number];
}

export interface Cutscene {
  name: string;
  version: number;
  /** the command count field in the header (number of non-blank, non-comment script lines: may exceed commands.length). */
  declaredCount: number;
  commands: CutCommand[];
  /** names appended at the end of the file (PSXSPLINE point names). */
  splineNames: string[];
}

function lenString(r: Reader): string {
  const n = r.u32();
  if (n > 0x1000) throw new Error(`string length ${n} implausible at ${r.pos - 4}`);
  return r.cstr(n);
}

export function parseCutscene(data: Uint8Array): Cutscene {
  const r = new Reader(data);
  const name = lenString(r);
  const version = r.u32();
  const declaredCount = r.u32();
  const commands: CutCommand[] = [];
  // The compiler writes one record per *recognised* script line, the header counts all lines; the file is
  // read until the spline table. Records are self-delimiting, so read until the remaining bytes can only be the table.
  // Strategy: parse records greedily; a record starts with a known command id followed by an actor code whose
  // first body word repeats the id.
  for (;;) {
    if (r.remaining < 12) break;
    const save = r.pos;
    const cmd = r.u32();
    if (cmd > 15) { r.pos = save; break; }
    const actorBytes = r.bytes(4);
    const size = CUT_BODY_SIZE[cmd];
    if (size === undefined || r.remaining < size + 8) { r.pos = save; break; }
    const body = r.bytes(size);
    const bdv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (bdv.getUint32(0, true) !== cmd) { r.pos = save; break; }
    const t1 = r.u32(), t2 = r.u32();
    const c: CutCommand = {
      cmd, name: CUT_COMMAND_NAMES[cmd], actor: latin1(actorBytes).replace(/\0.*$/, ''),
      waitId: bdv.getUint16(8, true), signalId: bdv.getUint16(10, true),
      delay: bdv.getFloat32(0xc, true), duration: bdv.getFloat32(0x10, true),
      body: body.slice(), trailer: [t1, t2],
    };
    switch (cmd) {
      case 0: case 15: c.flag = (bdv.getUint32(0x24, true) & 1) !== 0; break;
      case 1: c.anim = lenString(r); break;
      case 2: c.textId = lenString(r); break;
      case 3: case 5: {
        const k = bdv.getUint8(0x24);
        c.targetKind = CUT_TARGET_KINDS[k];
        if (!c.targetKind) throw new Error(`bad target kind ${k}`);
        c.side = bdv.getUint32(0x2c, true) | 0;
        c.target = k === 0 ? lenString(r) : latin1(r.bytes(4)).replace(/\0.*$/, '');
        break;
      }
      case 4: case 6: {
        const k = bdv.getUint8(0x24);
        c.targetKind = CUT_TARGET_KINDS[k];
        if (!c.targetKind) throw new Error(`bad target kind ${k}`);
        if (k === 1) c.target = latin1(r.bytes(4)).replace(/\0.*$/, '');
        else if (k === 2) { c.target = lenString(r); c.splineFirst = r.u32(); c.splineCount = r.u32(); }
        else c.target = lenString(r);
        break;
      }
      case 7: c.other = latin1(r.bytes(4)).replace(/\0.*$/, ''); break;
      case 8: c.switchValue = bdv.getInt32(0x28, true); c.switchName = lenString(r); break;
      case 9: { // WAV / MIDI (loader FUN_0045d68a case 9; the text compiler never emits it, no shipped file has one)
        c.switchValue = bdv.getInt32(0x2c, true);
        c.target = c.switchValue === 0 ? lenString(r) : latin1(r.bytes(4)).replace(/\0.*$/, '');
        break;
      }
      case 10: case 11: c.speedA = bdv.getUint16(0x24, true); c.speedB = bdv.getUint16(0x26, true); break;
      case 12: c.fov = bdv.getFloat32(0x24, true); break;
      case 13: c.expression = bdv.getUint8(0x24); break;
      case 14: c.bone = bdv.getInt32(0x28, true); c.other = latin1(r.bytes(4)).replace(/\0.*$/, ''); break;
      default: throw new Error(`unsupported command ${cmd}`);
    }
    commands.push(c);
  }
  // spline table: u32 count, then `count` x (u32 len, chars)
  const n = r.u32();
  const splineNames: string[] = [];
  for (let i = 0; i < n; i++) splineNames.push(lenString(r));
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  return { name, version, declaredCount, commands, splineNames };
}

// ------------------------------------------------------------------------------------------------ text form

export interface CutTextLine {
  lineNo: number;
  /** body+8 (see CutCommand.waitId) */
  waitId: number;
  delay: number;
  /** actor token as written (any case) */
  actor: string;
  /** command word as written (any case) */
  command: string;
  /** remaining whitespace separated tokens */
  args: string[];
  raw: string;
}
export interface CutText {
  version: number;
  name: string;
  lines: CutTextLine[];
  /** lines that did not have the `int float word word` prefix (comments, junk), with their line numbers. */
  skipped: { lineNo: number; raw: string }[];
}

/** Parse a cutscene source text. Lines: `waitId <ws> delay <ws> actor <ws> command <ws> args...`; `//` starts a comment line. */
export function parseCutsceneText(text: string): CutText {
  const lines = text.split(/\r\n|\r|\n/);
  let version = 0, name = '';
  let i = 0;
  const out: CutTextLine[] = [], skipped: { lineNo: number; raw: string }[] = [];
  let inScript = false;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === '') continue;
    if (!inScript) {
      if (/^\[SCRIPT\]/i.test(t)) { inScript = true; continue; }
      const m = /^(\S+)\s*(.*)$/.exec(t)!;
      if (/^CSMSCRIPTVERSION$/i.test(m[1])) version = parseInt(m[2], 10) || 0;
      else if (/^SCRIPTE?NAME$/i.test(m[1])) name = m[2].trim().split(/\s+/)[0] ?? '';
      continue;
    }
    if (t.startsWith('//')) continue;
    const tok = t.split(/\s+/);
    const w = cInt(tok[0]), d = cFloat(tok[1]);
    if (tok.length >= 4 && w !== null && d !== null) out.push({ lineNo: i + 1, waitId: w, delay: d, actor: tok[2], command: tok[3], args: tok.slice(4), raw });
    else skipped.push({ lineNo: i + 1, raw });
  }
  return { version, name, lines: out, skipped };
}

/** C `%i`-like integer: decimal, 0x hex, leading-0 octal. null if no digits. */
function cInt(s: string | undefined): number | null {
  if (s === undefined) return null;
  const m = /^([+-]?)(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/.exec(s);
  if (!m) return null;
  const v = m[2].startsWith('0x') || m[2].startsWith('0X') ? parseInt(m[2], 16) : m[2].length > 1 && m[2].startsWith('0') ? parseInt(m[2], 8) : parseInt(m[2], 10);
  return m[1] === '-' ? -v : v;
}
function cFloat(s: string | undefined): number | null {
  if (s === undefined) return null;
  const m = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Port of the game's text->binary compiler (FUN_00459fc6), to document and test how .txt maps to .cut.
 * The two trailer u32 of every record are the leftovers of two `__ftol` calls on the x87 stack and cannot be
 * reproduced; they are emitted as 0 (compare with `ignoreTrailer`).
 * Throws on lines the game would report with "Error converting cut scene".
 */
export function compileCutscene(text: string, opts: { splineStart?: number } = {}): Uint8Array {
  const src = text.toUpperCase();
  const lines = src.split(/\r\n|\r|\n/);
  let name = '';
  let idx = 0;
  // header
  for (; idx < lines.length; idx++) {
    const t = lines[idx].trim();
    if (/^\[SCRIPT\]/.test(t)) { idx++; break; }
    const m = /^SCRIPTE?NAME\s+(\S+)/.exec(t);
    if (m) name = m[1];
  }
  const scriptLines: string[] = [];
  for (; idx < lines.length; idx++) {
    const t = lines[idx].trim();
    if (t === '' || t.startsWith('//')) continue;
    scriptLines.push(lines[idx]);
  }
  const chunks: number[] = [];
  const u32 = (v: number) => { chunks.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
  const str4 = (s: string) => { for (let i = 0; i < 4; i++) chunks.push(i < s.length ? s.charCodeAt(i) & 255 : 0); };
  const lstr = (s: string) => { u32(s.length + 1); for (let i = 0; i < s.length; i++) chunks.push(s.charCodeAt(i) & 255); chunks.push(0); };
  u32(name.length + 1); for (const ch of name) chunks.push(ch.charCodeAt(0)); chunks.push(0);
  u32(4); u32(scriptLines.length);
  const splineNames: string[] = [];
  // DAT_05d48344 is a process global: it keeps the start index of the last registered spline name list and is
  // therefore carried across lines (and across files compiled in one run: shipped files show 12 left over from lgi04).
  let lastStart = opts.splineStart ?? 0;
  for (const line of scriptLines) {
    const tok = line.trim().split(/\s+/);
    const waitId = cInt(tok[0]), delay = cFloat(tok[1]);
    if (tok.length < 4 || waitId === null || delay === null) continue;
    const actor = tok[2];
    const cmd = CUT_COMMANDS[tok[3]];
    if (cmd === undefined || cmd === 9) continue;
    const size = CUT_BODY_SIZE[cmd];
    const body = new Uint8Array(0x70);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, cmd, true);
    dv.setUint16(8, waitId & 0xffff, true);
    dv.setFloat32(0xc, delay, true);
    dv.setFloat32(0x1c, delay, true);
    const a = tok.slice(4);
    // optional trailing "<int> [<float>]" (end id, duration) at positions `p`
    const optEnd = (p: number) => {
      const e = cInt(a[p]);
      if (e === null) return;
      dv.setUint16(10, e & 0xffff, true);
      const f = cFloat(a[p + 1]);
      if (f !== null) { dv.setFloat32(0x10, f, true); dv.setFloat32(0x20, f, true); }
    };
    const emit = (extra: () => void) => {
      u32(cmd); str4(actor);
      for (let i = 0; i < size; i++) chunks.push(body[i]);
      u32(Math.trunc(dv.getFloat32(0xc, true) * 4096)); u32(Math.trunc(dv.getFloat32(0x10, true) * 4096));
      extra();
    };
    // the game prints "Error converting cut scene" and drops the line (no record) on malformed lines
    const bad = Symbol();
    const need = (n: number) => { if (a.length < n) throw bad; };
    try { switch (cmd) {
      case 0: case 15: need(1); dv.setUint32(0x24, a[0].startsWith('TR') ? 1 : 0, true); emit(() => {}); break;
      case 1: need(1); optEnd(1); emit(() => lstr(a[0])); break;
      case 2: need(1); dv.setUint8(0x24, (a[0].length + 1) & 255); optEnd(1); emit(() => lstr(a[0])); break;
      case 3: case 5: {
        need(2);
        const k = a[0] === 'WAYPOINT' ? 0 : a[0] === 'ACTOR' ? 1 : a[0] === 'SPLINE' ? 2 : -1;
        if (k < 0) throw bad;
        dv.setUint8(0x24, k);
        if (cmd === 5 && k === 1) {
          // missing side is reported by the game but the record is still written (side 0)
          dv.setUint32(0x2c, CUT_SIDES[a[2] ?? ''] ?? 0, true);
        }
        emit(() => { if (k === 0) lstr(a[1]); else str4(a[1]); });
        break;
      }
      case 4: case 6: {
        need(2);
        const k = a[0] === 'WAYPOINT' ? 0 : a[0] === 'ACTOR' ? 1 : a[0] === 'SPLINE' ? 2 : -1;
        if (k < 0) throw bad;
        dv.setUint8(0x24, k);
        optEnd(2);
        if (k === 2) {
          const at = line.indexOf('PSXSPLINE');
          if (at < 0) throw bad;
          const names = line.slice(at + 9).trim().split(/\s+/).filter((s) => s !== '');
          // FUN_0045bcc5 registers every token after PSXSPLINE when there are at least two
          if (names.length >= 2) { lastStart = splineNames.length; for (const nm of names) splineNames.push(nm); }
        }
        emit(() => {
          if (k === 1) str4(a[1]);
          else if (k === 2) { lstr(a[1]); u32(lastStart); u32(splineNames.length); }
          else lstr(a[1]);
        });
        break;
      }
      case 7: need(1); optEnd(1); emit(() => str4(a[0])); break;
      case 8: {
        need(2);
        dv.setInt32(0x28, cInt(a[1]) ?? 0, true);
        optEnd(2);
        emit(() => lstr(a[0]));
        break;
      }
      case 10: case 11: {
        need(2);
        const x = cInt(a[0]) ?? 0, y = cInt(a[1]) ?? 0;
        dv.setUint16(0x24, (x || 1) & 0xffff, true); dv.setUint16(0x26, (y || 1) & 0xffff, true);
        emit(() => {});
        break;
      }
      case 12: { need(1); const f = cFloat(a[0]) ?? 0; dv.setFloat32(0x24, f >= 0.01 ? f : 0.01, true); emit(() => {}); break; }
      case 13: { need(1); const v = cInt(a[0]) ?? 0; if (v >= 16) throw bad; dv.setUint8(0x24, v); emit(() => {}); break; }
      case 14: {
        need(2);
        const b = CUT_BONES[a[1]]; if (b === undefined) throw bad;
        dv.setInt32(0x28, b, true);
        emit(() => str4(a[0]));
        break;
      }
    } } catch (e) { if (e !== bad) throw e; }
  }
  u32(splineNames.length);
  for (const s of splineNames) lstr(s);
  return Uint8Array.from(chunks);
}
