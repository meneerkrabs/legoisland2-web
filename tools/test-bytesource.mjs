#!/usr/bin/env node
// Tests of the loading layer without a browser: GrowingSource (a download in progress), CachedSource (block cache over a
// "remote" source), the cabinet over both, and ISO + cabinet over a fake range source (byte counts).
//   node tools/test-bytesource.mjs [path to le2.iso]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { GrowingSource, blobSource, sliceSource } from '../src/engine/bytesource.ts';
import { CachedSource } from '../src/engine/rangesource.ts';
import { InstallShieldCab } from '../src/engine/installshield.ts';
import { IsoVfs } from '../src/engine/vfs.ts';
import { FileSet, cabFileRefs } from '../src/files.ts';

const ISO = process.argv[2] ?? '/Users/sander/Documents/legoeiland2-extract/le2.iso';
let fails = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fails++; };
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. GrowingSource: random chunks arrive while reads wait
{
  const size = 20 << 20;
  const data = crypto.randomBytes(size);
  const g = new GrowingSource(size);
  const reads = [];
  for (let i = 0; i < 40; i++) {
    const s = Math.floor(Math.random() * (size - 100000)), e = s + 1 + Math.floor(Math.random() * 100000);
    reads.push(g.read(s, e).then((b) => Buffer.compare(Buffer.from(b), data.subarray(s, e)) === 0));
  }
  ok('growing: nothing read before data arrives', !g.has(0, 1));
  let o = 0;
  while (o < size) { const n = Math.min(size - o, 1 + Math.floor(Math.random() * 700000)); g.append(data.subarray(o, o + n)); o += n; if (Math.random() < 0.1) await sleep(1); }
  ok('growing: all waiting reads got the right bytes', (await Promise.all(reads)).every(Boolean));
  ok('growing: has() after the end', g.has(0, size));
  ok('growing: whole read equals', md5(await g.read(0, size)) === md5(data));
  g.finish(new Blob([data]));
  ok('growing: after finish() reads come from the backing blob', md5(await g.read(1000, size - 1000)) === md5(data.subarray(1000, size - 1000)));
  const g2 = new GrowingSource(100);
  const p = g2.read(0, 100).then(() => 'resolved', (e) => 'rejected:' + e.message);
  g2.fail(new Error('boom'));
  ok('growing: fail() rejects waiting reads', (await p) === 'rejected:boom');
}

// 2. cabinet over a growing download: files become readable as their bytes arrive
{
  const dir = '/Users/sander/Documents/legoeiland2-extract/iso/LEGO Eiland 2/';
  const data2 = fs.readFileSync(dir + 'data2.cab');
  const g = new GrowingSource(data2.length);
  const cab = await InstallShieldCab.open(await fs.openAsBlob(dir + 'data1.hdr'), [await fs.openAsBlob(dir + 'data1.cab'), g]);
  const files = new FileSet('archive', cabFileRefs(cab), async () => null);
  const early = files.list().find((p) => /^_data\/Bricks\.bob$/i.test(p));
  const late = files.list().find((p) => /^_data\/z60FRE\.bob$/i.test(p));
  ok('cab+growing: files not loaded before the download', !files.loaded(early) && !files.loaded(late));
  const readEarly = files.read(early), readLate = files.read(late);
  const pos = (p) => cab.extent(cab.find('Game', p)).end;
  let o = 0, earlyDoneAt = -1, lateDoneAt = -1;
  readEarly.then(() => { earlyDoneAt = o; }); readLate.then(() => { lateDoneAt = o; });
  while (o < data2.length) { const n = Math.min(data2.length - o, 1 << 20); g.append(data2.subarray(o, o + n)); o += n; await sleep(0); }
  const [e, l] = await Promise.all([readEarly, readLate]);
  const ref = (p) => fs.readFileSync('/Users/sander/Documents/legoeiland2-extract/game/Game/' + p);
  ok('cab+growing: early file correct and done once its bytes were in', Buffer.compare(Buffer.from(e), ref(early)) === 0 && earlyDoneAt <= pos(early) + (1 << 20), `done at ${earlyDoneAt} of ${pos(early)}`);
  ok('cab+growing: late file correct, completes only after its bytes', Buffer.compare(Buffer.from(l), ref(late)) === 0 && lateDoneAt >= pos(late), `done at ${lateDoneAt} of ${pos(late)}`);
  ok('cab+growing: loaded() true afterwards, ready() resolves', files.loaded(late) && (await files.ready([late, early]), true));
}

// 3+4. block cache over a fake range source: request counts and bytes; ISO + cabinet over it
{
  const blob = await fs.openAsBlob(ISO);
  const base = blobSource(blob);
  const reqs = [];
  const remote = { size: base.size, read: async (s, e) => { reqs.push([s, e - s]); await sleep(2); return base.read(s, e); } };
  const cached = new CachedSource(remote, 'test');
  const a = await cached.read(1000, 600000);
  ok('cached: read correct', md5(a) === md5(await base.read(1000, 600000)));
  const n1 = reqs.length;
  await Promise.all([cached.read(2000, 3000), cached.read(100000, 400000), cached.read(0, 10)]);
  ok('cached: repeated reads need no new request', reqs.length === n1, `${n1} -> ${reqs.length}`);
  reqs.length = 0;
  await Promise.all([cached.prefetch(50_000_000, 56_000_000), cached.prefetch(50_000_000, 56_000_000), cached.read(53_000_000, 53_100_000)]);
  const fetched = reqs.reduce((n, r) => n + r[1], 0);
  ok('cached: concurrent overlapping reads fetch each block once', fetched <= 6_000_000 + 2 * 262144, `${fetched} bytes in ${reqs.length} requests`);

  reqs.length = 0;
  const c2 = new CachedSource(remote, 'test2');
  const iso = await IsoVfs.open(c2);
  const dir = 'LEGO Eiland 2/';
  const cab = await InstallShieldCab.open(iso.source(dir + 'data1.hdr'), [iso.source(dir + 'data1.cab'), iso.source(dir + 'data2.cab')]);
  const afterOpen = reqs.reduce((n, r) => n + r[1], 0);
  const fs2 = new FileSet('archive', cabFileRefs(cab), async () => null, c2.loading);
  const exe = await fs2.read('LEGO eiland 2.exe');
  ok('range route: EXE through ISO+cabinet over block cache is byte-identical', md5(exe) === md5(fs.readFileSync('/Users/sander/Documents/legoeiland2-extract/game/Game/LEGO eiland 2.exe')));
  ok('range route: ISO open + cabinet header + EXE fetch only a few MB', reqs.reduce((n, r) => n + r[1], 0) < 6_000_000, `${(afterOpen / 1e6).toFixed(2)} MB to open, ${(reqs.reduce((n, r) => n + r[1], 0) / 1e6).toFixed(2)} MB with the EXE, ${reqs.length} requests`);
  const want = ['_data/Bricks.bod', '_data/Bricks.bob', '_data/Fonts.bod', '_data/Fonts.bob', '_data/menu.bod', '_data/menu.bob'];
  reqs.length = 0;
  await fs2.ready(want);
  ok('range route: ready() merges neighbouring files into few requests', reqs.length <= 3 && want.every((p) => fs2.loaded(p)), `${reqs.length} requests, ${(reqs.reduce((n, r) => n + r[1], 0) / 1e6).toFixed(1)} MB`);
  const bob = await fs2.read('_data/Bricks.bob');
  ok('range route: Bricks.bob correct', md5(bob) === md5(fs.readFileSync('/Users/sander/Documents/legoeiland2-extract/game/Game/_data/Bricks.bob')));
  void sliceSource;
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
