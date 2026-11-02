// Save / load round trip + F10 photo download through the game's own paths, per engine (needs a persistent --profile: IndexedDB must survive the reload; run the two phases in order):
//   P=/tmp/bc/prof-w; rm -rf $P
//   BC_SAVE=save node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&mute=1" tools/steps/browser-save.mjs --browser webkit --profile $P --out /tmp/bc/w
//   BC_SAVE=load node tools/browse.mjs "http://localhost:5497/?save=3&mute=1"       tools/steps/browser-save.mjs --browser webkit --profile $P --out /tmp/bc/w
// (state is handed over in $BC_STATE, default /tmp/bc/save-state-<engine>.json)
import fs from 'node:fs';
import { island } from './lib-island.mjs';
export default async ({ page, shot, wait, log, key, evaluate }) => {
  const phase = process.env.BC_SAVE ?? 'save';
  const eng = await evaluate(() => (/Firefox/.test(navigator.userAgent) ? 'firefox' : /Chrome/.test(navigator.userAgent) ? 'chromium' : 'webkit'));
  const file = process.env.BC_STATE ?? `/tmp/bc/save-state-${eng}.json`;
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const summary = () => evaluate(() => {
    const z = window.__zone, w = z.world, v = w.vars.a, p = w.focus, r = (x) => +x.toFixed(3);
    return { zone: z.info.archive, node: v[0x58], pepper: [r(p.x), r(p.y), r(p.z), r(p.ry)], vars: Array.from(v.slice(15, 319)).reduce((h, x, i) => (Math.imul(h ^ (x | 0) ^ i, 16777619) >>> 0), 2166136261), records: w.records.length };
  });
  await page.waitForFunction(() => window.__zone && window.__zone.machine && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2) && window.__shell, null, { timeout: 240000 });
  if (phase === 'save') {
    const S = island({ page, wait, log, shot });
    await wait(2000); await S.skipCutscenes();
    await page.keyboard.down('ArrowUp'); await wait(1200); await page.keyboard.up('ArrowUp'); await wait(300);
    const before = await summary();
    const ok = await evaluate(() => window.__shell.saveSlot(3));
    expect('saveSlot(3) wrote the slot', ok === true);
    await wait(800);
    const idb = await evaluate(() => new Promise((res) => { const q = indexedDB.open('le2-saves'); q.onsuccess = () => { const db = q.result; const r = db.transaction('blobs').objectStore('blobs').getAllKeys(); r.onsuccess = () => res(r.result.map(String)); r.onerror = () => res('err'); }; q.onerror = () => res('open err'); }));
    expect('slot is in IndexedDB', Array.isArray(idb) && idb.includes('Save03.lgo'), JSON.stringify(idb));
    before.slotHash = await evaluate(() => { let h = 2166136261; for (const x of window.__shell.slots[3]) h = Math.imul(h ^ x, 16777619) >>> 0; return h; });
    fs.writeFileSync(file, JSON.stringify(before));
    log('saved state', JSON.stringify(before));
    await shot(`${eng}-save-before`);
    // F10: the photo is offered as a download (src/shell/screenshot.ts)
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await key('F10');
    const d = await dl;
    if (d) { const p = `/tmp/bc/${eng}-photo.bmp`; await d.saveAs(p); const b = fs.readFileSync(p); expect('F10 photo downloaded as BMP', d.suggestedFilename().startsWith('Lego') && b[0] === 0x42 && b[1] === 0x4d && b.length > 1e6, `${d.suggestedFilename()} ${b.length} bytes`); }
    else expect('F10 photo downloaded as BMP', false, 'no download event');
  } else {
    const want = JSON.parse(fs.readFileSync(file, 'utf8'));
    await wait(2500);
    const got = await summary();
    log('loaded state', JSON.stringify(got));
    // (a loaded game keeps running, so Pepper / variables are compared as the slot bytes: slot 3 as read back from IndexedDB, then a slot 4 written by the shell right after the load)
    const hash = await evaluate(() => { let h = 2166136261; for (const x of window.__shell.slots[3] ?? []) h = Math.imul(h ^ x, 16777619) >>> 0; return h; });
    expect('slot 3 survived the reload byte for byte (IndexedDB)', hash === want.slotHash, `${want.slotHash} / ${hash}`);
    expect('zone / node restored', got.zone === want.zone && got.node === want.node);
    expect('Pepper is where the save put him (+- running time)', Math.hypot(got.pepper[0] - want.pepper[0], got.pepper[2] - want.pepper[2]) < 8, JSON.stringify([want.pepper, got.pepper]));
    await evaluate(() => window.__shell.saveSlot(4));
    const d = await evaluate(() => {
      const sh = window.__shell, x = sh.slots[3], y = sh.slots[4], dv = (u) => new DataView(u.buffer, u.byteOffset, u.byteLength);
      const lx = dv(x).getUint32(0, true), ly = dv(y).getUint32(0, true); let n = 0;
      for (let i = 0; i < Math.min(lx, ly) - 8; i++) if ((i < 0xc || i >= 0x10) && x[i] !== y[i]) n++;
      return { lengths: [lx, ly], differingBytes: n };
    });
    log('slot 3 vs slot 4 (written after the load)', JSON.stringify(d));
    // (informational: the numbers are the same in all three engines, only the running time of the game differs; tools/steps/m8-save.mjs is the strict check of the save format)
    await shot(`${eng}-save-after`);
  }
  if (fail.length) { log('FAILED:', fail.join('; ')); process.exitCode = 1; }
};
