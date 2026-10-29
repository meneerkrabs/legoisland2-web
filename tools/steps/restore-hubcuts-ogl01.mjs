// Restored content 'hubcuts' R-A3 (z40OGL node 66, script ogl01): the fourth sleeper cit4 falls asleep between cit5 and cit2. Plays the arrival cutscene (nobody skips it), logs the subtitles / CIT4's clip and takes screenshots.
//   (sh tools/m4-snapshot-server.sh 5731)  BASE=http://localhost:5731 [RESTORED=0] sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z40OGL&node=66&mute=1&hold=1&debug=1&restored=1" tools/steps/restore-hubcuts-ogl01.mjs --size 800x600 --out /tmp/restore-hubcuts
import { hub } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = hub({ page, wait, log, shot }, 'z40OGL');
  await H.waitHub(); await wait(500);
  await H.start();
  const snap = () => page.evaluate(() => { const z = window.__zone, c4 = z.world.records.find((r) => r.name === 'CIT4'), c5 = z.world.records.find((r) => r.name === 'CIT5');
    return { t: z.world.tickCount, cs: z.ctx.cutscene.active(), sub: z.ctx.subtitle?.()?.text ?? null, cit4: c4 ? { clip: c4.anim?.clip, frame: Math.round(c4.anim?.frame ?? 0), en: c4.enabled } : null, cit5: c5 ? { clip: c5.anim?.clip } : null }; });
  let last = '', n = 0, shots = 0, lastShot = 0;
  const clips = [];
  for (let i = 0; i < 400; i++) {
    const s = await snap();
    const key = JSON.stringify([s.sub, s.cit4?.clip, s.cit5?.clip]);
    if (key !== last) { last = key; log('t', s.t, 'sub', JSON.stringify(s.sub), 'cit4 clip', s.cit4?.clip, 'cit5 clip', s.cit5?.clip); if (s.cit4 && !clips.includes(s.cit4.clip)) clips.push(s.cit4.clip); }
    if (s.cs && s.t - lastShot > 20 && shots < 14) { lastShot = s.t; await shot(`ogl01-${String(++shots).padStart(2, '0')}`); }
    if (!s.cs && ++n > 6) break;
    await wait(250);
  }
  log('CIT4-CLIPS', JSON.stringify(clips));
};
