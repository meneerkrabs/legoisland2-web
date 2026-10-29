// z22BIP "the jungle biplane" (story node 18 / sub-game 18): Pepper flies a biplane along a course through the jungle, shooting bananas at monkeys, rock monsters
// and targets, collecting fuel cans and banana bunches, and lands on the runway at the end of the course (docs/re/m6/z22BIP.md). The zone loop is FUN_00706bee
// (runner template: fade in, intro text ADSGBI15, help with 5 controls, play, pause, banner, result menu); the zone's behaviour is in src/zones/z22bip/ (the nodes,
// `prepareBip`); this file registers the constructors and the zone game (HUD, sounds, the end of the game).
import { registerCtor } from '../game/setup.ts';
import { restoreHooks } from '../restore/flag.ts';
import { GATE_OFF, GATE_ON, ZoneParticles } from '../fx/particles/zone.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { SoundBank } from './parachute/sound.ts';
import type { SoundBackend } from './parachute/sound.ts';
import { V } from '../game/vars.ts';
import { dropBipRun, SOUNDS, VAR_MODE } from './z22bip/run.ts';
import { PlaneNode, CTOR_WALK, PLANE } from './z22bip/plane.ts';
import { TakeoffNode, CTOR_TAKEOFF } from './z22bip/takeoff.ts';
import { LandingNode, CTOR_LANDING } from './z22bip/landing.ts';
import { RecoverNode, CTOR_RECOVER } from './z22bip/recover.ts';
import { JohnnyNode, CTOR_JOHNNY } from './z22bip/johnny.ts';
import { RockyNode, CTOR_ROCKY } from './z22bip/rocky.ts';
import {
  PSwitchNode, SeaBedNode, AnimPropNode, JerryCanNode, PropsNode, RiverNode,
  CTOR_PSWITCH, CTOR_SEABED, CTOR_RIVER, CTOR_JERRYCAN, CTOR_PROP3, CTOR_ANIM_CROC, CTOR_ANIM_PARROT,
} from './z22bip/props.ts';
import { prepareBip } from './z22bip/setup.ts';
import { bipMedal, bipFinish, bipResultLines, BIP_VARS } from './z22bip/rules.ts';

registerCtor(CTOR_PSWITCH, () => new PSwitchNode());
registerCtor(CTOR_WALK, () => new PlaneNode());
registerCtor(CTOR_RECOVER, () => new RecoverNode());
registerCtor(CTOR_TAKEOFF, () => new TakeoffNode());
registerCtor(CTOR_LANDING, () => new LandingNode());
registerCtor(CTOR_SEABED, () => new SeaBedNode());
registerCtor(CTOR_ANIM_CROC, () => new AnimPropNode(1));
registerCtor(CTOR_ANIM_PARROT, () => new AnimPropNode(3));
registerCtor(CTOR_RIVER, () => new RiverNode());
registerCtor(CTOR_JOHNNY, () => new JohnnyNode());
registerCtor(CTOR_JERRYCAN, () => new JerryCanNode());
registerCtor(CTOR_PROP3, () => new PropsNode());
registerCtor(CTOR_ROCKY, () => new RockyNode());

/** HUD: the overlay textures (FUN_0070835a): the left icon 4, the right icon's frames 5 .. 0x22, the gauge segments 3 x 4 (red), 2 x 4, 1 x 4 */
export const HUD_TEX = { LEFT: 4, RIGHT_FIRST: 5, RIGHT_LOOP: 6, RIGHT_LAST: 0x22, MARKER: 0, SEGMENTS: [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1] } as const;
const pad3 = (n: number) => String(Math.max(0, n)).padStart(3, '0');

/** FUN_00707800's emitters: the record (matrix at +0xc of the record array: (0x1e1c - 0xc) / 0x68 = 74) and the table at 0x9319b0 ({ record, name } * 10) */
export const BIP_FX = { LEAF_RECORD: 74, SPRAY_RECORDS: [206, 207, 208, 209, 210, 211, 212, 213, 215, 216] } as const;

