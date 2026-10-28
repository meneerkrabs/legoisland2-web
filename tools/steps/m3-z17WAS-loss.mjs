// z17WAS: a LOSS (no input), the pause menu, retry (restart exit state 3) and abort (rewinds the story to the last hub). Muted, headless.
//   node tools/browse.mjs "http://localhost:5499/?zone=z17WAS&mute=1" tools/steps/m3-z17WAS-loss.mjs --size 1280x800 --out /tmp/m3/z17WAS
// Shortcut: the zonewas clock (`__zone.world.records[22].ctrl.nodes[0].timeLeft`) is set to 3 s after a few seconds of play.
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
  const startPlay = async () => { await ready('z17WAS', 1); await wait(800); await key('Enter'); await wait(600); await key('Enter'); await wait(600); };

  await startPlay();
  expect('play (mode 2)', (await mode()) === 2);
  const v0 = await page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), hi: __zone.sh.vars.get(200), trophy: __zone.sh.vars.get(0xd5) }));
  log('start', JSON.stringify(v0));
  await wait(3000);
  // pause (Esc): the mini-game pause page 18, the clock stands still, Esc again resumes
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const p1 = await dbg(); await wait(800); const p2 = await dbg();
  expect('the clock stands still in the pause menu', p1.timeLeft === p2.timeLeft, `${p1.timeLeft} / ${p2.timeLeft}`);
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await mode()) === 2 && (await dbg()).timeLeft < p2.timeLeft + 1);
  // out of time without a single button press
  await page.evaluate(() => { __zone.world.records[22].ctrl.nodes.find((n) => n.kind === 'zonewas').timeLeft = 90; });
  await wait(3800);
  let s = await dbg();
  expect('time up: banner (mode 4), score 0, result "lost"', (await mode()) === 4 && s.done && s.finalScore === 0, JSON.stringify(s));
  await shot('l2-banner');
  const v1 = await page.evaluate(() => ({ hi: __zone.sh.vars.get(200), trophy: __zone.sh.vars.get(0xd5) }));
  expect('no medal and the high score stays', v1.hi === v0.hi && v1.trophy <= 0, JSON.stringify(v1));
  await key('Enter'); await wait(700);
  const m = await menu();
  expect('result menu page 19 (retry / abort)', (await mode()) === 5 && m.page === 19, JSON.stringify(m));
  await shot('l3-result-menu');
  // retry: the zone restarts with a fresh game (attempt 1)
  await select(1); await press('Enter'); await wait(2500);
  await ready('z17WAS', 1);
  s = await dbg();
  expect('retry restarts the zone: clock 90 s, score 0, same story node', s.timeLeft === 2700 && s.score === 0 && s.elapsed === 0 && (await page.evaluate(() => __zone.sh.vars.get(0x58))) === v0.node, JSON.stringify(s));
  const attempt = await page.evaluate(() => __zone.ctx.attempt);
  expect('second attempt', attempt === 1, String(attempt));
  await key('Enter'); await wait(600); await key('Enter'); await wait(1500);
  await page.evaluate(() => { __zone.world.records[22].ctrl.nodes.find((n) => n.kind === 'zonewas').timeLeft = 30; });
  await wait(2500);
  await key('Enter'); await wait(700);
  expect('lost again: result menu 19', (await menu()).page === 19);
  // abort: the story rewinds to the last hub
  await select(2); await press('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z17WAS', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58) }));
  log('after abort', JSON.stringify(after));
  expect('abort leaves the zone, the story node is rewound to before the game', after.arch !== 'z17WAS' && after.node < v0.node, JSON.stringify(after));
  await wait(1200); await shot('l4-after-abort');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z17WAS loss run passed');
};
