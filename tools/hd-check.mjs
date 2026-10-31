#!/usr/bin/env node
// Headless check of the start-screen option "HD-textures" (src/mods/hd.ts, hdui.ts): never your own browser, muted, in a persistent profile folder (a real storage quota).
// Run through the bot slot:  sh tools/m5-botslot.sh node tools/hd-check.mjs <scenario> [--url http://localhost:5611/] [--profile /tmp/hd-prof] [--out /tmp/hd-shots]
//   lowend      mobile UA + touch / little memory / little room: the box must be unchecked with an explanation (3 fresh contexts, no game)
//   first       first visit on a capable profile: box checked, background install starts, press "Spelen", the game plays meanwhile; prints time to playable / time to HD /
//               frame times / memory; waits for the install to finish
//   lazy        archive.org source (needs the relay or a stand-in: --relay http://localhost:5612): first visit, press "Spelen", the island's HD archive is fetched in the background
//   island      with the pack installed: the island loads HD textures (WebGL texture sizes against `?mods=off`)
//   interrupt   start the install, kill the browser at ~25% (a "reload mid-download"), reopen: no leftovers, the install restarts
//   uncheck     with the pack installed: unchecking offers to remove it; afterwards the store is empty; then check again while it installs and uncheck mid-download
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const scenario = args[0];
const URL_ = opt('--url', 'http://localhost:5498/');
const profile = opt('--profile', '/tmp/hd-prof');
const out = opt('--out', '/tmp/hd-shots');
const relay = opt('--relay', '');   // a stand-in for the nginx relay (?relay=...)
fs.mkdirSync(out, { recursive: true });
const launchArgs = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (...a) => console.log(ts(), ...a);

// every WebGL2 texture upload / storage size is counted (to compare the island with and without the pack)
const GL_SPY = () => {
  const hist = {};
  window.__texHist = hist;
  const note = (w, h) => { const k = Math.max(w, h); hist[k] = (hist[k] ?? 0) + 1; };
  const P = WebGL2RenderingContext.prototype;
  const t2 = P.texImage2D; P.texImage2D = function (...a) { if (typeof a[3] === 'number' && a[1] === 0) note(a[3], a[4]); return t2.apply(this, a); };
  const ts2 = P.texStorage2D; P.texStorage2D = function (t, l, f, w, h) { note(w, h); return ts2.call(this, t, l, f, w, h); };
  const cti = P.compressedTexImage2D; P.compressedTexImage2D = function (t, l, f, w, h, ...r) { if (l === 0) note(w, h); return cti.call(this, t, l, f, w, h, ...r); };
};

