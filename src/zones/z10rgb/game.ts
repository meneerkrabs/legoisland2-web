// z10RGB: the "rgbgame" node (constructor FUN_005f77ad, update FUN_005f72c0, on the ground record LAND) and the zone's set-up (FUN_005f67e4 / FUN_005f6340 /
// FUN_005f690b and the constructors' effects on the records): the phase machine (DAT_05d5b338), the score, the ambient sounds, the flags, the blinking of the hit
// player, the end of the game and its result variables (docs/re/m6/z10RGB.md sections 2, 7).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { World } from '../../game/world.ts';
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { K, PHASE, REC, RIGS, VAR, MODE, hopTable } from './consts.ts';
import { initPepperCannons } from './pepper.ts';
import { CedricNode } from './enemy.ts';
import type { CannonNode } from './enemy.ts';
import { RgbState } from './shared.ts';

import { ad, sb } from '../common/f32.ts';

const F = Math.fround;

export class RgbGameNode implements BehaviourNode {
  readonly kind = 'rgbgame';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  private st: RgbState;
  constructor(st: RgbState) { this.st = st; }

  /** the blinking of the player after a hit (phases 1 and 3): hidden on the ticks with bit 2 set while DAT_0090bc4c is 0, until the float DAT_0090bdf8 (3.0, minus 1/30 * dt * dt per update) is below 0: 90 updates at dt 1, 360 at dt 0.5 */
  private blink(w: World): void {
    const st = this.st, p = st.pepper;
    if (!st.vulnerable) {
      if (st.blink < 0) st.blink = K.BLINK;
      st.blink = F(st.blink - F(F(K.BLINK_STEP * w.dt) * w.dt));      // 24-bit x87: every operation rounds to a float
      if (0 <= st.blink) { if (st.ticks & 2) p.flags &= ~RF_ENABLED; else p.flags |= RF_ENABLED; }
      else { st.vulnerable = true; p.flags |= RF_ENABLED; }
    } else p.flags |= RF_ENABLED;
  }

  update(w: World, _rec: GameRecord, _ctrl: Controller): number {
    const st = this.st;
    st.bind(w);
    st.tickF = F(F(1 * w.dt) + st.tickF);
    st.ticks = Math.trunc(st.tickF);
    // the ambient sounds: a crow now and then (1 % of the ticks, 0.5 %), the wind always
    const r = Math.trunc(st.rand(200));
    if (r < 199) { if (r < 2) st.sound.play('crow2'); } else st.sound.play('crow1');
    st.sound.play('wind');
    switch (st.phase) {
      case PHASE.BRIDGE: {
        st.saidBanner = false; st.saidPhase2 = false;
        this.blink(w);
        const n = Math.trunc(sb(st.tickF, st.baseTick));
        st.score = 1000 - n < 0 ? 0 : 1000 - n;
        break;
      }
      case PHASE.CROSSED:
        st.phase = PHASE.CANNONS;
        st.shotSpeed = K.SHOT_SPEED_PHASE3;
        st.cedricFire = false;
        st.hud.gauge = true; st.hud.min = 0; st.hud.max = K.GAUGE_CANNONS; st.hud.value = st.cannonsLeft; st.hud.icon = 6;
        if (!st.saidPhase2) { st.say('CASGRB08'); st.saidPhase2 = true; }
        break;
      case PHASE.CANNONS:
        this.blink(w);
        break;
      case PHASE.WON:
        w.vars.set(VAR.GAME_ON, 0); w.vars.set(VAR.COMPLETE_SUB_GAME, 1);     // FUN_005f72c0 case 4: var 0xfa = 0, var 0x53 = 1 every tick
        st.resultMode = 1;
        if (!st.resultWritten) { st.writeResult(); st.resultWritten = true; }
        break;
      case PHASE.LOST:
        w.vars.set(VAR.GAME_ON, 0); w.vars.set(VAR.COMPLETE_SUB_GAME, 1);    // case 5: the same write on a loss
        st.resultMode = 2;
        break;
    }
    // FUN_005f7d8a: the sixteen flags wave at a random rate 0.75 .. 1.25
    for (const i of REC.FLAGS) w.records[i].anim?.advance(ad(st.rand(0.5), K.FLAG_RATE), w.dt);
    return NODE_CONTINUE;
  }
}

/** the animation instances the zone's loader binds (FUN_0060aeac: `FUN_0043b4e2(rig, 1)` + `FUN_0043b6a3(anim, 1, 0)`); `rigs` = the parsed blk by name */
export function bindRigs(w: World, rigs: Record<string, Blk | null>): void {
  for (const g of RIGS) {
    const blk = rigs[g.name];
    if (!blk) continue;
    for (const i of g.records) {
      const r = w.records[i];
      if (r.anim) continue;
      r.anim = new AnimInstance(blk);
      r.anim.start(1, 0);
    }
  }
}

export interface RgbSetup {
  /** the executable (the hop table of Cedric) */
  pe: { u32(va: number): number };
  /** the zone's archive (the rigs) */
  archive: { find(p: string): unknown; read(e: never): Uint8Array };
}

/**
 * Everything the original does when it sets the zone up and constructs the nodes that touches the records and the variables: the rigs, the camera (eye 8 higher
 * than the walk's default), the cannons of the player and their matrices, the nine enemy cannons (heading negated, Cedric's perches), the balls parked, the
 * zone variables. Call once after `setupZone`, before the first tick.
 */
export function initRgb(st: RgbState, w: World, setup: RgbSetup): void {
  st.bind(w);
  const bad = RgbState.check(w.records);
  if (bad.length) throw new Error(`z10RGB: ${bad.join('; ')}`);
  const rigs: Record<string, Blk | null> = {};
  for (const g of RIGS) {
    const e = setup.archive.find(`anim/${g.name}.blk`);
    rigs[g.name] = e ? parseBlk(setup.archive.read(e as never)) : null;
  }
  bindRigs(w, rigs);
  st.hop = hopTable(setup.pe);
  initPepperCannons(st);
  const ced = st.cedric.ctrl?.find<CedricNode>('cedric');
  ced?.init(w);
  for (const b of st.balls) b.state = 0;     // FUN_005f8050 leaves the balls where the builder put them (under the sea) until they are first used
  for (const i of REC.CC) { const n = w.records[i].ctrl?.find<CannonNode>('cannon'); if (n) n.restY = w.records[i].y; }   // FUN_0061a57f: +0x4c = the cannon's height
  st.cedric.flags |= 0x100;                  // FUN_00619863
  w.vars.set(VAR.GAME_ON, 1); w.vars.set(VAR.MODE, MODE.WALK); w.vars.set(VAR.CEDRIC_ON, 1);
  w.vars.set(VAR.PEPP_CANNON_BIT, 0); w.vars.set(VAR.ENEMY_CANNON_BIT, 0);
  // FUN_005f67e4: the camera from the player's place (FUN_00422b50), eye 8 higher (_DAT_00892090)
  w.camera.init(st.pepper);
  w.camera.c[1] += K.CAM_RAISE;
  w.camera.updateView(); w.camera.savePrev();
  st.modeNow = st.modePrev = MODE.WALK;
}
