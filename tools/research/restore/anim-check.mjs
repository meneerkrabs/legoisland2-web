#!/usr/bin/env node
// Restore audit (section 9): does an animation name used by a script exist in the hub's loader dictionary (emulated), and is its clip index inside the blk of the actor?
//   node --experimental-strip-types tools/research/restore/anim-check.mjs z40OGL 64 CIT4_SNAEK_FALLINGASLEEP:CIT4 CIT4_SNAEK_SLEEP_IDLE:CIT4
import fs from 'node:fs';
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import { parseBlk } from '../../../src/formats/anim.ts';
import '../../../src/zones/index.ts';
const [zone, node, ...items] = process.argv.slice(2);
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
const m = new Map([[0x58, +node], [2, 1]]);
const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
const all = new Map(); for (const d of emu.dictionaries.all) for (const [k, v] of d.entries) all.set(String(k).toUpperCase(), v);
for (const it of items) {
  const [name, blk] = it.split(':');
  const v = all.get(name.toUpperCase());
  let n = '?'; try { n = parseBlk(new Uint8Array(fs.readFileSync(`/tmp/le2-unused/story/x/${zone}/anim/${blk}.blk`))).clips.length; } catch (e) { n = 'ERR ' + e.message; }
  console.log(name, 'dictionary value', v, `${blk}.blk clips`, n, v !== undefined && typeof n === 'number' ? (v < n ? 'IN RANGE' : 'OUT OF RANGE') : '');
}