async function open(opts = {}) {
  const ctx = await chromium.launchPersistentContext(opts.profile ?? profile, { headless: true, args: launchArgs, viewport: { width: 1024, height: 768 }, ...(opts.context ?? {}) });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('DBG')) log(`[${m.type()}]`, m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log('[pageerror]', e.message));
  page.on('dialog', async (d) => { log('[dialog]', d.message().replace(/\n/g, ' / ')); await d.accept(); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.addInitScript(GL_SPY);
  await page.addInitScript(() => { try { if (!localStorage.getItem('le2-display')) localStorage.setItem('le2-display', JSON.stringify({ skipIntro: true })); } catch { /* none */ } });   // the intro movies only slow the test down
  return { ctx, page };
}
const hdInfo = (page) => page.evaluate(async () => {
  const note = document.getElementById('le2-hd-note');
  const root = await navigator.storage.getDirectory();
  const names = [];
  for await (const [n] of root.entries()) names.push(n);
  let mods = [];
  try {
    const d = await root.getDirectoryHandle('le2-mods');
    for await (const [n, h] of d.entries()) { let json = false; try { await h.getFileHandle('mod.json'); json = true; } catch { /* none */ } mods.push({ n: n.slice(0, 8), json }); }
  } catch { /* none */ }
  const cache = [];
  try {
    const d = await root.getDirectoryHandle('le2-hd');
    for await (const [n, h] of d.entries()) { if (h.kind !== 'directory') continue; let done = false; try { await h.getFileHandle('done.json'); done = true; } catch { /* partial */ } cache.push(n + (done ? '' : '(partial)')); }
  } catch { /* none */ }
  const est = await navigator.storage.estimate();
  return { checked: document.getElementById('le2-hd')?.checked, note: note?.textContent, state: window.__le2Hd?.state, root: names, mods, cache, usageMB: Math.round((est.usage ?? 0) / 1e6), quotaMB: Math.round((est.quota ?? 0) / 1e6) };
});
const waitStart = (page) => page.waitForSelector('#le2-hd', { timeout: 60000 });
const pressPlay = (page) => page.getByRole('button', { name: 'Spelen' }).click();
const heapMB = (page) => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1));
/** frame statistics over `ms` of requestAnimationFrame */
const frames = (page, ms) => page.evaluate((ms) => new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + ms;
  const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ n: d.length, medianMs: +d[d.length >> 1].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1), maxMs: +d[d.length - 1].toFixed(1) }); } };
  requestAnimationFrame(f);
}), ms);
const sizes = (page) => page.evaluate(() => { const h = window.__texHist ?? {}; const k = Object.keys(h).map(Number).sort((a, b) => a - b); const n = k.reduce((s, x) => s + h[x], 0); return { uploads: n, maxSide: k[k.length - 1] ?? 0, over512: k.filter((x) => x > 512).reduce((s, x) => s + h[x], 0), hist: h }; });

