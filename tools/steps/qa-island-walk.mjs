// Island walking sounds at runtime (use through tools/steps/qa-audio-wrap.mjs: INNER=tools/steps/qa-island-walk.mjs, URL ?zone=z02LGI&hold=1): after the intro cutscene Pepper walks 6 s, runs (hold Shift)
// 4 s, jumps, and is put into the sea beyond the +-400 square and swims 5 s; the wrapper prints which sounds started (ids, counts, first start) and the SoundEngine counters.
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = island(h);
  await S.start();
  // leave the first script (the era intro runs by itself): Shift taps until nothing runs
  await S.skipCutscenes(200);
  await wait(1500);
  const sound = () => page.evaluate(() => { const a = window.__shell.audio; return { d2: a.ga.sfx.activeVoices.d2, d3: a.ga.sfx.activeVoices.d3, st: a.ga.sfx.stats }; });
  log('WALK start ' + JSON.stringify(await S.state()));
  await S.hold('ArrowUp', 6000);
  log('WALK after 6 s ' + JSON.stringify(await S.state()) + ' ' + JSON.stringify(await sound()));
  await page.keyboard.down('ShiftLeft'); await S.hold('ArrowUp', 4000); await page.keyboard.up('ShiftLeft');
  log('RUN after 4 s ' + JSON.stringify(await S.state()));
  await S.tap('ArrowLeft', 300); await S.hold('ArrowUp', 1500);
  // into the sea (the water outside the +-400 square): the swim node, the stroke sound, the sea loop at Pepper
  await page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; p.x = 520; p.z = 0; p.y = 20; p.ry = Math.atan2(-520, 0); p.rebuildYaw(); p.savePrev(); z.world.camera.init(p); });
  await wait(1500);
  log('SEA ' + JSON.stringify(await S.state()));
  await S.hold('ArrowUp', 5000);
  log('SWIM after 5 s ' + JSON.stringify(await S.state()) + ' ' + JSON.stringify(await sound()));
};
