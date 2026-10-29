// Section 1 "Springen": the jump functions of the original's debug code. Ported: the F9 "Debug Info" dialog's FSM group (`<` / `>` = FUN_004015cc -> FUN_00404c07(node -+ 1), "Jump To" = FUN_004014c0
// -> FUN_00404c07(typed)) and Sub Game group (FUN_0040154b: var 5 NEXT_SUBGAME = any zone number); the hidden "Debug" menu page 17 (36+1 story checkpoints, FUN_0041b227 / FUN_0041be4e)
// and the QA zone list, page 26 (FUN_0041b274), which run in the game's own menu engine (opened here); the unreachable story nodes 68-71 (unused.md 8.4).
// Leaving a zone / the front end goes through the zone loop's pending override like the front end's checkpoint list does (FUN_0041ad43).
import type { SectionDef, RunCtx } from './types.ts';
import { bar, badge, block, btn, h, note, table } from './ui.ts';
import { readLevelSelect } from '../shell/tables.ts';
import { GV } from '../shell/story.ts';
import { V } from '../game/vars.ts';
import { EXIT } from '../shell/loopmachine.ts';
import type { DevCorner } from './corner.ts';

/** nodes the normal flow never reaches: 68 (NS_OFF is read-only 0 so it never completes), 69-71 are parking nodes; z29PAI / z30PLI (zones 22, 23) have no code */
export const UNREACHABLE_NODES = new Set([68, 69, 70, 71]);
export const NO_CODE_ZONES = new Set([22, 23]);

/** F9 dialog "Jump To" for a story node: FUN_00404c07 (story.jump) and then the run goes to that node's zone */
export function jumpToNode(c: DevCorner, run: RunCtx, node: number) {
  const sh = run.sh;
  if (node < 0 || node >= sh.nodes.length) { c.toast(`verhaalpunt ${node} bestaat niet`); return; }
  sh.story.jump(node);   // FUN_00404c07: forced variables of the skipped nodes, var 5 = the node's zone
  run.leaveTo(sh.story.zoneOf(node), node);
  c.close();
  c.toast(`naar verhaalpunt ${node}`);
}
/** F9 dialog "Sub Game / Jump To" (FUN_0040154b): var 5 = the zone */
export function jumpToZone(c: DevCorner, run: RunCtx, zone: number, startedFromMenu = false) {
  const sh = run.sh;
  sh.vars.set(V.NS_NEXT_SUBGAME, zone);
  if (startedFromMenu) sh.vars.set(GV.STARTEDFROMMENU, 1);
  run.leaveTo(zone);
  c.close();
  c.toast(`naar zone ${zone} (${sh.zones[zone]?.id ?? '?'})`);
}
/** the front end's page of the original's menu: in the front end at once, from a zone through the main menu */
export function openFrontPage(c: DevCorner, run: RunCtx, page: number) {
  if (run.kind === 'front') { run.openPage(page); c.close(); return; }
  c.pendingFrontPage = page;
  run.sh.loop.pending.kind = 0;
  run.machine.leave(EXIT.QUIT);
  c.close();
  c.toast(`naar het hoofdmenu, pagina ${page}`);
}

