// Section 4 of the Ontwikkelaarshoek: "Camera en tekenen". The original's free-fly camera (FUN_0088fd70), its debug-draw queue (FUN_00445ba0 / FUN_00445c70 / FUN_00445d20) with the dormant
// callers the port can show, the permanently-off LOD switches (DAT_05d37024, DAT_009e56b8), the F8 autoplay (FUN_00423170 / FUN_00423f7b) and the screenshot / frustum export
// (F10, FUN_00415497). The logic is in camera-*.ts (pure, tested in tools/tests/devcorner-camera.mjs); this file is the panel and the hook attach.
import type { SectionDef } from './types.ts';
import { badge, bar, block, btn, check, f2, h, note, table } from './ui.ts';
import { CameraHook, FREE_CAM_ZONES, stateOf } from './camera-run.ts';
import { NOT_PORTED } from './camera-probes.ts';
import { AUTOPLAY_PERIOD } from './camera-autoplay.ts';

const holder = (c: Parameters<SectionDef['build']>[0]) => c.store<{ cur: CameraHook | null }>('camera.hook', () => ({ cur: null }));

const origin = (o: string) => badge(o, o === 'origineel' ? 'ok' : o === 'uitbreiding' ? 'info' : o.startsWith('z08BKD') ? 'info' : 'warn');

