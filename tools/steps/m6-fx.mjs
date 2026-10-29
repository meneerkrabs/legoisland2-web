// Particle look at a mini-game zone (WP-PART-WIRE), headless + muted: starts the zone, leaves the intro / help with Enter, then screenshots every FX_WAIT ms (default 1500) FX_SHOTS times (default 3) and
// logs the particle stats; FX_KEYS="ArrowUp:300,ArrowRight:300" taps keys (>= 70 ms hold) between the shots.
//   FX_SHOTS=3 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z08BKD&mute=1" tools/steps/m6-fx.mjs --size 1024x768 --out /tmp/m6-fx-z08BKD
export default async ({ page, shot, wait, key, log, evaluate }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1 && window.__particles, null, { timeout: 600000 });
  for (let i = 0; i < 10 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await key('Enter'); await wait(700); }
  const st = () => evaluate(() => { const p = window.__particles; return { ticks: p.ticks, visible: p.stats.visible, live: p.engine.drawList.length }; });
  const n = +(process.env.FX_SHOTS ?? 3), dt = +(process.env.FX_WAIT ?? 1500);
  const keys = (process.env.FX_KEYS ?? '').split(',').filter(Boolean).map((s) => s.split(':'));
  for (let i = 0; i < n; i++) {
    for (const [k, ms] of keys) { await page.keyboard.down(k); await wait(Math.max(70, +ms)); await page.keyboard.up(k); }
    await wait(dt);
    log('stats', i, JSON.stringify(await st()));
    await shot(`fx-${i}`);
  }
};
