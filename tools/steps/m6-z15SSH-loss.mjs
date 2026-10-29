// z15SSH: a LOSS (no input: the snakes steal every gem), the pause menu (page 18, the ride stands still), the banner (ADSGSS05 / 06), the result menu (page 19), retry
// (restart exit state 3: a fresh game) and abort (rewinds the story to the oasis hub z14OSD, node 34). Muted, headless.
//   node tools/browse.mjs "http://localhost:5601/?zone=z15SSH&mute=1" tools/steps/m6-z15SSH-loss.mjs --size 1280x800 --out /tmp/m6-z15SSH
// Shortcuts: the buggy starts with 2 gems (`__zone.game.ssh.node.gems = 2`, the 20 thefts are covered by the node test) and is put near the end of the course once they are gone.
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x4b), trophy: __zone.sh.vars.get(0x93), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m, [arch, m], { timeout: 300000 });
  const startPlay = async () => { await ready('z15SSH', 1); await wait(800); await key('Enter'); await wait(600); await key('Enter'); await wait(600); };
  const shortRide = () => page.evaluate(() => { __zone.game.ssh.node.gems = 2; });
  const toTheEnd = () => page.evaluate(() => { const z = __zone; z.game.ssh.node.jumpTo(z.world, 0.84); });

  await startPlay();
  expect('play (mode 2)', (await mode()) === 2);
  const v0 = await vars();
  log('start', JSON.stringify(v0));
  await shortRide();
  await wait(1500);
  // pause (Esc): the mini-game pause page 18, the ride stands still, Esc again resumes
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const p1 = await dbg(); await wait(800); const p2 = await dbg();
  expect('the ride stands still in the pause menu', p1.ticks === p2.ticks && p1.cart[2] === p2.cart[2], `${p1.ticks} / ${p2.ticks}`);
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await mode()) === 2 && (await dbg()).ticks >= p2.ticks);
  // no input: the snakes come and steal the two gems
  await page.waitForFunction(() => __zone.game.debug().states.includes(3), null, { timeout: 60000 });
  await shot('l2-leap');
  await page.waitForFunction(() => __zone.game.debug().gems === 0, null, { timeout: 90000 });
  let s = await dbg();
  expect('both gems stolen by snakes', s.gems === 0 && s.score === 0, JSON.stringify(s));
  await shot('l3-no-gems');
  await toTheEnd();
  await page.waitForFunction(() => __zone.machine.mode === 4, null, { timeout: 90000 });
  await wait(500);
  s = await dbg();
  expect('the ride ends: banner (mode 4), result 1, score 0', s.result === 1 && s.finalScore === 0, JSON.stringify({ r: s.result, f: s.finalScore, g: s.gems }));
  await shot('l4-banner');
  const v1 = await vars();
  expect('no medal, the hi-score stays 0', v1.hi === 0 && v1.trophy === 0, JSON.stringify(v1));
  await key('Enter'); await wait(700);
  let m = await menu();
  expect('result menu page 19 (retry / abort)', (await mode()) === 5 && m.page === 19, JSON.stringify(m));
  await shot('l5-result-menu');
  // retry: the zone restarts with a fresh game (attempt 1)
  await select(1); await press('Enter'); await wait(2500);
  await ready('z15SSH', 1);
  s = await dbg();
  expect('retry restarts the zone: 20 gems, score 0, same story node', s.gems === 20 && s.score === 0 && s.ticks === 0 && (await vars()).node === v0.node, JSON.stringify(s));
  expect('second attempt', (await page.evaluate(() => __zone.ctx.attempt)) === 1);
  await key('Enter'); await wait(600); await key('Enter'); await wait(1200);
  await shortRide();
  await toTheEnd();
  await page.waitForFunction(() => __zone.game.debug().gems === 0, null, { timeout: 90000 });
  await toTheEnd();
  await page.waitForFunction(() => __zone.machine.mode === 4, null, { timeout: 90000 });
  await key('Enter'); await wait(700);
  expect('lost again: result menu 19', (await menu()).page === 19);
  // abort: the story rewinds to the oasis hub
  await select(2); await press('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z15SSH', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58) }));
  log('after abort', JSON.stringify(after));
  expect('abort leaves the zone, the story node is rewound to before the game', after.arch === 'z14OSD' && after.node < v0.node, JSON.stringify(after));
  await wait(1200); await shot('l6-after-abort');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z15SSH loss run passed');
};
