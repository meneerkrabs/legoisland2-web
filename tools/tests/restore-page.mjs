// Restored content, feature 'page' (src/restore/features/page.ts): the script adv04b of z21FSH (R-A7) compiles, every block can start, the two lines exist (.str, mp3, speech table), the commands only use actors / words / animations
// that adv04 / adv11 of the same zone use. (The wiring into z21FSH / z13CAI is not done: docs/re/restore.md.)
import fs from 'node:fs';
import path from 'node:path';
import { ADV04B_TEXT, adv04bCut, extraCut, PAGE_SCRIPT } from '../../src/restore/features/page.ts';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { readAudioTables } from '../../src/audio/tables.ts';

export default {
  name: 'restore-page',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const arc = ctx.archives.find((a) => a.name.toLowerCase() === 'z21fsh');
    const cut = parseCutscene(adv04bCut());
    ok(cut.commands.length === 11, `adv04b has 11 commands (${cut.commands.length})`);
    ok(extraCut('Z21FSH', 'ADV04B') !== undefined && extraCut('z21FSH', 'adv04') === undefined, 'extraCut gives adv04b only');
    ok(!arc.find('cutscene/adv04b.cut'), 'the archive has no adv04b (the script is new)');
    // blocks
    const sig = new Map();
    for (const c of cut.commands) if (c.signalId) (sig.get(c.signalId) ?? sig.set(c.signalId, []).get(c.signalId)).push(c);
    const blocks = new Set(cut.commands.map((c) => c.waitId)), reach = new Set([0]);
    for (let ch = true; ch;) { ch = false; for (const b of blocks) if (!reach.has(b)) { const q = sig.get(b); if (q && q.every((c) => reach.has(c.waitId))) { reach.add(b); ch = true; } } }
    ok([...blocks].every((b) => reach.has(b)), `every block can start (${[...blocks].join(',')})`);
    ok(cut.commands.filter((c) => c.textId).map((c) => c.textId.toUpperCase()).join() === 'ADCSOA13,ADCSOA14', 'the lines in order: ADCSOA13, ADCSOA14');
    // vocabulary of the same zone
    const read = (n) => cut_of(arc, n);
    const known = { actors: new Set(), anims: new Set(), words: new Set() };
    for (const n of ['adv04', 'adv11']) for (const c of read(n).commands) { known.actors.add(c.actor.toLowerCase()); if (c.anim) known.anims.add(c.anim.toLowerCase()); known.words.add(String(c.name ?? c.command ?? '').toLowerCase()); }
    for (const c of cut.commands) {
      ok(known.actors.has(c.actor.toLowerCase()), `actor ${c.actor} is used by adv04 / adv11`);
      if (c.anim) ok(known.anims.has(c.anim.toLowerCase()), `animation ${c.anim} is used by adv04 / adv11`);
    }
    // texts / audio
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const tb = loadMessages(messages, [`${PAGE_SCRIPT.area.toUpperCase()}/Data/${PAGE_SCRIPT.strings}.str`]);
    const sp = readAudioTables(new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe')))).speech;
    const mp3 = new Set(fs.readdirSync(path.join(ctx.soundsDir, 'speech', 'Data')).map((f) => f.replace(/\.[^.]+$/, '').toUpperCase()));
    for (const id of ['ADCSOA13', 'ADCSOA14']) {
      ok(tb.has(id) && tb.text(id).length > 0 && tb.voice(id) > 0, `${id} in ADV04.str with voice ${tb.voice(id)}`);
      ok(mp3.has(id), `${id}.mp3 exists`);
      ok(sp[tb.voice(id)] === id, `${id} is at its speech index ${tb.voice(id)}`);
    }
    ok(ADV04B_TEXT.includes('ADCSOA13'), 'text carries the lines');
    notes.push('script only: the wiring (z21FSH trigger, declare() for a script the archive lacks) is documented in docs/re/restore.md');
    return { checked, failures, notes };
  },
};
import { parseCutscene as pc } from '../../src/formats/cutscene.ts';
function cut_of(arc, name) { return pc(arc.read(arc.find(`cutscene/${name}.cut`))); }
