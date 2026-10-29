// WP9 headless run (docs/re/m4/wp9-bricks.md): the island at story node 3, deliver to customers (teleport next to them, Shift) until the first house
// cutscene (LGIPH01) sets SWITCH_LGI_BRICKFX_PEPPERSHOUSE01; then the cutscene is NOT skipped and screenshots are taken while the bricks of Pepper's house
// fall into place. Usage: node tools/browse.mjs "http://localhost:<port>/?zone=z02LGI&node=3&mute=1" tools/steps/m4-wp9-bricks.mjs --size 1280x800 --out /tmp/m4-wp9
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  await wait(500);
  const fxState = () => page.evaluate(() => {
    const z = window.__zone, fx = z.world.ext.get('brickFx');
    if (!fx) return { fx: false };
    const busy = fx.slots.filter((s) => s && s.running).map((s) => `${s.record.name}:${s.stage}/${s.state}`);
    let drawn = 0; for (const _b of fx.drawList()) drawn++;
    const ph = ['PH01', 'PH02', 'PH03', 'PHSE'].map((n) => { const r = z.world.records.find((x) => x.name === n); return `${n}=${r?.enabled ? 1 : 0}`; }).join(' ');
    return { fx: true, busy, drawn, ph, phase: z.sh.vars.get(0xad), sw: [0x13b, 0x133, 0x100].map((v) => z.sh.vars.get(v)), cs: !!z.game?.debug?.().cutscene };
  });
  log('start', JSON.stringify(await S.state()), JSON.stringify(await fxState()));
  const customers = ['PAPA', 'NICK', 'NUBB', 'LICK', 'VALS', 'TBOB', 'DJAB', 'ROBB', 'CLIK', 'REDG', 'DARR'];
  let fired = false;
  for (const c of customers) {
    for (let attempt = 0; attempt < 6 && !fired; attempt++) {
      await S.teleportNear(c, 4, attempt * 0.7);
      await wait(250);
      await S.tap('ShiftLeft', 100);
      // let the conversation run (Shift skips lines) until the house switch is set or nothing runs any more
      for (let k = 0; k < 60; k++) {
        const f = await fxState();
        if (f.sw[0] !== 0) { fired = true; break; }
        if (!f.cs) { await wait(300); if (!(await fxState()).cs) break; }
        await S.tap('ShiftLeft', 60); await wait(150);
      }
      if (fired) log('house switch set after customer', c, 'attempt', attempt + 1);
    }
    if (fired) break;
  }
  if (!fired) { log('no house cutscene', JSON.stringify(await S.state())); await shot('nohouse'); return; }
  // the cutscene LGIPH01 runs and the bricks fall: screenshots over the effect (about 3 s of drops + 6 s of falling + 3 s of wait)
  for (let i = 0; i < 14; i++) {
    const f = await fxState();
    log(`t${i}`, JSON.stringify(f));
    await shot(`house-${String(i).padStart(2, '0')}`);
    await wait(900);
  }
  log('end', JSON.stringify(await S.state()), JSON.stringify(await fxState()));
};
