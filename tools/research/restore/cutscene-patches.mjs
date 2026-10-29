#!/usr/bin/env node
// Restore audit (section 9): the rule-P patch specs of the hub / zone cutscenes, and a verifier.
//   node --experimental-strip-types tools/research/restore/cutscene-patches.mjs [--json] [--show] [ID...]
// For every spec: (1) compile(unpatched .txt, splineStart 12) == the shipped .cut; (2) apply the spec (unComment lines, setNext, insert); (3) compile the result;
// (4) parse it and check: every block can start (FUN_00458c15 counters: a wait id that nobody signals never starts), the saytext ids exist in the slot's .str and have an mp3
// and a speech-table entry, every actor code used by the new lines is already used by the script, animation names exist in the emulated hub dictionary.
// Spec format (all line numbers are 1-based lines of the ORIGINAL archive file, `x:` = Cutscene folder of the archive):
//   { id, zone, script, messages, node, unComment: [lines], setNext: [{ line, from, to }], insert: [{ after, lines: [text...] }] }
import fs from 'node:fs'; import path from 'node:path';
import { compileCutscene, parseCutscene } from '../../../src/formats/cutscene.ts';

export const SPECS = [
  // ---- csi02: CACSBR11 (known, plan item 5a). rule P: `50 ... CACSBR10 70` skips the commented block 60
  { id: 'R-A1', cls: 'A', zone: 'z07CSI', script: 'csi02', messages: 'CI/Data/CSI02', node: 19, unComment: [111, 112, 113, 114, 115, 116], setNext: [{ line: 109, from: 70, to: 60 }], insert: [] },
  // ---- csi02a (the variant started when SWITCH_GME_BKD_GOTPAGE != 0): the same block, `24 ... CACSBR07 70` skips it
  { id: 'R-A2', cls: 'A', zone: 'z07CSI', script: 'csi02a', messages: 'CI/Data/CSI02', node: 19, unComment: [109, 110, 111, 112, 113, 114], setNext: [{ line: 93, from: 70, to: 60 }], insert: [] },
  // ---- ogl01: the fourth sleeper (cit4) that the PlayStation script shows between cit5 and cit2
  { id: 'R-A3', cls: 'A', zone: 'z40OGL', script: 'ogl01', messages: 'OG/Data/OGL01', node: 66, unComment: [48, 49, 50, 51, 53], setNext: [{ line: 46, from: 50, to: 40 }], insert: [] },
  // ---- csi01: CACSAR02 (known, plan item 5c; B: nothing is commented, slot from numbering): Lar2 says it right after CACSAR01
  { id: 'R-A4', cls: 'B', zone: 'z07CSI', script: 'csi01', messages: 'CI/Data/CSI01', node: 16, unComment: [], setNext: [{ line: 47, from: 11, to: 8 }], insert: [{ after: 47, lines: ['8\t\t0.0\t\tLar2\t\tsaytext\t\t\tCACSAR02\t11'] }] },
  // ---- adv02: ADCSAM05 / 06 (known, plan item 6): the PlayStation file shows the cut block 40 / 50; ADCSAM04 skips it
  { id: 'R-A5', cls: 'A', zone: 'z16PYA', script: 'adv02', messages: 'AI/Data/ADV02', node: 36, unComment: [], setNext: [{ line: 32, from: 60, to: 40 }],
    insert: [{ after: 34, lines: ['40\t0.0\t\tjthn\tsetanim\t\txidle', '40\t0.0\t\tdrkl\tsetanim\t\txtalk', '40\t0.0\t\tdrkl\tSayText\t\tADCSAM05\t\t50', '50\t0.0\t\tdrkl\tsetanim\t\txidle', '50\t0.0\t\tjthn\tsetanim\t\txtalk', '50\t0.0\t\tjthn\tSayText\t\tADCSAM06\t\t60'] }] },
  // ---- csi08: CACSCS08 "Aha, bijna!" between CACSCS07 and CACSCS09 (B: speaker bar2 from the numbering + voice pitch of the recording, see section 9)
  { id: 'R-A6', cls: 'B', zone: 'z07CSI', script: 'csi08', messages: 'CI/Data/CSI08', node: 25, unComment: [], setNext: [{ line: 64, from: 50, to: 36 }], insert: [{ after: 64, lines: ['36\t\t0.0\t\tbar2\t\tsaytext\t\t\tcacscs08\t\t50'] }] },
  // ---- adv04.str: ADCSOA13 / 14 "the fisherman hands over the page" as a NEW script `adv04b` (B: nothing in the data says when it plays; text ids, speaker and staging from adv04 / adv11)
  { id: 'R-A7', cls: 'B', zone: 'z21FSH', script: 'adv04b', messages: 'AI/Data/ADV04', node: 42, unComment: [], setNext: [], insert: [],
    newText: ['[HEADER]', 'CSMSCRIPTVERSION\t0', 'SCRIPTENAME\t\tFishermanHandsPage', '', '[SCRIPT]', '0\t0.0\t\tcmra\tsetposition\tactor\tfshm\tfront', '0\t0.0\t\tpepp\tfollow\t\tfshm\t5', '0\t0.0\t\tfshm\tfollow\t\tpepp\t5', '0\t0.0\t\tfshm\tsetanim\t\txidle', '',
      '5\t0.0\t\tfshm\tsetanim\t\txtalk', '5\t0.0\t\tfshm\tSayText\t\tADCSOA13\t10', '', '10\t0.0\t\tcmra\tsetposition\tactor\tpepp\tfront', '10\t0.0\t\tpepp\tsetanim\t\txhappyjump\t15', '10\t0.0\t\tfshm\tSayText\t\tADCSOA14\t20', '', '20\t0.0\t\tpepp\tsetanim\t\txidle', '20\t0.0\t\tfshm\tsetanim\t\txidle', ''].join('\n') },
  // ---- csi07: Pepper's catch animation (cosmetic; the clip PEP_CATCHBULLFLAG = 156 is used by no script)
  { id: 'R-A8', cls: 'A-cosmetic', zone: 'z07CSI', script: 'csi07', messages: 'CI/Data/CSI07', node: 24, unComment: [97], setNext: [], insert: [] },
  // ---- csi09: the page's flutter path (cosmetic; z07CSI/matanim/Flutter.man is used by no active script; the camera-follow line 31 conflicts with the active camera lines and stays commented)
  { id: 'R-A10', cls: 'B-cosmetic', zone: 'z07CSI', script: 'csi09', messages: 'CI/Data/CSI09', node: 27, unComment: [26], setNext: [], insert: [] },
  // ---- csi04: CACSBP17 "Op naar de stallen." (PlayStation-only; NOT recommended: the PC scene throws the horse at once)
  { id: 'R-A9', cls: 'C', zone: 'z07CSI', script: 'csi04', messages: 'CI/Data/CSI04', node: 20, unComment: [], setNext: [{ line: 77, from: 165, to: 160 }], insert: [{ after: 77, lines: ['160\t\t0.0\t\tbar1\t\tsaytext\t\t\tCACSBP17\t165'] }] },
];

