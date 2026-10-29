// z21FSH "Fishing" (Adventure Island, story nodes 42-44): ported in M6 (docs/re/m6/z21FSH.md). Registers the zone's behaviour constructors (nodes: src/zones/z21fsh/nodes.ts)
// and the zone game: the intro cutscene (ADV04 at story node 42) and brief, the HUD (casts left, fish caught, score, the power / tension gauge), the blinking messages, the
// score panel (the machine's state 13), the 3D sounds, the fishing line, the music switch to the shark theme during the fight, the end cutscene (ADV11).
import { registerZoneGame, registerZoneSetup } from '../shell/zonegame.ts';
import { EMU_RECORDS_BASE, EMU_RECORD_STRIDE } from '../island/args.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { checkRecords, REC, ST, K, SOUNDS_2D, SOUNDS_3D, randF } from './z21fsh/rules.ts';
import { prepareFsh, dropShared } from './z21fsh/nodes.ts';
import type { FshEnv, FshShared } from './z21fsh/nodes.ts';
import './z21fsh/nodes.ts';
import { MODE } from '../shell/loopmachine.ts';
import { waypoints } from '../game/walker.ts';
import { ZoneParticles, GATE_OFF } from '../fx/particles/zone.ts';
import { euler24 } from './common/x87.ts';
import { installCtx } from '../island/ctx.ts';
import { makeFshCtx } from './z21fsh/ctx.ts';

/** HUD texture indices of Overlays/Z21FSH (FUN_00705b60): left icon 4 (casts left), right icon 5 (fish caught), the gauge's segments 1 / 2 / 3, markers 6 (cast power) / 7 (tension) */
const HUD_TEX = { CASTS: 4, FISH: 5, MARKER_POWER: 6, MARKER_TENSION: 7 } as const;
const GAUGE_SEGMENTS = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
const WHITE = 0xffffffff;

/** the intro cutscene slots (FUN_006f4623: `FUN_0045c366("z21fsh", "ai")`, `FUN_0045c397(0, "ADV04", "ADV04")`, `(1, "ADV11", "ADV11")`) */
export const FSH_CUTSCENES = [
  { slot: 0, zone: 'z21FSH', script: 'adv04', strings: 'ADV04', area: 'ai' },
  { slot: 1, zone: 'z21FSH', script: 'adv11', strings: 'ADV11', area: 'ai' },
] as const;

/**
 * The argument blocks of the fisherman's two generic nodes. The set-up builds them in frame locals (FUN_006f3eec: `_memset(&local, 0, 0x30)` and stores) which the
 * symbolic extraction does not follow, so the port writes the same bytes: SGMFIG (0x426151): talk radius 2.0, near radius 3.0, state mask 1, first clip 0x3a, start node -1
 * (nearest), no sound, no cutscene slot (-1), lane 0, animation set 0, reward var 0xfc / op 1; Turn2Pep A (0x52ff39): wave clip 0x4f, idle clip 0x3a, first 1, target = Pepper's record.
 */
export function fishermanArgs(kind: 'sgmfig' | 'turn2pep'): Uint8Array {
  const b = new Uint8Array(0x80), dv = new DataView(b.buffer);
  if (kind === 'sgmfig') {
    dv.setFloat32(4, 2.0, true); dv.setFloat32(8, 3.0, true); dv.setUint16(0xc, 1, true);
    dv.setInt32(0x10, 0x3a, true); dv.setInt32(0x14, -1, true); dv.setInt32(0x18, 0, true);
    dv.setInt32(0x20, -1, true); dv.setFloat32(0x24, 0, true); dv.setUint16(0x28, 0, true); dv.setUint16(0x2a, 0xfc, true); dv.setUint16(0x2c, 1, true);
  } else {
    dv.setInt32(0, 0x4f, true); dv.setInt32(4, 0x3a, true); dv.setInt32(8, 1, true);
    dv.setUint32(0x10, EMU_RECORDS_BASE + REC.PEPP * EMU_RECORD_STRIDE, true);
  }
  return b;
}
registerZoneSetup('z21FSH', {
  beforeSetup(_sh, _world, profile) {
    for (const a of profile.setup?.attaches ?? []) {
      if (a.record !== REC.FSHM) continue;
      if (a.ctor === 0x426151) (a as { args?: Uint8Array }).args = fishermanArgs('sgmfig');
      else if (a.ctor === 0x52ff39) (a as { args?: Uint8Array }).args = fishermanArgs('turn2pep');
    }
  },
});

function makeClone(w: World, name: string): GameRecord {
  const r = new GameRecord(name);
  r.index = w.records.length;
  r.hide();
  w.records.push(r);
  return r;
}

