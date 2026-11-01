// LDraw colour table (LDConfig.ldr of the local library): code -> { name, rgb [0..255], alpha }. Used by the QA sheets of the set / building builders.
import fs from 'node:fs';
import path from 'node:path';
import { LDRAW } from './lib.mjs';
let table = null;
export function ldColors() {
  if (table) return table;
  table = new Map();
  const f = path.join(LDRAW, 'lib/ldraw/LDConfig.ldr');
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})\s+EDGE\s+#([0-9A-Fa-f]{6})(?:.*?\sALPHA\s+(\d+))?/);
    if (!m) continue;
    const v = parseInt(m[3], 16);
    table.set(+m[2], { name: m[1], rgb: [v >> 16, (v >> 8) & 255, v & 255], alpha: m[5] ? +m[5] : 255 });
  }
  return table;
}
export const ldRgb = (code) => ldColors().get(code)?.rgb ?? [160, 160, 160];
