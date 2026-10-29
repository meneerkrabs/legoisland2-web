// z21FSH Fishing: a LOSS (the last cast is thrown too hard: out of casts), the pause menu (the mini-game page 18), the result menu (page 19: retry / abort), retry (the zone restarts
// with 20 casts) and abort (the story is rewound). Real key presses, muted, headless. Starts at story node 43 (no opening cutscene).
//   node tools/browse.mjs "http://localhost:5602/?zone=z21FSH&node=43&mute=1" tools/steps/m6-z21FSH-loss.mjs --size 1024x768 --out /tmp/m6-z21FSH
// Shortcut (not in the original): the casts are set to 1 so that the loss does not take twenty casts of wall time (the 20 casts are covered by the node tests).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), hi: __zone.sh.vars.get(0x38), trophy: __zone.sh.vars.get(0x88), done: __zone.sh.vars.get(0x53) }));
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const tap = (k, ms = 70) => page.keyboard.press(k, { delay: ms });
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z21FSH' && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, m, { timeout: 300000 });
  const until = async (name, f, ms = 60000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && f(d)) return d; if (Date.now() - t0 > ms) { log('TIMEOUT', name, JSON.stringify(d)); fail.push('timeout ' + name); return d; } await wait(40); } };
  const startPlay = async () => { await ready(1); await wait(700); await key('Enter'); await wait(500); await key('Enter'); await wait(700); };

  await startPlay();
  expect('play (mode 2), state 1, 20 casts', (await mode()) === 2 && (await dbg()).state === 1 && (await dbg()).casts === 20);
  const v0 = await vars();
  log('start', JSON.stringify(v0));
  await tap('Shift');
  await until('ready', (d) => d.state === 6);
  // pause: Esc opens the mini-game pause page 18, everything stands still, Esc resumes
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await mode()) === 2);
  // the last cast, thrown far too hard: the meter runs out above 60 by itself
  await page.evaluate(() => { __zone.world.records[6].ctrl.nodes.find((n) => n.kind === 'Fishing').casts = 1; });
  await tap('Control');
  await until('charge', (d) => d.state === 7 && d.sub === 1);
  await wait(300); await shot('l2-charge');
  await until('too hard', (d) => d.popups.includes('FSH1') || d.state === 5 || d.result === 2, 15000);
  const d1 = await dbg();
  expect('"Te hard": the cast is wasted (FSH1)', d1.casts === 0, JSON.stringify(d1));
  await until('lost', (d) => d.result === 2, 8000);
  await wait(900);
  expect('out of casts: the result menu page 19 (retry / abort) straight from play', (await mode()) === 5 && (await menu()).page === 19, JSON.stringify({ m: await mode(), menu: await menu() }));
  await shot('l3-result-menu');
  const v1 = await vars();
  expect('nothing written: the hi-score stays, the sub-game is not complete', v1.hi === v0.hi && v1.done === 0, JSON.stringify(v1));
  // retry
  await select(1); await press('Enter'); await wait(2500);
  await ready(1);
  const attempt = await page.evaluate(() => __zone.ctx.attempt);
  const s = await dbg();
  expect('retry: the zone restarts (second attempt) with 20 casts, state 1, same story node', attempt === 1 && s.casts === 20 && s.state === 1 && (await vars()).node === v0.node, JSON.stringify({ attempt, s: { c: s.casts, st: s.state }, v: await vars() }));
  await key('Enter'); await wait(500); await key('Enter'); await wait(900);
  await tap('Shift');
  await until('ready 2', (d) => d.state === 6);
  await page.evaluate(() => { __zone.world.records[6].ctrl.nodes.find((n) => n.kind === 'Fishing').casts = 1; });
  await tap('Control');
  await until('lost again', (d) => d.result === 2, 30000);
  await wait(900);
  expect('lost again: result menu 19', (await menu()).page === 19);
  // abort: the story is rewound to before the game
  await select(2); await press('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z21FSH', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58) }));
  log('after abort', JSON.stringify(after));
  expect('abort leaves the zone, the story node is rewound to before the game', after.arch !== 'z21FSH' && after.node < 42, JSON.stringify(after));
  await wait(1200); await shot('l4-after-abort');
  log(fail.length ? 'FAILED ' + fail.join('; ') : 'ALL OK');
};
