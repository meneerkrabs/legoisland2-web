// M5 audit: z41MAP pizzeria from behind with the camera moved by hand (is the back wall there?)
export default async ({ page, shot, wait, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z41MAP' && window.__zone.game, null, { timeout: 60000 });
  for (let i = 0; i < 4; i++) { await key('Enter'); await wait(400); }
  await wait(800);
  const cam = async (eye, tgt, name) => {
    await page.evaluate(([e, t]) => { const z = window.__zone; if (!z.__hooked) { z.__hooked = true; const o = z.gr.render.bind(z.gr); z.gr.render = (...a) => { const c = z.world.camera.c; if (z.__eye) for (let i = 0; i < 3; i++) { c[i] = z.__eye[i]; c[3 + i] = z.__tgt[i]; } z.world.camera.updateView(); return o(...a); }; } z.__eye = e; z.__tgt = t; }, [eye, tgt]);
    await wait(600); await shot(name);
  };
  await cam([1.2, 4, -17.4], [0.7, 2, -4.4], 'mos-game');
  await cam([1.2, 4, -30], [0.7, 2, -4.4], 'mos-back-30');
  await cam([-5, 8, -40], [-5, 4, 0], 'mos-back-40');
};
