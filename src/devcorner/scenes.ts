// Section 10 of the Ontwikkelaarshoek: "Scenes / animaties" (docs/re/unused.md 1.2 row 10, 7.4, 8.1, 8.7).
//  1. the cutscene gallery: every compiled script (`Cutscene/<name>.cut`, 87) and every `.txt` source without one, with badges computed at run time ("gerefereerd" / "niet gerefereerd" /
//     "leeg script" / "nooit getoond"), the readable listing of the commands, the script's message table and "Afspelen": in the running zone when the script is its own (the real manager of
//     the zone, F9 semantics) or on a neutral stage (scenes-stage.ts: an empty world with placeholder actors and the port's real cutscene manager, top-down plot);
//     "Scene van deze zone" = the F9 Debug Info dialog's "Choose cut-scene" list (FUN_00401613 / FUN_00458b71 / FUN_00458bf8 / FUN_00458d15);
//  2. the `.man` animation paths: kind, keys, duration, bounds, reference level; "Vlieg de camera langs dit pad" with the zone's camera (scenes-fly.ts);
//  3. empty slots / editor leftovers: counts and lists.
// Logic in scenes-data.ts (pure, tested by tools/tests/devcorner-scenes.mjs), loading in scenes-load.ts; this file is the panel and the hook attach.
import type { SectionDef, SectionView, ZoneRun } from './types.ts';
import type { DevCorner } from './corner.ts';
import { badge, bar, block, btn, check, f1, f2, filterBox, h, note, table } from './ui.ts';
import { jukeboxOf, playBtn, playStatus, playerBar, PagedList, syncPlayers } from './audio-ui.ts';
import { parseCutscene } from '../formats/cutscene.ts';
import type { Cutscene } from '../formats/cutscene.ts';
import { loadMessages } from '../ui/strings.ts';
import { sceneLoadOf } from './scenes-load.ts';
import type { SceneData } from './scenes-load.ts';
import {
  badgesOf, F9_NOT_LOADED_VA, f9Choose, f9List, f9Target, latin1Text, listing, manInfo, MAN_KIND_LABEL, MAN_REF_LABEL, pickStrings, readMan, runnerSlots, scriptActors, targetPartner,
} from './scenes-data.ts';
import type { Badge, CutRow, ManInfo, ManRow } from './scenes-data.ts';
import { Stage } from './scenes-stage.ts';
import { defaultMode, FlyHook, makeFlyPath, makeFlyState, viewAt } from './scenes-fly.ts';
import type { FlyMode, FlyState } from './scenes-fly.ts';
import { FrameClock } from '../game/world.ts';

const flyState = (c: DevCorner) => c.store<FlyState>('scenes.fly', makeFlyState);
const holder = (c: DevCorner) => c.store<{ cur: FlyHook | null }>('scenes.hook', () => ({ cur: null }));
const zoneRun = (c: DevCorner): ZoneRun | null => (c.run?.kind === 'zone' ? c.run : null);
const mk = (b: Badge) => badge(b.text, b.kind);
const sameArchive = (a: string, b: string | null | undefined) => !!b && a.toLowerCase() === b.toLowerCase();

export const section: SectionDef = {
  id: 'scenes', title: 'Scenes / animaties',
  blurb: 'Cutscene-galerij (87 scripts), de F9-keuzelijst van het origineel, onbenutte animatiepaden (.man) met een camera die ze afvliegt, en de lege slots en .cam-resten.',

  attach(c, run) {
    if (run.kind !== 'zone') return null;
    const hook = new FlyHook(c, run, flyState(c));
    const hold = holder(c);
    hold.cur = hook;
    const destroy = hook.destroy.bind(hook);
    hook.destroy = () => { destroy(); if (hold.cur === hook) hold.cur = null; };
    return hook;
  },

  build(c) { return build(c); },
};

