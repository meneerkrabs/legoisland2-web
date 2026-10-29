// Run-time loading of the galleries' data (browser side): reads the user's own game files, never anything stored in the repo. One computation shared by sections 6 and 7
// (`corner.store('gallery')`): the directories of all archives (the small .bod files only), the executable's strings, the zone loader tables (extractZone, ~3 s: done per zone with
// a pause between them so the page stays responsive) and the "never loaded / unlisted" lists of gallery-unused.ts.
import { Archive } from '../formats/archive.ts';
import { extractZone } from '../formats/exe.ts';
import type { DevCorner } from './corner.ts';
import { ExeStrings, OTHER_NAMES, ZONE_NAMES, computeModels, computeTextures, neverLoadedBrickModels, zoneTablesOf } from './gallery-unused.ts';
import type { Listing, ModelLists, TextureLists, ZoneTables } from './gallery-unused.ts';

export interface Gallery {
  blob: ExeStrings;
  tables: Record<string, ZoneTables>;
  /** member lists of all archives (directory only: their `read` is not usable) */
  listings: Archive[];
  models: ModelLists;
  textures: TextureLists;
  /** BrickMorph model files no executable string names (research: 5) */
  brickModels: string[];
}

interface State { promise: Promise<Gallery> | null; progress: ((s: string) => void)[]; text: string }

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

/** the shared gallery data (computed once per shell; `progress` gets status lines while it runs) */
export function loadGallery(c: DevCorner, progress?: (s: string) => void): Promise<Gallery> {
  const st = c.store<State>('gallery', () => ({ promise: null, progress: [], text: '' }));
  if (progress) { st.progress.push(progress); if (st.text) progress(st.text); }
  const say = (t: string) => { st.text = t; for (const p of st.progress) p(t); };
  return (st.promise ??= (async () => {
    const sh = c.sh;
    say('mappenlijsten van de archieven lezen ...');
    const listings: Archive[] = [];
    for (const n of [...ZONE_NAMES, ...OTHER_NAMES]) {
      try { listings.push(new Archive(n, await sh.files.read(`_data/${n}.bod`), new Uint8Array(0))); } catch (e) { console.warn('gallery: no directory of', n, e); }
      await pause();
    }
    say('tekenreeksen van het exe-bestand lezen ...');
    await pause();
    const blob = new ExeStrings(sh.pe.data);
    await pause();
    const starts = sh.pe.functionStarts();
    const tables: Record<string, ZoneTables> = {};
    let k = 0;
    for (const z of ZONE_NAMES) {
      say(`laadtabellen van de zones uit het exe-bestand halen: ${z} (${++k}/${ZONE_NAMES.length}) ...`);
      await pause();
      try { tables[z] = zoneTablesOf(extractZone(sh.pe, z, undefined, starts)); } catch (e) { console.warn('gallery: zone tables of', z, e); }
    }
    say('ongebruikte modellen en texturen berekenen ...');
    await pause();
    // per archive so the page can breathe in between (the substring matching of thousands of members)
    const models: ModelLists = { never: [], neverCol: [], unwired: [], colOnly: [], loaded: {} };
    const textures: TextureLists = { unlisted: [], leftovers: [], total: {} };
    for (const a of listings) {
      const m = computeModels(blob, tables, [a as Listing]);
      models.never.push(...m.never); models.neverCol.push(...m.neverCol); models.unwired.push(...m.unwired); models.colOnly.push(...m.colOnly); Object.assign(models.loaded, m.loaded);
      const t = computeTextures(blob, tables, [a as Listing]);
      textures.unlisted.push(...t.unlisted); textures.leftovers.push(...t.leftovers); Object.assign(textures.total, t.total);
      await pause();
    }
    const morph = listings.find((a) => a.name === 'BrickMorph');
    const brickModels = morph ? neverLoadedBrickModels(blob, morph) : [];
    say('');
    return { blob, tables, listings, models, textures, brickModels };
  })());
}
