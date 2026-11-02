// OPFS write paths (src/opfsio.ts, src/compat.ts) in the real engine; needs a persistent profile in webkit (the throw-away context has no OPFS), the dev server (imports /src/*.ts):
//   node tools/browse.mjs "http://localhost:5497/?viewer=0&mute=1" tools/steps/browser-opfs.mjs --browser webkit --profile /tmp/bc/prof-w
//   BC_NOWRITABLE=1 ...   removes FileSystemFileHandle.createWritable first (= Safari before 26: the helper-worker path with a sync access handle)
export default async ({ page, log }) => {
  const noWritable = process.env.BC_NOWRITABLE === '1';
  if (noWritable) {
    await page.addInitScript(() => { try { delete FileSystemFileHandle.prototype.createWritable; } catch { /* */ } });
    await page.reload();
  }
  const r = await page.evaluate(async () => {
    const o = { createWritable: typeof FileSystemFileHandle.prototype.createWritable };
    const io = await import('/src/opfsio.ts');
    const compat = await import('/src/compat.ts');
    o.canWriteFiles = io.canWriteFiles();
    o.issues = (await compat.checkCompat()).map((i) => i.id);
    o.ipad = compat.isIPadOs(); o.mobile = compat.looksMobile();
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('bc-test', { create: true });
    const sum = (b) => { let h = 2166136261; for (let i = 0; i < b.length; i += 97) h = Math.imul(h ^ b[i], 16777619) >>> 0; return h; };
    try {
      const fh = await dir.getFileHandle('big.bin', { create: true });
      const w = await io.openWritable(fh);
      const chunk = new Uint8Array(1 << 20); let h = 0, total = 0;
      for (let i = 0; i < 24; i++) { for (let j = 0; j < chunk.length; j += 7) chunk[j] = (i * 31 + j) & 255; await w.write(chunk); total += chunk.length; }
      await w.close();
      const f = await fh.getFile();
      o.big = { size: f.size, expected: total };
      // second round: the file is overwritten, not appended
      await io.writeWhole(fh, JSON.stringify({ a: 1, b: 'één' }));
      o.json = await (await fh.getFile()).text();
      await io.writeWhole(fh, new Uint8Array([9, 8, 7]));
      o.bytes = Array.from(new Uint8Array(await (await fh.getFile()).arrayBuffer()));
      const w2 = await io.openWritable(fh); await w2.write(new Uint8Array(100)); await w2.abort();
      o.afterAbort = (await fh.getFile()).size;   // createWritable: 3 (nothing committed); sync fallback: 0 (emptied)
      // a Blob-sized read through getFile().stream()
      await io.writeWhole(fh, new Uint8Array(5000).fill(7));
      let n = 0; const rd = (await fh.getFile()).stream().getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; }
      o.streamed = n;
    } catch (e) { o.error = String(e && e.stack || e); }
    await (await navigator.storage.getDirectory()).removeEntry('bc-test', { recursive: true }).catch(() => {});
    return o;
  });
  log(JSON.stringify(r, null, 1));
  const ok = r.big?.size === r.big?.expected && r.json === '{"a":1,"b":"één"}' && r.bytes?.join() === '9,8,7' && r.streamed === 5000 && !r.error;
  log(ok ? 'ok   opfs write paths' : 'FAIL opfs write paths');
  if (!ok) process.exitCode = 1;
};
// NOTE for all steps that need a clean OPFS in webkit: Playwright's webkit keeps OPFS in ~/Library/WebKit/org.webkit.Playwright/WebsiteData (shared by every --profile dir), only IndexedDB / localStorage follow --profile.
