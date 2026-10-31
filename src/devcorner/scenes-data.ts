// Ontwikkelaarshoek, section 10 "Scenes / animaties": the pure logic (no DOM, importable in node; tested by tools/tests/devcorner-scenes.mjs).
//  - the cutscene scripts of every archive (`Cutscene/<name>.cut` + `.txt`, 87 compiled), a readable listing of their commands, their message table and the flags of docs/re/unused.md 8.7:
//    "gerefereerd" (the executable names the script as a string: the zone set-ups pass the names as literals to FUN_0045c397, or a zone slot table of the port declares it),
//    "niet gerefereerd", "leeg script", "nooit getoond" (recorded lines no script says);
//  - the F9 "Debug Info" dialog's "Choose cut-scene" list (FUN_00401613 -> FUN_004013d0 -> FUN_00458b71 fills it; a click is FUN_00401613 case 0x41e -> FUN_00458bf8 -> FUN_00458d15);
//  - the `.man` animation paths (kind, keys, duration, bounds) and their "niet gerefereerd" classification (7.4), the `.cam` editor leftovers.
import type { Archive } from '../formats/archive.ts';
import { parseCutscene, parseCutsceneText } from '../formats/cutscene.ts';
import type { CutCommand, Cutscene } from '../formats/cutscene.ts';
import { parseMan } from '../formats/anim.ts';
import type { Man } from '../formats/anim.ts';
import { CameraSpline } from '../shell/cutscene.ts';
import type { CutsceneRunner } from '../shell/cutscene.ts';
import { CUTSCENE_ARCHIVES } from './text-data.ts';

export { CUTSCENE_ARCHIVES };

// ---------------------------------------------------------------------------------------------------------------- the EXE side

/** the executable's strings, lower case: `exact` = every string, `blob` = all of them joined (backslashes turned into slashes) for the research's substring rule */
export interface ExeNames { exact: Set<string>; blob: string; /** the strings that name a `.man` file, forward slashes */ man: string[] }
export function exeNames(strings: Iterable<string>): ExeNames {
  const exact = new Set<string>(), parts: string[] = [], man: string[] = [];
  for (const s of strings) { const l = s.toLowerCase(), f = l.replace(/\\/g, '/'); exact.add(l); parts.push(f); if (f.endsWith('.man')) man.push(f); }
  return { exact, blob: parts.join('\n'), man };
}

// ---------------------------------------------------------------------------------------------------------------- cutscene rows

export interface CutRow {
  /** `z02LGI/lgi01` */
  key: string;
  archive: string;
  /** file stem as stored (`lgi01`, `csi02a`, `adv06`) */
  name: string;
  hasCut: boolean;
  hasTxt: boolean;
  cutPath: string;
  txtPath: string;
  /** SCRIPTNAME of the compiled file (`TREXCOMMUNICATION`); '' without a .cut */
  scriptName: string;
  commands: number;
  /** the header's line count (lines of the source, comments excluded) */
  declared: number;
  /** distinct SAYTEXT ids, in order of first use */
  textIds: string[];
  /** number of SAYTEXT commands */
  sayCount: number;
  /** spline files the script names (`Z02LGI\MATANIM\PAGE1A.MAN`) */
  splines: string[];
  /** actor codes the script mentions (4 letters, without CMRA / SWCH / PLAY) */
  actors: string[];
  /** the executable has this name as a string (the set-up passes it to FUN_0045c397) */
  exeNamed: boolean;
  /** source text of a .txt-only entry says "NO LONGER USED" (csi03) */
  stub: boolean;
  /** PlayStation source variant (`...psx`) */
  psx: boolean;
  /** a parse problem of the .cut (a test requires none) */
  error: string;
}

const CUT_RE = /(?:^|\/)cutscene\/([^/]+)\.(cut|txt)$/i;

/** the actor codes of a script (the 4 letters the loader FUN_0045d5c0 looks records up by) */
export function scriptActors(cut: Cutscene): string[] {
  const out: string[] = [];
  const add = (s: string | undefined) => { if (s && s.length === 4 && !['CMRA', 'SWCH', 'PLAY', 'NULL', 'ACTO'].includes(s) && !out.includes(s)) out.push(s); };
  for (const c of cut.commands) { add(c.actor); if (c.targetKind === 'actor') add(c.target); if (c.cmd === 7 || c.cmd === 14) add(c.other); }
  return out;
}

