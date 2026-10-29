// Ontwikkelaarshoek, sections 8 and 9: loads what the text analysis needs from a running shell (messages archive, the cutscene archives, the three zone archives with English
// leftovers) and runs `analyseTexts` (text-data.ts). The result is shared by both sections through `corner.store`. Reading the nine cutscene archives (about 200 MB, kept in
// the game's archive cache) takes a moment: `progress` says where it is; until it is done the section shows the line instead of flags.
import type { DevCorner } from './corner.ts';
import { ZONES } from '../viewer/data.ts';
import { analyseTexts, CUTSCENE_ARCHIVES, cutsOf, exeTagSets, exeTextIndex, parseAllStr, parseEnglish, saytextIds } from './text-data.ts';
import type { StrEntry, StrFile, TextAnalysis } from './text-data.ts';

export interface TextBundle {
  entries: StrEntry[];
  files: StrFile[];
  english: StrEntry[];
  analysis: TextAnalysis;
  /** compiled cutscenes read / SayText ids found */
  cuts: number;
  saytext: number;
}

export interface TextLoad {
  /** where the loading is (for the UI line) */
  progress: string;
  done: boolean;
  error: string;
  promise: Promise<TextBundle>;
  listeners: (() => void)[];
  bundle: TextBundle | null;
}

export const ENGLISH_ARCHIVES = ['z27TRX', 'z38PAR', 'z40aPO'] as const;

export function textLoadOf(c: DevCorner): TextLoad {
  return c.store('text-load', () => {
    const t: TextLoad = { progress: 'Berichten lezen...', done: false, error: '', listeners: [], bundle: null, promise: null as unknown as Promise<TextBundle> };
    const say = (m: string) => { t.progress = m; for (const f of t.listeners) { try { f(); } catch { /* a listener must not stop the load */ } } };
    t.promise = (async () => {
      const sh = c.sh;
      const msgs = await sh.data.archive('messages');
      const { entries, files } = parseAllStr(msgs);
      const ex = exeTextIndex(sh.pe);
      const sets = exeTagSets(ex);
      const mp3 = new Set(sh.files.list().filter((p) => /^_data\/sounds\/speech\/data\/[^/]+\.mp3$/i.test(p)).map((p) => /([^/]+)\.mp3$/i.exec(p)![1].toLowerCase()));
      const saytext = new Set<string>(), cutNames = new Set<string>();
      let cuts = 0, i = 0;
      for (const n of CUTSCENE_ARCHIVES) {
        say(`Cutscenes lezen: ${n} (${++i}/${CUTSCENE_ARCHIVES.length})...`);
        const cs = cutsOf(await sh.data.archive(n));
        cuts += cs.length;
        for (const k of cs) cutNames.add(k.name.toLowerCase());
        for (const s of saytextIds(cs.map((k) => k.data))) saytext.add(s);
      }
      const english: StrEntry[] = [];
      for (const n of ENGLISH_ARCHIVES) {
        say(`Engelse teksten zoeken: ${n}...`);
        english.push(...parseEnglish(n, await sh.data.archive(n)));
      }
      const analysis = analyseTexts([...entries, ...english], {
        exe: sets.literal, pooled: sets.pooled, cutNames, saytext, speech: ex.speech, mp3, zoneCodes: ZONES.map((z) => z.slice(3).toUpperCase()), controlFormat: ex.strings.has('CONTROL%i'),
      });
      const b: TextBundle = { entries, files, english, analysis, cuts, saytext: saytext.size };
      t.bundle = b; t.done = true;
      say('klaar');
      return b;
    })().catch((e) => { t.error = e instanceof Error ? e.message : String(e); say(`fout: ${t.error}`); throw e; });
    t.promise.catch(() => { /* the error is in `t.error` */ });
    return t;
  });
}
