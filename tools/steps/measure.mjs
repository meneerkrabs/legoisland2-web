// Measures bytes received (CDP, encoded) and time until the front end is up and until the island zone runs, from a fresh profile.
//   MEASURE=frontend|island node tools/browse.mjs "http://localhost:5498/?play=1&mute=1&source=archive[&proxy=off|<url>]" tools/steps/measure.mjs
export default async ({ page, wait, log, key, evaluate }) => {
  const what = process.env.MEASURE ?? 'frontend';
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0;
  const per = {};
  cdp.on('Network.dataReceived', (e) => { bytes += e.encodedDataLength || e.dataLength; });
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => { const u = urls.get(e.requestId) ?? '?'; const h = new URL(u, 'http://x').host; per[h] = (per[h] ?? 0) + e.encodedDataLength; });
  const t0 = Date.now();
  const mark = (name) => log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(1)} MB received`);
  const cond = what === 'island'
    ? () => window.__zone && window.__zone.world.tickCount > 5 && window.__zone.sh.live
    : () => window.__fe && window.__fe.mode === 2;
  const waitUp = async () => {
    for (let i = 0; i < 3000; i++) {
      if (await page.evaluate(cond)) break;
      if (await page.evaluate(() => !!document.querySelector('.le2-movie'))) await key('Space');
      await wait(200);
    }
  };
  await waitUp();
  mark(what + ' up');
  if (process.env.TWICE) { // second visit in the same profile: what is still fetched?
    if (process.env.WAITFULL) await page.waitForFunction(() => { const l = window.__shell?.files?.loading; return !l || l.complete; }, null, { timeout: 300000 });
    await wait(3000);
    mark('before reload (download complete)');
    log('OPFS: ' + JSON.stringify(await evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-archive'); const o = {}; for await (const [n, h] of d.entries()) o[n] = (await h.getFile()).size; return o; }).catch(() => 'none')));
    bytes = 0;
    const t1 = Date.now();
    await page.reload();
    await waitUp();
    log(`second visit ${what} up: ${((Date.now() - t1) / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(1)} MB received`);
  }
  log('route: ' + (await evaluate(() => window.__shell?.files?.route)));
  await wait(3000);
  mark('+3 s');
  log('bytes by host: ' + JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, +(v / 1e6).toFixed(1)]))));
  log('loading: ' + JSON.stringify(await evaluate(() => { const l = window.__shell?.files?.loading; return l && { done: l.done, total: l.total, fraction: l.fraction }; })));
};
