// Section 12 "Over": what the Ontwikkelaarshoek is, the keys, where the numbers come from and how sure they are (docs/re/unused.md section 9, docs/re/devcorner.md). Read only.
import type { SectionDef } from './types.ts';
import { block, h, table, badge } from './ui.ts';
import { DEV_KEY } from './corner.ts';

export const KEYS: [string, string][] = [
  ['` (Backquote)', 'opent / sluit de Ontwikkelaarshoek (vrij in de toetstabel 0x8aeb20 van het origineel, door de toetspagina geweigerd, door de poort niet gebruikt)'],
  ['PgUp / PgDn', 'vorig / volgend onderdeel (niet in een invoerveld)'],
  ['Esc', 'sluit de hoek'],
  ['F8', 'autoplay aan / uit (origineel); of het kijkvlak, zie Camera en tekenen'],
  ['F9 / F10', 'de stub-hulpjes van de poort (verhaal voltooien / mini-spel mislukken) en F10 = schermafdruk'],
  ['Pijlen, Ctrl', 'vrije camera: vooruit / achteruit, draaien, Ctrl = zijwaarts en kantelen (onderdeel 4)'],
];
export const CONFIDENCE: [string, string, string][] = [
  ['Verborgen Debug-item (PEPPERONI) en pagina 17 / 26', 'code gelezen en in de poort uitgevoerd', 'zeker'],
  ['F9-dialoog (verhaal, variabelen, zone, scene, GOB-lijst)', 'logica uit de decompilatie, de dialoog zelf nooit uitgevoerd', 'bijna zeker'],
  ['Vrije camera FUN_0088fd70', 'bitexact vergeleken met de x86-emulator', 'zeker'],
  ['Debug-tekenwachtrij en slapende aanroepers', 'wachtrij exact; aanroepers deels (zie Camera en tekenen)', 'gedeeltelijk'],
  ['Galerijen (805 meshes, 787 .col, 151 texturen ...)', 'bij het openen berekend uit jouw bestanden; totalen komen overeen met het onderzoek', 'zeker (ondergrens: een naam die toevallig als tekst voorkomt telt als gebruikt)'],
  ['Transcripties van de 67 weesclips', 'whisper.cpp, Nederlands, "small": namen en bijzondere woorden vaak fout', 'bij benadering'],
  ['Variabelen "geen vaste verwijzing"', 'alleen vaste indexen in het programma', 'ondergrens'],
  ['Vliegen als de stationschef', 'hergebruikt de geverifieerde stationschef-poort; de handbediening bestaat niet in het origineel', 'uitbreiding'],
];

export const section: SectionDef = {
  id: 'over', title: 'Over', blurb: 'Wat dit is, de toetsen, de herkomst van de cijfers en hoe zeker ze zijn.',
  build(c) {
    const sh = c.sh;
    const el = h('div', {});
    el.append(block('Wat is dit',
      h('p', { className: 'dc-note', textContent: 'De Ontwikkelaarshoek is er alleen in de debugmodus van de poort (de optie "Debugmenu" op het beginscherm of ?debug=1). Zonder die optie wordt er niets van geladen en gedraagt het spel zich precies als het origineel. Alles wat het origineel zelf aan ontwikkelaarsfuncties had is hier uit de code nagebouwd; de galerijen laten inhoud zien die het spel nooit laadt. Spelbestanden worden bij het openen uit jouw eigen kopie gelezen; er staan er geen in de poort.' }),
      h('p', { className: 'dc-note', textContent: 'De hoek is een HTML-paneel en niet de 2D-laag van het spel: lijsten met honderden rijen, zoekvakken, getalvelden en een draaitafel passen niet in het 8-rijen-menu van het spel. De originele menupagina\'s (het Debug-item, pagina 17, 25, 26) lopen wel in het eigen menu van het spel.' })));
    el.append(block('Toetsen', table(['Toets', 'Wat'], KEYS.map(([k, v]) => [h('span', { className: 'dc-key', textContent: k }), v]))));
    el.append(block('Zekerheid', table(['Onderdeel', 'Methode', 'Zekerheid'], CONFIDENCE.map(([a, b, d]) => [a, b, badge(d, d.startsWith('zeker') ? 'ok' : d === 'uitbreiding' ? 'info' : 'warn')]))));
    const secs = c.sections.map((s, i) => [String(i + 1), s.title, s.blurb ?? '']);
    el.append(block('Onderdelen', table(['#', 'Naam', 'Inhoud'], secs)));
    el.append(block('Nu', h('p', { className: 'dc-mono dc-note', textContent: `toets ${DEV_KEY}; ${sh.nodes.length} verhaalpunten, ${sh.zones.length} zones, ${sh.vars.a.length} variabelen; lopend: ${c.run ? (c.run.kind === 'front' ? 'hoofdmenu' : c.run.info.id) : 'niets'}` })));
    return { el };
  },
};
