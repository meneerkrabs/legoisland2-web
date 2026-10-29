// Importing mods (a .zip, a picked / dropped folder or loose mod files) into the store, and loading the enabled ones for a game start.
// Everything is streamed: a zip is opened through its central directory only and each member is piped (decompressed) straight into the store, so a pack of
// several gigabytes needs a few megabytes of memory. Importing the same mod folder of the same source again replaces the old copy once the new one is complete.
import { describeMod, planMods } from './package.ts';
import type { ModInfo, ModPlan } from './package.ts';
import { isRarBytes, openRar } from './rar.ts';
import { entryStream, isZipBytes, listZip, readEntry, zipBlob } from './zip.ts';
import type { ZipSource } from './zip.ts';
import { loadPatches, storePatches } from './store.ts';
import type { InstalledMod, ModOrigin, ModStore } from './store.ts';
import type { ActiveMod } from './overlay.ts';

/** a picked / dropped file with the path it had inside a folder (or just its name) */
export interface PickedFile { path: string; file: Blob }

export interface ImportResult { added: InstalledMod[]; errors: string[] }
/** extras for imports that know more than the archive says (the catalogue) */
export interface ImportOptions {
  /** only the mod folders of the archive(s) for which this is true (the folder path inside the archive, '' = the root) */
  only?: (folder: string) => boolean;
  /** stored as the mod's source: importing the same source + folder again replaces the earlier copy (default: the file's name) */
  source?: string;
  /** where the mod came from (credits, shown in the list) */
  origin?: ModOrigin;
  /** the mod's title / author / description in place of the ones of its info.txt (`count` = how many mods the archive(s) gave) */
  describe?: (info: ModInfo, count: number) => ModInfo;
}
export interface ImportProgress { label: string; done: number; total: number; /** the catalogue downloads before it imports */ phase?: 'download' | 'import' }

/** one thing a plan reads from: a member of a zip or a picked file */
interface Item { size: number; stream(): Promise<ReadableStream<Uint8Array>>; text(): Promise<string> }

const decoder = new TextDecoder('utf-8');
const mbs = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const NO_ZIP_MOD = (name: string) => `${name}: geen mod gevonden (verwacht een map met info.txt, patch.txt of _data).`;

async function archiveKind(f: Blob, name: string): Promise<'zip' | 'rar' | null> {
  const head = new Uint8Array(await f.slice(0, 22).arrayBuffer());
  if (isRarBytes(head)) return 'rar';
  if (isZipBytes(head)) return 'zip';
  if (/\.zip$/i.test(name)) return 'zip';   // let the zip reader say what is wrong with it
  if (/\.rar$/i.test(name)) return 'rar';
  return null;
}
const oneChunk = (d: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { if (d.length) c.enqueue(d); c.close(); } });

function counted(s: ReadableStream<Uint8Array>, add: (n: number) => void): ReadableStream<Uint8Array> {
  return s.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(c, ctl) { add(c.length); ctl.enqueue(c); } }));
}

/**
 * Import everything picked: every `.zip` (by its first bytes, not only its name) is opened and searched for mod folders; all other files are taken together as one
 * folder (so a picked / dropped mod folder works, and so does a lone `patch.txt`).
 */