/** every script of the archives: one row per file stem (`.cut` and / or `.txt`); `read` gives the bytes of a member */
export function cutRows(archives: readonly Archive[], exe: ExeNames): CutRow[] {
  const rows: CutRow[] = [];
  for (const a of archives) {
    const by = new Map<string, { cut?: string; txt?: string; stem: string }>();
    for (const e of a.entries) {
      const m = CUT_RE.exec(e.path);
      if (!m) continue;
      const k = m[1].toLowerCase();
      const g = by.get(k) ?? { stem: m[1] };
      if (m[2].toLowerCase() === 'cut') { g.cut = e.path; g.stem = m[1]; } else g.txt = e.path;
      by.set(k, g);
    }
    for (const [k, g] of [...by].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const r: CutRow = {
        key: `${a.name}/${g.stem}`, archive: a.name, name: g.stem, hasCut: !!g.cut, hasTxt: !!g.txt, cutPath: g.cut ?? '', txtPath: g.txt ?? '',
        scriptName: '', commands: 0, declared: 0, textIds: [], sayCount: 0, splines: [], actors: [], exeNamed: exe.exact.has(k), stub: false, psx: /psx$/i.test(g.stem), error: '',
      };
      if (g.cut) {
        try {
          const cut = parseCutscene(a.read(a.find(g.cut)!));
          r.scriptName = cut.name; r.commands = cut.commands.length; r.declared = cut.declaredCount;
          for (const c of cut.commands) {
            if (c.textId) { r.sayCount++; if (!r.textIds.includes(c.textId)) r.textIds.push(c.textId); }
            if (c.targetKind === 'spline' && c.target && !r.splines.includes(c.target)) r.splines.push(c.target);
          }
          r.actors = scriptActors(cut);
        } catch (e) { r.error = e instanceof Error ? e.message : String(e); }
      } else if (g.txt) {
        r.stub = /NO LONGER USED/i.test(latin1(a.read(a.find(g.txt)!)));
      }
      rows.push(r);
    }
  }
  return rows;
}

const latin1 = (b: Uint8Array): string => new TextDecoder('latin1').decode(b);
export { latin1 as latin1Text };

/** the unused.md 8.7 bookkeeping the port cannot compute from the data: slots the island's set-up declares but no code starts (LGICI05-07: empty scripts, no .str; LGI11 in the era-3 table). Research, UNCERTAIN. */
export const RESEARCH_NEVER_STARTED: readonly string[] = ['lgici05', 'lgici06', 'lgici07', 'lgi11'];

export interface Badge { text: string; kind: '' | 'ok' | 'warn' | 'info' | 'red'; title?: string }

export interface BadgeCtx {
  /** script names (lower case) the running zone's slot table declares (`run.cutscene`) */
  liveSlots?: ReadonlySet<string>;
  /** per script (lower case): how many recorded lines it has that no script says */
  unsaidBy?: ReadonlyMap<string, number>;
}

