// Restored feature 'battery': the radio battery side quest (docs/re/restore-plan.md section 5 item 2, docs/re/restore.md).
//
// ORIGINAL (game data / code reused):
//   * the ten hidden records BTB0..BTB9 (records 295..304) with their models and collision (the set-up only hides them, never shows or attaches them);
//   * the DJ's three commented-out lines LECSRS06-08 of `lgi10.txt` (+ `dj_throw`, clip 274), un-commented by rule P (src/restore/scripts.ts) and compiled by the original's own compiler;
//   * game variable 22 `SWITCH_GME_BATTERY_LEVEL` (never touched by the original), variable 225 `UNUSED_` (the collected mask, also unused; both in the saved range 15..234);
//   * the radio's own var 0x22 `SWITCH_GME_RADIO_ON`, read by BOTMUSIC (misc.ts: 0 = the bots do not dance, the music is muted) = the radio's power switch;
//   * the HUD gauge of the engine (FUN_00460214, `Hud.gauge`: 12 segments of 32 x 16) with the island's own bar textures 9 REDBAR / 10 GreenBar / 11 YellowBar (Overlays/Z02LGI);
//   * the island's sound 753 `SND_GET_OBJECT` (z02LGI/Collect.wav, in the walking Pepper's sound set) as the pickup sound.
// RECONSTRUCTION (invented, marked below): the number of cells per battery, the drain rate, the pickup radius, spin / bob / scale, the pickup sound choice, start level 0, the rule that a
//   battery stays on the ground while the radio is full, the quest only in story node 56, the dark "empty" gauge cells.
import { buildMatrix } from '../../formats/matrix.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { NODE_CONTINUE, NODE_NONE, attachNode, registerNode } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { tryCtx } from '../../island/ctx.ts';
import type { HudGauge, Hud } from '../../shell/hud.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import type { Feature } from '../feature.ts';
import type { ScriptPatch } from '../scripts.ts';

/** story node of the quest: the ghetto blaster is carried in nodes 56-60, the dance puzzle (the only use of the music) is node 56 (docs/re/restore-plan.md section 3 point 4) */
export const QUEST_NODE = 56;
/** ORIGINAL: SWITCH_GME_BATTERY_LEVEL (var 22), the collected mask (var 225), SWITCH_GME_RADIO_ON (var 0x22), the story node var (0x58) */
export const VAR_LEVEL = 22, VAR_MASK = 225, VAR_RADIO = 0x22, VAR_NODE = 0x58;
/** ORIGINAL: the gauge has 12 segments (FUN_00460214) */
export const MAX_CELLS = 12;
/** ORIGINAL: gauge bar textures of Overlays/Z02LGI (REDBAR, GreenBar, YellowBar), bottom to top red / yellow / green like z22BIP's fuel gauge */
export const BAR_RED = 9, BAR_GREEN = 10, BAR_YELLOW = 11;
export const SEGMENTS = [BAR_RED, BAR_RED, BAR_RED, BAR_RED, BAR_YELLOW, BAR_YELLOW, BAR_YELLOW, BAR_YELLOW, BAR_GREEN, BAR_GREEN, BAR_GREEN, BAR_GREEN];
/** ORIGINAL: the sound id of the pickup (SND_GET_OBJECT, a RECONSTRUCTION choice among the island's loaded samples) */
export const PICKUP_SOUND = 753;

// ---- RECONSTRUCTION: invented numbers (tune after a play-through)
/** RECONSTRUCTION: cells one battery gives (of 12) */
export const CELLS = 4;
/** RECONSTRUCTION: dance music one cell lasts, in the game's time unit (1/30 s: 300 = 10 s; `w.dt` of it passes per sim step, 0.5 at the 60 Hz step): a battery is 40 s; ten batteries exist) */
export const DRAIN_TICKS = 300;
/** RECONSTRUCTION: pickup: squared XZ distance to Pepper (Controller.distSq) below this, and the height difference below PICKUP_DY */
export const PICKUP_DIST_SQ = 16, PICKUP_DY = 4;
/** RECONSTRUCTION: spin (rad per dt-unit of 1/30 s: `* w.dt` per sim step) and bob (amplitude, rad per dt-unit of the phase) */
export const SPIN = 0.05, BOB = 0.25, BOB_RATE = 0.08;
/** RECONSTRUCTION: the batteries are drawn this much larger than their 0.8 x 0.86 x 0.5 mesh so that they can be seen across the island */
export const SCALE = 2.5;
/** RECONSTRUCTION: the level the quest starts with (the DJ says the radio needs batteries) */
export const START_LEVEL = 0;
/** RECONSTRUCTION: tint of the unlit gauge cells */
const DARK = 0xff404040;

