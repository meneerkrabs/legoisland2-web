// Section 2 "Variabelen": the F9 dialog's "Switches" list (FUN_00401613): all 319 game variables as `"%d: '%s' = %d"` with an edit field and "Set" (FUN_00417597, which ignores vars 1 and 2),
// "Update All" = refresh. Extra: class of the variable (FUN_004176c1 "SDDEBUG": 0 volatile NS, 0xf GME saved, 0xeb MS, 0xfa zone-local), initial value (.data at 0x8a2d2c), evidence column.
import type { SectionDef } from './types.ts';
import { varClass } from '../shell/story.ts';
import { readInitialVars } from '../shell/tables.ts';
import { scanVarRefs } from './var-scan.ts';
import { badge, bar, btn, filterBox, h, note } from './ui.ts';

export const CLASS_NAME: Record<number, string> = { 0: 'NS (vluchtig)', 0xf: 'GME (bewaard)', 0xeb: 'MS (PlayStation)', 0xfa: 'zone-lokaal' };
/** FUN_00417597 ignores the writes to these (the F9 dialog's Set does nothing for them) */
export const LOCKED = new Set([1, 2]);

export const section: SectionDef = {
  id: 'variabelen', title: 'Variabelen', blurb: 'Alle 319 spelvariabelen met naam, waarde en een bewijskolom (wat de code er mee doet).',
  build(c) {
    const sh = c.sh, v = sh.vars;
    const init = readInitialVars(sh.pe);
    const refs = scanVarRefs(sh.pe);
    const el = h('div', {});
    const inputs: HTMLInputElement[] = [];
    const rows: HTMLTableRowElement[] = [];
    const tb = h('tbody', {});
    for (let i = 0; i < v.a.length; i++) {
      const inp = h('input', { className: 'dc-input num', type: 'text', value: String(v.get(i)), disabled: LOCKED.has(i) });
      const set = () => { const n = Number(inp.value); if (Number.isFinite(n)) { v.set(i, n); inp.value = String(v.get(i)); } };
      inp.onkeydown = (e) => { if (e.key === 'Enter') set(); };
      inp.onchange = set;
      inputs.push(inp);
      const r = refs.read[i], w = refs.write[i];
      const ev = h('span', {}, r ? badge(`lees ${r}`, 'info') : '', w ? badge(`schrijf ${w}`, 'ok') : '', !r && !w ? badge('geen vaste verwijzing', 'warn') : '');
      const tr = h('tr', { dataset: { q: `${i} ${v.nameOf(i)}`.toLowerCase(), none: !r && !w ? '1' : '' } },
        h('td', { className: 'num', textContent: String(i) }), h('td', { className: 'dc-mono', textContent: v.nameOf(i) }), h('td', {}, inp),
        h('td', { className: 'num', textContent: String(init[i]) }), h('td', { textContent: CLASS_NAME[varClass(i)] ?? '' }), h('td', {}, ev),
        h('td', {}, btn('begin', () => { v.set(i, init[i]); inp.value = String(v.get(i)); }, 'terug naar de beginwaarde')));
      rows.push(tr); tb.append(tr);
    }
    let q = '', onlyNone = false;
    const apply = () => { for (const r of rows) r.style.display = (!q || r.dataset.q!.includes(q)) && (!onlyNone || r.dataset.none === '1') ? '' : 'none'; };
    const none = h('input', { type: 'checkbox' });
    none.onchange = () => { onlyNone = none.checked; apply(); };
    const count = refs.read.reduce((n, x, i) => n + (x || refs.write[i] ? 0 : 1), 0);
    el.append(bar(filterBox('zoek op nummer of naam', (s) => { q = s; apply(); }), h('label', { className: 'dc-check' }, none, ` alleen "geen vaste verwijzing" (${count} van ${v.a.length})`), btn('Alles verversen', () => refresh())),
      note('Enter of het veld verlaten zet de waarde (FUN_00417597). Variabelen 1 (NS_OFF, altijd 0) en 2 (NS_ON, altijd 1) zijn vast. Bewijs: aantal aanroepen met een vaste index in het programma (onderzoek 6.12: een ondergrens, 141 aanroepen gebruiken een berekende index, scripts en cutscenes tellen niet mee).'));
    const t = h('table', { className: 'dc-table' }, h('thead', {}, h('tr', {}, ...['#', 'Naam', 'Waarde', 'Begin', 'Klasse', 'Bewijs', ''].map((x) => h('th', { textContent: x })))), tb);
    el.append(t);
    const refresh = () => { inputs.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = String(v.get(i)); }); };
    return { el, show: refresh, refresh };
  },
};
