#!/usr/bin/env node
// Restore audit (section 9): per hub/zone cutscene script: active / commented / PSX saytext ids vs the messages file the slot declares.
//   node --experimental-strip-types tools/research/restore/scan-scripts.mjs [/tmp/le2-unused/story/x]
import fs from 'node:fs'; import path from 'node:path';
import { compileCutscene } from '../../../src/formats/cutscene.ts';
const X = process.argv[2] ?? '/tmp/le2-unused/story/x';
// slot declarations (FUN_0045c397(slot, script, messages) in the decompile)
const DECL = { // zone -> script(lower) -> messages(lower)
  z07CSI: { csi01: 'csi01', csi02: 'csi02', csi02a: 'csi02', csi04: 'csi04', csi05: 'csi05', csi06: 'csi06', csi07: 'csi07', csi08: 'csi08', csi09: 'csi09' },
  z14OSD: { adv01: 'adv01', adv05: 'adv05' }, z16PYA: { adv02: 'adv02', adv03: 'adv03' }, z21FSH: { adv04: 'adv04', adv11: 'adv11' },
  z23DIP: { adv07: 'adv07', adv10: 'adv10' }, z28HAT: { adv08: 'adv08', adv09: 'adv09' }, z40OGL: { ogl01: 'ogl01', ogl03: 'ogl03', ogl04: 'ogl04', ogl02: 'apo01' }, z42BRP: { brp01: 'ogl02' },
};
const strs = {};
for (const area of fs.readdirSync(path.join(X, 'messages'))) { const d = path.join(X, 'messages', area, 'Data'); if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) if (/\.str$/i.test(f)) strs[f.slice(0, -4).toLowerCase()] = fs.readFileSync(path.join(d, f), 'latin1').split(/\r?\n/).filter(Boolean).map((l) => { const m = /^([^:]*):(-?\d+)(.*)$/.exec(l); return m ? { tag: m[1], idx: +m[2], text: m[3].trim() } : null; }).filter(Boolean); }
const say = (txt) => { const out = []; txt.split(/\r?\n/).forEach((l, i) => { const m = /^\s*(\/\/)?\s*(\d+)\s+([\d.]+)\s+(\S+)\s+(saytext)\s+(\S+)(?:\s+(\d+))?/i.exec(l); if (m) out.push({ line: i + 1, commented: !!m[1], t: +m[2], actor: m[4], id: m[6], next: m[7] ?? '' }); }); return out; };
for (const [zone, scripts] of Object.entries(DECL)) {
  const dir = fs.readdirSync(path.join(X, zone)).find((f) => /^cutscene$/i.test(f)); const cd = path.join(X, zone, dir);
  const files = fs.readdirSync(cd);
  const pick = (n) => files.find((f) => f.toLowerCase() === n.toLowerCase());
  for (const [s, m] of Object.entries(scripts)) {
    const t = pick(s + '.txt'), p = pick(s + 'psx.txt'); if (!t) { console.log(zone, s, 'NO TXT'); continue; }
    const txt = fs.readFileSync(path.join(cd, t), 'latin1'); const A = say(txt);
    let ok = '';
    try { const c = compileCutscene(txt, { splineStart: 12 }); const cf = pick(s + '.cut'); if (cf) { const o = fs.readFileSync(path.join(cd, cf)); ok = c.length === o.length && c.every((b, i) => b === o[i]) ? 'cut==compile' : 'CUT DIFFERS'; } else ok = 'no .cut'; } catch (e) { ok = 'COMPILE ERR ' + e.message; }
    const ST = strs[m] ?? [];
    const act = new Set(A.filter((a) => !a.commented).map((a) => a.id.toUpperCase()));
    const com = A.filter((a) => a.commented).map((a) => a.id.toUpperCase());
    const psx = p ? say(fs.readFileSync(path.join(cd, p), 'latin1')) : [];
    const psxAct = new Set(psx.filter((a) => !a.commented).map((a) => a.id.toUpperCase()));
    const strTags = new Set(ST.map((x) => x.tag.toUpperCase()));
    console.log(`\n## ${zone}/${s} (messages ${m}.str ${ST.length} lines) ${ok}`);
    console.log('  active', [...act].join(' '));
    if (com.length) console.log('  commented-in-PC', com.join(' '));
    if (p) console.log('  psx-active-not-PC-active', [...psxAct].filter((x) => !act.has(x)).join(' ') || '-', '| psx-commented', psx.filter((a) => a.commented).map((a) => a.id).join(' ') || '-');
    console.log('  str-not-scripted', ST.filter((x) => !act.has(x.tag.toUpperCase())).map((x) => `${x.tag}:${x.idx}`).join(' ') || '-');
    console.log('  scripted-not-in-str', [...act].filter((x) => !strTags.has(x)).join(' ') || '-');
  }
}