/** the ten battery records by name (`BTB0`..`BTB9` = records 295..304) */
export const batteryRecords = (w: World): GameRecord[] => {
  const out: GameRecord[] = [];
  for (let i = 0; i < 10; i++) { const r = w.records.find((x) => x.name === `BTB${i}`); if (r) out.push(r); }
  return out;
};

const questActive = (w: World) => w.vars.get(VAR_NODE) === QUEST_NODE;

/** a battery lying on the island (RECONSTRUCTION of the behaviour; the record and its model are the original's) */
export class BatteryNode implements BehaviourNode {
  readonly kind = 'RestoreBattery';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** the record's resting height (the set-up's: terrain + 1.7), the bob is added to it */
  baseY: number | null = null;
  phase: number;
  readonly bit: number;
  constructor(bit: number) { this.bit = bit; this.phase = bit * 0.7; }
  update(w: World, rec: GameRecord, c: Controller): number {
    const taken = (w.vars.get(VAR_MASK) & (1 << this.bit)) !== 0;
    if (!questActive(w) || taken) { rec.flags &= ~RF_ENABLED; return NODE_NONE; }
    if (this.baseY === null) this.baseY = rec.y;
    rec.flags |= RF_ENABLED | RF_NO_COLLIDE;          // visible and not solid (the original's set-up only ever cleared bit 2)
    this.phase += BOB_RATE * w.dt;
    rec.ry += SPIN * w.dt;
    rec.m.set(buildMatrix(0, rec.ry, 0, rec.x, this.baseY + Math.sin(this.phase) * BOB, rec.z, SCALE, SCALE, SCALE));
    rec.scale = [SCALE, SCALE, SCALE];
    const p = w.focus;
    const level = w.vars.get(VAR_LEVEL);
    // RECONSTRUCTION: a battery is only picked up while the radio has room (nothing is wasted)
    if (p && level < MAX_CELLS && c.distSq < PICKUP_DIST_SQ && Math.abs(p.y - this.baseY) < PICKUP_DY && !tryCtx(w)?.cutsceneActive()) {
      w.vars.set(VAR_LEVEL, Math.min(MAX_CELLS, level + CELLS));
      w.vars.or(VAR_MASK, 1 << this.bit);
      rec.flags &= ~RF_ENABLED;
      const ctx = tryCtx(w);
      if (ctx) ctx.sfx(PICKUP_SOUND); else w.playSound(PICKUP_SOUND);
      return NODE_NONE;
    }
    return NODE_CONTINUE;
  }
}

/**
 * The radio's power (RECONSTRUCTION), carried by BTB0's controller at its head. Records update in index order, so it runs after the dancing bricksterbots (BOTMUSIC, records 17-26) of the same
 * tick: `ambient.botDance` is true when a bot danced THIS tick (GETO's pre-render, record 68, clears it afterwards). Var 0x22 is set here (after GETO's unconditional 1 in nodes 56-60,
 * which ran earlier in the tick as record 68) and read by the bots in the NEXT tick (original: misc.ts BOTMUSIC returns 0 when it is 0).
 */
export class RadioPowerNode implements BehaviourNode {
  readonly kind = 'RestoreRadioPower';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** ticks of music since the last cell went */
  drain = 0;
  update(w: World): number {
    if (!questActive(w)) { this.drain = 0; return NODE_CONTINUE; }
    let level = w.vars.get(VAR_LEVEL);
    if (level > 0 && w.ext.get('ambient.botDance') === true) {
      this.drain += w.dt;
      while (this.drain >= DRAIN_TICKS && level > 0) { this.drain -= DRAIN_TICKS; level--; }
      if (level === 0) this.drain = 0;
      w.vars.set(VAR_LEVEL, level);
    }
    level = Math.max(0, Math.min(MAX_CELLS, level));
    w.vars.set(VAR_RADIO, level > 0 ? 1 : 0);
    return NODE_CONTINUE;
  }
}

