// z23DIP bot, real keys: plays the Dino island's part of the story. Node 47: arrival, walk the PATH route to waypoint 15 (the T-Rex camp), the StartCSM of LAND fires ADV07 and sets
// var 0x101 |= 2 (story node 47 done) -> hand-over to z27TRX. Node 50 (URL node=50): walk to the Pterodactyl, its box portal sets var 0x101 = 1 -> node 51 -> z13CAI.
//   BASE=http://localhost:5515 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5515/?zone=z23DIP&node=47&mute=1&hold=1&debug=1" tools/steps/m5-z23DIP-story.mjs --size 1280x800 --out /tmp/m5-z23DIP
import { dip } from './lib-z23DIP.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = dip({ page, wait, log, shot });
  await H.waitHub(); await wait(500); await H.start();
  const s0 = await H.pep();
  const node = s0.node;
  log('node', node, JSON.stringify(s0));
  await shot(`n${node}-arrival`);
  await H.freePepper();
  const route = node === 47 ? [1, 17, 18, 10, 13, 15] : [24, 19, [72, -44], [72, -58], 14];
  const gone = async () => (await H.zoneNow()).arch !== 'z23DIP';
  const r = await H.walkPath(route, { tol: 5, maxTicks: 900, carryOn: true, stop: async (p) => p.cs || (await gone()) });
  if (node === 50 && !(await gone())) {
    // the Pterodactyl's box portal (12 x 28 x 12 around PTER, key mask 0x10 = Ctrl, var 0x101 |= 1): the bot stands inside the box (node 14 is 6 units away) and presses Ctrl like a player
    const t = await page.evaluate(() => { const r = window.__zone.world.records.find((x) => x.name === 'PTER'); return [r.x, r.z]; });
    log('PTER at', JSON.stringify(t.map((v) => +v.toFixed(1))), 'Pepper', JSON.stringify(await H.pep()));
    await shot('n50-at-pter');
    for (let i = 0; i < 4 && !(await gone()) && (await H.vars([0x101]))[0x101] === 0; i++) { await H.tap('ControlLeft', 100); await wait(400); log('Ctrl tap', i, JSON.stringify(await H.vars([0x101, 0x58, 0x5e]))); }
  }
  log('walked', r, JSON.stringify(await H.pep()), JSON.stringify(await H.vars([0x101, 0x58, 0x5e, 0xba])));
  // a cutscene: look at it, skip it with Shift like a player
  for (let i = 0; i < 30 && !(await H.pep()).cs && !(await gone()); i++) await wait(300);
  if ((await H.pep()).cs) {
    // watch the script for a while (screenshots at 0.3 / 2 / 5 s of wall time), then skip it with Shift like a player
    for (const [k, ms] of [[0, 300], [1, 1700], [2, 3000]]) { await wait(ms); if (!(await H.pep()).cs) break; await shot(`n${node}-cutscene${k}`); log('cutscene running', JSON.stringify(await H.pep())); }
    await H.skipCutscenes();
  }
  await wait(800);
  log('after', JSON.stringify(await H.vars([0x101, 0x58, 0x5])), JSON.stringify(await H.zoneNow()));
  const left = await H.untilLeft('z23DIP', 40000);
  log('zone now', left, JSON.stringify(await H.vars([0x58])));
  await shot(`n${node}-end`);
};
