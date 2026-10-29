// The front end, zone z00FRE (archive z60FRE): FUN_00470ac3 (the loop), FUN_0047172c (set-up), FUN_00471070 (stage and camera), the menu (pages 0..14 of the page
// table) and the credits. A fixed camera looks at the stage where Pepper rides his skateboard back and forth (fenodes.ts); the menu panels are drawn over it.
// Returns the next zone like every zone run function: -1 after "new game" / "load game" (the zone loop's pending override then picks the zone), -2 for "Stoppen".
//
// Loop (verified on FUN_00470ac3): mode 7 fade in (16 ticks) -> 0 (music starts, one tick) -> 2 (the scene runs, the menu is active); the menu's result codes:
//   -1 quit the program (page 1 "yes"), -4 credits, -3 leave for the game (new game / load), 1 a menu action that ends the menu (not used by the shipped pages).
// Leaving fades out over 16 ticks (mode 8).
import { Renderer } from '../render/index.ts';
import type { Shell } from './shell.ts';
import type { ZoneInfo } from './tables.ts';
import { World } from '../game/world.ts';
import { buildRecords } from '../game/zone.ts';
import { GameRenderer } from '../game/render.ts';
import type { Loaded } from '../game/setup.ts';
import { GameRecord, RF_ENABLED } from '../game/record.ts';
import { AnimInstance } from '../game/anim.ts';
import { attachNode, updatePass } from '../game/controller.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import { lightSetFromLgt } from '../render/index.ts';
import { buildMatrix } from '../formats/matrix.ts';
import { parseLgt } from '../formats/lights.ts';
import { FE_OUTFITS } from './fenodes.ts';
import './fenodes.ts';
import { LoopMachine, MODE, EXIT, HUB_CONFIG } from './loopmachine.ts';
import { MR } from './menuui.ts';
import { Credits, buildCredits } from './credits.ts';
import { loadMessages, CREDITS_FILES } from '../ui/strings.ts';
import type { FogSetup } from '../formats/zoneparams.ts';

/** FUN_00442d90(4.0, 1500, 1500, 600, 0xffffffff, 0) in FUN_00471070: the stage has no fog */
const FE_FOG: FogSetup = { near: 4, farMin: 1500, farMax: 1500, fogFrac: 600, color: 0xffffffff, enabled: false, at: 0x471070 };
/** the camera: eye (0, 11, 56.8) looking at (0, 11, 0) (DAT_009da5e8 stores in FUN_00471070: 0x41300000 / 0x42633333) */
const FE_EYE: [number, number, number] = [0, 11, 56.8], FE_TARGET: [number, number, number] = [0, 11, 0];

export async function loadingScreen(sh: Shell) {
  const ui = sh.ui, gl = sh.gl;
  gl.fixed43 = false;
  gl.resize();
  gl.begin([0, 0, 0], new Float32Array(16));
  ui.begin(sh.canvas.width, sh.canvas.height);
  ui.text(1, sh.msgs.label('!LOADING'), 320, 380, { colour: 0, align: 'centre' });
  ui.flush();
  await new Promise((r) => setTimeout(r, 16));
}

export async function runFrontEnd(sh: Shell, _info: ZoneInfo): Promise<number> {
  await loadingScreen(sh);
  sh.gl.fixed43 = true;   // widescreen: the stage's backdrop is a flat 4:3 painting (docs/re/widescreen.md)
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
  // FUN_00471070: record 0 = Pepper, 1 = the skateboard; the 18 stage characters (table 0x8c9150) stay hidden until Pepper borrows their outfit
  const pepper = recs[0];
  if (mfig) { pepper.anim = new AnimInstance(mfig); pepper.anim.start(41, 0); }
  const skate = recs[1];
  if (skbd) { skate.anim = new AnimInstance(skbd); skate.anim.start(3, 0); }
  const outfits = FE_OUTFITS.map((i) => recs[i]).filter(Boolean);
  const shadow = recs.find((r) => r.name === 'SHAD') ?? null;
  attachNode(pepper, 'FEPepper', 0, 2, 1, 1, { skate, shadow, outfits, supe: recs[19] ?? null, darr: recs[21] ?? null });
  pepper.flags |= RF_ENABLED;
  // the second animated stage figure (record 8, FUN_004729f6: clip 0x74)
  if (mfig && recs[8]) { recs[8].anim = new AnimInstance(mfig); recs[8].anim.start(0x74, Math.floor(Math.random() * 20)); }
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
  sh.audio.enterZone('z60FRE');
  // the credits text (FUN_00471bfa)
  const creditMsgs = loadMessages(await sh.data.archive('messages'), CREDITS_FILES);
  const credits = new Credits(buildCredits(sh.pe, creditMsgs, (cls, s) => sh.ui.measure(cls === 0 ? 0 : 1, s).w));
  let showCredits = false;

  const m = new LoopMachine(HUB_CONFIG);
  m.mode = MODE.FADE_IN; m.fade = 0;
  let creditsOn = false;
  let exitNext: number | null = null;
  let leaving = false;
  sh.attachMenuKeys();
  const after = sh.creditsThen;     // coming from the end of the story: the credits first
  sh.creditsThen = null;
  if (after !== null) { creditsOn = true; showCredits = true; } else sh.menu.open(0, 0, false);
  const live = { mode: m.mode, page: 0 };
  Object.assign(window as unknown as Record<string, unknown>, { __fe: live });

  const tick = (): boolean => {
    sh.input.update();
    const pressed = sh.input.pressed;
    // FUN_00470ac3 mode 7 / 0 / 2 / 8
    switch (m.mode) {
      case MODE.FADE_IN:
        m.fade += 0.0625;
        if (m.fade >= 1) { m.fade = 1; m.mode = MODE.INIT; }
        break;
      case MODE.INIT:
        m.mode = MODE.PLAY;
        break;
      case MODE.PLAY: {
        world.tick();
        if (!creditsOn) {
          const r = sh.menu.step(pressed, sh.pointer);
          if (r !== 0) {
            sh.menu.close();
            if (r === MR.QUIT) { sh.quit = true; exitNext = -2; leaving = true; }
            else if (r === MR.ABANDON) { exitNext = -1; leaving = true; }
            else if (r === MR.CREDITS) { creditsOn = true; showCredits = true; credits.pos = -480; credits.done = false; }
            else sh.menu.open(0, 0, false);
            if (leaving) m.mode = MODE.FADE_OUT;
          }
        } else if (credits.tick(pressed)) {
          creditsOn = false; showCredits = false;
          if (after !== null) { exitNext = after; leaving = true; m.mode = MODE.FADE_OUT; } else sh.menu.open(0, 0, false);
        }
        break;
      }
      case MODE.FADE_OUT:
        m.fade -= 0.0625;
        if (m.fade <= 0) { m.fade = 0; return true; }
        break;
    }
    live.mode = m.mode; live.page = sh.menu.engine.page;
    return false;
  };
  const render = (alpha: number, dt: number) => {
    gr.render(m.mode === MODE.PLAY || m.mode === MODE.FADE_OUT ? alpha : 1, dt);
    sh.ui.begin(sh.canvas.width, sh.canvas.height);
    if (showCredits) credits.draw(sh.ui);
    else if (m.mode === MODE.PLAY) sh.menu.draw(sh.ui, sh.menuSet);
    sh.ui.fade(m.fade);
    sh.ui.flush();
  };
  await sh.runLoop(tick, render);
  sh.gl.fixed43 = false;
  sh.detachMenuKeys();
  offOpt();
  sh.menu.close();
  world.destroy();
  void EXIT; void updatePass;
  return exitNext ?? -1;
}
