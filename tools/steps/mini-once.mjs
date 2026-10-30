// Reliability driver: plays ONE mini-game's win bot from the page's URL (`?zone=<zone>&mute=1`) the way the full story does (lib-story.mjs playMini: the step is stopped when the zone is
// left through the result menu's Continue; a lost run is retried like a player), and prints one summary line.
//   MINI=z38PAR sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5802/?zone=z38PAR&mute=1" tools/steps/mini-once.mjs --size 1280x800 --out /tmp/mini
// MINI = the zone (z08BKD z09JST z10RGB z15SSH z17WAS z18MMP z20DSP z21FSH z22BIP z27TRX z28HAT z36CNT z38PAR z39ASB z40aPO z41MAP); NO_RETRY=1 counts a lost run as a failure.
import { makeRunner, playMini } from './lib-story.mjs';

const FILES = {
  z08BKD: 'm6-z08BKD.mjs', z09JST: 'm6-z09JST.mjs', z10RGB: 'm6-z10RGB.mjs', z15SSH: 'm6-z15SSH.mjs', z17WAS: 'm3-z17WAS.mjs', z18MMP: 'm6-z18MMP.mjs', z20DSP: 'm6-z20DSP.mjs',
  z21FSH: 'm6-z21FSH.mjs', z22BIP: 'm6-z22BIP.mjs', z27TRX: 'm6-z27TRX.mjs', z28HAT: 'm6-z28HAT.mjs', z36CNT: 'm3-z36cnt.mjs', z38PAR: 'm3-z38PAR.mjs', z39ASB: 'm3-z39ASB.mjs',
  z40aPO: 'm3-z40aPO.mjs', z41MAP: 'm3-z41MAP.mjs',
};
const D = new URL('.', import.meta.url).pathname;

export default async (h) => {
  const zone = process.env.MINI;
  if (!FILES[zone]) throw new Error(`MINI=${zone}?`);
  const R = makeRunner(h, { allowGoto: false });
  await R.arm();
  const r = await playMini(R, h, { file: D + FILES[zone], zone, label: zone, attempts: process.env.NO_RETRY ? 1 : 4 });
  h.log(`MINI-ONCE ${zone}: ${r.ok ? 'PASS' : 'FAIL'} attempts ${r.attempts} (${(r.ms / 1000).toFixed(0)} s)${r.ok ? '' : ' ' + r.fails.join(' | ').slice(0, 300)}`);
  if (!r.ok) process.exitCode = 1;
};
