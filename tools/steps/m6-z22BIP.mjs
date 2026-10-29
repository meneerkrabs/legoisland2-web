// z22BIP in the headless browser (muted): intro and help screens, a scripted pilot that flies the whole course with REAL key presses (the pilot of tools/lib/bip-bot.mjs
// runs inside the page and reads the zone's objects), the banner, the result menu and the way back through the story. The game runs in real time (30 ticks a second),
// a full flight is about two minutes.
//   node tools/browse.mjs "http://localhost:5609/?zone=z22BIP&mute=1" tools/steps/m6-z22BIP.mjs --size 1280x800 --out /tmp/m6-z22BIP
// Environment: BIP_RUN=win (default) | loss (no input: the plane flies on its own course until the fuel is gone) | quick (only the screens and a few seconds of flight).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const botSrc = fs.readFileSync(path.join(here, '../lib/bip-bot.mjs'), 'utf8').replace(/^export /gm, '');
const RUN = process.env.BIP_RUN ?? 'win';

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x27), trophy: __zone.sh.vars.get(0xd6), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z22BIP' && window.__zone.game && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await page.evaluate((src) => { window.__bot = (new Function(src + '\nreturn botButtons;'))(); }, botSrc);
  const v0 = await vars();
  expect('entered the zone through the story (sub-game 18)', v0.sub === 18, JSON.stringify(v0));
  await wait(1000);
  await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('2-help');
  await key('Enter'); await wait(700);
  expect('play (mode 2)', (await mode()) === 2);
  await shot('3-start');

  // ---- the pilot: the buttons of the bot as held keys
  const KEYS = [[1, 'ArrowLeft'], [2, 'ArrowRight'], [4, 'ArrowUp'], [8, 'ArrowDown'], [0x80, 'Space']];
  const held = new Set();
  const apply = async (b) => {
    for (const [bit, code] of KEYS) {
      const want = (b & bit) !== 0;
      if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
      else if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
    }
  };
  const t0 = Date.now();
  const shots = {};
  let n = 0;
  if (RUN !== 'quick' || true) {
    while (Date.now() - t0 < (RUN === 'quick' ? 25000 : 400000)) {
      const r = await page.evaluate(() => { const g = __zone.game, S = g.setup; return { b: window.__bot(S, __zone.world, {}), d: g.debug(), mode: __zone.machine.mode }; });
      if (r.mode !== 2) break;
      if (RUN !== 'loss') await apply(r.b); else await apply(0);
      const d = r.d;
      if (!shots.f1 && d.mode === 2 && d.takeoff.count <= 0) { shots.f1 = 1; await shot('4-flying'); }
      if (!shots.s2 && d.stats.bananasFired > 20) { shots.s2 = 1; await shot('5-shooting'); }
      if (!shots.s3 && d.stats.monkeyHits > 0) { shots.s3 = 1; await shot('6-monkey-hit'); }
      if (!shots.s4 && d.mode === 16) { shots.s4 = 1; await shot('7-landing'); }
      if (++n % 120 === 0) log(`t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify({ mode: d.mode, progress: +d.progress.toFixed(3), fuel: Math.round(d.fuelPct), score: d.score, cans: d.stats.fuelCans, mk: d.stats.monkeyHits, crashes: d.stats.crashes }));
      await wait(25);
    }
  }
  if (RUN === 'quick') { await apply(0); }
  if (RUN === 'quick') { await shot('8-quick'); log('quick run done', JSON.stringify(await dbg())); return; }
  // ---- the banner
  let m = await mode();
  const end = await dbg();
  log('game over', JSON.stringify(end));
  for (let i = 0; i < 40 && m === 2; i++) { await wait(250); m = await mode(); }
  expect('the end banner (mode 4)', m === 4, 'mode ' + m);
  await apply(0);          // (the keys of the pilot stay down until the banner was seen: the release is an input edge too)
  await wait(800);
  await shot('9-banner');
  const after = await dbg();
  if (RUN === 'loss') expect('lost: out of fuel, result 1', after.result === 1, JSON.stringify(after));
  else expect('won: landed, result >= 3', after.result >= 3 && after.landed, JSON.stringify(after));
  if (RUN === 'loss') expect('lost: score and trophy untouched', (await vars()).hi === 0 && (await vars()).trophy === 0, JSON.stringify(await vars()));
  else expect('the hi-score and the trophy were written', (await vars()).hi > 0 && (await vars()).trophy >= 1, JSON.stringify(await vars()));
  await key('Enter'); await wait(800);
  expect('the result menu (mode 5)', (await mode()) === 5);
  const mn = await menu();
  expect(RUN === 'loss' ? 'page 19 (retry / abort)' : 'page 16 (continue / retry)', mn.page === (RUN === 'loss' ? 19 : 16), JSON.stringify(mn));
  await shot('10-result-menu');
  await key('Enter');                       // the first item: continue (win) / retry (loss)
  await wait(2500);
  const after2 = await page.evaluate(() => ({ zone: window.__zone?.info?.archive, node: __zone?.sh?.vars?.get(0x58) }));
  log('after the menu', JSON.stringify(after2), JSON.stringify(await vars()));
  if (RUN === 'loss') expect('retry restarts the zone', after2.zone === 'z22BIP');
  else expect('continue leaves the zone (back to the story)', after2.zone !== 'z22BIP', JSON.stringify(after2));
  await shot('11-after');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'all checks passed');
};
