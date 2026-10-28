// Logs every files.read() (needs ?trace=1) after SECS seconds: which files a start needs, in order, and how long each waited.
//   SECS=60 node tools/browse.mjs "http://localhost:5498/?play=1&mute=1&trace=1&source=archive&zone=z02LGI" tools/steps/trace.mjs
export default async ({ page, wait, log, key, evaluate }) => {
  const secs = Number(process.env.SECS ?? 60);
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < secs) {
    if (await page.evaluate(() => !!document.querySelector('.le2-movie'))) await key('Space');
    await wait(300);
  }
  const tr = await evaluate(() => window.__le2Trace ?? []);
  log('title: ' + (await evaluate(() => document.title)) + ' shell: ' + (await evaluate(() => !!window.__shell)));
  log(`${tr.length} reads; zone up: ${await evaluate(() => !!(window.__zone && window.__zone.sh.live))}; fe: ${await evaluate(() => window.__fe?.mode)}`);
  const pend = await evaluate(() => [...(window.__le2Trace?.pending ?? [])]);
  log(`pending reads: ${pend.length}: ${pend.slice(0, 12).map(([p, t]) => p + '@' + t).join(', ')}`);
  const slow = tr.filter((r) => r.ms > 300);
  log(`slow reads (>300 ms): ${slow.length} of ${tr.length}, total wait ${slow.reduce((a, r) => a + r.ms, 0)} ms`);
  const groups = {};
  for (const r of tr) { const k = r.path.replace(/[^/]*$/, '').replace(/\/[^/]+\/?$/, '/') || '(root)'; const g = (groups[k] ??= { n: 0, bytes: 0, ms: 0 }); g.n++; g.bytes += r.size; g.ms += r.ms; }
  log(JSON.stringify(groups));
  for (const r of tr.slice(0, 60)) log(`${String(r.at).padStart(6)} +${String(r.ms).padStart(5)} ms ${String(r.size).padStart(9)} ${r.waited ? 'W' : ' '} ${r.path}`);
};
