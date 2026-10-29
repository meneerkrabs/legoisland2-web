// z39ASB exhaust emitters: headless proof (WP-PART-WIRE): the live particle list and a screenshot of the fly-in.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5514/?zone=z39ASB&mute=1" tools/steps/m8-asb-fx.mjs --size 1024x768 --out /tmp/d-asbfx
export default async ({ page, shot, wait, key, evaluate, log }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1 && window.__particles, null, { timeout: 600000 });
  for (let i = 0; i < 10 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await page.keyboard.down('Enter'); await wait(120); await page.keyboard.up('Enter'); await wait(900); }
  await wait(600);
  const st = () => evaluate(() => { const p = window.__particles; const l = p.engine.drawList; return { ticks: p.ticks, stats: p.stats, live: l.length, sample: l.slice(0, 3).map((q) => ({ size: q.size ?? q.fSize, x: q.x ?? q.pos?.[0] })), state: window.__zone.game.debug().state, z: window.__zone.game.debug().z }; });
  log('flyin', JSON.stringify(await st()));
  await shot('asb-fx-flyin');
  await wait(2500);
  log('flight', JSON.stringify(await st()));
  await shot('asb-fx-flight');
};
