// A test-formats style `ctx` (dataRoot, dataDir, archives) for standalone node scripts (M5 hub surveys / bots that need the archives outside tools/test-formats.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archive } from '../../src/formats/archive.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let cached = null;
export function standaloneCtx(dataRoot = path.join(here, '../../public/data/le2')) {
  if (cached?.dataRoot === dataRoot) return cached;
  const dataDir = path.join(dataRoot, '_data');
  const archives = [];
  for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.bod')).sort()) {
    const n = f.slice(0, -4);
    archives.push(new Archive(n, fs.readFileSync(path.join(dataDir, f)), fs.readFileSync(path.join(dataDir, n + '.bob'))));
  }
  cached = { dataDir, dataRoot, soundsDir: path.join(dataDir, 'sounds'), archives, *entries(re) { for (const archive of archives) for (const entry of archive.entries) if (re.test(entry.path)) yield { archive, entry, data: archive.read(entry) }; } };
  return cached;
}
