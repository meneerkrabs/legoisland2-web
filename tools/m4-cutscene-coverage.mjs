#!/usr/bin/env node
// M4 WP2: which cutscene commands the scripts actually use (docs/re/m4/wp2-cutscenes.md). Parses every compiled `cutscene/*.cut` of every archive
// with `parseCutscene` and tabulates per command id: count, target kinds, actors, animation names, switch names, camera sides, FOLLOW / ATTACH partners.
//   node tools/m4-cutscene-coverage.mjs [--zone z02LGI] [--all] [--scripts]
//   --zone: only that archive (default z02LGI); --all: every archive; --scripts: one line per script (commands used)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archive } from '../src/formats/archive.ts';
import { parseCutscene, CUT_COMMAND_NAMES } from '../src/formats/cutscene.ts';
import { parseCompiledWaypoints } from '../src/formats/waypoints.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const dataDir = path.join(here, '../public/data/le2/_data');
const zone = args.includes('--all') ? null : opt('--zone', 'z02LGI').toLowerCase();
const perScript = args.includes('--scripts');

const SIDES = ['HEAD', 'FRONT', 'BEHIND', 'LSIDE', 'RSIDE'];
const stats = new Map();   // cmd -> { n, kinds, actors, anims, switches, sides, others, bones, globalActors }
const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const get = (cmd) => {
  let s = stats.get(cmd);
  if (!s) { s = { n: 0, split: new Map(), kinds: new Map(), actors: new Map(), anims: new Map(), switches: new Map(), sides: new Map(), others: new Map(), bones: new Map(), targets: new Map(), wps: new Map(), badWps: new Map() }; stats.set(cmd, s); }
  return s;
};
let files = 0, cmds = 0;
const scripts = [];
for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith('.bod')).sort()) {
  const n = f.slice(0, -4);
  if (zone && n.toLowerCase() !== zone) continue;
  const arc = new Archive(n, fs.readFileSync(path.join(dataDir, f)), fs.readFileSync(path.join(dataDir, n + '.bob')));
  const wpOf = (name) => { const e = arc.find(`Waypoints/W_${name}_C.wpt`); try { return e ? parseCompiledWaypoints(arc.read(e)) : null; } catch { return null; } };
  const maps = { csm: wpOf('CSM'), path: wpOf('PATH') };
  for (const e of arc.entries) {
    if (!/cutscene\/[^/]+\.cut$/i.test(e.path)) continue;
    let cut;
    try { cut = parseCutscene(arc.read(e)); } catch (err) { console.log(`${n}/${e.path}: ${err.message}`); continue; }
    files++;
    const used = new Map();
    for (const c of cut.commands) {
      cmds++;
      inc(used, CUT_COMMAND_NAMES[c.cmd]);
      const s = get(c.cmd);
      s.n++;
      inc(s.actors, c.actor);
      if (c.targetKind) { inc(s.kinds, c.targetKind); inc(s.split, `${c.actor === 'CMRA' ? 'camera' : 'actor'}:${c.targetKind}`); }
      if (c.targetKind === 'waypoint' && maps) {
        // FUN_0045d68a resolves waypoints at load: CSM (slot 2) first, then PATH (slot 1), prefix match (FUN_00462b4e); actor MOVEPOSITION: PATH only
        const t = c.target, find = (m) => m.nodes.findIndex((x) => x.name.startsWith(t.toUpperCase()));
        const ci = maps.csm ? find(maps.csm) : -1, pi = maps.path ? find(maps.path) : -1;
        const camera = c.actor === 'CMRA';
        let res;
        if ((c.cmd === 4 || c.cmd === 6) && !camera) res = pi >= 0 ? 'PATH' : 'unresolved';
        else res = ci >= 0 ? 'CSM' : pi >= 0 ? 'PATH' : 'unresolved';
        // the actor SETPOSITION handler (FUN_0045c5e2) reads PATH[index] whatever map the index came from
        if (c.cmd === 5 && !camera && res === 'CSM') res = pi === ci ? 'CSM(=PATH idx)' : `CSM->PATH[${ci}]!`;
        inc(s.wps, `${camera ? 'camera' : 'actor'}:${res}`);
        if (res === 'unresolved' || res.endsWith('!')) inc(s.badWps, `${n}/${cut.name}:${c.actor}:${t}:${res}`);
      }
      if (c.targetKind === 'actor' || c.targetKind === 'spline') inc(s.targets, `${c.targetKind}:${c.target}`);
      if (c.anim) inc(s.anims, c.anim);
      if (c.switchName) inc(s.switches, `${c.switchName}=${c.switchValue}`);
      if (c.cmd === 5 && c.targetKind === 'actor') inc(s.sides, SIDES[c.side] ?? String(c.side));
      if (c.other) inc(s.others, c.other);
      if (c.bone !== undefined) inc(s.bones, c.bone);
      if (c.cmd === 13) inc(s.others, `expr ${c.expression}`);
    }
    scripts.push({ arc: n, name: e.path.split('/').pop(), n: cut.commands.length, declared: cut.declaredCount, used, splines: cut.splineNames.length });
  }
}
const fmt = (m, max = 40) => [...m].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, v]) => `${k}${v > 1 ? ` x${v}` : ''}`).join(', ') + (m.size > max ? `, ... (${m.size})` : '');
console.log(`${files} scripts, ${cmds} commands${zone ? ` (${zone})` : ''}\n`);
for (const id of [...stats.keys()].sort((a, b) => a - b)) {
  const s = stats.get(id);
  console.log(`${String(id).padStart(2)} ${CUT_COMMAND_NAMES[id].padEnd(14)} ${String(s.n).padStart(5)}`);
  console.log(`     actors: ${fmt(s.actors)}`);
  if (s.kinds.size) console.log(`     kinds: ${fmt(s.split)}`);
  if (s.wps.size) console.log(`     waypoints resolve to: ${fmt(s.wps)}`);
  if (s.badWps.size) console.log(`     problems: ${fmt(s.badWps, 400)}`);
  if (s.targets.size) console.log(`     actor / spline targets: ${fmt(s.targets)}`);
  if (s.sides.size) console.log(`     sides: ${fmt(s.sides)}`);
  if (s.anims.size) console.log(`     anims: ${fmt(s.anims, 400)}`);
  if (s.switches.size) console.log(`     switches: ${fmt(s.switches, 400)}`);
  if (s.others.size) console.log(`     other: ${fmt(s.others)}`);
  if (s.bones.size) console.log(`     bones: ${fmt(s.bones)}`);
}
if (perScript) {
  console.log('');
  for (const s of scripts) console.log(`${s.arc}/${s.name.padEnd(14)} ${String(s.n).padStart(4)}/${s.declared}${s.splines ? ` splines ${s.splines}` : ''}  ${fmt(s.used)}`);
}