registerZoneGame('z21FSH', async (ctx: ZoneGameCtx): Promise<ZoneGame> => {
  const { world, vars, sh, hud } = ctx;
  const bad = checkRecords(world.records);
  if (bad.length) throw new Error(`z21FSH: ${bad.join('; ')}`);
  const S = prepareFsh(world, sh.pe);
  S.rng = { next: Math.random };
  const lods = S.tables!.lods;
  // the shoal's fish are drawn through helper records that carry the three fish models (the original draws the model objects with hand-made matrices)
  S.clones = [];
  for (let i = 0; i < K.FISH; i++) {
    const c = makeClone(world, 'FISH');
    const idx = S.shoal?.lod[i] ?? 0;
    c.model = world.records[lods[idx]]?.model ?? null;
    S.clones.push(c);
  }
  ctx.gr.refreshViews();

  // ---- sounds: 2D by id through the world's sink, 3D through GameAudio's positional slots
  const ga = sh.audio.ga;
  const slots3 = new Map<number, SoundSlot>();
  if (ga) for (const id of SOUNDS_3D) ga.sfx.load3D(id).then((s) => slots3.set(id, s)).catch(() => { /* silent */ });
  sh.audio.preload(SOUNDS_2D);
  const env: FshEnv = {
    play2D: (id) => ctx.sfx(id),
    stop2D: (id) => sh.audio.stop(id),
    play3D: (id, x, y, z) => { const s = slots3.get(id); if (s && ga) { try { ga.sfx.play3D(s, { x, y, z }); } catch { /* silent */ } } },
    stop3D: (id) => { const s = slots3.get(id); if (s && ga) { try { ga.sfx.stop(s); } catch { /* silent */ } } },
    say: (a, b) => { ctx.say(a, b ?? null); },
    cutsceneStart: (slot) => { ctx.cutscene.start(slot); },
    cutsceneActive: () => ctx.cutscene.active(),
    fightMusic: (on) => {
      if (!ga) return;
      const key = on ? 'Z21Jaws' : 'Z21FSH';
      ga.music.load(key).then((h) => { if (h) ga.music.play(h); }).catch(() => { /* silent */ });
    },
    splash: () => { /* replaced below when the zone has particle data */ },
  };
  S.env = env;

  // ---- the particle emitter of the Fishing node's constructor (FUN_006f8e5a): `splash01.par` on the LAND record's matrix (record 4, +0x1ac of the record array), offset 0, rotation (-pi/2, 0, 0), gate off;
  //      FUN_0044e8d0 after it. The cast landing (state 7, sub 3) sets the private matrix DAT_05d5caf0 = (identity, bobber x, ty, bobber z) and turns it on, the reeling (state 8 -> 9) off.
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const splashMatrix = new Float32Array(16);      // DAT_05d5caf0 (zeroed static memory until the first landing)
    const h = fx.start('splash01.par', world.records[REC.LAND].m, [0, 0, 0], [-1.5707964, 0, 0], GATE_OFF);
    fx.finish();
    env.splash = (x, y, z, on = true) => {
      if (on) { euler24(0, 0, 0, x, y, z, splashMatrix); fx.setMatrix(h, splashMatrix); fx.on(h); }
      else fx.off(h);
    };
  }

  // ---- the fishing line (FUN_004445e0): after the records
  ctx.gr.effects = (r) => { const l = S.line; if (l) r.drawLine(l.a, l.b, [1, 1, 1, 1]); };

  // ---- the engine services of the fisherman's talking node (SGMFIG: the lines FSHMA / FSHMC of fsh.str, the speech player, the cutscene override flag)
  installCtx(world, makeFshCtx(ctx, fx));

  // ---- the way-point map of the zone (FUN_004630c0(1, "W_PATH")); the fisherman's generic node creates its walker in its first update, the port does that now so that the opening
  //      cutscene's actors have theirs (the original's constructors ran inside the set-up)
  waypoints.load(ctx.archive);
  for (const rec of world.records) {
    const n = rec.ctrl?.nodes.find((x) => x.kind === 'SGMFIG') as unknown as { init?(w: World, r: GameRecord, c: unknown): void } | undefined;
    if (n?.init && rec.ctrl) n.init(world, rec, rec.ctrl);
  }

  // ---- the cutscenes (FUN_006f4623): ADV04 plays when the zone starts at story node 42, which also completes the node (S252 = 1)
  await ctx.cutscene.declare([...FSH_CUTSCENES]);
  if (vars.get(0x58) === 0x2a) {
    ctx.cutscene.start(0);
    vars.set(0xfc, 1);
  }

  const F = S.fishing!;
  hud.visible = false;
  hud.left = { tex: HUD_TEX.CASTS, tint: WHITE };
  hud.right = { tex: HUD_TEX.FISH, tint: WHITE };

  /** FUN_00705c64 (the FSwitch node's draw hook): the HUD texts, the counting score, the gauge */
  const syncHud = () => {
    const st = F.state;
    hud.visible = st !== ST.DONE && st < ST.SCORE;
    hud.leftText = `x${F.casts}`;
    hud.rightText = `x${F.count}`;
    hud.centreText = String(F.shown);
    if (F.shown < F.total) {
      F.shown = Math.trunc(Math.fround(F.shown + randF(S.rng, K.SCORE_STEP)));      // FUN_004388ae(20), fild + fadd (24-bit: rounded), __ftol
      if (F.total < F.shown) F.shown = F.total;
    }
    if (st === ST.FIGHT || st === ST.CAST) {
      hud.gauge = { value: st === ST.CAST ? F.power : F.tension, min: 0, max: K.GAUGE_MAX, segments: GAUGE_SEGMENTS, marker: st === ST.CAST ? HUD_TEX.MARKER_POWER : HUD_TEX.MARKER_TENSION, icon: -1 };
    } else hud.gauge = null;
  };

  const game: ZoneGame = {
    config: { intro: true, help: true, skipBanner: true },
    introId: 'ADSGFI14',
    helpControls: 4,
    /** the opening cutscene runs in mode 1 (FUN_0045c402 every frame; the rod follows the actor's hand: FUN_0042226e(RODD, 1)) */
    introHold: () => ctx.cutscene.active(),
    introTick() {
      if (ctx.cutscene.active()) { ctx.cutscene.tick(); tickRod(world); }
    },
    beforeTick() { if (ctx.cutscene.active()) ctx.cutscene.tick(); },
    onStart() { /* the zone's music runs from the zone entry */ },
    update() {
      syncHud();
      return S.result || undefined;
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (ctx.cutscene.active()) ctx.cutscene.draw(ui);
      if (mode !== MODE.PLAY && mode !== MODE.PAUSE) return;
      if (F.state === ST.SCORE) drawScorePanel(ctx, ui, F.total);
      else if (!ctx.cutscene.active()) {
        for (const p of S.popups.drawn) {
          if (p.text !== null) ui.text(1, p.text, p.x, p.y, { colour: 0, maxChars: 0x24 });
          else ctx.text(ui, p.id, p.x, p.y, { maxChars: 0x24 });
        }
      }
    },
    destroy() {
      for (const id of SOUNDS_3D) env.stop3D(id);
      ctx.cutscene.abort();
      ctx.gr.effects = null;
      waypoints.unload();
      dropShared(world);
    },
    debug() { return snapshot(S); },
  };
  return game;
});

