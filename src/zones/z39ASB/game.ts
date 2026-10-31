// The zone game of z39ASB (Asteroid Belt) for the generic zone runner (src/shell/playzone.ts): the simulation is `AsteroidBelt` (belt.ts, driven by the shuttle behaviour
// node's update like FUN_007b82dd), this file adds what FUN_007b63f6 / FUN_007b7281 / FUN_007b60e8 / FUN_007b61a4 do around it: the narrow camera zoom, the sounds, the
// speech, the HUD (FUN_0046055f data), the star field backdrop and the end banner.
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { debugAids } from '../../game/debug.ts';
import type { World } from '../../game/world.ts';
import { MODE } from '../../shell/loopmachine.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import type { Medal } from '../../shell/helpscreen.ts';
import { GATE_ON, ZoneParticles } from '../../fx/particles/zone.ts';
import { AsteroidBelt, BeltRng, VAR, medalIndex } from './belt.ts';
import type { BeltEvent } from './belt.ts';
import { Backdrop } from './backdrop.ts';
import { BeltSound } from './sound.ts';
import { SCORE_TEXT, hudSprites, toVirtual } from './hudmodel.ts';

/** address of the shuttle behaviour's constructor (FUN_007b96a0), attached to record 1 by FUN_007b70a1 */
export const CTOR_SHUTTLE = 0x7b96a0;
/** DAT_0089df2c = 0x3e99999a (FUN_007b7281): the camera zoom (vertical field of view in radians) of the zone, 1.0 elsewhere */
export const ASB_FOV = Math.fround(0.3);
/** FUN_007b7281: "\data\messages\OG\Data\asb.str" is the zone's message table; the speech ids of FUN_007b63f6 / FUN_007b7f68 / FUN_007b61a4 */
export const SAY = { INTRO: 'OGSGAB13', HIT: ['OGSGAB06', 'OGSGAB07'], FAIL: 'OGSGAB04', BY_MEDAL: ['OGSGAB03', 'OGSGAB02', 'OGSGAB01'] } as const;

/** FUN_007b780c: the exhaust emitters' offsets on SHUT (0x40828f5c / 0x3fb851ec / 0x3fd33333, float32) */
export const ASB_EXHAUST: readonly (readonly [number, number, number])[] = [[0, Math.fround(4.08), 0], [Math.fround(1.44), Math.fround(1.65), 0], [-Math.fround(1.44), Math.fround(1.65), 0]];

/** the shuttle behaviour node: its update is FUN_007b82dd; the belt is created by the zone game (the node exists from the set-up, before the game) */
export class ShuttleNode implements BehaviourNode {
  readonly kind = 'Shuttle';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  belt: AsteroidBelt | null = null;
  /** ticks run through the node (the game falls back to driving the belt itself when this stays 0) */
  ran = 0;
  update(w: World, _rec: GameRecord, _ctrl: Controller): number {
    if (!this.belt) return NODE_NONE;
    this.belt.update({ held: w.input.held }, w.dt);
    this.ran++;
    return NODE_STOP;
  }
}

