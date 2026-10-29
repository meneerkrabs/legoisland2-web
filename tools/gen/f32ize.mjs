// Source helper for the 24-bit x87 ports (docs/re/engine-m1.md 8.1): wraps every binary + - * / of the given line range in f32(...) unless the operation is the direct
// argument of an f32(...) call (that call already rounds it) or a string concatenation.  node tools/gen/f32ize.mjs <file.ts> <firstLine> <lastLine> [--dry]
// Review the result: integer arithmetic (indices, counters) is wrapped too (harmless), the order of the terms of a long sum is the source's (check it against the asm).
import fs from 'node:fs';
import { parseAst } from 'rolldown/parseAst';
const [file, a, b] = process.argv.slice(2);
const first = +a, last = +b, dry = process.argv.includes('--dry');
const text = fs.readFileSync(file, 'utf8');
const ast = parseAst(text, { lang: 'ts' });
const lineStarts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
const lineOf = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= pos) lo = m; else hi = m - 1; } return lo + 1; };
const ARITH = new Set(['+', '-', '*', '/']);
const isStr = (n) => !n ? false : n.type === 'TemplateLiteral' || (n.type === 'Literal' && typeof n.value === 'string') || (n.type === 'BinaryExpression' && n.operator === '+' && (isStr(n.left) || isStr(n.right)));
const isFr = (p) => p && p.type === 'CallExpression' && ((p.callee.type === 'Identifier' && ['f32', 'F', 'fr'].includes(p.callee.name)) || (p.callee.type === 'MemberExpression' && p.callee.object.name === 'Math' && p.callee.property.name === 'fround'));
const edits = [];
function walk(n, parent) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const c of n) walk(c, parent); return; }
  if (n.type === 'BinaryExpression' && ARITH.has(n.operator) && !isStr(n)) {
    if (lineOf(n.start) >= first && lineOf(n.end - 1) <= last && !isFr(parent)) edits.push([n.start, n.end]);
  }
  for (const k of Object.keys(n)) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = n[k]; if (v && typeof v === 'object') walk(v, n.type ? n : parent); }
}
walk(ast.body, null);
const ins = [];
for (const [s, e] of edits) { ins.push([e, ')', 0]); ins.push([s, 'f32(', 1]); }
// from the end of the text backwards; at equal positions the closing paren goes first (so it ends up after the opening ones of other nodes at that position)
ins.sort((x, y) => y[0] - x[0] || x[2] - y[2]);
let out = text;
for (const [pos, str] of ins) out = out.slice(0, pos) + str + out.slice(pos);
if (dry) console.log(`${edits.length} operations`); else { fs.writeFileSync(file, out); console.log(`${edits.length} operations wrapped in ${file} lines ${first}-${last}`); }
