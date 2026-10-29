// z28HAT: the fireball's burp.par emitter in the headless browser (muted): the balloon is put far from Bronty until he burps, screenshots while the fireball flies.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT-fire.mjs --size 1024x640 --out /tmp/m6-z28HAT-fire
export default async ({ page, shot, wait, log, key }) => {
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, cutscene: z.game.debug().cutscene, fb: z.game.debug().fireball } : null; });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z28HAT' && window.__zone.game && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  for (let i = 0; i < 160 && (await dbg()).cutscene; i++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); }
  await wait(600);
  await key('Enter'); await wait(500); await key('Enter'); await wait(900);
  await page.evaluate(() => { const S = __zone.world.ext.get('z28HAT'); const b = S.recs.hotb; b.x = -100; b.z = 100; b.savePrev(); S.mom = [0, 0, 0]; });
  let shots = 0, seen = 0;
  for (let i = 0; i < 1500 && shots < 3; i++) {
    const s = await page.evaluate(() => ({ act: __zone.world.records.find((r) => r.name === 'FRB1').ctrl.nodes[0].active, st: window.__particles.stats, live: window.__particles.engine.drawList.length }));
    if (s.act || s.st.visible > 0) { seen++; if (s.st.polygons > 40) { await shot('fire' + shots); log('visible', JSON.stringify(s)); shots++; await wait(200); } }
    await wait(80);
  }
  log('done', shots, 'ticks with fireball/particles', seen);
};
