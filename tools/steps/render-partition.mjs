// The partitioned meshes drawn through their cells (src/render/partition.ts), headless + muted:
//   ZONE=z15SSH sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5812/?zone=z15SSH&mute=1" tools/steps/render-partition.mjs --size 800x600 --out /tmp/part-shots
// Prints the number of partitioned meshes / triangles and a screenshot of the play view.
export default async ({ page, shot, wait, key, evaluate, log }) => {
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  await page.goto(page.url(), { waitUntil: 'load' });
  const zone = process.env.ZONE ?? 'z15SSH';
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__zone.machine.mode >= 1, null, { timeout: 600000 });
  for (let i = 0; i < 8 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await key('Enter'); await wait(700); }
  await wait(2500);
  log('mode', await evaluate(() => window.__zone.machine.mode));
  await shot(`part-${zone}`);
};
