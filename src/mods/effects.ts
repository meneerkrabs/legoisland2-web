// Which hex patches of the executable can do anything in this port? The port is not the executable: it re-implements the game logic in TypeScript and only
// READS certain data from the user's own EXE at run time (docs/re/mods.md "Patch mods"). A patch can therefore only have an effect where the port reads:
//   - the per-zone set-up constants: `SetupFog(near, far, fog, colour, enable)` arguments (sky / fog colour, draw distance) and the sea level (src/formats/zoneparams.ts)
//   - the zone set-up code that the x86 interpreter runs to place records / models (loader + builder functions, src/formats/exe.ts `extractZone`; the zone run
//     functions of src/formats/emusetup.ts, zonesetup.ts)
//   - the tables of src/shell/tables.ts (zone table, story FSM, menu pages, captions ...) and the option defaults (src/shell/options.ts)
// Everything else in the EXE (the game's code and its constants) is not used. A short list of known patches (constants the port hard-codes, the Mod Manager's own options) says what they mean here.
import { Pe } from '../formats/exe.ts';
import { ZONES } from '../viewer/data.ts';
import * as T from '../shell/tables.ts';
import type { PatchLine } from './package.ts';

export type Effect = 'works' | 'maybe' | 'ignored';
export interface PatchEffect { effect: Effect; note: string }

/** the NL retail build all addresses refer to */
export const NL_EXE_SIZE = 6459444;

interface Region { from: number; to: number; effect: Effect; note: string }

/**
 * Places in the executable that mods (and the LI2 Mod Manager's own options) are known to patch and what they mean for this port. File offsets (`off`) or virtual
 * addresses (`va`); these are checked first. All for the Dutch retail build (6,459,444 bytes), like every address in the port.
 */
const KNOWN: { off?: number; va?: number; len: number; effect: Effect; note: string }[] = [
  { va: 0x931ef8, len: 4, effect: 'ignored', note: 'Bi-plane: grootte van de tank (6825 per procent). Het verbruik hangt in het origineel af van de beeldsnelheid (per beeld, niet per tijdstap); de port rekent met vaste 60 Hz, één stap per beeld, dus precies zoals het origineel op een 60 Hz-scherm. De waarde staat vast in de code (src/zones/z22bip/plane.ts), dus de patch doet niets.' },
  { va: 0x490dc2, len: 4, effect: 'ignored', note: 'Skateboard: topsnelheid op het eiland (0,75). Staat vast in de code van de port (src/island/vehicles/skate.ts), dus de patch doet niets.' },
  { off: 0x29b2, len: 1, effect: 'ignored', note: 'Venstermodus (Mod Manager): in een browser is er altijd een venster, er is geen beeldschermmodus om te kiezen.' },
  { off: 0x29b9, len: 1, effect: 'ignored', note: '/force-opdrachtregel (Mod Manager): de port heeft geen opdrachtregel en geen opstartvenster van de oorspronkelijke launcher.' },
  { off: 0x2adb, len: 1, effect: 'ignored', note: 'Eerste introfilm overslaanbaar maken (Mod Manager): in deze port kan elke film met een klik of toets worden overgeslagen.' },
  { off: 0x2aea, len: 5, effect: 'ignored', note: 'Geen introfilms (Mod Manager): gebruik de optie "Introfilms overslaan" op het beginscherm.' },
  { off: 0x2b20, len: 5, effect: 'ignored', note: 'Geen introfilms (Mod Manager): gebruik de optie "Introfilms overslaan" op het beginscherm.' },
  { off: 0x2b56, len: 5, effect: 'ignored', note: 'Geen introfilms (Mod Manager): gebruik de optie "Introfilms overslaan" op het beginscherm.' },
  { off: 0x43c70, len: 6, effect: 'ignored', note: 'Laadscherm-snelheid (Mod Manager): de wachttijd van het pizza-laadscherm bestaat in deze port niet.' },
  { off: 0xcac3, len: 4, effect: 'ignored', note: 'Beeldverhouding van de 3D-weergave (Mod Manager "breedbeeld"): gebruik de optie "Beeld: breedbeeld" op het beginscherm; de port gebruikt de verhouding van het venster.' },
  { off: 0x52d6, len: 0x5a, effect: 'ignored', note: 'Lijst met beeldschermresoluties (Mod Manager): een browser kent geen beeldschermmodi; het beeld volgt het venster.' },
  { off: 0x572704, len: 5, effect: 'maybe', note: '"Debug Mode" van de Mod Manager: deze patch hoort bij een andere versie van het spel. In de Nederlandse versie valt hij midden in een geluidsbestandsnaam. Gebruik de optie "Debugmenu" op het beginscherm.' },
];
const f32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);

