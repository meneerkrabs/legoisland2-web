// Restored content 'popups' / 'cues' in z22BIP: BIP15 (low fuel), BIP10 (out of fuel) as HUD popups, BIP10 + BIP11 (failed) / BIP14 (medal) on the end banner; melon_fly 0x7e / rock_hit 0x2e5 sounds.
//   BIP_RUN=loss (no input: out of fuel):  (mute=1)  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z22BIP&mute=1&restored=1" tools/steps/restore-popups-bip.mjs --size 800x600 --out /tmp/restore-popups-bip
//   BIP_RUN=win (the pilot of tools/lib/bip-bot.mjs flies the course; NO mute=1: the sound log needs the audio engine, the headless browser itself is muted): URL without &mute=1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const botSrc = fs.readFileSync(path.join(here, '../lib/bip-bot.mjs'), 'utf8').replace(/^export /gm, '');
const RUN = process.env.BIP_RUN ?? 'loss';
export default async ({ page, shot, wait, log, key }) => {
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const popup = () => page.evaluate(async () => { const m = await import('/src/restore/popup.ts'); return m.popupText(window.__zone.hud); });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z22BIP' && window.__zone.game && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await page.evaluate((src) => { window.__bot = (new Function(src + '\nreturn botButtons;'))(); }, botSrc);
  await page.evaluate(() => {
    const ga = window.__shell?.audio?.ga; window.__plays = [];
    if (ga) { const orig = ga.sfx.play3D.bind(ga.sfx); ga.sfx.play3D = (s, p) => { if (s.entry.id === 0x7e || s.entry.id === 0x2e5) window.__plays.push(s.entry.id); return orig(s, p); }; }
  });
  await wait(800); await key('Enter'); await wait(700); await key('Enter'); await wait(700);
  const KEYS = [[1, 'ArrowLeft'], [2, 'ArrowRight'], [4, 'ArrowUp'], [8, 'ArrowDown'], [0x80, 'Space']];
  const held = new Set();
  const apply = async (b) => { for (const [bit, code] of KEYS) { const want = (b & bit) !== 0; if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); } else if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); } } };
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 400000) {
    const r = await page.evaluate(() => ({ b: window.__bot(__zone.game.setup, __zone.world, {}), mode: __zone.machine.mode }));
    if (r.mode !== 2) break;
    await apply(RUN === 'loss' ? 0 : r.b);
    const p = await popup();
    if (p && !seen.has(p)) { seen.add(p); log('POPUP', JSON.stringify(p)); await shot(`bip-popup-${seen.size}`); }
    await wait(25);
  }
  await apply(0);
  for (let i = 0; i < 40 && (await mode()) === 2; i++) await wait(250);
  await wait(900);
  log('mode', await mode(), 'result', await page.evaluate(() => window.__zone.game.debug().result));
  await shot('bip-banner');
  log('BIP-POPUPS', JSON.stringify([...seen]), 'plays', JSON.stringify(await page.evaluate(() => window.__plays)));
};
