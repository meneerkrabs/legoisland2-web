// Rule P (docs/re/restore-plan.md section 4): patched cutscene scripts. The shipped `.txt` of a script is the source of the shipped `.cut` (`compileCutscene(text, { splineStart: 12 })` reproduces
// 86 of the 87 `.cut` of the game byte for byte), so a restored beat is "un-comment the developers' commented block and set the previous line's next id to it": ORIGINAL data, compiled by the original's own
// format code. Inserted lines (`insert`) are RECONSTRUCTION and are marked so in the feature's table (docs/re/restore.md).
// Nothing of the game is stored: the text is read from the user's archive at run time. A patch only applies when the unpatched text still compiles to the archive's `.cut` (a changed data set is detected).
import type { Archive } from '../formats/archive.ts';
import { compileCutscene } from '../formats/cutscene.ts';

export interface ScriptPatch {
  /** the zone archive (`z07CSI`), the script name (`csi02`) */
  zone: string; script: string;
  /** 1-based lines of the archive's `.txt` whose leading `//` is removed (each must be a commented command) */
  unComment?: number[];
  /** the "next" id of a command line (the token after the arguments) changed: `from` must be the line's current value */
  setNext?: { line: number; from: number; to: number }[];
  /** a command line that has NO next id yet (a developer's cut: `40 ... LECSRS05` ends there) gets `to` appended as its next id */
  addNext?: { line: number; to: number }[];
  /** lines inserted after the given original line numbers */
  insert?: { after: number; lines: string[] }[];
  /** what this patch restores (docs / tests) */
  note?: string;
}

const CAPS = { splineStart: 12 };

/** apply the edits of a patch to the script text (line numbers of the ORIGINAL file). Throws when a line is not what the patch expects. */
export function patchText(text: string, p: ScriptPatch): string {
  const out = text.split('\n');
  for (const n of p.unComment ?? []) {
    if (!/^\s*\/\/\s*\d/.test(out[n - 1] ?? '')) throw new Error(`${p.script}: line ${n} is not a commented command`);
    out[n - 1] = out[n - 1].replace(/^(\s*)\/\/\s*/, '$1');
  }
  for (const { line, from, to } of p.setNext ?? []) {
    // a command line is `<id> <time> <actor> <command> <args...> <next>`: the next id is the last token (ids are decimal)
    const m = /^(.*?)(\d+)(\s*(?:\/\/.*)?\r?)$/.exec(out[line - 1] ?? '');
    if (m && Number(m[2]) === from) { out[line - 1] = `${m[1]}${to}${m[3]}`; continue; }
    // (hubcuts: `... cit5_cit5_sleep 50 2`: the next id is followed by a numeric argument: the first `from` token that only numbers follow)
    const m2 = new RegExp(`^(.*?\\s)${from}((?:\\s+-?\\d+(?:\\.\\d+)?)*\\s*(?:\\/\\/.*)?\\r?)$`).exec(out[line - 1] ?? '');
    if (!m2) throw new Error(`${p.script}: line ${line} does not end in next id ${from}`);
    out[line - 1] = `${m2[1]}${to}${m2[2]}`;
  }
  for (const { line, to } of p.addNext ?? []) {
    if (!/^\s*\d/.test(out[line - 1] ?? '')) throw new Error(`${p.script}: line ${line} is not a command`);
    const cr = out[line - 1].endsWith('\r') ? '\r' : '';
    out[line - 1] = `${out[line - 1].replace(/\s+$/, '')}\t${to}${cr}`;
  }
  for (const ins of [...(p.insert ?? [])].sort((a, b) => b.after - a.after)) out.splice(ins.after, 0, ...ins.lines);
  return out.join('\n');
}

const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** the patched `.cut` bytes of one script, or undefined when nothing applies / the data set is not the expected one */
export function patchedCut(arc: Archive, patches: readonly ScriptPatch[]): Uint8Array | undefined {
  if (patches.length === 0) return undefined;
  const base = patches[0];
  const txt = arc.find(`cutscene/${base.script}.txt`), cut = arc.find(`cutscene/${base.script}.cut`);
  if (!txt || !cut) return undefined;
  const text = latin1(arc.read(txt));
  let ok = false;
  try { ok = same(compileCutscene(text, CAPS), arc.read(cut)); } catch { ok = false; }
  if (!ok) { console.warn(`restore: ${base.zone}/${base.script}: the unpatched script does not compile to the archive's .cut: left alone`); return undefined; }
  // several patches of one script apply to the ORIGINAL line numbers one after the other: edits that insert lines are applied last-to-first by the caller's design (one patch per script is the norm)
  let t = text;
  for (const p of patches) t = patchText(t, p);
  return compileCutscene(t, CAPS);
}
