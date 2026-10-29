// Particle proof in two mini-games (WP-PART), headless + muted:
//   ZONE=z17WAS | z05WAB  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5499/?zone=z17WAS&mute=1" tools/steps/particles-zones.mjs --size 1024x768 --out /tmp/par-shots
export default async ({ page, shot, wait, key, evaluate, log }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  await page.goto(page.url(), { waitUntil: 'load' });
  const zone = process.env.ZONE ?? 'z17WAS';
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1 && window.__particles, null, { timeout: 600000 });
  const mode = () => evaluate(() => window.__zone.machine.mode);
  for (let i = 0; i < 6 && (await mode()) !== 2; i++) { await key('Enter'); await wait(700); }
  await wait(1500);
  const st = () => evaluate(() => { const p = window.__particles; return { ticks: p.ticks, stats: p.stats, live: p.engine.drawList.length }; });
  log('start', JSON.stringify(await st()));
  await shot(`par-${zone}-1`);
  if (zone === 'z05WAB') {
    // whack every hole in turn; screenshot while the bolts burst out (the gate stays on until the next tick without a bot up, so poll quickly)
    let shots = 0;
    for (let n = 0; n < 80 && shots < 3; n++) {
      for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']) {
        await key(k);
        for (let i = 0; i < 5; i++) {
          await wait(60);
          const s = await st();
          if (s.stats.visible > 3) { await shot(`par-${zone}-hit${shots}`); log('hit', JSON.stringify(s)); shots++; await wait(300); break; }
        }
      }
    }
  } else {
    await wait(2000); await shot(`par-${zone}-2`);
  }
  log('end', JSON.stringify(await st()));
};
