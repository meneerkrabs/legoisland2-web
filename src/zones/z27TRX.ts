// z27TRX "T-Rex Racing" (Adventure Island mini-game, story node of the pyramid's neighbour): Pepper rides a T-Rex down a three-lane track to the main camp. The zone loop
// FUN_007656f2 is the runner's loop template; the zone's own code (the rex node FUN_0076a39b, the props FUN_0076649a ...) is ported in src/zones/z27trx/ (pure, node-testable).
// This file registers the constructors and the zone game: HUD, sounds, speech, the banner, the camp fog (docs/re/m6/z27TRX.md).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import { BANNER, CTOR, MSG, PHASE, SND_2D, SND_3D, VAR, VIEW } from './z27trx/consts.ts';
import { prepareTrx } from './z27trx/prepare.ts';
import type { TrxGame } from './z27trx/prepare.ts';
import { TrexNode } from './z27trx/trex.ts';
import { GateNode, VolcNode, SlogNode, BldrNode, EggNode, BrontyNode, SpectatorNode } from './z27trx/props.ts';
import { bindGate, meshParts } from './z27trx/gate.ts';
import { NullSound, nameOf } from './z27trx/run.ts';
import { GATE_ON, NO_HANDLE, PARAM, ZoneParticles } from '../fx/particles/zone.ts';
import { RF_ENABLED, RF_FRUSTUM } from '../game/record.ts';
import type { GameRecord } from '../game/record.ts';

/** a float32 constant by its bit pattern in the executable */
const f32 = (bits: number): number => new Float32Array(new Uint32Array([bits]).buffer)[0];
import type { TrxSound } from './z27trx/run.ts';

// the constructors of the zone's nodes (registered for the extraction's `Attach.ctor` list; `prepareTrx` binds the real ones by record name like FUN_0076649a)
registerCtor(CTOR.TREX, () => new TrexNode());
registerCtor(CTOR.GATE, () => new GateNode());
registerCtor(CTOR.VOLC, () => new VolcNode());
registerCtor(CTOR.SLOG, () => new SlogNode());
registerCtor(CTOR.BLDR, () => new BldrNode());
registerCtor(CTOR.EGG, () => new EggNode());
registerCtor(CTOR.BRONTY, () => new BrontyNode());
registerCtor(CTOR.ANIM, () => new SpectatorNode());

/** the zone's sound slots through the game's audio engine (the first play of an id only loads it, like the rest of the port) */
class BrowserSound implements TrxSound {
  private sfx: NonNullable<ZoneGameCtx['sh']['audio']['ga']>['sfx'];
  private slots = new Map<number, SoundSlot>();
  constructor(sfx: NonNullable<ZoneGameCtx['sh']['audio']['ga']>['sfx']) {
    this.sfx = sfx;
    for (const id of SND_2D) sfx.load2D(id).then((s) => this.slots.set(id, s)).catch(() => { /* silent */ });
    for (const id of SND_3D) sfx.load3D(id).then((s) => this.slots.set(id, s)).catch(() => { /* silent */ });
  }
  play(id: number) { const s = this.slots.get(id); if (s) this.sfx.play2D(s); }
  at(id: number, pos: ArrayLike<number>) { const s = this.slots.get(id); if (s) this.sfx.play3D(s, { x: pos[0], y: pos[1], z: pos[2] }); }
  stop(id: number) { const s = this.slots.get(id); if (s) this.sfx.stop(s); }
  playing(id: number) { const s = this.slots.get(id); return !!s && !this.sfx.isIdle(s); }
  stopAll() { for (const s of this.slots.values()) this.sfx.stop(s); }
}

