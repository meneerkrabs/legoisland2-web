// Text files and `sscanf` as the particle loaders see them.
//
// `loadTextLines` is FUN_0087d248(path, 1) (the engine's text file reader): the file is split into lines by FUN_0087d22e (up to and including '\n', then every
// whitespace character is skipped, so blank and indented lines vanish), lines starting with `//` are dropped (second argument 1), a line that is empty
// after the copy (FUN_0087d624, which keeps the terminating '\n') is dropped, the kept lines are concatenated into one buffer and the line table points into
// that buffer; finally every line is cut at the first '\r' that follows its start (so a file with CRLF line ends gives clean strings, a file without any
// '\r' would give lines that run to the end of the buffer: kept exactly, `TextLines.line(i)` reads the C string at the line's start).
//
// `scanf` is the C runtime `sscanf` restricted to `%s`, `%f`, `%i`, literal characters and white space (the formats of the particle files).

const isSpace = (c: number) => c === 0x20 || (c >= 9 && c <= 13);

export class TextLines {
  /** the concatenated, NUL terminated buffer */
  readonly buf: Uint8Array;
  readonly starts: number[];
  constructor(buf: Uint8Array, starts: number[]) { this.buf = buf; this.starts = starts; }
  get count(): number { return this.starts.length; }
  /** the C string of line i (up to the first NUL) */
  line(i: number): string {
    let s = '';
    for (let p = this.starts[i]; this.buf[p] !== 0; p++) s += String.fromCharCode(this.buf[p]);
    return s;
  }
  /** all lines (strings) */
  get lines(): string[] { return this.starts.map((_, i) => this.line(i)); }
}

/** FUN_0087d1f3 + FUN_0087d1c3: advance past the end of the line, then past all white space */
function nextLine(b: Uint8Array, p: number): number {
  while (b[p] !== 0 && b[p] !== 0x0a) p++;
  if (b[p] !== 0) p++;
  while (b[p] !== 0 && isSpace(b[p])) p++;
  return p;
}

/** FUN_0087d248(path, skipComments): the lines of a text file */
export function loadTextLines(file: Uint8Array, skipComments = true): TextLines {
  const src = new Uint8Array(file.length + 1); src.set(file);                 // NUL terminated (the original reads size bytes and appends a NUL)
  const out: number[] = [];                                                  // the concatenation (each kept line with its terminator)
  let count = 0;
  for (let p = 0; src[p] !== 0; p = nextLine(src, p)) {
    if (skipComments && src[p] === 0x2f && src[p + 1] === 0x2f) continue;
    // FUN_0087d624(src, dst, 0x400): copy while i < 0x3fe and src[i] is neither NUL nor '\n', then copy the terminating char and a NUL
    const tmp: number[] = [];
    let i = 0;
    while (i < 0x400 - 2 && src[p + i] !== 0 && src[p + i] !== 0x0a) { tmp.push(src[p + i]); i++; }
    tmp.push(src[p + i]);
    // strlen(dst) != 0 : the first byte is not NUL (the terminator counts when it is '\n')
    const len = tmp[0] === 0 ? 0 : tmp.findIndex((c) => c === 0) < 0 ? tmp.length : tmp.findIndex((c) => c === 0);
    if (len !== 0) {
      // FUN_0085b580 (strcat): the string up to its NUL is appended
      for (let k = 0; k < len; k++) out.push(tmp[k]);
      count++;
    }
  }
  out.push(0);
  const buf = new Uint8Array(out);
  const starts: number[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) { starts.push(p); p = nextLine(buf, p); }
  // strchr(line, '\r') on the remainder of the buffer
  for (let i = 0; i < count; i++) {
    for (let q = starts[i]; buf[q] !== 0; q++) if (buf[q] === 0x0d) { buf[q] = 0; break; }
  }
  return new TextLines(buf, starts);
}

/** C `strnicmp(a, b, n) == 0` (case folding of ASCII letters, stops at a NUL in either string) */
export function strnicmpEq(a: string, b: string, n: number): boolean {
  for (let i = 0; i < n; i++) {
    let x = i < a.length ? a.charCodeAt(i) : 0, y = i < b.length ? b.charCodeAt(i) : 0;
    if (x >= 0x41 && x <= 0x5a) x += 0x20;
    if (y >= 0x41 && y <= 0x5a) y += 0x20;
    if (x !== y) return false;
    if (x === 0) return true;
  }
  return true;
}

/** the numeric prefix `strtod` accepts for `%f` (decimal digits only) */
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const INT_RE = /^[+-]?(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9]\d*)/;

/**
 * `sscanf(str, fmt, ...)`: returns the assigned values (strings for %s, numbers for %f / %i; %f values are float32 rounded as stored through a `float *`).
 * Stops at the first mismatch; the returned array's length is sscanf's return value (an immediate end of input before any conversion returns -1 in C:
 * `eof` is then true).
 */
export function scanf(str: string, fmt: string): { values: (string | number)[]; eof: boolean } {
  const out: (string | number)[] = [];
  let s = 0;
  const n = str.length;
  for (let f = 0; f < fmt.length; f++) {
    const c = fmt[f];
    if (c === ' ') { while (s < n && isSpace(str.charCodeAt(s))) s++; continue; }
    if (c === '%') {
      const t = fmt[++f];
      while (s < n && isSpace(str.charCodeAt(s))) s++;
      if (s >= n) return { values: out, eof: out.length === 0 };
      if (t === 's') {
        let e = s; while (e < n && !isSpace(str.charCodeAt(e))) e++;
        out.push(str.slice(s, e)); s = e;
      } else if (t === 'f') {
        const m = FLOAT_RE.exec(str.slice(s));
        if (!m) return { values: out, eof: false };
        out.push(Math.fround(parseFloat(m[0]))); s += m[0].length;
      } else if (t === 'i') {
        const m = INT_RE.exec(str.slice(s));
        if (!m) return { values: out, eof: false };
        out.push(parseInt(m[0], m[0].startsWith('0x') || m[0].startsWith('0X') ? 16 : m[0].length > 1 && m[0][0] === '0' ? 8 : 10) | 0); s += m[0].length;
      } else throw new Error(`scanf: unsupported conversion %${t}`);
      continue;
    }
    // literal
    if (s >= n) return { values: out, eof: out.length === 0 };
    if (str[s] !== c) return { values: out, eof: false };
    s++;
  }
  return { values: out, eof: false };
}
