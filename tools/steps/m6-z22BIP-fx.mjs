// z22BIP particles (WP-PART-WIRE): the same pilot flies; screenshots when the Spray01 waterfalls / the Leaffall burst are on screen. (copy of m6-z22BIP.mjs up to the pilot) z22BIP in the headless browser (muted): intro and help screens, a scripted pilot that flies the whole course with REAL key presses (the pilot of tools/lib/bip-bot.mjs
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
  let n = 0, spray = 0, leaf = 0;
  while (Date.now() - t0 < 200000 && spray < 3) {
    const r = await page.evaluate(() => { const g = __zone.game, S = g.setup; return { b: window.__bot(S, __zone.world, {}), d: g.debug(), mode: __zone.machine.mode, st: window.__particles.stats }; });
    if (r.mode !== 2) break;
    await apply(r.b);
    if (!leaf && r.d.mode === 2 && r.d.takeoff.count <= 0) { leaf = 1; await page.evaluate(() => __zone.game.setup.run.onLeaf()); await wait(300); await shot('leaf'); log('leaf', JSON.stringify(await page.evaluate(() => window.__particles.stats))); }
    if (r.st.visible > 12) { spray++; await shot('spray' + spray); log('particles on screen', JSON.stringify({ st: r.st, progress: +r.d.progress.toFixed(3) })); await wait(1500); }
    if (++n % 120 === 0) log(`t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify({ progress: +r.d.progress.toFixed(3), st: r.st }));
    await wait(25);
  }
  await apply(0);
};
