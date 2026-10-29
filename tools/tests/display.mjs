// Widescreen + HD font pieces that need no GL: the canvas box, the stored / URL preferences, the projection's aspect, the star backdrop's widening, the HD font metrics.
import { canvasBox, currentPrefs, storePrefs, storedPrefs } from '../../src/display.ts';
import { projection, DEFAULT_FOV } from '../../src/render/camera.ts';
import { backdropCorners } from '../../src/zones/z39ASB/backdrop.ts';
import { logicalFont, ORIGINAL_FONT } from '../../src/ui/fonts.ts';
import { parseFnt } from '../../src/formats/fonts.ts';
import { Archive } from '../../src/formats/archive.ts';

export default {
  name: 'display',
  async run(ctx) {
    const failures = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    // canvas box
    ok(JSON.stringify(canvasBox('4:3', 1280, 720)) === '{"w":960,"h":720}' && JSON.stringify(canvasBox('4:3', 1000, 1000)) === '{"w":1000,"h":750}', '4:3 mode: the largest 4:3 box');
    ok(JSON.stringify(canvasBox('wide', 1280, 720)) === '{"w":1280,"h":720}' && JSON.stringify(canvasBox('wide', 1024, 768)) === '{"w":1024,"h":768}', 'wide mode: the whole window');
    // prefs: default 4:3, stored, URL wins
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    ok(storedPrefs().mode === '4:3' && !storedPrefs().skipIntro && !storedPrefs().debugMenu, 'default: 4:3 (original), intro on, no debug menu');
    storePrefs({ mode: 'wide' }); storePrefs({ skipIntro: true });
    ok(storedPrefs().mode === 'wide' && storedPrefs().skipIntro && currentPrefs('').mode === 'wide', 'stored choice persists (partial updates merge)');
    ok(currentPrefs('?wide=0').mode === '4:3' && currentPrefs('?debug=1').debugMenu && currentPrefs('?intro=0').skipIntro, 'URL parameters override');
    mem.set('le2-display', '{broken'); ok(storedPrefs().mode === '4:3', 'a damaged stored value falls back to the default');
    delete globalThis.localStorage;
    // projection: same vertical FOV, the window's aspect
    const f = 1 / Math.tan(DEFAULT_FOV / 2);
    const p43 = projection({ fov: DEFAULT_FOV, near: 1, far: 100 }, 4 / 3), p169 = projection({ fov: DEFAULT_FOV, near: 1, far: 100 }, 16 / 9);
    ok(Math.abs(p43[5] - f) < 1e-6 && Math.abs(p169[5] - f) < 1e-6, 'vertical scale (the FOV) is the same at 4:3 and 16:9');
    ok(Math.abs(p43[0] - f * 0.75) < 1e-6 && Math.abs(p169[0] - f * 9 / 16) < 1e-6, 'horizontal scale follows the aspect (4:3 = the original 0.75)');
    // star backdrop: corners widen sideways only
    const a = backdropCorners([0, 0, 0], [0, 0, 1]), b = backdropCorners([0, 0, 0], [0, 0, 1], [0, 1, 0], 16 / 9 / (4 / 3));
    ok(Math.abs(Math.abs(b[1][0]) / Math.abs(a[1][0]) - 16 / 12) < 1e-9 && b[1][1] === a[1][1], 'backdrop quad: right extent x 4/3 at 16:9, height unchanged');
    ok(JSON.stringify(backdropCorners([1, 2, 3], [0, 0, 1])) === JSON.stringify(backdropCorners([1, 2, 3], [0, 0, 1], [0, 1, 0], 1)), 'backdrop quad: unchanged at 4:3');
    // HD font metrics
    const fonts = ctx.archives.find((x) => x.name === 'Fonts');
    for (const [slot, name] of ['Balloon12', 'Balloon24'].entries()) {
      const fn = parseFnt(fonts.read(`${name}.fnt`));
      ok(fn.lineHeight === ORIGINAL_FONT[slot].lineHeight && logicalFont(fn, slot) === fn, `${name}: shipped metrics are returned as they are`);
      const k = 4;
      const hd = { ...fn, lineHeight: fn.lineHeight * k, glyphs: fn.glyphs.map((g) => ({ ...g, width: g.width * k, height: g.height * k, offsetX: g.offsetX * k, offsetY: g.offsetY * k })), kern: fn.kern.map((v) => v * k) };
      const back = logicalFont(hd, slot);
      ok(back.lineHeight === fn.lineHeight && back.glyphs.every((g, i) => g.width === fn.glyphs[i].width && g.offsetY === fn.glyphs[i].offsetY && g.u0 === fn.glyphs[i].u0) && back.kern.every((v, i) => v === fn.kern[i]), `${name}: a 4x font is scaled back to the logical size`);
    }
    // isUpscaled against the real blob header
    const z = ctx.archives.find((x) => x.name === 'z03PPH');
    const e = z.entries.find((x) => /\.tga$/i.test(x.path));
    const im = z.read(e), w = im[12] | (im[13] << 8), h = im[14] | (im[15] << 8);
    ok(!z.isUpscaled(e, w, h), 'isUpscaled: an unmodified member is not');
    const z2 = new Archive(z.name, new Uint8Array(0).length ? z.bob : (await import('node:fs')).readFileSync(`${ctx.dataDir}/z03PPH.bod`), z.bob);
    z2.override(e.path, im); ok(!z2.isUpscaled(z2.find(e.path), w, h), 'isUpscaled: a replacement of the same size is not');
    ok(z2.isUpscaled(z2.find(e.path), w * 4, h * 4), 'isUpscaled: a 4x replacement is');
    return { checked, failures };
  },
};
