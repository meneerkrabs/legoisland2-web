// Node test helper of M4: the island world for a story node, set up the way the shell does it (emulated set-up -> setupZone) with a MOCK island context
// (src/island/ctx.ts) that records what the nodes ask of the shell. Usage in a tools/tests/*.mjs test:
//   import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
//   const I = loadIsland(ctx, { node: 2 });          // I.world, I.L (Loaded), I.ictx (mock), I.pepper, I.rec('PIZB'), I.vars
//   tick(I, 30);  press(I, 'ShiftLeft');  hold(I, ['ArrowUp'], 60);
// Mock behaviour: startCutscene(slot) records the slot in ictx.cutscenes and "runs" `cutsceneTicks` ticks (default 0 = ends at once; set ictx.cutsceneTicks),
// say() records (id, text) in ictx.said and keeps the speech busy for `sayTicks` (default 60) ticks, sfx ids go to ictx.sounds. The shell's real
// implementations live in src/zones/z02LGI/ctx.ts.
import { GameVars } from '../../src/game/vars.ts';
import { World } from '../../src/game/world.ts';
import { profileFor, setupZone } from '../../src/game/setup.ts';
import { StoryFsm, eraOfNode } from '../../src/shell/story.ts';
import { readZoneTable, readStoryFsm, readInitialVars } from '../../src/shell/tables.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { installCtx } from '../../src/island/ctx.ts';
import '../../src/island/index.ts';
import { loadExe, sceneOf } from './engine-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { BrickLibrary } from '../../src/formats/bricks.ts';
import { installBrickLibrary, brickMorph, brickBurst } from '../../src/fx/bricks/island.ts';

/** zone table index of the island for a story node (the four ids 2 / 31 / 32 / 33, architecture.md 2.2) */
export const islandZoneOf = (node) => { const e = eraOfNode(node); return e === 1 ? 31 : e === 2 ? 32 : e === 3 ? 33 : 2; };

export function loadIsland(ctx, opts = {}) {
  const node = opts.node ?? 2;
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, 'z02LGI');
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
  const zones = readZoneTable(pe), nodes = readStoryFsm(pe), init = readInitialVars(pe);
  const vars = new GameVars(); vars.a.set(init); vars.loadNames(pe);
  const story = new StoryFsm(vars, nodes, zones);
  story.applyNewGameDefaults(vars.a.slice(15, 15 + 220));
  vars.set(0x58, node); vars.set(0x59, islandZoneOf(node)); vars.set(5, islandZoneOf(node));
  for (const [k, v] of Object.entries(opts.vars ?? {})) vars.set(+k, v);
  const world = new World();
  world.vars = vars;
  world.externalInput = false;
  const profile = profileFor('z02LGI', pe, scene, undefined, { islandVars: vars, archive });
  const L = setupZone(scene, archive, profile, { world, pe, subgame: islandZoneOf(node), from: opts.from ?? '', vars: { 0x58: node } });
  const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
  const island = profile.island;
  const ictx = {
    world, pe, archive, setup: island, era: eraOfNode(node),
    cutsceneTicks: 0, cutsceneLeft: 0, cutscenes: [], said: [], sounds: [], stopped: [], sayTicks: 60, sayLeft: 0, held: false,
    startCutscene(slot) { this.cutscenes.push({ slot, tick: world.tickCount }); this.cutsceneLeft = this.cutsceneTicks; return true; },
    cutsceneActive() { return this.cutsceneLeft > 0 || this.held; },
    holdCutscene(on) { this.held = on; },
    text: { npc: null, hol: null },
    say(table, id, id2) { if (this.sayLeft > 0) return false; this.said.push({ id, id2, text: table?.text?.(id) ?? id, tick: world.tickCount }); this.sayLeft = this.sayTicks; return true; },
    speechIdle() { return this.sayLeft <= 0; },
    stopSpeech() { this.sayLeft = 0; },
    sfx(id) { this.sounds.push({ id, tick: world.tickCount }); },
    stopSfx(id) { this.stopped.push(id); },
    sfxAt(id, pos) { this.sounds.push({ id, pos: [...pos], tick: world.tickCount }); },
    fx: [], particles(name, mode, pos, owner) { this.fx.push({ name, mode, owner, pos: [...pos], tick: world.tickCount }); },
    animClip(name) { return island?.dictionaries.anims.get(name); },
    switchVar(name) { return island?.dictionaries.switches.get(name); },
    shared: {},
    scene,   // WP4: mesh MATL part matrices (src/island/trigger/parts.ts)
  };
  installCtx(world, ictx);
  // opts.bricks (WP9): the FX_Bricks library (archives Bricks + BrickMorph) and the brick services of the real context (brickMorph / brickBurst)
  if (opts.bricks) {
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    installBrickLibrary(world, new BrickLibrary(pe, arc('Bricks'), arc('BrickMorph')));
    ictx.brickMorph = (rec, v, files, m) => brickMorph(world, rec, v, files, m);
    ictx.brickBurst = (rec, kind) => brickBurst(world, rec, kind);
  }
  waypoints.load(archive);   // the island's waypoint maps (W_ROAD/PATH/CSM/OTH): the zone game loads them (FUN_004630c0); StartCSM / walker nodes read node positions
  if (messages && opts.npcText !== false) {
    const n = opts.npcFile ?? null;   // e.g. 'LI/Data/lifsm1.str'; the story handler (WP8) selects it in the real game
    if (n) { try { ictx.text.npc = loadMessages(messages, [n]); } catch { /* none */ } }
  }
  const I = {
    world, L, ictx, pe, scene, archive, vars, story, profile, pepper: L.pepper, node, messages,
    rec: (name) => world.records.find((r) => r.name === name),
    recs: (name) => world.records.filter((r) => r.name === name),
    index: (name) => world.records.findIndex((r) => r.name === name),
  };
  return I;
}

/** run n ticks (the mock cutscene / speech counters count down with them) */
export function tick(I, n = 1, onTick) {
  for (let i = 0; i < n; i++) {
    I.world.tick();
    if (I.ictx.cutsceneLeft > 0) I.ictx.cutsceneLeft--;
    if (I.ictx.sayLeft > 0) I.ictx.sayLeft--;
    onTick?.(i);
  }
}
export function press(I, code, ticks = 1) { I.world.input.setKey(code, true); tick(I, ticks); I.world.input.setKey(code, false); tick(I, 1); }
export function hold(I, codes, ticks, onTick) { for (const k of codes) I.world.input.setKey(k, true); tick(I, ticks, onTick); for (const k of codes) I.world.input.setKey(k, false); }
