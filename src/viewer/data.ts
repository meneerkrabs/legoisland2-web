// Loading of game data in the browser for the viewer: archives over HTTP, the executable, zone scenes.
import { Archive } from '../formats/archive.ts';
import { Pe, extractZone } from '../formats/exe.ts';
import type { ZoneScene } from '../formats/exe.ts';

export const ZONES = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC', 'z60FRE'];
export const OTHER_ARCHIVES = ['Bricks', 'BrickMorph', 'GENERICBITS', 'Shadow', 'SwapText', 'menu', 'Overlays', 'Fonts', 'messages'];

export interface Status { (msg: string): void }

/** Something that reads installed-layout paths (`GameFiles` of src/files.ts). */
export interface FileSource { read(path: string): Promise<Uint8Array> }

export class GameData {
  readonly base: string;
  private files: FileSource | null = null;
  private archives = new Map<string, Promise<Archive>>();
  private pe: Promise<Pe> | null = null;
  private starts: number[] | null = null;
  /** `source`: a URL prefix of a plain game folder (dev), or the game's files from the library (archive.org / own ISO). */
  constructor(source: string | FileSource) {
    if (typeof source === 'string') this.base = source.endsWith('/') ? source : source + '/';
    else { this.base = ''; this.files = source; }
  }

  private async fetchBytes(url: string, status?: Status, label = ''): Promise<Uint8Array> {
    if (this.files) { status?.(`${label}`); return this.files.read(decodeURIComponent(url)); }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const total = +(res.headers.get('content-length') ?? 0);
    if (!res.body || !total || !status) return new Uint8Array(await res.arrayBuffer());
    const out = new Uint8Array(total);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, got); got += value.length;
      status(`${label} ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`);
    }
    return out;
  }

  archive(name: string, status?: Status): Promise<Archive> {
    let p = this.archives.get(name.toLowerCase());
    if (!p) {
      p = (async () => {
        const bod = await this.fetchBytes(`${this.base}_data/${name}.bod`);
        const bob = await this.fetchBytes(`${this.base}_data/${name}.bob`, status, `loading ${name}.bob`);
        return new Archive(name, bod, bob);
      })();
      this.archives.set(name.toLowerCase(), p);
    }
    return p;
  }

  exe(): Promise<Pe> {
    return (this.pe ??= this.fetchBytes(`${this.base}${encodeURIComponent('LEGO eiland 2.exe')}`).then((b) => new Pe(b)));
  }

  async zoneScene(zone: string): Promise<ZoneScene> {
    const pe = await this.exe();
    this.starts ??= pe.functionStarts();
    return extractZone(pe, zone, undefined, this.starts);
  }
}
