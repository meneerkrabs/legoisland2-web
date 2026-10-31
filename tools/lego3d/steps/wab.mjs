// Whack-A-Bot (z05WAB) before / after the pilot textures: intro, help screen, play (headless, muted). Run:
//   PREFIX=wab-new node tools/browse.mjs "http://localhost:5731/?zone=z05WAB&mute=1&hd=0[&mods=off]" tools/lego3d/steps/wab.mjs --profile /tmp/le2-lego3d --size 800x600 --out DIR
export default async ({ page, shot, wait, key, log }) => {
  const prefix = process.env.PREFIX ?? 'wab';
  const mode = (m, t = 120000) => page.waitForFunction((md) => window.__zone && window.__zone.info.archive === 'z05WAB' && window.__zone.machine.mode === md, m, { timeout: t });
  await mode(1);
  await wait(800);
  await shot(`${prefix}-1-intro`);
  await key('Enter'); await mode(9); await wait(400);
  await shot(`${prefix}-2-help`);
  await key('Enter'); await mode(2); await wait(2500);
  await shot(`${prefix}-3-play`);
  await wait(4000);
  await shot(`${prefix}-4-play`);
  log('done');
};
