// Node test helper of M5: a hub zone's world for a story node, set up the way the shell does it (emulated set-up -> setupZone -> the framework's world work of
// src/hub/game.ts) with a MOCK island context (like tools/lib/island-load.mjs, but for any zone): it records what the nodes ask of the shell.
//   import { loadHub, tick, press, hold } from '../lib/hub-load.mjs';
//   const H = loadHub(ctx, { zone: 'z07CSI', node: 15 });   // H.world, H.L (Loaded), H.ictx (mock), H.pepper, H.rec('PEPP'), H.vars, H.emu (profile.emu)
//   tick(H, 30);  press(H, 'ShiftLeft');  hold(H, ['ArrowUp'], 60);
// Mock behaviour as in island-load.mjs: startCutscene(slot) records the slot in ictx.cutscenes and "runs" `cutsceneTicks` ticks, say() records (id, text),
// sfx ids go to ictx.sounds. `opts.vars` = game variables set before the set-up runs (e.g. { 0xa3: 2 } = came from the island, 0x5e: PEPPER_CONTROL ...).
import { GameVars } from '../../src/game/vars.ts';
import { World } from '../../src/game/world.ts';
import { profileFor, setupZone } from '../../src/game/setup.ts';
import { StoryFsm } from '../../src/shell/story.ts';
import { readZoneTable, readStoryFsm, readInitialVars } from '../../src/shell/tables.ts';
import { installCtx } from '../../src/island/ctx.ts';
import '../../src/island/index.ts';
import { loadExe, sceneOf } from './engine-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { ensureAnim } from '../../src/island/ambient/common.ts';
import { applyEmulatedArrival } from '../../src/hub/arrival.ts';
import { pathPositions } from '../../src/zones/z02LGI/index.ts';
import { BrickLibrary } from '../../src/formats/bricks.ts';
import { DOCK_WORDS, PAD_WORDS } from '../../src/island/vehicles/common.ts';
import { installBrickLibrary, brickMorph, brickBurst } from '../../src/fx/bricks/island.ts';

