// WP-SAVE browser check: the load page of the front end shows the .lgo import / export hint (E / I keys on the highlighted slot).
//   sh tools/m5-botslot.sh env NOPRESS=1 node tools/browse.mjs "http://localhost:5599/?start=frontend&mute=1" tools/steps/m8-loadpage.mjs --size 640x480
export default async ({ page, wait, evaluate, shot, key }) => {
  await page.waitForFunction(() => window.__shell && window.__feWorld, null, { timeout: 240000 });
  await wait(1500);
  // the front end's main menu: item 2 is "load game" (the page table of the original); open the page like the menu's Enter does
  const open = await evaluate(() => { const m = window.__shell.menu; m.open(2, 0x80, false); return m.engine.page; });
  console.log('menu page', open);
  await wait(800);
  await shot('m8-loadpage');
  // E on the highlighted slot with a slot that exists: the file download is a browser action; the shell's exportSlot gives the bytes
  const have = await evaluate(() => window.__shell.slots.map((s) => !!s));
  console.log('slots with a file', JSON.stringify(have));
};
