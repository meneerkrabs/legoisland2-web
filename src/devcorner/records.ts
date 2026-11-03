// Section 5 "Records / Objecten": the F9 dialog's GOB list (resource 0x72, FUN_004026ed / FUN_00402898): every zone record (DAT_00983804, stride 0x68, count DAT_00983800) as
// "%c%c%c%c @ %5.1f, %5.1f, %5.2f. V:%s, AI:%s (%4d)" (name, position +0x3c/0x40/0x44, visible = flags & 2, AI = controller +0x5c) with Move To / Move By / Forwards (x, y, z),
// Copy / Paste of a position (clipboard text `%f\n%f\n%f\n`, the original's file c:\windows\temp\h2d2h.clp) and the default selection = the PEPP record.
// Extra (port): "toon verborgen" (the cut records BTB0-9 battery pickups, XXX3, BML2 / BML4, ...), teleport Pepper.
import type { SectionDef } from './types.ts';
import type { GameRecord } from '../game/record.ts';
import { RF_ENABLED } from '../game/record.ts';
import { badge, bar, btn, check, filterBox, h, note } from './ui.ts';
import type { CameraHook } from './camera-run.ts';
import { stateOf } from './camera-run.ts';

/** the line of the GOB list: FUN_00402898's format */
export function gobLine(r: GameRecord, index: number): string {
  const p = (n: number, d: number) => n.toFixed(d).padStart(5 + (d > 1 ? 1 : 0));
  return `${r.name.padEnd(4, ' ').slice(0, 4)} @ ${p(r.x, 1)}, ${p(r.y, 1)}, ${p(r.z, 2)}. V:${r.enabled ? 'Y' : 'N'}, AI:${r.ctrl ? 'Y' : 'N'} (${String(index).padStart(4)})`;
}
/** Move To / Move By / Forwards (FUN_00401e61 / FUN_00401fab / FUN_0040218c): absolute, relative in the world axes, relative along the record's own axes */
export function moveRecord(r: GameRecord, mode: 'to' | 'by' | 'fwd', d: [number, number, number]) {
  if (mode === 'to') { r.x = d[0]; r.y = d[1]; r.z = d[2]; }
  else if (mode === 'by') { r.x += d[0]; r.y += d[1]; r.z += d[2]; }
  else { const w = r.toWorld(d); r.x = w[0]; r.y = w[1]; r.z = w[2]; }
}
export const HIDDEN_NAMES = /^(BTB\d|XXX3|BML[24]|HOLO)/;

