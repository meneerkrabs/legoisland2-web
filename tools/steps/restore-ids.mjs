// Restored content: run an existing zone bot (STEP=tools/steps/<file>.mjs) with the restored option on and log which sound ids reach the audio host (`play` / `playAt`, wrapped before the engine check: works with mute=1).
//   STEP=tools/steps/m6-z10RGB.mjs IDS=406 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5763/?zone=z10RGB&mute=1&restored=1" tools/steps/restore-ids.mjs --size 800x600 --out /tmp/restore-ids
// Prints `IDS {"406": n, ...}` for the wanted ids (IDS=comma list, decimal or 0x..).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export default async (h) => {
  const { page, log } = h;
  await page.waitForFunction(() => window.__shell && window.__shell.audio, null, { timeout: 300000 });
  await page.evaluate(() => {
    const a = window.__shell.audio; window.__ids = [];
    for (const k of ['play', 'playAt']) { const o = a[k].bind(a); a[k] = (id, ...r) => { window.__ids.push(id); return o(id, ...r); }; }
    // the popups seen (the zone's own message slots through debug().popups, the restored HUD popup through src/restore/popup.ts)
    window.__pops = new Set();
    setInterval(async () => {
      try { const z = window.__zone; const dbg = z?.game?.debug?.(); for (const p of dbg?.popups ?? []) window.__pops.add(String(p)); if (dbg?.sounds) window.__snd = { ...dbg.sounds }; const m = await import('/src/restore/popup.ts'); const t = z?.hud ? m.popupText(z.hud) : null; if (t) window.__pops.add(t); } catch { /* not yet */ }
    }, 150);
  });
  const want = (process.env.IDS ?? '').split(',').filter(Boolean).map(Number);
  const step = (await import(pathToFileURL(path.resolve(process.env.STEP)).href)).default;
  // SHOT_ON=<popup text or id>: a screenshot (once) at the moment that popup is shown, concurrently with the step
  let stopShots = false;
  const watcher = process.env.SHOT_ON ? (async () => {
    let done = false;
    while (!stopShots && !done) {
      const now = await page.evaluate(async (w) => { try { const z = window.__zone, m = await import('/src/restore/popup.ts'); return (z?.game?.debug?.()?.popups ?? []).map(String).includes(w) || m.popupText(z.hud) === w; } catch { return false; } }, process.env.SHOT_ON).catch(() => false);
      if (now) { await h.shot(`popup-${process.env.SHOT_ON.replace(/\W+/g, '_')}`); done = true; }
      await h.wait(60);
    }
  })() : null;
  try { await step(h); } finally {
    stopShots = true; await watcher?.catch(() => {});
    const ids = await page.evaluate(() => window.__ids).catch(() => []);
    const n = {}; for (const w of want) n[w] = ids.filter((x) => x === w).length;
    log('IDS', JSON.stringify(n), 'total calls', ids.length);
    log('SOUNDS', JSON.stringify(await page.evaluate(() => window.__snd ?? null).catch(() => null)));
    log('POPUPS', JSON.stringify(await page.evaluate(() => [...window.__pops]).catch(() => [])));
  }
};
