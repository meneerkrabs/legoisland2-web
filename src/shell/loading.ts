// The loading screen between zones (gaps.md U1): while a zone loads, the original presents the loading card (FUN_0040d1be through FUN_0040cb0f: black screen, the spinning
// Pizza.tga / CD.tga disc, the text LOADING; fade 0 = fully opaque, src/ui/loadingcard.ts) every time a loader reports progress. The port's loaders are asynchronous, so the card
// is presented once at once and then every animation frame until the zone's loop takes over (`stopLoading`, called by the zone runners before their loop starts and by the
// shell when a runner returns or fails). The disc's angles advance with the wall clock like the original's (they only move while the card is drawn).
import type { Shell } from './shell.ts';
import { Archive } from '../formats/archive.ts';

let current: { stop(): void } | null = null;

/**
 * present the loading card now; while it runs every archive member read of the zone load presents it again (the original's loaders call FUN_00443c70 = begin scene + present of the card
 * once per loaded object: mesh / model containers, collision files, particle files, brick effects, node attaches), so the disc turns as loading progresses
 */
export function startLoading(sh: Shell): { stop(): void } {
  stopLoading();
  let on = true, busy = false;
  const draw = () => {
    if (!on || busy) return;
    busy = true;
    try {
      const gl = sh.gl, ui = sh.ui;
      gl.fixed43 = false;
      gl.resize();
      gl.begin([0, 0, 0], new Float32Array(16));
      ui.begin(sh.canvas.width, sh.canvas.height);
      ui.fade(0);          // FUN_0043ec80(0): the screen is black while a zone loads
      ui.flush();
    } finally { busy = false; }
  };
  draw();
  // FUN_00443c70's 17 call sites are object loads (meshes / models, .col, particle files, brick FX, node attach, cutscene commands): texture,
  // sound and text reads do not present the card
  const onRead = (path: string) => { if (!/\.(tga|wib|txl|opt|wav|str|txt)$/i.test(path)) draw(); };
  Archive.onRead = onRead;
  const h = { stop() { if (!on) return; on = false; if (Archive.onRead === onRead) Archive.onRead = null; if (current === h) current = null; } };
  current = h;
  return h;
}

/** stop the loading card (no-op when none runs) */
export function stopLoading(): void { current?.stop(); }