export const section: SectionDef = {
  id: 'records', title: 'Records / Objecten', blurb: 'De GOB-lijst van het F9-dialoog: elk record van de zone met plaats, zichtbaar en AI; verplaatsen en verborgen records tonen.',
  build(c) {
    const el = h('div', {});
    const list = h('select', { className: 'dc-select', size: 18, style: 'width:100%;font-family:ui-monospace,Menlo,monospace' }) as HTMLSelectElement;
    const num = (v = '0') => h('input', { className: 'dc-input num', type: 'number', step: 'any', value: v });
    const ix = num(), iy = num(), iz = num();
    let q = '', onlyHidden = false;
    let clip: [number, number, number] | null = null;
    const recs = (): GameRecord[] => (c.run && c.run.kind === 'zone' ? c.run.world.records : c.run?.kind === 'front' ? c.run.world.records : []);
    const sel = (): GameRecord | null => recs()[Number(list.value)] ?? null;
    const fill = () => {
      const keep = list.value;
      const rs = recs();
      list.replaceChildren();
      rs.forEach((r, i) => {
        const line = gobLine(r, i);
        if (q && !line.toLowerCase().includes(q)) return;
        if (onlyHidden && (r.enabled || !HIDDEN_NAMES.test(r.name))) return;
        list.append(h('option', { value: String(i), textContent: line + (HIDDEN_NAMES.test(r.name) ? '  *' : '') }));
      });
      if (keep && [...list.options].some((o) => o.value === keep)) list.value = keep;
      else { const pep = rs.findIndex((r) => r.name === 'PEPP'); if (pep >= 0 && [...list.options].some((o) => o.value === String(pep))) list.value = String(pep); }   // default selection = PEPP
      info();
    };
    const info = () => { const r = sel(); if (r) { ix.value = r.x.toFixed(2); iy.value = r.y.toFixed(2); iz.value = r.z.toFixed(2); } };
    list.onchange = info;
    const val = (): [number, number, number] => [Number(ix.value), Number(iy.value), Number(iz.value)];
    const act = (f: (r: GameRecord) => void) => { const r = sel(); if (!r) { c.toast('geen record gekozen'); return; } f(r); fill(); };
    const none = h('input', { type: 'checkbox' });
    none.onchange = () => { onlyHidden = none.checked; fill(); };
    // "Camera op dit object" (camera-object.ts, applied by the camera hook right before each drawn frame, in every loop mode)
    const S = stateOf(c);
    const hook = () => c.store<{ cur: CameraHook | null }>('camera.hook', () => ({ cur: null })).cur;
    const onum = (get: () => number, set: (v: number) => void, step: string) => {
      const i = h('input', { className: 'dc-input num', type: 'number', step, value: String(get()) }) as HTMLInputElement;
      i.onchange = () => { const v = Number(i.value); if (Number.isFinite(v)) { set(v); hook()?.touchObject(); } };
      return i;
    };
    const inDist = onum(() => S.obj.dist, (v) => { S.obj.dist = Math.max(0, v); }, '0.5');
    const inHeight = onum(() => S.obj.height, (v) => { S.obj.height = v; }, '0.5');
    const inAz = onum(() => S.obj.azimuth, (v) => { S.obj.azimuth = v; }, '15');
    const inAim = onum(() => S.obj.aim, (v) => { S.obj.aim = v; }, '0.5');
    const followCk = check('volg', () => S.obj.follow, (v) => { S.obj.follow = v; hook()?.touchObject(); }, 'Aan: de camera blijft op het record terwijl het beweegt. Uit: de camera blijft staan waar hij is neergezet.');
    const objLive = h('span', { className: 'dc-note' });
    const objStart = () => {
      const r = sel(), k = hook();
      if (!r || !k) { c.toast('geen record gekozen'); return; }
      S.obj.dist = Number(inDist.value) || 0; S.obj.height = Number(inHeight.value); S.obj.azimuth = Number(inAz.value); S.obj.aim = Number(inAim.value);
      if (k.startObject(Number(list.value))) c.toast(`camera op ${r.name}: Esc (met het paneel dicht) of "Terug naar spelcamera" geeft de camera van het spel terug`);
    };
    const objBar = bar('Camera op dit object:', 'afstand', inDist, 'hoogte', inHeight, 'azimut (graden)', inAz, 'kijkpunt', inAim, followCk.el,
      btn('Camera op dit object', objStart, 'port-uitbreiding: de camera wordt vlak voor elk getekend beeld op het gekozen record gezet, ook in tussenfilmpjes en minispelen (het spel ziet zijn eigen camera ongewijzigd)'),
      btn('Terug naar spelcamera', () => hook()?.stopObject(), 'Esc met het paneel dicht doet hetzelfde'), objLive);
    const objRefresh = () => {
      followCk.sync();
      const k = hook(), p = S.obj.on ? k?.objectPlacement() : null;
      objLive.textContent = p ? ` echte afstand ${p.distance.toFixed(1)} (de dichte clipping van het eiland is 4,0)` : '';
    };
    el.append(bar(filterBox('filter (naam of plaats)', (s) => { q = s; fill(); }), h('label', { className: 'dc-check' }, none, ' alleen verborgen bijzondere records (BTB0-9, XXX3, BML2/4, HOLO)'), btn('Verversen', fill)),
      list,
      bar('x', ix, 'y', iy, 'z', iz,
        btn('Move To', () => act((r) => moveRecord(r, 'to', val())), 'FUN_00401e61'),
        btn('Move By', () => act((r) => moveRecord(r, 'by', val())), 'FUN_00401fab'),
        btn('Forwards', () => act((r) => moveRecord(r, 'fwd', val())), 'FUN_0040218c: langs de eigen assen van het record'),
        btn('Copy', () => { const r = sel(); if (r) { clip = [r.x, r.y, r.z]; void navigator.clipboard?.writeText(`${r.x}\n${r.y}\n${r.z}\n`).catch(() => { /* no clipboard */ }); c.toast('plaats gekopieerd'); } }, 'FUN_00402388'),
        btn('Paste', () => act((r) => { if (clip) moveRecord(r, 'to', clip); }), 'FUN_0040228a')),
      bar(btn('Zichtbaar omzetten (V)', () => act((r) => { r.flags ^= RF_ENABLED; }), 'record-vlag 2'),
        btn('Pepper hierheen', () => { const r = sel(); const p = recs().find((x) => x.name === 'PEPP'); if (r && p) { moveRecord(p, 'to', [r.x, r.y + 2, r.z]); fill(); } }, 'port-uitbreiding'),
        btn('Alle verborgen bijzondere tonen', () => { for (const r of recs()) if (HIDDEN_NAMES.test(r.name)) r.flags |= RF_ENABLED; fill(); c.toast('verborgen records zichtbaar (BTB = de batterijen)'); }, 'port-uitbreiding: de batterijen BTB0-9 hebben geen opraapgedrag in het programma')),
      objBar,
      note('Camera op dit object: afstand = horizontaal vanaf het record, hoogte = camerahoogte boven de oorsprong van het record, azimut 0 = voor het record (zijn voorwaartse as), 90 = rechterzijde, 180 = achter, 270 = links; kijkpunt = hoogte van het punt waarop de camera kijkt. Met "volg" blijft de camera op het record terwijl het beweegt. Werkt in elke lusmodus (spel, tussenfilmpje, minispel, hoofdmenu); alleen het getekende beeld verandert, het spel houdt zijn eigen camera.'),
      note('V = zichtbaar en botsend (vlag 2), AI = het record heeft een besturing (controller +0x5c). Een record dat een knoop aanstuurt kan zijn plaats meteen weer overschrijven. * = bijzondere (afgedankte) records.'),
      h('div', {}, badge('origineel', 'ok'), ' lijst, Move To / By / Forwards, Copy / Paste, V:/AI: ', badge('uitbreiding', 'info'), ' filter, Pepper hierheen, verborgen records tonen'));
    return { el, show: () => { fill(); objRefresh(); }, refresh: () => { objRefresh(); if (list.options.length !== recs().length && !q && !onlyHidden) fill(); } };
  },
};
