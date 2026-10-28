// MPEG-1 video + MPEG-1 Layer II audio playback for the game's four movies (SdLogo, LegoSoftware, IntroFmv, outroFmv):
// 640x480, 25 fps, 44.1 kHz stereo, in an MPEG-1 *system* (program) stream, as ffprobe reports for all four.
//
//   ReadableStream -> PsDemuxer (own, below) -> JSMpeg decoders (vendored, src/vendor/jsmpeg) -> WebGL YCbCr->RGB canvas
//                                                                                            \-> Web Audio (scheduled buffers)
//
// The audio hardware clock is the master clock; video frames are decoded when their time is due. Data may arrive
// while playing (archive.org streams the file); when the stream runs dry the clock is re-anchored (a short stall).

import { MP2Audio, MPEG1Video, type VideoSink } from '../vendor/jsmpeg/jsmpeg.js';

/** One elementary-stream payload (a run of PES packets sharing the PTS of the first one), in seconds. */
type Sink = (pts: number, data: Uint8Array) => void;

/**
 * Demultiplexer for MPEG-1 system streams (and MPEG-2 program streams): pack headers, PES packets with PTS/DTS
 * (MPEG-1 and MPEG-2 PES headers). Video (0xE0..0xEF) and audio (0xC0..0xDF) go to the registered sinks; consecutive
 * packets without a PTS are merged into the previous run, so every sink call has a valid timestamp.
 */
export class PsDemuxer {
  private buf = new Uint8Array(0);
  private video: Sink | null = null;
  private audio: Sink | null = null;
  private pending = new Map<number, { pts: number; parts: Uint8Array[]; len: number }>();
  /** Highest PTS seen (seconds), a measure of how much media has arrived. */
  lastPts = 0;
  firstPts = -1;
  bytesIn = 0;

  connect(video: Sink, audio: Sink) {
    this.video = video;
    this.audio = audio;
  }

  write(chunk: Uint8Array) {
    this.bytesIn += chunk.length;
    let b = chunk;
    if (this.buf.length) {
      b = new Uint8Array(this.buf.length + chunk.length);
      b.set(this.buf, 0);
      b.set(chunk, this.buf.length);
    }
    let p = 0;
    const n = b.length;
    for (;;) {
      // find 00 00 01 xx
      while (p + 4 <= n && !(b[p] === 0 && b[p + 1] === 0 && b[p + 2] === 1)) p++;
      if (p + 4 > n) break;
      const sid = b[p + 3];
      if (sid === 0xba) {
        if (p + 5 > n) break;
        const mpeg2 = (b[p + 4] & 0xc0) === 0x40;
        if (mpeg2) {
          if (p + 14 > n) break;
          const size = 14 + (b[p + 13] & 7);
          if (p + size > n) break;
          p += size;
        } else {
          if (p + 12 > n) break;
          p += 12;
        }
      } else if (sid === 0xb9) {
        p += 4;
      } else if (sid >= 0xbb) {
        if (p + 6 > n) break;
        const len = (b[p + 4] << 8) | b[p + 5];
        if (p + 6 + len > n) break;
        if ((sid >= 0xc0 && sid <= 0xdf) || (sid >= 0xe0 && sid <= 0xef)) this.pes(sid, b, p + 6, p + 6 + len);
        p += 6 + len;
      } else {
        p++; // some other start code inside garbage: resync
      }
    }
    this.buf = p < n ? b.slice(p) : new Uint8Array(0);
  }

  /** Hand over the runs still waiting (end of stream). */
  flush() {
    for (const sid of [...this.pending.keys()]) this.emit(sid);
  }

