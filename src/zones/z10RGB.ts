// z10RGB "cannon duel" (the Bull castle, story arc of the castle hub z07CSI): cross the bridge while the nine cannons of Cedric ("Simon") shoot at you, take one of
// the four cannons on the far side, aim and fire at his cannons; four hits on you inside a cannon end the game. Ported in M6 (docs/re/m6/z10RGB.md): the zone loop
// FUN_005f418b (modes 7 / 0 / 1 / 9 / 2 / 3 / 4 / 5 / 8: the runner's template), the five behaviour nodes (src/zones/z10rgb/), the HUD, the intro / help / banner
// texts, the speech, the sounds and the result variables. This file registers the constructors and the zone game (the glue to the shell).
import { registerCtor } from '../game/setup.ts';
import { restoreHooks } from '../restore/flag.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { MODE as LOOP } from '../shell/loopmachine.ts';
import { UiTextureSet } from '../ui/renderer2d.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { ScreenLine, Medal } from '../shell/helpscreen.ts';
import { CTOR, K, MODE, PHASE, REC, VAR, f32 } from './z10rgb/consts.ts';
import { RgbState } from './z10rgb/shared.ts';
import { NO_HANDLE, ZoneParticles } from '../fx/particles/zone.ts';
import { updateBalls } from './z10rgb/balls.ts';
import { PepSwitcNode, PeppHitNode } from './z10rgb/pepper.ts';
import { CannonNode, CedricNode } from './z10rgb/enemy.ts';
import { RgbGameNode, initRgb } from './z10rgb/game.ts';
import { ROUTE, aimKeys, nextTarget, planShot, steerKeys } from './z10rgb/bot.ts';
import { SoundBank } from './z10rgb/sound.ts';
import type { SoundBackend } from './z10rgb/sound.ts';

export { CTOR };

/** the state the nodes share in one run (the original's globals); a new one is made by the `rgbgame` constructor, i.e. every time the zone starts */
export let state = new RgbState();
/** tests replace the random source before the zone is set up */
export const options: { rng?: () => number } = {};
registerCtor(CTOR.RGBGAME, () => {
  state = new RgbState(options.rng ? { next: options.rng } : undefined);
  return new RgbGameNode(state);
});
registerCtor(CTOR.PEPSWITC, () => new PepSwitcNode(state));
registerCtor(CTOR.PEPPHIT, () => new PeppHitNode(state));
registerCtor(CTOR.CEDRIC, () => new CedricNode(state));
registerCtor(CTOR.CANNON, (a) => {
  const k = REC.CC.indexOf(a.record as never);
  return new CannonNode(state, k, Math.trunc(state.rand(K.CANNON_DELAY)));
});

/** the textures of the aiming gauge (Overlays/Z10RGB: the segments 3 3 3 2 2 2 1 1 1 1 1 1 of FUN_005f712e's table at DAT_05d4e0c8) */
const GAUGE_SEGMENTS = [3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1];

/** the medal and the lines of the end banner of a won game (FUN_005f798f): gold from 7001, silver from 4001 */
export function bannerOf(score: number): { medal: Medal; ids: { id: string; y: number }[] } {
  if (score >= K.GOLD) return { medal: 3, ids: [{ id: 'CASGRB01', y: 200 }] };
  if (score >= K.SILVER) return { medal: 2, ids: [{ id: 'CASGRB02', y: 200 }, { id: 'CASGRB03', y: 0x140 }] };
  return { medal: 1, ids: [{ id: 'CASGRB04', y: 200 }] };
}

