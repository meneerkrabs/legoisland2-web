// What the audio engine needs from the game files, and the path rules of the original (backslashes, doubled separators, case).
export interface AudioFiles {
  /** Whole file; throws when missing. Paths in installed layout, any case, '/' or '\' (GameFiles from src/files.ts fits). */
  read(path: string): Promise<Uint8Array>;
  has?(path: string): boolean;
}

/** "_Data\\sounds\\\\z02LGI\\Silence.wav" -> "_Data/sounds/z02LGI/Silence.wav" (the table has double separators in many paths). */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.?\//, '');
}

/** Read a file trying the spellings the data needs: as given, with ".wav" appended, spaces -> underscores in folder names. */
export async function readTolerant(files: AudioFiles, path: string): Promise<Uint8Array | null> {
  const p = normalizePath(path);
  const cands = [p];
  if (!/\.[a-z0-9]{2,4}$/i.test(p)) cands.push(p + '.wav');
  const parts = p.split('/');
  if (parts.length > 2) cands.push([parts[0], ...parts.slice(1, -1).map((x) => x.replace(/ /g, '_')), parts[parts.length - 1]].join('/'));
  for (const c of cands) {
    try {
      if (files.has && !files.has(c)) continue;
      return await files.read(c);
    } catch { /* try the next spelling */ }
  }
  return null;
}
