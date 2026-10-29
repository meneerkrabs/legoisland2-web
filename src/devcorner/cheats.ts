// Section 3 "Cheats en geheimen": the six cheat words of the original with their real effect (FUN_004375a8 / FUN_00437515, rows at 0x8aed70, docs/re/input.md section 5, unused.md 2 and 3),
// toggles for what they switch on, the "windowed mode" switch that makes the original scan rows 0 / 1 (PEPPERONI, FSMADVANCE) and a box to "type" a word.
// Ported here: PEPPERONI = FUN_0041b357 (DAT_008a933c = 6: the item count of main-menu page 0, so the 6th item "Debug" (0x8a788c, goto page 17) appears; unused.md 2 corrects the older "never read").
import type { SectionDef, RunHook } from './types.ts';
import type { Shell } from '../shell/shell.ts';
import type { Pe } from '../formats/exe.ts';
import type { MenuPage } from '../shell/menu.ts';
import { cheatState, CheatDetector, VAR_SDREAMS } from '../shell/cheats.ts';
import { MENU_ITEM_SIZE } from '../shell/tables.ts';
import { bar, block, btn, check, h, note, table } from './ui.ts';

export const PEPPERONI_COUNT = 6;
/** FUN_0041b357: DAT_008a933c = 6 */
export function setPepperoni(_sh?: Shell) { cheatState.pepperoni = PEPPERONI_COUNT; }

/** the item count of main-menu page 0 as the executable's data says it: 5, or 6 after PEPPERONI (DAT_008a933c = nitems of page 0). Returns true when the page changed. */
export function applyPepperoni(pages: MenuPage[], pe: Pe, itemsAt: number, baseCount = 5): boolean {
  const want = cheatState.pepperoni === PEPPERONI_COUNT ? PEPPERONI_COUNT : baseCount;
  const items = pages[0].items;
  if (items.length === want) return false;
  if (items.length > want) { items.length = want; return true; }
  for (let i = items.length; i < want; i++) {
    const at = itemsAt + i * MENU_ITEM_SIZE;
    items.push({ label: pe.cstr(at, 0x40), type: pe.u32(at + 0x40), value: pe.u32(at + 0x44) | 0, disable: pe.u32(at + 0x48) | 0 });
  }
  return true;
}

export const CHEAT_WORDS = [
  { row: 0, word: 'PEPPERONI', fn: 'FUN_0041b357', effect: 'Het hoofdmenu krijgt een zesde item "Debug" (pagina 17, de verhaalcheckpoints). Alleen vensterstand.', port: 'ja (debugmodus)' },
  { row: 1, word: 'FSMADVANCE', fn: 'FUN_00404c07(var 0x58 + 1)', effect: 'Het verhaal gaat een punt verder. Alleen vensterstand.', port: 'ja (debugmodus)' },
  { row: 2, word: 'RHUNRHEGED', fn: 'FUN_00438cb0(0, "SDPad.cpp", 0x2f7, ...)', effect: 'Foutdialoog "Error in Game"; elke knop beeindigt het programma (hier: pagina herladen).', port: 'ja' },
  { row: 3, word: 'BAATAT', fn: 'DAT_009da5b4 = 1; FUN_00420674(-1)', effect: 'De decor-era-tabel van het eiland gebruikt era 4 in plaats van 3 voor verhaalpunt >= 0x40.', port: 'ja (vlag); het eilandinrichting leest hem' },
  { row: 4, word: 'SDREAMS', fn: 'FUN_00417597(0xd, 1)', effect: 'Variabele 0xd = 1: de wormgat WORM op het eiland leidt naar de ontwikkelaarsgrot z50LTC.', port: 'ja' },
  { row: 5, word: 'DAFFODILE', fn: '(geen handler)', effect: 'Voltooid, er gebeurt niets.', port: 'ja (niets)' },
];

