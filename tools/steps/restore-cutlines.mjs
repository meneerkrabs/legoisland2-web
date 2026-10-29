// Restored content, feature 'cutlines': the Valerie scene (lgici25) with the restored line LEINVS04 ("Erop af."), started directly. Headless + muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=2&restored=1&mute=1" tools/steps/restore-cutlines.mjs --size 1280x800 --out /tmp/restore-cutlines
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  const slot = await page.evaluate(() => { const r = window.__zone.game.ctx.cutscene.runner; return r.slots.findIndex((s) => s && String(s.name).toLowerCase() === 'lgici25'); });
  log('slot of lgici25', slot);
  expect('lgici25 is declared', slot >= 0);
  // Pepper next to Valerie, then start the script
  await S.teleportNear('VALS', 5, 0.5); await wait(300);
  await page.evaluate((s) => window.__zone.game.ctx.cutscene.start(s), slot);
  const sub = () => page.evaluate(() => { const r = window.__zone.game.ctx.cutscene.runner; return { id: r.subtitle?.id ?? null, text: r.subtitle?.text ?? null, active: r.active() }; });
  const seen = []; let last = null, n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const c = await sub();
    if (!c.active && n > 0) break;
    if (c.id && c.id !== last) { last = c.id; seen.push(c.id); log('say', c.id, c.text); await wait(400); await shot(`valerie-${n++}-${c.id}`); } else await wait(120);
  }
  expect('the scene says LEINVS01-04 (04 restored)', seen.join() === 'LEINVS01,LEINVS02,LEINVS03,LEINVS04', seen.join());
  await wait(500); await shot('valerie-end');
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
