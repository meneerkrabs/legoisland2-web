// Restored content, features 'cues' + 'popups' (src/restore/features/cues.ts, popups.ts; docs/re/restore.md): the sound-table patch (flowers), the sound ids / files of every cue, the texts of the popups,
// the cue handlers on fake contexts, the flower node's per-tick calls, the zone files' hook lines (static) and: with the option off nothing changes.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { CUE_SND } from '../../src/restore/features/cues.ts';
import { hudPopup, popupText } from '../../src/restore/popup.ts';
import { FlowerNode } from '../../src/island/pizza/footy.ts';
import { loadZone } from '../lib/engine-load.mjs';
import { VAR, BRONTY } from '../../src/zones/z28hat/rules.ts';
import { prepareHat, hatSounds, hatUpdate } from '../../src/zones/z28hat/game.ts';
import { fx } from '../../src/zones/z28hat/nodes.ts';

const ALL = RESTORE_FEATURES.map((f) => f.id);
const only = (...ids) => ALL.filter((i) => !ids.includes(i));
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, '../..', p), 'utf8');

export default {
  name: 'restore-cues',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exe = new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe')));
    const cleanup = () => { forceRestored(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; };
    const fileOf = (entry) => {   // "_Data\sounds\\z02LGI\GrowBig.wav" -> the file on disk (case-insensitive)
      let dir = ctx.soundsDir;
      for (const part of entry.path.split('\\').filter((x) => x && !/^_data$/i.test(x) && !/^sounds$/i.test(x))) {
        const hit = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.toLowerCase() === part.toLowerCase()) : undefined;
        if (!hit) return null; dir = path.join(dir, hit);
      }
      return dir;
    };

    // ---- option off: the table is the original
    cleanup();
    const base = readAudioTables(exe);
    ok(/silence\.wav$/i.test(base.sounds[0].path) && /silence\.wav$/i.test(base.sounds[2].path), 'original: ids 0 / 2 map to Silence.wav');

    // ---- cues feature on: exactly entries 0 and 2 change
    forceRestored(true, only('cues'));
    ok(await loadRestore(), 'installs');
    const t = readAudioTables(exe);
    ok(/GrowBig\.wav$/i.test(t.sounds[0].path) && /GrowSmll\.wav$/i.test(t.sounds[2].path), 'cues on: ids 0 / 2 -> GrowBig / GrowSmll');
    const diff = t.sounds.filter((e, i) => JSON.stringify(e) !== JSON.stringify(base.sounds[i])).map((e) => e.id);
    ok(diff.join() === '0,2', `cues on: only the flower entries differ (${diff})`);
    for (const n of [0, 2]) { const { path: _p, ...a } = t.sounds[n]; const { path: _q, ...b } = base.sounds[n]; ok(JSON.stringify(a) === JSON.stringify(b), `entry ${n}: volume / distances / rate kept`); }
    for (const [name, id] of Object.entries(CUE_SND)) {
      const e = t.sounds[id];
      ok(!!e && e.id === id, `${name}: id ${id} exists`);
      if (e) { ok(fileOf(e) !== null, `${name} (${id}): file ${e.path} exists in the data`); ok(!/silence\.wav$/i.test(e.path), `${name}: not a silent file`); }
    }
    ok(t.speech.length > 0, 'speech table read');

    // ---- handlers
    const got = [];
    const c = { sfx: (id) => got.push(['sfx', id]), sfxAt: (id, p) => got.push(['at', id, p.join()]), sound: { play: (n) => got.push(['play', n]), at: (n, p) => got.push(['sat', n, p.join()]) } };
    const run = (n, extra = {}) => { got.length = 0; restoreHooks.cue(n, { ...c, ...extra }); return JSON.stringify(got); };
    ok(run('flower-grow') === JSON.stringify([['sfx', 0]]), 'flower-grow -> id 0');
    ok(run('flower-shrink') === JSON.stringify([['sfx', 2]]), 'flower-shrink -> id 2');
    ok(run('rgb-castle-hit', { pos: [1, 2, 3] }) === JSON.stringify([['at', 0x196, '1,2,3']]), 'rgb-castle-hit -> HIT_CASTLE at the point');
    ok(run('rgb-castle-hit') === '[]', 'rgb-castle-hit without a position: nothing');
    ok(run('was-hit', { kind: 'snake' }) === JSON.stringify([['sfx', 0x1c8]]) && run('was-hit', { kind: 'gem' }) === '[]', 'was-hit: bigthump on a snake only');
    ok(run('ssh-tick', { pos: [4, 5, 6] }) === JSON.stringify([['at', 0xbc, '4,5,6']]), 'ssh-tick -> waterfall at the fountain');
    ok(run('hat-freed') === JSON.stringify([['play', 'hatesFinal']]), 'hat-freed -> hatesFinal');
    { const key = {}; const seq = [false, true, true, false, false].map((a) => run('pph-computer', { key, active: a, stop: (id) => got.push(['stop', id]) }));
      ok(seq.join('|') === ['[]', '[["sfx",642],["sfx",644]]', '[["sfx",644]]', '[["stop",644],["sfx",643]]', '[]'].join('|'), `pph-computer: open -> switch on + loop, loop while open, close -> stop + switch off (${seq.join(' ')})`); }
    ok(run('map-medal') === JSON.stringify([['sfx', 0x1dc]]), 'map-medal -> PAPA_CONGRATS');
    ok(run('bip-melon-throw', { pos: [1, 1, 1] }) === JSON.stringify([['sat', 'melonFly', '1,1,1']]) && run('bip-stone-hit', { pos: [2, 2, 2] }) === JSON.stringify([['sat', 'rockHit', '2,2,2']]), 'bip melon / stone');
    ok(run('no-such-event') === '[]' && run('wab-hit') === '[]', 'unknown events and popup events: no sound');
    let threw = false; try { restoreHooks.cue('flower-grow'); } catch { threw = true; }
    ok(!threw, 'cue without ctx does not throw');

    // ---- the flower node calls the cue every tick of the grow / shrink phase (like FUN_005396af), nothing in the hold phase
    const calls = [];
    const orig = restoreHooks.cue;
    restoreHooks.cue = (n, cx) => { calls.push(n); orig(n, cx); };
    const plays = [];
    const w = { dt: 1, frame: 0, vars: { or() {}, andNot() {} }, playSound: (id) => plays.push(id), records: [], ext: new Map() };
    const rec = { m: new Float32Array(16), rx: 0, ry: 0, rz: 0, x: 1, y: 2, z: 3, scale: [1, 1, 1] };
    const node = new FlowerNode({ var: 2, mask: 1, value: 0 });
    node.stamp = w.frame;
    for (let k = 0; k < 268; k++) { w.frame++; node.update(w, rec, null); node.stamp = w.frame + 1; }
    const grow = calls.filter((x) => x === 'flower-grow').length, shrink = calls.filter((x) => x === 'flower-shrink').length;
    ok(grow >= 88 && grow <= 91 && shrink >= 80 && shrink <= 91, `flower node: grow ${grow} / shrink ${shrink} cue calls over one cycle`);
    ok(plays.includes(0) && plays.includes(2), `flower node: the sink got ids 0 and 2 (${[...new Set(plays)]})`);
    restoreHooks.cue = orig;

    // ---- popups feature: texts exist, handlers
    cleanup(); forceRestored(true, only('popups')); await loadRestore();
    const msgs = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const tab = (p) => loadMessages(msgs, [p]);
    const wanted = { 'LI/Data/WAB.str': ['WAB1', 'WAB2', 'WAB3'], 'AI/Data/WAS.str': ['WAS1', 'WAS2'], 'AI/Data/FSH.str': ['FSH5'], 'AI/Data/BIP.str': ['BIP10', 'BIP11', 'BIP14', 'BIP15'] };
    for (const [p, tags] of Object.entries(wanted)) { const tb = tab(p); for (const g of tags) ok((tb.text(g) ?? '').length > 0, `${p} ${g} has a text`); }
    const hud = { extras: [] };
    const strings = tab('LI/Data/WAB.str');
    restoreHooks.cue('wab-hit', { hud, strings });
    ok(popupText(hud) === strings.text('WAB1'), 'wab-hit shows WAB1');
    restoreHooks.cue('wab-info', { hud, strings });
    ok(popupText(hud) === strings.text('WAB3') && hud.extras.length === 1, 'a new popup replaces the old one, one callback per HUD');
    const texts = [];
    const ui = { anchor() {}, text: (f, tx, x, y) => texts.push(tx) };
    hud.extras[0](ui);
    ok(texts.length === 1 && texts[0] === strings.text('WAB3'), 'the HUD callback draws the popup');
    const added = [];
    restoreHooks.cue('fsh-catch', { addPopup: (...a) => added.push(a.join()) });
    ok(added.length === 1 && added[0].startsWith('FSH5,'), 'fsh-catch adds FSH5 to the zone slots');
    const bip = tab('AI/Data/BIP.str'), drawn = [];
    const ui2 = { text: (f, tx) => drawn.push(tx) };
    restoreHooks.cue('bip-banner', { ui: ui2, strings: bip, result: 1 });
    restoreHooks.cue('bip-banner', { ui: ui2, strings: bip, result: 4 });
    restoreHooks.cue('bip-banner', { ui: ui2, strings: bip, result: 0 });
    ok(drawn.join('|') === [bip.text('BIP10'), bip.text('BIP11'), bip.text('BIP14')].join('|'), 'bip-banner: fuel result BIP10 + BIP11, a medal BIP14, nothing for 0');
    const h2 = { extras: [] };
    restoreHooks.cue('bip-lowfuel', { hud: h2, strings: bip });
    ok(popupText(h2) === bip.text('BIP15'), 'bip-lowfuel shows BIP15');
    cleanup();

    // ---- z28HAT on the real nodes: Bronty freed -> hatesFinal plays once with the feature on, never with the option off
    const hatFreed = (on) => {
      cleanup(); if (on) { forceRestored(true, only('cues')); } 
      return (async () => {
        if (on) await loadRestore();
        fx.rumble = 0; fx.fireball.length = 0;
        fx.particles = { start() { return 7; }, setMatrix() {}, on() {}, off() {} };
        const L = loadZone(ctx, 'z28HAT'), sound = hatSounds(null);
        prepareHat(L.world, ctx.archives.find((a) => a.name === 'z28HAT'), sound, undefined);
        L.world.externalInput = false;
        L.world.vars.set(VAR.BRONTY, BRONTY.FREED);
        for (let k = 0; k < 4; k++) { L.world.input.setVirtual(0); L.world.tick(); hatUpdate(L.world); }
        return sound.count('play', 'hatesFinal');
      })();
    };
    const hatOn = await hatFreed(true), hatOff = await hatFreed(false);
    ok(hatOn === 1, `z28HAT: Bronty freed plays hatesFinal once with the feature on (${hatOn})`);
    ok(hatOff === 0, `z28HAT: option off: hatesFinal never plays (${hatOff})`);
    cleanup();

    // ---- every other event is wired in its zone (static: the guarded call exists)
    const wire = { 'src/island/pizza/footy.ts': ['flower-grow', 'flower-shrink'], 'src/zones/z05WAB/game.ts': ["'wab-hit'", "'wab-info'", "'wab-miss'"], 'src/zones/z17was/rules.ts': ["'was-hit'", "'was-miss'"], 'src/zones/z17WAS.ts': ['restoreHooks.cue?.(name'],
      'src/zones/z21fsh/nodes.ts': ['fsh-catch'], 'src/zones/z10rgb/balls.ts': ['rgb-castle-hit'], 'src/zones/z10RGB.ts': ['restoreHooks.cue?.(name'], 'src/zones/z15ssh/rules.ts': ['ssh-tick'], 'src/zones/z28hat/nodes.ts': ['hat-freed'], 'src/zones/z41MAP/game.ts': ['map-medal'], 'src/zones/z03PPH.ts': ['pph-computer'],
      'src/zones/z22bip/monkey.ts': ['bip-melon-throw'], 'src/zones/z22bip/rocky.ts': ['bip-stone-hit'], 'src/zones/z22bip/plane.ts': ['bip-lowfuel', 'bip-outoffuel'], 'src/zones/z22BIP.ts': ['bip-banner', 'restoreHooks.cue?.(name'] };
    for (const [f, needles] of Object.entries(wire)) { const s = read(f); for (const n of needles) ok(s.includes(n), `${f} calls the cue ${n}`); }
    notes.push(`${Object.keys(wire).length} zone files carry hook lines`);
    return { checked, failures, notes };
  },
};