export function loadHub(ctx, opts = {}) {
  // the dock / helipad taken words are static process memory (src/island/vehicles/common.ts): a hub test world starts like a fresh process unless the test says otherwise (`keepVehicleWords`)
  if (!opts.keepVehicleWords) { DOCK_WORDS.fill(0); PAD_WORDS.fill(0); }
  const zone = opts.zone ?? 'z07CSI';
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, zone);
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  const zones = readZoneTable(pe), nodes = readStoryFsm(pe), init = readInitialVars(pe);
  const info = zones.find((z) => (z.archive ?? '').toLowerCase() === zone.toLowerCase());
  const node = opts.node ?? nodes.findIndex((nd) => nd.zone === info.index);
  const vars = new GameVars(); vars.a.set(init); vars.loadNames(pe);
  const story = new StoryFsm(vars, nodes, zones);
  story.applyNewGameDefaults(vars.a.slice(15, 15 + 220));
  story.jump(node);                     // the chapter skip of `?zone=..&node=N`: every node below counts as done
  vars.set(5, info.index);
  for (const [k, v] of Object.entries(opts.vars ?? {})) vars.set(+k, v);
  const world = new World();
  world.vars = vars;
  world.externalInput = false;
  const profile = profileFor(zone, pe, scene, undefined, { emuVars: vars, archive });
  const emu = profile.emu;
  const L = setupZone(scene, archive, profile, { world, pe, subgame: info.index, from: opts.from ?? '' });
  const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
  const rigs = new Map(emu.loaderRigs.map((r) => [r.record, r.rig]));
  const ictx = {
    world, pe, archive, setup: emu, era: 0, zone,
    cutsceneTicks: 0, cutsceneLeft: 0, cutscenes: [], said: [], sounds: [], stopped: [], sayTicks: 60, sayLeft: 0, held: false,
    startCutscene(slot) { this.cutscenes.push({ slot, tick: world.tickCount }); this.cutsceneLeft = this.cutsceneTicks; return true; },
    cutsceneActive() { return this.cutsceneLeft > 0 || this.held; },
    holdCutscene(on) { this.held = on; },
    text: { npc: null, hol: null },
    // subtitle `held` (the talking NPCs, FUN_0045d47f): the text of the lines (a missing one empty) written at once, whatever the voice does, kept in `heldText` until clearSubtitle; every write is logged
    // in `subtitles`. `held` / `none` without a voice: nothing is spoken. `timed` (default): the subtitle goes with the voice (not modelled)
    heldText: null, subtitles: [],
    say(table, id, id2, voice = true, subtitle = 'timed') {
      if (subtitle === 'held') { const tx = (k) => { const t = table?.text?.(k) ?? k; return t === k ? '' : t; }; this.heldText = tx(id) + (id2 ? tx(id2) : ''); this.subtitles.push(this.heldText); }
      if (subtitle !== 'timed' && voice === false) return true;
      if (this.sayLeft > 0) return false; this.said.push({ id, id2, text: table?.text?.(id) ?? id, tick: world.tickCount }); this.sayLeft = this.sayTicks; return true;
    },
    clearSubtitle() { this.heldText = null; },
    speechIdle() { return this.sayLeft <= 0; },
    stopSpeech() { this.sayLeft = 0; },
    sfx(id) { this.sounds.push({ id, tick: world.tickCount }); },
    stopSfx(id) { this.stopped.push(id); },
    sfxAt(id, pos) { this.sounds.push({ id, pos: [...pos], tick: world.tickCount }); },
    fx: [], particles(name, mode, pos, owner) { this.fx.push({ name, mode, owner, pos: [...pos], tick: world.tickCount }); },
    animClip(name) { return emu.dictionaries.anims.get(name); },
    switchVar(name) { return emu.dictionaries.switches.get(name); },
    rigOf(record) { return rigs.get(record); },
    pathPos: pathPositions(archive),
    shared: {}, hub: {},
    scene,
  };
  installCtx(world, ictx);
  if (opts.bricks) {
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    installBrickLibrary(world, new BrickLibrary(pe, arc('Bricks'), arc('BrickMorph')));
    ictx.brickMorph = (rec, v, files, m) => brickMorph(world, rec, v, files, m);
    ictx.brickBurst = (rec, kind) => brickBurst(world, rec, kind);
  }
  // the framework's world work after setupZone (src/hub/game.ts afterSetup); `opts.worldWork === false`: the caller runs the registered afterSetup hook itself (tools/lib/m8-save.mjs)
  let arrival = null;
  if (opts.worldWork !== false) {
    loadIslandWalkMaps(archive, emu);
    for (const r of emu.loaderRigs) { const rec = world.records[r.record]; if (rec) ensureAnim(world, rec); }
    startPizzaNodes(world);
    startIslandNpcs(world);
    arrival = applyEmulatedArrival(emu, world, L);
  }
  return {
    world, L, ictx, pe, scene, archive, vars, story, profile, emu, zone, info, pepper: L.pepper, node, messages, arrival,
    rec: (name) => world.records.find((r) => r.name === name),
    recs: (name) => world.records.filter((r) => r.name === name),
    index: (name) => world.records.findIndex((r) => r.name === name),
  };
}

/** run n ticks (the mock cutscene / speech counters count down with them) */
export function tick(H, n = 1, onTick) {
  for (let i = 0; i < n; i++) {
    H.world.tick();
    if (H.ictx.cutsceneLeft > 0) H.ictx.cutsceneLeft--;
    if (H.ictx.sayLeft > 0) H.ictx.sayLeft--;
    onTick?.(i);
  }
}
export function press(H, code, ticks = 1) { H.world.input.setKey(code, true); tick(H, ticks); H.world.input.setKey(code, false); tick(H, 1); }
export function hold(H, codes, ticks, onTick) { for (const k of codes) H.world.input.setKey(k, true); tick(H, ticks, onTick); for (const k of codes) H.world.input.setKey(k, false); }