/** where the zone set-up constants sit (byte ranges as file offsets) */
function fogRegions(pe: Pe): Region[] {
  const t = pe.text, d = pe.data, out: Region[] = [];
  const names = ['dichtstbijzijnde zicht', 'kleinste trekafstand', 'grootste trekafstand', 'mistverloop', 'mist- en luchtkleur', 'mist aan'];
  const lo = t.roff, hi = t.roff + t.rsize - 10;
  for (let o = lo; o < hi; o++) {
    if (d[o] === 0xe8) {
      const rel = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24);
      if (((t.va + (o - lo) + 5 + rel) >>> 0) !== 0x442d90) continue;
      // the six pushes right before the call (push imm32 = 5 bytes, push imm8 = 2 bytes), pushed last argument first
      for (let back = 30; back >= 12; back--) {
        let p = o - back;
        const at: { off: number; len: number }[] = [];
        while (p < o) {
          if (d[p] === 0x68) { at.push({ off: p + 1, len: 4 }); p += 5; } else if (d[p] === 0x6a) { at.push({ off: p + 1, len: 1 }); p += 2; } else break;
        }
        if (p === o && at.length >= 6) {
          at.reverse();
          for (let i = 0; i < 6; i++) out.push({ from: at[i].off, to: at[i].off + at[i].len, effect: 'works', note: `Zone-instelling: ${names[i]} (SetupFog), bepaalt o.a. de kleur van lucht en mist` });
          break;
        }
      }
    } else if (d[o] === 0xc7 && d[o + 1] === 0x05 && ((d[o + 2] | (d[o + 3] << 8) | (d[o + 4] << 16) | (d[o + 5] << 24)) >>> 0) === 0x9da858) {
      out.push({ from: o + 6, to: o + 10, effect: 'works', note: 'Zone-instelling: zeespiegel' });
    }
  }
  return out;
}

/** the loader + builder functions of every zone (what `extractZone` interprets) and the zone run functions (emulated by emusetup / zonesetup) */
function zoneCodeRegions(pe: Pe): Region[] {
  const out: Region[] = [];
  const starts = pe.functionStarts();
  const end = (va: number) => { let lo = 0, hi = starts.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= va) { a = m; lo = m + 1; } else hi = m - 1; } return a + 1 < starts.length ? starts[a + 1] : va + 0x1000; };
  const range = (a: number, b: number, effect: Effect, note: string) => { const oa = pe.offset(a), ob = pe.offset(b - 1); if (oa >= 0 && ob >= oa) out.push({ from: oa, to: ob + 1, effect, note }); };
  for (const zone of ZONES) {
    const strs = pe.findStrings(`_data\\${zone}\\meshes\\`).filter((s) => /\.msh$/i.test(pe.cstr(s)));
    let loader = 0;
    for (const s of strs) { const x = pe.pushXrefs(s); if (x.length) { let lo = 0, hi = starts.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= x[0]) { a = m; lo = m + 1; } else hi = m - 1; } loader = starts[a]; break; } }
    if (!loader) continue;
    const bi = starts.indexOf(loader);
    const builder = bi > 0 ? starts[bi - 1] : 0;
    if (builder) range(builder, end(loader), 'works', `Opbouw van zone ${zone}: welke meshes en objecten waar staan (de port leest dit uit het programma)`);
  }
  for (let i = 0; i < T.ZONE_COUNT; i++) {
    const run = pe.u32(T.ZONE_TABLE_VA + i * 20);
    if (run) range(run, end(run), 'maybe', `Startcode van zone ${pe.cstr(T.ZONE_TABLE_VA + i * 20 + 8, 8)}: de port leest er enkele instellingen uit, maar voert de code niet uit`);
  }
  return out;
}

