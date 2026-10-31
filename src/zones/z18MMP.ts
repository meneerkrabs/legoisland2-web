// z18MMP "Matching Mummies" (Adventure Island, story node 39: entered from the pyramid hub z16PYA): knock on twelve coffins to find the six pairs of symbols, take the key,
// walk through the opened gate to the page of the Constructopedia and run from the rolling boulder. Loop FUN_006a26a8, init FUN_006a489a / FUN_006a3861 / FUN_006a30c0, the
// nodes FUN_006a4fd0 .. FUN_006aca97 (docs/re/m6/z18MMP.md). The behaviour is in src/zones/z18mmp/ (pure, node-testable); this file registers the constructors and the zone game
// (HUD, intro / banner texts, speech, sound and music through the session's audio, the result variables).
import { ZoneParticles } from '../fx/particles/zone.ts';
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import type { MusicHandle } from '../audio/music.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { CTOR, REC, MUSIC, K } from './z18mmp/consts.ts';
import { MmpShared } from './z18mmp/shared.ts';
import type { MmpSounds, P3 } from './z18mmp/shared.ts';
import { PepperNode } from './z18mmp/pepper.ts';
import { CameraNode, MummyNode, KeyNode, PageNode, RockNode, PillarNode, DebrisNode, TorchNode, SpiderNode, RatNode } from './z18mmp/props.ts';
import { prepareMmp, startMmpEmitters } from './z18mmp/setup.ts';
import { startTickClock } from './common/tickrand.ts';
import { MmpRun, clockText, applyResult, resultLines, scoreOf } from './z18mmp/run.ts';

/** the state the nodes share in one run (the original's globals); a new one is made by every Pepper constructor, i.e. every time the zone starts */
let shared = new MmpShared();
registerCtor(CTOR.WALK, () => { shared = new MmpShared(); return new PepperNode(shared); });
registerCtor(CTOR.CAMERA, () => new CameraNode(shared));
registerCtor(CTOR.MUMMY, () => new MummyNode(shared));
registerCtor(CTOR.KEY, () => new KeyNode(shared));
registerCtor(CTOR.PAGE, () => new PageNode(shared));
registerCtor(CTOR.ROCK, () => new RockNode(shared));
registerCtor(CTOR.PILLAR, () => new PillarNode(shared));
registerCtor(CTOR.DEBRIS, () => new DebrisNode(shared));
registerCtor(CTOR.TORCH, () => new TorchNode(shared));
registerCtor(CTOR.SPIDER, () => new SpiderNode(shared));
registerCtor(CTOR.RAT, () => new RatNode(shared));

/** the sound services of the zone over the session's audio: 3D handles on positional slots, 2D by id, music by key */
function makeSounds(ctx: ZoneGameCtx): MmpSounds {
  const { sh } = ctx;
  const ga = sh.audio.ga;
  const handles = new Map<string, { slot: SoundSlot | null }>();
  const music = new Map<string, Promise<MusicHandle | null>>();
  const loadMusic = (key: string) => {
    let p = music.get(key);
    if (!p && ga) { p = ga.music.load(key).catch(() => null); music.set(key, p); }
    return p;
  };
  if (ga) for (const k of Object.values(MUSIC)) void loadMusic(k);
  return {
    play2D: (id) => ctx.sfx(id),
    stop2D: (id) => sh.audio.stop(id),
    play3D(handle, id, p: P3) {
      if (!ga) return;
      let h = handles.get(handle);
      if (!h) { const nh = { slot: null as SoundSlot | null }; h = nh; handles.set(handle, nh); ga.sfx.load3D(id).then((s) => { nh.slot = s; }).catch(() => { /* silent */ }); }
      if (h.slot) ga.sfx.play3D(h.slot, p);
    },
    stop3D(handle) { const h = handles.get(handle); if (h?.slot && ga) ga.sfx.stop(h.slot); },
    idle3D(handle) { const h = handles.get(handle); return !h?.slot || !ga || ga.sfx.isIdle(h.slot); },
    music(key) { if (!ga) return; void loadMusic(key)?.then((h) => { if (h) ga.music.play(h); }); },
    say: (a, b) => { ctx.say(a, b ?? null); },
  };
}

