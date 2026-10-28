#!/usr/bin/env node
// Decode a movie with our demuxer + the vendored (B-frame patched) JSMpeg decoders in node and compare, frame by
// frame, with ffmpeg's decode of the same file (needs ffmpeg in PATH). Prints PSNR of the luma plane and the audio error.
//
//   node tools/test-mpeg.mjs <file.mpg> [maxFrames]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PsDemuxer } from '../src/engine/mpeg.ts';
import { MP2Audio, MPEG1Video } from '../src/vendor/jsmpeg/jsmpeg.js';

const file = process.argv[2];
const maxFrames = Number(process.argv[3] ?? Infinity);
if (!file) throw new Error('usage: node tools/test-mpeg.mjs <file.mpg> [maxFrames]');

const ff = (args) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ['-v', 'error', '-i', file, ...args, '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks = [];
  p.stdout.on('data', (c) => chunks.push(c));
  p.on('close', (code) => (code ? reject(new Error(`ffmpeg exit ${code}`)) : resolve(Buffer.concat(chunks))));
});
const refVideo = await ff(['-f', 'rawvideo', '-pix_fmt', 'yuv420p']);
// decode the audio from the extracted elementary stream: from the program stream ffmpeg shifts it by the start time
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'le2-mpeg-'));
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-i', file, '-vn', '-c', 'copy', '-f', 'mp2', path.join(tmp, 'a.mp2')]);
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-i', path.join(tmp, 'a.mp2'), '-f', 's16le', '-ar', '44100', '-ac', '2', path.join(tmp, 'a.raw')]);
const refAudio = fs.readFileSync(path.join(tmp, 'a.raw'));
fs.rmSync(tmp, { recursive: true });

const video = new MPEG1Video({ streaming: false, decodeFirstFrame: false });
video.collectTimestamps = false;
const audio = new MP2Audio({ streaming: false });
const W = 640, H = 480, FRAME = W * H * 3 / 2;
let n = 0;
const psnr = [];
let worst = Infinity;
video.connect({
  resize() {},
  render(y, cr, cb) {
    if (n >= maxFrames) { n++; return; }
    const off = n * FRAME;
    if (off + FRAME > refVideo.length) { n++; return; }
    const planes = [[y, 0, W * H], [cb, W * H, W * H / 4], [cr, W * H * 5 / 4, W * H / 4]];
    let se = 0;
    for (const [data, o, len] of planes.slice(0, 1)) for (let i = 0; i < len; i++) { const d = data[i] - refVideo[off + o + i]; se += d * d; }
    const p = se === 0 ? 99 : 10 * Math.log10(255 * 255 / (se / (W * H)));
    psnr.push(p);
    if (p < worst) worst = p;
    n++;
  },
});
let aSamples = 0, aSe = 0, aSr = 0;
audio.connect({
  play(rate, l, r) {
    for (let i = 0; i < l.length; i++, aSamples++) {
      const o = aSamples * 4;
      if (o + 4 > refAudio.length) return;
      const rl = refAudio.readInt16LE(o) / 32768, rr = refAudio.readInt16LE(o + 2) / 32768;
      aSe += (l[i] - rl) ** 2 + (r[i] - rr) ** 2;
      aSr += rl * rl + rr * rr;
    }
  },
});
let firstV = -1;
const demux = new PsDemuxer();
demux.connect((pts, d) => { if (firstV < 0) { firstV = pts; video.startTime = video.decodedTime = pts; } video.write(pts, [d]); }, (pts, d) => audio.write(pts, [d]));

const data = fs.readFileSync(file);
const CH = 32768; // arrive in pieces like a network stream, and decode while it arrives
let decodedPictures = 0;
for (let o = 0; o < data.length; o += CH) {
  demux.write(data.subarray(o, o + CH));
  while (video.decode()) decodedPictures++;
  while (audio.decode());
}
demux.flush();
video.streamEnded = true;
while (video.decode()) decodedPictures++;
while (audio.decode());

const avg = psnr.reduce((a, b) => a + b, 0) / psnr.length;
console.log(`${file}`);
console.log(`video: ${n} frames shown (ffmpeg: ${Math.floor(refVideo.length / FRAME)}), luma PSNR avg ${avg.toFixed(1)} dB, worst ${worst.toFixed(1)} dB`);
const snr = 10 * Math.log10(aSr / aSe);
// MP2: the (kjmp2-derived) fixed-point decoder differs from ffmpeg's by ~30 dB SNR (pl_mpeg's C port shows the same)
console.log(`audio: ${aSamples} samples (ffmpeg: ${refAudio.length / 4}), SNR vs ffmpeg ${snr.toFixed(1)} dB`);
const ok = n === Math.floor(refVideo.length / FRAME) && worst > 35 && snr > 20 && aSamples === refAudio.length / 4;
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