export async function createAsbGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, gr } = ctx;
  const recs = world.records;
  const shut = recs.find((r) => r.name === 'SHUT');
  const hull = recs.find((r) => r.name === 'HULL');
  const asteroids = recs.filter((r) => r.name.startsWith('AST')).slice(0, 256);   // FUN_007b6ff2: names starting with "AST", at most 256
  if (!shut || !hull) throw new Error('z39ASB: SHUT / HULL records missing');
  gr.fov = ASB_FOV;
  const ga = ctx.sh.audio.ga;
  const sound = new BeltSound(ga);
  void sound.load();
  // FUN_007b7281: FUN_004431e0("Asteroid", ...) starts the MIDI ambience bed of the zone (ambience table key `Asteroid`, Asteroid_Amb.mid); the music (Asteroids.sgt, key Z38PAR) is played by the shell
  ga?.ambience.start('Asteroid').catch(() => { /* silent */ });
  const onEvent = (e: BeltEvent) => {
    sound.event(e);
    if (e.type === 'hit') ctx.say(SAY.HIT[e.voice]);
  };
  const belt = new AsteroidBelt({ shut, hull, asteroids }, world.camera.c, new BeltRng(), ctx.vars, onEvent);
  world.camera.updateView();
  world.camera.savePrev();
  // FUN_007b780c (first call, DAT_008adc74 == -1): three `rocket01.par` on the SHUT record (record 1, 0x74) at (0, 4.08, 0) / (1.44, 1.65, 0) / (-1.44, 1.65, 0), no rotation, gate (2, 1, 1) = on
  const fxz = await ZoneParticles.create(ctx);
  if (fxz) {
    const hs = ASB_EXHAUST.map((p) => fxz.start('rocket01.par', shut.m, p, [0, 0, 0], GATE_ON));
    fxz.finish();
    belt.fxGate = (on) => { for (const h of hs) { if (on) fxz.on(h); else fxz.off(h); } };
  }
  const node = shut.ctrl?.find<ShuttleNode>('Shuttle') ?? null;
  if (node) node.belt = belt;
  // FUN_007b63f6 runs ONE update of the shuttle node before the loop (FUN_0042226e(records + 0x68, 1) after the set-up): the first tick of the state machine happens before mode 7
  if (node) { belt.update({ held: 0 }, world.dt); node.ran++; }
  // the star field: SKY_ record = background.Msh, texture list of its model
  const sky = recs.find((r) => r.name === 'SKY_');
  const texList = sky?.model?.parts?.[0] ? ctx.scene.texLists[sky.model.parts[0].texList] : null;
  let backdrop: Backdrop | null = null;
  if (texList && texList[0] !== undefined && texList[0] >= 0) {
    try { backdrop = new Backdrop(gr.renderer, ctx.archive, texList[0]); } catch (e) { console.warn('z39ASB backdrop', e); }
  }
  gr.backdrop = backdrop ? (r, eye, fwd) => { if (belt.started) backdrop!.draw(eye, fwd); } : null;
  // the 2D layer is available once the Overlays set is: sprite scale 800x600 -> 640x480
  const K = 0.8;
  // test aids like the stub runner's: F9 finishes the course (success path), F10 empties the hull (failure path); both act on the next tick while flying
  let aid: 0 | 1 | 2 = 0;
  const onKey = (e: KeyboardEvent) => { if (e.code === 'F9') { aid = 1; e.preventDefault(); } else if (e.code === 'F10') { aid = 2; e.preventDefault(); } };
  if (typeof addEventListener === 'function' && debugAids()) addEventListener('keydown', onKey);   // only with the debug option: the original has no such keys

  const game: ZoneGame & { belt: AsteroidBelt; node: ShuttleNode | null; sound: BeltSound } = {
    belt, node, sound,
    introId: SAY.INTRO,
    helpControls: 4,
    update() {
      // without the attach (a world built without the extraction) the game drives the shuttle itself
      if (!node) belt.update({ held: world.input.held }, world.dt);
      if (aid && belt.aid(aid)) aid = 0;
      sound.tick(belt.stateIn, belt.engine);
      return belt.result;
    },
    // FUN_007b63f6 plays the loops and sets the listener once per loop pass (not per browser frame): once per sim step, in every loop mode
    everyTick() { sound.frame(world.camera.c); },
    onBanner(result) {
      // FUN_007b63f6 case 2: stop the speech, then OGSGAB04 on failure or the line of the medal (var 0x102)
      ctx.stopSpeech();
      belt.bannerStep();
      if (result === 2) ctx.say(SAY.FAIL);
      else ctx.say(SAY.BY_MEDAL[ctx.vars.get(VAR.MEDAL)] ?? null);
    },
    bannerTick() { belt.bannerStep(); },
    draw2d(ui, _dt, mode) {
      if (mode !== MODE.PLAY) return;
      const set = ctx.hud.set;
      if (set) for (const s of hudSprites(belt.slotTint, belt.gauge, belt.frameTint)) { const v = toVirtual(s, K); ui.sprite(set, v.tex, v.rect, v.tint); }
      ui.text(1, belt.scoreText, SCORE_TEXT.x * K, SCORE_TEXT.y * K, { colour: 0, align: 'centre' });
    },
    drawBanner(ui, result) {
      // FUN_007b61a4: the score (%d of DAT_05d5d528, 0 after a failure), the medal text (STD.str) at y 150 and the zone line at y 200
      const medal: Medal = result === 2 ? 0 : ((medalIndex(belt.finalScore) + 1) as Medal);
      const id = result === 2 ? SAY.FAIL : SAY.BY_MEDAL[medalIndex(belt.finalScore)];
      ctx.banner(ui, { score: { text: String(belt.finalScore), y: 100 }, medal, medalY: 150, lines: [ctx.line(id, 200, 30)] });
    },
    destroy() {
      if (typeof removeEventListener === 'function') removeEventListener('keydown', onKey);
      sound.stopAll();
      try { ga?.ambience.stop(); } catch { /* silent */ }
      gr.backdrop = null;
      gr.fov = 1.0;     // FUN_007b63f6 after the loop: DAT_0089df2c = 1.0
    },
    debug() {
      const b = belt;
      return { state: b.state, score: b.score, hits: b.hits, hull: b.hull, speed: b.speed, z: shut.z, x: shut.x, y: shut.y, eyeZ: world.camera.c[2], camOff: b.camOff, result: b.result, frame: b.frame, trophy: ctx.vars.get(VAR.TROPHY), hiscore: ctx.vars.get(VAR.HISCORE), medal: ctx.vars.get(VAR.MEDAL), nodeRan: node?.ran ?? -1 };
    },
  };
  return game;
}
