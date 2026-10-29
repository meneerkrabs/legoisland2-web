// The front end, zone z00FRE (archive z60FRE): FUN_00470ac3 (the loop), FUN_0047172c (set-up), FUN_00471070 (stage, camera and the behaviour nodes), the menu (pages 0..14 of the page
// table) and the credits. A fixed camera looks at the stage where Pepper rides his skateboard back and forth; the nodes of the stage (fenodes.ts: Pepper, the frozen figure, the train,
// the Brickster; the island's butterfly node on BFS0..6) and the credits' peeking characters (credits.ts) are exact ports checked against the original in the x86 interpreter
// (tools/tests/m5-audit-fe-emu.mjs, m5-audit-fe-credits.mjs; docs/re/m5/audit-fe.md). The menu panels are drawn over the scene.
// Returns the next zone like every zone run function: -1 after "new game" / "load game" (the zone loop's pending override then picks the zone), -2 for "Stoppen".
//
// Loop (verified on FUN_00470ac3): mode 7 fade in (17 ticks, no update) -> 0 (music starts, one tick) -> 2 (the scene runs, the menu is active); the menu's result codes:
//   -1 quit the program (page 1 "yes"): mode 8, -4 credits, -3 leave for the game (new game / load): var 5 differs from var 0x59, so the loop leaves at once, 1 a menu action that ends
//   the menu (not used by the shipped pages). Leaving runs the exit block: 17 passes of update + render with the fade running 1.0 -> 0.0 (the stage keeps moving; after mode 8 it starts again at 1.0).
import { Renderer } from '../render/index.ts';
import type { Shell } from './shell.ts';
import type { ZoneInfo } from './tables.ts';
import { World } from '../game/world.ts';
import { buildRecords } from '../game/zone.ts';
import { GameRenderer } from '../game/render.ts';
import type { Loaded } from '../game/setup.ts';
import { GameRecord, RF_ENABLED, RF_FRUSTUM } from '../game/record.ts';
import { AnimInstance } from '../game/anim.ts';
import { Controller, attachNode } from '../game/controller.ts';
import { ButterflyNode } from '../island/ambient/animals.ts';
import { ArgView } from '../island/args.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import { lightSetFromLgt } from '../render/index.ts';
import { buildMatrix } from '../formats/matrix.ts';
import { parseLgt } from '../formats/lights.ts';
import { FE_REC, FX_NONE, feTables } from './fenodes.ts';
import type { FeEnv, FeFx } from './fenodes.ts';
import { ZoneParticles, NO_HANDLE } from '../fx/particles/zone.ts';
import { applyUiOffsets } from './uioffsets.ts';
import { LoopMachine, MODE, EXIT, HUB_CONFIG } from './loopmachine.ts';
import { MR } from './menuui.ts';
import { startLoading, stopLoading } from './loading.ts';
import { Credits, buildCredits } from './credits.ts';
import { loadMessages, CREDITS_FILES } from '../ui/strings.ts';
import { debugAids } from '../game/debug.ts';
import type { FogSetup } from '../formats/zoneparams.ts';

/** FUN_00442d90(4.0, 1500, 1500, 600, 0xffffffff, 0) in FUN_00471070: the stage has no fog */
const FE_FOG: FogSetup = { near: 4, farMin: 1500, farMax: 1500, fogFrac: 600, color: 0xffffffff, enabled: false, at: 0x471070 };
/** the camera: eye (0, 11, 56.8) looking at (0, 11, 0) (DAT_009da5e8 stores in FUN_00471070: 0x41300000 / 0x42633333) */
const FE_EYE: [number, number, number] = [0, 11, 56.8], FE_TARGET: [number, number, number] = [0, 11, 0];

