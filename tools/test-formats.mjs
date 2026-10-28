#!/usr/bin/env node
// Parses every file of every archive with the pure TS parsers in src/formats and reports counts/failures.
//   node tools/test-formats.mjs [--data <dir with _data>] [--only name,name] [-v]
// Each check lives in tools/tests/<name>.mjs and default-exports
//   { name, run(ctx) -> { checked:number, failures:string[], notes?:string[] } }
// ctx = { dataDir, archives: Archive[], entries(extRegex) -> [{archive, entry, data}], soundsDir }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Archive } from '../src/formats/archive.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const verbose = args.includes('-v');
const dataRoot = opt('--data', path.join(here, '../public/data/le2'));
const dataDir = path.join(dataRoot, '_data');
const only = opt('--only', '')?.split(',').filter(Boolean);

const archives = [];
for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith('.bod')).sort()) {
  const n = f.slice(0, -4);
  archives.push(new Archive(n, fs.readFileSync(path.join(dataDir, f)), fs.readFileSync(path.join(dataDir, n + '.bob'))));
}
const ctx = {
  dataDir,
  dataRoot,
  soundsDir: path.join(dataDir, 'sounds'),
  archives,
  *entries(re) {
    for (const archive of archives) for (const entry of archive.entries) if (re.test(entry.path)) yield { archive, entry, data: archive.read(entry) };
  },
};

let totalFail = 0;
const files = fs.readdirSync(path.join(here, 'tests')).filter((f) => f.endsWith('.mjs')).sort();
console.log(`archives: ${archives.length}, members: ${archives.reduce((s, a) => s + a.entries.length, 0)}`);
for (const f of files) {
  const mod = (await import(pathToFileURL(path.join(here, 'tests', f)).href)).default;
  if (only?.length && !only.includes(mod.name)) continue;
  const t0 = Date.now();
  let res;
  try { res = await mod.run(ctx); } catch (e) { res = { checked: 0, failures: [`test crashed: ${e.stack || e}`] }; }
  totalFail += res.failures.length;
  console.log(`${res.failures.length ? 'FAIL' : 'ok  '} ${mod.name.padEnd(14)} checked ${String(res.checked).padStart(6)}  failures ${res.failures.length}  (${Date.now() - t0} ms)`);
  for (const n of res.notes ?? []) console.log(`       ${n}`);
  for (const x of res.failures.slice(0, verbose ? 1e9 : 8)) console.log(`       ! ${x}`);
  if (!verbose && res.failures.length > 8) console.log(`       ... ${res.failures.length - 8} more (-v)`);
}
console.log(totalFail ? `\n${totalFail} FAILURES` : '\nall formats parse with 0 failures');
process.exit(totalFail ? 1 : 0);
