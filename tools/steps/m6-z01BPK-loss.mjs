// z01BPK: a LOSS (no stunts, no key but the one that starts the game), the pause menu, retry (restart exit state 3) and abort. Muted, headless.
//   node tools/browse.mjs "http://localhost:5611/?zone=z01BPK&mute=1" tools/steps/m6-z01BPK-loss.mjs --size 1280x800 --out /tmp/m6-z01BPK
// Shortcut: the clock is set to 3 s after the walk-in and a few seconds of skating (`__zone.game.bpk.swc.time`).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m, [arch, m], { timeout: 300000 });
  const startPlay = async () => { await ready('z01BPK', 1); await wait(800); await key('Enter'); await wait(600); };

  await startPlay();
  expect('play (mode 2)', (await mode()) === 2);
  const v0 = await page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), hi: __zone.sh.vars.get(0xc0), trophy: __zone.sh.vars.get(0x8d) }));
  log('start', JSON.stringify(v0));
  await page.waitForFunction(() => window.__zone.game.debug().control === 4, null, { timeout: 30000 });
  await wait(4000);
  let s = await dbg();
  expect('skating by itself (no stunts)', s.state === 0x29 || s.state === 0x20 || s.state === 0x21 || s.state === 0x2d, JSON.stringify(s));
  // pause (Esc): the mini-game pause page 18, the clock stands still, Esc again resumes
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const p1 = await dbg(); await wait(800); const p2 = await dbg();
  expect('the clock stands still in the pause menu', p1.time === p2.time, `${p1.time} / ${p2.time}`);
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await mode()) === 2);
  // out of time without a single stunt
  await page.evaluate(() => { __zone.game.bpk.swc.time = 90; });
  await page.waitForFunction(() => window.__zone.machine.mode === 5, null, { timeout: 30000 }).catch(() => {});
  await wait(500);
  s = await dbg();
  expect('time up: no points -> straight to the result menu (the banner is skipped), result 2', (await mode()) === 5 && s.result === 2 && s.finalScore === 0, JSON.stringify(s));
  const m = await menu();
  expect('result menu page 19 (retry / abort)', m.page === 19, JSON.stringify(m));
  await shot('l2-result-menu');
  const v1 = await page.evaluate(() => ({ hi: __zone.sh.vars.get(0xc0), trophy: __zone.sh.vars.get(0x8d) }));
  expect('no medal and the hi-score stays', v1.hi === v0.hi && v1.trophy === v0.trophy, JSON.stringify(v1));
  // retry: the zone restarts with a fresh game (attempt 1)
  await select(1); await press('Enter'); await wait(2500);
  await ready('z01BPK', 1);
  s = await dbg();
  expect('retry restarts the zone: clock 3600, score 0, walking in, same story node', s.time === 3600 && s.score === 0 && s.control === 1 && (await page.evaluate(() => __zone.sh.vars.get(0x58))) === v0.node, JSON.stringify(s));
  const attempt = await page.evaluate(() => __zone.ctx.attempt);
  expect('second attempt', attempt === 1, String(attempt));
  await shot('l3-retry');
  await key('Enter'); await wait(600);
  await page.waitForFunction(() => window.__zone.game.debug().control === 4, null, { timeout: 30000 });
  await page.evaluate(() => { __zone.game.bpk.swc.time = 60; });
  await page.waitForFunction(() => window.__zone.machine.mode === 5, null, { timeout: 30000 }).catch(() => {});     // the clock waits for the mount (2 s), then 2 s
  await wait(500);
  expect('lost again: result menu 19', (await mode()) === 5 && (await menu()).page === 19, JSON.stringify(await menu()));
  // abort: the story rewinds to the last hub (story node 1 -> node 0 = the front end z60FRE, which is no `__zone`: the page's `__fe` appears)
  await page.evaluate(() => { delete window.__fe; });
  await select(2); await press('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__fe !== undefined, null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ fe: !!window.__fe, node: __shell.vars.get(0x58), sub: __shell.vars.get(0x59) }));
  log('after abort', JSON.stringify(after));
  expect('abort leaves the zone: the front end (story node 0)', after.fe && after.node === 0, JSON.stringify(after));
  await wait(1200); await shot('l4-after-abort');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z01BPK loss run passed');
};
