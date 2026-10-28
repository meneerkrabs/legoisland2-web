import './style.css';
import { audio } from './engine/audio.ts';
import { playMovie } from './engine/movie.ts';
import { addIso, ARCHIVE_PAGE, availableSource, cdFolder, GAME_TITLE, removeArchiveCache, removeIso } from './library.ts';
import { MOVIES, type GameFiles, type Progress } from './files.ts';

const app = document.getElementById('app')!;
if (new URLSearchParams(location.search).has('trace')) (window as unknown as { __le2Trace: unknown[] }).__le2Trace = []; // ?trace=1: every files.read() is logged (tools/steps/trace.mjs)

function showError(e: unknown) {
  console.error(e);
  const div = document.createElement('div');
  div.className = 'bdb-error';
  div.textContent = e instanceof Error ? e.message : String(e);
  div.onclick = () => div.remove();
  document.body.appendChild(div);
}
addEventListener('unhandledrejection', (e) => showError(e.reason));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  n.append(...kids);
  return n;
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
const SOURCE_NAMES = { iso: 'Van je eigen ISO', cd: 'Van je eigen cd-map', dev: 'Uit public/data (dev)', archive: 'Van archive.org' };

async function startScreen() {
  app.replaceChildren();
  const lib = await availableSource();
  const status = el('div', { className: 'note' });
  const bar = el('div', { className: 'bdb-loading-bar' });
  const track = el('div', { className: 'bdb-loading-track', style: 'width:min(60vw,26rem);display:none' }, bar);
  const progress: Progress = (done, total, label) => {
    track.style.display = '';
    bar.style.width = `${Math.min(100, (100 * done) / total)}%`;
    status.textContent = `${label?.includes('…') ? label : `Spel laden… ${label ?? ''}`} ${total > 1 ? `${mb(done)} van ${mb(total)}` : ''}`.trim();
  };
  const fraction = (label: string) => (f: number) => {
    track.style.display = '';
    bar.style.width = `${f * 100}%`;
    status.textContent = `${label} ${Math.round(f * 100)}%`;
  };

  let busy = false;
  const start = async () => {
    if (busy) return;
    busy = true;
    await audio.unlock();
    try {
      status.textContent = 'Spel laden…';
      const files = await lib.open(progress);
      track.style.display = 'none';
      status.textContent = '';
      await play(files);
    } catch (e) {
      busy = false;
      track.style.display = 'none';
      status.textContent = '';
      showError(e);
    }
  };

  const isoInput = el('input', { type: 'file', accept: '.iso,.ISO', hidden: true });
  const addIsos = async (list: Iterable<File>) => {
    for (const f of list) {
      try { await addIso(f, fraction(`${f.name} bewaren in je browser…`)); } catch (e) { showError(e); }
    }
    startScreen();
  };
  isoInput.onchange = () => addIsos(isoInput.files ?? []);
  const dirInput = el('input', { type: 'file', hidden: true });
  dirInput.webkitdirectory = true;
  dirInput.onchange = async () => {
    try {
      const files = await cdFolder([...(dirInput.files ?? [])].map((f) => [f.webkitRelativePath, f] as [string, Blob]), progress);
      await audio.unlock();
      status.textContent = '';
      await play(files);
    } catch (e) { showError(e); }
  };

  const first = lib.source === 'archive' && !lib.cached;
  const note = lib.source === 'archive'
    ? `De spelbestanden komen uit de ISO op <a href="${ARCHIVE_PAGE}" target="_blank" rel="noopener">archive.org</a>. ${first
      ? (lib.proxy
        ? 'De eerste keer worden alleen de onderdelen gedownload die je nodig hebt (via een tussenserver); die blijven daarna in je browser.'
        : 'De eerste keer worden eenmalig ongeveer 350 MB gedownload (de installatiebestanden van de cd). Je kunt al beginnen terwijl dat doorloopt; daarna staan ze in je browser.')
      : 'Ze staan al in je browser, dus er hoeft niets gedownload te worden.'} De films worden van archive.org gestreamd.`
    : lib.source === 'iso'
      ? 'De spelbestanden worden gelezen uit je eigen ISO, die in je browser is bewaard.'
      : 'De spelbestanden komen uit de ontwikkelmap public/data (alleen in de dev-server).';

  const screen = el('div', { className: 'bdb-start' },
    el('h1', { textContent: GAME_TITLE }),
    el('div', { className: 'books' }, el('button', { textContent: 'Spelen', title: SOURCE_NAMES[lib.source], onclick: start })),
    track,
    status,
    el('div', { className: 'note', innerHTML: note }),
    el('details', { className: 'note' },
      el('summary', { textContent: 'Eigen cd of ISO gebruiken' }),
      el('div', { className: 'books' },
        el('button', { textContent: 'ISO-bestand kiezen…', onclick: () => isoInput.click() }),
        el('button', { textContent: 'cd-map kiezen…', onclick: () => dirInput.click() }),
        ...(lib.source === 'iso' ? [el('button', { textContent: 'Eigen ISO verwijderen', onclick: async () => { await removeIso(); startScreen(); } })] : []),
        ...(lib.source === 'archive' && lib.cached ? [el('button', { textContent: 'Gedownloade bestanden verwijderen', onclick: async () => { await removeArchiveCache(); startScreen(); } })] : [])),
      'Je kunt een ISO ook hierheen slepen. Een ISO wordt in je browser bewaard (ongeveer 450 MB); een cd-map alleen tijdens deze sessie.'),
    isoInput, dirInput,
  );
  screen.ondragover = (e) => e.preventDefault();
  screen.ondrop = (e) => {
    e.preventDefault();
    void addIsos(e.dataTransfer?.files ?? []);
  };
  app.appendChild(screen);
}