/** FUN_0076560f: the clock "%d:%02d" of ftol(ticks / 30) seconds */
export function clockText(ticks: number): string {
  const secs = Math.trunc(ticks / 30);
  return `${Math.trunc(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

async function trxGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, loaded, archive, vars, sh, hud, scene } = ctx;
  const rig = (n: string): Blk | null => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const ga = sh.audio.ga;
  const sound: TrxSound = ga ? new BrowserSound(ga.sfx) : new NullSound();
  const g: TrxGame = prepareTrx(world, loaded.pepper, {
    rigs: { TREX: rig('TREX')!, MFIG: rig('MFIG')!, TRIC: rig('TRIC'), STEG: rig('STEG'), BREX: rig('BREX'), BRON: rig('BRON') },
    models: scene.models, pe: sh.pe, sound, say: (id) => ctx.say(id),
  });
  const { run, node } = g;
  // a model swap of an egg: the renderer builds its record views from the models, so it has to look again
  for (const e of g.eggs) e.node.onModel = () => ctx.gr.refreshViews();
  ctx.gr.refreshViews();
  ctx.gr.fov = VIEW.FOV;                       // FUN_0040cd1a(0.75)
  ctx.gr.useFogCall(VIEW.FOG_NORMAL_INDEX);   // FUN_00442d90(4, 450, 450, 100, 0xcacce1, 1) of the zone init (the other calls are the vehicle variant and the restart)
  if (g.gate && g.gateRec) {
    const doors = bindGate(g.gate, meshParts(scene, archive, g.gateRec));
    const gateRec = g.gateRec;
    ctx.gr.partMatrices = (rec) => (rec === gateRec ? doors : undefined);
  }

  // ---- particles: FUN_0076b070 (the zone's start-up): the distance LOD (DAT_05d3b0a0 = 1), then for every record in record order: VOLC: `trexvol01` at (0, 4, 0) and `trexvol03` at (0, 10.4, 0),
  // BURN: `trexburn` at the origin, PEPP: `trexfeet` (gate off, handle DAT_05d5d2b8), all on the record's live matrix, rotated -pi / 2 about x, volcano / fire gate (2, 1, 1) = always on.
  // The rex node switches `trexfeet` (TrxFx): on after a landing / crash / fire, off for a jump, an obstacle and the end; its parent matrix is the rex record's, its force is speed * 0.1.
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    fx.setLod(true);
    const tilt = f32(0xbfc90fdb);
    let feet = NO_HANDLE;
    for (const r of world.records) {
      const name = nameOf(r);
      if (name === 'VOLC') {
        fx.start('trexvol01', r.m, [0, f32(0x40800000), 0], [tilt, 0, 0], GATE_ON);
        fx.start('trexvol03', r.m, [0, f32(0x41266666), 0], [tilt, 0, 0], GATE_ON);
      } else if (name === 'BURN') fx.start('trexburn', r.m, [0, 0, 0], [tilt, 0, 0], GATE_ON);
      else if (name === 'PEPP') feet = fx.start('trexfeet', r.m, [0, 0, 0], [tilt, 0, 0]);
    }
    fx.finish();
    run.fx = { feetOn: () => fx.on(feet), feetOff: () => fx.off(feet), feetMatrix: () => fx.setMatrix(feet, run.pepp.m), feetForce: (v) => fx.setParam(feet, PARAM.FORCE, v) };
    run.fx.feetMatrix(); run.fx.feetForce(0);       // FUN_0076adc5
  }
  /** FUN_00444370: record flag 1 = enabled and (no collision object or its sphere inside the view); the spectators read it (the renderer's planes are those of the last drawn frame) */
  const frustum = (rec: GameRecord) => {
    if ((rec.flags & RF_ENABLED) === 0) return false;
    const co = rec.colObj;
    return !co || ctx.gr.sphereVisible(rec.toWorld(co.col.center), co.radius);
  };

  hud.visible = false;
  hud.left = { tex: 0, tint: 0xffffffff };      // DAT_05d4dd14 = 0 / DAT_05d4dd18 = -1: the hit counter's icon
  hud.right = { tex: 1, tint: 0xffffffff };     // DAT_05d4dd38 = 1 / DAT_05d4dd3c: dimmed while the rex blinks
  hud.leftText = '0'; hud.rightText = ''; hud.centreText = clockText(run.clock);
  let fogDone = false, bannerDone = false;
  const syncHud = () => {
    hud.leftText = run.hitsText;
    hud.centreText = clockText(run.clock);
    hud.right = { tex: 1, tint: run.hudDim ? 0xff7f7f7f : 0xffffffff };
  };
  /** FUN_004434d0: the listener is the camera target, looking along the view */
  const listen = () => {
    const c = world.camera.c;
    ga?.sfx.setListener({ x: c[3], y: c[4], z: c[5] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };
  listen();

  const medal = () => vars.get(VAR.MEDAL);
  const game: ZoneGame = {
    config: { intro: true, help: true },
    introId: MSG.INTRO,
    helpControls: 6,
    onStart() { hud.visible = true; },
    update() {
      for (const sp of g.spectators) sp.rec.flags = frustum(sp.rec) ? sp.rec.flags | RF_FRUSTUM : sp.rec.flags & ~RF_FRUSTUM;
      syncHud();
      listen();
      if (run.arrivalFog && !fogDone) { fogDone = true; ctx.gr.useFogCall(7); }     // FUN_00442d90(34, 250, 250, 100, ...) of FUN_0076ac33
      if (vars.get(VAR.PHASE) === PHASE.OVER) return medal() !== 0 ? 1 : 2;       // the loop: var 0xfa == 7; success = the medal is not 0
      return 0;
    },
    onBanner() {
      hud.visible = false;
      ctx.stopSpeech();
      if (bannerDone) return;
      bannerDone = true;
      const m = medal();
      if (m === 0) ctx.say(MSG.LOST[0], MSG.LOST[1]);
      else if (m === 1) ctx.say(MSG.BRONZE);
      else if (m === 2) ctx.say(MSG.SILVER[0], MSG.SILVER[1]);
      else ctx.say(MSG.GOLD[0], MSG.GOLD[1]);
    },
    draw2d(_ui: Ui2D, _dt: number, _mode: number) { /* the HUD is the shell's */ },
    drawBanner(ui: Ui2D) {
      const m = medal() as 0 | 1 | 2 | 3;
      ctx.banner(ui, {
        score: { text: String(run.score).padStart(5, ' '), y: BANNER.SCORE_Y },      // "%5d"
        medal: m, medalY: BANNER.MEDAL_Y,
        lines: BANNER.LINES[m].map(([id, y]) => ctx.line(id, y, BANNER.WRAP)),
      });
    },
    destroy() { if (sound instanceof BrowserSound) sound.stopAll(); },
    debug() {
      return {
        phase: vars.get(VAR.PHASE), medal: medal(), score: run.score, hits: node.hits, z: node.z, speed: node.speed, lane: node.lane, offset: node.offset, clock: node.clock, timeout: run.timeout,
        stunned: node.stunned, burning: node.burning, jumping: node.jumping, blink: node.blink, clip: loaded.pepper.anim?.clip, frame: loaded.pepper.anim?.frame,
        x: loaded.pepper.x, y: loaded.pepper.y, hiscore: vars.get(VAR.HISCORE), trophy: vars.get(VAR.TROPHY), spoken: [...run.spoken], clockText: clockText(run.clock),
        gate: g.gate?.angle ?? 0, eggs: g.eggs.map((e) => e.node.state).join(''), bldr: g.bldrs.map((b) => b.node.state).join(''),
      };
    },
  };
  return game;
}
registerZoneGame('z27TRX', trxGame);