registerZoneGame('z22BIP', async (ctx: ZoneGameCtx) => {
  const { world, archive, sh, hud, gr, vars } = ctx;
  const shadowVar = world.vars.get(V.PEPPERSSHADOW);
  const S = prepareBip(world, archive, sh.pe, {
    scrollRiver: (rec, dv) => { const n = gr.groupCount(rec); for (let g = 0; g < n; g++) gr.scrollGroup(rec, g, 0, dv); },
  });
  const { run: R, plane, walk, takeoff, johnnyNode: jn } = S;
  gr.refreshViews();

  // ---- particles (FUN_00707800: FUN_00442900("Z22BIP"), Leaffall on record 74 (rotation 0, pi, 0), Spray01 on the ten waterfall records (rotation 0, -pi/2, 0, gate ON); no FUN_0044e8d0 here)
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const leaf = fx.start('Leaffall.par', world.records[BIP_FX.LEAF_RECORD].m, [0, 0, 0], [0, Math.PI, 0], GATE_OFF);
    for (const r of BIP_FX.SPRAY_RECORDS) fx.start('Spray01', world.records[r].m, [0, 0, 0], [0, -Math.PI / 2, 0], GATE_ON);
    R.onLeaf = () => { fx.on(leaf); fx.stop(leaf); };
  }

  // ---- sounds
  const sfx = sh.audio.ga?.sfx ?? null;
  const bank = new SoundBank(SOUNDS, sfx as unknown as SoundBackend | null);
  void bank.load();
  R.sound = bank;
  R.cue = (name, pos) => restoreHooks.cue?.(name, { sound: bank, hud, strings: ctx.strings, pos });     // restored content (option off: the hook is unset)
  R.say = (id) => { R.said.push(id); return ctx.say(id); };      // the speech of the loop (FUN_00439bf8 + FUN_00435a11: only when none is playing)
  const listen = () => {
    const c = world.camera.c;
    const f = [c[3] - c[0], c[4] - c[1], c[5] - c[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    sfx?.setListener({ x: c[0], y: c[1], z: c[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 });
  };

  // ---- the HUD (FUN_0070835a, FUN_00709147)
  let rightFrame: number = HUD_TEX.RIGHT_FIRST;
  hud.visible = false;
  hud.left = { tex: HUD_TEX.LEFT, tint: 0xffffffff };
  hud.right = { tex: HUD_TEX.RIGHT_FIRST, tint: 0xffffffff };
  hud.gauge = { value: 100, min: 0, max: 100, segments: [...HUD_TEX.SEGMENTS], marker: HUD_TEX.MARKER, icon: -1 };
  const syncHud = () => {
    hud.centreText = String(R.hudScore);                 // "%d" of the score
    hud.leftText = String(R.hudAmmo);                    // "%d" of the bananas
    hud.rightText = pad3(Math.trunc(R.hudFuel));         // "%03d" of the fuel percent
    hud.gauge!.value = R.hudFuel;
    hud.right.tex = rightFrame;                          // DAT_05d4dd38 = the frame counter, which then runs on (5 .. 0x22, then 6 .. 0x22)
    rightFrame = rightFrame + 1 > HUD_TEX.RIGHT_LAST ? HUD_TEX.RIGHT_LOOP : rightFrame + 1;
  };
  R.hudAmmo = walk.ammo; R.hudFuel = walk.fuel / PLANE.FUEL_UNIT; R.hudScore = walk.score;
  syncHud();

  let over = 0;
  let banner = false;
  const result = (): number => (R.result === 0 ? 0 : R.result >= 3 ? 1 : 2);

  const game: ZoneGame = {
    introId: 'ADSGBI15',
    helpControls: 5,
    introTick() { syncHud(); },
    onStart() { hud.visible = true; bank.play('takeOff'); },        // mode 9 -> 2: FUN_004432c0(music) + FUN_004435a0(take_off1)
    update() {
      syncHud();
      S.syncDraw();
      listen();
      if (!over) over = result();
      return over || undefined;
    },
    onBanner() {
      if (banner) return;
      banner = true;
      hud.visible = false;
      bank.stopAll();
      ctx.stopSpeech();
      bipFinish(vars, walk.score, R.result);
      const sp = bipResultLines(R.result).speech;
      ctx.say(sp[0], sp[1] ?? null);
    },
    drawBanner(ui: Ui2D) {
      const info = bipResultLines(R.result);
      restoreHooks.cue?.('bip-banner', { ui, strings: ctx.strings, result: R.result });
      ctx.banner(ui, { score: { text: String(walk.score), y: 0x32 }, medal: bipMedal(R.result), medalY: 100, lines: info.lines.map(([id, y]) => ctx.line(id, y, 30)) });
    },
    destroy() { bank.stopAll(); hud.gauge = null; hud.visible = true; world.vars.set(V.PEPPERSSHADOW, shadowVar); dropBipRun(world); },
    debug() {
      return {
        mode: world.vars.get(VAR_MODE), result: R.result, score: walk.score, ammo: walk.ammo, fuel: walk.fuel, fuelPct: R.hudFuel, speed: walk.speed, alt: walk.alt,
        heading: walk.heading, steer: walk.steer, pitch: walk.pitch, thrust: walk.thrust, landed: walk.landed, rolling: walk.rolling,
        pos: [plane.x, plane.y, plane.z], progress: R.spline.progress, atEnd: R.spline.atEnd, johnny: jn.progress, wait: jn.waiting,
        takeoff: { state: takeoff.state, progress: takeoff.progress, count: takeoff.count, climb: takeoff.climb },
        stats: { ...R.stats }, said: [...R.said], rope: S.ropes.map((r) => r.hit), monkeys: S.monkeys.map((m) => m.node.state), over, hiscore: vars.get(BIP_VARS.HISCORE), trophy: vars.get(BIP_VARS.TROPHY),
        bananas: walk.bananas.filter((b) => b.active).length,
      };
    },
  };
  Object.assign(game, { setup: S });     // for the node tests / the bot / the debug console (window.__zone.game.setup)
  return game;
});
