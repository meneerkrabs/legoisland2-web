// Particle proof on the island (WP-ISLAND, gaps S7 / S10): the island's own emitters (started by the nodes / the set-up like the original's FUN_00442960 calls) next to Pepper,
// headless + muted: the locomotive's trainsmoke01 (always on), the rocket01 pair (switch 0x110) and bill01 (0x109) of the era functions, the boat plume while parked (off):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=2&mute=1&hold=1" tools/steps/particles-island.mjs --size 1024x768 --out /tmp/par-shots
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, shot, wait, log, evaluate } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  const info = () => evaluate(() => {
    const fx = window.__zone.game.ictx.fx;
    const e = fx.engine;
    return { has: !!fx, sources: e.sources.filter((s) => s.active).map((s) => s.script?.name ?? '?'), ticks: fx.ticks, stats: fx.stats, list: e.drawList.length };
  });
  log('fx', JSON.stringify(await info()));
  // the locomotive (record 158) smokes all the time
  await S.teleportNear('TRNL', 22, 0.6); await wait(2500); await shot('par-island-train');
  log('train', JSON.stringify(await info()));
  // the rockets at the feet of the flying figure BRIK: switch 0x110 = 0x1004 (bit 4 = record 0x11 slot 0 / 1 of the era-0 function)
  await S.teleportNear('BRIK', 14, 0.3);
  await evaluate(() => { const z = window.__zone, ic = z.game.ictx; z.sh.vars.set(ic.switchVar('SWITCH_LGI_CSM_FX_SWITCH02'), 0x1004); });
  await wait(2500); await shot('par-island-rocket');
  log('rocket', JSON.stringify(await info()));
  const errs = await evaluate(() => window.__errors ?? []);
  log('errors', JSON.stringify(errs));
};