async function runMovie(files: GameFiles, name: string) {
  const media = await files.movie(name);
  if (!media) {
    showError(new Error(`Film ${name} niet gevonden in deze bron.`));
    return;
  }
  try {
    await playMovie(app, media, name, Number(new URLSearchParams(location.search).get('throttle') ?? 0));
  } catch (e) {
    showError(e);
  }
}

/** Small corner badge while the game data is still arriving (progressive archive.org download / range prefetch). */
function showLoadBadge(files: GameFiles) {
  const st = files.loading;
  if (!st || st.complete) return;
  document.getElementById('le2-loadbadge')?.remove();
  const badge = el('div', { id: 'le2-loadbadge', className: 'le2-loadbadge' });
  document.body.appendChild(badge);
  const update = () => {
    if (st.error) { badge.textContent = 'Laden van spelbestanden mislukt'; badge.classList.add('le2-err'); return; }
    if (st.complete) { badge.remove(); off(); return; }
    badge.textContent = `Spelbestanden laden: nog ${Math.round((1 - st.fraction) * 100)}% (${mb(st.total - st.done)})`;
  };
  const off = st.subscribe(update);
  update();
}

/** The game: start-up movies, then the zone loop (src/shell): front end, story, zones. `?intro=0` skips the movies, `?start=frontend` goes straight to the front end,
 * `?zone=z02LGI[&node=N]` starts in that zone, `?save=N` loads save slot N (docs/engine-api.md "Dev / test URLs"). */
async function play(files: GameFiles, params = new URLSearchParams(location.search)) {
  app.replaceChildren();
  showLoadBadge(files);
  const only = params.get('movie');
  if (only) { await runMovie(files, only); showFiles(files); return; }
  const [{ Shell, registerZoneRunner }, { runFrontEnd }, { runPlayZone }] = await Promise.all([import('./shell/shell.ts'), import('./shell/frontend.ts'), import('./shell/playzone.ts')]);
  registerZoneRunner('frontend', runFrontEnd);
  registerZoneRunner('default', runPlayZone);
  const direct = params.has('zone') || params.has('save') || params.get('start') === 'frontend';
  const sh = await Shell.create(app, files, {
    mute: params.get('mute') === '1',
    intro: params.get('intro') !== '0' && !direct,
    zone: params.get('zone') ?? undefined,
    node: params.has('node') ? Number(params.get('node')) : undefined,
    save: params.has('save') ? Number(params.get('save')) : undefined,
    start: params.get('start') ?? undefined,
  }, (m) => { document.title = m; });
  (window as unknown as { __shell?: unknown }).__shell = sh;
  document.title = GAME_TITLE; // the loading status lines went to the tab title
  if (sh.params.intro) await sh.runIntro();
  await sh.run();
  // "Stoppen": back to the start screen
  sh.canvas.remove();
  startScreen();
}

/** the engine's dev entry (src/game/play.ts) on a zone; keeps the URL's other params (pos, era, mute) */
function startGame(files: GameFiles, zone: string) {
  const params = new URLSearchParams(location.search);
  params.set('zone', zone);
  return import('./game/play.ts').then((m) => m.startPlay(app, files, params));
}

