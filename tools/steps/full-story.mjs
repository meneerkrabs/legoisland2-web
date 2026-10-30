// FULL STORY BOT: plays LEGO Island 2 from the front end (Starten -> Nieuw spel) to the free roam at story node 68, headless and muted, with real key input through the port's
// input mapper (page.keyboard). It chains the existing chapter bots IN PLACE (tools/steps/lib-story.mjs): the page is never reloaded between chapters, a chapter starts where the
// previous one left the game, the story advances only through the game's own triggers (no story-node jumps, no F9 / F10, no `debug=1`).
//
//   sh tools/m4-snapshot-server.sh 5801            (a snapshot of the repo: stop with pkill -f m4snap-5801)
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5801/?start=frontend&mute=1&hold=1" tools/steps/full-story.mjs --size 1280x800 --out /tmp/full-story
//
// Env:
//   RESUME=<chapter id>   start at that chapter (the page goes to its URL start point: `?zone=<zone>&node=<node>`, the original's own chapter jump, only for resuming);
//                         RESUME=auto continues after the last chapter of the checkpoint file
//   STOP_AFTER=<id>       end after that chapter
//   CHECKPOINT=<file>     default /tmp/full-story-checkpoint.json: { chapter, node, arch, at } written after every chapter that arrived where the story goes on
//   LIST=1                print the chapters and exit
// Shortcuts (each documented where it is taken): the chapter bots teleport Pepper along long walks (the keys do the actions); the mini-game bots are the ones of the m3 / m5 / m6
// steps (some shorten the clock / put the vehicle at 90 % of the course after a real stretch, see the headers of those steps). Mini-games are played by their own win bots,
// never skipped with a node jump.
import fs from 'node:fs';
import { makeRunner, probe, waitProbe, installStoryTrace, storyTrace, playMini as playMiniRetry } from './lib-story.mjs';
import { island } from './lib-island.mjs';
import { ogelArc } from './lib-ogelarc.mjs';

const D = new URL('.', import.meta.url).pathname;
const step = (n) => D + n;
const CHECKPOINT = process.env.CHECKPOINT ?? '/tmp/full-story-checkpoint.json';

/** mini-games: the step whose first part is a WIN with real keys (the step is stopped when the zone has been left through the result menu's Continue) */
const MINI = {
  z08BKD: { file: 'm6-z08BKD.mjs' },
  z09JST: { file: 'm6-z09JST.mjs' },
  z10RGB: { file: 'm6-z10RGB.mjs' },
  z15SSH: { file: 'm6-z15SSH.mjs' },
  z17WAS: { file: 'm3-z17WAS.mjs' },
  z18MMP: { file: 'm6-z18MMP.mjs' },
  z20DSP: { file: 'm6-z20DSP.mjs' },
  z21FSH: { file: 'm6-z21FSH.mjs' },
  z22BIP: { file: 'm6-z22BIP.mjs' },
  z27TRX: { file: 'm6-z27TRX.mjs' },
  z28HAT: { file: 'm6-z28HAT.mjs' },
  z39ASB: { file: 'm3-z39ASB.mjs' },
  z40aPO: { file: 'm3-z40aPO.mjs' },
  z41MAP: { file: 'm3-z41MAP.mjs' },
};

/** `pred` has held for `ms` of wall time: the chapter's step is done (anything it still waits for is a hang of its own: a wait on the old zone's ticks, a promise that never comes) */
const stable = (pred, ms) => { let since = 0; return (st) => { if (pred(st)) { since ||= Date.now(); return Date.now() - since >= ms; } since = 0; return false; }; };

