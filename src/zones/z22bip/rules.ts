// z22BIP: the end of the game (FUN_00706bee modes 2 / 4): the result code of the flight node (DAT_05d5d044: 1 out of fuel and stopped, 3 bronze, 4 silver, 5 and more
// gold), the hi-score / trophy variables, the speech and the banner lines. Pure.
export const BIP_VARS = { HISCORE: 0x27, TROPHY: 0xd6 } as const;

/** the medal the end banner shows for a result code: 1 / 2 failed, 3 bronze, 4 silver, 5 and more gold */
export function bipMedal(result: number): 0 | 1 | 2 | 3 { return result < 3 ? 0 : result === 3 ? 1 : result === 4 ? 2 : 3; }

/** what mode 4 writes: the hi-score when it is beaten, and the trophy from the result code (0 for 0 .. 2, 1 bronze, 2 silver, 3 for 5 and more) */
export function bipFinish(vars: { get(i: number): number; set(i: number, v: number): void }, score: number, result: number) {
  if (vars.get(BIP_VARS.HISCORE) < score) {
    vars.set(BIP_VARS.HISCORE, score);
    vars.set(BIP_VARS.TROPHY, bipMedal(result));
  }
}

/** the speech and banner lines of a result code: [id, y] (the medal text SGBRONZE / SGSILVER / SGGOLD of STD.str is at y 100) */
export function bipResultLines(result: number): { speech: string[]; lines: [string, number][]; medal: 'SGBRONZE' | 'SGSILVER' | 'SGGOLD' | null } {
  if (result < 3) return { speech: ['ADSGBI06', 'ADSGBI07'], lines: [['ADSGBI06', 0x8c], ['ADSGBI07', 300]], medal: null };
  if (result === 3) return { speech: ['ADSGBI04', 'ADSGBI05'], lines: [['ADSGBI04', 0x8c], ['ADSGBI05', 300]], medal: 'SGBRONZE' };
  if (result === 4) return { speech: ['ADSGBI02', 'ADSGBI03'], lines: [['ADSGBI02', 0x8c], ['ADSGBI03', 300]], medal: 'SGSILVER' };
  return { speech: ['ADSGBI01'], lines: [['ADSGBI01', 0x8c]], medal: 'SGGOLD' };
}
