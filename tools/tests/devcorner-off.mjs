// The Ontwikkelaarshoek must change nothing without the debug option (docs/re/devcorner.md): (1) the shared files only reach src/devcorner through guarded dynamic imports / `dev?.` hooks,
// (2) every hook property is null / inert by default, (3) the cheat rows, the main menu and the key handling are the original's, (4) importing the whole devcorner tree and "attaching" with the
// debug option off leaves a ticked world bit-identical to a run without it, (5) the debug option itself is read from the stored / URL preference only.
import fs from 'node:fs';
import path from 'node:path';
import { loadZone, loadExe } from '../lib/engine-load.mjs';
import { debugAids } from '../../src/game/debug.ts';
import { CheatDetector, cheatState } from '../../src/shell/cheats.ts';
import { InputMapper } from '../../src/game/input.ts';
import { readMenuPages } from '../../src/shell/tables.ts';
import { toEnginePages } from '../../src/shell/menuui.ts';
import { CollisionWorld } from '../../src/game/collision.ts';
import { codeToDik } from '../../src/shell/dik.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function hashWorld(L, n) {
  let h = 2166136261 >>> 0;
  const mix = (x) => { const b = new Float32Array([x]); const u = new Uint32Array(b.buffer)[0]; h = Math.imul(h ^ u, 16777619) >>> 0; };
  const keys = ['ArrowUp', 'ArrowLeft', 'AltLeft', 'ArrowUp', 'KeyZ'];
  for (let i = 0; i < n; i++) {
    if (i % 25 === 0) { for (const k of keys) L.world.input.setKey(k, false); L.world.input.setKey(keys[(i / 25) % keys.length | 0], true); }
    L.world.tick();
    for (const v of L.world.camera.c) mix(v);
    for (const r of L.world.records.slice(0, 60)) { mix(r.x); mix(r.y); mix(r.z); }
  }
  return h;
}

export default {
  name: 'devcorner-off',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    // (1) shared files: every mention of the corner is a dynamic import behind debugAids() / the debug preference, or a `dev?.` call on a handle that is null without it
    const guarded = [['src/shell/playzone.ts', /devcorner/], ['src/shell/frontend.ts', /devcorner/], ['src/main.ts', /devcorner|devCorner/], ['src/shell/shell.ts', /devcorner/], ['src/game/render.ts', /devcorner/]];
    for (const [f, re] of guarded) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (!re.test(l) || /^\s*\/\//.test(l)) return;
        if (/^\s*import\s.*from\s+'[^']*devcorner/.test(l) && !/import type/.test(l)) ok(false, `${f}:${i + 1} static import of the corner`);
        else if (/import\('[^']*devcorner/.test(l)) ok(/debugAids\(\)|prefs\.debugMenu/.test(l), `${f}:${i + 1} dynamic import not behind the debug option`);
        else checked++;
      });
    }
    ok(/const dev = debugAids\(\) \?/.test(read('src/shell/playzone.ts')) && /const dev = debugAids\(\) \?/.test(read('src/shell/frontend.ts')), 'the loops create `dev` only with debugAids()');
    const pz = read('src/shell/playzone.ts');
    ok(/if \(e\.code === 'F8' && !dev\)/.test(pz), 'the old F8 view-plane key is unchanged without the corner');
    for (const l of pz.split('\n')) if (/\bdev\b/.test(l) && /^\s*[^/]*\bdev\.\w+\(/.test(l) && !/\bdev\?\.|if \(dev\)|dev \?|dev\.\w+\(\)\) \{/.test(l) && !/const devExit/.test(l)) ok(false, `unguarded dev use: ${l.trim()}`);
    // (2) the hook properties of the render / collision path are null by default
    ok(new CollisionWorld().debug === null || new CollisionWorld().debug === undefined, 'CollisionWorld.debug is null by default');
    const rsrc = read('src/game/render.ts');
    ok(/debugDraw: .* = null;/.test(rsrc), 'GameRenderer.debugDraw = null');
    ok(/lodHook[^\n]*= null/.test(rsrc) && /farHook[^\n]*= null/.test(rsrc), 'GameRenderer.lodHook / farHook = null');
    // (3) cheats, menu, keys
    ok(debugAids() === false, 'debugAids() is false without a stored / URL preference');
    const pe = loadExe(ctx.dataRoot);
    const fired = [];
    const det = new CheatDetector(pe, debugAids() ? 0 : 2); det.onCheat = (r) => fired.push(r);
    ok(det.firstRow === 2, 'cheat rows 0 / 1 (PEPPERONI, FSMADVANCE) are not scanned without the debug option');
    const raw = readMenuPages(pe);
    ok(raw[0].nitems === 5 && toEnginePages(raw)[0].items.length === 5, 'main-menu page 0 has its 5 items');
    ok(cheatState.pepperoni === 0, 'DAT_008a933c is untouched');
    const dev = await import('../../src/devcorner/cheats.ts');
    const pages = toEnginePages(raw);
    ok(dev.applyPepperoni(pages, pe, raw[0].itemsAt) === false && pages[0].items.length === 5, 'applyPepperoni changes nothing while DAT_008a933c is 0');
    cheatState.pepperoni = 6;
    ok(dev.applyPepperoni(pages, pe, raw[0].itemsAt) === true && pages[0].items.length === 6 && pages[0].items[5].label === 'Debug' && pages[0].items[5].type === 1 && pages[0].items[5].value === 0x11, 'with DAT_008a933c = 6 the sixth item is "Debug", goto page 17 (0x8a788c)');
    cheatState.pepperoni = 0;
    ok(dev.applyPepperoni(pages, pe, raw[0].itemsAt) === true && pages[0].items.length === 5, 'back to 5 items');
    const inp = new InputMapper();
    ok(!inp.bindings.some((b) => b.codes.includes('Backquote') || b.defaultCode === ((1 << 16) | codeToDik('Backquote'))), 'the corner key (Backquote) is in no key binding of the original table');
    // (4) a world ticked before and after loading the whole corner is identical
    const A = loadZone(ctx, 'z03PPH');
    const before = hashWorld(A, 200);
    await import('../../src/devcorner/sections.ts');
    const B = loadZone(ctx, 'z03PPH');
    const after = hashWorld(B, 200);
    ok(before === after, `a world ticked after importing the corner differs (${before} vs ${after})`);
    notes.push(`world hash ${before.toString(16)} (200 ticks of z03PPH, before = after loading src/devcorner)`);
    return { checked, failures, notes };
  },
};