async function lowend() {
  const cases = [
    ['iPhone UA + touch', { context: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } }],
    ['deviceMemory 4', { init: () => Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 }) }],
    ['small quota (?hdcaps=noroom)', { suffix: '?hdcaps=noroom' }],
    ['desktop, memory 8 (control)', { init: () => Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }) }],
  ];
  for (const [name, o] of cases) {
    const dir = `/tmp/hd-prof-low-${Math.random().toString(36).slice(2, 6)}`;
    const { ctx, page } = await open({ ...o, profile: dir });
    await page.goto(URL_ + (o.suffix ?? ''));
    await waitStart(page);
    await sleep(1500);
    const i = await hdInfo(page);
    log(name, '-> checked:', i.checked, '| state:', i.state?.phase, '|', i.note);
    await page.screenshot({ path: `${out}/hd-low-${name.replace(/\W+/g, '_')}.png` });
    if (o.suffix === undefined && name.startsWith('iPhone')) { // an explicit choice wins: turn it on, then off again (the install is cancelled at once)
      await page.evaluate(() => { window.confirm = () => true; });
      await page.locator('#le2-hd').check();
      await sleep(1200);
      const on = await hdInfo(page);
      log('  turned on by hand ->', on.checked, on.state?.phase, '| stored:', await page.evaluate(() => localStorage.getItem('le2-display')));
      await page.locator('#le2-hd').uncheck();
      await sleep(800);
      log('  off again ->', (await hdInfo(page)).state?.phase);
    }
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function first() {
  fs.rmSync(profile, { recursive: true, force: true });
  const { ctx, page } = await open();
  await page.goto(URL_ + (relay ? `?relay=${relay}` : ''));
  await waitStart(page);
  let i = await hdInfo(page);
  log('start screen: checked', i.checked, '| quota', i.quotaMB, 'MB, usage', i.usageMB, 'MB |', i.note);
  await page.screenshot({ path: `${out}/hd-first-start.png` });
  const tClick = Date.now();
  await pressPlay(page);
  await page.waitForFunction(() => !!window.__shell, null, { timeout: 120000 });
  log('game shell up', ((Date.now() - tClick) / 1000).toFixed(1), 's after "Spelen"; heap', await heapMB(page), 'MB');
  let playableAt = null;
  for (let k = 0; k < 600; k++) {   // poll: progress, frame times, done
    await sleep(2000);
    i = await hdInfo(page);
    const badge = await page.evaluate(() => document.getElementById('le2-hdbadge')?.textContent ?? null);
    if (k % 5 === 0 || i.state?.phase === 'done') {
      const fr = await frames(page, 1500);
      log(`[${i.state?.phase}] badge="${badge}" heap ${await heapMB(page)} MB usage ${i.usageMB} MB frames`, JSON.stringify(fr));
      if (k === 2) await page.screenshot({ path: `${out}/hd-first-ingame.png` });
    }
    if (playableAt === null && (await page.evaluate(() => !!window.__zone))) { playableAt = (Date.now() - tClick) / 1000; log('zone running (playable) after', playableAt.toFixed(1), 's'); }
    if (i.state?.phase === 'done' || i.state?.phase === 'error') break;
  }
  log('install finished:', JSON.stringify(i.state), 'mods in store:', JSON.stringify(i.mods), 'OPFS root:', i.root.join(','));
  await sleep(10000);
  log('later:', JSON.stringify(await hdInfo(page)));
  await page.screenshot({ path: `${out}/hd-first-done.png` });
  await ctx.close();
}

/** archive.org on demand, end to end in ONE session: play from the start screen, wait until the island's archive is cached, then walk Starten -> Nieuw spel into the island */
async function session() {
  fs.rmSync(profile, { recursive: true, force: true });
  const { ctx, page } = await open();
  const q = [relay ? `relay=${relay}` : '', args.includes('--nohd') ? 'hd=0' : ''].filter(Boolean).join('&');
  await page.goto(URL_ + (q ? `?${q}` : ''));
  await waitStart(page);
  let i = await hdInfo(page);
  log('start screen: checked', i.checked, '|', i.note);
  if (args.includes('--nohd')) { await page.locator('#le2-hd').uncheck(); await sleep(500); }
  const tClick = Date.now();
  const since = () => ((Date.now() - tClick) / 1000).toFixed(1) + 's';
  await pressPlay(page);
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  log('front end playable', since(), 'after "Spelen"; heap', await heapMB(page), 'MB');
  const before = await sizes(page);
  let ready = null;
  for (let k = 0; k < (args.includes('--nohd') ? 5 : 900); k++) {
    const st = await page.evaluate(() => ({ done: !!window.__le2Hd?.lazy?.isComplete('z02LGI'), err: window.__le2Hd?.state?.phase === 'error' ? window.__le2Hd.state.message : null, badge: document.getElementById('le2-hdbadge')?.textContent ?? null }));
    if (st.err) { log('ERROR', st.err); break; }
    if (st.done) { ready = since(); log('island archive cached after', ready, 'after "Spelen"'); break; }
    if (k % 10 === 0) log('  ', st.badge);
    await sleep(1000);
  }
  log('front end textures: uploads', before.uploads, 'max side', before.maxSide);
  await page.screenshot({ path: `${out}/hd-session-frontend.png` });
  const key = async (k) => { await page.keyboard.press(k); await sleep(170); };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { item: e.item, page: e.page }; });
  const enter = async (idx) => { for (let n = 0; n < 12 && (await menu()).item !== idx; n++) await key('ArrowDown'); await key('Enter'); await sleep(500); };
  await enter(1); await enter(1);
  const tGo = Date.now();
  try { await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI', null, { timeout: 240000 }); } catch (e) {
    log('TIMEOUT waiting for the island:', JSON.stringify(await page.evaluate(() => ({ zone: window.__zone?.info?.archive ?? null, mode: window.__zone?.machine?.mode ?? null, menu: window.__shell?.menu?.engine ? { item: __shell.menu.engine.item, page: __shell.menu.engine.page } : null, fe: window.__fe?.mode ?? null, badge: document.getElementById('le2-hdbadge')?.textContent ?? null, loadbadge: document.getElementById('le2-loadbadge')?.textContent ?? null, title: document.title, heap: performance.memory?.usedJSHeapSize }))));
    await page.screenshot({ path: `${out}/hd-session-timeout.png` });
    throw e;
  }
  log('island zone created', ((Date.now() - tGo) / 1000).toFixed(1), 's after Starten; heap', await heapMB(page), 'MB');
  for (let n = 0; n < 20; n++) { await page.keyboard.press('ArrowLeft'); await sleep(300); if (await page.evaluate(() => window.__zone?.machine?.mode === 2)) break; }   // the island waits for a button in mode 1
  await sleep(3000);
  log('island playing', ((Date.now() - tGo) / 1000).toFixed(1), 's after Starten; mode', await page.evaluate(() => window.__zone?.machine?.mode), 'heap', await heapMB(page), 'MB');
  const after = await sizes(page);
  log('island textures (all uploads of the session): uploads', after.uploads, 'max side', after.maxSide, '> 512:', after.over512, JSON.stringify(after.hist));
  log('lazy state', JSON.stringify(await page.evaluate(() => { const lz = window.__le2Hd?.lazy; const f = window.__le2Mods?.files; return { decided: lz ? [...lz.decided] : null, complete: lz ? [...lz.complete.keys()] : null, modded: !!f, lazyOnFiles: !!f?.lazy, sameLazy: f?.lazy === lz, failed: lz?.failed?.message ?? null }; })));
  log('frames on the island', JSON.stringify(await frames(page, 3000)), 'state', JSON.stringify((await hdInfo(page)).state));
  await page.screenshot({ path: `${out}/hd-session-island.png` });
  await ctx.close();
}

