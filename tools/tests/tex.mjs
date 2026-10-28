import { parseTga } from '../../src/formats/tga.ts';
import { parseWib } from '../../src/formats/wib.ts';
export default {
  name: 'textures',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0, alpha = 0, npot = 0, wibs = 0, tgaExt = {};
    const pow2 = (n) => (n & (n - 1)) === 0;
    for (const { entry, data } of ctx.entries(/\.tga(back)?$/i)) {
      checked++;
      try {
        const im = parseTga(data);
        if (im.width < 1 || im.height < 1) failures.push(`${entry.fullPath}: empty`);
        if (!pow2(im.width) || !pow2(im.height)) npot++;
        if (im.hasAlpha) alpha++;
        if (im.rgba.length !== im.width * im.height * 4) failures.push(`${entry.fullPath}: buffer size`);
      } catch (e) { failures.push(`${entry.fullPath}: ${e.message}`); }
    }
    for (const { entry, data } of ctx.entries(/\.wib$/i)) {
      checked++; wibs++;
      try { const w = parseWib(data); if (w.frames.length !== w.frameCount) failures.push(`${entry.fullPath}: frame count`); } catch (e) { failures.push(`${entry.fullPath}: ${e.message}`); }
    }
    notes.push(`tga with real alpha: ${alpha}; non-power-of-two: ${npot}; wib: ${wibs}`);
    return { checked, failures, notes };
  },
};