export const section: SectionDef = {
  id: 'camera', title: 'Camera en tekenen',
  blurb: 'Vrije camera, debug-tekenen, LOD-schakelaars, F8-autoplay en schermafdruk / kijkpiramide van het origineel.',

  attach(c, run) {
    const hold = holder(c);
    const hook = new CameraHook(c, run);
    hold.cur = hook;
    const destroy = hook.destroy.bind(hook);
    hook.destroy = () => { destroy(); if (hold.cur === hook) hold.cur = null; };
    return hook;
  },

  build(c) {
    const S = stateOf(c), hold = holder(c);
    const hook = () => hold.cur;
    const syncs: (() => void)[] = [];
    const reg = <T extends { sync(): void }>(x: T) => { syncs.push(() => x.sync()); return x; };

    // ------------------------------------------------------------------------------------------------------------ 1. free camera
    const live = h('pre', { className: 'dc-mono dc-note', style: 'margin:4px 0;white-space:pre' });
    const zoneBadge = h('span', {});
    const startSel = h('select', { className: 'dc-select' },
      h('option', { value: 'auto', textContent: 'automatisch (origineel in de vier zones, anders huidige camera)' }),
      h('option', { value: 'origineel', textContent: 'origineel: (9, 9, 1), kanteling 0,14, draaiing 0,83' }),
      h('option', { value: 'huidig', textContent: 'huidige camera (uitbreiding, bij benadering)' }));
    startSel.onchange = () => { S.start = startSel.value as typeof S.start; };
    const freeCk = reg(check('Vrije camera aan', () => S.freeOn, (v) => { const k = hook(); if (k) k.enableFree(v); else S.freeOn = v; }, 'FUN_0088fd70: de camera vliegt, het spel loopt door'));
    const stillCk = reg(check('Pepper stilzetten (uitbreiding)', () => S.pepperStill, (v) => { S.pepperStill = v; }, 'Aan: het spel ziet de pijltoetsen en Ctrl niet zolang je vliegt. Het origineel laat Pepper met dezelfde toetsen gewoon meelopen.'));
    const keys = table(['Toets', 'Doet', 'Herkomst'], [
      ['Pijl omhoog / omlaag', 'vooruit / achteruit langs de kijkrichting (rij 2 van de matrix van de vorige aanroep)', 'origineel'],
      ['Pijl links / rechts', 'draaien (draaiing -= / += dt x 0,01; de hoek gaat x 5 de matrix in)', 'origineel'],
      ['Ctrl + links / rechts', 'zijwaarts schuiven (rij 0)', 'origineel'],
      ['Ctrl + omhoog / omlaag', 'kantelen (kanteling -= / += dt x 0,01)', 'origineel'],
      ['W A S D', 'zelfde bits als de pijlen (alias van de port)', 'uitbreiding'],
    ].map((r) => [r[0], r[1], origin(r[2])]));
    const free = block('Vrije camera (FUN_0088fd70, wrapper FUN_00890000)',
      note('Aanroepen in het origineel (alle uitgeschakeld: de vlaggen worden nooit gezet): 0x6be13d z20DSP (DAT_05d5c0bc), 0x6f37c6 z21FSH (DAT_05d5c3d4), 0x706e0e z22BIP (DAT_05d5cbd8), 0x656b47 z15SSH (een lokale 0). Toestand DAT_00982d28 .. 0x982d87; constanten en beginwaarden worden uit de exe gelezen.'),
      bar(freeCk.el, zoneBadge, stillCk.el),
      bar('Start:', startSel,
        btn('Naar beginstand (9, 9, 1)', () => { S.free.reset(); c.toast('Vrije camera: beginstand van het origineel'); }, 'DAT_00982d28 .. uit de exe'),
        btn('Camera overnemen', () => { const k = hook(); if (!k) return; const cc = k.run.world.camera.c; S.free.takeOver([cc[0], cc[1], cc[2]], [cc[3], cc[4], cc[5]]); c.toast('Vrije camera: huidige camera overgenomen (bij benadering)'); }, 'uitbreiding: pitch / yaw zoeken bij de huidige kijkrichting')),
      live, keys,
      note('De bewegingsstap is dt x (dt x 5) per tick, dus 5 eenheden per tick bij dt = 1 (afhankelijk van de framesnelheid, zoals in het origineel). In de vier originele zones is dit de camera zoals het origineel hem bedoelde; in elke andere zone een uitbreiding van de port.'));

    // ------------------------------------------------------------------------------------------------------------ 2. debug draw
    const catRows = S.cats.map((k) => {
      const ck = reg(check(k.label, () => k.on, (v) => { k.on = v; hook()?.syncInstall(); c.status('camera.draw', S.cats.some((x) => x.on) ? 'debug-tekenen aan' : ''); }, k.note));
      return h('div', { className: 'dc-bar' }, ck.el, origin(k.origin), h('span', { className: 'dc-note', textContent: k.note }));
    });
    const sphereCk = reg(check('Markeringen als bol (3 cirkels, uitbreiding)', () => S.sphereMarkers, (v) => { S.sphereMarkers = v; }, 'Het origineel tekent een plat X / + / vierkant in het wereldvlak XY'));
    const gradCk = reg(check('Kleurverloop op lijnen (8 stukjes, uitbreiding)', () => S.gradient, (v) => { S.gradient = v; }, 'Het origineel geeft elke lijn twee hoekpuntkleuren (wit naar zwart)'));
    const rangeIn = h('input', { className: 'dc-input num', type: 'number', value: String(S.graphRange), min: '0', step: '10' });
    rangeIn.onchange = () => { S.graphRange = Math.max(0, Number(rangeIn.value) || 0); };
    const drawStats = h('div', { className: 'dc-mono dc-note' });
    const notPorted = table(['Aanroeper', 'Niet geport, reden'], NOT_PORTED.map((n) => [n.what, n.why]));
    const draw = block('Debug-tekenen (wachtrij FUN_00445ba0 / FUN_00445c70, tekenen FUN_00445d20)',
      note('Het origineel zet de hoofdschakelaar DAT_05cb588c alleen in z08BKD aan; elders worden de lijnen weggegooid. Hier zet elk vakje de hoofdschakelaar aan en toont de aanroepen die de port kan laten zien. Markeringstypen 0 / 1 / 2 zijn een X / + / vierkant van halve grootte r in het XY-vlak (geen bollen). Wachtrijgrenzen: 0x24 / 0x1c bytes per item, melding "Graph Queue has overflowed" vanaf 0x64000 items.'),
      ...catRows,
      bar(sphereCk.el, gradCk.el, h('label', { className: 'dc-check' }, 'Graaf: alleen punten binnen ', rangeIn, ' van de camera (0 = alles, uitbreiding)')),
      bar(btn('Alles aan', () => { for (const k of S.cats) k.on = true; hook()?.syncInstall(); syncs.forEach((f) => f()); }), btn('Alles uit', () => { for (const k of S.cats) k.on = false; hook()?.syncInstall(); syncs.forEach((f) => f()); })),
      drawStats,
      h('h3', { textContent: 'Niet geport', style: 'margin-top:8px' }), notPorted);

    // ------------------------------------------------------------------------------------------------------------ 3. LOD
    const lodCk = reg(check('Forceer LOD (DAT_05d37024)', () => S.forceLod, (v) => { S.forceLod = v; hook()?.syncLod(); }, 'FUN_0044d420: elk geskinned object gebruikt LOD DAT_008b6c54 (= 2)'));
    const lodSel = h('select', { className: 'dc-select' }, ...[0, 1, 2, 3, 4].map((i) => h('option', { value: String(i), textContent: `LOD ${i}${i === S.forceLodLevel ? ' (origineel: DAT_008b6c54)' : ''}` })));
    lodSel.value = String(S.forceLodLevel);
    lodSel.onchange = () => { S.forceLodLevel = Number(lodSel.value); };
    const lodAll = reg(check('ook records zonder skelet (uitbreiding)', () => S.forceLodAll, (v) => { S.forceLodAll = v; }));
    const adSel = h('select', { className: 'dc-select' },
      h('option', { value: '0', textContent: 'uit (origineel: DAT_009e56b8 = 0)' }), h('option', { value: '1', textContent: '1: deelkeuze begint bij niveau + 1' }), h('option', { value: '2', textContent: '2: met de vervaagtabel 0x8b576c' }));
    adSel.onchange = () => { S.adaptive = Number(adSel.value) as 0 | 1 | 2; S.detail.level = 0; S.detail.run = 0; hook()?.syncLod(); };
    const lodLive = h('div', { className: 'dc-mono dc-note' });
    const lod = block('Detail (LOD)',
      bar(lodCk.el, lodSel, lodAll.el, origin('origineel')),
      note('Het origineel dwingt met DAT_05d37024 het LOD van het SKELET af (FUN_0044d420, dat anders op kwadraatafstand 1280 / 7200 kiest). De port skinnt met zijn modeldelen: er wordt het deel (mesh-LOD) van geskinde records op dezelfde index gezet; dat die twee hetzelfde zijn is onzeker.'),
      bar('Adaptieve detail (DAT_009e56b8):', adSel, origin('origineel')),
      note('FUN_00443d10 / FUN_00443f90 zijn exact overgenomen (functies getest tegen de exe in de emulator): na 11 beelden achter elkaar buiten de marge gaat het niveau DAT_009e56bc (0 .. 4) en de zichtafstand DAT_0089df34 (+-50, 240 .. 390) een stap. De beeldtijd (FUN_00443e40) komt uit performance.now() per simulatiestap (= per beeld van het origineel, 60 Hz; niet per rAF-aanroep) met een aangenomen teller van 1 MHz: bij benadering. Pepper (PEPP) houdt altijd het volle detail.'),
      lodLive);

    // ------------------------------------------------------------------------------------------------------------ 4. F8 autoplay
    const f8Sel = h('select', { className: 'dc-select' }, h('option', { value: 'autoplay', textContent: 'autoplay (origineel)' }), h('option', { value: 'kijkvlak', textContent: 'kijkvlak (port)' }));
    f8Sel.onchange = () => { S.f8 = f8Sel.value as typeof S.f8; };
    const autoCk = reg(check('Autoplay aan (F8)', () => S.auto.on, (v) => { const k = hook(); if (k) k.setAutoplay(v); else S.auto.on = v; }, 'DAT_009da634'));
    const planeCk = reg(check('Gestructureerd kijkvlak (z10RGB / z22BIP, F8-keuze "kijkvlak")', () => !!hook()?.run.gr.viewPlaneTextured, (v) => { const k = hook(); if (k) k.run.gr.viewPlaneTextured = v; }, 'GameRenderer.viewPlaneTextured: FUN_0087f854 wordt in het origineel nooit aangeroepen'));
    const autoLive = h('div', { className: 'dc-mono dc-note' });
    const auto = block('F8: autoplay (FUN_00423170, FUN_00423f7b)',
      bar(autoCk.el, origin('origineel'), 'F8 doet:', f8Sel, origin('uitbreiding')),
      note(`FUN_00423170: bij autoplay gaat bit 4 (omhoog) in het knoppenwoord (DAT_0098383c) en in het "ingedrukt"-woord (DAT_00983840) op elk even beeld (DAT_009da638 & 1 == 0): Pepper loopt om het andere beeld vooruit en intro- / help- / eindschermen worden weggedrukt. FUN_00423f7b (elk zonelus, elke ronde): na ${AUTOPLAY_PERIOD} (0x97) rondes wordt de teller 0 en loopt FUN_00404bb2 (verhaal een stap) tot FUN_00404be7() (zone van het verhaalpunt) verschilt van variabele 0x59; de zone wordt verlaten. De F8-schakeling hier werkt zoals het origineel in windowed mode; de tweede keuze legt het kijkvlak op F8 (zoals de port dat voorheen deed).`),
      bar(planeCk.el, origin('uitbreiding')), autoLive);

    // ------------------------------------------------------------------------------------------------------------ 5. screenshot / frustum
    const depthIn = h('input', { className: 'dc-input num', type: 'number', value: String(S.frustumDepth), min: '1', step: '10' });
    depthIn.onchange = () => { S.frustumDepth = Math.max(1, Number(depthIn.value) || 100); };
    const shotBlock = block('Schermafdruk en kijkpiramide',
      bar(btn('Schermafdruk (F10)', () => { const k = hook(); if (k) { k.requestShot(); c.toast('Schermafdruk: wordt na het volgende beeld gedownload (Lego0000.bmp ..)'); } else c.toast('Geen zone of menu actief'); }, 'FUN_0040cd27: BMP van het beeld, zoals F10 in het spel'), origin('origineel')),
      bar(btn('Kijkpiramide exporteren (Debug.obj)', () => {
        const k = hook(); if (!k) { c.toast('Geen zone actief'); return; }
        const text = k.frustumText();
        const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'Debug.obj', style: 'display:none' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        c.toast('Debug.obj gedownload (apex, 4 hoeken, doelpunt, vlakken)');
      }, 'FUN_00415497'), 'diepte van de hoeken:', depthIn, origin('origineel')),
      note('FUN_00415497 (0 aanroepers) schrijft c:\\Debug.obj: v-regels voor de top, vier hoeken en een punt (en dat punt + (0, 0, 1)), dan f 1 2 3 / 1 3 4 / 1 4 5 / 1 5 2 / 2 3 4 5 / 6 7 6. Het bestandsformaat is exact (formaatstrings uit de exe); wat de drie argumenten zijn is niet bekend (geen aanroepers): de port neemt top = oog, hoeken = het kijkpiramide op de gekozen diepte, punt = het kijkdoel (onzeker). De knippolygon-dumps (FUN_0087eaf3) zijn niet geport: hun lokale schakelaars zijn altijd 0 en de gegevens (D3D-knipvlakken) bestaan in de port niet.'));

    // ------------------------------------------------------------------------------------------------------------ keys
    const root = h('div', {}, free, draw, lod, auto, shotBlock, block('Toetsen', table(['Toets', 'Functie', 'Herkomst'], [
      ['F8', 'autoplay aan / uit (of het kijkvlak, zie F8-keuze)', origin('origineel')],
      ['F10', 'schermafdruk', origin('origineel')],
      ['pijlen, Ctrl', 'vrije camera (zie boven)', origin('origineel')],
      ['`', 'dit paneel', origin('uitbreiding')],
    ])));

    const refresh = () => {
      const k = hook();
      const S2 = S;
      syncs.forEach((f) => f());
      startSel.value = S2.start; f8Sel.value = S2.f8; adSel.value = String(S2.adaptive); lodSel.value = String(S2.forceLodLevel);
      const zone = k?.run.kind === 'zone' ? k.run.info.id : null;
      zoneBadge.replaceChildren(...(k ? [origin(FREE_CAM_ZONES.includes(zone ?? '') ? 'origineel' : 'uitbreiding'), h('span', { className: 'dc-note', textContent: zone ? ` in ${zone}` : ' in het hoofdmenu: geen simulatieronde, alleen in zones' })] : [h('span', { className: 'dc-note', textContent: 'geen zone of menu actief' })]));
      const f = S2.free, cam = k?.run.world.camera.c;
      live.textContent = [
        `positie     ${f.pos.map((v) => f2(v)).join(', ')}`,
        `draaiing    ${f.yaw.toFixed(4)} rad   (naar matrix x ${f2(S2.free.k.scale)} = ${(f.yaw * S2.free.k.scale).toFixed(3)})`,
        `kanteling   ${f.pitch.toFixed(4)} rad   (x ${f2(S2.free.k.scale)} = ${(f.pitch * S2.free.k.scale).toFixed(3)})`,
        `kijkrichting ${[f.mat[8], f.mat[9], f.mat[10]].map((v) => v.toFixed(3)).join(', ')}   zijrichting ${[f.mat[0], f.mat[1], f.mat[2]].map((v) => v.toFixed(3)).join(', ')}`,
        `knoppenwoord 0x${((k?.lastPad ?? 0) >>> 0).toString(16)}   camera nu ${cam ? `oog ${[cam[0], cam[1], cam[2]].map((v) => f2(v)).join(', ')}  doel ${[cam[3], cam[4], cam[5]].map((v) => f2(v)).join(', ')}` : '-'}`,
      ].join('\n');
      const st = k?.stats;
      drawStats.textContent = st ? `wachtrij: ${st.lines} lijnen, ${st.shapes} markeringen (${st.screenLines} schermlijnen niet getekend); getekend ${st.drawn} lijnstukken; sinds start ${st.total.lines} / ${st.total.shapes}; overlopen ${st.overflows}; graaf nu ${st.graphNodes} punten / ${st.graphLinks} verbindingen${k?.hasGraphs() ? ` (kaarten: ${k.graphMaps().join(', ')})` : k ? (k.run.kind === 'zone' ? ' (deze zone heeft geen waypointkaart)' : ' (de graaf werkt alleen in zones)') : ''}` : 'geen zone actief';
      const d = S2.detail;
      lodLive.textContent = `adaptief niveau DAT_009e56bc = ${d.level}, zichtafstand DAT_0089df34 = ${d.far}, reeks ${d.run}${S2.adaptive ? '' : ' (uit)'}   forceren: ${S2.forceLod ? `LOD ${S2.forceLodLevel}` : 'uit'}`;
      autoLive.textContent = `autoplay ${S2.auto.on ? 'aan' : 'uit'}, teller DAT_009da638 = ${S2.auto.counter} / ${AUTOPLAY_PERIOD}${S2.auto.guarded ? `, beveiliging ${S2.auto.guarded}x` : ''}   kijkvlak ${k?.run.gr.viewPlaneTextured ? 'aan' : 'uit'}`;
    };
    return { el: root, show: refresh, refresh };
  },
};
