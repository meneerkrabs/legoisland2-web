#!/usr/bin/env node
// Extract every file of the InstallShield cabinet with src/engine/installshield.ts and compare byte for byte with
// the tree unshield wrote (default output layout: <group>/<directory>/<file>, see tools header below).
//
//   node tools/test-installshield.mjs [cab-dir] [unshield-output-dir]
//
// cab-dir: folder with data1.hdr, data1.cab, data2.cab (default: the local CD copy)
// unshield-output-dir: `unshield -d <dir> x data1.cab` output (default: the local extraction)
// Needs node >= 22.18 (type stripping for the .ts import).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { InstallShieldCab } from '../src/engine/installshield.ts';

const cabDir = process.argv[2] ?? '/Users/sander/Documents/legoeiland2-extract/iso/LEGO Eiland 2';
const outDir = process.argv[3] ?? '/Users/sander/Documents/legoeiland2-extract/game';

// unshield's name sanitising (src/unshield.c extract_file): group and directory: ' < > [ ] -> _, '\\' -> '/', non-printable -> _
const sanitizeDir = (s) => s.replace(/[ <>[\]]/g, '_').replace(/[^\x20-\x7e]/g, '_');
const sanitizeName = (s) => s.replace(/[^\x20-\x7e]/g, '_');

const blob = (f) => fs.openAsBlob(path.join(cabDir, f));
const t0 = Date.now();
const cab = await InstallShieldCab.open(await blob('data1.hdr'), [await blob('data1.cab'), await blob('data2.cab')]);
console.log(`cabinet version ${cab.majorVersion}, groups: ${cab.groups.join(' | ')}`);
console.log(`${cab.entries.length} files (${cab.files('Game').length} in group Game) opened in ${Date.now() - t0} ms`);

let ok = 0, bad = 0, bytes = 0, md5bad = 0;
const t1 = Date.now();
for (const e of cab.entries) {
  const file = path.join(outDir, sanitizeDir(e.group), ...e.dir.split('/').filter(Boolean).map(sanitizeDir), sanitizeName(e.name));
  let expected;
  try { expected = await fsp.readFile(file); } catch { console.log(`MISSING in unshield output: ${file}`); bad++; continue; }
  let got;
  try { got = await cab.read(e); } catch (err) { console.log(`ERROR ${e.group}/${e.path}: ${err.message}`); bad++; continue; }
  bytes += got.length;
  if (Buffer.compare(Buffer.from(got.buffer, got.byteOffset, got.length), expected) !== 0) { console.log(`MISMATCH ${e.group}/${e.path}`); bad++; continue; }
  if (e.md5 && crypto.createHash('md5').update(got).digest('hex') !== e.md5) { console.log(`MD5 differs from descriptor: ${e.path}`); md5bad++; }
  ok++;
}
const split = cab.entries.filter((e) => e.flags & 1).length;
console.log(`${ok} identical, ${bad} mismatches/errors, ${md5bad} md5 differences; ${(bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t1) / 1000).toFixed(1)} s (${split} split files)`);
// case-insensitive lookup sanity
const probe = cab.find('Game', '_DATA\\bricks.BOB');
console.log(`find('Game', '_DATA\\\\bricks.BOB') -> ${probe ? probe.path + ' ' + probe.size : 'NOT FOUND'}`);
process.exit(bad || md5bad || !probe ? 1 : 0);