/** the banner panel of state 13 (FUN_006f6e2b case 0xd: FUN_00460a3d(0x16, 0x14, 0) + "%5d" at y 100, the medal word at 150, the result lines) */
function drawScorePanel(ctx: ZoneGameCtx, ui: Ui2D, score: number) {
  const L = (id: string, y: number) => ctx.line(id, y, 30);
  const gold = score >= K.BANNER_GOLD, silver = score >= K.BANNER_SILVER;
  const lines = gold ? [L('ADSGFI01', 200)] : silver ? [L('ADSGFI02', 0xb4), L('ADSGFI03', 0x15e)] : [L('ADSGFI04', 200)];
  ctx.banner(ui, { score: { text: String(score).padStart(5, ' '), y: 100 }, medal: gold ? 3 : silver ? 2 : 1, lines });
}

/** FUN_0042226e(RODD, 1): the rod's controller alone (the carry node keeps it in the actor's hand while the opening cutscene runs) */
function tickRod(w: World) {
  const rec = w.records[REC.RODD];
  const c = rec?.ctrl;
  if (!c || !c.enabled) return;
  c.ran.length = 0;
  for (let i = 0; i < c.nodes.length; i++) {
    const n = c.nodes[i];
    if (!w.vars.gate(n.var, n.mask, n.value)) continue;
    const r = n.update(w, rec, c);
    if (r === 0) continue;
    c.ran[i] = true;
    if (r === 1) break;
  }
  for (let i = 0; i < c.nodes.length; i++) if (c.ran[i]) c.nodes[i].prerender?.(w, rec, c);
}

export function snapshot(S: FshShared) {
  const F = S.fishing;
  if (!F) return null;
  const sh = S.shoal;
  return {
    state: F.state, sub: F.sub, casts: F.casts, count: F.count, total: F.total, shown: F.shown, power: F.power, tension: F.tension, bite: F.bite, lure: F.lure,
    bobber: [F.bx, F.by, F.bz], result: S.result, taut: F.taut, spot: F.spotIdx, yaw: F.yaw, hooked: F.hooked ? { w: F.hooked.weight0, bertha: F.hooked.bertha, dist: F.hooked.dist } : null,
    bertha: S.bertha ? [S.bertha.fish.x, S.bertha.fish.y, S.bertha.fish.z] : null,
    fish: sh ? sh.fish.map((f) => [+f.x.toFixed(1), +f.y.toFixed(1), +f.z.toFixed(1), f.weight0]) : [],
    popups: S.popups.shown().map((p) => p.text ?? p.id),
  };
}
