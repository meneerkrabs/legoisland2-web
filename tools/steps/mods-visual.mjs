// Look at catalogue mods in the running game (headless, muted): adds the named catalogue mods in the start screen (when they are not in the profile's mod list yet),
// starts the island and takes screenshots at a few places.
//   npx vite --port 5499 --strictPort &
//   ADD="IXS-look" SPOTS="start;beach:430,-90,300,-90" node tools/browse.mjs "http://localhost:5499/" tools/steps/mods-visual.mjs --profile /tmp/le2-ixs --size 1100x800 --out /tmp/vis
// PARAMS: extra URL parameters, e.g. `&mods=off` for the game without mods (to compare). SPOTS: `name[:x,z,lookX,lookZ]` separated by `;`: Pepper is put at (x, z) facing (lookX, lookZ) (island coordinates). PREFIX names the screenshots. ZONE (default z02LGI).
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = 'http://localhost:5499/';
  await page.waitForSelector('.bdb-start');
  const have = await page.evaluate(() => [...document.querySelectorAll('.bdb-modlist .bdb-modhead b')].map((e) => e.textContent));
  log('mods in the profile:', have.join(' | ') || '(none)');
  for (const title of (process.env.ADD ?? '').split(',').filter(Boolean)) {
    if (have.some((h) => h.includes(title))) continue;
    await page.click('.bdb-mods > summary').catch(() => {});
    if (!(await page.locator('.bdb-cat').evaluate((d) => d.open))) await page.click('.bdb-cat > summary');
    await page.locator('.bdb-catentry').filter({ has: page.locator('.bdb-cathead b', { hasText: title }) }).first().locator('button', { hasText: /toevoegen/i }).evaluate((b) => b.click());
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd/.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 600000 });
    log('added', title, '-', await page.evaluate(() => document.querySelector('.bdb-modstatus').textContent.slice(0, 150)));
  }
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'vis';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2, null, { timeout: 600000 });
  await wait(1500);
  // the island opens with a cutscene: skip it (Shift taps until no script runs)
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  const heap = async () => evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1);
  for (const spot of (process.env.SPOTS ?? 'start').split(';')) {
    const [name, pos] = spot.split(':');
    if (pos) {
      const [x, z, fx, fz] = pos.split(',').map(Number);
      await evaluate(([x, z, fx, fz]) => {
        const zz = window.__zone, w = zz.world, p = zz.loaded.pepper;
        p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g;
        p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
      }, [x, z, fx, fz]);
      await wait(1500);
    }
    await shot(`${prefix}-${name}`);
    log(name, 'JS heap MB:', await heap());
  }
};
