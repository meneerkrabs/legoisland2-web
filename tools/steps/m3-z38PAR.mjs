// z38PAR "Parachute" in the headless browser, with real key input: the intro / help screens, a WIN (rings, parachute, landing on target 3: banner, result menu,
// medal vars, back to the island) and then a LOSS (free fall into the ground: banner, failed menu, Abort rewinds the story). Screenshots go to --out.
//   node tools/browse.mjs "http://localhost:5499/?zone=z38PAR&mute=1" tools/steps/m3-z38PAR.mjs --size 640x480 --out /tmp/m3/z38PAR
// The scripted pilot is tools/lib/par-bot.mjs (the same decisions as the node test); every 60 ms it reads the snapshot of `__zone.game.debug()` and presses / releases keys.
import { parBotStep, steerBits, pitchBits } from '../lib/par-bot.mjs';
import { B } from '../../src/game/input.ts';
import { installPageBot, pilotDecideSource } from './lib-pagebot.mjs';

const KEYS = [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']];
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, arch: z.info.archive, node: z.sh.vars.get(0x58), tick: z.world.tickCount, ...z.game.debug() } : null; });
  const ready = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0 && window.__zone.world.tickCount >= 0, arch, { timeout: 300000 });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const held = new Set();
  const setKeys = async (mask) => {
    for (const [bit, code] of KEYS) {
      const want = (mask & bit) !== 0;
      if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
      if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
    }
  };
  /** play until the game is over: the page-side bot (lib-pagebot.mjs) decides every 4 ms inside the page from the zone's own snapshot and presses the keys as KeyboardEvents;
   *  this process only takes the screenshots (a screenshot stalls the page for a while, which no longer costs the bot a decision: it stops with the page) */
  // (the pilot is installed BEFORE the game starts, while the help screen is up: its decide function answers nothing until the zone plays (mode 2), and from the first tick on it is
  // in the loop like the scripted pilot of the node replay; the z38PAR runs are lost by a tick or two of delay, a start a second late is a lost run)
  const armPilot = async (plan) => { const bot = await installPageBot(page, 'par', pilotDecideSource('parBotStep', B, steerBits, pitchBits, parBotStep, plan)); await bot.start(); return bot; };
  const fly = async (plan, shots = [], pre = null) => {
    const bot = pre ?? await armPilot(plan);
    const taken = new Set();
    for (let i = 0; i < 6000; i++) {
      const s = await dbg();
      if (!s || s.mode !== 2 || s.over) break;
      for (const [name, pred] of shots) if (!taken.has(name) && pred(s)) { taken.add(name); await shot(name); }
      await wait(60);
    }
    const info = await bot.info(); log('page bot', JSON.stringify(info));
    await bot.stop();
  };

  // ------------------------------------------------------------------------------------------------ WIN
  await ready('z38PAR');
  let s = await dbg();
  expect('z38PAR at story node 60 (island -> PAR)', s.node === 60, JSON.stringify({ node: s.node, mode: s.mode }));
  await wait(500);
  await shot('par-1-intro');
  await key('Enter'); await wait(500);
  expect('help screen (mode 9)', (await dbg()).mode === 9);
  await shot('par-2-help');
  const pilot1 = await armPilot({ land: 3 });
  await key('Enter'); await wait(800);
  s = await dbg();
  expect('play mode, free fall from 1360', s.mode === 2 && s.state === 1 && s.pepper.y > 1300, JSON.stringify({ mode: s.mode, state: s.state, y: s.pepper.y }));
  await shot('par-3-start');
  await fly({ land: 3 }, [
    ['par-4-ring3', (d) => d.ring[2] === 1],
    ['par-5-ring1', (d) => d.ring[0] === 1],
    ['par-6-glide', (d) => d.state === 3 && d.height < 220],
    ['par-7-landing', (d) => d.state === 4],
  ], pilot1);
  s = await dbg();
  log('flight over', JSON.stringify({ score: s.score, ring: s.ring, state: s.state, result: s.result, hiscore: s.hiscore, trophy: s.trophy, spoken: s.spoken }));
  expect('at least two of the three rings passed (the browser bot reacts with a few ticks of latency)', s.ring.filter((r) => r === 1).length >= 2, s.ring.join());
  expect('success: score >= 2000', s.score >= 2000 && s.result === 1, `score ${s.score}`);
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 60000 }).catch(() => {});
  expect('end banner (mode 4)', (await dbg()).mode === 4);
  await shot('par-8-banner');
  expect('hiscore and trophy written (vars 0xaa / 0xd1)', s.hiscore === Math.trunc(s.score) && s.trophy === (s.score >= 5000 ? 3 : s.score >= 3000 ? 2 : 1), `hiscore ${s.hiscore} trophy ${s.trophy}`);
  await key('Enter'); await wait(600);
  s = await dbg();
  expect('result menu page 16 (continue / retry)', (await menu()).page === 16, JSON.stringify(await menu()));
  await shot('par-9-result');
  await key('Enter'); await wait(2500);                // Doorgaan
  await ready('z02LGI');
  s = await page.evaluate(() => ({ arch: window.__zone.info.archive, node: window.__zone.sh.vars.get(0x58) }));
  expect('back on the island, story advanced past node 60', s.arch === 'z02LGI' && s.node > 60, JSON.stringify(s));
  await shot('par-10-island');

  // ------------------------------------------------------------------------------------------------ LOSS
  await page.goto(page.url());
  await ready('z38PAR');
  await key('Enter'); await wait(400); await key('Enter'); await wait(800);
  await page.keyboard.down('ArrowDown'); held.add('ArrowDown');        // head down: 0.8 per tick, no parachute
  // (M5: the end banner of this loop is left as soon as ANY button is HELD, so the key is released shortly before the ground to see the banner)
  for (let i = 0; i < 4000; i++) { const d = await dbg(); if (!d || d.over || d.mode !== 2) break; if (held.has('ArrowDown') && d.pepper.y < 120) { await page.keyboard.up('ArrowDown'); held.delete('ArrowDown'); } await wait(60); }
  if (held.has('ArrowDown')) { await page.keyboard.up('ArrowDown'); held.delete('ArrowDown'); }
  s = await dbg();
  log('crash', JSON.stringify({ score: s.score, state: s.state, result: s.result, hiscore: s.hiscore, trophy: s.trophy }));
  expect('crash without the parachute: score 0, failed', s.score === 0 && s.result === 2 && s.trophy === 0);
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 60000 }).catch(() => {});
  expect('failure banner (mode 4)', (await dbg()).mode === 4);
  await shot('par-11-failed-banner');
  await key('Enter'); await wait(600);
  expect('failed result menu page 19 (retry / abort)', (await menu()).page === 19, JSON.stringify(await menu()));
  await shot('par-12-failed-menu');
  for (let i = 0; i < 4 && (await menu()).item !== 2; i++) { await key('ArrowDown'); await wait(200); }
  await key('Enter'); await wait(2500);                  // Afbreken
  await ready('z02LGI');
  s = await page.evaluate(() => ({ arch: window.__zone.info.archive, node: window.__zone.sh.vars.get(0x58) }));
  expect('abort rewinds to the island (node < 60)', s.arch === 'z02LGI' && s.node < 60, JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z38PAR browser run passed');
  if (fail.length) process.exitCode = 1;
};