export const section: SectionDef = {
  id: 'springen', title: 'Springen', blurb: 'Verhaalpunten, de checkpoints en zonelijsten van de ontwikkelaars, en vrij naar een zone springen (het F9-dialoog van het origineel).',
  build(c) {
    const el = h('div', {});
    const sh = c.sh;
    const need = (): RunCtx | null => { const r = c.run; if (!r) c.toast('geen lopende zone'); return r; };
    // --- F9 dialog: FSM group
    const cur = h('span', { className: 'dc-mono' });
    const nodeIn = h('input', { className: 'dc-input num', type: 'number', min: 0, max: sh.nodes.length - 1, value: String(sh.story.node) });
    const zoneSel = h('select', { className: 'dc-select' }, ...sh.zones.map((z) => h('option', { value: String(z.index), textContent: `${z.index}: ${z.id}${z.hasRun ? '' : ' (geen code)'}` })));
    const refresh = () => { const n = sh.story.node; cur.textContent = `verhaalpunt ${n} (var 0x58), zone ${sh.vars.get(V.CURRENT_SUBGAME)} ${sh.zones[sh.vars.get(V.CURRENT_SUBGAME)]?.id ?? ''}, volgende zone (var 5) ${sh.vars.get(V.NS_NEXT_SUBGAME)}`; };
    refresh();
    el.append(block('Verhaal (F9: FSM)',
      bar('Nu:', cur),
      bar(btn('< vorige', () => { const r = need(); if (r) jumpToNode(c, r, sh.story.node - 1); }, 'FUN_004015cc: FUN_00404c07(node - 1)'),
        btn('volgende >', () => { const r = need(); if (r) jumpToNode(c, r, sh.story.node + 1); }, 'FUN_004015cc: FUN_00404c07(node + 1)'),
        'Spring naar', nodeIn, btn('Spring', () => { const r = need(); if (r) jumpToNode(c, r, Number(nodeIn.value)); }, 'FUN_004014c0: FUN_00404c07(getal)')),
      note('Springen vooruit zet de variabelen van de overgeslagen verhaalpunten, terug herstelt ze (FUN_00404c07); daarna gaat het spel naar de zone van dat punt.')));
    el.append(block('Zone (F9: Sub Game)',
      bar('Spring naar zone', zoneSel, btn('Spring', () => { const r = need(); if (r) jumpToZone(c, r, Number(zoneSel.value)); }, 'FUN_0040154b: var 5 NEXT_SUBGAME = zonenummer'),
        btn('z50LTC (ontwikkelaarsgrot)', () => { const r = need(); const z = sh.zones.find((q) => q.id === 'z50LTC'); if (r && z) jumpToZone(c, r, z.index); }, 'Het hol van de ontwikkelaars: ook via SDREAMS of verhaalpunt 71')),
      note('Zones 22 en 23 (z29PAI, z30PLI) hebben geen code: het spel slaat ze over. Een zone buiten haar verhaalpunt starten kan een kale of kapotte scene geven.')));
    // --- original pages
    const ls = readLevelSelect(sh.pe);
    el.append(block('Originele debugpagina\'s van het hoofdmenu',
      bar(btn('Verborgen "Debug"-item tonen (PEPPERONI)', () => { void import('./cheats.ts').then((m) => { m.setPepperoni(sh); c.toast('DAT_008a933c = 6: het hoofdmenu toont het zesde item "Debug"'); }); }, 'FUN_0041b357'),
        btn('Pagina 17: verhaalcheckpoints (menu)', () => { const r = need(); if (r) openFrontPage(c, r, 17); }, 'Het Debug-item: pagina 17, lijst 0x8a5c68'),
        btn('Pagina 25: alternatief hoofdmenu', () => { const r = need(); if (r) openFrontPage(c, r, 25); }, '!MAINMENU: START opent pagina 26'),
        btn('Pagina 26: alle zones (menu)', () => { const r = need(); if (r) openFrontPage(c, r, 26); }, 'QA-lijst 0x8a62c8')),
      note('Deze pagina\'s lopen in het eigen menu van het spel (menu.ts). Pagina 25 / 26 opent in het origineel niets; in pagina 26 zijn alle rijen behalve de eerste grijs (masker 0x20), zoals de oorspronkelijke tabel.')));
    const cpRows = ls.checkpoints.map((e) => [String(e.index), sh.msgs.label(e.label) || e.label, `${e.zone} ${sh.zones[e.zone]?.id ?? ''}`, e.node >= 0 ? String(e.node) : '-', e.mask ? badge('mask 0x' + e.mask.toString(16), 'warn') : '',
      btn('Spring', () => { const r = need(); if (!r) return; if (e.node >= 0) { sh.story.jump(e.node); sh.vars.set(GV.LGI_GAMELOOP, 3); } sh.vars.set(V.NS_NEXT_SUBGAME, e.zone); sh.vars.set(GV.STARTEDFROMMENU, 0); r.leaveTo(e.zone, e.node >= 0 ? e.node : undefined); c.close(); }, 'FUN_0041be4e')]);
    el.append(block('Checkpoints (pagina 17, 37 vermeldingen)', table(['#', 'Label', 'Zone (tabelpositie)', 'Verhaalpunt', '', ''], cpRows)));
    const azRows = ls.allZones.map((e) => [String(e.index), sh.msgs.label(e.label) || e.label, `${e.zone} ${sh.zones[e.zone]?.id ?? ''}`, e.mask ? badge('grijs in het menu', 'warn') : '',
      btn('Spring', () => { const r = need(); if (r) jumpToZone(c, r, e.zone, true); }, 'FUN_0041be4e, tak 0x1a: var 5 = zone, var 0xb = 1')]);
    el.append(block('Alle zones (pagina 26, QA-lijst)', table(['#', 'Label', 'Zone', '', ''], azRows)));
    // --- story node list
    const rows = sh.nodes.map((n) => {
      const z = sh.zones[n.zone];
      const badges = [UNREACHABLE_NODES.has(n.index) ? badge('onbereikbaar', 'warn') : '', z && !z.hasRun ? badge('geen code', 'red') : ''];
      return [String(n.index), `${z?.id ?? n.zone}`, `${sh.vars.nameOf(n.var)} & 0x${n.mask.toString(16)} = ${n.value}`, sh.captions[n.index] ?? '', h('span', {}, ...badges),
        btn('Spring', () => { const r = need(); if (r) jumpToNode(c, r, n.index); })];
    });
    el.append(block('Verhaalpunten 0-71', table(['#', 'Zone', 'Klaar als', 'Opslagtitel', '', ''], rows)));
    return { el, show: refresh, refresh };
  },
};
