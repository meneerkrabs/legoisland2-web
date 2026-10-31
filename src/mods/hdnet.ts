// Shared by the main thread (hdremote.ts) and the fetch worker (hdworker.ts / hdfill.ts): plain HTTP range reads of the HD pack's zip, with Dutch error messages. No DOM, no imports
// of the rest of the mod code (the worker bundle stays small).

export class HdRemoteError extends Error { quota = false; aborted = false; }
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isQuota = (e: unknown) => e instanceof Error && (e.name === 'QuotaExceededError' || /quota/i.test(e.message));

/** bytes [start, end) of `url`; `end < 0` = the last `-end` bytes. Retried twice on network trouble; 403 / 404 (the relay does not serve the item) fails at once. */
export async function rangeFetch(url: string, start: number, end: number, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw aborted();
    try {
      const res = await fetchFn(url, { headers: { Range: end < 0 ? `bytes=${end}` : `bytes=${start}-${end - 1}` }, signal });
      if (res.status === 206) return res;
      if (res.status === 200 && start === 0 && end > 0) return res;   // a server that ignores ranges (the whole file would come: not for this pack)
      if (res.status === 404 || res.status === 403) throw new HdRemoteError(`archive.org (de HD-textures) is niet bereikbaar via de tussenserver (fout ${res.status}).`);
      last = new HdRemoteError(`archive.org antwoordt met fout ${res.status}.`);
    } catch (e) {
      if (signal?.aborted) throw aborted();
      if (e instanceof HdRemoteError && /niet bereikbaar/.test(e.message)) throw e;
      last = e;
    }
    await sleep(500 * (attempt + 1));
  }
  throw last instanceof HdRemoteError ? last : new HdRemoteError(`Kon archive.org niet bereiken (${last instanceof Error ? last.message : last}).`);
}
export function aborted(): HdRemoteError { const e = new HdRemoteError('Afgebroken.'); e.aborted = true; return e; }

/** a whole range as bytes (checks the length) */
export async function readRange(url: string, start: number, end: number, signal?: AbortSignal, fetchFn?: typeof fetch): Promise<Uint8Array> {
  const r = await rangeFetch(url, start, end, signal, fetchFn);
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length !== end - start) throw new HdRemoteError(`archive.org gaf ${b.length} in plaats van ${end - start} bytes.`);
  return b;
}
