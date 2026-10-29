// z15SSH "Slangen schieten" (Adventure Island, zone table index 12): ported in M6 (docs/re/m6/z15SSH.md). Registers the constructors of the zone's two behaviour
// nodes (`Walk` = the coconut buggy, `Snake`: src/zones/z15ssh/rules.ts) and the zone game: the HUD (score, gems), the crosshair, the intro / banner texts and
// speech, the sounds, the result variables.
import { ZoneParticles } from '../fx/particles/zone.ts';
import { registerCtor } from '../game/setup.ts';
import { V } from '../game/vars.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame } from '../shell/zonegame.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import type { GameAudio } from '../audio/index.ts';
import {
  CTOR_CART, CTOR_SNAKE, CartNode, SnakeNode, REC, SND, SOUNDS_2D, SOUNDS_3D, applyResult, resultLines, isWin, medalOfResult,
} from './z15ssh/rules.ts';
import type { SshSounds } from './z15ssh/rules.ts';
import { prepareSsh } from './z15ssh/setup.ts';

registerCtor(CTOR_CART, () => new CartNode());
registerCtor(CTOR_SNAKE, () => new SnakeNode());

/** the zone's sounds through GameAudio's own slots (the generic `world.sfx` drops the first play of an id and has no raw volume / 3D): loaded up front, silent without audio */
export class SshAudio implements SshSounds {
  readonly counts = new Map<number, number>();
  private readonly slots = new Map<number, SoundSlot>();
  private readonly ga: GameAudio | null;
  constructor(ga: GameAudio | null) {
    this.ga = ga;
    if (!ga) return;
    for (const id of SOUNDS_2D) ga.sfx.load2D(id).then((s) => this.slots.set(id, s)).catch(() => { /* a file the CD does not have (snake_amb2.wav) */ });
    for (const id of SOUNDS_3D) ga.sfx.load3D(id).then((s) => this.slots.set(id, s)).catch(() => { /* silent */ });
  }
  private count(id: number) { this.counts.set(id, (this.counts.get(id) ?? 0) + 1); }
  play(id: number) { this.count(id); const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.play2D(s); } catch { /* silent */ } } }
  stop(id: number) { const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.stop(s); } catch { /* silent */ } } }
  rate(id: number, hz: number) { const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.setRate(s, hz); } catch { /* silent */ } } }
  volume(id: number, v: number) { const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.setVolumeRaw(s, v); } catch { /* silent */ } } }
  play3D(id: number, x: number, y: number, z: number) { this.count(id); const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.play3D(s, { x, y, z }); } catch { /* silent */ } } }
  stop3D(id: number) { const s = this.slots.get(id); if (s && this.ga) { try { this.ga.sfx.stop(s); } catch { /* silent */ } } }
  /** FUN_004433f0's listener: the camera */
  listener(eye: ArrayLike<number>, target: ArrayLike<number>) {
    if (!this.ga) return;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    try { this.ga.sfx.setListener({ x: eye[0], y: eye[1], z: eye[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 }); } catch { /* silent */ }
  }
}

