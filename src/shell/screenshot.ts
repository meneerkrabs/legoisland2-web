// F10 = screenshot (FUN_004376f9 -> FUN_0040cd27 sets DAT_00986e28; after the frame is flipped FUN_0041278c -> FUN_00412f2f writes `<PHOTOS>\Lego0000.bmp`, the first free name of
// Lego0000 .. Lego9999, PHOTOS = the text `PHOTOS` of STD.str: "Fotos"). The file is a 24 bit bottom-up BMP: 14 byte file header (size = padded rows * height + 0x36, pixel data at
// 0x36), 40 byte info header (planes 1, 24 bit, no compression, 2000 x 2000 pixels per metre), rows padded to 4 bytes, B G R.
// A browser cannot see the Fotos folder: the picture is offered as a download with the next name of a counter kept in localStorage (the original takes the first name that is free).
// Deviation (browser download policy): the original takes one picture per input poll for as long as F10 is held; here one per key press.

/** `Lego0000.bmp` .. `Lego9999.bmp` */
export const photoName = (n: number) => `Lego${String(n).padStart(4, '0')}.bmp`;

/** FUN_00412f2f: the BMP of RGBA pixels (top-down rows) */
export function encodeBmp24(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const row = w * 3, pad = (row & 3) !== 0 ? row + 1 + ((row & 3) ^ 3) : row;   // the original's padding expression
  const size = pad * h + 0x36;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true); dv.setUint32(10, 0x36, true);
  dv.setUint32(14, 0x28, true); dv.setUint32(18, w, true); dv.setUint32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 0x18, true);
  dv.setUint32(30, 0, true); dv.setUint32(34, 0, true); dv.setUint32(38, 2000, true); dv.setUint32(42, 2000, true); dv.setUint32(46, 0, true); dv.setUint32(50, 0, true);
  for (let y = 0; y < h; y++) {
    let o = 0x36 + (h - 1 - y) * pad, i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) { out[o++] = rgba[i + 2]; out[o++] = rgba[i + 1]; out[o++] = rgba[i]; }
  }
  return out;
}

const COUNTER_KEY = 'le2-photo-index';
function nextIndex(): number {
  try { const v = Number(globalThis.localStorage?.getItem(COUNTER_KEY) ?? 0); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; } catch { return 0; }
}
function storeIndex(n: number) { try { globalThis.localStorage?.setItem(COUNTER_KEY, String(n)); } catch { /* private mode: the numbering restarts with the session */ } }

/** take the picture of the canvas as it is now and hand it to the browser as a download; returns the file name (null: 10000 pictures already, the original gives up as well) */
export function savePhoto(canvas: HTMLCanvasElement, download: (name: string, bytes: Uint8Array) => void = browserDownload): string | null {
  const n = nextIndex();
  if (n > 9999) return null;
  const w = canvas.width, h = canvas.height;
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  const g = c2.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(canvas, 0, 0);
  const bytes = encodeBmp24(g.getImageData(0, 0, w, h).data, w, h);
  const name = photoName(n);
  storeIndex(n + 1);
  download(name, bytes);
  return name;
}

function browserDownload(name: string, bytes: Uint8Array) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/bmp' }));
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** F10 (InputMapper.onScreenshot): the picture is taken after the frame of this tick has been drawn (the tick runs inside the animation frame callback, a microtask runs after it) */
export function installScreenshot(input: { onScreenshot: (() => void) | null }, canvas: HTMLCanvasElement, download?: (name: string, bytes: Uint8Array) => void) {
  input.onScreenshot = () => { queueMicrotask(() => { try { savePhoto(canvas, download); } catch (e) { console.warn('screenshot', e); } }); };
}