export async function runFrontEnd(sh: Shell, _info: ZoneInfo): Promise<number> {
  startLoading(sh);
  const archive = await sh.data.archive('z60FRE');
  const scene = await sh.data.zoneScene('z60FRE');
  const data = buildRecords('z60FRE', scene, archive);
  const world = new World();
  world.vars = sh.vars;
  world.externalInput = true;
  world.input = sh.input;
  world.zone = 'z60FRE';
  world.records = data.records;
  world.col.records = data.records;
  world.sfx = sh.audio;
  const recs = data.records;
  // FUN_00471070 re-places the two backdrop planes G000 / G001 with scale 1.2 / 0.975 (FUN_0043a742(rec + 0xc, rx, ry, rz, x, y, z, sx, sy, sz); the floats are the hex immediates)
  const f = (u: number) => { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, u); return dv.getFloat32(0); };
  const placeScaled = (r: typeof recs[number] | undefined, pos: [number, number, number], k: number) => {
    if (!r) return;
    r.m.set(buildMatrix(0, 0, 0, pos[0], pos[1], pos[2], k, k, k)); r.scale = [k, k, k]; r.savePrev();
  };
  placeScaled(recs[42], [f(0xc0ef4bc7), f(0x415ce560), f(0xc0315810)], f(0x3f99999a));
  placeScaled(recs[43], [f(0xc0d9c28f), f(0x415ce560), f(0x413651ec)], f(0x3f79999a));
  const blk = (name: string): Blk | null => { const e = archive.find(`anim/${name}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const mfig = blk('MFIG'), skbd = blk('SKBD');
  // FUN_0047ec85 (asm 0x48aff8 ..): animation instances for records 0 .. 21: rig 0 (MFIG) on every record but record 1 (rig 1, SKBD = the skateboard), each started on clip 1 frame 0
  for (let i = 0; i <= 21; i++) {
    const rig = i === 1 ? skbd : mfig;
    if (rig && recs[i]) { const an = new AnimInstance(rig); an.start(1, 0); recs[i].anim = an; }
  }
  // the renderer and the particle engine come first: the nodes' constructors start their emitters
  // camera
  const cam = world.camera;
  cam.c.fill(0); cam.c[0] = FE_EYE[0]; cam.c[1] = FE_EYE[1]; cam.c[2] = FE_EYE[2]; cam.c[3] = FE_TARGET[0]; cam.c[4] = FE_TARGET[1]; cam.c[5] = FE_TARGET[2]; cam.c[7] = 1;
  cam.updateView(); cam.savePrev();
  let lights = null;
  const lgt = archive.find('lights/lights.lgt');
  if (lgt) { try { lights = lightSetFromLgt(parseLgt(archive.read(lgt))); } catch (e) { console.warn('lgt', e); } }
  let shadowArchive = null;
  try { shadowArchive = await sh.data.archive('Shadow'); } catch { /* no blob shadow */ }
  const dummy = new GameRecord('DUMM');
  const loaded = { world, data, pepper: dummy, profile: { zone: 'z60FRE', subgame: 0, seaLevel: 0, gravity: -10, hub: false, ground: null, hide: [], rig: 'MFIG' }, walk: null, rigs: new Map(), setup: null, skipped: [], hasPlayer: false, notes: [] } as unknown as Loaded;
  const gr = new GameRenderer(sh.gl as Renderer, sh.data, archive, scene, loaded, { fog: [FE_FOG], seaLevel: null }, lights, shadowArchive);
  gr.slider = sh.options.drawDistance;
  const offOpt = sh.onOption(() => { gr.slider = sh.options.drawDistance; });
  // FUN_0047172c: FUN_00442900("z60FRE") = the front end's particle engine (the archive has its own Particle folder: trainsmoke01, eatpizza); FUN_0044e8d0 is not called here (no [SPLASH] extras).
  // The engine runs once per loop pass (FUN_00442930 in every mode of FUN_00470ac3's main loop, `fx.step()` below), not per update pass.
  const fx = await ZoneParticles.create({ sh, gr, world, archive });
  if (fx) fx.manual = true;
  const feFx: FeFx | undefined = fx ? {
    start: (name, matrix, pos, rot, gate) => { const h = fx.start(name, matrix as never, pos, rot, gate); return h === NO_HANDLE ? FX_NONE : h; },
    setMatrix: (h, matrix) => fx.setMatrix(h, matrix as never),
  } : undefined;
  // FUN_00471070: the behaviour nodes of the stage, attached in the original's order (record 0 Pepper, 8, 2, 44, then the butterflies 41 .. 35); the constructors run at the attach
  const nodeEnv: FeEnv = { tables: feTables(sh.pe), fx: feFx, swapModel: (r) => { if (r.model) gr.setModel(r, r.model); } };
  for (const [i, name] of [[FE_REC.PEPPER, 'FEPepper'], [FE_REC.FIGURE, 'FEFigure'], [FE_REC.BRICKSTER, 'FEBrickster'], [FE_REC.TRAIN, 'FETrain']] as [number, string][]) {
    const n = attachNode(recs[i], name, 0, 2, 1, 1, nodeEnv as unknown as Record<string, unknown>) as unknown as { init(w: World, r: GameRecord): void };
    n.init(world, recs[i]);
  }
  // FUN_004b2d44 (the island's butterfly, src/island/ambient) on BFS0 .. BFS6 with the range argument 8.0 (local_60[0] = 0x41000000)
  const butterflyArgs = new Uint8Array(0x80);
  new DataView(butterflyArgs.buffer).setFloat32(0, 8, true);
  for (let i = FE_REC.BUTTERFLY_LAST; i >= FE_REC.BUTTERFLY_FIRST; i--) {
    const node = new ButterflyNode(new ArgView(butterflyArgs));
    node.var = 2; node.mask = 1; node.value = 1;
    recs[i].ctrl = recs[i].ctrl ?? new Controller();
    recs[i].ctrl!.attach(node, 0);
  }
  world.ext.set('frustum', true);   // record flag 1 is kept per tick (below), the butterflies freeze and reset when they were out of view for 200 ticks
  const pepper = recs[FE_REC.PEPPER];
  world.focus = pepper;             // FUN_0042207d(record 0): DAT_009da5d0, the record the controllers' distances are measured to (the butterflies follow it)
  sh.audio.enterZone('z60FRE');
  // the credits text (FUN_00471bfa)
  const creditMsgs = loadMessages(await sh.data.archive('messages'), CREDITS_FILES);
  const credits = new Credits(buildCredits(sh.pe, creditMsgs, (cls, s) => sh.ui.measure(cls === 0 ? 0 : 1, s).w));
  let showCredits = false;

  const m = new LoopMachine(HUB_CONFIG);
  m.mode = MODE.FADE_IN; m.fade = 0;
  let creditsOn = false;
  let exitNext: number | null = null;
  /** the exit fade of the loop (FUN_00470ac3 after the main loop: 17 passes with the fade 1.0 .. 0.0, the update pass keeps running): null while not leaving */
  let leaveFade: number | null = null;
  sh.attachMenuKeys();
  applyUiOffsets();                 // FUN_00471070's last call, FUN_0041c080 -> FUN_004201aa: the menu / panel text offsets 0x12 / -2 from here on (uioffsets.ts)
  sh.menu.open(0, 0, false);
  // the Ontwikkelaarshoek (src/devcorner): debug mode only, `dev` is null otherwise
  const dev = debugAids() ? (await import('../devcorner/index.ts')).attachFront({ sh, world, gr, machine: m, openPage: (p) => { if (!creditsOn && leaveFade === null) sh.menu.open(p, 0, false); } }) : null;
  const live: { mode: number; page: number; leave: number | null; gr: GameRenderer; fx: ZoneParticles | null } = { mode: m.mode, page: 0, leave: null, gr, fx };
  Object.assign(window as unknown as Record<string, unknown>, { __fe: live, __feWorld: world });

  /** FUN_00444370 (called from FUN_00470a73 every pass): record flag 1 = the record is enabled and its collision sphere is inside the view */
  const frustumFlags = () => {
    for (const r of recs) {
      const co = r.colObj;
      if ((r.flags & RF_ENABLED) === 0) r.flags &= ~RF_FRUSTUM;
      else if (!co || gr.sphereVisible(r.toWorld(co.col.center), co.radius)) r.flags |= RF_FRUSTUM;
      else r.flags &= ~RF_FRUSTUM;
    }
  };

  const tick = (): boolean => {
    sh.input.update();
    if (dev) {
      if (dev.tick()) return false;   // the corner is open and pauses the front end
      if (dev.leaveRequest && leaveFade === null) { sh.menu.close(); exitNext = -1; leaveFade = 1; }   // the corner chose a zone (like a checkpoint)
    }
    const pressed = sh.input.pressed;
    if (leaveFade !== null) {
      // the leave block: FUN_0042226e / FUN_00427233 / FUN_004225c5 once per pass, the fade starts again at 1.0; it has no FUN_00442930: the particles are neither moved nor drawn any more
      gr.particles = null;
      frustumFlags();
      world.tick();
      m.fade = leaveFade;
      leaveFade -= 0.0625 * world.dt;      // FUN_00470ac3: `local_6c - _DAT_008923cc * DAT_008b1718` (per dt)
      live.leave = leaveFade;
      return leaveFade < 0;
    }
    // FUN_00470ac3 mode 7 / 0 / 2 / 8
    switch (m.mode) {
      case MODE.FADE_IN:
        if (m.fade >= 1) { m.fade = 1; m.mode = MODE.INIT; } else m.fade += 0.0625 * world.dt;
        break;
      case MODE.INIT:
        m.mode = MODE.PLAY;
        break;
      case MODE.PLAY: {
        frustumFlags();
        world.tick();
        if (!creditsOn) {
          const r = sh.menu.step(pressed, sh.pointer);
          if (r !== 0) {
            sh.menu.close();
            if (r === MR.QUIT) { sh.quit = true; exitNext = -2; m.mode = MODE.FADE_OUT; }                    // -1: local_24 = -2, mode 8
            else if (r === MR.ABANDON) { exitNext = -1; leaveFade = 1; }                                       // -3 / the checkpoint list: var 5 differs from var 0x59, the loop leaves at once
            else if (r === MR.CREDITS) { creditsOn = true; showCredits = true; credits.pos = -480; credits.done = false; }
            else sh.menu.open(0, 0, false);
          }
        } else if (credits.tick(pressed, recs, world.dt)) {
          creditsOn = false; showCredits = false;
          sh.menu.open(0, 0, false);
        }
        break;
      }
      case MODE.FADE_OUT:
        if (m.fade <= 0) { m.fade = 0; leaveFade = 1; } else m.fade -= 0.0625 * world.dt;
        break;
    }
    fx?.step();   // FUN_00442930 -> FUN_0044e8e0: the particle engine's update (+ the draw in the render hook) once per pass of the main loop, in every mode of it
    live.mode = m.mode; live.page = sh.menu.engine.page;
    return false;
  };
  const render = (alpha: number, dt: number) => {
    gr.render(dev ? dev.alpha(m.mode === MODE.PLAY || m.mode === MODE.FADE_OUT ? alpha : 1) : m.mode === MODE.PLAY || m.mode === MODE.FADE_OUT ? alpha : 1, dt);
    sh.ui.begin(sh.canvas.width, sh.canvas.height);
    if (showCredits) credits.draw(sh.ui);
    else if (m.mode === MODE.PLAY) sh.menu.draw(sh.ui, sh.menuSet);
    sh.ui.fade(m.fade);
    sh.ui.flush();
  };
  stopLoading();
  sh.gl.fixed43 = true;   // widescreen: the stage's backdrop is a flat 4:3 painting (docs/re/widescreen.md); the loading card's frames drew with it off
  await sh.runLoop(tick, render);
  sh.gl.fixed43 = false;
  dev?.destroy();
  sh.detachMenuKeys();
  offOpt();
  sh.menu.close();
  world.destroy();
  void EXIT;
  return exitNext ?? -1;
}