registerZoneGame('z10RGB', async (ctx: ZoneGameCtx): Promise<ZoneGame> => {
  const { world, archive, hud, sh } = ctx;
  const st = state;
  st.bind(world);
  initRgb(st, world, { pe: sh.pe, archive: archive as never });
  st.say = (id) => ctx.say(id);
  ctx.gr.fov = st.fov;

  // ---- particles: FUN_005f67b0 creates the engine ("z10rgb" archive); FUN_005f8050 (the ball pool, from FUN_005f690b) starts one `impact01` per ball on the ball's matrix at
  // (0, 0.8, 0), rotated -pi / 2 about x, gate OFF, with LAND as its collision record; FUN_0044e8d0 follows in the loop's set-up (FUN_005f418b); the PepSwitc constructor FUN_005f4f14
  // (FUN_005f48d0) then starts the four `dust` emitters (cannonhit.par) on the four cannons CP00..CP03 at (0, 0, 4), rotated -0.3295 about x, gated by var 0xfd bit k (set by the hit
  // inside cannon k, FUN_005f542f). The balls switch theirs on at a ground hit and off 2 ticks into the splash (`balls.ts`).
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const up = f32(0x3f4ccccd), tilt = f32(0xbfc90fdb);
    for (const b of st.balls) {
      b.fxHandle = fx.start('impact01.par', b.rec.m, [0, up, 0], [tilt, 0, 0]);
      fx.collideWith(b.fxHandle, world.records[REC.LAND]);
    }
    fx.finish();
    REC.CP.forEach((r, k) => fx.start('dust', world.records[r].m, [0, 0, f32(0x40800000)], [f32(0xbea8f5c3), 0, 0], [VAR.PEPP_CANNON_BIT, 1 << k, 1 << k]));
    st.fx = {
      ballOn(b) { if (b.fxHandle !== NO_HANDLE) { fx.on(b.fxHandle); fx.setMatrix(b.fxHandle, b.rec.m); } },
      ballOff(b) { fx.off(b.fxHandle); },
    };
  }
  // ---- the ball shadows (FUN_005f90f7, after the records, before the particles): CSHD's five vertices = the ground points of every flying ball whose ground was found this tick
  const cshd = world.records[REC.CSHD];
  // CSHD's flags are |= 3 for the loop and &= ~2 afterwards (so the model is hidden from the second frame on); it is drawn at its own matrix (10.7, -13.7, -2.8: the builder FUN_005f9xxx
  // puts it there), the points being world coordinates: the original's shadows lie 13.7 under the ground and show only where the ground is lower (faithful, docs/re/m6/z10RGB.md)
  ctx.gr.meshDraws = () => {
    cshd.flags |= 3;
    const out = st.balls.filter((b) => b.state === 2 && b.shadow !== 0).map((b) => ({ rec: cshd, verts: b.samples }));
    cshd.flags &= ~2;
    return out;
  };

  // ---- sounds: 2D ones through the engine's slots, 3D ones positional; the listener is the camera
  const ga = sh.audio.ga;
  const bank = new SoundBank((ga?.sfx as unknown as SoundBackend | undefined) ?? null);
  void bank.load();
  st.sound = bank;
  st.cue = (name, pos) => restoreHooks.cue?.(name, { sfxAt: (id: number, p: readonly number[]) => sh.audio.playAt(id, p), pos });     // restored content (option off: the hook is unset)
  const listen = () => {
    const c = world.camera.c;
    ga?.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };

  // ---- the barrel overlay of the aiming view (FUN_005f4dd2 draws texture 0 of `barrel/` over the screen while the mode word is 4)
  let barrel: UiTextureSet | null = null;
  try { barrel = UiTextureSet.load(sh.gl.gl, archive, 'barrel'); } catch { barrel = null; }

  hud.visible = false;
  hud.left = { tex: -1, tint: 0xffffffff }; hud.right = { tex: -1, tint: 0xffffffff };
  hud.gauge = null;

  const syncHud = () => {
    if (st.score < 0) st.score = 0;                       // FUN_005f78b6 clamps the score (a short) every tick
    hud.centreText = String(st.score);
    hud.rightText = st.hud.rightText;
    hud.leftText = '';
    hud.gauge = st.hud.gauge ? { value: st.hud.value, min: st.hud.min, max: st.hud.max, segments: GAUGE_SEGMENTS, marker: -1, icon: st.hud.icon } : null;
  };
  let wasBanner = false;

  const game: ZoneGame & { assist: unknown } = {
    /** test aids (not part of the game): the scripted player's decisions for the headless browser runs (tools/steps/m6-z10RGB*.mjs press the keys) */
    assist: {
      state: st, route: ROUTE,
      steer: (dx: number, dz: number) => steerKeys(world.camera.c, dx, dz),
      nextTarget: () => nextTarget(st),
      plan: (point: number[]) => planShot(st, point),
      aim: (plan: { rx: number; ry: number }) => { const c = st.cannons[st.pepperCannon]; return c ? aimKeys(c.rec.rx, c.rec.ry, plan) : null; },
    },
    introId: 'HOLOA',
    helpControls: 0xb,
    tickInBanner: true,
    onStart() { st.phase = PHASE.BRIDGE; },
    beforeTick() { updateBalls(st); },
    update() {
      syncHud();
      listen();
      return st.resultMode || undefined;
    },
    beforeRender() { ctx.gr.fov = st.fov; },
    onBanner() {
      if (wasBanner) return;
      wasBanner = true;
      ctx.stopSpeech();
      if (st.phase === PHASE.WON) {
        const b = bannerOf(st.score);
        ctx.say(b.ids[0].id, b.ids[1]?.id ?? null);
      } else ctx.say('CASGRB05');
      st.saidBanner = true;
    },
    bannerTick() { updateBalls(st); listen(); },
    draw2d(ui: Ui2D, dt: number, mode: number) {
      // the barrel first, the HUD (gauge, score) over it, like the original's order (FUN_005f40f4 before FUN_0046055f)
      if (barrel && world.vars.get(VAR.MODE) === MODE.CANNON) ui.sprite(barrel, 0, [0, 0, 640, 480], 0xffffffff);
      if (mode === LOOP.PLAY) { hud.visible = true; hud.draw(ui, dt * 30); hud.visible = false; }
    },
    drawBanner(ui: Ui2D) {
      if (st.phase === PHASE.WON) {
        const b = bannerOf(st.score);
        const lines: ScreenLine[] = b.ids.map((l) => ({ text: ctx.strings?.text(l.id) ?? l.id, y: l.y, wrap: 30 }));
        ctx.banner(ui, { score: { text: String(st.score), y: 100 }, medal: b.medal, lines });
      } else ctx.banner(ui, { lines: [{ text: ctx.strings?.text('CASGRB05') ?? 'CASGRB05', y: 100, wrap: 30 }] });
    },
    destroy() { bank.stopAll(); barrel?.dispose(); ctx.gr.meshDraws = null; },
    debug() {
      return {
        phase: st.phase, score: st.score, ticks: st.ticks, mode: world.vars.get(VAR.MODE), cannonsLeft: st.cannonsLeft, lives: st.lives, inCannon: st.pepperCannon,
        cedricAt: st.cedricAt, resultMode: st.resultMode, vulnerable: st.vulnerable, balls: st.balls.map((b) => b.state), fov: st.fov,
        pepper: [st.pepper.x, st.pepper.y, st.pepper.z], timers: st.cannons.map((c) => c.timer),
      };
    },
  };
  return game;
});
