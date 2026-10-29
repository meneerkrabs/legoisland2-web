// Restored content 'cues': the flowers' growing / shrinking sounds (island, era 0 node 2: STEV's garden FLR1 / FLR2). Logs the sound ids / files that reach the 3D voices (hooks on GameAudio.sfx.play3D).
// Option ON:  ids 0 (GrowBig) and 2 (GrowSmll) reach the engine, files GrowBig / GrowSmll. Option OFF (no restored=1): the same ids reach it with Silence.wav.
//   (sh tools/m4-snapshot-server.sh 5731)  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=2&restored=1&hold=1" tools/steps/restore-cues-flowers.mjs --size 800x600 --out /tmp/restore-cues
// (no mute=1 here: the sound log needs the audio engine; the headless browser itself is launched with --mute-audio, nothing is audible)
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await page.waitForFunction(() => window.__shell?.audio?.ga, null, { timeout: 60000 });
  await page.evaluate(() => {
    const ga = window.__shell.audio.ga, orig = ga.sfx.play3D.bind(ga.sfx);
    window.__plays = [];
    ga.sfx.play3D = (s, p) => { if (s.entry.id === 0 || s.entry.id === 2) window.__plays.push([s.entry.id, s.entry.path.split('\\').pop(), Math.round(p.x), Math.round(p.z)]); return orig(s, p); };
  });
  const flr = await S.rec('FLR1');
  log('FLR1', JSON.stringify(flr), 'FLR2', JSON.stringify(await S.rec('FLR2')));
  await S.teleportNear('FLR1', 12, 0.5);
  await S.setVar(0x7c, 0x30);        // STEV's MOVE bits 0x20 / 0x10: the gates of FLR1 / FLR2
  await wait(1500);
  await shot('flowers-1');
  await S.untilTicks(async () => false, 300, 40);
  const plays = await page.evaluate(() => window.__plays);
  const byId = {};
  for (const [id, file] of plays) { byId[`${id} ${file}`] = (byId[`${id} ${file}`] ?? 0) + 1; }
  log('FLOWER-PLAYS', JSON.stringify(byId));
  const st = await page.evaluate(() => { const a = window.__shell.audio; return { s0: a.slot('3d', 0)?.entry.path ?? null, s2: a.slot('3d', 2)?.entry.path ?? null, lazy: a.stats.lazyLoads }; });
  log('SLOTS', JSON.stringify(st));
};
