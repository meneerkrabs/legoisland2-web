// Audio test page (dev only): src/audio/test.html. Exposes window.__audio for headless checks.
import { audio } from '../engine/audio.ts';
import { availableSource } from '../library.ts';
import { GameAudio } from './index.ts';
import type { SoundSlot } from './index.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (s: string) => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };

let ga: GameAudio | null = null;
const slots = new Map<number, SoundSlot>();

async function start() {
  $('status').textContent = 'loading game files...';
  const lib = await availableSource();
  const files = await lib.open();
  await audio.unlock();
  ga = await GameAudio.create(audio.ctx, audio.master, files);
  ga.speech.startAutoTick();   // this page has no game loop: FUN_00435a5e's 30 Hz tick comes from a timer
  $('status').textContent = `ready: ${ga.tables.sounds.length} sounds, ${ga.tables.speech.length} speech lines, ${ga.tables.music.length} music keys (source ${files.source})`;
  buildUi(ga);
  (window as unknown as { __audio: unknown }).__audio = { ga, audio, files, slots };
  return ga;
}

function buildUi(g: GameAudio) {
  const sfx = $('sfxlist'), filter = $<HTMLInputElement>('sfxfilter');
  const renderSfx = () => {
    const f = filter.value.toLowerCase();
    sfx.textContent = '';
    for (const s of g.tables.sounds) {
      if (f && !s.name.toLowerCase().includes(f)) continue;
      const row = document.createElement('div');
      row.append(`${s.id} ${s.name} (vol ${s.volume} loop ${s.loopCount} rate ${s.rate}) `);
      for (const kind of ['2d', '3d'] as const) {
        const b = document.createElement('button');
        b.textContent = kind;
        b.onclick = async () => {
          let slot = slots.get(s.id * 2 + (kind === '3d' ? 1 : 0));
          if (!slot) { slot = await (kind === '2d' ? g.sfx.load2D(s.id) : g.sfx.load3D(s.id)); slots.set(s.id * 2 + (kind === '3d' ? 1 : 0), slot); }
          if (kind === '2d') log(`play2D ${s.name}: ${g.sfx.play2D(slot)} (buffer ${slot.buffer ? slot.buffer.duration.toFixed(2) + 's' : 'none'})`);
          else { const x = +$<HTMLInputElement>('x3d').value; log(`play3D ${s.name} at x=${x}: ${g.sfx.play3D(slot, { x, y: 0, z: 10 })}`); }
        };
        row.append(b);
      }
      const st = document.createElement('button');
      st.textContent = 'stop';
      st.onclick = () => { for (const k of [0, 1]) { const sl = slots.get(s.id * 2 + k); if (sl) g.sfx.stop(sl); } };
      row.append(st);
      sfx.append(row);
    }
  };
  filter.oninput = renderSfx; renderSfx();
  $<HTMLInputElement>('x3d').oninput = (e) => { $('x3dv').textContent = (e.target as HTMLInputElement).value; };

  const sp = $('splist'), spf = $<HTMLInputElement>('spfilter');
  const renderSp = () => {
    const f = spf.value.toLowerCase();
    sp.textContent = '';
    let n = 0;
    g.tables.speech.forEach((id, i) => {
      if (f && !id.toLowerCase().includes(f) || n++ > 300) return;
      const b = document.createElement('button');
      b.textContent = `${i} ${id}`;
      b.onclick = () => log(`say ${i} ${id}: ${g.speech.say(i)}`);
      sp.append(b);
    });
  };
  spf.oninput = renderSp; renderSp();
  $('spstop').onclick = () => g.speech.stop();

  const ml = $('mlist');
  for (const e of g.tables.music) {
    const b = document.createElement('button');
    b.textContent = e.key;
    b.title = `${e.dir}\\${e.segment}`;
    b.onclick = async () => {
      const h = await g.music.load(e.key);
      log(`music ${e.key}: ${h ? 'loaded ' + e.segment : 'load failed (like the game: nothing plays)'}`);
      g.music.setGroove(+$<HTMLSelectElement>('groove').value);
      g.music.play(h);
    };
    ml.append(b);
  }
  $<HTMLSelectElement>('groove').onchange = (e) => g.music.setGroove(+(e.target as HTMLSelectElement).value);
  $('mstop').onclick = () => g.music.stopAll();
  const al = $('alist');
  for (const e of g.tables.ambience) {
    const b = document.createElement('button');
    b.textContent = e.key;
    b.onclick = async () => log(`ambience ${e.key}: ${await g.ambience.start(e.key)}`);
    al.append(b);
  }
  $('astop').onclick = () => g.ambience.stop();
  $<HTMLInputElement>('vmusic').oninput = (e) => g.setMusicVolume(+(e.target as HTMLInputElement).value);
  $<HTMLInputElement>('vsfx').oninput = (e) => g.setSfxVolume(+(e.target as HTMLInputElement).value);
  $<HTMLInputElement>('vspeech').oninput = (e) => g.setSpeechVolume(+(e.target as HTMLInputElement).value);
  setInterval(() => {
    const st = g.music.stats;
    $('mstate').textContent = st ? `${g.music.current?.key ?? '-'} t=${st.seconds.toFixed(1)}s voices ${st.voices} (peak ${st.peakVoices}) bpm ${st.bpm.toFixed(0)} underruns ${st.underruns}` : 'idle';
    $('spstate').textContent = g.speech.idle ? 'speech idle' : 'speaking';
  }, 500);
}

$('start').onclick = () => { start().catch((e) => { log('ERROR ' + e); $('status').textContent = 'failed'; }); };
if (new URLSearchParams(location.search).has('auto')) start().catch((e) => log('ERROR ' + e));
