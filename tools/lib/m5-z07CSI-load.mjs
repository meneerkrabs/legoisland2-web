// z07CSI node-test world: tools/lib/hub-load.mjs (emulated set-up + the framework's world work, mock island context) + what src/zones/z07CSI/index.ts adds after the set-up
// (`applyCsiSetup`) and in `onCreate`. The mock's particle engine is a recording FakeFx (tools/lib/fake-fx.mjs).
//   const H = loadCsi(ctx, { node: 15, vars: { 0xa3: 7 } });   // + H.fx (the FakeFx), H.G (vehicles(world))
import { loadHub, tick, press, hold } from './hub-load.mjs';
import { FakeFx } from './fake-fx.mjs';
import { applyCsiSetup } from '../../src/zones/z07CSI/index.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { GameVars } from '../../src/game/vars.ts';
import { World } from '../../src/game/world.ts';
import { profileFor, setupZone } from '../../src/game/setup.ts';
import { StoryFsm } from '../../src/shell/story.ts';
import { readZoneTable, readStoryFsm, readInitialVars } from '../../src/shell/tables.ts';
import { installCtx } from '../../src/island/ctx.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { waypoints } from '../../src/game/walker.ts';
import { loadExe, sceneOf } from './engine-load.mjs';
import { ensureAnim } from '../../src/island/ambient/common.ts';

export { tick, press, hold };
export function loadCsi(ctx, opts = {}) {
  const H = loadHub(ctx, { zone: 'z07CSI', node: opts.node ?? 15, vars: opts.vars ?? { 0xa3: 7 }, bricks: opts.bricks });
  // HubContext.soundOf / musicOf (src/hub/ctx.ts): the sound / music behind a handle global of the emulated loaders
  const handles = new Map(H.emu.soundHandles.map((h) => [h.addr, h]));
  H.ictx.soundOf = (addr) => { const h = handles.get(addr); return h && h.kind !== 'music' ? h.id : -1; };
  H.ictx.musicOf = (addr) => { const h = handles.get(addr); return h?.kind === 'music' ? h.name : null; };
  H.fx = new FakeFx(H.world);
  H.ictx.fx = H.fx;                  // the mock's `fx: []` list of hub-load.mjs is not the particle engine src/island/emitters.ts looks for (`ictx.fx`)
  // the framework's ctorInit pass (src/hub/game.ts afterSetup: every node that defines `ctorInit(world, record)`, in record order), then the zone's own afterSetup
  for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
  applyCsiSetup(H.ictx, H.world, H.L);
  H.G = vehicles(H.world);
  return H;
}

/**
 * The castle as the island NPC oracle (tools/lib/m7-isl-npc-emu.mjs `createPair(ctx, loadIsland, ..)`) wants an island: the same world as `loadHub` but WITHOUT the framework's NPC / walker
 * start (the oracle pair starts them itself, in the original's attach order), `profile.island` = the emulated set-up, the story text table loaded (`npcFile`, e.g. `ci/Data/csifsm1.str`).
 */
export function loadCsiAsIsland(ctx, opts = {}) {
  const zone = 'z07CSI', node = opts.node ?? 15;
  const pe = loadExe(ctx.dataRoot), scene = sceneOf(ctx, zone);
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  const zones = readZoneTable(pe), nodes = readStoryFsm(pe), init = readInitialVars(pe);
  const info = zones.find((z) => (z.archive ?? '').toLowerCase() === zone.toLowerCase());
  const vars = new GameVars(); vars.a.set(init); vars.loadNames(pe);
  const story = new StoryFsm(vars, nodes, zones);
  story.applyNewGameDefaults(vars.a.slice(15, 15 + 220));
  story.jump(node);
  vars.set(5, info.index);
  for (const [k, v] of Object.entries(opts.vars ?? { 0xa3: 7 })) vars.set(+k, v);
  const world = new World();
  world.vars = vars; world.externalInput = false;
  const profile = profileFor(zone, pe, scene, undefined, { emuVars: vars, archive });
  const emu = profile.emu;
  profile.island = emu;
  const L = setupZone(scene, archive, profile, { world, pe, subgame: info.index, from: '' });
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
    fx: new FakeFx(world),
    animClip(name) { return emu.dictionaries.anims.get(name); },
    switchVar(name) { return emu.dictionaries.switches.get(name); },
    rigOf(record) { return rigs.get(record); },
    shared: {}, hub: {}, scene,
  };
  installCtx(world, ictx);
  // the animation instances the loader gave records (the framework's world work, src/hub/game.ts afterSetup)
  for (const r of emu.loaderRigs) { const rec = world.records[r.record]; if (rec) ensureAnim(world, rec); }
  waypoints.load(archive);
  if (messages && opts.npcFile) { try { ictx.text.npc = loadMessages(messages, [opts.npcFile]); } catch { /* none */ } }
  return {
    world, L, ictx, pe, scene, archive, vars, story, profile, emu, pepper: L.pepper, node, messages, info,
    rec: (name) => world.records.find((r) => r.name === name),
    recs: (name) => world.records.filter((r) => r.name === name),
    index: (name) => world.records.findIndex((r) => r.name === name),
  };
}
