// z18MMP particles in the headless browser (muted): torch flames (mmpfire), a coffin opened by hand (symtwin on the symbol), the key / page twinkle.
//   sh tools/m4-snapshot-server.sh 5513; sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z18MMP&mute=1" tools/steps/m6-z18MMP-fx.mjs --size 1024x768 --out /tmp/m6-z18MMP-fx
export default async ({ page, shot, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z18MMP' && window.__zone.machine.mode === 1 && window.__particles, null, { timeout: 300000 });
  await key('Enter'); await wait(600); await key('Enter'); await wait(1200);
  const st = () => page.evaluate(() => ({ stats: window.__particles.stats, live: window.__particles.engine.drawList.length }));
  // Pepper walks the entrance corridor: put him next to the first torch
  const near = (rec, dz) => page.evaluate(([r, dz]) => { const w = __zone.world, t = w.records[r], p = w.records[121]; p.x = t.x; p.z = t.z + dz; p.y = t.y; p.savePrev(); }, [rec, dz]);
  await near(61, -8); await wait(900); await shot('torch'); log('torch', JSON.stringify(await st()));
  // coffin room: Pepper in front of the coffins, coffin 0 knocked open by the variable (what Pepper's knock does)
  await page.evaluate(() => { const w = __zone.world, p = w.records[121]; p.x = 0; p.z = 60; p.y = 9; p.savePrev(); });
  await wait(600);
  await page.evaluate(() => { __zone.world.vars.or(0xfe, 1); });
  await wait(700); await shot('coffin-open'); log('coffin', JSON.stringify(await st()));
  await wait(1500); await shot('coffin-open2'); log('coffin2', JSON.stringify(await st()));
};
