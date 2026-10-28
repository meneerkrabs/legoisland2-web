// Types for the vendored JSMpeg decoders (only the parts we use).

export interface VideoSink {
  /** Called when the picture size becomes known. */
  resize(width: number, height: number): void;
  /** One decoded picture as planar YCbCr (Y is codedWidth x codedHeight, Cr/Cb are half size each way). */
  render(y: Uint8ClampedArray, cr: Uint8ClampedArray, cb: Uint8ClampedArray, isClamped: boolean): void;
}

export interface AudioSink {
  play(sampleRate: number, left: Float32Array, right: Float32Array): void;
  readonly enqueuedTime?: number;
}

export interface DecoderOptions {
  streaming?: boolean;
  decodeFirstFrame?: boolean;
  videoBufferSize?: number;
  audioBufferSize?: number;
}

export declare class MPEG1Video {
  constructor(options: DecoderOptions);
  width: number;
  height: number;
  codedWidth: number;
  frameRate: number;
  hasSequenceHeader: boolean;
  canPlay: boolean;
  startTime: number;
  readonly currentTime: number;
  decodedTime: number;
  /** false: do not resync the decode time to packet timestamps (needed with B-pictures; we count frames instead). */
  collectTimestamps: boolean;
  /** Set when no more data will be written: the last picture needs no successor and the held-back frame is flushed. */
  streamEnded: boolean;
  connect(sink: VideoSink): void;
  write(pts: number, buffers: Uint8Array[]): void;
  decode(): boolean;
}

export declare class MP2Audio {
  constructor(options: DecoderOptions);
  sampleRate: number;
  canPlay: boolean;
  startTime: number;
  decodedTime: number;
  connect(sink: AudioSink): void;
  write(pts: number, buffers: Uint8Array[]): void;
  decode(): boolean;
}

export declare class BitBuffer {}
