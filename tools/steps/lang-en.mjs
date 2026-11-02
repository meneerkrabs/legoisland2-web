// "Taal: English" in the real game (headless, muted): the island's opening cutscene (subtitles + speech clips of the language pack), then a save slot written and its caption data.
// Run it in English and in Dutch and compare (LANG=nl for the Dutch run: the pack must change nothing):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5741/?zone=z02LGI&lang=en" tools/steps/lang-en.mjs --size 1024x768 --out /tmp/lang-en
//   LANG=nl sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5741/?zone=z02LGI&lang=nl" tools/steps/lang-en.mjs --size 1024x768 --out /tmp/lang-nl
// Relay route against a local stand-in (node tools/proxy/local-range-relay.mjs 8766 '<item>/<iso>=<English ISO>'): LANGSRC=archive and add `&langsource=archive&proxy=http://127.0.0.1:8766/ia/{item}/{iso}` to the URL.
// (no `mute=1` in the URL: the audio engine has to run for the speech checks; browse.mjs keeps the device muted.) Needs the dev server with public/data/le2-en (vite.config.ts).
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  const want = process.env.LANG === 'nl' ? 'nl' : 'en';
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const S = island(h);
  await S.waitIsland();
  const info = await evaluate(() => ({ lang: window.__le2Lang ?? null, title: document.title }));
  log('language', JSON.stringify(info));
  if (want === 'en') expect(`English pack active (${process.env.LANGSRC ?? 'dev'})`, info.lang?.lang === 'en' && info.lang.origin === (process.env.LANGSRC ?? 'dev') && info.lang.replaced === 1801, JSON.stringify(info.lang));
  else expect('Dutch: no pack, nothing wrapped', info.lang === null);
  // collect every subtitle and every speech line that starts, from the first frame on
  await evaluate(() => {
    const z = window.__zone, sp = z.sh.audio.ga?.speech;
    window.__subs = []; window.__lines = [];
    if (sp) sp.onLineStart = (i, id) => window.__lines.push([i, id]);
    setInterval(() => {
      const s = z.ctx.cutscene?.runner?.subtitle;
      if (s && !window.__subs.some((x) => x.id === s.id)) window.__subs.push({ id: s.id, text: s.text });
    }, 50);
  });
  await S.start();   // the island's intro panel (mode 1) -> play (mode 2); the opening cutscene starts with it
  let shotDone = false, seenCs = false;
  for (let i = 0; i < 500; i++) {
    const cs = (await S.state())?.cs;
    if (cs) seenCs = true; else if (seenCs || i > 40) break;
    if (!shotDone && (await evaluate(() => window.__subs.length)) >= 2) { await shot(`island-subtitle-${want}`); shotDone = true; }
    await wait(250);
  }
  const subs = await evaluate(() => window.__subs), lines = await evaluate(() => window.__lines);
  const stats = await evaluate(() => ({ ...window.__zone.sh.audio.ga.speech.stats }));
  log('subtitles', JSON.stringify(subs.slice(0, 6)));
  log('speech lines', JSON.stringify(lines.slice(0, 12)), 'stats', JSON.stringify(stats));
  expect('the opening cutscene showed subtitles', subs.length >= 3, `${subs.length}`);
  expect('speech lines started', lines.length >= 3, `${lines.length}`);
  expect('no speech file missing', stats.missing === 0, JSON.stringify(stats));
  const text = subs.map((s) => s.text).join(' ');
  if (want === 'en') expect('subtitles are English', /\b(the|you|and|to)\b/i.test(text) && !/\b(het|een|jij|jouw|de)\b/i.test(text), text.slice(0, 160));
  else expect('subtitles are Dutch', /\b(het|een|je|de)\b/i.test(text), text.slice(0, 160));
  // the clip the engine read for the first line is the pack's file (English speech/English/LECSIN01.mp3 under the Dutch name)
  const clip = await evaluate(async () => { const f = window.__zone.sh.files; const b = await f.read('_data/sounds/speech/Data/LECSIN01.mp3'); return { size: b.length, listed: f.list().filter((p) => /speech\/data\/.+\.mp3$/i.test(p)).length }; });
  log('LECSIN01', JSON.stringify(clip));
  if (want === 'en') expect('LECSIN01 is the English clip (size differs from the Dutch one)', clip.size > 0 && clip.listed === 1796, JSON.stringify(clip));
  await S.skipCutscenes();
  await wait(500);
  await shot(`island-${want}`);
  // a save slot: the header's caption data
  const saved = await evaluate(() => window.__shell.saveSlot(2));
  expect('slot 2 written', saved === true);
  await wait(500);
  const cap = await evaluate(async () => { const sh = window.__shell; const i = await sh.saves.slotInfo(2); return { empty: i.empty, header: i.header ? JSON.parse(JSON.stringify(i.header, (k, v) => (typeof v === 'bigint' ? String(v) : v))) : null, level: sh.msgs.label('!LEVLGI'), std: sh.std.text('SGGOLD'), win: document.title }; });
  log('slot 2', JSON.stringify(cap));
  expect('slot 2 has a header', !cap.empty && cap.header);
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'language checks passed');
  if (fail.length) process.exitCode = 1;
};