/** the badges of a row (the order is the reading order) */
export function badgesOf(r: CutRow, ctx: BadgeCtx = {}): Badge[] {
  const out: Badge[] = [];
  const lower = r.name.toLowerCase();
  const live = ctx.liveSlots?.has(lower) ?? false;
  if (r.hasCut) {
    if (r.exeNamed || live) out.push({ text: 'gerefereerd', kind: 'ok', title: [r.exeNamed ? 'de EXE bevat de naam als tekst (de zone-set-up geeft hem aan FUN_0045c397)' : '', live ? 'staat in de slottabel van de lopende zone' : ''].filter(Boolean).join('; ') });
    else out.push({ text: 'niet gerefereerd', kind: 'warn', title: 'geen EXE-tekst met deze naam en niet in de slottabel van de lopende zone' });
  } else {
    out.push({ text: 'alleen bron (.txt)', kind: 'info', title: 'er is geen .cut: het spel kan dit script niet laden' });
    out.push({ text: 'niet gerefereerd', kind: 'warn', title: 'zonder .cut kan geen zone dit script laden' + (r.exeNamed ? ' (de naam komt wel als losse EXE-tekst voor: toeval)' : '') });
  }
  if (r.stub) out.push({ text: 'verouderde stub', kind: 'warn', title: 'de bron zegt "NO LONGER USED"' });
  if (r.psx) out.push({ text: 'PlayStation-bron', kind: 'info' });
  if (r.hasCut && r.commands === 0) out.push({ text: 'leeg script', kind: 'warn', title: 'geen enkel commando' });
  if (r.hasCut && RESEARCH_NEVER_STARTED.includes(lower)) out.push({ text: 'nooit gestart (onderzoek)', kind: 'warn', title: 'unused.md 8.7: de slot is in de set-up gedeclareerd maar geen code start hem (niet berekend, onzeker)' });
  const u = ctx.unsaidBy?.get(lower) ?? 0;
  if (u > 0) out.push({ text: `${u} regel${u === 1 ? '' : 's'} nooit getoond`, kind: 'red', title: 'opgenomen (tekst + stem) maar door geen script gezegd' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- readable listing

const kindNl = { waypoint: 'waypoint', actor: 'acteur', spline: 'spline' } as const;
const SIDES = ['kop', 'voor', 'achter', 'linkerkant', 'rechterkant'];

/** the arguments of one command in words */
export function describeArgs(c: CutCommand): string {
  const t = c.targetKind ? `${kindNl[c.targetKind]} ${c.target ?? ''}` : '';
  switch (c.cmd) {
    case 0: return c.flag ? 'zichtbaar' : 'onzichtbaar';
    case 1: return `animatie ${c.anim}${c.duration ? `, ${c.duration} s` : ''}`;
    case 2: return `regel ${c.textId}${c.duration ? `, ${c.duration} s` : ''}`;
    case 3: return `kijkpunt = ${t}`;
    case 4: return `kijkpunt naar ${t}${c.targetKind === 'spline' ? ` (punten ${c.splineFirst}..${c.splineCount})` : ''}${c.duration ? `, ${c.duration} s` : ''}`;
    case 5: return `positie = ${t}${c.targetKind === 'actor' && c.side ? ` (${SIDES[c.side] ?? c.side})` : ''}`;
    case 6: return `positie naar ${t}${c.targetKind === 'spline' ? ` (punten ${c.splineFirst}..${c.splineCount})` : ''}${c.duration ? `, ${c.duration} s` : ''}`;
    case 7: return `volg ${c.other}`;
    case 8: return `schakelaar ${c.switchName} = ${c.switchValue}`;
    case 9: return `geluid ${c.target ?? ''}`;
    case 10: return `bewegingssnelheid ${c.speedA} / ${c.speedB}`;
    case 11: return `kijksnelheid ${c.speedA} / ${c.speedB}`;
    case 12: return `FOV ${c.fov !== undefined ? Math.round(c.fov * 1000) / 1000 : ''}`;
    case 13: return `uitdrukking ${c.expression}`;
    case 14: return `vastmaken aan ${c.other} (bot ${c.bone})`;
    case 15: return c.flag ? 'AI aan' : 'AI uit';
    default: return '';
  }
}

export interface ListingLine {
  index: number;
  /** "wacht op 5" / "meteen" */
  wait: string;
  /** "+1.5 s" or '' */
  delay: string;
  signal: string;
  actor: string;
  command: string;
  args: string;
  /** the SAYTEXT id, '' otherwise */
  textId: string;
}

/** the readable listing of a compiled script: one line per command, with the wait / signal ids that order them (FUN_00459119) */
export function listing(cut: Cutscene): ListingLine[] {
  return cut.commands.map((c, i) => ({
    index: i, wait: c.waitId ? `wacht op ${c.waitId}` : 'meteen', delay: c.delay ? `+${Math.round(c.delay * 100) / 100} s` : '', signal: c.signalId ? `meldt ${c.signalId}` : '',
    actor: c.actor, command: c.name, args: describeArgs(c), textId: c.textId ?? '',
  }));
}

/** one plain-text rendering of `listing` (tests, copy to clipboard) */
export function listingText(cut: Cutscene): string {
  return listing(cut).map((l) => `${String(l.index).padStart(3)}  ${l.wait.padEnd(11)} ${l.delay.padEnd(8)} ${l.actor.padEnd(5)} ${l.command.padEnd(13)} ${l.args}${l.signal ? `  -> ${l.signal}` : ''}`).join('\n');
}

/** the source text of a .txt in readable form (lines the game's parser keeps / skips): header values and the script lines */
export function sourceSummary(text: string): { name: string; version: number; lines: number; skipped: number } {
  const t = parseCutsceneText(text);
  return { name: t.name, version: t.version, lines: t.lines.length, skipped: t.skipped.length };
}

// ---------------------------------------------------------------------------------------------------------------- message tables

export interface StrFileRef { path: string; /** `LI` */ area: string; /** `LGI01` */ stem: string; tags: Set<string> }

/** which message file belongs to a script: the file with the same stem when there is one, else the file that holds most of its SAYTEXT ids (the port's choice when the slot table that names it is not known: brp01 uses OGL02, csi02a CSI02 ...) */
export function pickStrings(name: string, textIds: readonly string[], files: readonly StrFileRef[]): { file: StrFileRef | null; how: 'zelfde naam' | 'beste treffer' | 'geen' } {
  const same = files.find((f) => f.stem.toLowerCase() === name.toLowerCase());
  if (same) return { file: same, how: 'zelfde naam' };
  let best: StrFileRef | null = null, bestN = 0;
  for (const f of files) { const n = textIds.filter((t) => f.tags.has(t)).length; if (n > bestN) { best = f; bestN = n; } }
  return best ? { file: best, how: 'beste treffer' } : { file: null, how: 'geen' };
}

// ---------------------------------------------------------------------------------------------------------------- F9: "Choose cut-scene" (FUN_00401613)

/** the string the list shows for a slot the manager did not load: the executable's string at 0x8b8698 ("Not loaded") */
export const F9_NOT_LOADED_VA = 0x8b8698;

/**
 * FUN_00458b71(listbox): LB_RESETCONTENT, then for slot 0 .. DAT_05d47909 - 1: the slot's first word (DAT_05d4790c + i * 100) == 0 -> the string at 0x8b8698, else the name at +4.
 * `slots` = what the zone declared (`CutsceneRunner` keeps `{ name, script }` per slot, null = never defined). Called from FUN_004013d0 (dialog start, the Update button 0x3f3).
 */
export function f9List(slots: readonly (string | null)[], notLoaded = 'Not loaded'): string[] {
  return slots.map((s) => (s === null ? notLoaded : s));
}

/** what the dialog reaches of the cutscene manager */
export interface F9Target {
  /** DAT_05d47909: the number of slots */
  count: number;
  /** DAT_05d47908 == 1: the scheduler runs (FUN_00458f25) */
  running: boolean;
  /** FUN_00458d15(idx): start the slot (or queue it while a script is selected) */
  start(idx: number): boolean;
}

export type F9Result = 'gestart' | 'bezig' | 'buiten-lijst' | 'niet-gestart';

/**
 * the list box's selection change (FUN_00401613 case 0x41e with notification 1: LB_GETCURSEL (0x147) -> FUN_00458bf8(idx)): only when no script runs (DAT_05d47908 != 1) FUN_00458d15(idx)
 * is called; it ignores idx >= DAT_05d47909, selects the slot when none is selected (an empty script blocks the manager, see CutsceneRunner.start) and queues it otherwise.
 * Unlike FUN_0045c40c (the zones' call) there is no test of game variable 0xb (the "started from the menu" flag).
 */
export function f9Choose(t: F9Target, idx: number): F9Result {
  if (t.running) return 'bezig';
  if (idx >= t.count) return 'buiten-lijst';
  return t.start(idx) ? 'gestart' : 'niet-gestart';
}

/** the private state of the port's CutsceneRunner the dialog needs (slots, `running`) */
interface RunnerInternals { slots: ({ name: string } | null)[]; running: boolean }
const internals = (r: CutsceneRunner) => r as unknown as RunnerInternals;

/** the slot names of a runner (null = not loaded) */
export function runnerSlots(r: CutsceneRunner): (string | null)[] { return internals(r).slots.map((s) => s?.name ?? null); }

/** F9Target over the port's runner; `vars` is the zone's game variables (variable 0xb is zeroed around the start: the F9 path does not test it) */
export function f9Target(r: CutsceneRunner, vars: { get(i: number): number; set(i: number, v: number): void }): F9Target {
  return {
    get count() { return internals(r).slots.length; },
    get running() { return internals(r).running; },
    start(idx: number) {
      const keep = vars.get(0xb);
      if (keep !== 0) vars.set(0xb, 0);
      try { return r.start(idx); } finally { if (keep !== 0) vars.set(0xb, keep); }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- .man paths

export type ManKind = 'camera' | 'doel' | 'voorwerp' | 'meerdere';
export const MAN_KIND_LABEL: Record<ManKind, string> = { camera: 'camerapad', doel: 'kijkpunt-pad', voorwerp: 'voorwerppad', meerdere: 'meerdere voorwerpen' };

/** kind of a `.man` by its name (the files are anonymous matrix tracks: the cutscene that names them decides how the game uses them; for the unnamed ones this is the naming convention, bij benadering) */
export function manKind(stem: string, trackCount: number): ManKind {
  const s = stem.toLowerCase();
  if (trackCount > 1) return 'meerdere';
  if (/targ/.test(s)) return 'doel';
  if (/cam/.test(s)) return 'camera';
  return 'voorwerp';
}

/** the partner (look-at) path of a camera path: `bbcrashcam01` -> `bbcrashtarg01`, `bbcrash1cam` -> `bbcrash1target`, `cam_x` -> `targ_x` */
export function targetPartner(stem: string, have: ReadonlySet<string>): string | null {
  const s = stem.toLowerCase();
  for (const c of [s.replace(/cam/, 'targ'), s.replace(/cam/, 'target'), s.replace(/camera/, 'target')]) if (c !== s && have.has(c)) return c;
  return null;
}

/** the world points of a `.man` track: the game negates x (FUN_0043ecd0 / FUN_0043ee40) */
export function manPoints(man: Man, track = 0): number[][] {
  const d = man.tracks[track] ?? man.tracks[0], out: number[][] = [];
  for (let f = 0; f < man.frameCount; f++) out.push([-d[f * 9 + 3], d[f * 9 + 4], d[f * 9 + 5]]);
  return out;
}

export interface ManInfo {
  kind: ManKind;
  tracks: number;
  /** header frame count (the file has this many or one fewer) */
  keys: number;
  stored: number;
  /** length in seconds when played like a cutscene spline: `rate * DAT_008b1718` per sim step = count dt-units of 1/30 s (CameraSpline.rate = 1 / count; bij benadering for the object paths) */
  seconds: number;
  min: [number, number, number];
  max: [number, number, number];
  start: [number, number, number];
  end: [number, number, number];
  /** polyline length of the keys */
  length: number;
}

export function manInfo(stem: string, man: Man): ManInfo {
  const pts = manPoints(man, 0);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let k = 0; k < 3; k++) { if (pts[i][k] < min[k]) min[k] = pts[i][k]; if (pts[i][k] > max[k]) max[k] = pts[i][k]; }
    if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  const first = pts[0] ?? [0, 0, 0], last = pts[pts.length - 1] ?? [0, 0, 0];
  return {
    kind: manKind(stem, man.trackCount), tracks: man.trackCount, keys: man.declaredFrames, stored: man.frameCount, seconds: (man.declaredFrames * man.trackCount) / 30,
    min, max, start: [first[0], first[1], first[2]], end: [last[0], last[1], last[2]], length: len,
  };
}

/** sample a path as the game's camera spline does (B-spline over the keys), `n` points from 0 to 1 */
export function polyline(man: Man, n = 200): number[][] {
  const sp = new CameraSpline(man);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(sp.sample(Math.min(i / (n - 1), 0.99999)).slice());
  return out;
}

export type ManRef = 'exe-pad' | 'script' | 'naam' | null;
export const MAN_REF_LABEL: Record<Exclude<ManRef, null>, string> = {
  'exe-pad': 'de EXE bevat het volledige pad (`_data\\<zone>\\matanim\\<naam>.man`)',
  script: 'een spline-doel van een gebruikt script (SETTARGET / MOVETARGET ... spline)',
  naam: 'alleen de naam komt als tekst voor (in een EXE-tekenreeks of in de bron van een gebruikt script, ook uitgecommentarieerd): zwak',
};

export interface ManRow {
  key: string;
  archive: string;
  path: string;
  /** file stem as stored (`Act_bbFly1`) */
  name: string;
  size: number;
  ref: ManRef;
}

/** the text of every used script of an archive (a script whose name the EXE has), lower case with forward slashes: the research's corpus for the substring rule */
export function scriptCorpus(a: Archive, exe: ExeNames): string {
  let c = '';
  for (const e of a.entries) {
    const m = CUT_RE.exec(e.path);
    if (!m || m[2].toLowerCase() !== 'txt') continue;
    const stem = m[1].toLowerCase();
    if (!exe.exact.has(stem) || !a.find(e.path.replace(/\.txt$/i, '.cut'))) continue;   // used = the script has a .cut and the EXE names it
    c += `\n${latin1(a.read(e)).toLowerCase().replace(/\\/g, '/')}`;
  }
  return c;
}

/** the spline targets (`z02lgi/matanim/page1a.man`, lower case) of the compiled scripts the EXE names */
export function usedSplines(archives: readonly Archive[], exe: ExeNames): Set<string> {
  const out = new Set<string>();
  for (const a of archives) {
    for (const e of a.entries) {
      const m = CUT_RE.exec(e.path);
      if (!m || m[2].toLowerCase() !== 'cut' || !exe.exact.has(m[1].toLowerCase())) continue;
      try { for (const c of parseCutscene(a.read(e)).commands) if (c.targetKind === 'spline' && c.target) out.add(c.target.toLowerCase().replace(/\\/g, '/')); } catch { /* reported by cutRows */ }
    }
  }
  return out;
}

const MAN_RE = /(?:^|\/)([^/]+)\.man$/i;
const CAM_RE = /(?:^|\/)([^/]+)\.cam$/i;

/**
 * references of a file (`.man` / `.cam`) by the research's rule (docs/re/unused.md 7.4, tools/research/unused/man.mjs): the stem or base name as a substring of an EXE string or of the
 * source text of a used script of the same archive. "Stronger" evidence is reported first: the EXE has the full path / a used script's spline names it.
 */
export function refOf(archive: string, stem: string, base: string, exe: ExeNames, corpus: string, splines: ReadonlySet<string>, ext: 'man' | 'cam'): ManRef {
  const z = archive.toLowerCase(), s = stem.toLowerCase();
  if (ext === 'man') {
    const tail = `${z}/matanim/${s}.man`;
    for (const x of exe.man) if (x.endsWith(tail)) return 'exe-pad';
    for (const x of splines) if (x.endsWith(tail) || x === tail) return 'script';
  }
  const b = base.toLowerCase();
  if (corpus.includes(s) || corpus.includes(b) || exe.blob.includes(s) || exe.blob.includes(b)) return 'naam';
  return null;
}

export interface FileLists { man: ManRow[]; cam: ManRow[] }

/** every `.man` and `.cam` of the archives with its reference level (directory listings are enough: only names are needed) */
export function fileRows(archives: readonly Archive[], exe: ExeNames, corpora: ReadonlyMap<string, string>, splines: ReadonlySet<string>): FileLists {
  const man: ManRow[] = [], cam: ManRow[] = [];
  for (const a of archives) {
    for (const e of a.entries) {
      const mm = MAN_RE.exec(e.path), cm = CAM_RE.exec(e.path);
      const m = mm ?? cm;
      if (!m) continue;
      const base = /([^/]+)$/.exec(e.path)![1];
      const ext = mm ? 'man' : 'cam';
      const row: ManRow = { key: `${a.name}/${e.path}`, archive: a.name, path: e.path, name: m[1], size: e.size, ref: refOf(a.name, m[1], base, exe, corpora.get(a.name) ?? '', splines, ext) };
      (mm ? man : cam).push(row);
    }
  }
  return { man, cam };
}

/** parse a `.man` of a loaded archive (null when the archive cannot be read) */
export function readMan(a: Archive, path: string): Man | null {
  const e = a.find(path);
  if (!e) return null;
  try { return parseMan(a.read(e)); } catch { return null; }
}

/** the zone each archive's paths belong to (where the "vlieg" button is meant to be used): the archive's own zone, for the island's paths z02LGI */
export const MAN_HOST_ZONE = (archive: string): string => archive;