export default async (h) => {
  const { page, log, wait } = h;
  const fails = [];
  const t0 = Date.now();
  const stamp = () => `[${((Date.now() - t0) / 60000).toFixed(1)} min]`;
  const base = new URL(page.url()).origin;
  process.env.STRICT = '1';   // the chapter bots take no dev aid in the full story (a missing delivery is a failure, not completed through a variable)
  const R = makeRunner(h, { allowGoto: !!process.env.RESUME, base });
  const S = island(h);
  const cp = (chapter, st) => { try { fs.writeFileSync(CHECKPOINT, JSON.stringify({ chapter, node: st.node, arch: st.arch, at: new Date().toISOString(), minutes: +((Date.now() - t0) / 60000).toFixed(1) })); } catch { /* ignore */ } };

  /** play the mini-game `arch` (the zone is running) with its own win bot until the result menu's Continue has led away from it (a lost run is retried like a player does) */
  const retries = [];
  const playMini = async (arch, env = {}) => {
    const m = MINI[arch];
    if (!m) throw new Error(`no player for the mini-game ${arch}`);
    log(stamp(), `mini-game ${arch}: ${m.file}`);
    const r = await playMiniRetry(R, h, { file: step(m.file), env: { ...(m.env ?? {}), ...env }, zone: arch, label: arch, stamp });
    if (r.attempts > 1) retries.push(`${arch}: ${r.attempts} attempts`);
    log(stamp(), `mini-game ${arch}: ${r.ok ? 'ok' : 'FAILED ' + r.fails.join(' | ')} (${(r.ms / 1000).toFixed(0)} s, ${r.attempts} attempt(s)${r.killed ? ', stopped after the win' : ''})`);
    if (!r.ok) fails.push(`${arch}: ${r.fails.join(' | ')}`);
    return r;
  };
  globalThis.LE2_MINIGAME = playMini;

  // ------------------------------------------------------------------------------------------------------------------------------- chapters
  // arrive(st): the state the chapter must leave the game in (checked before the next chapter starts); start: the URL start point of the chapter (resume only)
  const isl = (node, sub) => (st) => st.arch === 'z02LGI' && st.node === node && (sub === undefined || st.sub === sub);
  const zn = (arch, node) => (st) => st.arch === arch && (node === undefined || st.node === node);
  const mini = (arch, node, next, env = {}) => ({ id: arch.toLowerCase(), title: `mini-game ${arch} (node ${node})`, start: { zone: arch, node }, mini: arch, env, arrive: next });
  const hubStep = (id, title, zone, node, mod, env, next) => ({ id, title, start: { zone, node }, mod, env, arrive: next });
  const CH = [
    { id: 'fe-ch1', title: 'front end, new game, island era 0 and 1 up to Whack-A-Bot', start: { fe: true }, mod: 'm4-chapter1.mjs', env: {}, arrive: isl(11, 31) },
    { id: 'era1', title: 'island era 1: mainframe, Res-Q, boat, sea portal', start: { zone: 'z02LGI', node: 11 }, mod: 'm4-era1.mjs', env: { STOP: 'castle', INPLACE: 1 }, arrive: (st) => st.arch === 'z07CSI' && st.node >= 15 },
    { id: 'castle', title: 'castle island z07CSI nodes 15..29 with BKD, JST, RGB', start: { zone: 'z07CSI', node: 15 }, mod: 'm5-z07CSI.mjs', env: {}, arrive: isl(30, 32) },
    { id: 'era2', title: 'island era 2: pages, police, helicopter, air portal', start: { zone: 'z02LGI', node: 30 }, mod: 'm4-era2.mjs', env: { FROM: 'castle', STOP: 'stubs', INPLACE: 1 }, arrive: zn('z13CAI', 33) },
    hubStep('cai33', 'Adventure Island, first flight (node 33)', 'z13CAI', 33, 'm5-z13CAI-node33.mjs', {}, zn('z14OSD', 34)),
    hubStep('osd34', 'Oasis (node 34)', 'z14OSD', 34, 'm5-z14OSD-bot.mjs', { INPLACE: 1 }, zn('z15SSH', 35)),
    mini('z15SSH', 35, zn('z16PYA', 36)),
    hubStep('pya36', 'Pyramid (node 36)', 'z16PYA', 36, 'm5-z16PYA.mjs', { ONLY: 36, QUICK: 1 }, zn('z17WAS', 37)),
    mini('z17WAS', 37, zn('z16PYA', 38)),
    hubStep('pya38', 'Pyramid (node 38)', 'z16PYA', 38, 'm5-z16PYA.mjs', { ONLY: 38 }, zn('z18MMP', 39)),
    mini('z18MMP', 39, zn('z16PYA', 40)),
    hubStep('pya40', 'Pyramid (node 40)', 'z16PYA', 40, 'm5-z16PYA.mjs', { ONLY: 40 }, zn('z20DSP', 41)),
    mini('z20DSP', 41, zn('z21FSH', 42)),
    mini('z21FSH', 42, zn('z14OSD', 45)),
    hubStep('osd45', 'Oasis (node 45)', 'z14OSD', 45, 'm5-z14OSD-bot45.mjs', {}, zn('z22BIP', 46)),
    mini('z22BIP', 46, zn('z23DIP', 47)),
    hubStep('dip47', 'Dino island (node 47)', 'z23DIP', 47, 'm5-z23DIP-story.mjs', {}, zn('z27TRX', 48)),
    mini('z27TRX', 48, zn('z28HAT', 49)),
    mini('z28HAT', 49, zn('z23DIP', 50)),
    hubStep('dip50', 'Dino island (node 50)', 'z23DIP', 50, 'm5-z23DIP-story.mjs', {}, zn('z13CAI', 51)),
    hubStep('cai51', 'Adventure Island, flight home (node 51)', 'z13CAI', 51, 'm5-z13CAI-node51.mjs', {}, isl(52, 33)),
    { id: 'home', title: 'island era 3: the helicopter lands (nodes 52, 53)', start: { zone: 'z13CAI', node: 51 }, mod: 'm4-era2.mjs', env: { FROM: 'stubs', INPLACE: 1 }, arrive: (st) => st.arch === 'z02LGI' && st.sub === 33 && st.node >= 53 },
    { id: 'era3', title: 'island era 3 (pages, bot heads, police, Space Port), z36CNT, z38PAR, island era 4, the shuttle', start: { zone: 'z02LGI', node: 54 }, mod: 'm4-era3.mjs', env: { FROM: 'pages', STOP: 'asb' }, arrive: zn('z39ASB', 62) },
    { id: 'ogel', title: 'the Ogel arc: z39ASB, z40aPO, z40OGL, z41MAP, z40OGL, z42BRP, outro, free roam at node 68', start: { zone: 'z39ASB', node: 62 }, arc: true, arrive: isl(68, 2) },
    { id: 'end', title: 'node 68: free roam in the island', start: { zone: 'z02LGI', node: 68 }, mod: 'm4-era3.mjs', env: { FROM: 'end' }, arrive: isl(68, 2) },
  ];
  if (process.env.LIST) { for (const c of CH) console.log(c.id, '-', c.title); return; }

  let from = 0;
  if (process.env.RESUME) {
    let id = process.env.RESUME;
    if (id === 'auto') {
      const c = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
      const k = CH.findIndex((x) => x.id === c.chapter);
      id = CH[k + 1]?.id ?? CH[k].id;
      log(stamp(), `resume: checkpoint ${JSON.stringify(c)} -> chapter ${id}`);
    }
    from = CH.findIndex((x) => x.id === id);
    if (from < 0) throw new Error(`RESUME=${id}?`);
    const s = CH[from].start;
    if (!s.fe) {
      const url = `${base}/?zone=${s.zone}&node=${s.node}&mute=1&hold=1`;
      log(stamp(), `resume at ${id}: ${url}`);
      process.env.RESUMED = '1';   // the steps know that the first chapter did not start through the game's own hand-over
      await page.goto(url, { waitUntil: 'load' });
    }
  } else {
    // a fresh game: the movies, if any, are skipped with a key like a player would; the chapter bot opens the menu
  }

  await R.arm();   // from here on a reload of the page under the bot (dev-server HMR, a crash) is reported as such, not mistaken for the story rewinding
  for (let i = from; i < CH.length; i++) {
    const c = CH[i];
    log(stamp(), `=== chapter ${c.id}: ${c.title}`);
    await installStoryTrace(page).catch(() => {});
    const r = c.arc
      ? await ogelArc(h, R, { fromNode: c.start.node, stamp }).then((x) => ({ ok: x.ok, fails: x.fails }))
      : c.mini
      ? await (async () => { const before = fails.length; const x = await playMini(c.mini, c.env); fails.length = before; return x; })()
      : await R.runModule(step(c.mod), { env: c.env, label: c.id, ms: 3 * 3600 * 1000, until: c.mod === 'm4-era3.mjs' && c.env.FROM === 'end' ? null : stable(c.arrive, 6000) });
    const st = await waitProbe(page, (p) => c.arrive(p), 120000) ?? await probe(page);
    const arrived = !!st && !st.hung && c.arrive(st);
    log(stamp(), `=== chapter ${c.id}: ${r.ok ? 'steps ok' : 'STEP FAILURES: ' + r.fails.join(' | ')}; ${arrived ? 'arrived' : 'DID NOT ARRIVE'} ${JSON.stringify({ arch: st?.arch, node: st?.node, mode: st?.mode })}`);
    if (!r.ok) fails.push(`${c.id}: ${r.fails.join(' | ')}`);
    if (!arrived) { fails.push(`${c.id}: did not arrive where the story goes on`); log('story trace:', JSON.stringify(await storyTrace(page))); break; }
    cp(c.id, st);
    if (process.env.STOP_AFTER === c.id) break;
  }
  if (retries.length) log(stamp(), `mini-games that needed a retry: ${retries.join(', ')}`);
  log(stamp(), fails.length ? `FULL STORY FAILED: ${fails.join(' || ')}` : 'FULL STORY: all chapters played');
  if (fails.length) process.exitCode = 1;
};
