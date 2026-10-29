#!/usr/bin/env node
// Restore audit (section 9): blocks of the COMPILED cutscenes (.cut) that can never start, i.e. a wait id N (N != 0) that no command signals
// (FUN_00458c15: counter 0xff = nobody) or whose signalers sit in blocks that never start. Also: signal ids nobody waits for (dead ends).
//   node --experimental-strip-types tools/research/restore/scan-blocks.mjs [/tmp/le2-unused/story/x]
import fs from 'node:fs'; import path from 'node:path';
import { parseCutscene } from '../../../src/formats/cutscene.ts';
const X = process.argv[2] ?? '/tmp/le2-unused/story/x';
for (const zone of fs.readdirSync(X)) {
  const d = fs.existsSync(path.join(X, zone)) ? fs.readdirSync(path.join(X, zone)).find((f) => /^cutscene$/i.test(f)) : null; if (!d) continue;
  const cd = path.join(X, zone, d);
  for (const f of fs.readdirSync(cd).filter((f) => /\.cut$/i.test(f)).sort()) {
    let cut; try { cut = parseCutscene(new Uint8Array(fs.readFileSync(path.join(cd, f)))); } catch (e) { console.log(zone, f, 'parse error', e.message); continue; }
    const cmds = cut.commands;
    const signalers = new Map();   // id -> commands
    for (const c of cmds) if (c.signalId) (signalers.get(c.signalId) ?? signalers.set(c.signalId, []).get(c.signalId)).push(c);
    // fixed point over blocks
    const blocks = new Set(cmds.map((c) => c.waitId));
    const reach = new Set([0]); let ch = true;
    while (ch) { ch = false; for (const b of blocks) { if (reach.has(b)) continue; const s = signalers.get(b); if (s && s.every((c) => reach.has(c.waitId))) { reach.add(b); ch = true; } } }
    const dead = [...blocks].filter((b) => !reach.has(b)).sort((a, b) => a - b);
    const noWaiter = [...signalers.keys()].filter((s) => !blocks.has(s)).sort((a, b) => a - b);
    if (dead.length || noWaiter.length) {
      console.log(`${zone}/${f}: ${cmds.length} cmds`);
      for (const b of dead) { const cs = cmds.filter((c) => c.waitId === b); console.log(`  NEVER-STARTS block ${b} (${signalers.has(b) ? 'signalers in dead blocks' : 'nobody signals it'}): ${cs.map((c) => `${c.actor} ${c.name}${c.textId ? ' ' + c.textId : ''}${c.anim ? ' ' + c.anim : ''}`).join('; ')}`); }
      if (noWaiter.length) console.log(`  signals nobody waits for: ${noWaiter.join(' ')}  (ends the chain)`);
    }
  }
}