registerZoneGame('z18MMP', async (ctx) => {
  const { world, loaded, archive, vars, sh, hud, gr } = ctx;
  const sharedNow = shared;
  const rig = (n: string): Blk | null => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const nodes = prepareMmp(world, sharedNow, { MFIG: loaded.rigs.get('MFIG') ?? rig('MFIG'), SPID: rig('SPID'), RATT: rig('RATT') });
  startTickClock();                    // FUN_006a489a calls FUN_00435c81 after FUN_006a3861 (the symbol shuffle ran on the previous zone's clock base)
  const run = new MmpRun(sharedNow);
  // FUN_006a489a: FUN_00442900("Z18MMP"); the emitters start in the order of FUN_006a3861's attach calls: the 12 coffins (symtwin, 2 x mummy02), the key (symtwin), the page (twinkle01), the 12 torches (mmpfire)
  const fx = await ZoneParticles.create(ctx);
  sharedNow.fx = fx;
  if (fx) startMmpEmitters(fx, world, sharedNow, nodes);
  gr.refreshViews();                    // the symbols changed places: the renderer's per-record parts follow the new models
  gr.useFogCall(2);                     // the last SetupFog call that runs wins: FUN_006a489a's (5.0, 150, 150, 50)

  // the zone's sounds (FUN_006a4a60) are loaded by the audio host; the music is the puzzle's own (Hotep at mode 9 -> 2, then by events)
  const ga = sh.audio.ga;
  sharedNow.sounds = makeSounds(ctx);

  hud.visible = false;
  // FUN_006a47e4: the gauge of the danger meter: 12 segments (texture 2), the marker (texture 0) and the icon (texture 1); range 0 .. 145
  hud.gauge = { value: 0, min: 0, max: K.DANGER_MAX, segments: new Array(12).fill(2), marker: 0, icon: 1 };
  hud.left = { tex: -1, tint: 0xffffffff }; hud.right = { tex: -1, tint: 0xffffffff };
  const syncHud = () => { hud.gauge!.value = sharedNow.danger; hud.centreText = clockText(sharedNow.seconds); };
  syncHud();
  let bannerDone = false;
  let result = 0;

  /** FUN_004434d0 once per frame: the listener is the camera */
  const listen = () => {
    if (!ga) return;
    const c = world.camera.c;
    ga.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };

  const game: ZoneGame = {
    introId: 'ADSGMM18',
    helpControls: 5,
    onStart() { hud.visible = true; sharedNow.puzzleMusicArmed = true; sharedNow.sounds.music(MUSIC.HOTEP); },
    beforeTick() { run.beforeTick(world.dt); },
    update() {
      syncHud();
      listen();
      if (result === 0 && run.afterTick(vars)) result = run.result;
      return result;
    },
    onBanner() {
      hud.visible = false;
      ctx.stopSpeech();
      const won = run.won(vars), score = run.score(vars);
      const { lines } = resultLines(won, score);
      ctx.say(lines[0][0], lines[1]?.[0] ?? null);
      if (!bannerDone) { applyResult(vars, won, score); bannerDone = true; }
    },
    drawBanner(ui: Ui2D) {
      const won = run.won(vars), score = run.score(vars);
      const { lines, medal } = resultLines(won, score);
      ctx.banner(ui, { score: { text: String(score).padStart(5, ' '), y: 50 }, medal, medalY: 100, lines: lines.map(([id, y]) => ctx.line(id, y, 30)) });
    },
    destroy() { /* FUN_006a4ee8 stops the loops: the zone exit resets the audio */ },
    debug() {
      const rs = world.records, p = nodes.pepper;
      return {
        seconds: sharedNow.seconds, danger: sharedNow.danger, stopClock: sharedNow.stopClock, result, reason: run.reason, score: scoreOf(sharedNow.seconds, run.won(vars)), clock: clockText(sharedNow.seconds),
        pepper: { x: rs[REC.PEPPER].x, y: rs[REC.PEPPER].y, z: rs[REC.PEPPER].z, state: p.state, cur: p.cur, vx: p.vx, vz: p.vz, clip: rs[REC.PEPPER].anim?.clip, visible: (rs[REC.PEPPER].flags & 2) !== 0 },
        vars: { near: vars.get(0xfc), matched: vars.get(0xfd), open: vars.get(0xfe), ready: vars.get(0xff), pending: vars.get(0xfb) },
        coffins: nodes.coffins.map((c) => ({ n: c.n, state: c.state, partner: c.partner, symbol: rs[REC.SYMBOL[c.n]].name })),
        track: [...sharedNow.track],
        rock: { x: rs[REC.ROCK].x, y: rs[REC.ROCK].y, z: rs[REC.ROCK].z }, door: rs[REC.DOOR].y, trap: rs[REC.TRAP].y, gate: rs[REC.GATE].y, key: { y: rs[REC.KEY].y, shown: (rs[REC.KEY].flags & 2) !== 0 }, page: (rs[REC.PAGE].flags & 2) !== 0,
        guards: nodes.guards.map((_g, k) => ({ x: rs[REC.GUARD[k]].x, z: rs[REC.GUARD[k]].z })),
      };
    },
  };
  // the run's state for the headless runs (tools/steps/m6-z18MMP*.mjs): `window.__zone.game.mmp`
  Object.assign(game, { mmp: { shared: sharedNow, run, nodes } });
  return game;
});