export async function importPicked(items: PickedFile[], store: ModStore, onProgress?: (p: ImportProgress) => void, signal?: AbortSignal, opts: ImportOptions = {}): Promise<ImportResult> {
  const res: ImportResult = { added: [], errors: [] };
  type Job = { plan: ModPlan; source: string; get(path: string): Item };
  const jobs: Job[] = [];
  const loose: PickedFile[] = [];
  for (const it of items) {
    const name = it.path.split('/').pop() ?? it.path;
    const kind = await archiveKind(it.file, name);
    if (!kind) { loose.push(it); continue; }
    try {
      type Member = { name: string; size: number; item: () => Item };
      let members: Member[];
      if (kind === 'zip') {
        const src: ZipSource = zipBlob(it.file);
        const entries = (await listZip(src)).filter((e) => !e.dir);
        members = entries.map((e) => ({ name: e.name, size: e.size, item: () => ({ size: e.size, stream: () => entryStream(src, e), text: async () => decoder.decode(await readEntry(src, e)) }) }));
      } else {
        const rar = await openRar(zipBlob(it.file), name);   // RAR: unpacked file by file (src/mods/rar.ts)
        members = rar.entries.filter((e) => !e.dir).map((e) => ({ name: e.name, size: e.size, item: () => ({ size: e.size, stream: async () => oneChunk(await rar.extract(e)), text: async () => decoder.decode(await rar.extract(e)) }) }));
      }
      const byName = new Map<string, Member>();
      for (const m of members) byName.set(m.name, m);
      const plans = planMods(members.map((m) => ({ path: m.name, size: m.size })));
      if (!plans) { res.errors.push(NO_ZIP_MOD(name)); continue; }
      for (const plan of plans) {
        if (opts.only && !opts.only(plan.folder)) continue;
        jobs.push({ plan, source: name, get: (path) => byName.get(path)!.item() });
      }
    } catch (e) { res.errors.push(`${name}: ${e instanceof Error ? e.message : e}`); }
  }
  if (loose.length) {
    const byPath = new Map(loose.map((l) => [l.path.replace(/\\/g, '/'), l.file]));
    const plans = planMods(loose.map((l) => ({ path: l.path.replace(/\\/g, '/'), size: l.file.size })));
    if (!plans) res.errors.push('Deze bestanden zijn geen mod: kies een .zip, of een map met _data (bestandsvervangers), patch.txt en/of info.txt. Een los bestand zonder map kan niet op zijn plaats in het spel worden gezet.');
    else {
      const source = loose.length === 1 ? loose[0].path : (loose[0].path.split('/')[0] || 'bestanden');
      for (const plan of plans) if (!opts.only || opts.only(plan.folder)) jobs.push({ plan, source, get: (path) => { const f = byPath.get(path)!; return { size: f.size, stream: async () => f.stream() as ReadableStream<Uint8Array>, text: () => f.text() }; } });
    }
  }

  const total = jobs.reduce((n, j) => n + j.plan.files.reduce((m, f) => m + f.size, 0), 0);
  // enough room in the browser's storage? (a private window or a throw-away profile has very little; a normal profile may use most of the free disk)
  if (store.persistent) {
    const est = await (globalThis as { navigator?: Navigator }).navigator?.storage?.estimate?.().catch(() => null);
    if (est?.quota && est.quota - (est.usage ?? 0) < total * 1.02) {
      res.errors.push(`Te weinig opslagruimte in deze browser: ${mbs(total)} nodig, ${mbs(est.quota - (est.usage ?? 0))} beschikbaar. Een privé- of tijdelijk venster heeft weinig ruimte; ruim ruimte op of gebruik een gewoon venster.`);
      return res;
    }
  }
  let done = 0, last = 0;
  const report = (label: string) => onProgress?.({ label, done, total });
  for (const job of jobs) {
    const { plan } = job;
    let writer: Awaited<ReturnType<ModStore['begin']>> | null = null;
    let label = plan.folder.split('/').pop() || job.source;
    try {
      const described = describeMod(plan, plan.info ? await job.get(plan.info).text() : null, plan.patch ? await job.get(plan.patch).text() : null);
      if (!plan.info && !plan.folder) described.title = job.source.replace(/\.[^.]*$/, '') || described.title;   // no info.txt and no folder: the file's name
      const info = { ...described, ...(opts.describe ? opts.describe({ title: described.title, author: described.author, description: described.description }, jobs.length) : {}) };
      label = info.title;
      if (!plan.files.length && !info.patches.length) { res.errors.push(`${info.title}: bevat geen bestanden onder _data en geen bruikbare patches.`); continue; }
      writer = await store.begin();
      for (const f of plan.files) {
        if (signal?.aborted) throw new Error('Afgebroken.');
        report(`${info.title}: ${f.path}`);
        const item = job.get(f.src);
        const what = `${info.title}: ${f.path}`;
        await writer.addFile(f.path, f.size, counted(await item.stream(), (n) => { done += n; if (done - last >= 1 << 20) { last = done; report(what); } }));
      }
      const m = await writer.commit({ title: info.title, author: info.author, description: info.description, source: opts.source ?? job.source, folder: plan.folder, patches: storePatches(info.patches), warnings: info.warnings, ...(opts.origin ? { origin: opts.origin } : {}) });
      writer = null;
      for (const old of await store.list()) if (old.id !== m.id && old.source === m.source && old.folder === m.folder) await store.remove(old.id);
      res.added.push(m);
    } catch (e) {
      if (writer) await writer.abort().catch(() => { /* ignore */ });
      const quota = e instanceof Error && (e.name === 'QuotaExceededError' || /quota/i.test(e.message));
      res.errors.push(`${label}: ${quota ? 'de opslagruimte van de browser is vol (al bewaarde mods verwijderen, of ruimte vrijmaken)' : e instanceof Error ? e.message : e}`);
    }
  }
  report('Klaar');
  return res;
}

/** the enabled mods in list order, as sources the override layer reads from on demand */
export async function loadActiveMods(store: ModStore): Promise<ActiveMod[]> {
  const out: ActiveMod[] = [];
  for (const m of await store.list()) {
    if (!m.enabled) continue;
    out.push({ id: m.id, title: m.title, files: m.files.map((f) => ({ path: f.path, size: f.size, read: () => store.readFile(m.id, f.key) })), patches: loadPatches(m.patches) });
  }
  return out;
}

/** `_data/<archive>/<member>` -> the archive a file goes into, `_data` for loose files (sounds ...) */
export function targetOf(path: string): string {
  const p = path.replace(/\\/g, '/').split('/');
  return p.length >= 3 ? p[1] : '_data';
}
