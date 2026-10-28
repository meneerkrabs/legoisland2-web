// Shared by the engine tests / scripts: loads the executable and builds a zone world from the dev data folder (node only).
import fs from 'node:fs';
import path from 'node:path';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { setupZone, profileFor, PROFILES } from '../../src/game/setup.ts';

const exeCache = new Map();
export function loadExe(dataRoot) {
  if (!exeCache.has(dataRoot)) exeCache.set(dataRoot, new Pe(new Uint8Array(fs.readFileSync(path.join(dataRoot, 'LEGO eiland 2.exe')))));
  return exeCache.get(dataRoot);
}

const sceneCache = new Map();
const profileCache = new Map();
let startsCache = null;
/** the zone's scene (`extractZone`, cached) */
export function sceneOf(ctx, zone) {
  const pe = loadExe(ctx.dataRoot);
  let scene = sceneCache.get(zone);
  if (!scene) { startsCache ??= pe.functionStarts(); scene = extractZone(pe, zone, undefined, startsCache); sceneCache.set(zone, scene); }
  return scene;
}
/** the zone's profile from the extraction (`profileFor`, cached) */
export function profileOf(ctx, zone) {
  let p = profileCache.get(zone);
  if (!p) { p = profileFor(zone, loadExe(ctx.dataRoot), sceneOf(ctx, zone), startsCache); profileCache.set(zone, p); }
  return p;
}
/**
 * a fresh world for the zone (`ctx.archives` of tools/test-formats.mjs holds the parsed archives); opts = setupZone options plus `reference: true` to use the
 * hand-written M1 profile (z02LGI / z03PPH only) instead of the extraction
 */
export function loadZone(ctx, zone, opts = {}) {
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, zone);
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  const { reference, ...so } = opts;
  const L = setupZone(scene, archive, reference ? PROFILES[zone] : profileOf(ctx, zone), so);
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