registerNode('RestoreBattery', (a) => new BatteryNode(Number(a.bit ?? 0)));
registerNode('RestoreRadioPower', () => new RadioPowerNode());

/** attach the quest to the world's BTB records (idempotent): the same attach call the set-up replay uses (`attachNode` = FUN_0042382c + FUN_00423532); returns the number of batteries */
export function attachBatteries(w: World): number {
  const recs = batteryRecords(w);
  recs.forEach((r, i) => {
    if (r.ctrl?.nodes.some((n) => n.kind === 'RestoreBattery')) return;
    // the radio power node is the head of BTB0's chain (pos 0 resets the chain: the record has none), the battery node follows
    if (i === 0) attachNode(r, 'RestoreRadioPower', 0, 0, 0, 0);
    attachNode(r, 'RestoreBattery', i === 0 ? 1 : 0, 0, 0, 0, { bit: i });
  });
  // the radio starts off: the original's set-up leaves var 0x22 for GETO's first tick (1); with no battery yet the bots must not dance
  if (recs.length > 0 && questActive(w) && w.vars.get(VAR_LEVEL) <= 0) w.vars.set(VAR_RADIO, 0);
  return recs.length;
}

/** the gauge object the island's HUD gets while the quest runs */
function gaugeOf(): HudGauge { return { value: 0, min: 0, max: MAX_CELLS, segments: SEGMENTS, marker: -1, icon: -1 }; }

interface GameLike { ictx: { world: World }; ctx: { hud: Hud } }
const gauges = new WeakMap<Hud, HudGauge>();

/** RECONSTRUCTION: the unlit cells are drawn dark so an empty radio still shows its gauge (the engine's gauge draws lit cells only); anchored right like the gauge (Hud.draw) */
function drawEmpty(hud: Hud, g: HudGauge) {
  return (ui: Ui2D) => {
    if (hud.gauge !== g) return;
    const lit = Math.max(0, Math.min(MAX_CELLS, Math.trunc(MAX_CELLS * (g.value / MAX_CELLS) + 0.5))), k = 0.8;
    for (let i = lit; i < MAX_CELLS; i++) { const y0 = 492 - 16 * i; ui.sprite(hud.set, g.segments[i], [732 * k, y0 * k, (732 + 32) * k, (y0 + 16) * k], DARK); }
  };
}

/** every play tick: the HUD gauge follows the level while the quest runs (var 22), else it is not there */
export function updateGauge(w: World, hud: Hud) {
  let g = gauges.get(hud);
  if (!g) { g = gaugeOf(); gauges.set(hud, g); hud.extras.push(drawEmpty(hud, g)); }
  if (questActive(w)) { g.value = w.vars.get(VAR_LEVEL); hud.gauge = g; }
  else if (hud.gauge === g) hud.gauge = null;
}

/** rule P: lgi10 (DJ: "Oh eh, voor ik het vergeet, die radio werkt op batterijen ..."): line 40 gets next 50, the commented blocks 50 / 60 / 70 / 80 (lines 43-54) come back */
export const LGI10_PATCH: ScriptPatch = {
  zone: 'z02LGI', script: 'lgi10',
  addNext: [{ line: 40, to: 50 }],
  unComment: [43, 44, 45, 47, 48, 50, 51, 52, 54],
  note: 'LECSRS06-08 + dj_throw: the DJ remembers the batteries and throws them',
};

export const feature: Feature = {
  id: 'battery',
  scripts: [LGI10_PATCH],
  islandStart(g) { const game = g as GameLike; attachBatteries(game.ictx.world); updateGauge(game.ictx.world, game.ctx.hud); },
  islandTick(g) { const game = g as GameLike; updateGauge(game.ictx.world, game.ctx.hud); },
};
