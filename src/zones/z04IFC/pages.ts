// The page table of the Information Centre's menu, read from the executable (docs/re/m3/z04IFC.md).
// FUN_0054c4a7 gives the room its own menu context (`FUN_0041c1a7(0, 0, IFC table, 0)`) whose page table `*(ctx + 100)` is 0x8f0658: 46 pages of 20 bytes
// { kind, nitems, items*, setup fn, type } with 0x4c-byte items { label[0x40], type, value, mask } (the same layout as the pause / front end pages, shell/tables.ts):
//   pages 0..16   kind 0: the 17 locations. item 0 = title (`!IFCxxxx`), then one `goto` item per person who lives there (value = the character page), then `!BACK`
//   pages 17..45  kind 2: the 29 characters (a dialog page: FUN_0041cbac draws it). item 0 = the name (`!IFCxxxx`), item 1 = the text line, item 2 = `!BACK`
// The data of the character pages' items 1 / 2 and item 0's record pointer are not static: 29 start-up functions (FUN_0054a001, FUN_0054a0d3 ... 0x54b72f, one per page)
// write them: item 0 + 0x44 = &record[k] (k = 1..29 = page - 16), item 1 label = the string at 0x8f0a50 + 0x14 * k' (`!IFCxxxx02`, the "Beroep" line), item 2 label
// `!BACK` (the string at +0xc), type 2, and zeroes the rest. Those writes are applied here from the string table they copy.
import type { Pe } from '../../formats/exe.ts';
import type { MenuItem, MenuPage } from '../../shell/menu.ts';
import { CHAR_PAGE0 } from './ifc.ts';

export const IFC_PAGES_VA = 0x8f0658;
export const IFC_PAGE_COUNT = 46;
export const IFC_ITEM_SIZE = 0x4c;
/** the start-up functions' source strings: per character page k (0..28) `label1` at +0 (11 bytes), `label2` at +0xc (6 bytes) of 0x8f0a50 + 0x14 k */
export const IFC_TEXT_VA = 0x8f0a50;
export const IFC_TEXT_STRIDE = 0x14;

/** the pages as menu engine pages (theme = the page's fifth dword) */
export function readIfcPages(pe: Pe): MenuPage[] {
  const out: MenuPage[] = [];
  for (let i = 0; i < IFC_PAGE_COUNT; i++) {
    const at = IFC_PAGES_VA + i * 20;
    const kind = pe.u32(at), n = pe.u32(at + 4), itemsAt = pe.u32(at + 8), setupAt = pe.u32(at + 12), theme = pe.u32(at + 16);
    const items: MenuItem[] = [];
    for (let j = 0; j < n; j++) {
      const it = itemsAt + j * IFC_ITEM_SIZE;
      items.push({ label: pe.cstr(it, 0x40), type: pe.u32(it + 0x40), value: pe.u32(it + 0x44) | 0, disable: pe.u32(it + 0x48) | 0 });
    }
    if (i >= CHAR_PAGE0) {
      const k = i - CHAR_PAGE0, src = IFC_TEXT_VA + k * IFC_TEXT_STRIDE;
      items[0].value = k + 1;                        // &record[k + 1] (record index; the original stores DAT_00983804 + 0x68 * (k + 1))
      items[1] = { label: pe.cstr(src, 0x20), type: 0, value: 0, disable: 0 };
      items[2] = { label: pe.cstr(src + 0xc, 0x20), type: 2, value: 0, disable: 0 };
    }
    out.push({ kind, theme, setupAt, items });
  }
  return out;
}

/** the message id a label stands for (`!IFCBRIK` -> `IFCBRIK`) */
export const labelId = (label: string) => (label.startsWith('!') ? label.slice(1) : label);

/**
 * FUN_0041c964: the text lines of a character page. The id is `item 1's label + 1`; the first lookup is that id (`IFCBRIK02`); every wrapped rest of a long line
 * is the next line; when the text ran out, the id's last two digits are replaced by the next number (`IFCBRIK03`, then 04 ...) until a lookup returns the id
 * itself or `!end`. `look` = FUN_00439788 (a missing id returns the id). `maxWidth(s)` = whether `s` fits into (param_5 - param_4) * 24 pixels.
 * At most 10 lines.
 */
export function infoLines(label1: string, look: (id: string) => string, fits: (s: string) => boolean): string[] {
  const out: string[] = [];
  const first = labelId(label1);
  let num = 2;                           // local_28 = 2, the first id already carries `02`
  let text: string | null = look(first);
  let rest: string | null = null;
  for (let row = 0; row < 10; row++) {
    if (text === null) {
      num++;
      const id = first.slice(0, first.length - 2) + String(num).padStart(2, '0');
      text = look(id);
      if (text === id || text === '!end') return out;    // `strcmp(text, "!end") == 0` / the id itself (not found): end
    }
    if (text !== '') {
      if (text === first) return out;
      // wrap: cut at the last space while the line is too wide (strrchr)
      let line: string = text;
      rest = null;
      while (!fits(line)) {
        const sp = line.lastIndexOf(' ');
        if (sp < 0) { rest = null; break; }
        rest = line.slice(sp + 1) + (rest !== null ? ' ' + rest : '');
        line = line.slice(0, sp);
      }
      out.push(line);
      text = rest;
    }
  }
  return out;
}
