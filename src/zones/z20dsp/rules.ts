// The result rules of z20DSP (FUN_006c6d57 / FUN_006bd362): pure helpers.
/** var 0x103 -> medal: 0 none, 1 bronze, 2 silver, 3 gold (FUN_006c6d57: time < 2700 ticks -> 3, < 3600 -> 2, < 4500 -> 1, else 0) */
export const medalFromVar = (v: number): 0 | 1 | 2 | 3 => (v === 1 ? 1 : v === 2 ? 2 : v === 3 ? 3 : 0);
/** the lines FUN_006bd362 speaks and draws: below bronze DS04 + DS05 (y 120 / 300), else the medal's line (DS03 bronze, DS02 silver, DS01 gold; y 150) */
export const resultLines = (medal: number): [string, string | null] => (medal === 0 ? ['ADSGDS04', 'ADSGDS05'] : [['ADSGDS03', 'ADSGDS02', 'ADSGDS01'][medal - 1], null]);
