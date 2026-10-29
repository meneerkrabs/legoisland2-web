// The texts of the duel's panels: the round popup (FUN_005d4070, state 0x21) and the end panel (FUN_005d4467, state 0x23). Each line is a call of
// FUN_00439c6f(table, font, id, 1, 0, 320, y, wrap): `table` zone (message id of jst.str), std (message id of STD.str) or none (the text is printed as it is: "%d" of a number).
// Pure data so the test can compare it with the original's calls (tools/tests/m6-z09JST-emu.mjs).
export interface PanelLine { table: 'zone' | 'std' | 'raw'; text: string; y: number; wrap: number }
const z = (text: string, y: number, wrap = 30): PanelLine => ({ table: 'zone', text, y, wrap });
const r = (text: string | number, y: number, wrap = 30): PanelLine => ({ table: 'raw', text: String(text), y, wrap });

/** FUN_005d4070 by the state the clash went to (`popup` = +0x118): 4 too slow, 0xb the player hit (speed bonus +0xf8, precision +0xfc, round points +0x10c), 0xc the dark knight hit, 0xd / 0xe nobody */
export function popupLines(d: { popup: number; bonusSpeed: number; precision: number; roundPts: number }): PanelLine[] {
  switch (d.popup) {
    case 4: return [z('JST14', 100), z('JST15', 220), z('JST9', 340)];
    case 0xb: return [z('JST1', 100, 60), z('JST4', 150), r(d.bonusSpeed, 200), z('JST5', 250), r(d.precision, 300), z('JST6', 350), r(d.roundPts, 400)];
    case 0xc: return [z('JST10', 100), z('JST11', 160), z('JST12', 220), z('JST13', 280), z('JST9', 320)];
    case 0xd: case 0xe: return [z('JST7', 200), z('JST8', 260), z('JST9', 340)];
    default: return [];
  }
}

const MEDAL_STD = ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD'];
/** FUN_005d4467: the score "%5d" (y 60), then by the medal (+0x110): none: CASGJO05 / 06, bronze: SGBRONZE + CASGJO04, silver: SGSILVER + CASGJO03, gold: SGGOLD + CASGJO01 + CASGJO02 (y 340, wrap 35) */
export function finalLines(d: { medal: number; score: number }): PanelLine[] {
  const out: PanelLine[] = [r(String(d.score).padStart(5, ' '), 60)];
  switch (d.medal) {
    case 0: out.push(z('CASGJO05', 160), z('CASGJO06', 280)); break;
    case 1: case 2: case 3: out.push({ table: 'std', text: MEDAL_STD[d.medal], y: 100, wrap: 30 }, z(['', 'CASGJO04', 'CASGJO03', 'CASGJO01'][d.medal], 160)); if (d.medal === 3) out.push(z('CASGJO02', 340, 35)); break;
    default: break;
  }
  return out;
}
