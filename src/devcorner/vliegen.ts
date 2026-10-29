// Section 11 "Vliegen": fly like the station master (docs/re/unused.md 5): the DOM side. Logic in vliegen-core.ts.
import type { SectionDef } from './types.ts';
import type { DevCorner } from './corner.ts';
import { h, check, btn, bar, block, note, table, badge, f1 } from './ui.ts';
import { FLY_KEY, FLY_KEY_LABEL, FlightProbe, flightOn, findSupe, setFlight, toggleFlight, NOT_AVAILABLE } from './vliegen-core.ts';

const probes = new WeakMap<object, FlightProbe>();

export const section: SectionDef = {
  id: 'vliegen', title: 'Vliegen',
  blurb: 'Vlieg zelf als de stationschef, met Pepper in zijn hand (uitbreiding van de poort; het origineel kent dit niet).',
  build(c: DevCorner) {
    const run = () => (c.run?.kind === 'zone' ? c.run : null);
    const msg = h('p', { className: 'dc-note' });
    const live = h('div', { className: 'dc-note', style: 'white-space:pre;font-family:monospace' });
    const avail = h('div', {});
    const say = (t: string) => { msg.textContent = t; c.toast(t); };
    const tg = check(`Vlucht aan (toets ${FLY_KEY_LABEL})`, () => { const r = run(); return !!r && flightOn(r.world); }, (v) => {
      const r = run();
      say(r ? setFlight(r.world, v) : NOT_AVAILABLE);
      tg.sync();
    }, 'De stationschef duikt op Pepper af, tilt haar op en daarna stuur jij hem');
    const stop = btn('Pepper stationschef-vlucht stoppen', () => {
      const r = run();
      say(r ? setFlight(r.world, false) : NOT_AVAILABLE);
    }, 'Hij vliegt naar het dichtstbijzijnde helikopterplatform en zet Pepper af (zelfde als Ctrl of de toets nogmaals)');
    const keys = table(['Toets', 'Doet'], [
      [FLY_KEY_LABEL, 'vlucht aan / uit (alleen in de eilandzone z02LGI)'],
      ['Links / Rechts', 'draaien (5 graden per tick)'], ['Omhoog / Omlaag', 'neus omhoog / omlaag (3 graden per tick)'],
      ['Spatie / Alt', 'stijgen / dalen (0,8 per tick)'], ['Shift', 'snel vliegen (3,2 in plaats van 2,4 per tick)'],
      ['Ctrl of toets ' + FLY_KEY_LABEL + ' nogmaals', 'afzetten bij het dichtstbijzijnde helikopterplatform'],
    ]);
    const el = h('div', {},
      avail, bar(tg.el, stop), msg, block('Besturing', keys), block('Live', live),
      block('Eerlijk over wat dit is',
        note('Uitbreiding van de poort: het origineel heeft geen handmatige vlucht. Wat uit de decompilatie is overgenomen en getest is de stationschef zelf: het afduiken (FUN_0053aa8e), het optillen, Pepper in zijn hand (FUN_0053ac79: PEPPER_CONTROL 0x80, 1 onder en 1 naast hem), de camera (FUN_0053ab93), de vliegloop (clip 0xd2) en het afzetten bij het dichtstbijzijnde helikopterplatform (FUN_0053a4f7, toestanden 0xc..0xf, het skateboard verdwijnt).'),
        note('Nieuw is alleen de toestand 0x11 (de besturing, de snelheden hierboven) en het aanzetten van buiten af. Er is geen hoogte- of terreinbegrenzing (het origineel heeft die hier ook niet). Bij het afzetten snapt zijn hoogte naar 80 boven het platform (zo werkt toestand 0xc). De variant "alleen" (de zweefvlieger uit de blog) is niet gebouwd.')),
    );
    const upd = () => {
      const r = run();
      avail.replaceChildren();
      if (!r) { avail.append(badge(NOT_AVAILABLE + ' (geen zone actief)', 'warn')); live.textContent = ''; return; }
      if (!findSupe(r.world)) { avail.append(badge(NOT_AVAILABLE + ` (${r.info.id} heeft geen SUPE-record)`, 'warn')); live.textContent = ''; return; }
      avail.append(badge('SUPE gevonden', 'ok'));
      let p = probes.get(r.world); if (!p) { p = new FlightProbe(); probes.set(r.world, p); }
      const o = p.readout(r.world);
      if (!o) return;
      live.textContent = [
        `toestand   ${o.state} ${o.name}${o.manual ? '  (handmatig, tick ' + o.ticks + ')' : ''}`,
        `stationschef  ${f1(o.pos[0])}  ${f1(o.pos[1])}  ${f1(o.pos[2])}`,
        `Pepper        ${o.pep ? `${f1(o.pep[0])}  ${f1(o.pep[1])}  ${f1(o.pep[2])}` : '-'}`,
        `snelheid   ${o.speed.toFixed(2)} per tick   draaiing ${(o.yaw * 57.2958).toFixed(0)} gr, neus ${(-o.pitch * 57.2958).toFixed(0)} gr`,
        `PEPPER_CONTROL ${'0x' + o.pc.toString(16)}`,
      ].join('\n');
      tg.sync();
    };
    return { el, show: upd, refresh: upd };
  },

  attach(c, run) {
    if (run.kind !== 'zone') return null;
    const world = run.world;
    const probe = new FlightProbe();
    probes.set(world, probe);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== FLY_KEY || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (c.isOpen || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) return;
      e.stopPropagation();   // the game's own input does not see it
      if (e.repeat) return;
      e.preventDefault();
      c.toast(toggleFlight(world));
    };
    addEventListener('keydown', onKey, true);
    return {
      tick() {
        const on = flightOn(world);
        c.status('vliegen', on ? `Vliegen aan (${FLY_KEY_LABEL} / Ctrl = afzetten)` : '');
      },
      afterSim() { probe.sample(world); },
      destroy() { removeEventListener('keydown', onKey, true); c.status('vliegen', ''); },
    };
  },
};
