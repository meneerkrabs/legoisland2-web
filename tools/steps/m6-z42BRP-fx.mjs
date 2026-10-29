// z42BRP particles (WP-PART-WIRE), headless + muted: straight to the roof (var 0xfa = 2, a test shortcut), then Brickster's hit count 1 (smoke2) and 2 (flame1) set through the page;
// screenshots and the particle stats of each. sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z42BRP&mute=1" tools/steps/m6-z42BRP-fx.mjs --size 1024x768 --out /tmp/z42fx
export default async ({ page, shot, wait, key, log, evaluate }) => {
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z42BRP' && window.__zone.machine.mode === 1 && window.__particles, null, { timeout: 600000 });
  for (let i = 0; i < 10 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await key('Enter'); await wait(700); }
  await evaluate(() => window.__zone.world.vars.set(0xfa, 2));
  for (let i = 0; i < 10 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await key('Enter'); await wait(900); }
  await wait(1500);
  const st = () => evaluate(async () => { const n = await import('/src/zones/z42BRP/nodes.ts'); const S = n.stateOf(window.__zone.world); const p = window.__particles; return { hits: S.hits, seen: S.brickster?.seen, m: [...S.bossFxM.slice(12, 15)].map((v) => +v.toFixed(2)), visible: p.stats.visible, live: p.engine.drawList.length }; });
  for (const h of [1, 2]) {
    await evaluate(async (h) => { const n = await import('/src/zones/z42BRP/nodes.ts'); n.stateOf(window.__zone.world).hits = h; }, h);
    await wait(1500);
    log('hits', h, JSON.stringify(await st()));
    await shot(`fx-hit${h}`);
  }
};
