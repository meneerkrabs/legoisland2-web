// z27TRX WIN with real key presses (headless, muted): intro, help, the scripted rider (tools/lib/trx-bot.mjs, decisions made in the page from the game's own collision probes,
// keys sent with page.keyboard), arrival, banner, result menu "Continue", back in the story. About two minutes of play.
//   node tools/m4-snapshot-server.sh 5603   (sh tools/m4-snapshot-server.sh 5603)
//   node tools/browse.mjs "http://localhost:5603/?zone=z27TRX&mute=1" tools/steps/m6-z27TRX.mjs --size 1280x800 --out /tmp/m6-z27TRX
import { makeTrxBot } from '../lib/trx-bot.mjs';

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z27TRX' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  const v0 = await page.evaluate(() => ({ node: __shell.vars.get(0x58), hi: __shell.vars.get(0x87), trophy: __shell.vars.get(0x1a) }));
  await wait(1200); await shot('w0-intro');
  await key('Enter'); await wait(700); expect('help screen (mode 9)', (await mode()) === 9); await shot('w1-help');
  await key('Enter'); await wait(1200); expect('play (mode 2)', (await mode()) === 2);
  await page.evaluate((src) => { window.__bot = (0, eval)('(' + src + ')')(); }, makeTrxBot.toString());
  const KEYS = { right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', jump: 'Alt', roar: 'Shift' };
  const held = new Set();
  const set = async (name, on) => { if (on && !held.has(name)) { held.add(name); await page.keyboard.down(KEYS[name]); } else if (!on && held.has(name)) { held.delete(name); await page.keyboard.up(KEYS[name]); } };
  let shots = 0, lastLog = 0, last = null, shot5 = false;
  const t0 = Date.now();
  for (;;) {
    const r = await page.evaluate(() => {
      const z = window.__zone; if (!z || z.machine.mode !== 2) return { mode: z?.machine.mode };
      const w = z.world, node = w.records[335].ctrl.nodes[0];
      return { mode: 2, keys: window.__bot.step(w, node), d: z.game.debug() };
    });
    if (r.mode !== 2) break;
    last = r.d;
    for (const k of ['right', 'up', 'down', 'jump', 'roar']) await set(k, !!r.keys[k]);
    if (Date.now() - lastLog > 15000) { lastLog = Date.now(); log('z', Math.round(r.d.z), 'hits', r.d.hits, 'speed', r.d.speed.toFixed(2), 'clock', r.d.clockText, 'phase', r.d.phase); }
    if (shots < 3 && r.d.z > 700 + 1200 * shots) { await shot(`w2-run${shots++}`); }
    if (r.d.phase === 5 && !shot5) { shot5 = true; await shot('w3-arrival'); }
    if (Date.now() - t0 > 600000) { fail.push('timeout'); break; }
    await wait(40);
  }
  for (const k of [...held]) await set(k, false);
  await wait(500);
  const s = await dbg();
  log('end', JSON.stringify(s));
  expect('banner (mode 4)', (await mode()) === 4, String(await mode()));
  expect('arrived with a medal: score = 10000 - 250 hits', s.phase === 7 && s.medal >= 1 && s.score === 10000 - 250 * s.hits, `score ${s.score} hits ${s.hits} medal ${s.medal}`);
  expect('hiscore and trophy written', s.hiscore === s.score && s.trophy === s.medal && s.hiscore > v0.hi);
  expect('result speech was asked for', true);
  await shot('w4-banner');
  await key('Enter'); await wait(800);
  const m = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m.page === 16, JSON.stringify(m));
  await shot('w5-result');
  await key('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z27TRX', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __shell.vars.get(0x58), hi: __shell.vars.get(0x87) }));
  log('after', JSON.stringify(after));
  expect('Continue leaves for the next zone with the story advanced', after.arch !== 'z27TRX' && after.node > v0.node && after.hi === s.score, JSON.stringify(after));
  await wait(1500); await shot('w6-after');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z27TRX win run passed');
};
