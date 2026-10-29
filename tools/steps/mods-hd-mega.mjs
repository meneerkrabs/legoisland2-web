// The HD Texture Pack (webfischi, 512 MB RAR on MEGA) added from the catalogue in the headless browser, with timings and memory: the download goes through the MEGA protocol
// (AES-CTR in WebCrypto) into a temporary OPFS file, the RAR is unpacked file by file into the mod store, the temp file is deleted. Needs a normal browser profile for the
// storage quota (a throw-away profile has only ~100s of MB):
//   npx vite --port 5499 --strictPort &
//   node tools/browse.mjs "http://localhost:5499/" tools/steps/mods-hd-mega.mjs --profile /tmp/le2-hd-profile --size 1100x1000 --out /tmp/hd
//   HD_PROFILE=/tmp/le2-hd-profile  (same path: used to find the browser's processes for the memory figures)
// Then (optional, HD_PLAY=1) starts the game with the pack on and looks at the island.
import { execSync } from 'node:child_process';

const PROFILE = process.env.HD_PROFILE ?? '/tmp/le2-hd-profile';
/** resident memory (MB) of the headless browser started with this profile: the main process and everything below it (renderer, GPU, utility) */
function browserRss() {
  const rows = execSync('ps -axo pid=,ppid=,rss=,command=', { maxBuffer: 1 << 26 }).toString().split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }));
  const mains = rows.filter((r) => r.cmd.includes(`--user-data-dir=${PROFILE}`) && !r.cmd.includes('--type='));
  const mine = new Set(mains.map((r) => r.pid));
  let grew = true;
  while (grew) { grew = false; for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; } }
  const parts = rows.filter((r) => mine.has(r.pid));
  const by = (re) => Math.round(parts.filter((r) => re.test(r.cmd)).reduce((n, r) => n + r.rss, 0) / 1024);
  return { total: Math.round(parts.reduce((n, r) => n + r.rss, 0) / 1024), renderer: by(/--type=renderer/), gpu: by(/--type=gpu/), n: parts.length };
}

export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('.bdb-start');
  const q = await page.evaluate(async () => { const e = await navigator.storage.estimate(); return { quota: Math.round(e.quota / 1e6), usage: Math.round(e.usage / 1e6) }; });
  log('storage', JSON.stringify(q), 'MB');
  // start clean: remove an earlier copy
  await page.click('.bdb-mods > summary');
  await page.click('.bdb-cat > summary');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => Math.round((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1e6);
  let peak = { total: 0, renderer: 0, gpu: 0, heap: 0 };
  const sample = async () => { const r = browserRss(); const h = await heap(); peak = { total: Math.max(peak.total, r.total), renderer: Math.max(peak.renderer, r.renderer), gpu: Math.max(peak.gpu, r.gpu), heap: Math.max(peak.heap, h) }; return { ...r, heap: h }; };
  log('before', JSON.stringify(await sample()));
  const t0 = Date.now();
  await page.locator('.bdb-catentry').filter({ has: page.locator('.bdb-modhead b', { hasText: 'HD Texture Pack' }) }).first().locator('button', { hasText: /toevoegen/i }).evaluate((b) => b.click());
  let lastLog = 0, phaseDownloadEnd = 0, lastText = '';
  for (;;) {
    await wait(1000);
    const s = await page.evaluate(() => ({ text: document.querySelector('.bdb-modstatus')?.textContent ?? '', busy: document.querySelector('.bdb-mods').classList.contains('bdb-busy') }));
    const m = await sample();
    if (/^Importeren/.test(s.text) && !phaseDownloadEnd) phaseDownloadEnd = Date.now() - t0;
    if (Date.now() - lastLog > 10000) { lastLog = Date.now(); log(`${Math.round((Date.now() - t0) / 1000)} s  rss ${m.total} MB (renderer ${m.renderer}, gpu ${m.gpu}), JS heap ${m.heap} MB | ${s.text.slice(0, 110)}`); }
    lastText = s.text;
    if (!s.busy && /toegevoegd/.test(s.text)) break;
    if (Date.now() - t0 > 1500000) throw new Error('timeout');
  }
  const total = Date.now() - t0;
  log(`done in ${Math.round(total / 1000)} s (download ${Math.round(phaseDownloadEnd / 1000)} s, then unpack + store ${Math.round((total - phaseDownloadEnd) / 1000)} s); peak rss ${peak.total} MB (renderer ${peak.renderer}, gpu ${peak.gpu}), peak JS heap ${peak.heap} MB`);
  expect('HD Texture Pack added', !/niet toegevoegd/.test(lastText), lastText.slice(0, 200));
  await wait(800);
  const info = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-mods');
    let tmp = 0; try { const t = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-tmp'); for await (const _ of t.entries()) tmp++; } catch { /* none */ }
    const out = [];
    for await (const [, h] of root.entries()) { const m = JSON.parse(await (await h.getFileHandle('mod.json').then((f) => f.getFile())).text()); out.push({ title: m.title, files: m.files.length, bytes: m.files.reduce((n, f) => n + f.size, 0), origin: m.origin?.catalog }); }
    const e = await navigator.storage.estimate();
    return { mods: out, tmp, usage: Math.round(e.usage / 1e6) };
  });
  log(JSON.stringify(info));
  const hd = info.mods.find((m) => m.origin === 'hd-texture');
  expect('5032 files, 2,164,645,571 bytes (the HD pack without info.txt / installed)', hd && hd.files === 5032 && hd.bytes === 2164645571, JSON.stringify(hd));
  expect('the temporary 512 MB file is gone', info.tmp === 0);
  await shot('hd-added');
  if (process.env.HD_PLAY) {
    await page.selectOption('#le2-mode', '4:3');
    await page.check('#le2-skipintro');
    await page.click('button:has-text("Spelen")');
    await page.waitForFunction(() => window.__shell && __shell.menu && __shell.menu.engine.open, null, { timeout: 600000 });
    await shot('hd-menu');
  }
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all HD checks passed');
};
