// Headless walk around Pepper's house (z03PPH): run into the walls and furniture, slide along them, jumping is disabled here.
//   node tools/browse.mjs "http://localhost:5499/?play=1&zone=z03PPH&mute=1" tools/steps/game-house.mjs --size 1280x800 --out /tmp/le2-shots
export default async ({ page, shot, wait, evaluate }) => {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  await wait(800);
  const st = async (tag) => console.log(tag, JSON.stringify(await evaluate(() => { const s = window.__game.state(); return { pos: s.pos.map((v) => +v.toFixed(2)), state: s.walkState.toString(16), clip: s.clip, speed: +s.speed.toFixed(2), surface: s.lastSurface }; })));
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await wait(ms); for (const k of keys) await page.keyboard.up(k); await wait(250); };
  await st('start'); await shot('game-house-start');
  await hold(['ArrowUp'], 1200); await st('against the north wall / shelves'); await shot('game-house-wall');
  await hold(['ArrowLeft'], 1500); await st('left'); await shot('game-house-left');
  await hold(['ArrowDown'], 1500); await st('south'); await shot('game-house-south');
  await hold(['ArrowRight'], 2500); await st('east'); await shot('game-house-east');
  await hold(['ArrowUp', 'ArrowLeft'], 2500); await st('diagonal into the corner'); await shot('game-house-corner');
  await page.keyboard.press('Alt', { delay: 70 }); await wait(600); await st('Alt: no jump in the house');
};
