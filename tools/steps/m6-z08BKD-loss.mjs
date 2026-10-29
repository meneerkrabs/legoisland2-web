// z08BKD "Brick Dive": a LOSS (the oxygen runs out), the dive with real key presses (Playwright keyboard), the pause menu (mini-game page 18), the failure banner, the result
// menu (page 19: retry / abort), retry (the zone restarts: 0 bricks, full oxygen) and abort (the story is rewound). Headless, muted.
//   node tools/browse.mjs "http://localhost:5607/?zone=z08BKD&mute=1" tools/steps/m6-z08BKD-loss.mjs --size 1024x768 --out /tmp/m6-z08BKD
// Shortcut (not in the original): after a few seconds of play the oxygen clock is set to 494 s so that the loss does not take 500 s of wall time (the 15000 ticks are covered by
// the node test tools/tests/m6-z08BKD.mjs).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), hi: __zone.sh.vars.get(0x2f), trophy: __zone.sh.vars.get(0x3d), sub: __zone.sh.vars.get(0x59), done: __zone.sh.vars.get(0x53) }));
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z08BKD' && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, m, { timeout: 300000 });
  const startPlay = async () => { await ready(1); await wait(900); await key('Enter'); await wait(600); await key('Enter'); await wait(900); };

  await startPlay();
  const v0 = await vars();
  log('start', JSON.stringify(v0));
  let d = await dbg();
  expect('play (mode 2) at the surface with the full oxygen and no bricks', (await mode()) === 2 && d.bricks === 0 && d.percent > 95 && d.held === -1, JSON.stringify({ b: d.bricks, p: d.percent }));
  await shot('l1-surface');
  // dive: DOWN swims backwards (the diver faces up at the start), real key presses
  await page.keyboard.down('ArrowDown'); await wait(3000); await page.keyboard.up('ArrowDown');
  d = await dbg();
  expect('he dived (y fell by more than 15) and the oxygen gauge is falling', d.pos[1] < 70 && d.percent < 100, JSON.stringify({ y: d.pos[1], p: d.percent }));
  await shot('l2-dive');
  await page.keyboard.down('ArrowLeft'); await wait(700); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
  await shot('l3-swimming');
  // pause: Esc opens the mini-game pause page 18, everything stands still, Esc resumes
  const t1 = (await dbg()).ticks;
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  await shot('l4-pause');
  await wait(800);
  expect('the clock stands still in the pause', (await dbg()).ticks === t1 || (await dbg()).ticks - t1 <= 2, JSON.stringify({ t1, t2: (await dbg()).ticks }));
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await mode()) === 2);
  // the oxygen runs out (the shortcut): the clock to 494 s, 6 s left
  await page.evaluate(() => { __zone.game.run.state.elapsed = 494; });
  await wait(1000); await shot('l5-oxygen-low');
  for (let i = 0; i < 40 && (await mode()) === 2; i++) await wait(250);
  d = await dbg();
  expect('the oxygen is gone: result 2 and the banner (mode 4)', d.result === 2 && (await mode()) === 4, JSON.stringify({ r: d.result, m: await mode() }));
  await wait(900); await shot('l6-banner');
  const v1 = await vars();
  expect('a failed game writes only the hi-score (0 bricks: score 0): the trophy and the story stay', v1.trophy === v0.trophy && v1.done === 0 && v1.node === v0.node, JSON.stringify({ v0, v1 }));
  await key('Enter'); await wait(800);
  expect('result menu page 19 (retry / abort)', (await mode()) === 5 && (await menu()).page === 19, JSON.stringify({ m: await mode(), menu: await menu() }));
  await shot('l7-result-menu');
  // retry
  await select(1); await press('Enter'); await wait(2500);
  await ready(1);
  const attempt = await page.evaluate(() => __zone.ctx.attempt);
  await wait(500); await shot('l8-retry-intro');
  await key('Enter'); await wait(600); await key('Enter'); await wait(900);
  d = await dbg();
  expect('retry: the zone restarts (second attempt): no bricks, full oxygen, at the surface, same story node', attempt === 1 && d.bricks === 0 && d.percent > 95 && d.pos[1] > 80 && (await vars()).node === v0.node, JSON.stringify({ attempt, b: d.bricks, p: d.percent, y: d.pos[1], v: await vars() }));
  await shot('l9-retry-play');
  await page.evaluate(() => { __zone.game.run.state.elapsed = 494; });
  for (let i = 0; i < 60 && (await mode()) === 2; i++) await wait(250);
  await wait(800); await key('Enter'); await wait(800);
  expect('lost again: result menu 19', (await mode()) === 5 && (await menu()).page === 19);
  // abort: FUN_00404d14(&next, false, ...) rewinds the story to the last hub node (story node 18 = this dive, node 17 = the castle z07CSI): the next zone is the castle, with the node
  // restored to 17. (In this dev entry the castle hub then finds node 17's variable satisfied and the story moves on to the dive again, so the rewind is watched while it happens.)
  await select(2); await press('Enter');
  const seen = [];
  for (let i = 0; i < 40; i++) { await wait(100); seen.push(await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58), cur: __zone.sh.vars.get(0x59), done: __zone.sh.vars.get(0x53), trophy: __zone.sh.vars.get(0x3d) }))); }
  const rewound = seen.find((s) => s.node === 17 && s.cur === 6);
  log('after abort', JSON.stringify({ rewound, last: seen[seen.length - 1] }));
  const after = seen[seen.length - 1];
  expect('abort: the story is rewound to the castle hub (node 17, zone z07CSI), nothing completed, no trophy', !!rewound && seen.every((s) => s.done === 0 && s.trophy === 0), JSON.stringify({ rewound, v0 }));
  await wait(3500);
  void after; await wait(800); await shot('l10-after-abort');
  log(fail.length ? 'FAILED ' + fail.join('; ') : 'ALL OK');
};
