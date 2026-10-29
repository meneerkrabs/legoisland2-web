// M5 audit, z17WAS Whack-A-Snake, real key input (headless, muted): what the oracle test found against the original, in the browser:
//  * intro / help leave on any pressed button (arrow keys),
//  * the spawn pause starts at 30 ticks and SHRINKS with the clock (the first snake comes at tick 30, not 15),
//  * the end banner leaves on a PRESSED button only (a held key does not skip it: this loop tests `DAT_00983840`),
//  * a short bot-played game (clock 12 s), banner, result menu, Continue -> the story.
//   node tools/browse.mjs "http://localhost:5513/?zone=z17WAS&mute=1" tools/steps/m5-z17WAS.mjs --size 1024x768 --out /tmp/m5a/z17WAS-m5
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode ?? -1);
  const dbg = () => page.evaluate(() => window.__zone.game.debug());
  const ready = (m, t = 20000) => page.waitForFunction((md) => window.__zone && window.__zone.info.archive === 'z17WAS' && window.__zone.machine.mode === md, m, { timeout: t });
  const BTN = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];     // basket k = 0..3
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},send(){}}}export function updateStyle(){}export function removeStyle(){}export function injectQuery(u){return u}' }));
  await page.goto(page.url(), { waitUntil: 'load' });
  await ready(1);
  await wait(500); await shot('1-intro');
  await key('ArrowDown'); await ready(9, 4000);
  expect('ArrowDown leaves the intro (1 -> 9)', (await mode()) === 9);
  await wait(300); await shot('2-help');
  await key('ArrowLeft'); await ready(2, 4000);
  expect('ArrowLeft leaves the help (9 -> 2)', (await mode()) === 2);
  // record the elapsed count of the very tick the first snake appears (a wrapper of world.tick: no polling latency)
  await page.evaluate(() => { const w = window.__zone.world, o = w.tick.bind(w); window.__first = -1; w.tick = () => { o(); const g = window.__zone.game.debug(); if (window.__first < 0 && g.state.some((x) => x !== 0)) window.__first = g.elapsed; }; });

  // ---- the first snake comes when the pause of 30 ticks has passed
  const node = () => page.evaluate(() => { const g = window.__zone.game.debug(); return { elapsed: g.elapsed, state: g.state.slice() }; });
  await page.waitForFunction(() => window.__zone.game.debug().elapsed >= 20, null, { polling: 4, timeout: 10000 });
  let s = await node();
  expect('no snake before tick 30 (elapsed ' + s.elapsed + ')', s.state.every((x) => x === 0) || s.elapsed >= 30);
  await page.waitForFunction(() => window.__zone.game.debug().state.some((x) => x !== 0), null, { polling: 4, timeout: 10000 });
  s = await node();
  log('first snake at elapsed', s.elapsed);
  const first = await page.evaluate(() => window.__first);
  expect('the first snake appears exactly at tick 30 (oracle: pause 30, lastRise -1, elapsed 30 > 29), seen at ' + first, first === 30, JSON.stringify(s));
  await shot('3-first-snake');

  // ---- a short game: the clock is set to 12 s, the bot whacks every snake that is up with real key presses
  await page.evaluate(() => { window.__zone.world.records[22].ctrl.nodes.find((n) => n.kind === 'zonewas').timeLeft = 360; });
  const t0 = Date.now();
  let holding = false;
  while (Date.now() - t0 < 60000) {
    const d = await dbg();
    if (d.done) break;
    // from 2 s before the end an arrow key is HELD (and stays down through the banner)
    if (!holding && d.timeLeft < 60) { await page.keyboard.down('ArrowUp'); holding = true; }
    if (!holding && !d.busy && d.presses === 0 && !d.squash) {
      const k = d.state.findIndex((st, i) => st === 2 && d.hit[i] === 0);
      if (k >= 0) { await page.keyboard.press(BTN[k], { delay: 70 }); if (d.holder === k) { await wait(70); await page.keyboard.press(BTN[k], { delay: 70 }); } }
    }
    await wait(30);
  }
  const d = await dbg();
  log('short run', JSON.stringify({ score: d.score, gems: d.gems, hits: d.hits, done: d.done }));
  expect('the game ended', d.done === true);
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 10000 }).catch(() => {});
  expect('end banner (mode 4)', (await mode()) === 4);
  await wait(1200);
  expect('a key HELD through the end does not skip this banner (the loop tests the pressed buttons, unlike z05WAB / z38PAR)', (await mode()) === 4, `mode ${await mode()}`);
  await shot('4-banner');
  await page.keyboard.up('ArrowUp'); await wait(200);
  await key('ArrowRight'); await wait(400);
  expect('a new press ends the banner (mode 5)', (await mode()) === 5, `mode ${await mode()}`);
  await shot('5-result-menu');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z17WAS M5 checks passed');
  if (fail.length) process.exitCode = 1;
};