  private pes(sid: number, b: Uint8Array, start: number, end: number) {
    let p = start;
    let pts = -1;
    if ((b[p] & 0xc0) === 0x80) {
      // MPEG-2 PES header
      const flags = b[p + 1];
      const hlen = b[p + 2];
      if (flags & 0x80) pts = this.pts33(b, p + 3);
      p += 3 + hlen;
    } else {
      // MPEG-1 PES header
      while (p < end && b[p] === 0xff) p++;
      if ((b[p] & 0xc0) === 0x40) p += 2;
      const c = b[p];
      if ((c & 0xf0) === 0x20) {
        pts = this.pts33(b, p);
        p += 5;
      } else if ((c & 0xf0) === 0x30) {
        pts = this.pts33(b, p);
        p += 10;
      } else {
        p += 1; // 0x0f: no timestamps
      }
    }
    if (p > end) return;
    const data = b.subarray(p, end);
    let st = this.pending.get(sid);
    if (pts >= 0) {
      if (st) this.emit(sid);
      st = { pts, parts: [], len: 0 };
      this.pending.set(sid, st);
      if (this.firstPts < 0 || pts < this.firstPts) this.firstPts = pts;
      if (pts > this.lastPts) this.lastPts = pts;
    } else if (!st) {
      return; // data before the first timestamp of this stream: unusable
    }
    st.parts.push(data.slice()); // copy: `b` is reused
    st.len += data.length;
  }

  private pts33(b: Uint8Array, o: number): number {
    const p32_30 = (b[o] >> 1) & 7;
    const p29_15 = (b[o + 1] << 7) | (b[o + 2] >> 1);
    const p14_0 = (b[o + 3] << 7) | (b[o + 4] >> 1);
    return (p32_30 * 1073741824 + p29_15 * 32768 + p14_0) / 90000;
  }

  private emit(sid: number) {
    const st = this.pending.get(sid);
    this.pending.delete(sid);
    if (!st || !st.len) return;
    let data: Uint8Array;
    if (st.parts.length === 1) data = st.parts[0];
    else {
      data = new Uint8Array(st.len);
      let o = 0;
      for (const part of st.parts) {
        data.set(part, o);
        o += part.length;
      }
    }
    (sid >= 0xe0 ? this.video : this.audio)?.(st.pts, data);
  }
}

