// z10RGB particles (WP-PART-WIRE), headless + muted: the ten ball emitters (impact01) and the four dust emitters (cannonhit.par, gate var 0xfd):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB-fx.mjs --size 1024x768 --out /tmp/m6-z10RGB-fx
// Cedric's cannons shoot at the bridge from the start: wait for balls to splash, screenshot while impact01 particles are alive; then set var 0xfd (a hit in cannon 0 / 2) and count the dust particles.
export default async ({ page, shot, wait, key, log, evaluate }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1 && window.__particles, null, { timeout: 600000 });
  for (let i = 0; i < 10 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await key('Enter'); await wait(700); }
  const st = () => evaluate(() => {
    const p = window.__particles, g = __zone.game.debug(), s = __zone.game.assist.state;
    return { ticks: p.ticks, visible: p.stats.visible, live: p.engine.drawList.length, balls: s.balls.map((b) => b.state).join(''), handles: s.balls.map((b) => b.fxHandle).join(','), phase: g.phase };
  });
  log('start', JSON.stringify(await st()));
  let shots = 0;
  for (let n = 0; n < 400 && shots < 3; n++) {
    await wait(120);
    const s = await st();
    if (/3/.test(s.balls) && s.visible > 0) { await shot(`fx-impact-${shots}`); log('impact', JSON.stringify(s)); shots++; await wait(500); }
  }
  // the dust emitters: gate var 0xfd bit k; the emitters are the sources after the ten ball emitters
  const dust = await evaluate(async () => {
    const z = __zone, p = window.__particles; const out = [];
    z.world.vars.set(0xfd, 0xf);
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 50));
    for (let h = 10; h < 14; h++) { const src = p.engine.sources[h]; out.push([src.active, src.gateVar, src.gateMask, src.gateValue, src.tmpl.count, Object.keys(src).filter((k) => /part|pool|live|num/i.test(k)).map((k) => k + '=' + (src[k]?.length ?? src[k])).join(' ')]); }
    z.world.vars.set(0xfd, 0);
    return out;
  });
  log('dust emitters (gate bits set while running, started with the var clear: the script windows are over)', JSON.stringify(dust));
  // a control: the same effect started ON on cannon 0 (what a start with the var already set would do), counted in the draw list
  const ctl = await evaluate(async () => {
    const z = __zone, p = window.__particles;
    const h = p.start('dust', z.world.records[135].m, [0, 0, 4], [-0.3295, 0, 0], [2, 1, 1]);
    let max = 0;
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 50)); max = Math.max(max, p.engine.drawList.length); }
    return { h, max, ctlCount: p.engine.sources[h].tmpl.count, ctlLive: p.engine.sources[h].poolSize };
  });
  log('control: dust started ON', JSON.stringify(ctl));
  log('end', JSON.stringify(await st()));
};
