// Restored content, feature 'battery': the patched lgi10 scene (DJ: "die radio werkt op batterijen", dj_throw). Muted, own Chromium:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=55&restored=1&mute=1&hold=1" tools/steps/restore-battery-dj.mjs --size 1280x800 --out /tmp/restore
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  for (let i = 0; i < 4; i++) { await S.skipCutscenes(); await wait(300); if (!(await S.state())?.cs) break; }
  const slot = await page.evaluate(() => { const z = window.__zone; return z.game.ictx.setup.cutscenes.find((c) => c.name?.toLowerCase() === 'lgi10')?.slot ?? null; });
  log('lgi10 slot', slot);
  const started = await page.evaluate((s) => window.__zone.game.ictx.startCutscene(s), slot);
  log('started', started);
  const seen = new Set(); let n = 0;
  for (let i = 0; i < 90; i++) {
    await wait(450);
    const st = await page.evaluate(() => { const z = window.__zone, c = z.game.ctx.cutscene, dj = z.world.records.find((r) => r.name === 'DJAB'); return { active: c.active(), log: c.log.slice(-3), say: c.inspect().commands.map((m, k) => ({ k, cmd: m.cmd, a: m.actor, st: m.state })).filter((m) => m.st === 1) }; });
    const key = JSON.stringify(st.say);
    if (i % 3 === 0 || !seen.has(key)) { await shot(`dj-${String(n++).padStart(2, '0')}`); seen.add(key); }
    log(i, JSON.stringify(st.say));
    if (!st.active && i > 3) break;
  }
  log('done');
};
