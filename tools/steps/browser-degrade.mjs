// Degradation: a missing browser feature must give the Dutch notice of src/compat.ts (or a working fallback), never a broken page. The feature is removed by an init script, then the page is reloaded.
//   BC_BREAK=webgl2|idb|inflate|opfs|worker  node tools/browse.mjs "http://localhost:5497/?mute=1" tools/steps/browser-degrade.mjs --browser webkit --out /tmp/bc/w
//   (webgl2: `Spelen` is disabled; ?zone=... shows the Dutch error; idb: saves stay in memory; inflate: no DecompressionStream; opfs: navigator.storage.getDirectory missing; worker: no Worker AND no createWritable)
export default async ({ page, shot, wait, log, evaluate }) => {
  const what = process.env.BC_BREAK ?? 'webgl2';
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  await page.waitForLoadState('load'); await wait(2500);
  await page.addInitScript((w) => {
    if (w === 'webgl2') { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === 'webgl2' || t === 'webgl' ? null : g.call(this, t, ...a); }; }
    if (w === 'idb') Object.defineProperty(window, 'indexedDB', { get: () => undefined });
    if (w === 'inflate') { delete window.DecompressionStream; delete window.CompressionStream; }
    if (w === 'opfs') { try { Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined }); } catch { /* */ } }
    if (w === 'worker') { delete FileSystemFileHandle.prototype.createWritable; window.Worker = undefined; }
  }, what);
  await page.reload({ waitUntil: 'load' });
  const url = new URL(page.url());
  if (url.searchParams.has('zone') || url.searchParams.has('start')) {
    await wait(6000);
    const shown = await evaluate(() => [...document.querySelectorAll('.bdb-error')].map((e) => e.textContent));
    log('error banners:', JSON.stringify(shown));
    expect('a Dutch error banner is shown', shown.length > 0 && /WebGL 2/.test(shown.join(' ')));
    await shot(`degrade-${what}-direct`);
  } else {
    await page.waitForSelector('#le2-mode', { timeout: 30000 });
    await wait(500);
    const notice = await evaluate(() => document.getElementById('le2-compat')?.innerText ?? null);
    log('compat notice:', JSON.stringify(notice));
    const playDisabled = await evaluate(() => document.querySelector('.books button').disabled);
    if (what === 'webgl2') { expect('notice mentions WebGL 2', /WebGL 2/.test(notice ?? '')); expect('Spelen is disabled', playDisabled === true); }
    else if (what === 'idb') expect('notice about IndexedDB', /IndexedDB/.test(notice ?? ''));
    else if (what === 'inflate') expect('notice about DecompressionStream', /DecompressionStream/.test(notice ?? ''));
    else if (what === 'opfs') expect('notice about file storage', /bewaren/.test(notice ?? ''));
    else if (what === 'worker') expect('notice about writing files', /schrijven/.test(notice ?? ''));
    if (what !== 'webgl2') {   // the game still starts
      expect('Spelen is enabled', playDisabled === false);
      await page.getByRole('button', { name: 'Spelen' }).click();
      await page.waitForFunction(() => !!window.__shell, null, { timeout: 120000 });
      await wait(3000);
      expect('the game runs (shell up, canvas drawn)', await evaluate(() => !!document.querySelector('canvas')));
    }
    await shot(`degrade-${what}`);
  }
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all degrade checks passed');
  if (fail.length) process.exitCode = 1;
};
