// z40aPO "Parachute landing on Ogel" in the headless browser, with real key input: the intro cutscene (ogl02, skipped with Shift after a look), brief, help, a WIN (rings, wing, landing:
// banner, result menu, medal vars, back to the island) and a LOSS (falling without the wing: failed banner, Abort rewinds the story). Screenshots go to --out.
//   node tools/browse.mjs "http://localhost:5499/?zone=z40aPO&mute=1" tools/steps/m3-z40aPO.mjs --size 1280x800 --out /tmp/m3/z40aPO
import { apoBotStep } from '../lib/apo-bot.mjs';

const KEYS = [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']];
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, arch: z.info.archive, node: z.sh.vars.get(0x58), tick: z.world.tickCount, ...z.game.debug() } : null; });
  const ready = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && (a !== 'z40aPO' || window.__zone.game) && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0, arch, { timeout: 300000 });
  const left = () => page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z40aPO' && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0, null, { timeout: 120000 });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const held = new Set();
  const setKeys = async (mask) => {
    for (const [bit, code] of KEYS) {
      const want = (mask & bit) !== 0;
      if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
      if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
    }
  };
  const fly = async (plan, shots = []) => {
    const taken = new Set();
    for (let i = 0; i < 9000; i++) {
      const s = await dbg();
      if (!s || s.mode !== 2 || s.over) break;
      for (const [name, pred] of shots) if (!taken.has(name) && pred(s)) { taken.add(name); await shot(name); }
      await setKeys(apoBotStep(s, plan));
      await wait(30);
    }
    await setKeys(0);
  };
  const intro = async (tag, look) => {
    await ready('z40aPO');
    let s = await dbg();
    expect(`${tag}: z40aPO, intro cutscene running`, s.arch === 'z40aPO' && s.cutscene === true, JSON.stringify({ mode: s.mode, cut: s.cutscene }));
    if (look) { await wait(6000); await shot('apo-1-cutscene'); await wait(6000); await shot('apo-2-cutscene'); }
    for (let i = 0; i < 120 && (await dbg()).cutscene; i++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); }   // every press (edge) skips what the running commands wait for
    await wait(600);
    s = await dbg();
    expect(`${tag}: cutscene over`, !s.cutscene, JSON.stringify({ mode: s.mode }));
    if (look) await shot('apo-3-brief');
    await key('Enter'); await wait(500);
    if (look) { expect('help screen (mode 9)', (await dbg()).mode === 9); await shot('apo-4-help'); }
    await key('Enter'); await wait(800);
  };

  // ------------------------------------------------------------------------------------------------ WIN
  await intro('win', true);
  let s = await dbg();
  expect('story node 63', s.node === 63, `node ${s.node}`);
  expect('play mode', s.mode === 2, JSON.stringify({ mode: s.mode, state: s.state, y: s.pepper.y }));
  await shot('apo-5-start');
  await fly({ land: 3 }, [
    ['apo-6-ring', (d) => d.ring[0] === 1],
    ['apo-7-fall', (d) => d.ring.filter((r) => r === 1).length >= 5],
    ['apo-8-wing', (d) => d.state === 4],
    ['apo-9-landing', (d) => d.state === 5],
  ]);
  s = await dbg();
  log('flight over', JSON.stringify({ score: s.score, ring: s.ring.join(''), state: s.state, result: s.result, hiscore: s.hiscore, trophy: s.trophy, spoken: s.spoken }));
  expect('at least 6 rings passed (browser bot latency)', s.ring.filter((r) => r === 1).length >= 6, s.ring.join(''));
  expect('success: score >= 2000', s.score >= 2000 && s.result === 1, `score ${s.score}`);
  await wait(900);
  expect('end banner (mode 4)', (await dbg()).mode === 4);
  await shot('apo-10-banner');
  expect('hiscore and trophy written (vars 0x2c / 0x43)', s.hiscore === Math.trunc(s.score) && s.trophy === (s.score >= 8000 ? 3 : s.score >= 5000 ? 2 : 1), `hiscore ${s.hiscore} trophy ${s.trophy}`);
  await key('Enter'); await wait(600);
  expect('result menu page 16', (await menu()).page === 16, JSON.stringify(await menu()));
  await shot('apo-11-result');
  await key('Enter'); await wait(2500);
  await left();
  s = await page.evaluate(() => ({ arch: window.__zone.info.archive, node: window.__zone.sh.vars.get(0x58) }));
  expect('the story advanced past node 63 and left the zone (next node: the story decides, probably z40OGL)', s.arch !== 'z40aPO' && s.node > 63, JSON.stringify(s));
  await shot('apo-12-after');

  // ------------------------------------------------------------------------------------------------ LOSS
  await page.goto(page.url());
  await intro('loss', false);
  await page.keyboard.down('ArrowDown'); held.add('ArrowDown');
  for (let i = 0; i < 6000; i++) { const d = await dbg(); if (!d || d.over || d.mode !== 2) break; await wait(60); }
  await page.keyboard.up('ArrowDown'); held.delete('ArrowDown');
  s = await dbg();
  log('crash', JSON.stringify({ score: s.score, state: s.state, result: s.result, hiscore: s.hiscore, trophy: s.trophy }));
  expect('no wing: score 0, failed', s.score === 0 && s.result === 2 && s.trophy === 0);
  await wait(900);
  expect('failure banner (mode 4)', (await dbg()).mode === 4);
  await shot('apo-13-failed-banner');
  await key('Enter'); await wait(600);
  expect('failed result menu page 19', (await menu()).page === 19, JSON.stringify(await menu()));
  await shot('apo-14-failed-menu');
  for (let i = 0; i < 4 && (await menu()).item !== 2; i++) { await key('ArrowDown'); await wait(200); }
  await key('Enter'); await wait(2500);
  await left();
  s = await page.evaluate(() => ({ arch: window.__zone.info.archive, node: window.__zone.sh.vars.get(0x58) }));
  expect('abort rewinds the story (node < 63, back on the island)', s.arch === 'z02LGI' && s.node < 63, JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z40aPO browser run passed');
  if (fail.length) process.exitCode = 1;
};
