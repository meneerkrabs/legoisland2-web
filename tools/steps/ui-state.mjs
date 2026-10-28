// GL state restore check + other canvas shapes of the 2D layer test page.
//   node tools/browse.mjs "http://localhost:5499/src/ui/test.html?scene=text" tools/steps/ui-state.mjs --size 1280x800
export default async ({ page, wait, shot, log, evaluate }) => {
  await page.waitForFunction(() => window.__ui?.ready, null, { timeout: 120000 });
  log('state changed by flush():', JSON.stringify(await evaluate(() => window.__ui.checkState())));
  // tall canvas (pillar vs letter box) and the stretch mode
  await page.setViewportSize({ width: 600, height: 700 });
  await evaluate(() => { const c = document.getElementById('c'); c.width = 600; c.height = 700; window.__ui.scene('fade'); });
  await wait(200); await shot('ui-tall');
  await evaluate(() => { window.__ui.ui.fit = 'stretch'; const c = document.getElementById('c'); c.width = 900; c.height = 400; window.__ui.scene('text'); });
  await wait(200); await shot('ui-stretch');
};