/** YCbCr (BT.601, limited range) planes -> RGB on a canvas; WebGL, with a 2D-canvas fallback. */
class Renderer implements VideoSink {
  private gl: WebGLRenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private tex: WebGLTexture[] = [];
  private has = false;
  private w = 0;
  private h = 0;
  frames = 0;
  onFirstFrame: (() => void) | null = null;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initGl();
  }

  private initGl() {
    const gl = this.canvas.getContext('webgl', { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 v;varying vec2 t;void main(){t=v;gl_Position=vec4((v*2.0-1.0)*vec2(1,-1),0,1);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision mediump float;uniform sampler2D ty,tb,tr;varying vec2 t;
mat4 m=mat4(1.16438,0.0,1.59603,-0.87079, 1.16438,-0.39176,-0.81297,0.52959, 1.16438,2.01723,0.0,-1.08139, 0.0,0.0,0.0,1.0);
void main(){float y=texture2D(ty,t).r;float cb=texture2D(tb,t).r;float cr=texture2D(tr,t).r;gl_FragColor=vec4(y,cr,cb,1.0)*m;}`));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'v');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    ['ty', 'tb', 'tr'].forEach((name, i) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), i);
      this.tex.push(t);
    });
    this.gl = gl;
  }

  /** Free the WebGL context (browsers allow only a handful of live contexts). */
  dispose() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }

  resize(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.has = false;
    const coded = ((width + 15) >> 4) << 4;
    this.gl?.viewport(0, 0, coded, height); // the canvas is `width` wide: the padding columns fall outside
    if (!this.gl) {
      this.ctx2d = this.canvas.getContext('2d');
      this.image = this.ctx2d?.createImageData(width, height) ?? null;
    }
  }

  render(y: Uint8ClampedArray, cr: Uint8ClampedArray, cb: Uint8ClampedArray) {
    const cw = ((this.w + 15) >> 4) << 4;
    if (this.gl) {
      const gl = this.gl;
      const planes: [Uint8ClampedArray, number, number][] = [[y, cw, this.h], [cb, cw >> 1, this.h >> 1], [cr, cw >> 1, this.h >> 1]];
      planes.forEach(([data, w, h], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
        const view = new Uint8Array(data.buffer, data.byteOffset, w * h);
        if (this.has) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, view);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, view);
      });
      this.has = true;
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.ctx2d && this.image) {
      const out = this.image.data;
      const { w, h } = this;
      const half = cw >> 1;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const yy = 1.16438 * (y[row * cw + col] - 16);
          const ci = (row >> 1) * half + (col >> 1);
          const b = cb[ci] - 128;
          const r = cr[ci] - 128;
          const o = (row * w + col) * 4;
          out[o] = yy + 1.59603 * r;
          out[o + 1] = yy - 0.39176 * b - 0.81297 * r;
          out[o + 2] = yy + 2.01723 * b;
          out[o + 3] = 255;
        }
      }
      this.ctx2d.putImageData(this.image, 0, 0);
    }
    if (this.frames++ === 0) this.onFirstFrame?.();
  }
}

export interface PlayStats {
  /** 'ended' = played to the end, 'stopped' = stop() was called. */
  result: 'ended' | 'stopped';
  frames: number;
  /** Seconds of media shown (video time of the last frame). */
  mediaSeconds: number;
  /** Wall-clock seconds from the first frame to the end. */
  wallSeconds: number;
  /** Seconds from play() to the first frame (data arrival + prebuffering). */
  startupSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  audioFrames: number;
  /** How many times playback had to wait for data. */
  stalls: number;
  /** Frames decoded late because the page was too slow (decoded in a burst of >1 per tick). */
  catchUps: number;
}

const PREBUFFER_SECONDS = 2.5;
/** After a stall: wait until this much media is buffered ahead of the playback position. */
const REBUFFER_SECONDS = 1.5;
const AUDIO_AHEAD = 0.4;

export class MpegPlayer {
  private canvas: HTMLCanvasElement;
  private ctx: AudioContext;
  private out: AudioNode;
  private stopNow: (() => void) | null = null;
  /** Frames presented so far (also while playing). */
  frames = 0;
  onFirstFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, ctx: AudioContext, out: AudioNode) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.out = out;
  }

  stop() {
    this.stopNow?.();
  }

  /** Play a program stream to the end (or until stop()). Resolves with statistics. */
  play(stream: ReadableStream<Uint8Array>): Promise<PlayStats> {
    const ctx = this.ctx;
    const renderer = new Renderer(this.canvas);
    renderer.onFirstFrame = () => {
      firstFrameAt = performance.now();
      this.onFirstFrame?.();
    };
    const video = new MPEG1Video({ streaming: false, decodeFirstFrame: false });
    const audio = new MP2Audio({ streaming: false });
    video.connect(renderer);
    // B-pictures make packet timestamps non-monotonic in decode order: count frames from the first PTS instead
    video.collectTimestamps = false;
    let firstVideoPts = -1;
    const demux = new PsDemuxer();
    demux.connect(
      (pts, data) => {
        if (firstVideoPts < 0) {
          firstVideoPts = pts;
          video.startTime = video.decodedTime = pts;
        }
        video.write(pts, [data]);
      },
      (pts, data) => audio.write(pts, [data]),
    );

    const startedAt = performance.now();
    let firstFrameAt = 0;
    let completed = false;
    let failed: unknown = null;
    let audioFrames = 0;
    let stalls = 0;
    let catchUps = 0;
    const useAudio = ctx.state === 'running';
    const scheduled = new Set<AudioBufferSourceNode>();

    // clock: the audio clock while the context runs, else the wall clock
    const clock = () => (useAudio ? ctx.currentTime : performance.now() / 1000);
    const latency = () => (useAudio ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0);
    let anchorMedia = 0;
    let anchorClock = 0;
    let anchored = false;
    const mediaNow = () => anchorMedia + (clock() - anchorClock) - latency();
    const anchor = (media: number) => {
      anchorMedia = media;
      anchorClock = clock() + 0.15;
      anchored = true;
    };

    audio.connect({
      play: (rate, left, right) => {
        if (!useAudio || !anchored) return;
        const at = anchorClock + (audio.decodedTime - anchorMedia);
        const now = ctx.currentTime;
        if (at < now - 0.03) return; // too late to be in sync: drop this frame, keep the timeline
        const buf = ctx.createBuffer(2, left.length, rate);
        buf.getChannelData(0).set(left);
        buf.getChannelData(1).set(right);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.out);
        src.onended = () => scheduled.delete(src);
        scheduled.add(src);
        src.start(Math.max(at, now));
        audioFrames++;
      },
    });

    // pump the network stream into the demuxer
    const reader = stream.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          demux.write(value);
        }
        demux.flush();
      } catch (e) {
        failed = e;
      }
      completed = true;
    })();

    return new Promise<PlayStats>((resolve, reject) => {
      let raf = 0;
      let state: 'buffering' | 'playing' = 'buffering';
      let stopped = false;
      let lastVideoTime = 0;

      const finish = (result: 'ended' | 'stopped') => {
        cancelAnimationFrame(raf);
        this.stopNow = null;
        void reader.cancel().catch(() => {});
        for (const s of scheduled) {
          s.onended = null;
          try { s.stop(); } catch { /* not started */ }
        }
        scheduled.clear();
        this.frames = renderer.frames;
        const frames = renderer.frames;
        renderer.dispose();
        resolve({
          result,
          frames,
          mediaSeconds: lastVideoTime,
          wallSeconds: firstFrameAt ? (performance.now() - firstFrameAt) / 1000 : 0,
          startupSeconds: firstFrameAt ? (firstFrameAt - startedAt) / 1000 : 0,
          width: video.width,
          height: video.height,
          frameRate: video.frameRate,
          audioFrames,
          stalls,
          catchUps,
        });
      };
      this.stopNow = () => {
        stopped = true;
        finish('stopped');
      };

      let started = false;
      // seconds of media that have arrived beyond the playback position
      const buffered = () => demux.lastPts - (started ? video.decodedTime : Math.max(demux.firstPts, 0));
      const tick = () => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        try {
          if (failed && !completed) throw failed;
          if (state === 'buffering') {
            if (!video.hasSequenceHeader) {
              if (completed) throw failed ?? new Error('Geen video gevonden in de film.');
              return;
            }
            if (buffered() < (started ? REBUFFER_SECONDS : PREBUFFER_SECONDS) && !completed) return;
            // first start: the audio timeline starts with the first frames
            // (after a stall: continue at the audio position - the audio already decoded plays out of the old timeline - and let
            // the video catch up quickly)
            anchor(useAudio && audio.canPlay ? Math.max(audio.decodedTime, video.decodedTime) : video.decodedTime);
            state = 'playing';
            started = true;
          }
          video.streamEnded = completed;
          const now = mediaNow();
          let starved = false;
          let audioEnd = !useAudio || !audio.canPlay;
          let videoEnd = false;
          // audio first: keep ~0.4 s decoded and scheduled ahead of the clock
          if (!audioEnd) {
            while (audio.decodedTime < now + AUDIO_AHEAD) {
              if (!audio.decode()) {
                if (completed) audioEnd = true;
                else starved = true;
                break;
              }
            }
          }
          let burst = 0;
          // one frame of look-ahead: the decoder shows pictures in display order, which lags the decode order by one
          const frameTime = 1 / (video.frameRate || 25);
          while (video.decodedTime <= now + frameTime) {
            lastVideoTime = video.decodedTime;
            if (!video.decode()) {
              if (completed) videoEnd = true;
              else starved = true;
              break;
            }
            if (++burst > 4) break; // do not spend the whole tick catching up
          }
          if (burst > 1) catchUps++;
          if (starved) {
            // ran out of data: wait for more, then re-anchor at the stream position (a short pause, no drift)
            stalls++;
            state = 'buffering';
            return;
          }
          // end of data: finish once the audio that is still scheduled has played out
          if (videoEnd && audioEnd && (!useAudio || now >= audio.decodedTime)) finish('ended');
        } catch (e) {
          cancelAnimationFrame(raf);
          this.stopNow = null;
          void reader.cancel().catch(() => {});
          renderer.dispose();
          reject(e);
        }
      };
      raf = requestAnimationFrame(tick);
    });
  }
}
