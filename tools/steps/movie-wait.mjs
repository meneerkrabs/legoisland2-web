// Waits for the file list page (the movie has ended) and prints the movie statistics (for ?throttle= stall tests).
export default async ({ page, log, evaluate, shot }) => {
  const t0 = Date.now();
  await page.waitForSelector('#le2-summary', { timeout: 300000 });
  log(`done after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(JSON.stringify(await evaluate(() => window.__le2Movies)));
  await shot('wait-done');
};