async function island() {
  for (const [name, q] of [['mods=off (original)', '?zone=z02LGI&mods=off'], ['HD pack (stored)', '?zone=z02LGI']]) {
    const { ctx, page } = await open();
    await page.goto(URL_ + q + '&intro=0' + (relay ? `&relay=${relay}` : ''));
    await page.waitForFunction(() => !!window.__zone && window.__zone.machine, null, { timeout: 120000 });
    const tZone = Date.now();
    if (!q.includes('mods=off')) {   // the pack's files go into the archive member by member: wait until they are in
      let last = -1, still = 0;
      for (let n = 0; n < 240 && still < 6; n++) {
        const r = await page.evaluate(async () => { const a = await window.__zone?.sh?.data?.archives.get('z02lgi'); return a ? a.entries.filter((e) => e.data).length : -1; });
        still = r === last ? still + 1 : 0; last = r;
        await sleep(1000);
      }
      log('  replaced members in z02LGI:', last, 'settled after', ((Date.now() - tZone) / 1000).toFixed(0), 's');
    }
    await sleep(6000);
    const s = await sizes(page);
    const applied = await page.evaluate(() => window.__le2Mods?.layer.applied.length ?? 0);
    log('  archive state:', await page.evaluate(async () => { const d = window.__zone?.sh?.data; if (!d) return 'no data'; const a = await d.archives.get('z02lgi'); if (!a) return 'no archive'; const withData = a.entries.filter((e) => e.data); return JSON.stringify({ entries: a.entries.length, replaced: withData.length, sample: withData.slice(0, 3).map((e) => [e.path, e.size, e.baseSize]), overlays: [...d.overlays.keys()] }); }));
    log('  overrides for z02LGI:', await page.evaluate(() => { const f = window.__le2Mods?.files; const lz = f?.lazy; return JSON.stringify({ modded: !!f, lazy: !!lz, decided: lz ? [...lz.decided] : null, n: f ? f.archiveOverrides('z02LGI').length : null, hdPath: (window.__le2Hd?.lazy ? 'hd.lazy' : 'none') }); }));
    log(name, '-> texture uploads', s.uploads, 'max side', s.maxSide, '> 512:', s.over512, 'applied mod files', applied, 'heap', await heapMB(page), 'MB', JSON.stringify(s.hist));
    log('  frames (software GL, so only for comparing the two):', JSON.stringify(await frames(page, 3000)));
    await page.screenshot({ path: `${out}/hd-island-${name.startsWith('mods') ? 'off' : 'hd'}.png` });
    await ctx.close();
  }
}

