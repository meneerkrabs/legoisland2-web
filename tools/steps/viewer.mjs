// Headless screenshots of the zone viewer.
//   node tools/browse.mjs "http://localhost:5499/?viewer=1&zone=z02LGI" tools/steps/viewer.mjs --size 1280x800
// Environment: VIEWS='name:x,y,z,yaw,pitch;name2:...' (camera views, radians), TAG=prefix of the screenshot names,
//              HIDE=0 keeps the UI visible, WAIT=ms extra settle time per view.
export default async ({ page, wait, shot, log, evaluate }) => {
  await page.waitForFunction(() => window.__viewer?.ready, null, { timeout: 120000 });
  await wait(1500);
  const views = (process.env.VIEWS ?? 'home').split(';').filter(Boolean);
  const tag = process.env.TAG ?? 'view';
  if (process.env.HIDE !== '0') await evaluate(() => window.__viewer.hide());
  for (const v of views) {
    const [name, cam] = v.split(':');
    if (cam) {
      const [x, y, z, yaw, pitch] = cam.split(',').map(Number);
      await evaluate(([x, y, z, yaw, pitch]) => window.__viewer.setCamera(x, y, z, yaw, pitch), [x, y, z, yaw, pitch]);
    } else await evaluate(() => window.__viewer.home());
    await wait(+(process.env.WAIT ?? 2500));
    log(name, await evaluate(() => window.__viewer.info));
    await shot(`${tag}-${name}`);
  }
};
