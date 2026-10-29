// z20DSP emitter proof (headless, muted): the race starts, the car accelerates and turns hard (the skid / dust gates 0xfd / 0xfc), then drives into a cactus (cactuspop02, gate 0xfb) and takes a turbo brick (cactus x2, gate 0xfa).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?zone=z20DSP&mute=1&debug=1" tools/steps/wa-z20DSP-fx.mjs --size 1024x768 --out /tmp/wa-z20-fx
export default async ({ page, shot, wait, log, key }) => {
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const st = () => page.evaluate(() => ({ stats: window.__particles?.stats, live: window.__particles?.engine.drawList.length, v: [0xfa, 0xfb, 0xfc, 0xfd].map((i) => __zone.sh.vars.get(i)) }));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z20DSP' && window.__zone.machine.mode === 1, [], { timeout: 300000 });
  await wait(800); await key('Enter'); await wait(600); await key('Enter'); await wait(400);
  await page.waitForFunction(() => window.__zone.game.debug().state === 5, [], { timeout: 20000 });
  await page.keyboard.down('Alt');
  await wait(1500);
  log('straight', JSON.stringify(await st())); await shot('fx-1-straight');
  await page.keyboard.down('ArrowLeft');
  for (let i = 0; i < 6; i++) { await wait(300); const s = await st(); log('turn', i, JSON.stringify(s)); if (s.stats?.visible > 3) { await shot('fx-2-turn-' + i); } }
  await page.keyboard.up('ArrowLeft');
  // a turbo brick: the cactus emitters (gate 0xfa)
  await page.evaluate(() => { const d = __zone.game.dsp, w = __zone.world; const tb = w.records.find((r) => r.name === 'TURB'); if (tb) { const p = w.records[38]; p.x = tb.x; p.z = tb.z - 6; p.y = tb.y; d.speed.vx = d.speed.vy = d.speed.vz = 0; } });
  for (let i = 0; i < 6; i++) { await wait(250); const s = await st(); log('turbo', i, JSON.stringify(s)); if (s.v[0] === 1) { await shot('fx-3-turbo-' + i); break; } }
  await page.keyboard.up('Alt');
};
