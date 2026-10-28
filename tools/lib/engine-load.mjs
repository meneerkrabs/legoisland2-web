// Shared by the engine tests / scripts: loads the executable and builds a zone world from the dev data folder (node only).
import fs from 'node:fs';
import path from 'node:path';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { setupZone, PROFILES } from '../../src/game/setup.ts';

const exeCache = new Map();
export function loadExe(dataRoot) {
  if (!exeCache.has(dataRoot)) exeCache.set(dataRoot, new Pe(new Uint8Array(fs.readFileSync(path.join(dataRoot, 'LEGO eiland 2.exe')))));
  return exeCache.get(dataRoot);
}

const sceneCache = new Map();
/** a fresh world for the zone (`ctx.archives` of tools/test-formats.mjs holds the parsed archives); opts = setupZone options */
export function loadZone(ctx, zone, opts = {}) {
  const pe = loadExe(ctx.dataRoot);
  let scene = sceneCache.get(zone);
  if (!scene) { scene = extractZone(pe, zone); sceneCache.set(zone, scene); }
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  const L = setupZone(scene, archive, PROFILES[zone], opts);
  L.world.vars.loadNames(pe);
  return { ...L, pe, scene, archive };
}

/** run n ticks, optionally holding browser key codes; `onTick(i)` is called after each tick */
export function run(L, n, keys = [], onTick) {
  for (const k of keys) L.world.input.setKey(k, true);
  for (let i = 0; i < n; i++) { L.world.tick(); onTick?.(i); }
  for (const k of keys) L.world.input.setKey(k, false);
}
export function press(L, code) { L.world.input.setKey(code, true); L.world.tick(); L.world.input.setKey(code, false); }
