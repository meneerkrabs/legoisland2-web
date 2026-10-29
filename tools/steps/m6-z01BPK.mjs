// z01BPK, the skate park, in the headless browser (muted): the intro, the walk to the board, a scripted skater with REAL key presses (Alt crouch / jump, Space + Left + Up stunts:
// tools/lib/bpk-bot.mjs) to a WIN, the clock, the banner (score / medal / new hi-score), the result menu and the way back through the story.
//   sh tools/m4-snapshot-server.sh 5611
//   node tools/browse.mjs "http://localhost:5611/?zone=z01BPK&mute=1" tools/steps/m6-z01BPK.mjs --size 1280x800 --out /tmp/m6-z01BPK
// Shortcut: after ~25 s of skating the clock (`__zone.game.bpk.swc.time`) is set to 3 s so the run does not take two minutes of wall time (the node tests play the whole 3600 ticks).
import { bpkBotStep } from '../lib/bpk-bot.mjs';
import { B } from '../../src/game/input.ts';

const KEYS = [[B.LEFT, 'ArrowLeft'], [B.RIGHT, 'ArrowRight'], [B.UP, 'ArrowUp'], [B.DOWN, 'ArrowDown'], [B.CTRL, 'Control'], [B.ALT, 'Alt'], [B.SHIFT, 'Shift'], [B.SPACE, 'Space']];

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m, [arch, m], { timeout: 300000 });

  // ------------------------------------------------------------------ the bot: real key presses for the mask the node bot decides
  let down = 0;
  const hold = async (mask) => {
    for (const [bit, k] of KEYS) {
      const want = (mask & bit) !== 0, have = (down & bit) !== 0;
      if (want && !have) await page.keyboard.down(k);
      else if (!want && have) await page.keyboard.up(k);
    }
    down = mask;
  };
  const shots = {};
  async function skate(ms, stopWhen) {
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < ms) {
      const d = await dbg();
      if (!d || d.result) break;
      if (stopWhen?.(d)) break;
      await hold(bpkBotStep(d.snap, {}));
      if (!shots.stunt && d.snap.state === 0x20 && d.snap.clip !== 0x20 && d.snap.progress > 40) { shots.stunt = true; await shot('4-stunt'); }
      if (!shots.crouch && d.snap.state === 0x2b) { shots.crouch = true; await shot('3-crouch'); }
      n++;
      await wait(12);
    }
    await hold(0);
    return n;
  }

  // ------------------------------------------------------------------ intro
  await ready('z01BPK', 1);
  let s = await dbg();
  expect('the zone game is running: clock 3600, walking in, PEPPER_CONTROL 1', s && s.time === 3600 && s.control === 1 && s.state === 0x16, JSON.stringify(s));
  const v0 = await page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), hi: __zone.sh.vars.get(0xc0), trophy: __zone.sh.vars.get(0x8d) }));
  log('start vars', JSON.stringify(v0));
  expect('sub-game 1 (z01BPK), story node 1', v0.sub === 1 && v0.node === 1, JSON.stringify(v0));
  await wait(800);
  await shot('1-intro');
  await key('Enter'); await wait(500);
  expect('no controls help: a button goes straight to play (mode 2)', (await mode()) === 2);
  await wait(1500);
  await shot('2-walk-in');
  await page.waitForFunction(() => window.__zone.game.debug().control === 4, null, { timeout: 30000 });
  await wait(500);
  s = await dbg();
  expect('Pepper got on the board: PEPPER_CONTROL 4, getting on (0x16)', s.control === 4 && (s.state === 0x16 || s.state === 0x2d), JSON.stringify(s));
  await shot('2b-mount');

  // ------------------------------------------------------------------ the bot skates
  const n = await skate(24000);
  s = await dbg();
  log('after the first phase', n, 'decisions', JSON.stringify({ score: s.score, pending: s.pending, time: s.time, state: s.state, clock: s.clock }));
  expect('the clock runs (HUD text)', /^\d:\d\d$/.test(s.clock), s.clock);
  expect('the bot scored with stunts', s.score > 300, JSON.stringify({ score: s.score, pending: s.pending }));
  await shot('5-play');
  // the rest of the time quickly
  await page.evaluate(() => { __zone.game.bpk.swc.time = 90; });
  await skate(15000, (d) => d.result);
  await wait(800);
  s = await dbg();
  expect('time up: banner (mode 4), result 1', (await mode()) === 4 && s.result === 1, JSON.stringify(s));
  log('final score', s.finalScore, 'medal', s.medal, 'hi-score', s.hiscore, 'trophy', s.trophy);
  expect('a medal and the hi-score = the score; HISCORE_BPK / TROPHY_BPK written', s.finalScore > 0 && s.hiscore === s.finalScore && s.trophy === s.medal && s.medal >= 1 && s.newHiscore === 1, JSON.stringify(s));
  await shot('6-banner');
  await wait(1200);
  await key('Enter'); await wait(800);
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('7-result-menu');
  await key('Enter'); await wait(3500);                  // Continue
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount >= 0 && window.__zone.info.archive !== 'z01BPK', null, { timeout: 180000 }).catch(() => {});
  const after = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: __zone?.sh.vars.get(0x58), complete: __zone?.sh.vars.get(0x53), mode: window.__zone?.machine.mode }));
  log('after Continue', JSON.stringify(after));
  expect('Continue leaves the zone: the story advanced to the next node', after.arch && after.arch !== 'z01BPK' && after.node > v0.node, JSON.stringify(after));
  await wait(1500); await shot('8-after-win');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z01BPK win run passed');
};
