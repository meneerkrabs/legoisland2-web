// Ontwikkelaarshoek, section 10: loads what the lists need from the running shell (browser side): the executable's strings, the directories of every archive (names only, small .bod
// files), the nine archives with compiled cutscenes (shared with the text analysis through the game's archive cache) and the message tables. One computation per shell
// (`corner.store('scenes-data')`); `progress` says where it is.
import { Archive } from '../formats/archive.ts';
import { ZONES } from '../viewer/data.ts';
import type { DevCorner } from './corner.ts';
import { exeTextIndex, neverSaid } from './text-data.ts';
import type { AnalysedEntry } from './text-data.ts';
import { textLoadOf } from './text-load.ts';
import { CUTSCENE_ARCHIVES, cutRows, exeNames, fileRows, scriptCorpus, usedSplines } from './scenes-data.ts';
import type { CutRow, ExeNames, FileLists, StrFileRef } from './scenes-data.ts';

export interface SceneData {
  exe: ExeNames;
  /** directory-only archives (names and sizes; `read` is not usable): every zone archive */
  dirs: Archive[];
  /** the nine archives with compiled cutscenes, fully loaded (game cache) */
  cutArchives: Map<string, Archive>;
  rows: CutRow[];
  files: FileLists;
  /** the message files (messages archive) with their tags */
  strFiles: StrFileRef[];
  /** every line of the messages archive with its analysis flags (voice clip, never shown / never said), by file path (lower case) */
  strLines: Map<string, AnalysedEntry[]>;
  /** the computed "recorded but never said" lines (text analysis); empty when that analysis failed */
  unsaid: AnalysedEntry[];
  /** script name (lower case) -> number of never-said lines of its table */
  unsaidBy: Map<string, number>;
  /** why `unsaid` is empty, '' otherwise */
  unsaidError: string;
}

export interface SceneLoad {
  progress: string;
  done: boolean;
  error: string;
  data: SceneData | null;
  promise: Promise<SceneData>;
  listeners: (() => void)[];
}

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

export function sceneLoadOf(c: DevCorner): SceneLoad {
  return c.store('scenes-data', () => {
    const t: SceneLoad = { progress: 'EXE-teksten lezen ...', done: false, error: '', data: null, listeners: [], promise: null as unknown as Promise<SceneData> };
    const say = (m: string) => { t.progress = m; for (const f of t.listeners) { try { f(); } catch { /* a listener must not stop the load */ } } };
    t.promise = (async () => {
      const sh = c.sh;
      const exe = exeNames(exeTextIndex(sh.pe).strings.keys());
      await pause();
      say('mappenlijsten van de archieven lezen ...');
      const dirs: Archive[] = [];
      for (const n of ZONES) {
        try { dirs.push(new Archive(n, await sh.files.read(`_data/${n}.bod`), new Uint8Array(0))); } catch (e) { console.warn('scenes: no directory of', n, e); }
      }
      await pause();
      const cutArchives = new Map<string, Archive>();
      let i = 0;
      for (const n of CUTSCENE_ARCHIVES) {
        say(`archief met cutscenes laden: ${n} (${++i}/${CUTSCENE_ARCHIVES.length}) ...`);
        cutArchives.set(n, await sh.data.archive(n));
        await pause();
      }
      say('scripts en paden doorlopen ...');
      const cuts = [...cutArchives.values()];
      const rows = cutRows(cuts, exe);
      const corpora = new Map<string, string>();
      for (const a of cuts) corpora.set(a.name, scriptCorpus(a, exe));
      const files = fileRows(dirs, exe, corpora, usedSplines(cuts, exe));
      await pause();
      say('berichtbestanden lezen ...');
      let unsaid: AnalysedEntry[] = [], unsaidError = '';
      const strFiles: StrFileRef[] = [], strLines = new Map<string, AnalysedEntry[]>();
      try {
        const b = await textLoadOf(c).promise;
        for (const e of b.analysis.entries) {
          if (e.english) continue;
          const k = e.file.toLowerCase();
          let l = strLines.get(k);
          if (!l) { l = []; strLines.set(k, l); strFiles.push({ path: e.file, area: e.area, stem: e.name, tags: new Set() }); }
          l.push(e);
          strFiles[strFiles.length - 1].tags.add(e.tag);   // lines of a file are contiguous
        }
        unsaid = neverSaid(b.analysis);
      } catch (e) { unsaidError = e instanceof Error ? e.message : String(e); }
      const unsaidBy = new Map<string, number>();
      for (const e of unsaid) unsaidBy.set(e.name.toLowerCase(), (unsaidBy.get(e.name.toLowerCase()) ?? 0) + 1);
      const d: SceneData = { exe, dirs, cutArchives, rows, files, strFiles, strLines, unsaid, unsaidBy, unsaidError };
      t.data = d; t.done = true;
      say('klaar');
      return d;
    })().catch((e) => { t.error = e instanceof Error ? e.message : String(e); say(`fout: ${t.error}`); throw e; });
    t.promise.catch(() => { /* in `t.error` */ });
    return t;
  });
}
