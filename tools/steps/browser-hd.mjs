// HD textures through the real code path (relay stand-in, a persistent profile): visit 1 fetches the island's archive into OPFS in the worker (hdfill.ts), visit 2 reads it back (hdremote.ts) and the island
// loads the enlarged textures. Needs tools/browser-hd-standin.mjs running (port 5612); the real pack cannot be fetched from localhost (the relay allows only the live site's origin: the same CORS error in chromium).
//   node tools/browser-hd-standin.mjs 5612 &
//   P=/tmp/bc/prof-hd-w; rm -rf $P
//   BC_HD=1 node tools/browse.mjs "http://localhost:5497/?intro=0&hd=1&relay=http://localhost:5612&mute=1" tools/steps/browser-hd.mjs --browser webkit --profile $P --out /tmp/bc/w
//   BC_HD=2 node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&hd=1&relay=http://localhost:5612&mute=1" tools/steps/browser-hd.mjs --browser webkit --profile $P --out /tmp/bc/w
// (BC_NOWRITABLE=1 additionally removes createWritable: Safari before 26; the worker's sync access handle writes the files either way)
import { island } from './lib-island.mjs';
export default async ({ page, wait, log, evaluate, shot }) => {
  const phase = process.env.BC_HD ?? '1';
  const eng = await evaluate(() => (/Firefox/.test(navigator.userAgent) ? 'firefox' : /Chrome/.test(navigator.userAgent) ? 'chromium' : 'webkit'));
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  // texture upload sizes of this page load (the init script must run before the game: reload once)
  await page.addInitScript((noWritable) => {
    window.__texSizes = {};
    const o = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function (...a) { if (a.length >= 6 && typeof a[3] === 'number') { const w = a[3]; window.__texSizes[w] = (window.__texSizes[w] ?? 0) + 1; } return o.apply(this, a); };
    if (noWritable) { try { delete FileSystemFileHandle.prototype.createWritable; } catch { /* */ } }
  }, process.env.BC_NOWRITABLE === '1');
  await page.waitForLoadState('load'); await wait(2500);   // (a reload while the first load is still deciding the game source sends it to archive.org)
  if (phase === '1') {   // (webkit's persistent context keeps OPFS in a folder shared by all profiles: start from an empty OPFS)
    await evaluate(async () => { const r = await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => {}); });
  }
  await page.reload();
  const info = () => evaluate(async () => {
    const out = { cache: [], index: null };
    try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-hd'); out.index = false;
      for await (const [n, h] of d.entries()) { if (n === 'index.json') { out.index = true; continue; } if (h.kind !== 'directory') continue; let done = false, files = []; try { await h.getFileHandle('done.json'); done = true; } catch { /* */ } for await (const [fn, fh] of h.entries()) { if (fh.kind === 'file') files.push(fn + ':' + (await fh.getFile()).size); } out.cache.push({ n, done, files: files.slice(0, 4) }); } } catch (e) { out.err = String(e); }
    return out;
  });
  if (phase === '1') {   // the background fetch starts from the start screen's option (the page url has no zone here: the front end plays meanwhile)
    await page.waitForSelector('#le2-hd', { timeout: 60000 });
    log('HD option on the start screen: checked =', await evaluate(() => document.getElementById('le2-hd').checked), '|', await evaluate(() => document.getElementById('le2-hd-note')?.textContent));
    await page.getByRole('button', { name: 'Spelen' }).click();
    await page.waitForFunction(() => !!window.__shell, null, { timeout: 120000 });
    let i;
    for (let k = 0; k < 150; k++) { await wait(1000); i = await info(); if (i.cache.some((c) => c.n === 'z02LGI' && c.done)) break; }
    log('OPFS le2-hd:', JSON.stringify(i));
    expect('the index of the remote zip is stored', i.index === true);
    expect('archive z02LGI fetched into OPFS with done.json', i.cache.some((c) => c.n === 'z02LGI' && c.done && c.files.length > 0));
    log('texture sizes of visit 1 (original textures: the fetch happened during the visit):', JSON.stringify(await evaluate(() => window.__texSizes)));
  } else {
    await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__zone.machine.mode >= 1, null, { timeout: 240000 });
    await wait(4000);
    const sizes = await evaluate(() => window.__texSizes);
    log('texture sizes of visit 2:', JSON.stringify(sizes));
    const big = Object.entries(sizes).filter(([w]) => +w >= 512).reduce((n, [, c]) => n + c, 0);
    expect('visit 2: enlarged textures (width >= 512, 2 without HD) were uploaded from the OPFS cache', big >= 5, `${big} uploads`);
    const S = island({ page, wait, log, shot }); await S.skipCutscenes(); await wait(600);
    await page.keyboard.down('ArrowUp'); await wait(1200); await page.keyboard.up('ArrowUp'); await wait(500);
    await shot(`${eng}-hd-island`);
  }
  if (fail.length) { log('FAILED:', fail.join('; ')); process.exitCode = 1; }
};
