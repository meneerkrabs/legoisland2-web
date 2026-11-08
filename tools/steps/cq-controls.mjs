// Controls QA (keyboard / aliases / held across modes / pause / skip / gamepad / device switching), headless and muted, on the island:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&mute=1" tools/steps/cq-controls.mjs --out /tmp/cq/controls
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  await wait(500);
  const held = () => page.evaluate(() => window.__shell.input.held >>> 0);
  const ticks = (n) => page.evaluate((n) => new Promise((res) => { const im = window.__shell.input, t0 = im.updates; const iv = setInterval(() => { if (im.updates >= t0 + n) { clearInterval(iv); res(im.updates); } }, 5); }), n);
  const hex = (v) => '0x' + (v >>> 0).toString(16);
  // 1. every key of the original's table (DIK -> code) and the aliases give their bit while down, and nothing after
  const keys = [['ArrowUp', 4], ['ArrowDown', 8], ['ArrowLeft', 1], ['ArrowRight', 2], ['ControlLeft', 0x10], ['AltLeft', 0x20], ['ShiftLeft', 0x40], ['Space', 0x80], ['IntlBackslash', 0x1000],
    ['KeyZ', 0x2000], ['KeyX', 0x4000], ['KeyC', 0x8000], ['Enter', 0x10000],
    ['KeyW', 4], ['KeyS', 8], ['KeyA', 1], ['KeyD', 2], ['KeyQ', 0x1000], ['ControlRight', 0x10], ['ShiftRight', 0x40], ['AltRight', 0x20], ['NumpadEnter', 0x10000]];
  const kdown = (code) => code === 'IntlBackslash' ? page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'IntlBackslash' }))) : page.keyboard.down(code);
  const kup = (code) => code === 'IntlBackslash' ? page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'IntlBackslash' }))) : page.keyboard.up(code);
  for (const [code, bit] of keys) {
    await kdown(code); await ticks(4);
    const d = await held();
    await kup(code); await ticks(3);
    const u = await held();
    expect(`key ${code} -> ${hex(bit)}`, d === bit && u === 0, `down ${hex(d)} up ${hex(u)}`);
  }
  // 2. two keys, diagonal; opposite keys
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); await ticks(4);
  expect('W + D = Up | Right', (await held()) === 6, hex(await held()));
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD'); await ticks(3);
  // 3. held across a mode change: hold Up, pause (Esc), release Esc, Up still held afterwards
  await page.keyboard.down('ArrowUp'); await ticks(4);
  const m0 = await S.state();
  await page.keyboard.down('Escape'); await ticks(4);
  const hEsc = await held(); const mPause = (await S.state()).mode;
  await page.keyboard.up('Escape'); await ticks(4);
  const hAfter = await held();
  expect('Esc replaces the word (0x40000000) and Up is back when Esc goes', hEsc === 0x40000000 && hAfter === 4, `${hex(hEsc)} -> ${hex(hAfter)}, mode ${m0.mode} -> ${mPause}`);
  await page.keyboard.up('ArrowUp'); await ticks(3);
  // the pause menu is open (mode 3): Esc again goes back
  await page.keyboard.press('Escape', { delay: 80 }); await wait(400);
  log('mode after second Esc', (await S.state()).mode);
  await page.keyboard.press('Escape', { delay: 80 }); await wait(400);
  log('mode after third Esc', (await S.state()).mode);
  await page.keyboard.press('Escape', { delay: 80 }); await wait(400);
  expect('Esc toggles the pause menu (2 -> 3 -> 2 -> 3 -> 2)', (await S.state()).mode === 2, String((await S.state()).mode));
  // 4. a key tap shorter than a tick is not seen (exact poll); a tap of 5 ticks is
  const t1 = await page.evaluate(() => { const im = window.__shell.input; im.updates; let seen = 0; const o = im.update.bind(im); im.update = () => { o(); if (im.held & 0x80) seen++; }; window.__seen = () => seen; return 0; });
  await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); });
  await ticks(4);
  expect('tap between two ticks is not seen', (await page.evaluate(() => window.__seen())) === 0);
  await page.keyboard.down('Space'); await ticks(5); await page.keyboard.up('Space'); await ticks(2);
  expect('a held Space is seen', (await page.evaluate(() => window.__seen())) >= 4, String(await page.evaluate(() => window.__seen())));
  // 5. gamepad
  await page.evaluate(() => {
    window.__pads = [];
    window.__shell.input.getPads = () => window.__pads;
  });
  const mkpad = (axes, pressed = [], mapping = 'standard', n = 17) => ({ connected: true, mapping, axes, buttons: Array.from({ length: n }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
  const setPads = (...p) => page.evaluate((p) => { window.__pads = p; }, p);
  const probe = async (label, want, ...p) => { await setPads(...p); await ticks(3); const v = await held(); expect(label, v === want, `got ${hex(v)} want ${hex(want)}`); };
  await probe('pad: nothing', 0, mkpad([0, 0, 0, 0]));
  await probe('pad: stick 0.5 is under the threshold', 0, mkpad([0.5, 0, 0, 0]));
  await probe('pad: stick 0.51 right', 2, mkpad([0.51, 0, 0, 0]));
  await probe('pad: stick -0.51 left', 1, mkpad([-0.51, 0, 0, 0]));
  await probe('pad: stick up (-y)', 4, mkpad([0, -0.9, 0, 0]));
  await probe('pad: stick down-right', 8 | 2, mkpad([0.9, 0.9, 0, 0]));
  await probe('pad: second stick is ignored', 0, mkpad([0, 0, 1, 1]));
  await probe('pad: A = 0x10', 0x10, mkpad([0, 0, 0, 0], [0]));
  await probe('pad: B X Y = 0x20 | 0x40 | 0x80', 0xe0, mkpad([0, 0, 0, 0], [1, 2, 3]));
  await probe('pad: LB RB = 0x1000 | 0x2000', 0x3000, mkpad([0, 0, 0, 0], [4, 5]));
  await probe('pad: Back Start = 0x4000 | 0x8000', 0xc000, mkpad([0, 0, 0, 0], [8, 9]));
  await probe('pad: LS RS = Enter | 0x20000', 0x30000, mkpad([0, 0, 0, 0], [10, 11]));
  await probe('pad: D-pad (standard 12..15) ignored -> any key? no', 0, mkpad([0, 0, 0, 0], [12, 13, 14, 15]));
  await probe('pad: triggers (6, 7) ignored', 0, mkpad([0, 0, 0, 0], [6, 7]));
  await probe('pad: raw mapping buttons 0..9 in HID order', 0x10 | 0x20, mkpad([0, 0, 0, 0], [0, 1], '', 12));
  await probe('pad: only the first pad', 0x10, mkpad([0, 0, 0, 0], [0]), mkpad([0, 0, 0, 0], [1]));
  await probe('pad: first slot empty -> the next pad', 0x20, null, mkpad([0, 0, 0, 0], [1]));
  await probe('pad: hot-plug off again', 0, null);
  // device mix: keyboard + pad at once
  await setPads(mkpad([0.9, 0, 0, 0], [1]));
  await page.keyboard.down('ArrowUp'); await ticks(4);
  expect('keyboard + pad merge', (await held()) === (4 | 2 | 0x20), hex(await held()));
  await page.keyboard.up('ArrowUp'); await setPads(); await ticks(3);
  // a lone pad button that has no bit: any key (0x80000000)
  await probe('pad: button 11 alone is 0x20000 (pad 9)', 0x20000, mkpad([0, 0, 0, 0], [11]));
  await setPads(); await ticks(3);
  // 6. any key and a lone left mouse button
  await page.mouse.move(300, 300); await page.mouse.down({ button: 'left' }); await ticks(3);
  expect('lone left mouse button: nothing (any-key code 0)', (await held()) === 0, hex(await held()));
  await page.mouse.up({ button: 'left' });
  await page.keyboard.down('KeyP'); await ticks(3);
  expect('an unbound key: any key 0x80000000', (await held()) === 0x80000000, hex(await held()));
  await page.keyboard.up('KeyP');
  // 7. blur releases everything
  await page.keyboard.down('ArrowUp'); await ticks(3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await ticks(3);
  expect('window blur releases held keys', (await held()) === 0, hex(await held()));
  await page.keyboard.up('ArrowUp');
  await shot('end');
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
