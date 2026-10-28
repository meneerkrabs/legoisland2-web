// Headless screenshots of the 2D layer test page (src/ui/test.html). Dev server on 5499 (or `npx vite --port 5611 --strictPort`):
//   node tools/browse.mjs "http://localhost:5499/src/ui/test.html" tools/steps/ui-test.mjs --size 1280x800
// SCENES=text,sprites,panel,fade,loading  TAG=ui   TILE=n (panel start tile)
export default async ({ page, wait, shot, log, evaluate }) => {
  await page.waitForFunction(() => window.__ui?.ready, null, { timeout: 120000 });
  const scenes = (process.env.SCENES ?? 'text,sprites,panel,fade,loading').split(',');
  const tag = process.env.TAG ?? 'ui';
  for (const s of scenes) {
    await evaluate((n) => window.__ui.scene(n), s);
    await wait(300);
    log(s, await evaluate(() => document.getElementById('status').textContent));
    await shot(`${tag}-${s}`);
  }
};
