// Small DOM helpers of the developer corner (plain elements, styles in style.ts).
type Kid = Node | string | null | undefined | false;

/** create an element: `h('div', { className: 'dc-row', onclick }, 'text', child)` */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, unknown>> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style' && typeof v === 'string') n.style.cssText = v;
    else if (k === 'dataset' && typeof v === 'object') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') (n as unknown as Record<string, unknown>)[k] = v;
    else (n as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}

export const btn = (text: string, onclick: (e: MouseEvent) => void, title = '', cls = ''): HTMLButtonElement => h('button', { className: `dc-btn ${cls}`.trim(), textContent: text, title, onclick, type: 'button' });

/** a labelled check box; `get` is read when the section refreshes (`sync()`), `set` called on change */
export function check(text: string, get: () => boolean, set: (v: boolean) => void, title = ''): { el: HTMLLabelElement; sync(): void } {
  const c = h('input', { type: 'checkbox', checked: get() });
  c.onchange = () => set(c.checked);
  return { el: h('label', { className: 'dc-check', title }, c, ` ${text}`), sync: () => { c.checked = get(); } };
}

export const hex = (n: number, w = 0) => `0x${(n >>> 0).toString(16).padStart(w, '0')}`;
export const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const f2 = (n: number) => n.toFixed(2);

/** a plain table from rows of cells (strings / nodes) */
export function table(head: string[], rows: Kid[][], cls = ''): HTMLTableElement {
  const t = h('table', { className: `dc-table ${cls}`.trim() });
  const th = h('tr', {});
  for (const c of head) th.append(h('th', { textContent: c }));
  t.append(h('thead', {}, th));
  const tb = h('tbody', {});
  for (const r of rows) { const tr = h('tr', {}); for (const c of r) tr.append(h('td', {}, c)); tb.append(tr); }
  t.append(tb);
  return t;
}

/** a search box that filters the rows of a list (`rows` carry their text in `dataset.q`, lower case); returns the input */
export function filterBox(placeholder: string, apply: (q: string) => void): HTMLInputElement {
  const i = h('input', { type: 'search', className: 'dc-input', placeholder, size: 26 });
  i.oninput = () => apply(i.value.trim().toLowerCase());
  return i;
}

/** a row of controls */
export const bar = (...kids: Kid[]) => h('div', { className: 'dc-bar' }, ...kids);
/** a titled block */
export const block = (title: string, ...kids: Kid[]) => h('div', { className: 'dc-block' }, h('h3', { textContent: title }), ...kids);
/** a dimmed explanation line */
export const note = (text: string) => h('p', { className: 'dc-note', textContent: text });
/** a badge: 'warn' (orange), 'info' (blue), 'ok' (green), '' (grey) */
export const badge = (text: string, kind = '') => h('span', { className: `dc-badge ${kind}`.trim(), textContent: text });

/** the file size in a readable form */
export const bytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);

/** run `fn` for chunks of `items` so the page stays responsive (galleries with thousands of rows) */
export async function chunked<T>(items: T[], size: number, fn: (t: T, i: number) => void): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    fn(items[i], i);
    if (i % size === size - 1) await new Promise((r) => setTimeout(r, 0));
  }
}
