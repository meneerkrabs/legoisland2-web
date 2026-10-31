// z02LGI, the island (zone table ids 2 / 31 / 32 / 33 = story eras 0 / 1 / 2 / 3, era 4 from node 0x3d is id 2 again): the island's zone game on top of the
// generic hub runner (playzone.ts). Loop FUN_004afaf7 (docs/re/m4/wp8-island.md):
//   set-up  FUN_004b6475 runs in the x86 emulation against the live game variables (profileFor(..., { islandVars })), the IslandCtx is installed before the
//           behaviour nodes are built (registerZoneSetup), the arrival place FUN_004c2d22 (arrival.ts), FUN_00423bf0 (island totals), var 0x120 = 1,
//           the HUD set-up FUN_004b8ef0, the 41 cutscene slots of the set-up (FUN_0045c310 / FUN_0045c397).
//   mode 1  waits for any button (DAT_00983840 != 0) with the frozen world on screen;
//   mode 2  FUN_0045c402 (cutscene frame) -> controllers (world.tick) -> FUN_004636fc (empty) -> FUN_004b908d (HUD, hud.ts updateIsland) -> draw;
//           then FUN_00423bad (story FSM) and, when var 0x58 changed, the story handler FUN_004b7040 (story.ts); FUN_00423f7b (debug auto-advance) is not ported.
// Importing this module registers the zone game, its set-up hooks and (through src/island/index.ts) every behaviour constructor of the island.
import { ZoneParticles } from '../../fx/particles/zone.ts';
import '../../island/index.ts';
import { debugAids } from '../../game/debug.ts';
import { installCtx } from '../../island/ctx.ts';
import { registerZoneGame, registerZoneSetup } from '../../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import { EXIT } from '../../shell/loopmachine.ts';
import type { CutsceneSlotSpec } from '../../shell/cutscene-host.ts';
import { computeIslandTotals } from '../z03PPH/totals.ts';
import { parseCompiledWaypoints } from '../../formats/waypoints.ts';
import type { Archive } from '../../formats/archive.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import { V } from '../../game/vars.ts';
import { waypoints, MAP_PATH, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../game/walker.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../island/npc/index.ts';
import { startPizzaNodes, placePizzaBalls } from '../../island/pizza/index.ts';
import { runCtorInits } from '../../island/blockio.ts';
import { islandRigs, ensureAnim } from '../../island/ambient/common.ts';
import { vehicles, runSetups } from '../../island/vehicles/common.ts';
import { looksOf, applyRosterRecords } from '../../island/vehicles/looks.ts';
import { IslandContext } from './ctx.ts';
import { BrickLibrary } from '../../formats/bricks.ts';
import { installBrickLibrary, islandBrickFx, drawBrickFx } from '../../fx/bricks/index.ts';
import { loadLegoStuds, drawLegoStuds } from '../../mods/lego3d/studs.ts';
import { storyHandler } from './story.ts';
import type { StoryEnv, StoryRef } from './story.ts';
import { arrival, emulatedVehicle } from './arrival.ts';
import type { Arrival } from './arrival.ts';
import { restoreHooks } from '../../restore/flag.ts';

const CTX_KEY = 'island';
/** the island context the set-up hooks created for this world */
const islandOf = (w: World) => w.ext.get(CTX_KEY) as IslandContext;

/** FUN_00462be9(1, n): node positions of the PATH map (W_PATH_C.wpt) */
export function pathPositions(archive: Archive): (n: number) => readonly number[] | null {
  const e = archive.find('Waypoints/W_PATH_C.wpt');
  if (!e) return () => null;
  const nodes = parseCompiledWaypoints(archive.read(e)).nodes;
  return (n) => { const x = nodes[n]; return x ? [x.x, x.y, x.z] : null; };
}

/** the StoryEnv of the live island (`setupCall`: the set-up's own call, whose flag / variable writes the emulation already made) */
export function liveStoryEnv(ictx: IslandContext, setupCall = false): StoryEnv {
  const w = ictx.world, g = ictx.goal;
  return {
    cutsceneActive: () => !setupCall && ictx.cutsceneActive(),
    vars: setupCall ? { get: (i) => w.vars.get(i), set: () => {}, or: () => {}, andNot: () => {} } : w.vars,
    flags: (r) => (w.records[r]?.flags ?? 0) & 0xffff,
    setFlags: (r, v) => { const rec = w.records[r]; if (rec && !setupCall) rec.flags = (rec.flags & ~0xffff) | (v & 0xffff); },
    freeTexts: () => { ictx.setText('npc', null); ictx.setText('hol', null); },
    npcText: (a) => ictx.setText('npc', ictx.pe.cstr(a)),
    holText: (a) => ictx.setText('hol', ictx.pe.cstr(a)),
    objRecord: (r, rad) => g.record(r, rad),
    objPair: (a, b, rad) => g.pair(a, b, rad),
    objFour: (a, b, c, d) => g.four(a, b, c, d),
    objNode: (n, rad) => g.pathNode(n, rad),
    holoAlert: () => { if (!setupCall) g.alertHolo(); },
    pizzaReset: (r) => {
      if (setupCall) return;
      // FUN_00429638: the Pizza node (0x429d1b) of the record; its port implements `storyReset(a, b)` (+0x24 = a, +0x20 = b, +0x34 = 0, +0x2e = 0)
      for (const n of w.records[r]?.ctrl?.nodes ?? []) {
        const p = n as unknown as { ctor?: number; storyReset?(a: number, b: number): void };
        if (p.storyReset && (p.ctor === undefined || p.ctor === 0x429d1b)) { p.storyReset(0, 0); return; }
      }
    },
    walkerPin: (r, node) => {
      if (setupCall) return;
      const rec = w.records[r], h = rec?.ctrl?.walker ?? 0;
      if (!rec || !h) return;
      waypoints.setNode(h, node, rec); waypoints.teleport(h, node); rec.savePrev();
    },
  };
}

// ---- set-up hooks: the emulated set-up, the context, the arrival place
registerZoneSetup('z02LGI', {
  profileOptions: (sh, archive) => ({ islandVars: sh.vars, archive }),
  cutsceneOptions: (_sh, world) => ({ waypoints, dictionaries: islandOf(world).setup.dictionaries }),
  // (a save made in a vehicle keeps it through the exact node blocks: SGwalk's block holds the vehicle record's tag (DAT_009daa80), the boat / helicopter / car blocks their state; WP-SAVE)
  beforeSetup(sh, world, profile, archive, scene) {
    const island = profile.island as IslandSetup;
    const ictx = new IslandContext(world, sh.pe, archive, island, scene);
    ictx.pathPos = pathPositions(archive);
    installCtx(world, ictx);
    const veh = emulatedVehicle(island);
    profile.start = (_arc, records) => {
      const a = arrival(sh.vars.get(V.PREV_SUBGAME), sh.vars.get(V.FSM_CURRENT_STATE), (i) => { const r = records[i]; return r ? [r.x, r.y, r.z] : [0, 0, 0]; }, ictx.pathPos, veh);
      ictx.shared.arrival = a;
      return a ? { pos: a.pos, yaw: a.yaw } : null;
    };
  },
  afterSetup(_sh, world, loaded, archive) {
    const ictx = islandOf(world);
    runCtorInits(world);   // WP-SAVE: the nodes' constructor-time reads of the world (building doors / swinging parts / pop-in node, Sound3d ...) right after the set-up, as the original's constructors do
    applyRosterRecords(world, ictx.pe);   // FUN_0051c823 (PepSwitc's constructor): variant words, the decor templates hidden (S11)
    islandWorldSetup(world, loaded, archive);
    const a = ictx.shared.arrival as Arrival | null | undefined;
    if (!a || a.vehicle < 0) return;
    // the vehicle gets Pepper's matrix (FUN_004c2d22's copy) and PEPPER_CONTROL its mode, when a node for that mode is on Pepper's chain (WP6)
    const v = world.records[a.vehicle];
    if (v) { v.x = a.pos[0]; v.y = a.pos[1]; v.z = a.pos[2]; v.ry = a.yaw; v.rebuildYaw(); v.savePrev(); }
    const chain = loaded.pepper.ctrl?.nodes ?? [];
    if (chain.some((n) => n.var === V.PEPPER_CONTROL && (n.mask & a.control) !== 0 && n.value === a.control)) {
      world.vars.set(V.PEPPER_CONTROL, a.control);
      vehicles(world).current = v ?? null;   // DAT_009daa80 = the vehicle (FUN_004c2d22); its node takes Pepper in on its first update (WP6 / WP13)
    }
    else loaded.notes.push(`arrival in vehicle record ${a.vehicle} (PEPPER_CONTROL 0x${a.control.toString(16)}): no node for that mode yet, walking`);
  },
});

/** FUN_0042207d: Pepper's lane offset (0x3c23d70a) */
const PEPPER_LANE = 0.01;

/**
 * The constructors' world work after the framework's attaches (WP3 / WP5 / WP6): the set-up's waypoint maps (FUN_004630c0), the animation instances of the loader, the walkers of the pizza /
 * NPC / vehicle nodes in the set-up's attach order, Pepper's own walker, the docks / pads the boats / helicopters / Pteras claim in their constructors. The save tests (tools/lib/m8-save.mjs) run it too.
 */
export function islandWorldSetup(world: World, loaded: { pepper: GameRecord }, archive: Archive): void {
  const ictx = islandOf(world);
  // the set-up's waypoint maps (FUN_004630c0) and the constructors' world work (walkers, ground snap, animations: WP3)
  loadIslandWalkMaps(archive, ictx.setup);
  // the animation instances the island loader gives records 9..66 (FUN_004f645b @0x519c09: SKBD, MFIG, SWFT, RBBT, PTER rigs, clip 1)
  for (const i of islandRigs(ictx.pe).keys()) { const r = world.records[i]; if (r) ensureAnim(world, r); }
  world.records[vehicles(world).board]?.anim?.start(0, 0);   // FUN_004b4220's last call: FUN_0043b6a3(board instance, 0, 0) (the loader had started clip 1)
  startPizzaNodes(world);   // before the NPCs: WP3's Human1 reads the car's speed from the walker the pizza nodes create (docs/re/m4/wp5-pizza.md)
  startIslandNpcs(world);
  placePizzaBalls(world);   // the football's constructor copy of kid 0's matrix, after the kids are on their routes
  // FUN_0042207d(PEPP): Pepper's walker on PATH (no node) with the NPC tuning; the cutscenes walk / turn her with it
  const pep = loaded.pepper;
  if (pep.ctrl) {
    const h = waypoints.create(MAP_PATH, pep, -3);
    pep.ctrl.walker = h;
    if (h) {
      waypoints.setSpeed(h, NPC_SPEED); waypoints.setLane(h, PEPPER_LANE); waypoints.setTurnRate(h, NPC_TURN_RATE);
      waypoints.setRadiusMin(h, NPC_RADIUS_MIN); waypoints.setRadiusMax(h, NPC_RADIUS_MAX); waypoints.setRadiusLimit(h, NPC_RADIUS_LIMIT);
    }
  }
  vehicles(world).islandSetup();   // FUN_004b6475: the dock / helipad taken words (static in the original) are zeroed
  runSetups(world);   // the boats' / helicopters' / Pteras' constructor work (dock and pad claims in attach order), after the walk maps loaded
}


/** the cutscene slots of the set-up (FUN_0045c366(dir, area) + FUN_0045c397(slot, script, strings)) */
function slotSpecs(island: IslandSetup, archiveName: string): CutsceneSlotSpec[] {
  return island.cutscenes.filter((c) => c.slot !== null && !!c.name).map((c) => ({
    slot: c.slot!, script: c.name!, strings: c.messages ?? c.name!, area: c.area ?? 'li',
    zone: !c.zoneDir || c.zoneDir.toLowerCase() === archiveName.toLowerCase() ? archiveName : c.zoneDir,
  }));
}

class IslandGame implements ZoneGame {
  readonly ctx: ZoneGameCtx;
  readonly ictx: IslandContext;
  /** the loop's local_8: the node the story handler last handled */
  readonly ref: StoryRef = { prev: -1, next: -10 };
  /** the handler asked to leave: the next zone (local_24), -1 none */
  next = -1;
  /** story-handler calls during play (diagnostics: node, return) */
  readonly storyLog: { node: number; prev: number; ret: number; tick: number }[] = [];
  private offKey: () => void;
  private aid = false;

  config = { intro: true, help: false };
  introPanel = false;

  constructor(ctx: ZoneGameCtx, ictx: IslandContext) {
    this.ctx = ctx; this.ictx = ictx;
    const vars = ctx.vars;
    computeIslandTotals(vars);                // FUN_00423bf0
    vars.set(0x120, 1);                       // LGI_GAMELOOP
    ctx.hud.initIsland(vars);                 // FUN_004b8ef0
    // the set-up's own story-handler call (prev uninitialised): message tables and objective; its record / variable writes were made by the emulation
    storyHandler(liveStoryEnv(ictx, true), { prev: -1, next: -10 }, vars.get(V.FSM_CURRENT_STATE));
    this.ref.prev = vars.get(V.FSM_CURRENT_STATE);
    // dev aid (not in the original; kept from the M2 stub): F9 completes the condition of the current story node
    const onKey = (e: KeyboardEvent) => { if (e.code === 'F9') { this.aid = true; e.preventDefault(); } };
    if (debugAids()) addEventListener('keydown', onKey);   // only with the debug option: the original has no such key
    this.offKey = () => removeEventListener('keydown', onKey);
    restoreHooks.islandStart?.(this);          // restored content (option off: unset)
  }

  /** FUN_0045c402: the cutscene frame, before the controllers */
  beforeTick() { this.ctx.cutscene.tick(); }

  update(): number | undefined {
    restoreHooks.islandTick?.(this);           // restored content (option off: unset)
    this.ctx.cutscene.applyCarried();   // WP2: actors a script attached to another (until every carrier node is ported)
    if (this.aid) {
      this.aid = false;
      const sh = this.ctx.sh, nd = sh.nodes[sh.story.node];
      if (nd) sh.vars.set(nd.var, (sh.vars.get(nd.var) & ~nd.mask) | nd.value);
    }
    return undefined;
  }

  /** after FUN_00423bad: FUN_004b7040 when var 0x58 changed */
  storyTick(): number | undefined {
    const node = this.ctx.vars.get(V.FSM_CURRENT_STATE);
    if (node === this.ref.prev) return undefined;
    const prev = this.ref.prev;
    const ret = storyHandler(liveStoryEnv(this.ictx), this.ref, node);
    if (this.ref.prev !== prev || ret !== EXIT.RUNNING) this.storyLog.push({ node, prev, ret, tick: this.ctx.world.tickCount });   // (a running cutscene defers it: not logged)
    if (ret === EXIT.RUNNING) return undefined;
    this.next = this.ref.next;
    return ret;
  }

  /** the loop's exit: local_24 = the handler's zone (exit 2), else the runner's mapping (exit 6 -> FUN_00404be7, 8 -> var 5, 0 -> front end) */
  exitNext(exit: number): number | undefined {
    if (exit === EXIT.FINISHED && this.next >= 0) return this.next;
    return undefined;
  }

  draw2d(ui: Ui2D) {
    // the cutscene's SAYTEXT subtitle (FUN_0045d47f)
    if (this.ctx.cutscene.active()) this.ctx.cutscene.draw(ui);
  }

  destroy() { this.offKey(); this.ctx.cutscene.abort(); }

  debug() {
    const ic = this.ictx, g = ic.goal;
    return {
      node: this.ctx.vars.get(V.FSM_CURRENT_STATE), era: ic.era, prev: this.ref.prev, next: this.next, texts: { ...ic.textPaths },
      objective: { mode: g.mode, recs: [...g.recs], node: g.node, holoTimer: g.holoTimer, target: ic.objective.target(this.ctx.world.focus ?? null) },
      cutscene: this.ctx.cutscene.active(), missingCutscenes: this.ictx.missingCutscenes, storyLog: this.storyLog.slice(-10), arrival: ic.shared.arrival ?? null, notes: this.ctx.loaded.notes,
      skipped: this.ctx.loaded.skipped.length, attaches: ic.setup.attaches.length,
    };
  }
}

registerZoneGame('z02LGI', async (ctx) => {
  const ictx = islandOf(ctx.world);
  let messages: Archive | null = null;
  try { messages = await ctx.sh.data.archive('messages'); } catch { /* no texts */ }
  ictx.bind(ctx, messages);
  // FX_Particles (WP-PART): the zone's `Particle/` effects (src/fx/particles/zone.ts), drawn after the brick effects
  try { ictx.fx = await ZoneParticles.create(ctx); } catch (e) { console.warn('island particles', e); }
  // FX_Bricks (WP9): the brick library (archives `Bricks` + `BrickMorph`, opened at start-up by the original, FUN_0043421d) and the effects pass
  try {
    const [bricks, morph] = await Promise.all([ctx.sh.data.archive('Bricks'), ctx.sh.data.archive('BrickMorph')]);
    installBrickLibrary(ctx.world, new BrickLibrary(ctx.sh.pe, bricks, morph));
    const legoStuds = loadLegoStuds(ctx.archive);   // the "LEGO 3D" mod's stud geometry (src/mods/lego3d/studs.ts): null without such a mod, then nothing changes
    ctx.gr.effects = (r) => { const fx = islandBrickFx(ctx.world); if (fx) { drawBrickFx(r, fx); if (legoStuds) drawLegoStuds(r, fx.lib, legoStuds, ctx.world.records); } };
  } catch (e) { console.warn('island bricks', e); }
  // SwapText.c (FUN_00443810 / FUN_004439f0): the vehicles' looks replace the model's texture table by textures of the SwapText bank (island/vehicles/looks.ts)
  try {
    ctx.gr.swapArchive = await ctx.sh.data.archive('SwapText');
    ctx.gr.swapTextures = (rec, lod) => looksOf(ctx.world)?.textures(rec, lod) ?? null;
  } catch (e) { console.warn('island swaptext', e); }
  // slots whose script or message file is not in the data are left empty (LGICI05 has no LI/Data/LGICI05.str: the original's text load fails silently)
  const specs = slotSpecs(ictx.setup, ctx.info.archive ?? 'z02LGI').filter((sp) => {
    const have = !!ctx.archive.find(`cutscene/${sp.script}.cut`) && (!messages || !!messages.find(`${sp.area}/Data/${sp.strings}.str`));
    if (!have) ictx.missingCutscenes.push(sp.script);
    return have || sp.zone.toLowerCase() !== ctx.archive.name.toLowerCase();
  });
  try { await ctx.cutscene.declare(specs); } catch (e) { console.warn('island cutscenes', e); }
  return new IslandGame(ctx, ictx);
});
