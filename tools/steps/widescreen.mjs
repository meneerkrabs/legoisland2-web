// Widescreen survey: every zone in "Beeld: breedbeeld" (and with WIDE=0 in 4:3) at the window size of --size, two screenshots each (the intro / help screen, then play).
//   node tools/browse.mjs "http://localhost:5611/" tools/steps/widescreen.mjs --size 1280x720 --out /tmp/ws
//   ZONES="z02LGI z38PAR" WIDE=0 PREFIX=w43 node tools/browse.mjs ...   (a subset; WIDE=0 = the original 4:3 for comparison)
// Use a snapshot server (tools/m4-snapshot-server.sh <port>) when the repo is being edited. The first argument URL is only the base.
const ALL = 'z01BPK z02LGI z03PPH z04IFC z05WAB z07CSI z08BKD z09JST z10RGB z13CAI z14OSD z15SSH z16PYA z17WAS z18MMP z20DSP z21FSH z22BIP z23DIP z27TRX z28HAT z36CNT z38PAR z39ASB z40aPO z40OGL z41MAP z42BRP z50LTC';
export default async ({ page, shot, wait, log, key }) => {
  const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5499/';
  const wide = process.env.WIDE ?? '1';
  const prefix = process.env.PREFIX ?? 'wide';
  for (const z of (process.env.ZONES ?? ALL).split(' ')) {
    try {
      await page.goto(`${base.split('?')[0]}?zone=${z}&mute=1&wide=${wide}&hold=1`, { waitUntil: 'load' });
      await page.waitForFunction((a) => window.__zone && window.__zone.info && window.__zone.info.archive.toLowerCase() === a.toLowerCase(), z, { timeout: 120000 });
      await wait(2500);
      await shot(`${prefix}-${z}-1`);
      for (let i = 0; i < 4; i++) { await key('Enter'); await wait(500); }
      await wait(3500);
      await shot(`${prefix}-${z}-2`);
    } catch (e) { log(z, 'FAILED', String(e).slice(0, 120)); }
  }
};
