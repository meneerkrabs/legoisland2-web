// WP-PART-WIRE: how many particle sources a zone has started (the ones of the original's constructors): z28HAT 1, z22BIP 11, z18MMP 50, z15SSH 2, z09JST 8.
//   ZONE=z09JST sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z09JST&mute=1" tools/steps/m6-fx-count.mjs --size 800x600 --out /tmp/fxc
export default async ({ page, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1 && window.__particles, null, { timeout: 300000 });
  const r = await page.evaluate(() => ({ zone: __zone.info.archive, active: window.__particles.engine.sources.filter((s) => s.active).length }));
  log('FXCOUNT ' + JSON.stringify(r));
};