function tableRegions(pe: Pe): Region[] {
  const out: Region[] = [];
  const add = (va: number, len: number, note: string) => { const o = pe.offset(va); if (o >= 0) out.push({ from: o, to: o + len, effect: 'works', note }); };
  add(T.ZONE_TABLE_VA, T.ZONE_COUNT * 20, 'Zonetabel (welke zone bij welk nummer hoort)');
  add(T.STORY_TABLE_VA, T.STORY_NODE_COUNT * 8, 'Verhaalschema (welke zone na welke verhaalstap)');
  add(T.MENU_PAGES_VA, T.MENU_PAGE_COUNT * 20, 'Menupagina\'s');
  try { for (const p of T.readMenuPages(pe)) add(p.itemsAt, p.nitems * T.MENU_ITEM_SIZE, `Menupagina ${p.index}: onderdelen`); } catch { /* not the NL build */ }
  add(T.FSM_CAPTIONS_VA, 71 * 12, 'Titels van de bewaarplaatsen');
  add(T.REPLAY_TABLE_VA, T.REPLAY_COUNT * 0x30, 'Lijst herhaalbare spelletjes in Pepper\'s huis');
  add(T.CHECKPOINT_TABLE_VA, T.CHECKPOINT_COUNT * 0x2c, 'Lijst verhaalpunten');
  add(T.ALLZONES_TABLE_VA, T.ALLZONES_COUNT * 0x2c, 'Lijst alle zones');
  add(T.SOUNDTEST_TABLE_VA, 0x1b4, 'Geluidstestlijst');
  add(T.DECOR_GROUPS_VA, T.DECOR_GROUP_COUNT * 8, 'Gebouwen- en kledingtabel');
  add(T.DECOR_ENTRIES_VA, T.DECOR_ENTRY_COUNT * 8, 'Gebouwen- en kledingtabel');
  add(T.GAMEVARS_VA, 319 * 4, 'Beginwaarden van de spelvariabelen');
  add(0x403e30, 0x260, 'Standaardwaarden van de opties');
  return out;
}

/** `Region`s are tested lazily and only once per EXE */
export class EffectMap {
  private fog: Region[];
  private tables: Region[];
  private zone: Region[] | null = null;
  readonly pe: Pe;
  readonly isNl: boolean;
  constructor(exe: Uint8Array) {
    this.pe = new Pe(exe);
    this.isNl = exe.length === NL_EXE_SIZE;
    this.fog = this.isNl ? fogRegions(this.pe) : [];
    this.tables = this.isNl ? tableRegions(this.pe) : [];
  }

  classify(p: PatchLine): PatchEffect {
    const a = p.offset, b = p.offset + p.bytes.length, pe = this.pe;
    if (!this.isNl) return { effect: 'maybe', note: 'Dit programma is niet de Nederlandse winkelversie waar de port op gebaseerd is; adressen kunnen op een andere plek vallen.' };
    const hit = (rs: Region[]) => rs.find((r) => a < r.to && b > r.from);
    for (const h of KNOWN) { const o = h.off ?? pe.offset(h.va!); if (o >= 0 && a < o + h.len && b > o) return { effect: h.effect, note: h.note }; }
    const f = hit(this.fog) ?? hit(this.tables);
    if (f) return { effect: f.effect, note: f.note };
    this.zone ??= zoneCodeRegions(pe);
    const z = hit(this.zone);
    if (z) return { effect: z.effect, note: z.note };
    const sec = pe.sections.find((s) => a >= s.roff && a < s.roff + s.rsize);
    if (!sec) return { effect: 'ignored', note: 'Buiten de onderdelen van het programma.' };
    if (sec.name === '.text') return { effect: 'ignored', note: 'Programmacode van het origineel. De port voert die code niet uit (de spelregels zijn in TypeScript herschreven), dus de patch doet niets.' };
    if (sec.name === '.data' || sec.name === '.rdata') return { effect: 'maybe', note: 'Gegevens van het programma. De port leest sommige tabellen en constanten hieruit, maar deze plek is niet herkend; het effect is onzeker.' };
    return { effect: 'ignored', note: 'Bronnen of herplaatsingsgegevens van het programma; de port gebruikt ze niet.' };
  }
}

/** a one-line description of the new value for floats / colours, for the list in the UI */
export function describeBytes(p: PatchLine): string {
  const hexs = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  let s = `${p.offset.toString(16).toUpperCase()}: ${hexs(p.bytes)}`;
  if (p.bytes.length === 4) { const v = f32(p.bytes, 0); if (Number.isFinite(v) && Math.abs(v) > 1e-6 && Math.abs(v) < 1e7) s += ` (als kommagetal ${+v.toPrecision(6)})`; }
  return s;
}

export interface PatchRow { offset: number; text: string; effect: Effect; note: string }
/** the effect report of a mod's patch lines (what the mod list shows) */
export function reportPatches(em: EffectMap, patches: readonly PatchLine[]): PatchRow[] {
  return patches.map((p) => { const c = em.classify(p); return { offset: p.offset, text: describeBytes(p), effect: c.effect, note: c.note }; });
}