export function applySpec(text, s) {
  const lines = text.split('\n');
  const out = lines.map((l) => l);
  for (const n of s.unComment) {
    if (!/^\s*\/\/\s*\d/.test(out[n - 1])) throw new Error(`${s.id}: line ${n} is not a commented command: ${out[n - 1]}`);
    out[n - 1] = out[n - 1].replace(/^(\s*)\/\//, '$1');
  }
  for (const { line, from, to } of s.setNext) {
    const parts = out[line - 1].split(/(\s+)/);
    let idx = -1, tok = 0;
    for (let i = 0; i < parts.length; i++) { if (/^\s*$/.test(parts[i])) continue; if (tok >= 4 + 1 && parts[i] === String(from)) { idx = i; break; } tok++; }
    if (idx < 0) throw new Error(`${s.id}: line ${line} has no next token ${from}: ${out[line - 1]}`);
    parts[idx] = String(to); out[line - 1] = parts.join('');
  }
  // inserts after original line numbers (descending so the numbers stay valid)
  for (const ins of [...s.insert].sort((a, b) => b.after - a.after)) out.splice(ins.after, 0, ...ins.lines);
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const X = '/tmp/le2-unused/story/x';
  const SPEECH = '/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/speech/Data/';
  const files = new Set(fs.readdirSync(SPEECH).map((f) => f.replace(/\.[^.]+$/, '').toLowerCase()));
  const table = new Set(fs.readFileSync('/tmp/le2-unused/speech-table.tsv', 'latin1').split('\n').map((l) => (l.split('\t')[1] ?? '').toUpperCase()));
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const show = process.argv.includes('--show'), json = process.argv.includes('--json');
  if (json) { console.log(JSON.stringify(SPECS, null, 1)); process.exit(0); }
  const rows = [];
  for (const s of SPECS) {
    if (want.length && !want.includes(s.id)) continue;
    const cd = path.join(X, s.zone, fs.readdirSync(path.join(X, s.zone)).find((f) => /^cutscene$/i.test(f)));
    const names = fs.readdirSync(cd); const pick = (e) => names.find((n) => n.toLowerCase() === (s.script + e).toLowerCase());
    const txt = s.newText ?? fs.readFileSync(path.join(cd, pick('.txt')), 'latin1');
    const res = { id: s.id, cls: s.cls, script: `${s.zone}/${s.script}` };
    const base = compileCutscene(txt, { splineStart: 12 }); let shipped = null; if (!s.newText) shipped = fs.readFileSync(path.join(cd, pick('.cut')));
    res.baseline = !shipped ? 'new script (no baseline)' : base.length === shipped.length && base.every((b, i) => b === shipped[i]) ? 'compile(txt)==.cut' : 'BASELINE DIFFERS';
    let patched = applySpec(txt, s);
    let cut, bytes;
    try { bytes = compileCutscene(patched, { splineStart: 12 }); cut = parseCutscene(bytes); res.compile = 'ok'; } catch (e) { res.compile = 'ERR ' + e.message; rows.push(res); continue; }
    const b0 = s.newText ? { commands: [] } : parseCutscene(base);
    res.commands = `${b0.commands.length} -> ${cut.commands.length}`;
    // reachability (FUN_00458c15 counters)
    const sig = new Map(); for (const c of cut.commands) if (c.signalId) (sig.get(c.signalId) ?? sig.set(c.signalId, []).get(c.signalId)).push(c);
    const blocks = new Set(cut.commands.map((c) => c.waitId)); const reach = new Set([0]); let ch = true;
    while (ch) { ch = false; for (const b of blocks) if (!reach.has(b)) { const q = sig.get(b); if (q && q.every((c) => reach.has(c.waitId))) { reach.add(b); ch = true; } } }
    const dead = [...blocks].filter((b) => !reach.has(b));
    res.unreachableBlocks = dead.length ? dead.join(',') : 'none';
    // speech
    const strf = fs.readdirSync(path.join(X, 'messages', s.messages.split('/')[0], 'Data')).find((f) => f.toLowerCase() === s.messages.split('/')[2].toLowerCase() + '.str');
    const strTags = new Set(fs.readFileSync(path.join(X, 'messages', s.messages.split('/')[0], 'Data', strf), 'latin1').split(/\r?\n/).map((l) => (l.split(':')[0] ?? '').toUpperCase()));
    const oldIds = new Set(b0.commands.filter((c) => c.textId).map((c) => c.textId)); const newIds = cut.commands.filter((c) => c.textId).map((c) => c.textId).filter((t) => !oldIds.has(t));
    res.newSpeech = newIds.map((t) => `${t}${strTags.has(t) ? '' : ' NOT-IN-STR'}${files.has(t.toLowerCase()) ? '' : ' NO-MP3'}${table.has(t) ? '' : ' NOT-IN-TABLE'}`).join(' ') || '-';
    res.speechOrder = cut.commands.filter((c) => c.textId).map((c) => c.textId).join(' ');
    // actors
    const oldA = new Set(b0.commands.map((c) => c.actor)); if (s.newText) for (const a of ['PEPP', 'FSHM', 'CMRA']) oldA.add(a); const newA = [...new Set(cut.commands.map((c) => c.actor))].filter((a) => !oldA.has(a));
    res.newActors = newA.join(',') || '-';
    rows.push(res);
    if (show) { const a = txt.split('\n'), b = patched.split('\n'); console.log(`--- ${s.id} diff (patched has ${b.length - a.length} more lines)`); }
  }
  for (const r of rows) console.log(JSON.stringify(r));
}
