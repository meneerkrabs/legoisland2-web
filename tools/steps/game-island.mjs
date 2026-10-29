// Headless walk-around of the island (engine core M1). Run (dev server on 5499, headless + muted):
//   node tools/browse.mjs "http://localhost:5499/?play=1&zone=z02LGI&mute=1" tools/steps/game-island.mjs --size 1280x800 --out /tmp/le2-shots
// Prints Pepper's state after each step and writes screenshots: start, run, jump, hill climb / slide, beach, swimming, back on land.
export default async ({ page, shot, wait, evaluate }) => {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
  await wait(800);
  const st = async (tag) => console.log(tag, JSON.stringify(await evaluate(() => {
    const g = window.__game, s = g.state();
    return { pos: s.pos.map((v) => +v.toFixed(1)), state: s.walkState.toString(16), clip: s.clip, mode: s.mode, speed: +s.speed.toFixed(2), surface: s.lastSurface, camDist: +Math.hypot(s.cam[0] - s.cam[3], s.cam[2] - s.cam[5]).toFixed(1) };
  })));
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await wait(ms); for (const k of keys) await page.keyboard.up(k); };
  const put = (x, z, yaw) => evaluate(([x, z, yaw]) => { const g = window.__game; g.setPepper(x, g.world.col.terrainHeight(x, 200, z, 0) + 0.3, z, yaw); }, [x, z, yaw]);

  await st('start'); await shot('game-island-start');
  await hold(['ArrowUp'], 1500); await st('run'); await shot('game-island-run');
  await wait(500);
  await page.keyboard.press('Alt', { delay: 70 }); await wait(250); await st('jump start'); await wait(350); await st('in the air'); await shot('game-island-jump'); await wait(700);
  await hold(['ArrowLeft'], 1200); await st('turned left');
  // a hill: climb, let go, slide
  await put(138, -105, Math.PI); await wait(400);
  await hold(['ArrowUp'], 2400); await st('hill'); await shot('game-island-hill');
  await wait(1200); await st('slide / rest'); await shot('game-island-slide');
  // the beach in the east: wade, swim, come back
  await put(430, -90, Math.PI / 2); await wait(400);
  await page.keyboard.down('ArrowUp'); await wait(2200); await st('wading'); await shot('game-island-wade');
  await wait(1800); await st('swimming'); await shot('game-island-swim');
  await page.keyboard.up('ArrowUp');
  await hold(['ArrowLeft'], 1400);
  await page.keyboard.down('ArrowUp'); await wait(3500); await st('back at the beach'); await page.keyboard.up('ArrowUp'); await wait(1500); await st('on land'); await shot('game-island-out');
  // camera keys
  await hold(['KeyZ'], 700); await shot('game-island-orbit');
};
