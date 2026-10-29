#!/usr/bin/env node
// Restore audit (section 9): per script, commands (actor cmd target) that are active in the PlayStation twin *psx.txt but absent (or only commented) in the PC .txt, and the reverse.
//   node --experimental-strip-types tools/research/restore/psx-diff.mjs [/tmp/le2-unused/story/x] [zone...]
import fs from 'node:fs'; import path from 'node:path';
const X = process.argv[2] ?? '/tmp/le2-unused/story/x';
const only = process.argv.slice(3);
const cmds = (txt) => { const out = []; txt.split(/\r?\n/).forEach((l, i) => { const m = /^\s*(\/\/)?\s*(\d+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(l); if (m && /^[A-Za-z]/.test(m[5])) out.push({ line: i + 1, com: !!m[1], t: m[2], actor: m[4].toLowerCase(), cmd: m[5].toLowerCase(), args: m[6].trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase() }); }); return out; };
for (const zone of fs.readdirSync(X)) {
  if (only.length && !only.includes(zone)) continue;
  const d = fs.readdirSync(path.join(X, zone)).find((f) => /^cutscene$/i.test(f)); if (!d) continue;
  const cd = path.join(X, zone, d); const files = fs.readdirSync(cd);
  for (const f of files.filter((f) => /psx\.txt$/i.test(f))) {
    const base = f.replace(/psx\.txt$/i, ''); const pc = files.find((g) => g.toLowerCase() === base.toLowerCase() + '.txt'); if (!pc) continue;
    const P = cmds(fs.readFileSync(path.join(cd, f), 'latin1')), C = cmds(fs.readFileSync(path.join(cd, pc), 'latin1'));
    const key = (c) => `${c.actor} ${c.cmd} ${c.args}`;
    const cAct = new Map(); for (const c of C.filter((c) => !c.com)) cAct.set(key(c), (cAct.get(key(c)) ?? 0) + 1);
    const cCom = new Map(); for (const c of C.filter((c) => c.com)) cCom.set(key(c), c.line);
    const rows = [];
    const seen = new Map();
    for (const p of P.filter((p) => !p.com)) { const k = key(p); const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); if ((cAct.get(k) ?? 0) < n) rows.push(`  psx-only  psx:${p.line} t=${p.t} ${k}${cCom.has(k) ? `   [PC has it commented at ${cCom.get(k)}]` : ''}`); }
    console.log(`\n## ${zone}/${base}: ${P.filter((p) => !p.com).length} psx cmds, ${C.filter((c) => !c.com).length} pc cmds, ${rows.length} psx-only`);
    for (const r of rows) console.log(r);
  }
}
