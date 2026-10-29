// The LI2 Mod Manager's mod package format (https://github.com/JeffRuLz/LI2-Mod-Manager, wiki "Creating Mods"), written from its description, not from its code:
//   <mod folder>/info.txt    optional: line 1 title, line 2 author, the rest the description
//   <mod folder>/patch.txt   optional: one hex edit of the executable per line, `offset;new bytes[;original bytes]` (hex, file offsets)
//   <mod folder>/_data/...   optional: file replacement; whatever is below `_data` mirrors into the game's `_data` folder
//   <mod folder>/installed   an empty marker file the manager itself leaves behind (ignored)
// A zip holds one mod folder, several of them (the bi-plane fuel fix ships a fullscreen and a windowed variant) or the mod's files at its root.
// `planMods` only looks at names and sizes (a pack can be gigabytes: nothing is read yet); `describeMod` turns the two small text files into the mod's description.

export interface PatchLine {
  /** file offset in the executable */
  offset: number;
  bytes: Uint8Array;
  /** the bytes that must be there for the patch to apply (the line's optional third field) */
  original?: Uint8Array;
  /** 1-based line number in patch.txt */
  line: number;
}

export interface PlanEntry { path: string; size: number }
export interface ModPlan {
  /** the folder inside the zip ('' = the zip's root) */
  folder: string;
  /** the entry paths (as given) of info.txt / patch.txt */
  info: string | null;
  patch: string | null;
  /** file replacements: `src` = the entry path, `path` = where it goes (`_data/...`, '/' separators, the case the mod gave) */
  files: { src: string; path: string; size: number }[];
  /** things that were left out (shown to the user) */
  warnings: string[];
}
export interface ModInfo { title: string; author: string; description: string }

const hex = (s: string) => /^[0-9a-f]+$/i.test(s);
function hexBytes(s: string): Uint8Array | null {
  if (!hex(s) || s.length % 2) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** patch.txt: `offset;new[;original]` per line, all hex; blank lines are skipped, lines that cannot be read are reported and left out */
export function parsePatchText(text: string): { patches: PatchLine[]; errors: string[] } {
  const patches: PatchLine[] = [], errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const f = line.split(';').map((x) => x.trim());
    if (f.length < 2 || f.length > 3) { errors.push(`patch.txt regel ${i + 1}: verwacht "adres;nieuwe bytes[;oorspronkelijke bytes]"`); return; }
    const off = hex(f[0]) && f[0].length <= 8 ? parseInt(f[0], 16) : -1;
    const bytes = hexBytes(f[1]);
    const original = f.length === 3 && f[2] !== '' ? hexBytes(f[2]) : undefined;
    if (off < 0 || !bytes || !bytes.length) { errors.push(`patch.txt regel ${i + 1}: geen geldig adres of geen geldige bytes`); return; }
    if (f.length === 3 && f[2] !== '' && (!original || original.length !== bytes.length)) { errors.push(`patch.txt regel ${i + 1}: de oorspronkelijke bytes zijn ongeldig of niet even lang als de nieuwe`); return; }
    patches.push({ offset: off, bytes, original: original ?? undefined, line: i + 1 });
  });
  return { patches, errors };
}

/** info.txt: title, author, description (a missing file gives the folder name as the title) */
export function parseInfo(text: string | null, fallbackTitle: string): ModInfo {
  if (text === null) return { title: fallbackTitle, author: '', description: '' };
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  return { title: lines[0]?.trim() || fallbackTitle, author: lines[1]?.trim() ?? '', description: lines.slice(2).join('\n').trim() };
}

const JUNK = /(^|\/)(__macosx|\.ds_store|thumbs\.db|desktop\.ini)(\/|$)/i;
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
const lower = (s: string) => s.toLowerCase();

/**
 * Split the files of a zip or a picked folder into mod packages. A folder is a mod when it directly holds `info.txt`, `patch.txt` or a `_data` folder; the
 * outermost such folders win. Nothing found: null (the caller says the file is not a mod).
 */
export function planMods(entries: PlanEntry[]): ModPlan[] | null {
  const files = entries.map((e) => ({ ...e, norm: normPath(e.path) })).filter((e) => e.norm && !e.norm.endsWith('/') && !JUNK.test(e.norm));
  const dirs = new Set<string>(['']);
  for (const f of files) {
    const parts = f.norm.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const relOf = (f: { norm: string }, dir: string) => (dir ? (f.norm.startsWith(dir + '/') ? f.norm.slice(dir.length + 1) : null) : f.norm);
  const isMod = (dir: string) => files.some((f) => {
    const rel = relOf(f, dir);
    if (rel === null) return false;
    const l = lower(rel);
    return l === 'info.txt' || l === 'patch.txt' || l.startsWith('_data/');
  });
  const roots: string[] = [];
  for (const d of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    if (roots.some((r) => r === '' || d === r || d.startsWith(r + '/'))) continue;
    if (isMod(d)) roots.push(d);
  }
  if (!roots.length) return null;
  return roots.map((root) => {
    const plan: ModPlan = { folder: root, info: null, patch: null, files: [], warnings: [] };
    const ignored: string[] = [];
    for (const f of files) {
      const rel = relOf(f, root);
      if (rel === null) continue;
      const l = lower(rel);
      if (l === 'info.txt') { plan.info = f.path; continue; }
      if (l === 'patch.txt') { plan.patch = f.path; continue; }
      if (l === 'installed') continue;
      if (!l.startsWith('_data/')) { ignored.push(rel); continue; }
      const segs = rel.split('/');
      if (segs.some((s) => s === '..' || s === '.' || s === '')) { plan.warnings.push(`${rel}: ongeldig pad, overgeslagen`); continue; }
      plan.files.push({ src: f.path, path: ['_data', ...segs.slice(1)].join('/'), size: f.size });
    }
    if (ignored.length) plan.warnings.push(`${ignored.length} bestand${ignored.length === 1 ? '' : 'en'} buiten _data genegeerd (${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? ', ...' : ''})`);
    return plan;
  });
}

/** the mod's title / author / description and patch lines from the contents of its two text files (`null` = the file is not there) */
export function describeMod(plan: ModPlan, infoText: string | null, patchText: string | null): ModInfo & { patches: PatchLine[]; warnings: string[] } {
  const fallback = plan.folder ? plan.folder.split('/').pop()! : 'Mod';
  const info = parseInfo(infoText, fallback);
  const warnings = [...plan.warnings];
  let patches: PatchLine[] = [];
  if (patchText !== null) { const r = parsePatchText(patchText); patches = r.patches; warnings.push(...r.errors); }
  return { ...info, patches, warnings };
}
