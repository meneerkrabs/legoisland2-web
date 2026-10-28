// A movie from the CD, full screen on a canvas (4:3 letterboxed), skippable by click or key ("Sla over").

import { audio } from './audio.ts';
import { MpegPlayer, type PlayStats } from './mpeg.ts';
import { onSkip, skipMedia } from './skip.ts';
import type { MediaFile } from '../files.ts';

/** Test helper (`?throttle=<bytes per second>`): hand the stream out slowly, to exercise stalls like a slow connection. */
export function throttleStream(stream: ReadableStream<Uint8Array>, bytesPerSecond: number): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const start = performance.now();
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const { done, value } = await reader.read();
      if (done) return ctl.close();
      sent += value.length;
      const wait = start + (sent / bytesPerSecond) * 1000 - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      ctl.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });
}

export type MovieStats = PlayStats & { skipped: boolean; name: string };

declare global {
  interface Window {
    /** Statistics of the movies played so far (for the headless tests). */
    __le2Movies?: MovieStats[];
  }
}

/**
 * Play `media` in `host`; resolves when it has ended or was skipped. The caller should have unlocked audio from a user
 * gesture (`audio.unlock()`); without that the movie plays silently on the wall clock.
 */
export async function playMovie(host: HTMLElement, media: MediaFile, name = '', throttle = 0): Promise<MovieStats> {
  const wrap = document.createElement('div');
  wrap.className = 'le2-movie';
  const canvas = document.createElement('canvas');
  canvas.className = 'le2-movie-canvas';
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.visibility = 'hidden';
  const hint = document.createElement('div');
  hint.className = 'le2-movie-hint';
  hint.textContent = 'Film laden… (klik of druk op een toets om over te slaan)';
  wrap.append(canvas, hint);
  host.appendChild(wrap);

  const player = new MpegPlayer(canvas, audio.ctx, audio.master);
  player.onFirstFrame = () => {
    canvas.style.visibility = 'visible';
    hint.textContent = 'Klik of druk op een toets om over te slaan';
    setTimeout(() => hint.classList.add('le2-fade'), 2500);
  };
  let skipped = false;
  const end = () => {
    skipped = true;
    player.stop();
  };
  const offSkip = onSkip(end);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'F5' || e.key === 'F12' || e.metaKey || e.ctrlKey) return;
    skipMedia();
  };
  const onClick = () => skipMedia();
  addEventListener('keydown', onKey);
  wrap.addEventListener('pointerdown', onClick);
  try {
    const stream = media.stream();
    const stats = await player.play(throttle > 0 ? throttleStream(stream, throttle) : stream);
    const full = { ...stats, skipped, name };
    (window.__le2Movies ??= []).push(full);
    return full;
  } finally {
    offSkip();
    removeEventListener('keydown', onKey);
    wrap.remove();
  }
}
