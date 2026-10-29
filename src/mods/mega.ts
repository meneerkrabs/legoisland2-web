// Public MEGA file links (`https://mega.nz/#!<id>!<key>` and `https://mega.nz/file/<id>#<key>`) downloaded straight from the browser: MEGA's API and storage hosts send
// CORS headers, so no relay is needed. Written from MEGA's public protocol description (the "g" command, AES-128-CTR content, AES-128-CBC attributes).
//   key (32 bytes, base64url in the link): AES key = k[0..16] xor k[16..32]; CTR counter block = k[16..24] + 8 counter bytes; k[24..32] = the file's MAC.
//   POST https://g.api.mega.co.nz/cs   [{"a":"g","g":1,"ssl":2,"p":<id>}]  ->  [{ s: size, at: <attributes, AES-CBC, zero IV>, g: <download url> }]  or  [<negative error code>]
//   GET <download url>/<first>-<last>  returns that (inclusive) byte range of the encrypted content.
// The content is delivered as a stream of decrypted blocks (nothing is held in memory but the few blocks that are in flight). MEGA's own MAC of the file is not
// verified here; the callers check their own CRCs (RAR / zip members carry one per file).

export class MegaError extends Error {
  code: number;
  constructor(message: string, code = 0) { super(message); this.code = code; }
}

export interface MegaFile {
  id: string;
  name: string;
  size: number;
  /** the temporary download address */
  url: string;
  aesKey: Uint8Array;
  /** the 8 bytes the counter block starts with */
  nonce: Uint8Array;
}

const API = 'https://g.api.mega.co.nz/cs';
const MEGA_ERRORS: Record<number, string> = {
  [-2]: 'ongeldige MEGA-link', [-3]: 'MEGA is even overbelast, probeer het later opnieuw', [-4]: 'MEGA wil nu niet meer verzoeken van je, probeer het later opnieuw',
  [-9]: 'het bestand bestaat niet meer bij MEGA', [-11]: 'geen toegang tot het bestand bij MEGA', [-14]: 'ongeldige sleutel in de MEGA-link', [-16]: 'het bestand is door MEGA geblokkeerd of verwijderd (niet meer beschikbaar bij de bron)',
  [-17]: 'de downloadlimiet van MEGA is bereikt, probeer het later opnieuw', [-18]: 'het bestand is tijdelijk niet beschikbaar bij MEGA',
};
const megaMessage = (code: number) => MEGA_ERRORS[code] ?? `MEGA gaf foutcode ${code}`;

export function b64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** the file id and the 32-byte key out of a link (old `#!id!key` and new `/file/id#key` style) */
export function parseMegaLink(link: string): { id: string; key: Uint8Array } {
  const m = link.match(/#!([A-Za-z0-9_-]{8})!([A-Za-z0-9_-]+)/) ?? link.match(/\/file\/([A-Za-z0-9_-]{8})#([A-Za-z0-9_-]+)/);
  if (!m) throw new MegaError('Dit is geen geldige MEGA-bestandslink.');
  const key = b64url(m[2]);
  if (key.length !== 32) throw new MegaError('De sleutel in de MEGA-link is niet 32 bytes lang (geen bestandslink?).');
  return { id: m[1], key };
}

type FetchFn = typeof fetch;
const subtle = () => {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new MegaError('Deze browser heeft geen WebCrypto (alleen beschikbaar op https of localhost), dus MEGA-downloads werken hier niet.');
  return s;
};

/** AES-128-CBC with a zero IV and no padding (WebCrypto insists on PKCS#7, so a padding block that validates is appended) */
async function cbcDecryptNoPad(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  const lastBlock = data.subarray(data.length - 16);
  const pad = new Uint8Array(await s.encrypt({ name: 'AES-CBC', iv: lastBlock as BufferSource }, key, new Uint8Array(0)));
  const joined = new Uint8Array(data.length + pad.length);
  joined.set(data); joined.set(pad, data.length);
  return new Uint8Array(await s.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, joined));
}

