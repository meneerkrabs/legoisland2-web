// Restored content, feature 'lgi11': the Brickster-kidnaps scene LGI09 (era 3, node 53: PIZB fires at once) with the restored line LECSBK24 "Pepper, de rattenvanger van Pizza." Headless + muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=53&restored=1&mute=1&hold=1" tools/steps/restore-lgi09.mjs --size 1280x800 --out /tmp/restore-lgi09
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.setVar(0x54, 4);
  const sub = () => page.evaluate(() => { const r = window.__zone.game.ctx.cutscene.runner; return { id: r.subtitle?.id ?? null, text: r.subtitle?.text ?? null, active: r.active(), log: r.log.slice() }; });
  const seen = []; let last = null, started = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const c = await sub();
    if (c.active) started = true;
    if (started && !c.active) break;
    if (c.id && c.id !== last) { last = c.id; seen.push(c.id); log('say', c.id, c.text); if (c.id === 'LECSBK23' || c.id === 'LECSBK24') { await wait(500); await shot(`lgi09-${c.id}`); } }
    else await wait(100);
  }
  const restored = /restored=1/.test(page.url());
  const i23 = seen.indexOf('LECSBK23');
  expect('LGI09 ran', seen.length >= 20, `${seen.length} lines`);
  if (restored) expect('LECSBK24 follows LECSBK23', i23 >= 0 && seen[i23 + 1] === 'LECSBK24', seen.slice(i23 - 1, i23 + 3).join());
  else expect('original: no LECSBK24', !seen.includes('LECSBK24'));
  await wait(1500);
  const s = await S.state();
  expect('S277 = 4 afterwards', s.s277 === 4, JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
