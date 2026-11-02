// Web Audio in the real flow (start screen -> Spelen unlocks the context): the music synth streams blocks, the context runs, no underruns. Compare webkit / firefox / chromium.
//   node tools/browse.mjs "http://localhost:5497/?intro=0&hd=0" tools/steps/browser-audio.mjs --browser webkit
// (do NOT pass mute=1: that switches the audio engine off; tools/browse.mjs already silences the output in every engine)
export default async ({ page, wait, log, evaluate }) => {
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  await page.waitForSelector('button:has-text("Spelen")');
  await page.getByRole('button', { name: 'Spelen' }).click();
  await page.waitForFunction(() => window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 120000 });
  await wait(9000);
  const r = await evaluate(() => {
    const a = window.__shell.audio, ga = a.ga;
    const streams = [];
    const seen = new Set();
    const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 3 || seen.has(o)) return; seen.add(o); if (typeof o.blocks === 'number' && 'underruns' in o) streams.push({ blocks: o.blocks, underruns: o.underruns, running: o.running, renderMs: Math.round(o.renderMs) }); for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch { /* */ } } };
    walk(ga, 0);
    return { state: ga.ctx.state, t: +ga.ctx.currentTime.toFixed(2), rate: ga.ctx.sampleRate, streams };
  });
  log(JSON.stringify(r));
  expect('context running and advancing', r.state === 'running' && r.t > 3, `${r.state} ${r.t}s`);
  expect('a synth stream rendered blocks', r.streams.some((s) => s.blocks > 20), JSON.stringify(r.streams));
  expect('no underruns', r.streams.every((s) => s.underruns <= 2), JSON.stringify(r.streams.map((s) => s.underruns)));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all audio checks passed');
  if (fail.length) process.exitCode = 1;
};