function build(c: DevCorner): SectionView {
  const sh = c.sh;
  const jb = jukeboxOf(c);
  const pb = playerBar(jb);
  const load = sceneLoadOf(c);
  const status = h('div', { className: 'dc-note', textContent: load.progress });
  const root = h('div', {}, pb.el, status);
  const refreshers: (() => void)[] = [];
  let built = false;
  load.listeners.push(() => { status.textContent = load.progress; });

  // ------------------------------------------------------------------------------------------------------------ A. the scene of this zone (the F9 dialog's list)
  const zoneBox = h('div', {});
  let zoneSig = '';
  const f9 = () => {
    const run = zoneRun(c);
    const blockEl = block('Scene van deze zone (F9 "Debug Info", "Choose cut-scene")');
    const intro = note('Zo werkt de keuzelijst van het originele F9-venster (alleen in windowed mode): FUN_004013d0 vult hem met FUN_00458b71 (per slot de scriptnaam op +4 van het 100-byte-record van DAT_05d4790c, of "Not loaded" (de EXE-tekst op 0x8b8698) als het eerste woord 0 is; aantal DAT_05d47909); een klik is FUN_00458bf8 -> FUN_00458d15(slot): alleen als geen script loopt (DAT_05d47908 != 1) wordt het slot gestart (of in de rij gezet als er al een gekozen is). Anders dan de aanroep van de zones (FUN_0045c40c) wordt variabele 0xb (spel gestart vanuit het menu) hier niet getest.');
    blockEl.append(intro);
    if (!run) { blockEl.append(note('Geen zone actief: open dit onderdeel in een draaiende zone (bijvoorbeeld ?zone=z02LGI&debug=1) om de slots van die zone te kiezen.')); return blockEl; }
    const host = run.cutscene, runner = host.runner;
    const names = runnerSlots(runner);
    const tgt = f9Target(runner, run.world.vars);
    const notLoaded = (() => { try { return sh.pe.cstr(F9_NOT_LOADED_VA); } catch { return 'Not loaded'; } })();
    const rows = f9List(names, notLoaded);
    const insp = runner.inspect();
    blockEl.append(bar(badge(`zone ${run.info.id}`, 'info'), badge(`${rows.length} slot${rows.length === 1 ? '' : 's'} (DAT_05d47909)`), badge(tgt.running ? `script loopt: ${names[runner.currentSlot] ?? runner.currentSlot}` : host.active() ? 'manager vastgehouden (FUN_0045c456)' : 'geen script loopt', tgt.running ? 'warn' : 'ok'),
      insp.queued >= 0 ? badge(`in de rij: slot ${insp.queued}`, 'warn') : null, btn('Lijst verversen', () => { zoneSig = ''; refreshZone(); }, 'FUN_004013d0 / de knop Update (0x3f3)')));
    if (rows.length === 0) blockEl.append(note('Deze zone heeft geen cutscene-slots (FUN_0045c310 wordt door haar set-up niet aangeroepen).'));
    else {
      const t = table(['Slot', 'Lijstregel', 'Script', ''], rows.map((r, i) => {
        return [String(i), r, names[i] === null ? badge('niet geladen', 'warn') : badge('geladen', 'ok'), btn('Kies', () => {
          const res = f9Choose(tgt, i);
          c.toast(res === 'gestart' ? `slot ${i} (${r}) gestart` : res === 'bezig' ? 'er loopt al een script: FUN_00458bf8 doet niets' : res === 'buiten-lijst' ? 'slot buiten de lijst' : `slot ${i} (${r}): gekozen maar niet gestart (in de rij of leeg script)`);
          if (res === 'gestart') c.close();
          zoneSig = '';
        }, 'FUN_00458bf8(i): start het slot als er geen script loopt')];
      }));
      blockEl.append(t);
    }
    return blockEl;
  };
  const refreshZone = () => {
    const run = zoneRun(c);
    const sig = !run ? 'geen' : `${run.info.id}|${runnerSlots(run.cutscene.runner).join(',')}|${run.cutscene.active()}|${run.cutscene.runner.currentSlot}|${run.cutscene.runner.inspect().queued}`;
    if (sig === zoneSig) return;
    zoneSig = sig;
    zoneBox.replaceChildren(f9());
  };
  refreshers.push(refreshZone);

  // ------------------------------------------------------------------------------------------------------------ B..E: built when the data is there
  const body = h('div', {});
  const buildBody = (d: SceneData) => {
    built = true;
    body.replaceChildren();
    const run0 = () => zoneRun(c);
    const cutRows = d.rows;
    const scripts = cutRows.filter((r) => r.hasCut);
    const srcOnly = cutRows.filter((r) => !r.hasCut);
    const ctxOf = () => {
      const run = run0();
      const live = run ? new Set(runnerSlots(run.cutscene.runner).filter((n): n is string => !!n).map((n) => n.toLowerCase())) : undefined;
      return { liveSlots: live, unsaidBy: d.unsaidBy };
    };

    // ---------------------------------------------------------------------------------------------------- B. gallery
    const unref = scripts.filter((r) => !r.exeNamed);
    const empties = scripts.filter((r) => r.commands === 0);
    const exp = (n: number, e: number) => badge(`${n} (onderzoek: ${e})`, n === e ? 'ok' : 'warn');
    const stats = block('Wat er is berekend',
      bar(badge(`${scripts.length} gecompileerde scripts (.cut)`), exp(scripts.length, 87), badge(`${srcOnly.length} bronnen zonder .cut`), badge(`${new Set(cutRows.map((r) => r.archive)).size} archieven`)),
      bar('niet gerefereerd (geen EXE-tekst met de scriptnaam): ', badge(unref.map((r) => r.name).join(', ') || 'geen', 'warn'), h('span', { className: 'dc-note', textContent: 'verwacht: adv06 (de "TRexCommunication"-ontwerpversie)' })),
      bar('leeg (0 commando\'s): ', badge(empties.map((r) => r.name).join(', ') || 'geen', 'warn'), h('span', { className: 'dc-note', textContent: 'de lege eilandslots LGICI05 / 06 / 07 (era 0); LGI11 (era 3) is niet leeg maar wordt volgens het onderzoek ook nooit gestart (niet berekend)' })),
      bar('opgenomen maar nooit gezegd: ', d.unsaidError ? badge(`niet beschikbaar: ${d.unsaidError}`, 'warn') : exp(d.unsaid.length, 13)),
      note('"gerefereerd" = de EXE bevat de scriptnaam als tekenreeks (de zone-set-ups geven de naam als letterlijke tekst aan FUN_0045c397) of de slottabel van de lopende zone declareert hem. Een script dat de EXE noemt maar dat geen code start (de lege eilandslots) is dus wel "gerefereerd"; "nooit gestart" komt uit het onderzoek (de set-up declareert de slots, geen aanroep van FUN_0045c40c gebruikt ze).'));

    const filterMode = h('select', { className: 'dc-select' },
      h('option', { value: 'alles', textContent: 'alles' }), h('option', { value: 'scripts', textContent: 'alleen .cut-scripts' }), h('option', { value: 'niet', textContent: 'niet gerefereerd' }),
      h('option', { value: 'leeg', textContent: 'leeg script' }), h('option', { value: 'nooit', textContent: 'met nooit getoonde regels' }), h('option', { value: 'bron', textContent: 'alleen bron (.txt zonder .cut)' }));
    let q = '';
    const detail = h('div', {});
    let selKey = '';
    const gallery = new PagedList<CutRow>([
      { head: 'Archief', cell: (r) => r.archive },
      { head: 'Script', cell: (r) => h('b', { textContent: r.name }) },
      { head: 'Cmd', cell: (r) => (r.hasCut ? String(r.commands) : '-'), cls: 'num' },
      { head: 'Regels', cell: (r) => (r.hasCut ? String(r.sayCount) : '-'), cls: 'num' },
      { head: 'Merken', cell: (r) => h('span', {}, ...badgesOf(r, ctxOf()).map(mk)) },
      { head: '', cell: (r) => btn('Bekijk', () => { selKey = r.key; showScript(r); gallery.el.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel')); }, 'commando\'s, berichten, afspelen') },
    ], 60, (r) => (r.key === selKey ? 'sel' : ''), 'Niets gevonden.');
    const matches = (r: CutRow) => {
      const m = filterMode.value, bs = badgesOf(r, ctxOf());
      if (m === 'scripts' && !r.hasCut) return false;
      if (m === 'niet' && !bs.some((b) => b.text === 'niet gerefereerd')) return false;
      if (m === 'leeg' && !(r.hasCut && r.commands === 0)) return false;
      if (m === 'nooit' && !(d.unsaidBy.get(r.name.toLowerCase()) ?? 0)) return false;
      if (m === 'bron' && r.hasCut) return false;
      return !q || `${r.archive} ${r.name} ${r.scriptName} ${r.actors.join(' ')} ${r.textIds.join(' ')}`.toLowerCase().includes(q);
    };
    const applyGallery = () => gallery.setItems(cutRows.filter(matches));
    filterMode.onchange = applyGallery;
    const search = filterBox('zoek op archief, naam, acteur of regel-id', (s) => { q = s; applyGallery(); });
    applyGallery();
    refreshers.push(() => { /* badges of the live slots: rebuilt on filter / refresh only */ });

    const galleryBlock = block('Cutscene-galerij',
      note('Elke rij is een script van een archief. "Bekijk" toont de commando\'s (leesbaar), de berichttabel van het script en de afspeelknoppen. Een script van een andere zone draait op een neutraal toneel (eigen lege wereld met plaatsvervangende acteurs): zie het kader bij het afspelen voor wat daar wel en niet werkt.'),
      bar(search, filterMode, btn('Lijst verversen', applyGallery, 'merken van de lopende zone opnieuw berekenen')), gallery.el, detail);

    // ---------------------------------------------------------------------------------------------------- detail of one script
    let stage: Stage | null = null;
    let stageTimer = 0;
    const stopStage = () => { if (stageTimer) { clearInterval(stageTimer); stageTimer = 0; } if (stage) { stage.stop(); } };
    const showScript = (r: CutRow) => {
      stopStage(); stage = null;
      const arc = d.cutArchives.get(r.archive)!;
      const bs = badgesOf(r, ctxOf());
      const head = block(`${r.archive} / ${r.name}${r.hasCut ? '' : '.txt'}`,
        bar(...bs.map(mk), r.hasCut ? h('span', { className: 'dc-note', textContent: `SCRIPTENAME ${r.scriptName}, ${r.commands} commando's (kop: ${r.declared} regels), ${r.sayCount} SAYTEXT, ${r.splines.length} splines, acteurs: ${r.actors.join(' ') || '-'}` }) : h('span', { className: 'dc-note', textContent: `bron ${r.txtPath}` })));
      const kids: Node[] = [head];
      let cut: Cutscene | null = null;
      if (r.hasCut) { try { cut = parseCutscene(arc.read(arc.find(r.cutPath)!)); } catch (e) { kids.push(note(`kan het script niet lezen: ${e instanceof Error ? e.message : e}`)); } }

      // messages: the table of this script
      const pick = pickStrings(r.name, r.textIds, d.strFiles);
      const strFile = pick.file;
      const lines = strFile ? d.strLines.get(strFile.path.toLowerCase()) ?? [] : [];
      const said = new Set(r.textIds);
      const unsaidIds = new Set(d.unsaid.filter((e) => e.file === strFile?.path).map((e) => e.tag));

      // play controls
      const out = h('div', {});
      const run = run0();
      const own = !!run && r.hasCut && sameArchive(r.archive, run.archive.name);
      const bPlace = btn('Afspelen in deze zone', () => { void playInPlace(r, out); }, own ? 'de echte manager van de lopende zone (F9-regels: ook zonder de menu-vlag 0xb)' : 'alleen voor scripts van de lopende zone');
      if (!own) { bPlace.disabled = true; bPlace.classList.add('off'); bPlace.title = run ? `dit script hoort bij ${r.archive}, de lopende zone is ${run.archive.name}` : 'geen zone actief'; }
      const bStage = btn('Afspelen op neutraal toneel', () => { void playOnStage(r, cut, pick, out); }, 'eigen lege wereld met plaatsvervangende acteurs');
      let blocked = '';
      if (!r.hasCut) blocked = 'er is geen compileerd script (.cut): alleen de bron staat in het archief, het spel kan het niet laden';
      else if (r.commands === 0) blocked = 'het script heeft geen enkel commando: de manager selecteert het slot en loopt niet (FUN_00458d15: de commandolijst van een leeg script is een nulpointer)';
      if (blocked) { bStage.disabled = true; bStage.classList.add('off'); bPlace.disabled = true; bPlace.classList.add('off'); }
      kids.push(bar(bPlace, bStage, btn('Stop', () => { stopStage(); const rr = run0(); if (rr && own) rr.cutscene.abort(); out.dataset.state = 'stop'; }, 'stopt het toneel of de manager van de zone')));
      if (blocked) kids.push(note(`Kan niet op een neutraal toneel draaien: ${blocked}. De commando's en regels staan hieronder.`));
      kids.push(out);

      if (cut) {
        const l = listing(cut);
        kids.push(block(`Commando's (${l.length})`, note('wacht op N = het commando start pas als geen lopend commando nog N als meldid heeft (FUN_00459119); meldt N = het geeft N vrij als het klaar is; +x s = vertraging.'),
          table(['#', 'Wacht', 'Vertr.', 'Acteur', 'Commando', 'Argumenten', 'Meldt'], l.map((x) => {
            const e = x.textId ? lines.find((y) => y.tag === x.textId) : null;
            return [String(x.index), x.wait, x.delay, x.actor, x.command, h('span', {}, x.args, e ? h('span', { className: 'dc-note', textContent: `  "${e.text.slice(0, 70)}"` }) : null), x.signal];
          }))));
      }

      // the message table
      const msg = block(strFile ? `Berichttabel ${strFile.path} (${lines.length} regels)` : 'Berichttabel');
      if (!r.hasCut) msg.append(note('Zonder .cut is er geen tabel gekoppeld.'));
      else if (r.textIds.length === 0) msg.append(note('Dit script zegt niets (geen SAYTEXT).'));
      else if (!strFile) msg.append(note(`Geen berichtbestand bevat de regels van dit script (${r.textIds.join(', ')}): de EXE heeft geen tabel voor ${r.name} (ADV06.str ontbreekt).`));
      else {
        msg.append(note(`Gekozen op ${pick.how}${pick.how === 'beste treffer' ? ' (de slottabel die dit script met een ander bestand koppelt is niet bekend; de port neemt het bestand dat de regels van het script bevat)' : ''}. "nooit getoond" = tekst en stem bestaan maar geen script zegt de regel (8.7).`));
        msg.append(table(['Tag', 'Tekst', 'Stem', 'Status', ''], lines.map((e) => {
          const st: Node[] = [];
          if (said.has(e.tag)) st.push(badge('gezegd door dit script', 'ok'));
          else if (unsaidIds.has(e.tag)) st.push(badge('nooit getoond', 'red'));
          else st.push(badge('niet in dit script', ''));
          if (e.shadowed) st.push(badge('schaduw-duplicaat', 'warn'));
          const src = e.clip ? { kind: 'speech' as const, id: e.clip, label: `${e.tag} (${e.clip})` } : null;
          return [e.tag, h('span', { className: 'dc-tx', textContent: e.text }), e.clip || '-', h('span', {}, ...st), src ? h('span', {}, playBtn(jb, src, e.clipFile ? '' : 'het audiobestand ontbreekt'), playStatus(src)) : null];
        })));
      }
      kids.push(msg);

      // source text
      if (r.hasTxt) {
        const pre = h('pre', { className: 'dc-mono dc-note', style: 'white-space:pre-wrap;max-height:260px;overflow:auto;margin:4px 0', textContent: latin1Text(arc.read(arc.find(r.txtPath)!)) });
        pre.style.display = 'none';
        const tb = btn('Bron (.txt) tonen / verbergen', () => { pre.style.display = pre.style.display === 'none' ? '' : 'none'; });
        kids.push(bar(tb), pre);
      }
      detail.replaceChildren(...kids);
      syncPlayers(jb, detail);
    };

    // ---------------------------------------------------------------------------------------------------- play in the zone
    const playInPlace = async (r: CutRow, out: HTMLElement) => {
      const run = run0();
      if (!run) { out.replaceChildren(note('Geen zone actief.')); return; }
      const host = run.cutscene, runner = host.runner;
      let idx = runnerSlots(runner).findIndex((n) => n?.toLowerCase() === r.name.toLowerCase());
      let how = `slot ${idx} van de zone`;
      try {
        if (idx < 0) {
          // a script no slot of the zone names (adv06, csi02a ...): an extra slot behind the zone's own (the manager's slot array grows; the zone's slot numbers do not change)
          const arc = d.cutArchives.get(r.archive)!;
          const cut = parseCutscene(arc.read(arc.find(r.cutPath)!));
          idx = runner.slotCount;
          runner.define(idx, r.name, cut);
          const pick = pickStrings(r.name, r.textIds, d.strFiles);
          const priv = host as unknown as { tables?: Map<number, unknown>; loadSplines?(c: Cutscene): Promise<void> };
          if (pick.file) priv.tables?.set(idx, loadMessages(await sh.data.archive('messages'), [pick.file.path]));
          await priv.loadSplines?.(cut);
          how = `extra slot ${idx} (geen slot van de zone noemt dit script)`;
        }
        const res = f9Choose(f9Target(runner, run.world.vars), idx);
        out.replaceChildren(note(`${r.name}: ${how}: ${res === 'gestart' ? 'gestart in de zone; het paneel sluit zodat je het ziet' : res === 'bezig' ? 'er loopt al een script' : 'niet gestart (in de rij of leeg)'}.`));
        if (res === 'gestart') c.close();
      } catch (e) { out.replaceChildren(note(`Afspelen in de zone mislukt: ${e instanceof Error ? e.message : e}`)); }
    };

    // ---------------------------------------------------------------------------------------------------- neutral stage
    const plot = h('canvas', { width: 560, height: 340, style: 'background:#050a18;border:1px solid #243566;max-width:100%' });
    const stageInfo = h('pre', { className: 'dc-mono dc-note', style: 'white-space:pre-wrap;margin:4px 0' });
    const playOnStage = async (r: CutRow, cut: Cutscene | null, pick: ReturnType<typeof pickStrings>, out: HTMLElement) => {
      stopStage(); stage = null;
      if (!cut) return;
      const spec = { slot: 0, zone: r.archive, script: r.name, strings: pick.file?.stem ?? r.name, area: pick.file?.area ?? 'li', actors: scriptActors(cut) };
      out.replaceChildren(note(`Toneel opbouwen (${r.archive}: script, berichttabel, splines) ...`));
      try { stage = await Stage.create(sh, spec); } catch (e) { out.replaceChildren(note(`Kan niet op een neutraal toneel draaien: ${e instanceof Error ? e.message : e}`)); return; }
      const st = stage;
      const speed = h('select', { className: 'dc-select' }, ...[1, 4, 16].map((n) => h('option', { value: String(n), textContent: `x${n}` })));
      const stat = h('div', {});
      out.replaceChildren(
        block('Neutraal toneel',
          note(`Lege wereld met ${spec.actors.length} plaatsvervangers (${spec.actors.join(' ') || 'geen acteurs'}) op een ring van 6 eenheden om de oorsprong; de echte manager draait het script. Wat hier WEL werkt: de planning (wacht- / meldid's, vertragingen), camera-commando's (waypoints van de W_CSM / W_PATH-kaarten van ${r.archive}, splines), SETPOSITION van acteurs, SETSWITCH (variabelen van het toneel), SETFOV, tekst en stem (via de spraakspeler van het spel; berichttabel ${pick.file ? pick.file.path : 'ontbreekt: geen tekst'}). Wat NIET werkt: de geometrie en modellen van de zone (bovenaanzicht in plaats van een 3D-beeld), animaties (SETANIM doet niets), loopcommando's van acteurs (geen lopers) en de schakelaarwoordenboeken van de zone (onbekende namen worden gemeld).${pick.how === 'beste treffer' ? ` De berichttabel is gekozen op beste treffer (${pick.file?.path}).` : pick.how === 'geen' && r.textIds.length ? ' Er is geen berichtbestand voor dit script: de regels tonen hun id en hebben geen stem.' : ''}`),
          bar(btn('Afspelen', () => { st.resetCamera(); st.start(); run(); }, 'start het script opnieuw'), btn('Stop', () => { st.stop(); }), btn('Overslaan (Shift)', () => st.skipNow(), 'de Shift-toets van het spel'), 'snelheid:', speed),
          bar(check('spraak aan', () => st.speechOn, (v) => { st.speechOn = v; }, 'uit: een regel is meteen klaar (opties van het spel)').el, check('ondertitels aan', () => st.textOn, (v) => { st.textOn = v; }, 'bepaalt de minimale duur van een regel').el),
          plot, stat, stageInfo));
      const draw = () => drawPlot(plot, st);
      const run = () => {
        if (stageTimer) clearInterval(stageTimer);
        // the stage's pass pacing is the loops' (`FrameClock`): the timer's own frame time feeds the step time; the fast-forward steps (x4, x16) are nominal 60 Hz passes
        const clock = new FrameClock(performance.now());
        stageTimer = window.setInterval(() => {
          const els = clock.take(performance.now());
          for (const el of els) { st.step(el); for (let i = 1; i < Number(speed.value); i++) st.step(); }
          draw();
          const rep = st.report(), sub = st.host.runner.subtitle;
          stat.textContent = `${st.active ? 'loopt' : st.finished ? 'klaar' : 'gestopt'}   tick ${rep.ticks} (${rep.seconds.toFixed(1)} s)   commando's klaar ${rep.finished} / ${rep.total}${rep.dead ? `, nooit gestart ${rep.dead}` : ''}${sub ? `\nondertitel: ${sub.text}` : ''}`;
          stageInfo.textContent = rep.log.length ? `melding${rep.log.length === 1 ? '' : 'en'} van de manager:\n${[...new Set(rep.log)].slice(0, 12).join('\n')}` : '';
          if (!st.active) { clearInterval(stageTimer); stageTimer = 0; draw(); }
        }, 1000 / 60);
      };
      st.start();
      run();
    };

    // ---------------------------------------------------------------------------------------------------- C. never said
    const unsaidBlock = block(`Opgenomen maar nooit gezegd (${d.unsaid.length})`,
      note('Regels met tekst en een stemfragment die geen enkel script zegt (unused.md 8.7: 13). Berekend door de tekst-analyse van onderdeel 9 (de berichttabel van een script, een stemfragment, geen SAYTEXT in een .cut).'),
      d.unsaid.length ? table(['Tag', 'Bestand', 'Tekst', 'Stem', ''], d.unsaid.map((e) => {
        const src = { kind: 'speech' as const, id: e.clip, label: `${e.tag} (${e.clip})` };
        return [badge(e.tag, 'red'), e.file, h('span', { className: 'dc-tx', textContent: e.text }), e.clip, h('span', {}, playBtn(jb, src, e.clipFile ? '' : 'audiobestand ontbreekt'), playStatus(src))];
      })) : note(d.unsaidError ? `Niet beschikbaar: ${d.unsaidError}` : 'Geen.'));

    // ---------------------------------------------------------------------------------------------------- D. .man paths
    const S = flyState(c);
    const holdHook = holder(c);
    const infoCache = new Map<string, { man: ReturnType<typeof readMan>; info: ManInfo | null }>();
    const manArchive = async (name: string) => d.cutArchives.get(name) ?? sh.data.archive(name);
    const manData = async (r: ManRow) => {
      let e = infoCache.get(r.key);
      if (!e) {
        const arc = await manArchive(r.archive);
        const man = readMan(arc, r.path);
        e = { man, info: man ? manInfo(r.name, man) : null };
        infoCache.set(r.key, e);
      }
      return e;
    };
    const refBadge = (r: ManRow) => (r.ref === null ? badge('niet gerefereerd', 'warn') : r.ref === 'naam' ? badge('alleen naam (zwak)', '') : badge(r.ref === 'exe-pad' ? 'gerefereerd: EXE-pad' : 'gerefereerd: script', 'ok'));
    let manMode = 'niet', mq = '';
    const manFilter = h('select', { className: 'dc-select' },
      h('option', { value: 'niet', textContent: 'niet gerefereerd' }), h('option', { value: 'alles', textContent: 'alles' }), h('option', { value: 'zwak', textContent: 'alleen naam (zwak)' }), h('option', { value: 'gerefereerd', textContent: 'gerefereerd (EXE-pad / script)' }));
    const manSel = { key: '' };
    const fly = h('div', {});
    const manList = new PagedList<ManRow>([
      { head: 'Archief', cell: (r) => r.archive },
      { head: 'Pad', cell: (r) => h('b', { textContent: r.name }) },
      { head: 'Soort', cell: (r) => { const s = h('span', { textContent: '...' }); void manData(r).then((e) => { s.textContent = e.info ? MAN_KIND_LABEL[e.info.kind] : 'onleesbaar'; }); return s; } },
      { head: 'Sleutels', cell: (r) => { const s = h('span', { textContent: '...' }); void manData(r).then((e) => { s.textContent = e.info ? String(e.info.keys) : '-'; }); return s; }, cls: 'num' },
      { head: 'Duur', cell: (r) => { const s = h('span', { textContent: '...' }); void manData(r).then((e) => { s.textContent = e.info ? `${f1(e.info.seconds)} s` : '-'; }); return s; }, cls: 'num' },
      { head: 'Gerefereerd', cell: (r) => refBadge(r) },
      { head: '', cell: (r) => btn('Kies', () => { manSel.key = r.key; void showMan(r); }, 'details en vliegen') },
    ], 40, (r) => (r.key === manSel.key ? 'sel' : ''), 'Niets gevonden.');
    const applyMan = () => manList.setItems(d.files.man.filter((r) => {
      if (manMode === 'niet' && r.ref !== null) return false;
      if (manMode === 'zwak' && r.ref !== 'naam') return false;
      if (manMode === 'gerefereerd' && !(r.ref === 'exe-pad' || r.ref === 'script')) return false;
      return !mq || `${r.archive} ${r.name}`.toLowerCase().includes(mq);
    }));
    manFilter.onchange = () => { manMode = manFilter.value; applyMan(); };
    const manSearch = filterBox('zoek op archief of naam', (s) => { mq = s; applyMan(); });
    applyMan();
    const cnt = (ref: ManRow['ref'], a?: string) => d.files.man.filter((r) => r.ref === ref && (!a || r.archive === a)).length;
    const unrefBy = (a: string) => cnt(null, a);

    const flyReadout = h('div', { className: 'dc-mono dc-note' });
    const slider = h('input', { type: 'range', min: '0', max: '1000', value: '0', style: 'width:260px' });
    let curPath: ReturnType<typeof makeFlyPath> | null = S.path;
    const showMan = async (r: ManRow) => {
      fly.replaceChildren(note('Pad lezen ...'));
      let e;
      try { e = await manData(r); } catch (err) { fly.replaceChildren(note(`kan ${r.archive} niet laden: ${err instanceof Error ? err.message : err}`)); return; }
      if (!e.man || !e.info) { fly.replaceChildren(note('Dit pad kan niet worden gelezen.')); return; }
      const info = e.info, arc = await manArchive(r.archive);
      const have = new Set(arc.entries.filter((x) => /\.man$/i.test(x.path)).map((x) => /([^/]+)\.man$/i.exec(x.path)![1].toLowerCase()));
      const pname = info.kind === 'camera' ? targetPartner(r.name, have) : null;
      const partner = pname ? (() => { const pr = d.files.man.find((x) => x.archive === r.archive && x.name.toLowerCase() === pname); const m = pr ? readMan(arc, pr.path) : null; return m && pr ? { name: pr.name, man: m } : null; })() : null;
      const path = makeFlyPath(r.archive, r.name, e.man, partner);
      curPath = path; S.path = path; S.mode = defaultMode(path.kind); S.p = 0;
      const f = (v: number[]) => v.map((x) => f1(x)).join(', ');
      const kids: Node[] = [block(`${r.archive} / ${r.name}.man`,
        bar(badge(MAN_KIND_LABEL[info.kind], 'info'), refBadge(r), badge(`${info.keys} sleutels (${info.stored} opgeslagen)`), badge(`${f1(info.seconds)} s bij 30 Hz`), badge(`lengte ${f1(info.length)}`), info.tracks > 1 ? badge(`${info.tracks} sporen: alleen spoor 0`, 'warn') : null),
        note(`Referentie: ${r.ref ? MAN_REF_LABEL[r.ref] : 'geen: noch een EXE-tekenreeks, noch de bron van een gebruikt script noemt dit pad'}. Soort is de naamgeving (cam = camerapad, targ = kijkpunt) en dus bij benadering: de bestanden zelf zijn anonieme matrixsporen.`),
        h('div', { className: 'dc-mono dc-note', textContent: `begin ${f(info.start)}   eind ${f(info.end)}\nondergrens ${f(info.min)}   bovengrens ${f(info.max)}${partner ? `\nkijkpunt-pad: ${partner.name}` : info.kind === 'camera' ? '\nkijkpunt-pad: geen partner gevonden (het kijkpunt volgt het pad vooruit, bij benadering)' : ''}`, style: 'white-space:pre' }))];
      const mode = h('select', { className: 'dc-select' }, h('option', { value: 'camera', textContent: 'camerapad: oog langs het pad' }), h('option', { value: 'volg', textContent: 'voorwerppad: camera volgt (uitbreiding)' }));
      mode.value = S.mode;
      mode.onchange = () => { S.mode = mode.value as FlyMode; holdHook.cur?.apply(); };
      const speed = h('select', { className: 'dc-select' }, ...[0.25, 0.5, 1, 2, 4].map((n) => h('option', { value: String(n), textContent: `x${n}` })));
      speed.value = String(S.speed);
      speed.onchange = () => { S.speed = Number(speed.value); };
      const showCk = check('Pad tekenen in de wereld', () => S.show, (v) => { S.show = v; });
      const loopCk = check('herhalen', () => S.loop, (v) => { S.loop = v; });
      const stillCk = check('Pepper stilzetten (uitbreiding)', () => S.still, (v) => { S.still = v; }, 'het spel ziet de pijltoetsen niet zolang je vliegt');
      slider.oninput = () => { S.p = Number(slider.value) / 1000; holdHook.cur?.apply(); };
      const zr = zoneRun(c);
      kids.push(block('Vlieg de camera langs dit pad',
        note(`De camera wordt elke tick door de lopende zone overschreven (RunHook.afterSim) zolang het paneel dicht is; het pad staat in wereldcoördinaten zoals opgeslagen. ${zr ? (sameArchive(r.archive, zr.archive.name) ? `Dit pad hoort bij ${r.archive}: de lopende zone.` : `LET OP: dit pad hoort bij ${r.archive}, de lopende zone is ${zr.archive.name}: het pad ligt ten opzichte van de oorsprong van de wereld van die zone.`) : 'Er is geen zone actief: start een zone (de eilandzone z02LGI voor de eilandpaden) om te vliegen.'} Speelbaar: camerapaden (oog langs het pad; het kijkpunt volgt het partnerpad of het pad vooruit), alle andere soorten alleen als voorwerppad met een volgcamera (14 erachter, 5 erboven: uitbreiding); bij meerdere sporen alleen spoor 0. Niet te spelen: de animatie van een record zelf (de paden van voorwerpen worden hier niet op een record gezet).`),
        bar(btn('Vlieg langs dit pad', () => { const k = holdHook.cur; if (!k) { c.toast('Geen zone actief: start eerst een zone'); return; } S.p = 0; k.start(0); c.toast(`camera vliegt langs ${path.label}; sluit het paneel (of zet "spel pauzeren" uit)`); }, 'start bij het begin'),
          btn('Hervat', () => { const k = holdHook.cur; if (!k) { c.toast('Geen zone actief'); return; } k.start(S.p); }, 'verder vanaf de huidige voortgang'),
          btn('Stop, camera terug', () => { holdHook.cur?.stop(); }, 'herstelt de volgcamera'), mode, 'snelheid:', speed),
        bar(showCk.el, loopCk.el, stillCk.el), bar('voortgang', slider, flyReadout)));
      fly.replaceChildren(...kids);
      refreshFly();
      manList.el.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel'));
    };
    const refreshFly = () => {
      const k = holdHook.cur;
      slider.value = String(Math.round(S.p * 1000));
      const p = curPath;
      if (!p) { flyReadout.textContent = ''; return; }
      const v = viewAt(p, S.p, S.mode);
      flyReadout.textContent = `${S.flying ? 'vliegt' : 'staat stil'}  p ${(S.p * 100).toFixed(1)} %  ${(S.p * p.count / 30).toFixed(1)} / ${(p.count / 30).toFixed(1)} s  oog ${v.eye.map((x) => f1(x)).join(', ')}  doel ${v.target.map((x) => f1(x)).join(', ')}${k ? '' : '  (geen zone)'}`;
    };
    refreshers.push(refreshFly);

    const manBlock = block(`Animatiepaden (.man): ${d.files.man.length} in ${new Set(d.files.man.map((r) => r.archive)).size} archieven`,
      bar(badge(`niet gerefereerd: ${cnt(null)}`, 'warn'), badge(`z02LGI ${unrefBy('z02LGI')} / z40OGL ${unrefBy('z40OGL')} / z40aPO ${unrefBy('z40aPO')}`), h('span', { className: 'dc-note', textContent: 'onderzoek (7.4): 76 + 5 + 1' }),
        badge(`alleen naam (zwak): ${cnt('naam')}`), badge(`EXE-pad: ${cnt('exe-pad')}`, 'ok'), badge(`script: ${cnt('script')}`, 'ok')),
      note('Regel van het onderzoek: "gerefereerd" = de naam van het bestand komt als tekst voor in een EXE-tekenreeks of in de bron van een gebruikt script (ook uitgecommentarieerd, ook als deelstring: zwak); sterker bewijs is het volledige pad in de EXE of een spline-doel in een gebruikt compileerd script. De rest is "niet gerefereerd".'),
      bar(manSearch, manFilter), manList.el, fly);

    // ---------------------------------------------------------------------------------------------------- E. empty slots, editor leftovers
    const camUn = d.files.cam.filter((r) => r.ref === null);
    const byArc = new Map<string, string[]>();
    for (const r of camUn) { const l = byArc.get(r.archive) ?? []; l.push(r.name); byArc.set(r.archive, l); }
    const names = new Map<string, number>();
    for (const r of camUn) names.set(r.name, (names.get(r.name) ?? 0) + 1);
    const leftBlock = block('Lege slots en editor-resten (alleen lijsten)',
      bar(badge(`lege scripts: ${empties.map((r) => `${r.archive}/${r.name}`).join(', ') || 'geen'}`, 'warn'), badge('nooit gestart (onderzoek): LGICI05, LGICI06, LGICI07, LGI11', 'warn')),
      note('De eilandslots LGICI05 / 06 / 07 (era 0: lege scripts, geen .str) en LGI11 (era 3) worden volgens unused.md 8.7 door de set-up gedeclareerd maar nooit gestart; de lege scripts zijn hier berekend, "nooit gestart" is het onderzoek (niet berekend, onzeker). csi03 bestaat alleen als .txt met "NO LONGER USED"; 53 .txt-bronnen hebben geen .cut (PlayStation-varianten "...psx" en kleine stubs: zie het filter "alleen bron").'),
      bar(badge(`.cam-bestanden: ${d.files.cam.length}`), badge(`niet gerefereerd: ${camUn.length}`, 'warn'), h('span', { className: 'dc-note', textContent: 'onderzoek: 50 van 141 zijn editorresten (Maya-camera\'s persp / front1 / side1 / camera1 ...); geen enkele wordt geladen' })),
      h('div', { className: 'dc-mono dc-note', style: 'white-space:pre-wrap', textContent: `per naam: ${[...names].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} x${k}`).join(', ')}\nper archief: ${[...byArc].map(([a, l]) => `${a} (${l.join(' ')})`).join('; ')}` }),
      note('De andere 91 .cam-bestanden (front / side / top ...) tellen als "gerefereerd" door de deelstring-regel (een woord als "front" komt in veel EXE-teksten voor): dat is zwak bewijs, ook geen van deze wordt door de code geladen.'));

    body.append(stats, galleryBlock, unsaidBlock, manBlock, leftBlock);
  };

  const tryBuild = () => { if (!built && load.data) { try { buildBody(load.data); } catch (e) { console.error('scenes', e); body.replaceChildren(note(`Fout bij het opbouwen: ${e instanceof Error ? e.message : e}`)); } } };
  load.promise.then(() => { tryBuild(); status.textContent = ''; }, () => { status.textContent = `Laden mislukt: ${load.error}`; });
  root.append(zoneBox, body);
  refreshZone();
  return {
    el: root,
    show() { tryBuild(); refreshers.forEach((f) => f()); },
    refresh() { refreshers.forEach((f) => f()); pb.update(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------- the stage's top-down plot

function drawPlot(cv: HTMLCanvasElement, st: Stage) {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const pts = [...st.eyeTrail, ...st.tgtTrail, ...st.actors.map((a) => [a.x, a.y, a.z] as [number, number, number])];
  if (!pts.length) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  const pad = 14, sx = (W - 2 * pad) / Math.max(x1 - x0, 1), sz = (H - 2 * pad) / Math.max(z1 - z0, 1), s = Math.min(sx, sz);
  const X = (x: number) => pad + (x - x0) * s, Z = (z: number) => H - pad - (z - z0) * s;
  const trail = (t: number[][], col: string) => { g.strokeStyle = col; g.beginPath(); t.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[2])) : g.moveTo(X(p[0]), Z(p[2])))); g.stroke(); };
  trail(st.eyeTrail, '#ffd400'); trail(st.tgtTrail, '#ff4fd0');
  g.font = '10px monospace';
  for (const a of st.actors) { g.fillStyle = '#6fd0ff'; g.fillRect(X(a.x) - 3, Z(a.z) - 3, 6, 6); g.fillText(a.name, X(a.x) + 5, Z(a.z) - 4); }
  const e = st.eyeTrail[st.eyeTrail.length - 1], t = st.tgtTrail[st.tgtTrail.length - 1];
  if (e && t) {
    g.strokeStyle = '#4cff6a'; g.beginPath(); g.moveTo(X(e[0]), Z(e[2])); g.lineTo(X(t[0]), Z(t[2])); g.stroke();
    g.fillStyle = '#ffd400'; g.beginPath(); g.arc(X(e[0]), Z(e[2]), 4, 0, 7); g.fill();
    g.fillStyle = '#ff4fd0'; g.beginPath(); g.arc(X(t[0]), Z(t[2]), 3, 0, 7); g.fill();
  }
  g.fillStyle = '#9fb0e0';
  g.fillText(`bovenaanzicht x ${f2(x0)} .. ${f2(x1)}, z ${f2(z0)} .. ${f2(z1)}   geel = oog, roze = kijkpunt, blauw = acteurs`, 6, 11);
}
