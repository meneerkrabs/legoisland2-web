// The built-in mod catalogue end to end in the headless browser (src/mods/catalogue.ts): the list with credits, adding the small mods from their real sources (RRU's file
// bucket, GitHub, archive.org through the relay, RAR through the WebAssembly unrar, IXS-look built from the IXS disc), the result in the mod list, the IXS-look files compared
// byte for byte with the reference mod (when ~/Documents/legoeiland2-extract/mods/ixs-look exists), and the failure paths (source offline / 404: a Dutch message and nothing left behind).
// The relay only allows the origins https://meneerkrabs.github.io and http://localhost:5498 / 5499, so serve the app there:
//   npx vite --port 5499 --strictPort &
//   node tools/browse.mjs "http://localhost:5499/" tools/steps/mods-catalogue.mjs --size 1100x1400 --out /tmp/cat
// Env: SKIP_IXS=1 skips the IXS disc (about 10 s of archive.org round trips).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REF = path.join(process.env.HOME, 'Documents/legoeiland2-extract/mods/ixs-look/IXS-look');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('.bdb-start');
  await page.click('.bdb-mods > summary');
  await page.click('.bdb-cat > summary');
  const entry = (title) => page.locator('.bdb-catentry').filter({ has: page.locator('.bdb-cathead b', { hasText: title }) }).first();
  const status = () => page.evaluate(() => document.querySelector('.bdb-modstatus')?.textContent ?? '');
  const modTitles = () => page.evaluate(() => [...document.querySelectorAll('.bdb-modlist .bdb-modhead b')].map((e) => e.textContent));
  const opfs = () => page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-mods', { create: true });
    const dirs = []; for await (const [n, h] of root.entries()) if (h.kind === 'directory') { let hasJson = true; try { await h.getFileHandle('mod.json'); } catch { hasJson = false; } dirs.push({ n, hasJson }); }
    let tmp = 0; try { const t = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-tmp'); for await (const _ of t.entries()) tmp++; } catch { /* none */ }
    return { dirs, tmp };
  });
  const add = async (title, ok = true) => {
    await entry(title).locator('button', { hasText: /toevoegen/i }).evaluate((b) => b.click());
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|niet toegevoegd/.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 180000 });
    const s = await status();
    expect(`${title}: ${ok ? 'added' : 'refused with a message'}`, ok ? !/niet toegevoegd/.test(s) : /niet toegevoegd/.test(s), s.slice(0, 220));
    return s;
  };

  // ---- the list
  const heads = await page.evaluate(() => [...document.querySelectorAll('.bdb-catlist .bdb-cathead b')].map((e) => e.textContent));
  expect('16 catalogue entries (8 addable, 4 other-version, 4 dead)', heads.length === 16, String(heads.length));
  const buttons = await page.locator('.bdb-catentry button').count();
  expect('only the 8 addable entries have a button', buttons === 8, String(buttons));
  const links = await page.evaluate(() => [...document.querySelectorAll('.bdb-catentry a')].map((a) => `${a.href}|${a.target}|${a.rel}`));
  expect('every entry links to its original thread (new tab, noopener)', links.length === 16 && links.every((l) => /^https:\/\/(rockraidersunited\.com|en\.wikipedia\.org)\/.*\|_blank\|noopener noreferrer$/.test(l)), links.slice(0, 2).join(' '));
  const text = await page.evaluate(() => document.querySelector('.bdb-cat').textContent);
  expect('credits (authors) and honest language notes are in the list', /webfischi/.test(text) && /Xiron/.test(text) && /JappaWakka/.test(text) && /Terrev/.test(text) && /EDlTOR/.test(text) && /Silicon Dreams/.test(text) && /Werkt niet op de Nederlandse versie/.test(text) && /Niet meer beschikbaar bij de bron/.test(text));
  await shot('cat-list');

  // ---- add the Dutch trio, Island Grass (one mod out of the manager's zip), Legal Tracks (two variants), HD font, the RAR
  await add('Nicer Skies (Nederlands)');
  await add('Bi-Plane Fuel Fix (Nederlands)');
  await add('Skateboard Speed Modifier (Nederlands)');
  await add('Island Grass');
  await add('Legal Tracks');
  const t0 = Date.now();
  await add('Skeleton Mod');
  log('skeleton (RAR via wasm unrar, 11 MB -> 45 MB):', Date.now() - t0, 'ms');
  await wait(800);
  let t = await modTitles();
  log('mod list:', t.join(' | '));
  expect('mods in the list: 1 + 2 + 1 + 1 + 2 + 1 = 8', t.length === 8, String(t.length));
  expect('Island Grass only (not the manager\'s other sample mods)', t.filter((x) => /grass/i.test(x)).length === 1 && !t.some((x) => /^(Debug Mode|Windowed Mode|Skipable Intros|Force Command Line)/.test(x)));
  const origin = await page.evaluate(() => [...document.querySelectorAll('.bdb-modlist .bdb-mod')].map((m) => /Uit de catalogus/.test(m.textContent)));
  expect('every added mod says it came from the catalogue', origin.every(Boolean));
  const state = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-mods');
    const out = []; for await (const [, h] of root.entries()) { const m = JSON.parse(await (await h.getFileHandle('mod.json').then((f) => f.getFile())).text()); out.push({ title: m.title, author: m.author, files: m.files.length, patches: m.patches.length, origin: m.origin?.catalog, enabled: m.enabled, source: m.source, desc: m.description.slice(0, 40) }); }
    return out;
  });
  log(JSON.stringify(state.map((s) => `${s.title}: ${s.files}f ${s.patches}p [${s.author}]`)));
  expect('Skeleton Mod unpacked 2806 files from the RAR', state.some((s) => /Skeleton/.test(s.title) && s.files === 2806));
  expect('catalogue authors replace the info.txt ones', state.some((s) => /Nicer Skies/.test(s.title) && s.author === 'JappaWakka') && state.some((s) => /Bi-Plane/.test(s.title) && s.author === 'Xiron, JappaWakka'));
  expect('the Dutch bi-plane zip gave its two variants as two mods', state.filter((s) => s.origin === 'biplane-nl').length === 2);
  expect('nothing is switched on by the catalogue itself except as a normal import (enabled, like any import)', state.every((s) => s.enabled));
  let o = await opfs();
  expect('no temporary download file is left', o.tmp === 0, JSON.stringify(o));
  expect('no half-imported mod directory is left', o.dirs.every((d) => d.hasJson), JSON.stringify(o.dirs));
  await shot('cat-added');

  // adding again replaces (no duplicates)
  await add('Island Grass');
  await wait(800);
  t = await modTitles();
  expect('adding Island Grass again replaces it', t.filter((x) => /grass/i.test(x)).length === 1 && t.length === 8, t.join(' | '));

  // ---- IXS-look from the disc
  if (!process.env.SKIP_IXS) {
    const t1 = Date.now();
    await add('IXS-look');
    log('IXS-look built in the browser from the disc:', Date.now() - t1, 'ms');
    const files = await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-mods');
      for await (const [, h] of root.entries()) {
        const m = JSON.parse(await (await h.getFileHandle('mod.json').then((f) => f.getFile())).text());
        if (m.origin?.catalog !== 'ixs-look') continue;
        const out = {};
        for (const f of m.files) {
          const buf = await (await h.getFileHandle(f.key).then((x) => x.getFile())).arrayBuffer();
          const d = await crypto.subtle.digest('SHA-256', buf);
          out[f.path] = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
        }
        return { files: out, title: m.title, author: m.author };
      }
      return null;
    });
    expect('IXS-look is in the store with 45 files', files && Object.keys(files.files).length === 45, files && String(Object.keys(files.files).length));
    if (fs.existsSync(REF) && files) {
      let same = 0; const bad = [];
      for (const [p, h] of Object.entries(files.files)) {
        const f = path.join(REF, p);
        if (fs.existsSync(f) && sha(fs.readFileSync(f)) === h) same++; else bad.push(p);
      }
      expect('IXS-look made in the browser is byte-identical to the reference mod (45 of 45 files)', same === 45 && !bad.length, `${same} identical; different: ${bad.slice(0, 3).join(', ')}`);
    } else log('skip: no reference mod at', REF);
  }

  // ---- failure paths: nothing is left behind
  const before = (await modTitles()).length;
  await page.route('**/x/ore/misc/**', (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'nope' }));
  let s = await add('Legal Tracks', false);
  expect('a 404 at the source gives a clear Dutch message', /404|verplaatst of verwijderd/.test(s), s);
  await page.unroute('**/x/ore/misc/**');
  await page.route('**/x/ore/misc/**', (r) => r.abort('internetdisconnected'));
  s = await add('Skeleton Mod', false);
  expect('an unreachable source gives a clear Dutch message', /niet bereiken|internet/.test(s), s);
  await page.unroute('**/x/ore/misc/**');
  // a damaged zip (the right size, wrong content)
  await page.route('**/x/ore/misc/legal_tracks_%28li2_mod_manager%29.zip', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.alloc(5000, 7) }));
  s = await add('Legal Tracks', false);
  expect('a damaged download is refused', /niet toegevoegd/.test(s), s);
  await page.unroute('**/x/ore/misc/legal_tracks_%28li2_mod_manager%29.zip');
  await page.route('https://g.api.mega.co.nz/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '[-16]' }));
  s = await add('HD Texture Pack', false);
  expect('a blocked MEGA file says so', /geblokkeerd|niet meer beschikbaar/.test(s), s);
  await page.unroute('https://g.api.mega.co.nz/**');
  await page.route('https://g.api.mega.co.nz/**', (r) => r.abort('internetdisconnected'));
  s = await add('HD Texture Pack', false);
  expect('MEGA offline says so', /MEGA is niet bereikbaar/.test(s), s);
  await page.unroute('https://g.api.mega.co.nz/**');
  o = await opfs();
  expect('after the failures: same number of mods, no orphan directories, no temporary file', (await modTitles()).length === before && o.dirs.every((d) => d.hasJson) && o.tmp === 0, JSON.stringify(o));

  // ---- persistence
  const listed = await modTitles();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.bdb-start'); await page.click('.bdb-mods > summary'); await wait(500);
  expect('the catalogue mods survive a reload and the catalogue shows them as added', JSON.stringify(await modTitles()) === JSON.stringify(listed) && (await page.locator('.bdb-catentry', { hasText: 'toegevoegd ✓' }).count()) === 7);
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all catalogue checks passed');
};