/** name, size and a download address of a public file link */
export async function megaOpen(link: string, fetchFn: FetchFn = fetch): Promise<MegaFile> {
  const { id, key } = parseMegaLink(link);
  const aesKey = new Uint8Array(16);
  for (let i = 0; i < 16; i++) aesKey[i] = key[i] ^ key[i + 16];
  let res: unknown;
  try {
    const r = await fetchFn(`${API}?id=${Math.floor(Math.random() * 1e9)}`, { method: 'POST', body: JSON.stringify([{ a: 'g', g: 1, ssl: 2, p: id }]) });
    if (!r.ok) throw new MegaError(`MEGA gaf HTTP ${r.status}.`);
    res = await r.json();
  } catch (e) {
    if (e instanceof MegaError) throw e;
    throw new MegaError('MEGA is niet bereikbaar (geen internet, of de verbinding wordt geblokkeerd).');
  }
  const first = Array.isArray(res) ? res[0] : res;
  if (typeof first === 'number') throw new MegaError(`${megaMessage(first)}.`, first);
  const info = first as { s?: number; at?: string; g?: string };
  if (!info || typeof info.s !== 'number' || !info.at || !info.g) throw new MegaError('Onverwacht antwoord van MEGA.');
  const k = await subtle().importKey('raw', aesKey as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  let name = id;
  try {
    const at = b64url(info.at);
    const plain = new TextDecoder('latin1').decode(await cbcDecryptNoPad(k, at.subarray(0, at.length - (at.length % 16))));
    if (!plain.startsWith('MEGA{')) throw new Error('bad attributes');
    name = (JSON.parse(plain.slice(4, plain.lastIndexOf('}') + 1)) as { n?: string }).n ?? id;
    name = new TextDecoder().decode(Uint8Array.from(name, (c) => c.charCodeAt(0) & 255)) || name;   // MEGA writes UTF-8; latin1 decoding turned it into bytes
  } catch {
    throw new MegaError('De sleutel in de MEGA-link klopt niet (het bestand is niet te ontsleutelen).');
  }
  return { id, name, size: info.s, url: info.g, aesKey, nonce: key.slice(16, 24) };
}

export interface MegaStreamOptions {
  /** first byte (default 0) */
  start?: number;
  /** end (exclusive; default the file size) */
  end?: number;
  signal?: AbortSignal;
  fetchFn?: FetchFn;
  /** bytes per request, a multiple of 16 (default 4 MB) */
  block?: number;
  /** requests in flight at once (default 3) */
  parallel?: number;
  onBytes?: (n: number) => void;
}

/** the decrypted bytes [start, end) of a MEGA file as a stream. `start` must be a multiple of 16. Network errors are retried a few times per block. */
export function megaStream(f: MegaFile, o: MegaStreamOptions = {}): ReadableStream<Uint8Array> {
  const fetchFn = o.fetchFn ?? fetch;
  const block = Math.max(16, (o.block ?? 4 << 20) & ~15), parallel = Math.max(1, o.parallel ?? 3);
  const start = o.start ?? 0, end = Math.min(o.end ?? f.size, f.size);
  if (start % 16) throw new MegaError('Intern: de beginpositie moet een veelvoud van 16 zijn.');
  let cryptoKey: Promise<CryptoKey> | null = null;
  const key = () => (cryptoKey ??= subtle().importKey('raw', f.aesKey as BufferSource, 'AES-CTR', false, ['decrypt']));
  const counterAt = (offset: number) => {
    const c = new Uint8Array(16);
    c.set(f.nonce, 0);
    const blocks = offset / 16;
    new DataView(c.buffer).setUint32(8, Math.floor(blocks / 2 ** 32), false);
    new DataView(c.buffer).setUint32(12, blocks % 2 ** 32, false);
    return c;
  };
  const fetchBlock = async (from: number, to: number): Promise<Uint8Array> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (o.signal?.aborted) throw new MegaError('Afgebroken.');
      try {
        const r = await fetchFn(`${f.url}/${from}-${to - 1}`, { signal: o.signal });
        if (r.status === 509 || r.status === 429) throw new MegaError('De downloadlimiet van MEGA is bereikt, probeer het later opnieuw.', -17);
        if (r.status === 403 || r.status === 404 || r.status === 410) throw new MegaError('De downloadlink van MEGA is verlopen of het bestand is weg.', -9);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length !== to - from) throw new Error(`kreeg ${buf.length} van ${to - from} bytes`);
        return buf;
      } catch (e) {
        if (e instanceof MegaError || o.signal?.aborted) throw e;
        lastErr = e;
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
      }
    }
    throw new MegaError(`Downloaden van MEGA mislukt (${lastErr instanceof Error ? lastErr.message : lastErr}).`);
  };
  const decrypt = async (enc: Uint8Array, offset: number) => new Uint8Array(await subtle().decrypt({ name: 'AES-CTR', counter: counterAt(offset) as BufferSource, length: 64 }, await key(), enc as BufferSource));

  const pending: { at: number; p: Promise<Uint8Array> }[] = [];
  let next = start;
  const fill = () => {
    while (pending.length < parallel && next < end) {
      const from = next, to = Math.min(end, next + block);
      const p = fetchBlock(from, to);
      p.catch(() => { /* reported when it is awaited */ });
      pending.push({ at: from, p });
      next = to;
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      fill();
      const head = pending.shift();
      if (!head) { ctl.close(); return; }
      try {
        const enc = await head.p;
        const plain = await decrypt(enc, head.at);
        o.onBytes?.(plain.length);
        ctl.enqueue(plain);
        fill();
      } catch (e) { ctl.error(e); }
    },
    cancel() { pending.length = 0; next = end; },
  }, { highWaterMark: 0 });
}