registerZoneGame('z15SSH', async (ctx) => {
  const { world, loaded, archive, scene, vars, sh, hud, gr } = ctx;
  const audio = new SshAudio(sh.audio.ga ?? null);
  const { node, parts, cart } = prepareSsh(world, loaded, archive, scene, { sounds: audio, say: (id) => ctx.say(id) });
  // FUN_0065760c: FUN_00442900("Z15SSH"); the buggy's constructor FUN_00659d94 starts the two trexfeet emitters
  const fx = await ZoneParticles.create(ctx);
  if (fx) node.startFx(fx, cart);
  gr.partMatrices = parts.overrides;       // the live wheel / turret matrices of the buggy
  gr.refreshViews();                       // the coconut helper records
  // the focus record's blob shadow (Pepper's, SWITCH_GME_PEPPERSSHADOW = var 0xc5, -1 = off) smears over the steep canyon walls under a buggy that follows a path: off for the ride, restored at the end (port decision, docs/re/m6/z15SSH.md)
  const shadowVar = vars.get(V.PEPPERSSHADOW);
  vars.set(V.PEPPERSSHADOW, -1);
  gr.poseRange = 1e9;                     // the original poses every animated record it draws (any distance)
  hud.visible = false;
  hud.left = { tex: -1, tint: 0xffffffff };   // DAT_05d4dd14 = -1: no left icon
  hud.right = { tex: 1, tint: 0xffffffff };   // FUN_00658834: DAT_05d4dd38 = 1 (the gem), DAT_05d4dd3c = -1 (white)
  let bannerDone = false;
  const syncHud = () => {
    hud.centreText = String(node.hudScore);          // sprintf(DAT_05d4dd60, "%d", DAT_05d5bce8)
    hud.rightText = `x${node.hudGems}`;              // sprintf(DAT_05d4dd44, "x%d", DAT_05d5bd44)
  };
  syncHud();
  const resultOf = () => (node.result === 0 ? undefined : isWin(node.result) ? 1 : 2);

  const game: ZoneGame = {
    config: { intro: true, help: true },
    introId: 'ADSGSS14',
    helpControls: 5,
    onStart() {
      hud.visible = true;
      ctx.say('ADSGSS07');                           // FUN_00439bf8(ADSGSS07) + FUN_00435a11 when the help is left (and the music starts)
    },
    update() {
      syncHud();
      audio.listener(world.camera.c, [world.camera.c[3], world.camera.c[4], world.camera.c[5]]);
      return resultOf();
    },
    onBanner(result) {
      hud.visible = false;
      ctx.stopSpeech();
      const lines = resultLines(node.result);
      if (lines.length) ctx.say(lines[0].id, lines[1]?.id);
      if (!bannerDone) { applyResult(vars, node.finalScore, node.result); bannerDone = true; }
      void result;
    },
    draw2d(ui: Ui2D) {
      // FUN_0065817c: the crosshair (overlay texture 0, 64 x 64) where the turret points; the original draws it in every loop mode (the panels of the intro / help / banner / result are drawn over it)
      const c = node.crosshair(cart);
      ui.sprite(hud.set, 0, [c.x - 32, c.y - 32, c.x + 32, c.y + 32], 0xffffffff);
    },
    drawBanner(ui: Ui2D) {
      ctx.banner(ui, {
        score: { text: String(node.finalScore), y: 100 },
        medal: medalOfResult(node.result),
        lines: resultLines(node.result).map((l) => ctx.line(l.id, l.y, 30)),
      });
    },
    destroy() {
      vars.set(V.PEPPERSSHADOW, shadowVar);
      for (const id of [SND.ENGINE, SND.WIND, SND.AMBIENT, SND.OVER_STUDS, SND.GUN_SWIVEL, SND.GUN_TILT]) audio.stop(id);
      audio.stop3D(SND.TRAIN);
    },
    debug() {
      const p = (r: typeof cart) => [r.x, r.y, r.z];
      return {
        score: node.score, gems: node.gems, speed: node.speed, result: node.result, finalScore: node.finalScore, aim: [node.aimYaw, node.aimPitch], yaw: node.yaw,
        states: [...node.states], timers: [...node.timers], coconuts: node.coconuts.filter((c) => c.active).length, time: node.time, reload: node.reload, stage: node.stage,
        cart: p(cart), snakes: REC.SNAKE.map((i) => p(world.records[i])), ticks: node.ticks, log: node.log.slice(-12), sounds: Object.fromEntries(audio.counts),
      };
    },
  };
  (game as ZoneGame & { ssh?: unknown }).ssh = { node, cart, parts, audio };   // for the node tests and the browser bots (window.__zone.game.ssh)
  return game;
});
