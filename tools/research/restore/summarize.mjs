// usage: node summarize.mjs <jsondir> <out.tsv>  -> name, duration, text, mean token prob (special tokens excluded), min token prob
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [dir, out] = process.argv.slice(2);
const rows = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const text = j.transcription.map(s => s.text).join('').replace(/\s+/g, ' ').trim();
  const ps = j.transcription.flatMap(s => s.tokens).filter(t => !t.text.startsWith('[_')).map(t => t.p);
  const mean = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `/tmp/le2-restore/wav/${f.replace(/\.json$/, '.wav')}`]).toString());
  rows.push([f.replace(/\.json$/, ''), dur.toFixed(1), text, mean.toFixed(3), (ps.length ? Math.min(...ps) : 0).toFixed(2)].join('\t'));
}
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log(rows.join('\n'));
