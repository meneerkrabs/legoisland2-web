// Restored content 'popups': WAB1 "Gemept" / WAB2 "Mis" / WAB3 "Oh-Nee!" in Whack-A-Bot (z05WAB). Plays with real keys until a bot is hit, a swing misses (and, if one shows up, the Infomaniac is hit); screenshots the popups.
//   (sh tools/m4-snapshot-server.sh 5731)  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z05WAB&mute=1&restored=1" tools/steps/restore-popups-wab.mjs --size 800x600 --out /tmp/restore-popups
export default async ({ page, shot, wait, log, key, evaluate }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  await page.goto(page.url(), { waitUntil: 'load' });
  const modeIs = (m, t = 60000) => page.waitForFunction((md) => window.__zone && window.__zone.machine.mode === md, m, { timeout: t });
  const popup = () => evaluate(async () => { const m = await import('/src/restore/popup.ts'); return m.popupText(window.__zone.hud); });
  const dbg = () => evaluate(() => window.__zone.game.debug());
  const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z05WAB' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(700); await key('Enter'); await modeIs(9); await wait(300); await key('Enter'); await modeIs(2); await wait(300);
  const seen = {};
  const press = async (k) => { await page.keyboard.down(k); await wait(70); await page.keyboard.up(k); };
  let n = 0;
  for (let t0 = Date.now(); Date.now() - t0 < 240000 && !(seen.WAB1 && seen.WAB2 && seen.WAB3);) {
    const g = await dbg();
    if (g.over) break;
    // a bot that is up and not whacked: hit it (the Infomaniac only when a WAB3 is still wanted); else, when WAB2 is still wanted and nothing is up, swing at an empty hole
    let hole = -1;
    for (let i = 0; i < 4; i++) if ((g.state[i] === 2 || g.state[i] === 1) && !g.whacked[i] && g.busy === 0 && g.stun === 0 && g.clip === 1 && (!g.isInfo[i] || !seen.WAB3)) { hole = i; break; }
    if (hole < 0 && !seen.WAB2 && g.busy === 0 && g.stun === 0 && g.clip === 1 && g.state.every((s) => s === 0)) hole = 0;
    if (hole >= 0) {
      await press(KEYS[hole]);
      for (let k = 0; k < 20; k++) {
        await wait(40);
        const p = await popup();
        if (p) { const tag = p === 'Gemept' ? 'WAB1' : p === 'Mis' ? 'WAB2' : p === 'Oh-Nee!' ? 'WAB3' : p; if (!seen[tag]) { seen[tag] = true; log('POPUP', tag, p, 'after press', ++n); await shot(`wab-popup-${tag}`); } break; }
      }
      await wait(250);
    } else await wait(30);
  }
  log('WAB-POPUPS', JSON.stringify(seen));
};