function showFiles(files: GameFiles) {
  app.replaceChildren();
  const list = files.list();
  const byDir = new Map<string, { n: number; bytes: number }>();
  for (const p of list) {
    const parts = p.split('/');
    const top = parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, 2)).join('/') : '(map)';
    const d = byDir.get(top) ?? { n: 0, bytes: 0 };
    d.n++;
    d.bytes += files.size(p);
    byDir.set(top, d);
  }
  const rows = [...byDir].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 14);
  const table = el('table', {},
    el('tr', {}, el('th', { textContent: 'Map' }), el('th', { className: 'num', textContent: 'Bestanden' }), el('th', { className: 'num', textContent: 'Grootte' })),
    ...rows.map(([dir, d]) => el('tr', {}, el('td', { textContent: dir }), el('td', { className: 'num', textContent: String(d.n) }), el('td', { className: 'num', textContent: mb(d.bytes) }))));
  const sample = list.slice().sort().slice(0, 400).map((p) => `${String(files.size(p)).padStart(10)}  ${p}`).join('\n');
  const probe = list.find((p) => /^_data\/bricks\.bob$/i.test(p));
  const info = el('div', { className: 'note', id: 'le2-info' });
  if (probe) {
    files.read(probe.toUpperCase()).then((b) => { // case-insensitive on purpose
      info.textContent = `Controle: ${probe} gelezen (${b.length} bytes, begint met ${[...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join(' ')}).`;
    }).catch((e) => { info.textContent = `Controle mislukt: ${e instanceof Error ? e.message : e}`; });
  }
  app.appendChild(el('div', { className: 'le2-files' },
    el('h1', { textContent: GAME_TITLE }),
    el('div', { className: 'note', id: 'le2-summary', textContent: `${list.length} spelbestanden (${mb(files.totalSize())}), bron: ${SOURCE_NAMES[files.source]}. Het spel zelf volgt; dit is de plaatsvervangende pagina.` }),
    info,
    el('div', { className: 'books' },
      ...Object.values(MOVIES).map((m) => el('button', { textContent: `Film: ${m.file}`, onclick: async () => { await runMovie(files, m.file); showFiles(files); } })),
      el('button', { textContent: 'Rondlopen op het eiland (test)', onclick: () => startGame(files, 'z02LGI') }),
      el('button', { textContent: "Rondlopen in Pepper's huis (test)", onclick: () => startGame(files, 'z03PPH') }),
      el('button', { textContent: 'Eiland in 3D bekijken', onclick: () => import('./viewer/index.ts').then((m) => m.startViewer(app, files)) }),
      el('button', { textContent: 'Terug naar begin', onclick: () => startScreen() })),
    table,
    el('details', { className: 'note' }, el('summary', { textContent: 'Bestandslijst (eerste 400)' }), el('pre', { textContent: sample })),
  ));
}

async function boot() {
  // ?viewer=1[&zone=z02LGI] opens the asset/zone viewer (src/viewer), independent of the game flow below.
  if (new URLSearchParams(location.search).has('viewer')) {
    const params = new URLSearchParams(location.search);
    if (params.has('data')) return import('./viewer/index.ts').then((m) => m.startViewer(app));
    const lib = await availableSource();
    const files = await lib.open((d, t, l) => { document.title = `${l ?? ''} ${Math.round((100 * d) / t)}%`; });
    return import('./viewer/index.ts').then((m) => m.startViewer(app, files));
  }
  // ?play=1&zone=z02LGI|z03PPH: the M1 dev entry (src/game/play.ts): straight into a walkable zone, no shell. ?play=1 alone, ?start=frontend, ?zone= (without play),
  // ?save= start the real flow (movies, front end, story), see play(). ?source=archive uses archive.org even when dev files are present.
  const params = new URLSearchParams(location.search);
  if (params.has('play') || params.has('start') || params.has('zone') || params.has('save')) {
    addEventListener('pointerdown', () => audio.unlock(), { once: true });
    const lib = await availableSource();
    const files = await lib.open((d, t, l) => { document.title = `${l ?? ''} ${Math.round((100 * d) / t)}%`; });
    if (params.has('play') && params.has('zone')) return startGame(files, params.get('zone')!);
    return play(files, params);
  }
  return startScreen();
}

boot().catch(showError);

