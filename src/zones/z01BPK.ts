// z01BPK, the skate park ("Doe zoveel mogelijk stunts in 2 minuten"): the zone loop FUN_0048d8bd / FUN_00493506, the three behaviours of the player record (the zone's own copies of
// PepSwitc FUN_00494091 = the clock and the score, Walk FUN_004944f3 = the walk to the board, skate.c FUN_00492cc2 = the skateboard with the stunts), the scoring FUN_00493ecd and the
// banner FUN_0048d3d1. Docs: docs/re/m6/z01BPK.md; the game logic lives in src/zones/z01bpk/ (pure, node-testable).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { drawIntroScreen } from '../shell/helpscreen.ts';
import type { ScreenLine } from '../shell/helpscreen.ts';
import { MODE } from '../shell/loopmachine.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { BpkRun, BpkSwitch, BpkWalk, CTOR, finishGame, TRICK_NAMES } from './z01bpk/run.ts';
import { BpkSkate } from './z01bpk/skate.ts';
import { prepareBpk, spectatorsTick } from './z01bpk/setup.ts';
import { BpkSoundBank } from './z01bpk/sound.ts';
import type { SoundBackend } from './parachute/sound.ts';

/** the state the three nodes share in one run (the globals of the original); a new one per `PepSwitc` constructor = per zone start */
let shared = new BpkRun();
registerCtor(CTOR.SWITCH, () => { shared = new BpkRun(); return new BpkSwitch(shared); });
registerCtor(CTOR.WALK, () => new BpkWalk(shared));
registerCtor(CTOR.SKATE, () => new BpkSkate(shared));

/** the text of the end banner: the score (y 50, wrap 10), the medal text of STD.str (y 100, wrap 8 / 8 / 6), "BPK1" for a new hi-score (y 150, wrap 20): FUN_0048d3d1 */
export function bannerLines(run: BpkRun, std: { text(id: string): string }, zone: { text(id: string): string }): ScreenLine[] {
  const out: ScreenLine[] = [];
  if (run.finalScore > 0) out.push({ text: String(run.finalScore), y: 50, wrap: 10 });
  if (run.medal === 1) out.push({ text: std.text('SGBRONZE'), y: 100, wrap: 8 });
  else if (run.medal === 2) out.push({ text: std.text('SGSILVER'), y: 100, wrap: 8 });
  else if (run.medal === 3) out.push({ text: std.text('SGGOLD'), y: 100, wrap: 6 });
  if (run.newHiscore === 1) out.push({ text: zone.text('BPK1'), y: 150, wrap: 20 });
  return out;
}

registerZoneGame('z01BPK', async (ctx: ZoneGameCtx): Promise<ZoneGame> => {
  const { world, loaded, archive, vars, hud, sh } = ctx;
  const rig = (n: string): Blk | null => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const g = prepareBpk(world, loaded.pepper, { MFIG: loaded.rigs.get('MFIG') ?? rig('MFIG'), SKBD: rig('SKBD') }, sh.pe);
  const run = g.run;
  const ga = sh.audio.ga;
  const sounds = new BpkSoundBank((ga?.sfx ?? null) as unknown as SoundBackend | null);
  void sounds.load();
  run.sounds = sounds;
  g.swc.onEnd = (score) => finishGame(run, vars, score);
  hud.visible = false;

  const listen = () => {
    const c = world.camera.c;
    const f = [c[3] - c[0], c[4] - c[1], c[5] - c[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    ga?.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 });
  };

  const game: ZoneGame = {
    // the park's own loop: kind 1 in the zone table but with a result menu and the mini-game pause (FUN_0048d84c: FUN_0041bd3d(&mode, 0x40, 1)); the brief BPK2 at y 60, no controls help
    config: { hub: false, pauseKind: 1, pauseMask: 0x40, intro: true, help: false, results: true },
    introId: 'BPK2',
    helpControls: 0,
    onStart() { hud.visible = true; },
    update() {
      spectatorsTick(world, g);
      hud.leftText = run.scoreText;           // DAT_05d4dd20
      hud.centreText = run.clockText;         // DAT_05d4dd60
      listen();
      return run.result || undefined;
    },
    /** FUN_0048d3d1 with DAT_05d580bc < 1: no points, straight to the result menu */
    skipBanner() { return run.finalScore < 1; },
    onBanner() {
      hud.visible = false;
      run.sounds.wheels(false, [0, 0, 0]);
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode !== MODE.PLAY) return;
      // FUN_0048d52b: the name of the stunt Pepper is doing (the zone's BPKnn texts by his clip) at (325, 450), wrap 30
      const id = TRICK_NAMES[g.pepper.anim?.clip ?? -1];
      if (id) ctx.text(ui, id, 325, 450, { maxChars: 30 });
    },
    drawBanner(ui: Ui2D) {
      const lines = bannerLines(run, { text: (id) => sh.std.text(id) }, { text: (id) => ctx.strings?.text(id) ?? id });
      drawIntroScreen(ui, ctx.panelEnv(), lines);
    },
    destroy() { sounds.stopAll(); },
    debug() {
      const s = g.skate;
      return {
        state: s.state, speed: s.speed, maxSpeed: s.maxSpeed, t: s.t, progress: s.progress, trickMid: s.trickMid, onPipe: s.onPipe, grounded: s.grounded, spin: s.spin,
        time: g.swc.time, score: g.swc.score, pending: g.swc.pending, trickScore: run.trickScore, trickFlag: run.trickFlag, result: run.result, finalScore: run.finalScore,
        medal: run.medal, newHiscore: run.newHiscore, control: vars.get(0x5e), clip: g.pepper.anim?.clip, pos: [g.pepper.x, g.pepper.y, g.pepper.z],
        walk: { state: g.walk.state, turned: g.walk.turned }, hiscore: vars.get(0xc0), trophy: vars.get(0x8d),
        clock: run.clockText, scoreText: run.scoreText,
        /** what the scripted skater decides from (tools/lib/bpk-bot.mjs `bpkSnapshot`) */
        snap: {
          control: vars.get(0x5e), state: s.state, clip: g.pepper.anim?.clip ?? 0, charge: s.charge, progress: s.progress, t: s.t, grounded: s.grounded, onPipe: s.onPipe,
          x: g.pepper.x, y: g.pepper.y, z: g.pepper.z, ry: g.pepper.ry, speed: s.speed, fwdX: g.pepper.m[8], fwdZ: g.pepper.m[10], trickScore: run.trickScore, steer: s.steer, stickY: s.stickY, locked: s.locked,
        },
      };
    },
  };
  Object.assign(game, { bpk: g });     // for tests / the debug console (window.__zone.game.bpk)
  return game;
});
