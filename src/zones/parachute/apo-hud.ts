// z40aPO: the HUD state of FUN_007d0f00 (every tick of the play mode, and during the intro cutscene): the score, one icon per ring group (spinning once a ring of the group
// was passed, crossed out when the group was missed), the "wing may open" icon and the altitude gauge (the same bar as z38PAR). Pure; textures are indices of the zone's
// `Overlays/Z40APO` set (`how these equate.txt`: 14..43 bronze spin, 44..73 silver spin, 74..103 gold spin, 104 / 105 / 106 failed bronze / silver / gold).
import type { ApoRun } from './apo-run.ts';
import { ftol } from './util.ts';

export const APO_HUD = {
  /** the icon of group 1 / 2 / 3 when nothing happened: first frame of the spin */
  NORMAL: [0xe, 0x2c, 0x4a] as const,
  MISSED: [0x68, 0x69, 0x6a] as const,
  SPIN_START: [14, 44, 74] as const,
  SPIN_END: [43, 73, 103] as const,
  CHUTE_NO: 12, CHUTE_OK: 9,
  GAUGE_LOW: 0xb, GAUGE_HIGH: 10,
} as const;

export interface ApoHudFrame {
  text: string;
  /** the left icon column from the bottom: group 3 (750 points), group 2, group 1 */
  groups: [number, number, number];
  chuteIcon: number;
  gauge: { segments: number[]; marker: number };
}

export class ApoHud {
  /** DAT_0094a0d8 / d4 / d0: the spin counters of group 1 / 2 / 3 (14, 44, 74 initially; they persist across games) */
  spin: [number, number, number] = [14, 44, 74];
  frame: ApoHudFrame = { text: '0', groups: [0x4a, 0x2c, 0xe], chuteIcon: 12, gauge: { segments: [], marker: 0 } };

  update(run: ApoRun, dt = 1): ApoHudFrame {
    const f = this.frame;
    f.text = String(ftol(run.score));
    // group g covers rings 5g .. 5g + 4; the slot order is reversed (group 3 is the bottom icon)
    const icon = [0, 0, 0];
    for (let g = 0; g < 3; g++) {
      let hit = false;
      for (let i = 5 * g; i < 5 * g + 5; i++) if (run.ring[i] === 1) hit = true;
      if (hit) {
        this.spin[g] += 1 * dt;
        if (APO_HUD.SPIN_END[g] < this.spin[g]) this.spin[g] = APO_HUD.SPIN_START[g];
        icon[g] = ftol(this.spin[g]);
      } else if (run.ring[5 * g + 4] === 2) icon[g] = APO_HUD.MISSED[g];
      else icon[g] = APO_HUD.NORMAL[g];
    }
    f.groups = [icon[2], icon[1], icon[0]];
    f.chuteIcon = run.chuteOk ? APO_HUD.CHUTE_OK : APO_HUD.CHUTE_NO;
    let local = 204 - (run.y / run.startAlt) * 204;
    let upper: number;
    if (153 <= local) {
      upper = APO_HUD.GAUGE_LOW;
      local = 204 - (run.height / run.refAlt) * 204;
      run.chuteOk = true;
    } else { upper = APO_HUD.GAUGE_HIGH; run.refAlt = run.y; }
    f.gauge.segments = Array.from({ length: 12 }, (_, i) => (i < 3 ? APO_HUD.GAUGE_LOW : upper));
    if (local > 204) local = 204;
    f.gauge.marker = Math.min(1, Math.max(0, (204 - local) / 204));
    return f;
  }
}
