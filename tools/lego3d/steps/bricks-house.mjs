// Pepper's house (peppershouse01: windows, shutters and door of the class bricks) built with a close fixed camera, long capture (SHOTS shots GAP ms apart), headless + muted. Based on build.mjs.
//   PREFIX=new SHOTS=30 GAP=2000 node tools/browse.mjs "http://localhost:5745/?zone=z02LGI&node=3&mute=1&hd=0&lego3d=bricks" tools/lego3d/steps/bricks-house.mjs --profile /tmp/le2-x --size 800x600 --out DIR
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const prefix = process.env.PREFIX ?? 'build';
  await S.start();
  await S.skipCutscenes();
  await wait(500);
  const sw = () => page.evaluate(() => window.__zone.sh.vars.get(0x13b));
  const customers = ['PAPA', 'NICK', 'NUBB', 'LICK', 'VALS', 'TBOB', 'DJAB', 'ROBB', 'CLIK', 'REDG', 'DARR'];
  let fired = false;
  for (const c of customers) {
    for (let attempt = 0; attempt < 6 && !fired; attempt++) {
      await S.teleportNear(c, 4, attempt * 0.7);
      await wait(250);
      await S.tap('ShiftLeft', 100);
      for (let k = 0; k < 60; k++) {
        if ((await sw()) !== 0) { fired = true; break; }
        const st = await S.state();
        if (!st.cs) { await wait(300); if (!(await S.state()).cs) break; }
        await S.tap('ShiftLeft', 60); await wait(150);
      }
    }
    if (fired) break;
  }
  if (!fired) { log('no house switch'); return; }
  // a fixed camera on the house: wrapped around the game's render call (the cutscene camera is overridden for the shots only)
  const target = await page.evaluate(() => {
    const z = window.__zone, r = z.world.records.find((x) => x.name === 'PH01');
    const t = r ? [r.x, r.y, r.z] : [z.loaded.pepper.x, z.loaded.pepper.y, z.loaded.pepper.z];
    const gr = z.gr, w = z.world, o = gr.render.bind(gr);
    const eye = [t[0] + 14, t[1] + 9, t[2] + 14], look = [t[0], t[1] + 1.5, t[2]];
    gr.render = (...a) => { const c = w.camera.c; c[0] = eye[0]; c[1] = eye[1]; c[2] = eye[2]; c[3] = look[0]; c[4] = look[1]; c[5] = look[2]; w.camera.updateView(); return o(...a); };
    return t;
  });
  log('house at', JSON.stringify(target));
  for (let i = 0; i < Number(process.env.SHOTS ?? 30); i++) { await shot(`${prefix}-${String(i).padStart(2, "0")}`); await wait(Number(process.env.GAP ?? 2000)); }
};
