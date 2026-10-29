// z18MMP mummy tomb in the headless browser (muted): intro, help, a scripted player (tools/lib/m6-z18MMP-bot.mjs, real key presses) that matches the 6 pairs, takes the key,
// runs the corridor, takes the page and escapes the boulder = WIN; then banner, result menu and the way on. With MMP_LOSS=1: no input, the clock is set to 5 s before the end = LOSS,
// banner, result menu (retry / abort).
//   sh tools/m4-snapshot-server.sh 5610
//   node tools/browse.mjs "http://localhost:5610/?zone=z18MMP&mute=1" tools/steps/m6-z18MMP.mjs --size 1280x800 --out /tmp/m6-z18MMP
import fs from 'node:fs';

export default async ({ page, shot, wait, log, key }) => {
  const LOSS = process.env.MMP_LOSS === '1';
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x14), trophy: __zone.sh.vars.get(0x48), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, [arch, m], { timeout: 300000 });

  // the bot's source goes into the page (without the node-only part)
  const src = fs.readFileSync(new URL('../lib/m6-z18MMP-bot.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const KEY'), src.indexOf('// node side')).replace(/^import .*$/gm, '').replace(/^export /gm, '');
  await page.evaluate((b) => { window.__mk = new Function(b + '\nreturn { KEY, snapshotFromZone, Z18Bot };'); }, body);

  await ready('z18MMP', 1);
  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  await wait(1200); await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('2-help');
  await key('Enter'); await wait(600);
  expect('play (mode 2)', (await mode()) === 2);
  await page.evaluate(() => {
    const { snapshotFromZone, Z18Bot } = window.__mk();
    window.__bot = { snap: snapshotFromZone, bot: new Z18Bot({ mode: window.__idle ? 'idle' : 'smart' }), held: new Set() };
  });
  await wait(1200); await shot('3-play-start');

  const held = new Set();
  const shots = {};
  const t0 = Date.now();
  let loops = 0, lastShot = 0;
  if (LOSS) {
    await wait(3000); await shot('4-loss-idle');
    await key('Escape'); await wait(600);
    const pm = await menu();
    expect('pause menu page 18', (await mode()) === 3 && pm.page === 18, JSON.stringify(pm) + ' mode ' + (await mode()));
    await shot('4b-pause');
    await key('Escape'); await wait(600);
    expect('back in play', (await mode()) === 2);
    await page.evaluate(() => { __zone.game.mmp.shared.seconds = 296; });
  }
  while (Date.now() - t0 < 600000) {
    const r = await page.evaluate(() => {
      const z = window.__zone, b = window.__bot;
      if (z.machine.mode !== 2) return { keys: null, mode: z.machine.mode };
      const s = b.snap(z);
      const keys = window.__loss ? [] : b.bot.step(s);
      return { keys, mode: 2, s: { tick: s.tick, sec: s.sec, vars: s.vars, p: s.p, key: s.key, door: s.door, rock: s.rock, over: s.over } };
    });
    if (r.keys === null || !r.s) break;
    if (!LOSS) {
      const want = new Set(r.keys);
      for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    }
    loops++;
    const s = r.s, tag = (n) => !shots[n] && (shots[n] = true);
    if (tag('open') && s.vars.open & 3 && s.p.state === 2) await shot('5-knock');
    if (!LOSS) {
      if (s.vars.matched >= 0x3 && !shots.m1) { shots.m1 = true; await shot('6-first-match'); }
      if (s.vars.matched >= 0xfff && !shots.m6) { shots.m6 = true; await shot('7-six-matched'); }
      if (s.vars.matched >= 0xfff && s.key.shown && !shots.k) { shots.k = true; await shot('8-key'); }
      if (s.vars.ready & 0x2000 && !shots.pg) { shots.pg = true; await shot('9-page'); }
      if (s.vars.ready & 0x4000 && !shots.ch) { shots.ch = true; await wait(2500); await shot('10-chase'); }
      if (s.p.z > 170 && !shots.cor) { shots.cor = true; await shot('9a-corridor'); }
    }
    if (Date.now() - lastShot > 20000) { lastShot = Date.now(); log('t', Math.round((Date.now() - t0) / 1000), 's tick', s.tick, 'sec', s.sec, 'p', s.p.x.toFixed(1), s.p.z.toFixed(1), 'vars', JSON.stringify(s.vars)); }
    await wait(10);
  }
  for (const k of held) await page.keyboard.up(k);
  await wait(800);
  const d = await dbg();
  log('final', JSON.stringify({ result: d.result, reason: d.reason, score: d.score, seconds: d.seconds }));
  expect('the game ended: banner (mode 4)', (await mode()) === 4, JSON.stringify(d));
  expect(LOSS ? 'a loss' : 'a win', LOSS ? d.result !== 0 && d.score === 0 : d.result !== 0 && d.score > 0, JSON.stringify(d));
  const v1 = await vars();
  log('vars after', JSON.stringify(v1));
  if (!LOSS) expect('HISCORE var 0x14 = score, TROPHY var 0x48 = medal', v1.hi === d.score && v1.trophy === (d.score > 8000 ? 3 : d.score > 6000 ? 2 : 1), JSON.stringify(v1));
  await wait(600); await shot(LOSS ? '11-banner-loss' : '11-banner-win');
  await wait(1500); await shot(LOSS ? '11b-banner-later' : '11b-banner-later');
  await key('Enter'); await wait(800);
  const m1 = await menu();
  expect(`result menu page ${LOSS ? 19 : 16}`, (await mode()) === 5 && m1.page === (LOSS ? 19 : 16), JSON.stringify(m1));
  await shot('12-result-menu');
  await key('Enter'); await wait(3500);                       // Continue / retry
  const after = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: __zone?.sh.vars.get(0x58), mode: window.__zone?.machine.mode, sec: __zone?.game?.mmp?.shared?.seconds }));
  log('after the menu', JSON.stringify(after));
  if (LOSS) expect('retry restarts the zone', after.arch === 'z18MMP' && after.sec < 5, JSON.stringify(after));
  else expect('Continue leaves the zone', after.arch && after.arch !== 'z18MMP', JSON.stringify(after));
  await wait(1500); await shot('13-after');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z18MMP run passed');
};