export const section: SectionDef = {
  id: 'cheats', title: 'Cheats en geheimen', blurb: 'De zes cheatwoorden van het origineel en de schakelaars die ze omzetten.',
  build(c) {
    const sh = c.sh;
    const el = h('div', {});
    const det = (): CheatDetector | null => (sh.input.cheats as CheatDetector | null);
    const fire = (row: number) => { const d = det(); if (d) d.onCheat(row); else c.toast('de cheatdetector is niet actief'); };
    const rows = CHEAT_WORDS.map((w) => [String(w.row), h('b', { textContent: w.word }), h('span', { className: 'dc-mono', textContent: w.fn }), w.effect, w.port, btn('Uitvoeren', () => { fire(w.row); c.toast(`${w.word} uitgevoerd`); })]);
    el.append(block('De zes cheatwoorden (tabel 0x8aed70)', table(['Rij', 'Woord', 'Functie', 'Effect', 'In de poort', ''], rows),
      note('In het origineel typ je ze met de toetsen van het toetsenbord (een toets per tik, de laagste ingedrukte toets telt). SDREAMS begint "niet ingeschakeld": de allereerste keer moet je hem twee keer typen (input.md 5).')));
    // type box
    const words = new Map(CHEAT_WORDS.map((w) => [w.word, w.row]));
    const typed = h('input', { className: 'dc-input', placeholder: 'typ een cheatwoord en druk Enter', size: 34 });
    typed.onkeydown = (e) => { if (e.key !== 'Enter') return; const w = typed.value.trim().toUpperCase(); const r = words.get(w); if (r === undefined) c.toast('onbekend cheatwoord'); else { fire(r); c.toast(`${w} uitgevoerd`); } typed.value = ''; };
    el.append(block('Typen', bar(typed), note('Dit vak voert de handler van het woord uit, zoals de detector het zou doen; de echte detector leest de toetsen van het spel zelf (ook in de debugmodus).')));
    // toggles
    const baatat = check('BAATAT: era 4 voor de eilandinrichting', () => cheatState.baatat, (v) => { cheatState.baatat = v; }, 'DAT_009da5b4');
    const sdreams = check('SDREAMS: variabele 0xd = 1 (wormgat naar z50LTC)', () => sh.vars.get(VAR_SDREAMS) !== 0, (v) => sh.vars.set(VAR_SDREAMS, v ? 1 : 0), 'game var 0xd');
    const nsoff = check('NS_OFF = 1 (en NS_ON = 0): de gesloten "HOLO" / portaalknopen en verhaalpunt 68', () => nsOffOn(sh), (v) => setNsOff(sh, v), 'Variabelen 1 en 2 zijn in het origineel vast (0 en 1)');
    const windowed = check('Vensterstand: PEPPERONI en FSMADVANCE worden gescand', () => (det()?.firstRow ?? 2) === 0, (v) => { const d = det(); if (d) d.firstRow = v ? 0 : 2; }, 'DAT_009dab70 = 0; in de poort is dit de debugmodus');
    const pep = h('span', { className: 'dc-mono' });
    const sync = () => { baatat.sync(); sdreams.sync(); nsoff.sync(); windowed.sync(); pep.textContent = `DAT_008a933c (items hoofdmenu pagina 0) = ${cheatState.pepperoni || 5}`; };
    sync();
    el.append(block('Schakelaars', bar(baatat.el), bar(sdreams.el), bar(nsoff.el), bar(windowed.el), bar(pep, btn('PEPPERONI nu', () => { setPepperoni(); sync(); }), btn('Terug naar 5', () => { cheatState.pepperoni = 0; sync(); })),
      note('NS_OFF = 1 werkt waar de poort de variabele via GameVars.get leest: de knopen met poort NS_OFF / NS_ON (onbruikbare hologram-knopen van vier hubs, portalen van het eiland) en verhaalpunt 68 (laat het verhaal verder gaan). Pas bij de volgende zone volledig zichtbaar (de inrichting leest de poorten bij het starten).')));
    el.append(block('Meer geheimen (alleen lezen)',
      h('ul', { className: 'dc-note' },
        h('li', { textContent: 'Shift 20 tikken (ongeveer 0,67 s) ingedrukt: het Infomaniac-hologram (de "3 seconden" van de volksmond kloppen niet). Is al in de poort.' }),
        h('li', { textContent: 'Shift bij konijnen / vlinders / in een auto / op de trein: konijnensprong, volgende vlinder, claxon, bel (al in de poort).' }),
        h('li', { textContent: 'Redding door de stationschef bij een val van de Space Mountain: zie onderdeel 11 (Vliegen).' }),
        h('li', { textContent: '"OGEL", Shift+Ctrl+Space "oneindige edelstenen", "Lori Larson", "Jub Jub": komen in de code niet voor (onderzoek, unused.md 3).' }))));
    return { el, show: sync, refresh: sync };
  },
  attach(c, run): RunHook | null {
    if (run.kind !== 'front') return null;
    const sh = run.sh;
    // the front end's menu shows item 6 of page 0 once DAT_008a933c = 6
    return { tick() { applyPepperoni(sh.menu.engine.pages, sh.pe, sh.rawPages[0].itemsAt); } };
  },
};

/** NS_OFF / NS_ON overridden for the port's GameVars.get (the original's setters return at once for 1 and 2, so they are always 0 / 1) */
function nsOffOn(sh: Shell): boolean { return sh.vars.get(1) === 1; }
function setNsOff(sh: Shell, on: boolean) {
  const v = sh.vars as unknown as { get(i: number): number; __orig?: (i: number) => number };
  if (on) {
    if (v.__orig) return;
    const orig = Object.getPrototypeOf(sh.vars).get.bind(sh.vars) as (i: number) => number;
    v.__orig = orig;
    v.get = (i: number) => (i === 1 ? 1 : i === 2 ? 0 : orig(i));
  } else if (v.__orig) {
    delete (v as { get?: unknown }).get;
    v.__orig = undefined;
  }
}
