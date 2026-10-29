// z28HAT hot-air balloon in the headless browser (muted): the intro cutscene ADV08 (skipped with Shift after a look), the brief and the help screen, then the bot of
// tools/lib/hat-bot.mjs flies the balloon with REAL key presses (arrows, Shift = hook / sandbags): the babies and one big dinosaur to the landing site, the other dinosaurs let go
// where they hang (counted, no points), then the sandbags into Bronty's mouth until he is freed; the banner, the outro cutscene ADV09 (skipped), the result menu and Continue
// (the story goes on). Screenshots go to --out. ~3 minutes of wall time.
//   sh tools/m4-snapshot-server.sh 5608
//   node tools/browse.mjs "http://localhost:5608/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT.mjs --size 1280x800 --out /tmp/m6-z28HAT
import { makePlan, hatBotStep } from '../lib/hat-bot.mjs';

const KEYS = [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']];
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, ...z.game.debug() } : null; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x4a), trophy: __zone.sh.vars.get(0x9d), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const ready = () => page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z28HAT' && window.__zone.game && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0, null, { timeout: 300000 });
  const held = new Set();
  const setKeys = async (mask) => {
    for (const [bit, code] of KEYS) {
      const want = (mask & bit) !== 0;
      if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
      if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
    }
  };

  // ------------------------------------------------------------------------------------------------ intro cutscene, brief, help
  await ready();
  let s = await dbg();
  const v0 = await vars();
  log('start', JSON.stringify(v0));
  expect('z28HAT, intro cutscene running (mode 1)', s.arch === 'z28HAT' && s.mode === 1 && s.cutscene === true, JSON.stringify({ mode: s.mode, cut: s.cutscene }));
  expect('entered at the story\'s sub-game (zone table index 21)', v0.sub === 21, JSON.stringify(v0));
  await wait(7000); await shot('w1-cutscene-a');
  await wait(9000); await shot('w1-cutscene-b');
  for (let i = 0; i < 160 && (await dbg()).cutscene; i++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); }   // every press (edge) skips what the running commands wait for
  await wait(700);
  s = await dbg();
  expect('cutscene over, brief (mode 1)', !s.cutscene && s.mode === 1, JSON.stringify({ mode: s.mode }));
  await shot('w2-brief');
  await key('Enter'); await wait(500);
  expect('help screen (mode 9)', (await dbg()).mode === 9); await shot('w3-help');
  await key('Enter'); await wait(1000);
  s = await dbg();
  expect('play (mode 2): balloon over the drop zone, 11 dinosaurs to find', s.mode === 2 && s.total === 11 && s.delivered === 0 && s.score === 0, JSON.stringify({ mode: s.mode, total: s.total }));
  await shot('w4-play');

  // ------------------------------------------------------------------------------------------------ the bot plays
  const plan = makePlan({ carry: ['babies0', 'dino1'] });
  const taken = new Set();
  let sawFireball = false, sawHooked = false, maxScore = 0, last = null;
  const t0 = Date.now();
  for (let i = 0; i < 20000 && Date.now() - t0 < 420000; i++) {
    s = await dbg();
    if (!s || s.mode !== 2 || s.result) break;
    last = s;
    maxScore = Math.max(maxScore, s.score);
    const snap = (name, cond) => { if (!taken.has(name) && cond) { taken.add(name); return shot(name); } };
    if (s.fireball.on) sawFireball = true;
    if (s.carrying) sawHooked = true;
    await snap('w5-fireball', s.fireball.on);
    await snap('w6-carrying', s.carrying && plan.phase === 'carry' && s.winch === 0);
    await snap('w7-babies-hooked', s.carrying && plan.kind === 'babies');
    await snap('w8-all-down', s.allDone);
    await snap('w9-sandbags', s.sandbags.some((b) => b.active));
    await snap('w10-bronty-hit', s.brontyState === 3);
    await snap('w11-freed', s.brontyState === 1);
    await setKeys(hatBotStep(s, plan));
    await wait(25);
    if (i % 400 === 0) log('tick', s.tick, 'phase', plan.phase, 'score', s.score, 'delivered', s.delivered, 'winch', s.winch, 'bronty', s.brontyState);
  }
  await setKeys(0);
  s = await dbg();
  log('bot finished', JSON.stringify({ mode: s.mode, score: s.score, delivered: s.delivered, result: s.result, tick: s.tick, knocks: s.control }));
  expect('the bot hooked dinosaurs', sawHooked);
  expect('a fireball was fired', sawFireball);
  expect('all eleven dinosaurs counted', s.delivered === 11 && s.allDone, `delivered ${s.delivered}`);
  expect('the game is over: Bronty freed, result 1 (score >= 2500)', s.result === 1 && s.score >= 2500, JSON.stringify({ result: s.result, score: s.score }));
  expect('banner (mode 4)', s.mode === 4, `mode ${s.mode}`);
  await wait(600); await shot('w12-banner');
  const v1 = await vars();
  log('after the game', JSON.stringify(v1));
  expect('the hi-score (var 0x4a) is the score', v1.hi === s.score, JSON.stringify({ hi: v1.hi, score: s.score }));
  expect('the trophy (var 0x9d) is set (medal)', v1.trophy >= 1, String(v1.trophy));
  const medalWanted = s.score >= 7500 ? 3 : s.score >= 5000 ? 2 : 1;
  expect('the trophy matches the score', v1.trophy >= medalWanted || v1.trophy === medalWanted, `${v1.trophy} / ${medalWanted}`);

  // ------------------------------------------------------------------------------------------------ outro cutscene, result menu, continue
  await key('Enter'); await wait(800);
  s = await dbg();
  expect('mode 5 starts the outro cutscene (a medal was earned) before the result menu', s.mode === 5 && s.cutscene === true, JSON.stringify({ mode: s.mode, cut: s.cutscene }));
  await wait(3000); await shot('w13-outro');
  for (let i = 0; i < 120 && (await dbg()).cutscene; i++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); }
  await wait(800);
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await dbg()).mode === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('w14-result-menu');
  await key('Enter'); await wait(3500);                   // Continue
  const after = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: __zone?.sh.vars.get(0x58), mode: window.__zone?.machine.mode }));
  log('after Continue', JSON.stringify(after));
  expect('Continue leaves the zone (the story goes on)', after.arch && after.arch !== 'z28HAT', JSON.stringify(after));
  expect('the story advanced', after.node > v0.node, `${v0.node} -> ${after.node}`);
  await wait(1200); await shot('w15-after');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z28HAT win run passed');
};