/** the relay answers the index but fails every data range: a Dutch message, the box is unchecked and stays so, nothing half-written is left (needs a stand-in relay that fails: --relay http://localhost:5612) */
async function fail() {
  fs.rmSync(profile, { recursive: true, force: true });
  const { ctx, page } = await open();
  await page.goto(URL_ + `?relay=${relay}`);
  await waitStart(page);
  let i = await hdInfo(page);
  log('start screen: checked', i.checked, '|', i.note);
  for (let k = 0; k < 60; k++) { await sleep(2000); i = await hdInfo(page); if (i.state?.phase === 'error') break; }
  log('after the failure: state', i.state?.phase, '| checked', i.checked, '| cache', JSON.stringify(i.cache), '| stored', await page.evaluate(() => localStorage.getItem('le2-display')));
  log('message:', i.note);
  await page.screenshot({ path: `${out}/hd-fail.png` });
  await page.reload();
  await waitStart(page);
  await sleep(4000);
  i = await hdInfo(page);
  log('after a reload: checked', i.checked, '| state', i.state?.phase, '|', i.note);
  await ctx.close();
}

async function interrupt() {
  fs.rmSync(profile, { recursive: true, force: true });
  let { ctx, page } = await open();
  await page.goto(URL_);
  await waitStart(page);
  for (let k = 0; k < 200; k++) { await sleep(1500); const i = await hdInfo(page); if (i.state?.phase === 'download' && i.state.done > 0.25 * i.state.total) { log('killing at', Math.round(100 * i.state.done / i.state.total), '%', JSON.stringify(i.root), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB); break; } }
  await ctx.close();   // the tab is gone mid-download (same as a reload)
  ({ ctx, page } = await open());
  await page.goto(URL_);
  await waitStart(page);
  await sleep(3000);
  let i = await hdInfo(page);
  log('after reopen: root', JSON.stringify(i.root), 'cache', JSON.stringify(i.cache), 'mods', JSON.stringify(i.mods), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB, 'MB | state', JSON.stringify(i.state), '| checked', i.checked);
  // the pack is not installed (no mod.json anywhere) and the install restarted from scratch
  for (let k = 0; k < 8; k++) { await sleep(2000); i = await hdInfo(page); log('  ', i.state?.phase, i.state ? Math.round(100 * i.state.done / Math.max(1, i.state.total)) + '%' : '', 'mods', JSON.stringify(i.mods), 'cache', JSON.stringify(i.cache)); }
  await ctx.close();
}

async function uncheck() {
  let { ctx, page } = await open();
  await page.goto(URL_);
  await waitStart(page);
  let i = await hdInfo(page);
  log('installed profile: checked', i.checked, 'cache', JSON.stringify(i.cache), 'mods', JSON.stringify(i.mods), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB, 'MB |', i.note);
  await page.locator('#le2-hd').uncheck();   // the dialog handler accepts = remove
  await sleep(6000);
  i = await hdInfo(page);
  log('after uncheck + remove: checked', i.checked, 'mods', JSON.stringify(i.mods), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB, 'MB |', i.note, '| stored', await page.evaluate(() => localStorage.getItem('le2-display')));
  await page.locator('#le2-hd').check();
  for (let k = 0; k < 100; k++) { await sleep(1500); i = await hdInfo(page); if (i.state?.phase === 'download' && i.state.done > 0.08 * i.state.total) break; }
  log('re-checked, downloading:', JSON.stringify(i.state), 'root', JSON.stringify(i.root), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB);
  await page.locator('#le2-hd').uncheck();
  await sleep(5000);
  i = await hdInfo(page);
  log('unchecked mid-download: state', i.state?.phase, 'root', JSON.stringify(i.root), 'cache', JSON.stringify(i.cache), 'mods', JSON.stringify(i.mods), 'cache', JSON.stringify(i.cache), 'usage', i.usageMB, 'MB |', i.note);
  await ctx.close();
}

await { lowend, first, lazy: first, session, fail, island, interrupt, uncheck }[scenario]();
log('done');
