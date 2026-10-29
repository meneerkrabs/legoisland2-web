// z27TRX LOSS (headless, muted): the pause menu (page 18, the clock stands still), the clock runs out (shortened through the node), the rex slows down, loss banner (score 0, no medal),
// result menu page 19 (retry / abort), retry restarts the zone, abort rewinds the story to the hub.
//   node tools/browse.mjs "http://localhost:5603/?zone=z27TRX&mute=1" tools/steps/m6-z27TRX-loss.mjs --size 1280x800 --out /tmp/m6-z27TRX
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z27TRX' && window.__zone.machine.mode === m, m, { timeout: 300000 });
  const start = async () => { await ready(1); await wait(800); await key('Enter'); await wait(600); await key('Enter'); await wait(1000); };
  await start();
  const v0 = await page.evaluate(() => ({ node: __shell.vars.get(0x58), hi: __shell.vars.get(0x87), trophy: __shell.vars.get(0x1a) }));
  await wait(2500);
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const p1 = await dbg(); await wait(900); const p2 = await dbg();
  expect('the clock stands still in the pause menu', p1.clock === p2.clock && p1.z === p2.z, `${p1.clock} / ${p2.clock}`);
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes', (await mode()) === 2 && (await dbg()).clock < p2.clock + 1);
  // the clock: three seconds left
  await page.evaluate(() => { __zone.world.records[335].ctrl.nodes[0].clock = 90; });
  await wait(3800); await shot('l2-timeout');
  let s = await dbg();
  expect('time up: the arrival phase, slowing down', s.timeout && s.phase >= 5, JSON.stringify(s));
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 120000 });
  s = await dbg();
  expect('loss banner: score 0, medal 0, nothing written', s.score === 0 && s.medal === 0 && s.phase === 7 && s.hiscore === v0.hi && s.trophy === v0.trophy, JSON.stringify(s));
  await wait(500); await shot('l3-banner');
  await key('Enter'); await wait(700);
  const m = await menu();
  expect('result menu page 19 (retry / abort)', (await mode()) === 5 && m.page === 19, JSON.stringify(m));
  await shot('l4-result');
  await select(1); await press('Enter'); await wait(2500);
  await ready(1);
  s = await dbg();
  const attempt = await page.evaluate(() => __zone.ctx.attempt);
  expect('retry: a fresh run (clock 5400, z 80, hits 0, attempt 1)', s.clock === 5400 && s.hits === 0 && s.phase === 0 && attempt === 1, JSON.stringify(s) + ' attempt ' + attempt);
  await key('Enter'); await wait(600); await key('Enter'); await wait(1200);
  await page.evaluate(() => { __zone.world.records[335].ctrl.nodes[0].clock = 30; });
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 120000 });
  await key('Enter'); await wait(700);
  expect('lost again: page 19', (await menu()).page === 19);
  await select(2); await press('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z27TRX', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __shell.vars.get(0x58) }));
  log('after abort', JSON.stringify(after));
  expect('abort leaves the zone and rewinds the story', after.arch !== 'z27TRX' && after.node < v0.node, JSON.stringify(after));
  await wait(1200); await shot('l5-after-abort');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z27TRX loss run passed');
};
