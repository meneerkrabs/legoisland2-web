/*
 * JSMpeg decoders (MPEG-1 video + MPEG-1 Audio Layer II), vendored from https://github.com/phoboslab/jsmpeg
 * commit 924acfbd96fdf15e6748d1368a36d79d8f4cecf6 (v1.0), MIT license, (c) 2017 Dominic Szablewski - see LICENSE.
 *
 * Included from upstream: src/decoder.js, src/buffer.js, src/mpeg1.js, src/mp2.js.
 * Only the namespace stub below was written for this project (the original src/jsmpeg.js also sets up the player,
 * AJAX sources, a TS demuxer and DOM auto-initialisation, none of which are used here). The MPEG program-stream
 * demuxer, the renderer and the player are our own (src/engine/mpeg.ts).
 * mpeg1.js is based on Java MPEG-1 Video Decoder and Player by Zoltan Korandi; mp2.js on kjmp2 by Martin J. Fiedler.
 *
 * MODIFIED (marked "[LE2]" in mpeg1.js): the game's movies use B-pictures (I B B B P ...), which upstream JSMpeg
 * skips (it only plays I/P streams), so only every 4th frame came out. Added, following the same author's
 * pl_mpeg (https://github.com/phoboslab/pl_mpeg, MIT, plm_video_*): backward motion vectors, bidirectional
 * prediction (average of forward and backward reference), three frame buffers, picture output in display order
 * (an I/P picture is shown after the next I/P picture was decoded; flushed at the end of the stream), and a check
 * that a whole picture is buffered before decoding it (the data arrives progressively from the network).
 * mp2.js: likewise only decodes completely buffered frames, resynchronises after garbage, the output gain/sign is
 * corrected (upstream's output was inverted and 6.3 dB too quiet), and intensity-stereo subbands use each channel's own
 * scale factor (as ISO 11172-3 specifies). Checked against ffmpeg's decode of the game's movies: tools/test-mpeg.mjs.
 * Unified diff against the unmodified concatenation: tools/vendor/jsmpeg-bframes.diff.
 */
const JSMpeg = {
  Decoder: {},
  BitBuffer: null,
  Now() {
    return performance.now() / 1000;
  },
  Fill(array, value) {
    array.fill(value);
  },
};

JSMpeg.Decoder.Base = (function(){ "use strict";

var BaseDecoder = function(options) {
	this.destination = null;
	this.canPlay = false;

	this.collectTimestamps = !options.streaming;
	this.bytesWritten = 0;
	this.timestamps = [];
	this.timestampIndex = 0;

	this.startTime = 0;
	this.decodedTime = 0;

	Object.defineProperty(this, 'currentTime', {get: this.getCurrentTime});
};

BaseDecoder.prototype.destroy = function() {};

BaseDecoder.prototype.connect = function(destination) {
	this.destination = destination;
};

BaseDecoder.prototype.bufferGetIndex = function() {
	return this.bits.index;
};

BaseDecoder.prototype.bufferSetIndex = function(index) {
	this.bits.index = index;
};

BaseDecoder.prototype.bufferWrite = function(buffers) {
	return this.bits.write(buffers);
};

BaseDecoder.prototype.write = function(pts, buffers) {
	if (this.collectTimestamps) {
		if (this.timestamps.length === 0) {
			this.startTime = pts;
			this.decodedTime = pts;
		}
		this.timestamps.push({index: this.bytesWritten << 3, time: pts});
	}

	this.bytesWritten += this.bufferWrite(buffers);
	this.canPlay = true;
};

BaseDecoder.prototype.seek = function(time) {
	if (!this.collectTimestamps) {
		return;
	}

	this.timestampIndex = 0;
	for (var i = 0; i < this.timestamps.length; i++) {
		if (this.timestamps[i].time > time) {
			break;
		}
		this.timestampIndex = i;
	}

	var ts = this.timestamps[this.timestampIndex];
	if (ts) {
		this.bufferSetIndex(ts.index);
		this.decodedTime = ts.time;
	}
	else {
		this.bufferSetIndex(0);
		this.decodedTime = this.startTime;
	}
};

BaseDecoder.prototype.decode = function() {
	this.advanceDecodedTime(0);
};

BaseDecoder.prototype.advanceDecodedTime = function(seconds) {
	if (this.collectTimestamps) {
		var newTimestampIndex = -1;
		var currentIndex = this.bufferGetIndex();
		for (var i = this.timestampIndex; i < this.timestamps.length; i++) {
			if (this.timestamps[i].index > currentIndex) {
				break;
			}
			newTimestampIndex = i;
		}

		// Did we find a new PTS, different from the last? If so, we don't have
		// to advance the decoded time manually and can instead sync it exactly
		// to the PTS.
		if (
			newTimestampIndex !== -1 && 
			newTimestampIndex !== this.timestampIndex
		) {
			this.timestampIndex = newTimestampIndex;
			this.decodedTime = this.timestamps[this.timestampIndex].time;
			return;
		}
	}

	this.decodedTime += seconds;
};

BaseDecoder.prototype.getCurrentTime = function() {
	return this.decodedTime;
};

return BaseDecoder;

})();


JSMpeg.BitBuffer = (function(){ "use strict";

var BitBuffer = function(bufferOrLength, mode) {
	if (typeof(bufferOrLength) === 'object') {
		this.bytes = (bufferOrLength instanceof Uint8Array)
			? bufferOrLength 
			: new Uint8Array(bufferOrLength);

		this.byteLength = this.bytes.length;
	}
	else {
		this.bytes = new Uint8Array(bufferOrLength || 1024*1024);	
		this.byteLength = 0;
	}

	this.mode = mode || BitBuffer.MODE.EXPAND;
	this.index = 0;
};

BitBuffer.prototype.resize = function(size) {
	var newBytes = new Uint8Array(size);
	if (this.byteLength !== 0) {
		this.byteLength = Math.min(this.byteLength, size);
		newBytes.set(this.bytes, 0, this.byteLength);
	}
	this.bytes = newBytes;
	this.index = Math.min(this.index, this.byteLength << 3);
};

BitBuffer.prototype.evict = function(sizeNeeded) {
	var bytePos = this.index >> 3,
		available = this.bytes.length - this.byteLength;
	
	// If the current index is the write position, we can simply reset both
	// to 0. Also reset (and throw away yet unread data) if we won't be able
	// to fit the new data in even after a normal eviction.
	if (
		this.index === this.byteLength << 3 ||
		sizeNeeded > available + bytePos // emergency evac
	) {
		this.byteLength = 0;
		this.index = 0;
		return;
	}
	else if (bytePos === 0) {
		// Nothing read yet - we can't evict anything
		return;
	}
	
	// Some browsers don't support copyWithin() yet - we may have to do 
	// it manually using set and a subarray
	if (this.bytes.copyWithin) {
		this.bytes.copyWithin(0, bytePos, this.byteLength);
	}
	else {
		this.bytes.set(this.bytes.subarray(bytePos, this.byteLength));
	}

	this.byteLength = this.byteLength - bytePos;
	this.index -= bytePos << 3;
	return;
};

BitBuffer.prototype.write = function(buffers) {
	var isArrayOfBuffers = (typeof(buffers[0]) === 'object'),
		totalLength = 0,
		available = this.bytes.length - this.byteLength;

	// Calculate total byte length
	if (isArrayOfBuffers) {
		var totalLength = 0;
		for (var i = 0; i < buffers.length; i++) {
			totalLength += buffers[i].byteLength;
		}
	}
	else {
		totalLength = buffers.byteLength;
	}

	// Do we need to resize or evict?
	if (totalLength > available) {
		if (this.mode === BitBuffer.MODE.EXPAND) {
			var newSize = Math.max(
				this.bytes.length * 2,
				totalLength - available
			);
			this.resize(newSize)
		}
		else {
			this.evict(totalLength);
		}
	}

	if (isArrayOfBuffers) {
		for (var i = 0; i < buffers.length; i++) {
			this.appendSingleBuffer(buffers[i]);
		}
	}
	else {
		this.appendSingleBuffer(buffers);
	}

	return totalLength;
};

BitBuffer.prototype.appendSingleBuffer = function(buffer) {
	buffer = buffer instanceof Uint8Array
		? buffer 
		: new Uint8Array(buffer);
	
	this.bytes.set(buffer, this.byteLength);
	this.byteLength += buffer.length;
};

BitBuffer.prototype.findNextStartCode = function() {	
	for (var i = (this.index+7 >> 3); i < this.byteLength; i++) {
		if(
			this.bytes[i] == 0x00 &&
			this.bytes[i+1] == 0x00 &&
			this.bytes[i+2] == 0x01
		) {
			this.index = (i+4) << 3;
			return this.bytes[i+3];
		}
	}
	this.index = (this.byteLength << 3);
	return -1;
};

BitBuffer.prototype.findStartCode = function(code) {
	var current = 0;
	while (true) {
		current = this.findNextStartCode();
		if (current === code || current === -1) {
			return current;
		}
	}
	return -1;
};

BitBuffer.prototype.nextBytesAreStartCode = function() {
	var i = (this.index+7 >> 3);
	return (
		i >= this.byteLength || (
			this.bytes[i] == 0x00 && 
			this.bytes[i+1] == 0x00 &&
			this.bytes[i+2] == 0x01
		)
	);
};

BitBuffer.prototype.peek = function(count) {
	var offset = this.index;
	var value = 0;
	while (count) {
		var currentByte = this.bytes[offset >> 3],
			remaining = 8 - (offset & 7), // remaining bits in byte
			read = remaining < count ? remaining : count, // bits in this run
			shift = remaining - read,
			mask = (0xff >> (8-read));

		value = (value << read) | ((currentByte & (mask << shift)) >> shift);

		offset += read;
		count -= read;
	}

	return value;
}

BitBuffer.prototype.read = function(count) {
	var value = this.peek(count);
	this.index += count;
	return value;
};

BitBuffer.prototype.skip = function(count) {
	return (this.index += count);
};

BitBuffer.prototype.rewind = function(count) {
	this.index = Math.max(this.index - count, 0);
};

BitBuffer.prototype.has = function(count) {
	return ((this.byteLength << 3) - this.index) >= count;
};

BitBuffer.MODE = {
	EVICT: 1,
	EXPAND: 2
};

return BitBuffer;

})();


JSMpeg.Decoder.MPEG1Video = (function(){ "use strict";

// Inspired by Java MPEG-1 Video Decoder and Player by Zoltan Korandi 
// https://sourceforge.net/projects/javampeg1video/

var MPEG1 = function(options) {
	JSMpeg.Decoder.Base.call(this, options);

	this.onDecodeCallback = options.onVideoDecode;

	var bufferSize = options.videoBufferSize || 512*1024;
	var bufferMode = options.streaming
		? JSMpeg.BitBuffer.MODE.EVICT
		: JSMpeg.BitBuffer.MODE.EXPAND;

	this.bits = new JSMpeg.BitBuffer(bufferSize, bufferMode);

	this.customIntraQuantMatrix = new Uint8Array(64);
	this.customNonIntraQuantMatrix = new Uint8Array(64);
	this.blockData = new Int32Array(64);

	this.currentFrame = 0;
	this.decodeFirstFrame = options.decodeFirstFrame !== false;
};

MPEG1.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
MPEG1.prototype.constructor = MPEG1;

MPEG1.prototype.write = function(pts, buffers) {
	JSMpeg.Decoder.Base.prototype.write.call(this, pts, buffers);

	if (!this.hasSequenceHeader) {
		if (this.bits.findStartCode(MPEG1.START.SEQUENCE) === -1) {
			return false;
		}
		this.decodeSequenceHeader();

		if (this.decodeFirstFrame) {
			this.decode();
		}
	}
};

// [LE2] Decodes one picture (in stream order) and shows the next picture in display order: B-pictures are shown
// at once, an I/P picture is held back until the next I/P picture has been decoded. Returns false when no complete
// picture is buffered yet (`streamEnded` = no more data will follow, so the last picture needs no successor).
MPEG1.prototype.streamEnded = false;

MPEG1.prototype.findStart = function(from, picturesOnly) {
	// byte index of the next start code (00 00 01 xx) that is a picture start, or - unless picturesOnly - any start code
	// that ends a picture (everything except slices), searching from byte `from`; -1 if not buffered
	var bytes = this.bits.bytes, end = this.bits.byteLength - 3;
	for (var i = from; i < end; i++) {
		if (bytes[i] === 0 && bytes[i+1] === 0 && bytes[i+2] === 1) {
			var c = bytes[i+3];
			if (c === 0 || (!picturesOnly && c >= 0xB0)) {
				return i;
			}
		}
	}
	return -1;
};

MPEG1.prototype.decode = function() {
	var startTime = JSMpeg.Now();

	if (!this.hasSequenceHeader) {
		return false;
	}

	var pic = this.findStart((this.bits.index + 7) >> 3, true);
	if (pic === -1) {
		// Nothing left to decode: show the reference picture that was held back
		if (this.streamEnded && this.hasReferenceFrame) {
			this.hasReferenceFrame = false;
			if (this.destination) {
				this.destination.render(this.backwardY, this.backwardCr, this.backwardCb, true);
			}
			this.advanceDecodedTime(1/this.frameRate);
			return true;
		}
		return false;
	}
	if (!this.streamEnded && this.findStart(pic + 4, false) === -1) {
		return false; // the picture is not completely buffered yet
	}
	this.bits.index = (pic + 4) << 3;

	this.decodePicture();
	this.advanceDecodedTime(1/this.frameRate);

	var elapsedTime = JSMpeg.Now() - startTime;
	if (this.onDecodeCallback) {
		this.onDecodeCallback(this, elapsedTime);
	}
	return true;
};

MPEG1.prototype.readHuffman = function(codeTable) {
	var state = 0;
	do {
		state = codeTable[state + this.bits.read(1)];
	} while (state >= 0 && codeTable[state] !== 0);
	return codeTable[state+2];
};


// Sequence Layer

MPEG1.prototype.frameRate = 30;
MPEG1.prototype.decodeSequenceHeader = function() {
	var newWidth = this.bits.read(12),
		newHeight = this.bits.read(12);

	// skip pixel aspect ratio
	this.bits.skip(4);

	this.frameRate = MPEG1.PICTURE_RATE[this.bits.read(4)];

	// skip bitRate, marker, bufferSize and constrained bit
	this.bits.skip(18 + 1 + 10 + 1);

	if (newWidth !== this.width || newHeight !== this.height) {
		this.width = newWidth;
		this.height = newHeight;

		this.initBuffers();

		if (this.destination) {
			this.destination.resize(newWidth, newHeight);
		}
	}

	if (this.bits.read(1)) { // load custom intra quant matrix?
		for (var i = 0; i < 64; i++) {
			this.customIntraQuantMatrix[MPEG1.ZIG_ZAG[i]] = this.bits.read(8);
		}
		this.intraQuantMatrix = this.customIntraQuantMatrix;
	}

	if (this.bits.read(1)) { // load custom non intra quant matrix?
		for (var i = 0; i < 64; i++) {
			var idx = MPEG1.ZIG_ZAG[i];
			this.customNonIntraQuantMatrix[idx] = this.bits.read(8);
		}
		this.nonIntraQuantMatrix = this.customNonIntraQuantMatrix;
	}

	this.hasSequenceHeader = true;
};

MPEG1.prototype.initBuffers = function() {
	this.intraQuantMatrix = MPEG1.DEFAULT_INTRA_QUANT_MATRIX;
	this.nonIntraQuantMatrix = MPEG1.DEFAULT_NON_INTRA_QUANT_MATRIX;

	this.mbWidth = (this.width + 15) >> 4;
	this.mbHeight = (this.height + 15) >> 4;
	this.mbSize = this.mbWidth * this.mbHeight;

	this.codedWidth = this.mbWidth << 4;
	this.codedHeight = this.mbHeight << 4;
	this.codedSize = this.codedWidth * this.codedHeight;

	this.halfWidth = this.mbWidth << 3;
	this.halfHeight = this.mbHeight << 3;

	// [LE2] Three frame buffers: the picture being decoded, the older reference (forward) and the newer reference
	// (backward), so that B-pictures can be predicted from both.
	var newFrame = function(codedSize) {
		var f = {
			y: new Uint8ClampedArray(codedSize),
			cr: new Uint8ClampedArray(codedSize >> 2),
			cb: new Uint8ClampedArray(codedSize >> 2)
		};
		f.y32 = new Uint32Array(f.y.buffer);
		f.cr32 = new Uint32Array(f.cr.buffer);
		f.cb32 = new Uint32Array(f.cb.buffer);
		return f;
	};
	this.frameCurrent = newFrame(this.codedSize);
	this.frameForward = newFrame(this.codedSize);
	this.frameBackward = newFrame(this.codedSize);
	this.hasReferenceFrame = false;
	this.bindFrames();
};


// Picture Layer

MPEG1.prototype.currentY = null;
MPEG1.prototype.currentCr = null;
MPEG1.prototype.currentCb = null;

MPEG1.prototype.pictureType = 0;

// Buffers for motion compensation
MPEG1.prototype.forwardY = null;
MPEG1.prototype.forwardCr = null;
MPEG1.prototype.forwardCb = null;

MPEG1.prototype.fullPelForward = false;
MPEG1.prototype.forwardFCode = 0;
MPEG1.prototype.forwardRSize = 0;
MPEG1.prototype.forwardF = 0;

MPEG1.prototype.bindFrames = function() {
	var c = this.frameCurrent, f = this.frameForward, b = this.frameBackward;
	this.currentY = c.y; this.currentY32 = c.y32; this.currentCr = c.cr; this.currentCr32 = c.cr32; this.currentCb = c.cb; this.currentCb32 = c.cb32;
	this.forwardY = f.y; this.forwardY32 = f.y32; this.forwardCr = f.cr; this.forwardCr32 = f.cr32; this.forwardCb = f.cb; this.forwardCb32 = f.cb32;
	this.backwardY = b.y; this.backwardY32 = b.y32; this.backwardCr = b.cr; this.backwardCr32 = b.cr32; this.backwardCb = b.cb; this.backwardCb32 = b.cb32;
};

MPEG1.prototype.decodePicture = function() {
	this.currentFrame++;

	this.bits.skip(10); // skip temporalReference
	this.pictureType = this.bits.read(3);
	this.bits.skip(16); // skip vbv_delay

	// Skip D frames or unknown coding type
	if (this.pictureType <= 0 || this.pictureType > MPEG1.PICTURE_TYPE.B) {
		return;
	}

	// full_pel_forward, forward_f_code
	if (
		this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE ||
		this.pictureType === MPEG1.PICTURE_TYPE.B
	) {
		this.fullPelForward = this.bits.read(1);
		this.forwardFCode = this.bits.read(3);
		if (this.forwardFCode === 0) {
			// Ignore picture with zero forward_f_code
			return;
		}
		this.forwardRSize = this.forwardFCode - 1;
		this.forwardF = 1 << this.forwardRSize;
	}

	// [LE2] full_pel_backward, backward_f_code
	if (this.pictureType === MPEG1.PICTURE_TYPE.B) {
		this.fullPelBackward = this.bits.read(1);
		this.backwardFCode = this.bits.read(3);
		if (this.backwardFCode === 0) {
			return;
		}
		this.backwardRSize = this.backwardFCode - 1;
		this.backwardF = 1 << this.backwardRSize;
	}

	// [LE2] An I/P picture becomes the newest reference: the previous newest reference is its forward reference
	var isReference = (
		this.pictureType === MPEG1.PICTURE_TYPE.INTRA ||
		this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE
	);
	var spare = this.frameForward;
	if (isReference) {
		this.frameForward = this.frameBackward;
		this.bindFrames();
	}

	var code = 0;
	do {
		code = this.bits.findNextStartCode();
	} while (code === MPEG1.START.EXTENSION || code === MPEG1.START.USER_DATA );


	while (code >= MPEG1.START.SLICE_FIRST && code <= MPEG1.START.SLICE_LAST) {
		this.decodeSlice(code & 0x000000FF);
		code = this.bits.findNextStartCode();
	}

	if (code !== -1) {
		// We found the next start code; rewind 32bits and let the main loop
		// handle it.
		this.bits.rewind(32);
	}

	if (isReference) {
		this.frameBackward = this.frameCurrent;
		this.frameCurrent = spare;
		this.bindFrames();
		// Show the previous reference picture (display order); the new one is held back until the next I/P picture
		if (this.hasReferenceFrame) {
			if (this.destination) {
				this.destination.render(this.forwardY, this.forwardCr, this.forwardCb, true);
			}
		}
		else {
			this.hasReferenceFrame = true;
		}
	}
	else if (this.destination) {
		// B-picture: shown at once
		this.destination.render(this.currentY, this.currentCr, this.currentCb, true);
	}
};


// Slice Layer

MPEG1.prototype.quantizerScale = 0;
MPEG1.prototype.sliceBegin = false;

MPEG1.prototype.decodeSlice = function(slice) {
	this.sliceBegin = true;
	this.macroblockAddress = (slice - 1) * this.mbWidth - 1;

	// Reset motion vectors and DC predictors
	this.motionFwH = this.motionFwHPrev = 0;
	this.motionFwV = this.motionFwVPrev = 0;
	this.motionBwH = this.motionBwHPrev = 0; // [LE2]
	this.motionBwV = this.motionBwVPrev = 0; // [LE2]
	this.dcPredictorY  = 128;
	this.dcPredictorCr = 128;
	this.dcPredictorCb = 128;

	this.quantizerScale = this.bits.read(5);

	// skip extra bits
	while (this.bits.read(1)) {
		this.bits.skip(8);
	}

	do {
		this.decodeMacroblock();
	} while (!this.bits.nextBytesAreStartCode());
};


// Macroblock Layer

MPEG1.prototype.macroblockAddress = 0;
MPEG1.prototype.mbRow = 0;
MPEG1.prototype.mbCol = 0;

MPEG1.prototype.macroblockType = 0;
MPEG1.prototype.macroblockIntra = false;
MPEG1.prototype.macroblockMotFw = false;
MPEG1.prototype.macroblockMotBw = false; // [LE2]

MPEG1.prototype.motionBwH = 0; // [LE2]
MPEG1.prototype.motionBwV = 0;
MPEG1.prototype.motionBwHPrev = 0;
MPEG1.prototype.motionBwVPrev = 0;
MPEG1.prototype.fullPelBackward = false;
MPEG1.prototype.backwardFCode = 0;
MPEG1.prototype.backwardRSize = 0;
MPEG1.prototype.backwardF = 0;

MPEG1.prototype.motionFwH = 0;
MPEG1.prototype.motionFwV = 0;
MPEG1.prototype.motionFwHPrev = 0;
MPEG1.prototype.motionFwVPrev = 0;

MPEG1.prototype.decodeMacroblock = function() {
	// Decode macroblock_address_increment
	var
		increment = 0,
		t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);

	while (t === 34) {
		// macroblock_stuffing
		t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);
	}
	while (t === 35) {
		// macroblock_escape
		increment += 33;
		t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);
	}
	increment += t;

	// Process any skipped macroblocks
	if (this.sliceBegin) {
		// The first macroblock_address_increment of each slice is relative
		// to beginning of the preverious row, not the preverious macroblock
		this.sliceBegin = false;
		this.macroblockAddress += increment;
	}
	else {
		if (this.macroblockAddress + increment >= this.mbSize) {
			// Illegal (too large) macroblock_address_increment
			return;
		}
		if (increment > 1) {
			// Skipped macroblocks reset DC predictors
			this.dcPredictorY  = 128;
			this.dcPredictorCr = 128;
			this.dcPredictorCb = 128;

			// Skipped macroblocks in P-pictures reset motion vectors
			if (this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE) {
				this.motionFwH = this.motionFwHPrev = 0;
				this.motionFwV = this.motionFwVPrev = 0;
			}
		}

		// Predict skipped macroblocks
		while (increment > 1) {
			this.macroblockAddress++;
			this.mbRow = (this.macroblockAddress / this.mbWidth)|0;
			this.mbCol = this.macroblockAddress % this.mbWidth;
			this.predictMacroblock(); // [LE2] (B-pictures: like the previous macroblock)
			increment--;
		}
		this.macroblockAddress++;
	}
	this.mbRow = (this.macroblockAddress / this.mbWidth)|0;
	this.mbCol = this.macroblockAddress % this.mbWidth;

	// Process the current macroblock
	var mbTable = MPEG1.MACROBLOCK_TYPE[this.pictureType];
	this.macroblockType = this.readHuffman(mbTable);
	this.macroblockIntra = (this.macroblockType & 0x01);
	this.macroblockMotFw = (this.macroblockType & 0x08);
	this.macroblockMotBw = (this.macroblockType & 0x04); // [LE2]

	// Quantizer scale
	if ((this.macroblockType & 0x10) !== 0) {
		this.quantizerScale = this.bits.read(5);
	}

	if (this.macroblockIntra) {
		// Intra-coded macroblocks reset motion vectors
		this.motionFwH = this.motionFwHPrev = 0;
		this.motionFwV = this.motionFwVPrev = 0;
		this.motionBwH = this.motionBwHPrev = 0; // [LE2]
		this.motionBwV = this.motionBwVPrev = 0;
	}
	else {
		// Non-intra macroblocks reset DC predictors
		this.dcPredictorY = 128;
		this.dcPredictorCr = 128;
		this.dcPredictorCb = 128;

		this.decodeMotionVectors();
		this.predictMacroblock(); // [LE2]
	}

	// Decode blocks
	var cbp = ((this.macroblockType & 0x02) !== 0)
		? this.readHuffman(MPEG1.CODE_BLOCK_PATTERN)
		: (this.macroblockIntra ? 0x3f : 0);

	for (var block = 0, mask = 0x20; block < 6; block++) {
		if ((cbp & mask) !== 0) {
			this.decodeBlock(block);
		}
		mask >>= 1;
	}
};


MPEG1.prototype.decodeMotionVectors = function() {
	var code, d, r = 0;

	// Forward
	if (this.macroblockMotFw) {
		// Horizontal forward
		code = this.readHuffman(MPEG1.MOTION);
		if ((code !== 0) && (this.forwardF !== 1)) {
			r = this.bits.read(this.forwardRSize);
			d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1;
			if (code < 0) {
				d = -d;
			}
		}
		else {
			d = code;
		}

		this.motionFwHPrev += d;
		if (this.motionFwHPrev > (this.forwardF << 4) - 1) {
			this.motionFwHPrev -= this.forwardF << 5;
		}
		else if (this.motionFwHPrev < ((-this.forwardF) << 4)) {
			this.motionFwHPrev += this.forwardF << 5;
		}

		this.motionFwH = this.motionFwHPrev;
		if (this.fullPelForward) {
			this.motionFwH <<= 1;
		}

		// Vertical forward
		code = this.readHuffman(MPEG1.MOTION);
		if ((code !== 0) && (this.forwardF !== 1)) {
			r = this.bits.read(this.forwardRSize);
			d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1;
			if (code < 0) {
				d = -d;
			}
		}
		else {
			d = code;
		}

		this.motionFwVPrev += d;
		if (this.motionFwVPrev > (this.forwardF << 4) - 1) {
			this.motionFwVPrev -= this.forwardF << 5;
		}
		else if (this.motionFwVPrev < ((-this.forwardF) << 4)) {
			this.motionFwVPrev += this.forwardF << 5;
		}

		this.motionFwV = this.motionFwVPrev;
		if (this.fullPelForward) {
			this.motionFwV <<= 1;
		}
	}
	else if (this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE) {
		// No motion information in P-picture, reset vectors
		this.motionFwH = this.motionFwHPrev = 0;
		this.motionFwV = this.motionFwVPrev = 0;
	}

	this.decodeMotionVectorsBackward(); // [LE2]
};

// [LE2] Backward motion vectors (B-pictures); same scheme as the forward ones
MPEG1.prototype.decodeMotionVectorsBackward = function() {
	var code, d, r = 0;
	if (!this.macroblockMotBw) {
		return;
	}

	// Horizontal backward
	code = this.readHuffman(MPEG1.MOTION);
	if ((code !== 0) && (this.backwardF !== 1)) {
		r = this.bits.read(this.backwardRSize);
		d = ((Math.abs(code) - 1) << this.backwardRSize) + r + 1;
		if (code < 0) {
			d = -d;
		}
	}
	else {
		d = code;
	}

	this.motionBwHPrev += d;
	if (this.motionBwHPrev > (this.backwardF << 4) - 1) {
		this.motionBwHPrev -= this.backwardF << 5;
	}
	else if (this.motionBwHPrev < ((-this.backwardF) << 4)) {
		this.motionBwHPrev += this.backwardF << 5;
	}

	this.motionBwH = this.motionBwHPrev;
	if (this.fullPelBackward) {
		this.motionBwH <<= 1;
	}

	// Vertical backward
	code = this.readHuffman(MPEG1.MOTION);
	if ((code !== 0) && (this.backwardF !== 1)) {
		r = this.bits.read(this.backwardRSize);
		d = ((Math.abs(code) - 1) << this.backwardRSize) + r + 1;
		if (code < 0) {
			d = -d;
		}
	}
	else {
		d = code;
	}

	this.motionBwVPrev += d;
	if (this.motionBwVPrev > (this.backwardF << 4) - 1) {
		this.motionBwVPrev -= this.backwardF << 5;
	}
	else if (this.motionBwVPrev < ((-this.backwardF) << 4)) {
		this.motionBwVPrev += this.backwardF << 5;
	}

	this.motionBwV = this.motionBwVPrev;
	if (this.fullPelBackward) {
		this.motionBwV <<= 1;
	}
};

// Builds the prediction of the current macroblock in the current frame
MPEG1.prototype.predictMacroblock = function() {
	if (this.pictureType === MPEG1.PICTURE_TYPE.B) {
		if (this.macroblockMotFw) {
			this.copyMacroblock(
				this.motionFwH, this.motionFwV,
				this.forwardY, this.forwardCr, this.forwardCb
			);
			if (this.macroblockMotBw) {
				this.interpolateMacroblock(
					this.motionBwH, this.motionBwV,
					this.backwardY, this.backwardCr, this.backwardCb
				);
			}
		}
		else {
			this.copyMacroblock(
				this.motionBwH, this.motionBwV,
				this.backwardY, this.backwardCr, this.backwardCb
			);
		}
	}
	else {
		this.copyMacroblock(
			this.motionFwH, this.motionFwV,
			this.forwardY, this.forwardCr, this.forwardCb
		);
	}
};

// Averages the prediction from the backward reference into the forward prediction already in the current frame
// (ported from pl_mpeg's plm_video_process_macroblock, interpolate = true)
MPEG1.prototype.interpolateMacroblock = function(motionH, motionV, sY, sCr, sCb) {
	this.averageBlock(sY, this.currentY, motionH, motionV, 16, this.codedWidth);
	this.averageBlock(sCr, this.currentCr, (motionH / 2) | 0, (motionV / 2) | 0, 8, this.halfWidth);
	this.averageBlock(sCb, this.currentCb, (motionH / 2) | 0, (motionV / 2) | 0, 8, this.halfWidth);
};

MPEG1.prototype.averageBlock = function(s, d, motionH, motionV, size, dw) {
	var
		hp = motionH >> 1,
		vp = motionV >> 1,
		oddH = (motionH & 1) === 1,
		oddV = (motionV & 1) === 1,
		si = ((this.mbRow * size) + vp) * dw + (this.mbCol * size) + hp,
		di = (this.mbRow * dw + this.mbCol) * size,
		maxAddress = dw * (this.mbHeight * size - size + 1) - size,
		x, y, p;

	if (si < 0 || si > maxAddress || di > maxAddress) {
		return; // corrupt video
	}

	var sScan = dw - size, dScan = dw - size;
	for (y = 0; y < size; y++) {
		for (x = 0; x < size; x++) {
			if (oddH) {
				p = oddV
					? (s[si] + s[si+1] + s[si+dw] + s[si+dw+1] + 2) >> 2
					: (s[si] + s[si+1] + 1) >> 1;
			}
			else {
				p = oddV
					? (s[si] + s[si+dw] + 1) >> 1
					: s[si];
			}
			d[di] = (d[di] + p + 1) >> 1;
			si++; di++;
		}
		si += sScan;
		di += dScan;
	}
};

MPEG1.prototype.copyMacroblock = function(motionH, motionV, sY, sCr, sCb) {
	var
		width, scan,
		H, V, oddH, oddV,
		src, dest, last;

	// We use 32bit writes here
	var dY = this.currentY32,
		dCb = this.currentCb32,
		dCr = this.currentCr32;

	// Luminance
	width = this.codedWidth;
	scan = width - 16;

	H = motionH >> 1;
	V = motionV >> 1;
	oddH = (motionH & 1) === 1;
	oddV = (motionV & 1) === 1;

	src = ((this.mbRow << 4) + V) * width + (this.mbCol << 4) + H;
	dest = (this.mbRow * width + this.mbCol) << 2;
	last = dest + (width << 2);

	var x, y1, y2, y;
	if (oddH) {
		if (oddV) {
			while (dest < last) {
				y1 = sY[src] + sY[src+width]; src++;
				for (x = 0; x < 4; x++) {
					y2 = sY[src] + sY[src+width]; src++;
					y = (((y1 + y2 + 2) >> 2) & 0xff);

					y1 = sY[src] + sY[src+width]; src++;
					y |= (((y1 + y2 + 2) << 6) & 0xff00);

					y2 = sY[src] + sY[src+width]; src++;
					y |= (((y1 + y2 + 2) << 14) & 0xff0000);

					y1 = sY[src] + sY[src+width]; src++;
					y |= (((y1 + y2 + 2) << 22) & 0xff000000);

					dY[dest++] = y;
				}
				dest += scan >> 2; src += scan-1;
			}
		}
		else {
			while (dest < last) {
				y1 = sY[src++];
				for (x = 0; x < 4; x++) {
					y2 = sY[src++];
					y = (((y1 + y2 + 1) >> 1) & 0xff);

					y1 = sY[src++];
					y |= (((y1 + y2 + 1) << 7) & 0xff00);

					y2 = sY[src++];
					y |= (((y1 + y2 + 1) << 15) & 0xff0000);

					y1 = sY[src++];
					y |= (((y1 + y2 + 1) << 23) & 0xff000000);

					dY[dest++] = y;
				}
				dest += scan >> 2; src += scan-1;
			}
		}
	}
	else {
		if (oddV) {
			while (dest < last) {
				for (x = 0; x < 4; x++) {
					y = (((sY[src] + sY[src+width] + 1) >> 1) & 0xff); src++;
					y |= (((sY[src] + sY[src+width] + 1) << 7) & 0xff00); src++;
					y |= (((sY[src] + sY[src+width] + 1) << 15) & 0xff0000); src++;
					y |= (((sY[src] + sY[src+width] + 1) << 23) & 0xff000000); src++;

					dY[dest++] = y;
				}
				dest += scan >> 2; src += scan;
			}
		}
		else {
			while (dest < last) {
				for (x = 0; x < 4; x++) {
					y = sY[src]; src++;
					y |= sY[src] << 8; src++;
					y |= sY[src] << 16; src++;
					y |= sY[src] << 24; src++;

					dY[dest++] = y;
				}
				dest += scan >> 2; src += scan;
			}
		}
	}

	// Chrominance

	width = this.halfWidth;
	scan = width - 8;

	H = (motionH/2) >> 1;
	V = (motionV/2) >> 1;
	oddH = ((motionH/2) & 1) === 1;
	oddV = ((motionV/2) & 1) === 1;

	src = ((this.mbRow << 3) + V) * width + (this.mbCol << 3) + H;
	dest = (this.mbRow * width + this.mbCol) << 1;
	last = dest + (width << 1);

	var cr1, cr2, cr,
		cb1, cb2, cb;
	if (oddH) {
		if (oddV) {
			while (dest < last) {
				cr1 = sCr[src] + sCr[src+width];
				cb1 = sCb[src] + sCb[src+width];
				src++;
				for (x = 0; x < 2; x++) {
					cr2 = sCr[src] + sCr[src+width];
					cb2 = sCb[src] + sCb[src+width]; src++;
					cr = (((cr1 + cr2 + 2) >> 2) & 0xff);
					cb = (((cb1 + cb2 + 2) >> 2) & 0xff);

					cr1 = sCr[src] + sCr[src+width];
					cb1 = sCb[src] + sCb[src+width]; src++;
					cr |= (((cr1 + cr2 + 2) << 6) & 0xff00);
					cb |= (((cb1 + cb2 + 2) << 6) & 0xff00);

					cr2 = sCr[src] + sCr[src+width];
					cb2 = sCb[src] + sCb[src+width]; src++;
					cr |= (((cr1 + cr2 + 2) << 14) & 0xff0000);
					cb |= (((cb1 + cb2 + 2) << 14) & 0xff0000);

					cr1 = sCr[src] + sCr[src+width];
					cb1 = sCb[src] + sCb[src+width]; src++;
					cr |= (((cr1 + cr2 + 2) << 22) & 0xff000000);
					cb |= (((cb1 + cb2 + 2) << 22) & 0xff000000);

					dCr[dest] = cr;
					dCb[dest] = cb;
					dest++;
				}
				dest += scan >> 2; src += scan-1;
			}
		}
		else {
			while (dest < last) {
				cr1 = sCr[src];
				cb1 = sCb[src];
				src++;
				for (x = 0; x < 2; x++) {
					cr2 = sCr[src];
					cb2 = sCb[src++];
					cr = (((cr1 + cr2 + 1) >> 1) & 0xff);
					cb = (((cb1 + cb2 + 1) >> 1) & 0xff);

					cr1 = sCr[src];
					cb1 = sCb[src++];
					cr |= (((cr1 + cr2 + 1) << 7) & 0xff00);
					cb |= (((cb1 + cb2 + 1) << 7) & 0xff00);

					cr2 = sCr[src];
					cb2 = sCb[src++];
					cr |= (((cr1 + cr2 + 1) << 15) & 0xff0000);
					cb |= (((cb1 + cb2 + 1) << 15) & 0xff0000);

					cr1 = sCr[src];
					cb1 = sCb[src++];
					cr |= (((cr1 + cr2 + 1) << 23) & 0xff000000);
					cb |= (((cb1 + cb2 + 1) << 23) & 0xff000000);

					dCr[dest] = cr;
					dCb[dest] = cb;
					dest++;
				}
				dest += scan >> 2; src += scan-1;
			}
		}
	}
	else {
		if (oddV) {
			while (dest < last) {
				for (x = 0; x < 2; x++) {
					cr = (((sCr[src] + sCr[src+width] + 1) >> 1) & 0xff);
					cb = (((sCb[src] + sCb[src+width] + 1) >> 1) & 0xff); src++;

					cr |= (((sCr[src] + sCr[src+width] + 1) << 7) & 0xff00);
					cb |= (((sCb[src] + sCb[src+width] + 1) << 7) & 0xff00); src++;

					cr |= (((sCr[src] + sCr[src+width] + 1) << 15) & 0xff0000);
					cb |= (((sCb[src] + sCb[src+width] + 1) << 15) & 0xff0000); src++;

					cr |= (((sCr[src] + sCr[src+width] + 1) << 23) & 0xff000000);
					cb |= (((sCb[src] + sCb[src+width] + 1) << 23) & 0xff000000); src++;

					dCr[dest] = cr;
					dCb[dest] = cb;
					dest++;
				}
				dest += scan >> 2; src += scan;
			}
		}
		else {
			while (dest < last) {
				for (x = 0; x < 2; x++) {
					cr = sCr[src];
					cb = sCb[src]; src++;

					cr |= sCr[src] << 8;
					cb |= sCb[src] << 8; src++;

					cr |= sCr[src] << 16;
					cb |= sCb[src] << 16; src++;

					cr |= sCr[src] << 24;
					cb |= sCb[src] << 24; src++;

					dCr[dest] = cr;
					dCb[dest] = cb;
					dest++;
				}
				dest += scan >> 2; src += scan;
			}
		}
	}
};


// Block layer

MPEG1.prototype.dcPredictorY = 0;
MPEG1.prototype.dcPredictorCr = 0;
MPEG1.prototype.dcPredictorCb = 0;

MPEG1.prototype.blockData = null;

MPEG1.prototype.decodeBlock = function(block) {

	var
		n = 0,
		quantMatrix;

	// Decode DC coefficient of intra-coded blocks
	if (this.macroblockIntra) {
		var
			predictor,
			dctSize;

		// DC prediction

		if (block < 4) {
			predictor = this.dcPredictorY;
			dctSize = this.readHuffman(MPEG1.DCT_DC_SIZE_LUMINANCE);
		}
		else {
			predictor = (block === 4 ? this.dcPredictorCr : this.dcPredictorCb);
			dctSize = this.readHuffman(MPEG1.DCT_DC_SIZE_CHROMINANCE);
		}

		// Read DC coeff
		if (dctSize > 0) {
			var differential = this.bits.read(dctSize);
			if ((differential & (1 << (dctSize - 1))) !== 0) {
				this.blockData[0] = predictor + differential;
			}
			else {
				this.blockData[0] = predictor + ((-1 << dctSize)|(differential+1));
			}
		}
		else {
			this.blockData[0] = predictor;
		}

		// Save predictor value
		if (block < 4) {
			this.dcPredictorY = this.blockData[0];
		}
		else if (block === 4) {
			this.dcPredictorCr = this.blockData[0];
		}
		else {
			this.dcPredictorCb = this.blockData[0];
		}

		// Dequantize + premultiply
		this.blockData[0] <<= (3 + 5);

		quantMatrix = this.intraQuantMatrix;
		n = 1;
	}
	else {
		quantMatrix = this.nonIntraQuantMatrix;
	}

	// Decode AC coefficients (+DC for non-intra)
	var level = 0;
	while (true) {
		var
			run = 0,
			coeff = this.readHuffman(MPEG1.DCT_COEFF);

		if ((coeff === 0x0001) && (n > 0) && (this.bits.read(1) === 0)) {
			// end_of_block
			break;
		}
		if (coeff === 0xffff) {
			// escape
			run = this.bits.read(6);
			level = this.bits.read(8);
			if (level === 0) {
				level = this.bits.read(8);
			}
			else if (level === 128) {
				level = this.bits.read(8) - 256;
			}
			else if (level > 128) {
				level = level - 256;
			}
		}
		else {
			run = coeff >> 8;
			level = coeff & 0xff;
			if (this.bits.read(1)) {
				level = -level;
			}
		}

		n += run;
		var dezigZagged = MPEG1.ZIG_ZAG[n];
		n++;

		// Dequantize, oddify, clip
		level <<= 1;
		if (!this.macroblockIntra) {
			level += (level < 0 ? -1 : 1);
		}
		level = (level * this.quantizerScale * quantMatrix[dezigZagged]) >> 4;
		if ((level & 1) === 0) {
			level -= level > 0 ? 1 : -1;
		}
		if (level > 2047) {
			level = 2047;
		}
		else if (level < -2048) {
			level = -2048;
		}

		// Save premultiplied coefficient
		this.blockData[dezigZagged] = level * MPEG1.PREMULTIPLIER_MATRIX[dezigZagged];
	}

	// Move block to its place
	var
		destArray,
		destIndex,
		scan;

	if (block < 4) {
		destArray = this.currentY;
		scan = this.codedWidth - 8;
		destIndex = (this.mbRow * this.codedWidth + this.mbCol) << 4;
		if ((block & 1) !== 0) {
			destIndex += 8;
		}
		if ((block & 2) !== 0) {
			destIndex += this.codedWidth << 3;
		}
	}
	else {
		destArray = (block === 4) ? this.currentCb : this.currentCr;
		scan = (this.codedWidth >> 1) - 8;
		destIndex = ((this.mbRow * this.codedWidth) << 2) + (this.mbCol << 3);
	}

	if (this.macroblockIntra) {
		// Overwrite (no prediction)
		if (n === 1) {
			MPEG1.CopyValueToDestination((this.blockData[0] + 128) >> 8, destArray, destIndex, scan);
			this.blockData[0] = 0;
		}
		else {
			MPEG1.IDCT(this.blockData);
			MPEG1.CopyBlockToDestination(this.blockData, destArray, destIndex, scan);
			JSMpeg.Fill(this.blockData, 0);
		}
	}
	else {
		// Add data to the predicted macroblock
		if (n === 1) {
			MPEG1.AddValueToDestination((this.blockData[0] + 128) >> 8, destArray, destIndex, scan);
			this.blockData[0] = 0;
		}
		else {
			MPEG1.IDCT(this.blockData);
			MPEG1.AddBlockToDestination(this.blockData, destArray, destIndex, scan);
			JSMpeg.Fill(this.blockData, 0);
		}
	}

	n = 0;
};

MPEG1.CopyBlockToDestination = function(block, dest, index, scan) {
	for (var n = 0; n < 64; n += 8, index += scan+8) {
		dest[index+0] = block[n+0];
		dest[index+1] = block[n+1];
		dest[index+2] = block[n+2];
		dest[index+3] = block[n+3];
		dest[index+4] = block[n+4];
		dest[index+5] = block[n+5];
		dest[index+6] = block[n+6];
		dest[index+7] = block[n+7];
	}
};

MPEG1.AddBlockToDestination = function(block, dest, index, scan) {
	for (var n = 0; n < 64; n += 8, index += scan+8) {
		dest[index+0] += block[n+0];
		dest[index+1] += block[n+1];
		dest[index+2] += block[n+2];
		dest[index+3] += block[n+3];
		dest[index+4] += block[n+4];
		dest[index+5] += block[n+5];
		dest[index+6] += block[n+6];
		dest[index+7] += block[n+7];
	}
};

MPEG1.CopyValueToDestination = function(value, dest, index, scan) {
	for (var n = 0; n < 64; n += 8, index += scan+8) {
		dest[index+0] = value;
		dest[index+1] = value;
		dest[index+2] = value;
		dest[index+3] = value;
		dest[index+4] = value;
		dest[index+5] = value;
		dest[index+6] = value;
		dest[index+7] = value;
	}
};

MPEG1.AddValueToDestination = function(value, dest, index, scan) {
	for (var n = 0; n < 64; n += 8, index += scan+8) {
		dest[index+0] += value;
		dest[index+1] += value;
		dest[index+2] += value;
		dest[index+3] += value;
		dest[index+4] += value;
		dest[index+5] += value;
		dest[index+6] += value;
		dest[index+7] += value;
	}
};

MPEG1.IDCT = function(block) {
	// See http://vsr.informatik.tu-chemnitz.de/~jan/MPEG/HTML/IDCT.html
	// for more info.

	var
		b1, b3, b4, b6, b7, tmp1, tmp2, m0,
		x0, x1, x2, x3, x4, y3, y4, y5, y6, y7;

	// Transform columns
	for (var i = 0; i < 8; ++i) {
		b1 = block[4*8+i];
		b3 = block[2*8+i] + block[6*8+i];
		b4 = block[5*8+i] - block[3*8+i];
		tmp1 = block[1*8+i] + block[7*8+i];
		tmp2 = block[3*8+i] + block[5*8+i];
		b6 = block[1*8+i] - block[7*8+i];
		b7 = tmp1 + tmp2;
		m0 = block[0*8+i];
		x4 = ((b6*473 - b4*196 + 128) >> 8) - b7;
		x0 = x4 - (((tmp1 - tmp2)*362 + 128) >> 8);
		x1 = m0 - b1;
		x2 = (((block[2*8+i] - block[6*8+i])*362 + 128) >> 8) - b3;
		x3 = m0 + b1;
		y3 = x1 + x2;
		y4 = x3 + b3;
		y5 = x1 - x2;
		y6 = x3 - b3;
		y7 = -x0 - ((b4*473 + b6*196 + 128) >> 8);
		block[0*8+i] = b7 + y4;
		block[1*8+i] = x4 + y3;
		block[2*8+i] = y5 - x0;
		block[3*8+i] = y6 - y7;
		block[4*8+i] = y6 + y7;
		block[5*8+i] = x0 + y5;
		block[6*8+i] = y3 - x4;
		block[7*8+i] = y4 - b7;
	}

	// Transform rows
	for (var i = 0; i < 64; i += 8) {
		b1 = block[4+i];
		b3 = block[2+i] + block[6+i];
		b4 = block[5+i] - block[3+i];
		tmp1 = block[1+i] + block[7+i];
		tmp2 = block[3+i] + block[5+i];
		b6 = block[1+i] - block[7+i];
		b7 = tmp1 + tmp2;
		m0 = block[0+i];
		x4 = ((b6*473 - b4*196 + 128) >> 8) - b7;
		x0 = x4 - (((tmp1 - tmp2)*362 + 128) >> 8);
		x1 = m0 - b1;
		x2 = (((block[2+i] - block[6+i])*362 + 128) >> 8) - b3;
		x3 = m0 + b1;
		y3 = x1 + x2;
		y4 = x3 + b3;
		y5 = x1 - x2;
		y6 = x3 - b3;
		y7 = -x0 - ((b4*473 + b6*196 + 128) >> 8);
		block[0+i] = (b7 + y4 + 128) >> 8;
		block[1+i] = (x4 + y3 + 128) >> 8;
		block[2+i] = (y5 - x0 + 128) >> 8;
		block[3+i] = (y6 - y7 + 128) >> 8;
		block[4+i] = (y6 + y7 + 128) >> 8;
		block[5+i] = (x0 + y5 + 128) >> 8;
		block[6+i] = (y3 - x4 + 128) >> 8;
		block[7+i] = (y4 - b7 + 128) >> 8;
	}
};


// VLC Tables and Constants

MPEG1.PICTURE_RATE = [
	0.000, 23.976, 24.000, 25.000, 29.970, 30.000, 50.000, 59.940,
	60.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000
];

MPEG1.ZIG_ZAG = new Uint8Array([
	 0,  1,  8, 16,  9,  2,  3, 10,
	17, 24, 32, 25, 18, 11,  4,  5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13,  6,  7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63
]);

MPEG1.DEFAULT_INTRA_QUANT_MATRIX = new Uint8Array([
	 8, 16, 19, 22, 26, 27, 29, 34,
	16, 16, 22, 24, 27, 29, 34, 37,
	19, 22, 26, 27, 29, 34, 34, 38,
	22, 22, 26, 27, 29, 34, 37, 40,
	22, 26, 27, 29, 32, 35, 40, 48,
	26, 27, 29, 32, 35, 40, 48, 58,
	26, 27, 29, 34, 38, 46, 56, 69,
	27, 29, 35, 38, 46, 56, 69, 83
]);

MPEG1.DEFAULT_NON_INTRA_QUANT_MATRIX = new Uint8Array([
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16,
	16, 16, 16, 16, 16, 16, 16, 16
]);

MPEG1.PREMULTIPLIER_MATRIX = new Uint8Array([
	32, 44, 42, 38, 32, 25, 17,  9,
	44, 62, 58, 52, 44, 35, 24, 12,
	42, 58, 55, 49, 42, 33, 23, 12,
	38, 52, 49, 44, 38, 30, 20, 10,
	32, 44, 42, 38, 32, 25, 17,  9,
	25, 35, 33, 30, 25, 20, 14,  7,
	17, 24, 23, 20, 17, 14,  9,  5,
	 9, 12, 12, 10,  9,  7,  5,  2
]);

// MPEG-1 VLC

//  macroblock_stuffing decodes as 34.
//  macroblock_escape decodes as 35.

MPEG1.MACROBLOCK_ADDRESS_INCREMENT = new Int16Array([
	 1*3,  2*3,  0, //   0
	 3*3,  4*3,  0, //   1  0
	   0,    0,  1, //   2  1.
	 5*3,  6*3,  0, //   3  00
	 7*3,  8*3,  0, //   4  01
	 9*3, 10*3,  0, //   5  000
	11*3, 12*3,  0, //   6  001
	   0,    0,  3, //   7  010.
	   0,    0,  2, //   8  011.
	13*3, 14*3,  0, //   9  0000
	15*3, 16*3,  0, //  10  0001
	   0,    0,  5, //  11  0010.
	   0,    0,  4, //  12  0011.
	17*3, 18*3,  0, //  13  0000 0
	19*3, 20*3,  0, //  14  0000 1
	   0,    0,  7, //  15  0001 0.
	   0,    0,  6, //  16  0001 1.
	21*3, 22*3,  0, //  17  0000 00
	23*3, 24*3,  0, //  18  0000 01
	25*3, 26*3,  0, //  19  0000 10
	27*3, 28*3,  0, //  20  0000 11
	  -1, 29*3,  0, //  21  0000 000
	  -1, 30*3,  0, //  22  0000 001
	31*3, 32*3,  0, //  23  0000 010
	33*3, 34*3,  0, //  24  0000 011
	35*3, 36*3,  0, //  25  0000 100
	37*3, 38*3,  0, //  26  0000 101
	   0,    0,  9, //  27  0000 110.
	   0,    0,  8, //  28  0000 111.
	39*3, 40*3,  0, //  29  0000 0001
	41*3, 42*3,  0, //  30  0000 0011
	43*3, 44*3,  0, //  31  0000 0100
	45*3, 46*3,  0, //  32  0000 0101
	   0,    0, 15, //  33  0000 0110.
	   0,    0, 14, //  34  0000 0111.
	   0,    0, 13, //  35  0000 1000.
	   0,    0, 12, //  36  0000 1001.
	   0,    0, 11, //  37  0000 1010.
	   0,    0, 10, //  38  0000 1011.
	47*3,   -1,  0, //  39  0000 0001 0
	  -1, 48*3,  0, //  40  0000 0001 1
	49*3, 50*3,  0, //  41  0000 0011 0
	51*3, 52*3,  0, //  42  0000 0011 1
	53*3, 54*3,  0, //  43  0000 0100 0
	55*3, 56*3,  0, //  44  0000 0100 1
	57*3, 58*3,  0, //  45  0000 0101 0
	59*3, 60*3,  0, //  46  0000 0101 1
	61*3,   -1,  0, //  47  0000 0001 00
	  -1, 62*3,  0, //  48  0000 0001 11
	63*3, 64*3,  0, //  49  0000 0011 00
	65*3, 66*3,  0, //  50  0000 0011 01
	67*3, 68*3,  0, //  51  0000 0011 10
	69*3, 70*3,  0, //  52  0000 0011 11
	71*3, 72*3,  0, //  53  0000 0100 00
	73*3, 74*3,  0, //  54  0000 0100 01
	   0,    0, 21, //  55  0000 0100 10.
	   0,    0, 20, //  56  0000 0100 11.
	   0,    0, 19, //  57  0000 0101 00.
	   0,    0, 18, //  58  0000 0101 01.
	   0,    0, 17, //  59  0000 0101 10.
	   0,    0, 16, //  60  0000 0101 11.
	   0,    0, 35, //  61  0000 0001 000. -- macroblock_escape
	   0,    0, 34, //  62  0000 0001 111. -- macroblock_stuffing
	   0,    0, 33, //  63  0000 0011 000.
	   0,    0, 32, //  64  0000 0011 001.
	   0,    0, 31, //  65  0000 0011 010.
	   0,    0, 30, //  66  0000 0011 011.
	   0,    0, 29, //  67  0000 0011 100.
	   0,    0, 28, //  68  0000 0011 101.
	   0,    0, 27, //  69  0000 0011 110.
	   0,    0, 26, //  70  0000 0011 111.
	   0,    0, 25, //  71  0000 0100 000.
	   0,    0, 24, //  72  0000 0100 001.
	   0,    0, 23, //  73  0000 0100 010.
	   0,    0, 22  //  74  0000 0100 011.
]);

//  macroblock_type bitmap:
//    0x10  macroblock_quant
//    0x08  macroblock_motion_forward
//    0x04  macroblock_motion_backward
//    0x02  macrobkock_pattern
//    0x01  macroblock_intra
//

MPEG1.MACROBLOCK_TYPE_INTRA = new Int8Array([
	 1*3,  2*3,     0, //   0
	  -1,  3*3,     0, //   1  0
	   0,    0,  0x01, //   2  1.
	   0,    0,  0x11  //   3  01.
]);

MPEG1.MACROBLOCK_TYPE_PREDICTIVE = new Int8Array([
	 1*3,  2*3,     0, //  0
	 3*3,  4*3,     0, //  1  0
	   0,    0,  0x0a, //  2  1.
	 5*3,  6*3,     0, //  3  00
	   0,    0,  0x02, //  4  01.
	 7*3,  8*3,     0, //  5  000
	   0,    0,  0x08, //  6  001.
	 9*3, 10*3,     0, //  7  0000
	11*3, 12*3,     0, //  8  0001
	  -1, 13*3,     0, //  9  00000
	   0,    0,  0x12, // 10  00001.
	   0,    0,  0x1a, // 11  00010.
	   0,    0,  0x01, // 12  00011.
	   0,    0,  0x11  // 13  000001.
]);

MPEG1.MACROBLOCK_TYPE_B = new Int8Array([
	 1*3,  2*3,     0,  //  0
	 3*3,  5*3,     0,  //  1  0
	 4*3,  6*3,     0,  //  2  1
	 8*3,  7*3,     0,  //  3  00
	   0,    0,  0x0c,  //  4  10.
	 9*3, 10*3,     0,  //  5  01
	   0,    0,  0x0e,  //  6  11.
	13*3, 14*3,     0,  //  7  001
	12*3, 11*3,     0,  //  8  000
	   0,    0,  0x04,  //  9  010.
	   0,    0,  0x06,  // 10  011.
	18*3, 16*3,     0,  // 11  0001
	15*3, 17*3,     0,  // 12  0000
	   0,    0,  0x08,  // 13  0010.
	   0,    0,  0x0a,  // 14  0011.
	  -1, 19*3,     0,  // 15  00000
	   0,    0,  0x01,  // 16  00011.
	20*3, 21*3,     0,  // 17  00001
	   0,    0,  0x1e,  // 18  00010.
	   0,    0,  0x11,  // 19  000001.
	   0,    0,  0x16,  // 20  000010.
	   0,    0,  0x1a   // 21  000011.
]);

MPEG1.MACROBLOCK_TYPE = [
	null,
	MPEG1.MACROBLOCK_TYPE_INTRA,
	MPEG1.MACROBLOCK_TYPE_PREDICTIVE,
	MPEG1.MACROBLOCK_TYPE_B
];

MPEG1.CODE_BLOCK_PATTERN = new Int16Array([
	  2*3,   1*3,   0,  //   0
	  3*3,   6*3,   0,  //   1  1
	  4*3,   5*3,   0,  //   2  0
	  8*3,  11*3,   0,  //   3  10
	 12*3,  13*3,   0,  //   4  00
	  9*3,   7*3,   0,  //   5  01
	 10*3,  14*3,   0,  //   6  11
	 20*3,  19*3,   0,  //   7  011
	 18*3,  16*3,   0,  //   8  100
	 23*3,  17*3,   0,  //   9  010
	 27*3,  25*3,   0,  //  10  110
	 21*3,  28*3,   0,  //  11  101
	 15*3,  22*3,   0,  //  12  000
	 24*3,  26*3,   0,  //  13  001
	    0,     0,  60,  //  14  111.
	 35*3,  40*3,   0,  //  15  0000
	 44*3,  48*3,   0,  //  16  1001
	 38*3,  36*3,   0,  //  17  0101
	 42*3,  47*3,   0,  //  18  1000
	 29*3,  31*3,   0,  //  19  0111
	 39*3,  32*3,   0,  //  20  0110
	    0,     0,  32,  //  21  1010.
	 45*3,  46*3,   0,  //  22  0001
	 33*3,  41*3,   0,  //  23  0100
	 43*3,  34*3,   0,  //  24  0010
	    0,     0,   4,  //  25  1101.
	 30*3,  37*3,   0,  //  26  0011
	    0,     0,   8,  //  27  1100.
	    0,     0,  16,  //  28  1011.
	    0,     0,  44,  //  29  0111 0.
	 50*3,  56*3,   0,  //  30  0011 0
	    0,     0,  28,  //  31  0111 1.
	    0,     0,  52,  //  32  0110 1.
	    0,     0,  62,  //  33  0100 0.
	 61*3,  59*3,   0,  //  34  0010 1
	 52*3,  60*3,   0,  //  35  0000 0
	    0,     0,   1,  //  36  0101 1.
	 55*3,  54*3,   0,  //  37  0011 1
	    0,     0,  61,  //  38  0101 0.
	    0,     0,  56,  //  39  0110 0.
	 57*3,  58*3,   0,  //  40  0000 1
	    0,     0,   2,  //  41  0100 1.
	    0,     0,  40,  //  42  1000 0.
	 51*3,  62*3,   0,  //  43  0010 0
	    0,     0,  48,  //  44  1001 0.
	 64*3,  63*3,   0,  //  45  0001 0
	 49*3,  53*3,   0,  //  46  0001 1
	    0,     0,  20,  //  47  1000 1.
	    0,     0,  12,  //  48  1001 1.
	 80*3,  83*3,   0,  //  49  0001 10
	    0,     0,  63,  //  50  0011 00.
	 77*3,  75*3,   0,  //  51  0010 00
	 65*3,  73*3,   0,  //  52  0000 00
	 84*3,  66*3,   0,  //  53  0001 11
	    0,     0,  24,  //  54  0011 11.
	    0,     0,  36,  //  55  0011 10.
	    0,     0,   3,  //  56  0011 01.
	 69*3,  87*3,   0,  //  57  0000 10
	 81*3,  79*3,   0,  //  58  0000 11
	 68*3,  71*3,   0,  //  59  0010 11
	 70*3,  78*3,   0,  //  60  0000 01
	 67*3,  76*3,   0,  //  61  0010 10
	 72*3,  74*3,   0,  //  62  0010 01
	 86*3,  85*3,   0,  //  63  0001 01
	 88*3,  82*3,   0,  //  64  0001 00
	   -1,  94*3,   0,  //  65  0000 000
	 95*3,  97*3,   0,  //  66  0001 111
	    0,     0,  33,  //  67  0010 100.
	    0,     0,   9,  //  68  0010 110.
	106*3, 110*3,   0,  //  69  0000 100
	102*3, 116*3,   0,  //  70  0000 010
	    0,     0,   5,  //  71  0010 111.
	    0,     0,  10,  //  72  0010 010.
	 93*3,  89*3,   0,  //  73  0000 001
	    0,     0,   6,  //  74  0010 011.
	    0,     0,  18,  //  75  0010 001.
	    0,     0,  17,  //  76  0010 101.
	    0,     0,  34,  //  77  0010 000.
	113*3, 119*3,   0,  //  78  0000 011
	103*3, 104*3,   0,  //  79  0000 111
	 90*3,  92*3,   0,  //  80  0001 100
	109*3, 107*3,   0,  //  81  0000 110
	117*3, 118*3,   0,  //  82  0001 001
	101*3,  99*3,   0,  //  83  0001 101
	 98*3,  96*3,   0,  //  84  0001 110
	100*3,  91*3,   0,  //  85  0001 011
	114*3, 115*3,   0,  //  86  0001 010
	105*3, 108*3,   0,  //  87  0000 101
	112*3, 111*3,   0,  //  88  0001 000
	121*3, 125*3,   0,  //  89  0000 0011
	    0,     0,  41,  //  90  0001 1000.
	    0,     0,  14,  //  91  0001 0111.
	    0,     0,  21,  //  92  0001 1001.
	124*3, 122*3,   0,  //  93  0000 0010
	120*3, 123*3,   0,  //  94  0000 0001
	    0,     0,  11,  //  95  0001 1110.
	    0,     0,  19,  //  96  0001 1101.
	    0,     0,   7,  //  97  0001 1111.
	    0,     0,  35,  //  98  0001 1100.
	    0,     0,  13,  //  99  0001 1011.
	    0,     0,  50,  // 100  0001 0110.
	    0,     0,  49,  // 101  0001 1010.
	    0,     0,  58,  // 102  0000 0100.
	    0,     0,  37,  // 103  0000 1110.
	    0,     0,  25,  // 104  0000 1111.
	    0,     0,  45,  // 105  0000 1010.
	    0,     0,  57,  // 106  0000 1000.
	    0,     0,  26,  // 107  0000 1101.
	    0,     0,  29,  // 108  0000 1011.
	    0,     0,  38,  // 109  0000 1100.
	    0,     0,  53,  // 110  0000 1001.
	    0,     0,  23,  // 111  0001 0001.
	    0,     0,  43,  // 112  0001 0000.
	    0,     0,  46,  // 113  0000 0110.
	    0,     0,  42,  // 114  0001 0100.
	    0,     0,  22,  // 115  0001 0101.
	    0,     0,  54,  // 116  0000 0101.
	    0,     0,  51,  // 117  0001 0010.
	    0,     0,  15,  // 118  0001 0011.
	    0,     0,  30,  // 119  0000 0111.
	    0,     0,  39,  // 120  0000 0001 0.
	    0,     0,  47,  // 121  0000 0011 0.
	    0,     0,  55,  // 122  0000 0010 1.
	    0,     0,  27,  // 123  0000 0001 1.
	    0,     0,  59,  // 124  0000 0010 0.
	    0,     0,  31   // 125  0000 0011 1.
]);

MPEG1.MOTION = new Int16Array([
	  1*3,   2*3,   0,  //   0
	  4*3,   3*3,   0,  //   1  0
	    0,     0,   0,  //   2  1.
	  6*3,   5*3,   0,  //   3  01
	  8*3,   7*3,   0,  //   4  00
	    0,     0,  -1,  //   5  011.
	    0,     0,   1,  //   6  010.
	  9*3,  10*3,   0,  //   7  001
	 12*3,  11*3,   0,  //   8  000
	    0,     0,   2,  //   9  0010.
	    0,     0,  -2,  //  10  0011.
	 14*3,  15*3,   0,  //  11  0001
	 16*3,  13*3,   0,  //  12  0000
	 20*3,  18*3,   0,  //  13  0000 1
	    0,     0,   3,  //  14  0001 0.
	    0,     0,  -3,  //  15  0001 1.
	 17*3,  19*3,   0,  //  16  0000 0
	   -1,  23*3,   0,  //  17  0000 00
	 27*3,  25*3,   0,  //  18  0000 11
	 26*3,  21*3,   0,  //  19  0000 01
	 24*3,  22*3,   0,  //  20  0000 10
	 32*3,  28*3,   0,  //  21  0000 011
	 29*3,  31*3,   0,  //  22  0000 101
	   -1,  33*3,   0,  //  23  0000 001
	 36*3,  35*3,   0,  //  24  0000 100
	    0,     0,  -4,  //  25  0000 111.
	 30*3,  34*3,   0,  //  26  0000 010
	    0,     0,   4,  //  27  0000 110.
	    0,     0,  -7,  //  28  0000 0111.
	    0,     0,   5,  //  29  0000 1010.
	 37*3,  41*3,   0,  //  30  0000 0100
	    0,     0,  -5,  //  31  0000 1011.
	    0,     0,   7,  //  32  0000 0110.
	 38*3,  40*3,   0,  //  33  0000 0011
	 42*3,  39*3,   0,  //  34  0000 0101
	    0,     0,  -6,  //  35  0000 1001.
	    0,     0,   6,  //  36  0000 1000.
	 51*3,  54*3,   0,  //  37  0000 0100 0
	 50*3,  49*3,   0,  //  38  0000 0011 0
	 45*3,  46*3,   0,  //  39  0000 0101 1
	 52*3,  47*3,   0,  //  40  0000 0011 1
	 43*3,  53*3,   0,  //  41  0000 0100 1
	 44*3,  48*3,   0,  //  42  0000 0101 0
	    0,     0,  10,  //  43  0000 0100 10.
	    0,     0,   9,  //  44  0000 0101 00.
	    0,     0,   8,  //  45  0000 0101 10.
	    0,     0,  -8,  //  46  0000 0101 11.
	 57*3,  66*3,   0,  //  47  0000 0011 11
	    0,     0,  -9,  //  48  0000 0101 01.
	 60*3,  64*3,   0,  //  49  0000 0011 01
	 56*3,  61*3,   0,  //  50  0000 0011 00
	 55*3,  62*3,   0,  //  51  0000 0100 00
	 58*3,  63*3,   0,  //  52  0000 0011 10
	    0,     0, -10,  //  53  0000 0100 11.
	 59*3,  65*3,   0,  //  54  0000 0100 01
	    0,     0,  12,  //  55  0000 0100 000.
	    0,     0,  16,  //  56  0000 0011 000.
	    0,     0,  13,  //  57  0000 0011 110.
	    0,     0,  14,  //  58  0000 0011 100.
	    0,     0,  11,  //  59  0000 0100 010.
	    0,     0,  15,  //  60  0000 0011 010.
	    0,     0, -16,  //  61  0000 0011 001.
	    0,     0, -12,  //  62  0000 0100 001.
	    0,     0, -14,  //  63  0000 0011 101.
	    0,     0, -15,  //  64  0000 0011 011.
	    0,     0, -11,  //  65  0000 0100 011.
	    0,     0, -13   //  66  0000 0011 111.
]);

MPEG1.DCT_DC_SIZE_LUMINANCE = new Int8Array([
	  2*3,   1*3, 0,  //   0
	  6*3,   5*3, 0,  //   1  1
	  3*3,   4*3, 0,  //   2  0
	    0,     0, 1,  //   3  00.
	    0,     0, 2,  //   4  01.
	  9*3,   8*3, 0,  //   5  11
	  7*3,  10*3, 0,  //   6  10
	    0,     0, 0,  //   7  100.
	 12*3,  11*3, 0,  //   8  111
	    0,     0, 4,  //   9  110.
	    0,     0, 3,  //  10  101.
	 13*3,  14*3, 0,  //  11  1111
	    0,     0, 5,  //  12  1110.
	    0,     0, 6,  //  13  1111 0.
	 16*3,  15*3, 0,  //  14  1111 1
	 17*3,    -1, 0,  //  15  1111 11
	    0,     0, 7,  //  16  1111 10.
	    0,     0, 8   //  17  1111 110.
]);

MPEG1.DCT_DC_SIZE_CHROMINANCE = new Int8Array([
	  2*3,   1*3, 0,  //   0
	  4*3,   3*3, 0,  //   1  1
	  6*3,   5*3, 0,  //   2  0
	  8*3,   7*3, 0,  //   3  11
	    0,     0, 2,  //   4  10.
	    0,     0, 1,  //   5  01.
	    0,     0, 0,  //   6  00.
	 10*3,   9*3, 0,  //   7  111
	    0,     0, 3,  //   8  110.
	 12*3,  11*3, 0,  //   9  1111
	    0,     0, 4,  //  10  1110.
	 14*3,  13*3, 0,  //  11  1111 1
	    0,     0, 5,  //  12  1111 0.
	 16*3,  15*3, 0,  //  13  1111 11
	    0,     0, 6,  //  14  1111 10.
	 17*3,    -1, 0,  //  15  1111 111
	    0,     0, 7,  //  16  1111 110.
	    0,     0, 8   //  17  1111 1110.
]);

//  dct_coeff bitmap:
//    0xff00  run
//    0x00ff  level

//  Decoded values are unsigned. Sign bit follows in the stream.

//  Interpretation of the value 0x0001
//    for dc_coeff_first:  run=0, level=1
//    for dc_coeff_next:   If the next bit is 1: run=0, level=1
//                         If the next bit is 0: end_of_block

//  escape decodes as 0xffff.

MPEG1.DCT_COEFF = new Int32Array([
	  1*3,   2*3,      0,  //   0
	  4*3,   3*3,      0,  //   1  0
	    0,     0, 0x0001,  //   2  1.
	  7*3,   8*3,      0,  //   3  01
	  6*3,   5*3,      0,  //   4  00
	 13*3,   9*3,      0,  //   5  001
	 11*3,  10*3,      0,  //   6  000
	 14*3,  12*3,      0,  //   7  010
	    0,     0, 0x0101,  //   8  011.
	 20*3,  22*3,      0,  //   9  0011
	 18*3,  21*3,      0,  //  10  0001
	 16*3,  19*3,      0,  //  11  0000
	    0,     0, 0x0201,  //  12  0101.
	 17*3,  15*3,      0,  //  13  0010
	    0,     0, 0x0002,  //  14  0100.
	    0,     0, 0x0003,  //  15  0010 1.
	 27*3,  25*3,      0,  //  16  0000 0
	 29*3,  31*3,      0,  //  17  0010 0
	 24*3,  26*3,      0,  //  18  0001 0
	 32*3,  30*3,      0,  //  19  0000 1
	    0,     0, 0x0401,  //  20  0011 0.
	 23*3,  28*3,      0,  //  21  0001 1
	    0,     0, 0x0301,  //  22  0011 1.
	    0,     0, 0x0102,  //  23  0001 10.
	    0,     0, 0x0701,  //  24  0001 00.
	    0,     0, 0xffff,  //  25  0000 01. -- escape
	    0,     0, 0x0601,  //  26  0001 01.
	 37*3,  36*3,      0,  //  27  0000 00
	    0,     0, 0x0501,  //  28  0001 11.
	 35*3,  34*3,      0,  //  29  0010 00
	 39*3,  38*3,      0,  //  30  0000 11
	 33*3,  42*3,      0,  //  31  0010 01
	 40*3,  41*3,      0,  //  32  0000 10
	 52*3,  50*3,      0,  //  33  0010 010
	 54*3,  53*3,      0,  //  34  0010 001
	 48*3,  49*3,      0,  //  35  0010 000
	 43*3,  45*3,      0,  //  36  0000 001
	 46*3,  44*3,      0,  //  37  0000 000
	    0,     0, 0x0801,  //  38  0000 111.
	    0,     0, 0x0004,  //  39  0000 110.
	    0,     0, 0x0202,  //  40  0000 100.
	    0,     0, 0x0901,  //  41  0000 101.
	 51*3,  47*3,      0,  //  42  0010 011
	 55*3,  57*3,      0,  //  43  0000 0010
	 60*3,  56*3,      0,  //  44  0000 0001
	 59*3,  58*3,      0,  //  45  0000 0011
	 61*3,  62*3,      0,  //  46  0000 0000
	    0,     0, 0x0a01,  //  47  0010 0111.
	    0,     0, 0x0d01,  //  48  0010 0000.
	    0,     0, 0x0006,  //  49  0010 0001.
	    0,     0, 0x0103,  //  50  0010 0101.
	    0,     0, 0x0005,  //  51  0010 0110.
	    0,     0, 0x0302,  //  52  0010 0100.
	    0,     0, 0x0b01,  //  53  0010 0011.
	    0,     0, 0x0c01,  //  54  0010 0010.
	 76*3,  75*3,      0,  //  55  0000 0010 0
	 67*3,  70*3,      0,  //  56  0000 0001 1
	 73*3,  71*3,      0,  //  57  0000 0010 1
	 78*3,  74*3,      0,  //  58  0000 0011 1
	 72*3,  77*3,      0,  //  59  0000 0011 0
	 69*3,  64*3,      0,  //  60  0000 0001 0
	 68*3,  63*3,      0,  //  61  0000 0000 0
	 66*3,  65*3,      0,  //  62  0000 0000 1
	 81*3,  87*3,      0,  //  63  0000 0000 01
	 91*3,  80*3,      0,  //  64  0000 0001 01
	 82*3,  79*3,      0,  //  65  0000 0000 11
	 83*3,  86*3,      0,  //  66  0000 0000 10
	 93*3,  92*3,      0,  //  67  0000 0001 10
	 84*3,  85*3,      0,  //  68  0000 0000 00
	 90*3,  94*3,      0,  //  69  0000 0001 00
	 88*3,  89*3,      0,  //  70  0000 0001 11
	    0,     0, 0x0203,  //  71  0000 0010 11.
	    0,     0, 0x0104,  //  72  0000 0011 00.
	    0,     0, 0x0007,  //  73  0000 0010 10.
	    0,     0, 0x0402,  //  74  0000 0011 11.
	    0,     0, 0x0502,  //  75  0000 0010 01.
	    0,     0, 0x1001,  //  76  0000 0010 00.
	    0,     0, 0x0f01,  //  77  0000 0011 01.
	    0,     0, 0x0e01,  //  78  0000 0011 10.
	105*3, 107*3,      0,  //  79  0000 0000 111
	111*3, 114*3,      0,  //  80  0000 0001 011
	104*3,  97*3,      0,  //  81  0000 0000 010
	125*3, 119*3,      0,  //  82  0000 0000 110
	 96*3,  98*3,      0,  //  83  0000 0000 100
	   -1, 123*3,      0,  //  84  0000 0000 000
	 95*3, 101*3,      0,  //  85  0000 0000 001
	106*3, 121*3,      0,  //  86  0000 0000 101
	 99*3, 102*3,      0,  //  87  0000 0000 011
	113*3, 103*3,      0,  //  88  0000 0001 110
	112*3, 116*3,      0,  //  89  0000 0001 111
	110*3, 100*3,      0,  //  90  0000 0001 000
	124*3, 115*3,      0,  //  91  0000 0001 010
	117*3, 122*3,      0,  //  92  0000 0001 101
	109*3, 118*3,      0,  //  93  0000 0001 100
	120*3, 108*3,      0,  //  94  0000 0001 001
	127*3, 136*3,      0,  //  95  0000 0000 0010
	139*3, 140*3,      0,  //  96  0000 0000 1000
	130*3, 126*3,      0,  //  97  0000 0000 0101
	145*3, 146*3,      0,  //  98  0000 0000 1001
	128*3, 129*3,      0,  //  99  0000 0000 0110
	    0,     0, 0x0802,  // 100  0000 0001 0001.
	132*3, 134*3,      0,  // 101  0000 0000 0011
	155*3, 154*3,      0,  // 102  0000 0000 0111
	    0,     0, 0x0008,  // 103  0000 0001 1101.
	137*3, 133*3,      0,  // 104  0000 0000 0100
	143*3, 144*3,      0,  // 105  0000 0000 1110
	151*3, 138*3,      0,  // 106  0000 0000 1010
	142*3, 141*3,      0,  // 107  0000 0000 1111
	    0,     0, 0x000a,  // 108  0000 0001 0011.
	    0,     0, 0x0009,  // 109  0000 0001 1000.
	    0,     0, 0x000b,  // 110  0000 0001 0000.
	    0,     0, 0x1501,  // 111  0000 0001 0110.
	    0,     0, 0x0602,  // 112  0000 0001 1110.
	    0,     0, 0x0303,  // 113  0000 0001 1100.
	    0,     0, 0x1401,  // 114  0000 0001 0111.
	    0,     0, 0x0702,  // 115  0000 0001 0101.
	    0,     0, 0x1101,  // 116  0000 0001 1111.
	    0,     0, 0x1201,  // 117  0000 0001 1010.
	    0,     0, 0x1301,  // 118  0000 0001 1001.
	148*3, 152*3,      0,  // 119  0000 0000 1101
	    0,     0, 0x0403,  // 120  0000 0001 0010.
	153*3, 150*3,      0,  // 121  0000 0000 1011
	    0,     0, 0x0105,  // 122  0000 0001 1011.
	131*3, 135*3,      0,  // 123  0000 0000 0001
	    0,     0, 0x0204,  // 124  0000 0001 0100.
	149*3, 147*3,      0,  // 125  0000 0000 1100
	172*3, 173*3,      0,  // 126  0000 0000 0101 1
	162*3, 158*3,      0,  // 127  0000 0000 0010 0
	170*3, 161*3,      0,  // 128  0000 0000 0110 0
	168*3, 166*3,      0,  // 129  0000 0000 0110 1
	157*3, 179*3,      0,  // 130  0000 0000 0101 0
	169*3, 167*3,      0,  // 131  0000 0000 0001 0
	174*3, 171*3,      0,  // 132  0000 0000 0011 0
	178*3, 177*3,      0,  // 133  0000 0000 0100 1
	156*3, 159*3,      0,  // 134  0000 0000 0011 1
	164*3, 165*3,      0,  // 135  0000 0000 0001 1
	183*3, 182*3,      0,  // 136  0000 0000 0010 1
	175*3, 176*3,      0,  // 137  0000 0000 0100 0
	    0,     0, 0x0107,  // 138  0000 0000 1010 1.
	    0,     0, 0x0a02,  // 139  0000 0000 1000 0.
	    0,     0, 0x0902,  // 140  0000 0000 1000 1.
	    0,     0, 0x1601,  // 141  0000 0000 1111 1.
	    0,     0, 0x1701,  // 142  0000 0000 1111 0.
	    0,     0, 0x1901,  // 143  0000 0000 1110 0.
	    0,     0, 0x1801,  // 144  0000 0000 1110 1.
	    0,     0, 0x0503,  // 145  0000 0000 1001 0.
	    0,     0, 0x0304,  // 146  0000 0000 1001 1.
	    0,     0, 0x000d,  // 147  0000 0000 1100 1.
	    0,     0, 0x000c,  // 148  0000 0000 1101 0.
	    0,     0, 0x000e,  // 149  0000 0000 1100 0.
	    0,     0, 0x000f,  // 150  0000 0000 1011 1.
	    0,     0, 0x0205,  // 151  0000 0000 1010 0.
	    0,     0, 0x1a01,  // 152  0000 0000 1101 1.
	    0,     0, 0x0106,  // 153  0000 0000 1011 0.
	180*3, 181*3,      0,  // 154  0000 0000 0111 1
	160*3, 163*3,      0,  // 155  0000 0000 0111 0
	196*3, 199*3,      0,  // 156  0000 0000 0011 10
	    0,     0, 0x001b,  // 157  0000 0000 0101 00.
	203*3, 185*3,      0,  // 158  0000 0000 0010 01
	202*3, 201*3,      0,  // 159  0000 0000 0011 11
	    0,     0, 0x0013,  // 160  0000 0000 0111 00.
	    0,     0, 0x0016,  // 161  0000 0000 0110 01.
	197*3, 207*3,      0,  // 162  0000 0000 0010 00
	    0,     0, 0x0012,  // 163  0000 0000 0111 01.
	191*3, 192*3,      0,  // 164  0000 0000 0001 10
	188*3, 190*3,      0,  // 165  0000 0000 0001 11
	    0,     0, 0x0014,  // 166  0000 0000 0110 11.
	184*3, 194*3,      0,  // 167  0000 0000 0001 01
	    0,     0, 0x0015,  // 168  0000 0000 0110 10.
	186*3, 193*3,      0,  // 169  0000 0000 0001 00
	    0,     0, 0x0017,  // 170  0000 0000 0110 00.
	204*3, 198*3,      0,  // 171  0000 0000 0011 01
	    0,     0, 0x0019,  // 172  0000 0000 0101 10.
	    0,     0, 0x0018,  // 173  0000 0000 0101 11.
	200*3, 205*3,      0,  // 174  0000 0000 0011 00
	    0,     0, 0x001f,  // 175  0000 0000 0100 00.
	    0,     0, 0x001e,  // 176  0000 0000 0100 01.
	    0,     0, 0x001c,  // 177  0000 0000 0100 11.
	    0,     0, 0x001d,  // 178  0000 0000 0100 10.
	    0,     0, 0x001a,  // 179  0000 0000 0101 01.
	    0,     0, 0x0011,  // 180  0000 0000 0111 10.
	    0,     0, 0x0010,  // 181  0000 0000 0111 11.
	189*3, 206*3,      0,  // 182  0000 0000 0010 11
	187*3, 195*3,      0,  // 183  0000 0000 0010 10
	218*3, 211*3,      0,  // 184  0000 0000 0001 010
	    0,     0, 0x0025,  // 185  0000 0000 0010 011.
	215*3, 216*3,      0,  // 186  0000 0000 0001 000
	    0,     0, 0x0024,  // 187  0000 0000 0010 100.
	210*3, 212*3,      0,  // 188  0000 0000 0001 110
	    0,     0, 0x0022,  // 189  0000 0000 0010 110.
	213*3, 209*3,      0,  // 190  0000 0000 0001 111
	221*3, 222*3,      0,  // 191  0000 0000 0001 100
	219*3, 208*3,      0,  // 192  0000 0000 0001 101
	217*3, 214*3,      0,  // 193  0000 0000 0001 001
	223*3, 220*3,      0,  // 194  0000 0000 0001 011
	    0,     0, 0x0023,  // 195  0000 0000 0010 101.
	    0,     0, 0x010b,  // 196  0000 0000 0011 100.
	    0,     0, 0x0028,  // 197  0000 0000 0010 000.
	    0,     0, 0x010c,  // 198  0000 0000 0011 011.
	    0,     0, 0x010a,  // 199  0000 0000 0011 101.
	    0,     0, 0x0020,  // 200  0000 0000 0011 000.
	    0,     0, 0x0108,  // 201  0000 0000 0011 111.
	    0,     0, 0x0109,  // 202  0000 0000 0011 110.
	    0,     0, 0x0026,  // 203  0000 0000 0010 010.
	    0,     0, 0x010d,  // 204  0000 0000 0011 010.
	    0,     0, 0x010e,  // 205  0000 0000 0011 001.
	    0,     0, 0x0021,  // 206  0000 0000 0010 111.
	    0,     0, 0x0027,  // 207  0000 0000 0010 001.
	    0,     0, 0x1f01,  // 208  0000 0000 0001 1011.
	    0,     0, 0x1b01,  // 209  0000 0000 0001 1111.
	    0,     0, 0x1e01,  // 210  0000 0000 0001 1100.
	    0,     0, 0x1002,  // 211  0000 0000 0001 0101.
	    0,     0, 0x1d01,  // 212  0000 0000 0001 1101.
	    0,     0, 0x1c01,  // 213  0000 0000 0001 1110.
	    0,     0, 0x010f,  // 214  0000 0000 0001 0011.
	    0,     0, 0x0112,  // 215  0000 0000 0001 0000.
	    0,     0, 0x0111,  // 216  0000 0000 0001 0001.
	    0,     0, 0x0110,  // 217  0000 0000 0001 0010.
	    0,     0, 0x0603,  // 218  0000 0000 0001 0100.
	    0,     0, 0x0b02,  // 219  0000 0000 0001 1010.
	    0,     0, 0x0e02,  // 220  0000 0000 0001 0111.
	    0,     0, 0x0d02,  // 221  0000 0000 0001 1000.
	    0,     0, 0x0c02,  // 222  0000 0000 0001 1001.
	    0,     0, 0x0f02   // 223  0000 0000 0001 0110.
]);

MPEG1.PICTURE_TYPE = {
	INTRA: 1,
	PREDICTIVE: 2,
	B: 3
};

MPEG1.START = {
	SEQUENCE: 0xB3,
	SLICE_FIRST: 0x01,
	SLICE_LAST: 0xAF,
	PICTURE: 0x00,
	EXTENSION: 0xB5,
	USER_DATA: 0xB2
};

return MPEG1;

})();

JSMpeg.Decoder.MP2Audio = (function(){ "use strict";

// Based on kjmp2 by Martin J. Fiedler
// http://keyj.emphy.de/kjmp2/

var MP2 = function(options) {
	JSMpeg.Decoder.Base.call(this, options);

	this.onDecodeCallback = options.onAudioDecode;

	var bufferSize = options.audioBufferSize || 128*1024;
	var bufferMode = options.streaming
		? JSMpeg.BitBuffer.MODE.EVICT
		: JSMpeg.BitBuffer.MODE.EXPAND;

	this.bits = new JSMpeg.BitBuffer(bufferSize, bufferMode);

	this.left = new Float32Array(1152);
	this.right = new Float32Array(1152);
	this.sampleRate = 44100;
	
	this.D = new Float32Array(1024);
	this.D.set(MP2.SYNTHESIS_WINDOW, 0);
	this.D.set(MP2.SYNTHESIS_WINDOW, 512);
	this.V = [new Float32Array(1024), new Float32Array(1024)];
	this.U = new Int32Array(32);
	this.VPos = 0;

	this.allocation = [new Array(32), new Array(32)];
	this.scaleFactorInfo = [new Uint8Array(32), new Uint8Array(32)];
	this.scaleFactor = [new Array(32), new Array(32)];
	this.sample = [new Array(32), new Array(32)];
	
	for (var j = 0; j < 2; j++) {
		for (var i = 0; i < 32; i++) {
			this.scaleFactor[j][i] = [0, 0, 0];
			this.sample[j][i] = [0, 0, 0];
		}
	}
};

MP2.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
MP2.prototype.constructor = MP2;

MP2.prototype.decode = function() {
	var startTime = JSMpeg.Now();

	var pos = this.bits.index >> 3;
	if (pos >= this.bits.byteLength) {
		return false;
	}

	var decoded = this.decodeFrame(this.left, this.right);
	// [LE2] lost sync (decodeFrame returned -1): skip a byte at a time until the next frame header
	while (decoded < 0 && pos + 1 < this.bits.byteLength) {
		pos++;
		this.bits.index = pos << 3;
		decoded = this.decodeFrame(this.left, this.right);
	}
	if (decoded < 0) {
		decoded = 0;
	}
	this.bits.index = (pos + decoded) << 3;
	if (!decoded) {
		return false;
	}

	if (this.destination) {
		this.destination.play(this.sampleRate, this.left, this.right);
	}

	this.advanceDecodedTime(this.left.length / this.sampleRate);

	var elapsedTime = JSMpeg.Now() - startTime;
	if (this.onDecodeCallback) {
		this.onDecodeCallback(this, elapsedTime);
	}
	return true;
};

MP2.prototype.getCurrentTime = function() {
	var enqueuedTime = this.destination ? this.destination.enqueuedTime : 0;
	return this.decodedTime - enqueuedTime;
};

MP2.prototype.decodeFrame = function(left, right) {
	var frameStart = this.bits.index >> 3; // [LE2]
	if (frameStart + 4 > this.bits.byteLength) {
		return 0; // [LE2] header not completely buffered yet
	}

	// Check for valid header: syncword OK, MPEG-Audio Layer 2
	var sync = this.bits.read(11),
		version = this.bits.read(2),
		layer = this.bits.read(2),
		hasCRC = !this.bits.read(1);

	if (
		sync !== MP2.FRAME_SYNC ||
		version !== MP2.VERSION.MPEG_1 ||
		layer !== MP2.LAYER.II
	) {
		return -1; // Invalid header or unsupported version [LE2: -1 = lost sync]
	}

	var bitrateIndex = this.bits.read(4) - 1;
	if (bitrateIndex < 0 || bitrateIndex > 13) {
		return -1;  // Invalid bit rate or 'free format' [LE2]
	}

	var sampleRateIndex = this.bits.read(2);
	var sampleRate = MP2.SAMPLE_RATE[sampleRateIndex];
	if (sampleRateIndex === 3) {
		return -1; // Invalid sample rate [LE2]
	}
	if (version === MP2.VERSION.MPEG_2) {
		sampleRateIndex += 4;
		bitrateIndex += 14;
	}
	var padding = this.bits.read(1),
		privat = this.bits.read(1),
		mode = this.bits.read(2);

	// Parse the mode_extension, set up the stereo bound
	var bound = 0;
	if (mode === MP2.MODE.JOINT_STEREO) {
		bound = (this.bits.read(2) + 1) << 2;
	}
	else {
		this.bits.skip(2);
		bound = (mode === MP2.MODE.MONO) ? 0 : 32;
	}

	// Discard the last 4 bits of the header and the CRC value, if present
	this.bits.skip(4);
	if (hasCRC) {
		this.bits.skip(16);
	}

	// Compute the frame size
	var bitrate = MP2.BIT_RATE[bitrateIndex],
		sampleRate = MP2.SAMPLE_RATE[sampleRateIndex],
		frameSize = ((144000 * bitrate / sampleRate) + padding)|0;

	// [LE2] a frame must be completely buffered before it is decoded (the data arrives progressively)
	if (frameStart + frameSize > this.bits.byteLength) {
		return 0;
	}
	

	// Prepare the quantizer table lookups
	var tab3 = 0;
	var sblimit = 0;
	if (version === MP2.VERSION.MPEG_2) {
		// MPEG-2 (LSR)
		tab3 = 2;
		sblimit = 30;
	}
	else {
		// MPEG-1
		var tab1 = (mode === MP2.MODE.MONO) ? 0 : 1;
		var tab2 = MP2.QUANT_LUT_STEP_1[tab1][bitrateIndex];
		tab3 = MP2.QUANT_LUT_STEP_2[tab2][sampleRateIndex];
		sblimit = tab3 & 63;
		tab3 >>= 6;
	}

	if (bound > sblimit) {
		bound = sblimit;
	}

	// Read the allocation information
	for (var sb = 0; sb < bound; sb++) {
		this.allocation[0][sb] = this.readAllocation(sb, tab3);
		this.allocation[1][sb] = this.readAllocation(sb, tab3);
	}

	for (var sb = bound; sb < sblimit; sb++) {
		this.allocation[0][sb] = 
			this.allocation[1][sb] =
			this.readAllocation(sb, tab3);
	}

	// Read scale factor selector information
	var channels = (mode === MP2.MODE.MONO) ? 1 : 2;
	for (var sb = 0;  sb < sblimit; sb++) {
		for (ch = 0;  ch < channels; ch++) {
			if (this.allocation[ch][sb]) {
				this.scaleFactorInfo[ch][sb] = this.bits.read(2);
			}
		}
		if (mode === MP2.MODE.MONO) {
			this.scaleFactorInfo[1][sb] = this.scaleFactorInfo[0][sb];
		}
	}

	// Read scale factors
	for (var sb = 0;  sb < sblimit; sb++) {
		for (var ch = 0;  ch < channels; ch++) {
			if (this.allocation[ch][sb]) {
				var sf = this.scaleFactor[ch][sb];
				switch (this.scaleFactorInfo[ch][sb]) {
					case 0:
						sf[0] = this.bits.read(6);
						sf[1] = this.bits.read(6);
						sf[2] = this.bits.read(6);
						break;
					case 1:
						sf[0] =
						sf[1] = this.bits.read(6);
						sf[2] = this.bits.read(6);
						break;
					case 2:
						sf[0] =
						sf[1] =
						sf[2] = this.bits.read(6);
						break;
					case 3:
						sf[0] = this.bits.read(6);
						sf[1] =
						sf[2] = this.bits.read(6);
						break;
				}
			}
		}
		if (mode === MP2.MODE.MONO) {
			this.scaleFactor[1][sb][0] = this.scaleFactor[0][sb][0];
			this.scaleFactor[1][sb][1] = this.scaleFactor[0][sb][1];
			this.scaleFactor[1][sb][2] = this.scaleFactor[0][sb][2];
		}
	}

	// Coefficient input and reconstruction
	var outPos = 0;
	for (var part = 0; part < 3; part++) {
		for (var granule = 0; granule < 4; granule++) {

			// Read the samples
			for (var sb = 0; sb < bound; sb++) {
				this.readSamples(0, sb, part);
				this.readSamples(1, sb, part);
			}
			for (var sb = bound; sb < sblimit; sb++) {
				this.readSamplesShared(sb, part); // [LE2]
			}
			for (var sb = sblimit; sb < 32; sb++) {
				this.sample[0][sb][0] = 0;
				this.sample[0][sb][1] = 0;
				this.sample[0][sb][2] = 0;
				this.sample[1][sb][0] = 0;
				this.sample[1][sb][1] = 0;
				this.sample[1][sb][2] = 0;
			}

			// Synthesis loop
			for (var p = 0; p < 3; p++) {
				// Shifting step
				this.VPos = (this.VPos - 64) & 1023;

				for (var ch = 0;  ch < 2; ch++) {
					MP2.MatrixTransform(this.sample[ch], p, this.V[ch], this.VPos);

					// Build U, windowing, calculate output
					JSMpeg.Fill(this.U, 0);

					var dIndex = 512 - (this.VPos >> 1);
					var vIndex = (this.VPos % 128) >> 1;
					while (vIndex < 1024) {
						for (var i = 0; i < 32; ++i) {
							this.U[i] += this.D[dIndex++] * this.V[ch][vIndex++];
						}

						vIndex += 128-32;
						dIndex += 64-32;
					}

					vIndex = (128-32 + 1024) - vIndex;
					dIndex -= (512 - 32);
					while (vIndex < 1024) {
						for (var i = 0; i < 32; ++i) {
							this.U[i] += this.D[dIndex++] * this.V[ch][vIndex++];
						}

						vIndex += 128-32;
						dIndex += 64-32;
					}

					// Output samples
					var outChannel = ch === 0 ? left : right;
					for (var j = 0; j < 32; j++) {
						// [LE2] upstream divides by 2147418112: output was inverted and 6.3 dB too quiet compared with ffmpeg's
						// decode (measured; pl_mpeg later changed this divisor to a negative one as well). -0x3E000000 matches ffmpeg.
						outChannel[outPos + j] = this.U[j] / -1040187392;
					}
				} // End of synthesis channel loop
				outPos += 32;
			} // End of synthesis sub-block loop

		} // Decoding of the granule finished
	}

	this.sampleRate = sampleRate;
	return frameSize;
};

MP2.prototype.readAllocation = function(sb, tab3) {
	var tab4 = MP2.QUANT_LUT_STEP_3[tab3][sb];
	var qtab = MP2.QUANT_LUT_STEP4[tab4 & 15][this.bits.read(tab4 >> 4)];
	return qtab ? (MP2.QUANT_TAB[qtab - 1]) : 0;
};

MP2.prototype.readSamples = function(ch, sb, part) {
	var q = this.allocation[ch][sb],
		sample = this.sample[ch][sb];

	if (!q) {
		// No bits allocated for this subband
		sample[0] = sample[1] = sample[2] = 0;
		return;
	}

	this.readRawSamples(q, sample);
	this.dequantizeSamples(q, this.scaleFactor[ch][sb][part], sample);
};

// [LE2] Subbands above the joint-stereo bound (intensity stereo): both channels share the coded sample values but
// each has its own scale factor. Upstream copied channel 0's already scaled samples into channel 1, ignoring
// channel 1's scale factors (audible as distorted stereo with joint-stereo streams like the game's movies).
MP2.prototype.readSamplesShared = function(sb, part) {
	var q = this.allocation[0][sb],
		s0 = this.sample[0][sb],
		s1 = this.sample[1][sb];

	if (!q) {
		s0[0] = s0[1] = s0[2] = 0;
		s1[0] = s1[1] = s1[2] = 0;
		return;
	}

	this.readRawSamples(q, s0);
	s1[0] = s0[0];
	s1[1] = s0[1];
	s1[2] = s0[2];
	this.dequantizeSamples(q, this.scaleFactor[0][sb][part], s0);
	this.dequantizeSamples(q, this.scaleFactor[1][sb][part], s1);
};

MP2.prototype.readRawSamples = function(q, sample) {
	var adj = q.levels,
		val = 0;
	if (q.group) {
		// Decode grouped samples
		val = this.bits.read(q.bits);
		sample[0] = val % adj;
		val = (val / adj)|0;
		sample[1] = val % adj;
		sample[2] = (val / adj)|0;
	}
	else {
		// Decode direct samples
		sample[0] = this.bits.read(q.bits);
		sample[1] = this.bits.read(q.bits);
		sample[2] = this.bits.read(q.bits);
	}
};

MP2.prototype.dequantizeSamples = function(q, sf, sample) {
	var val = 0;

	// Resolve scalefactor
	if (sf === 63) {
		sf = 0;
	}
	else {
		var shift = (sf / 3)|0;
		sf = (MP2.SCALEFACTOR_BASE[sf % 3] + ((1 << shift) >> 1)) >> shift;
	}

	// Postmultiply samples
	var adj = q.levels;
	var scale = (65536 / (adj + 1))|0;
	adj = ((adj + 1) >> 1) - 1;

	val = (adj - sample[0]) * scale;
	sample[0] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;

	val = (adj - sample[1]) * scale;
	sample[1] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;

	val = (adj - sample[2]) * scale;
	sample[2] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;
};

MP2.MatrixTransform = function(s, ss, d, dp) {
	var t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, t12,
		t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24,
		t25, t26, t27, t28, t29, t30, t31, t32, t33;

	t01 = s[ 0][ss] + s[31][ss]; t02 = (s[ 0][ss] - s[31][ss]) * 0.500602998235;
	t03 = s[ 1][ss] + s[30][ss]; t04 = (s[ 1][ss] - s[30][ss]) * 0.505470959898;
	t05 = s[ 2][ss] + s[29][ss]; t06 = (s[ 2][ss] - s[29][ss]) * 0.515447309923;
	t07 = s[ 3][ss] + s[28][ss]; t08 = (s[ 3][ss] - s[28][ss]) * 0.53104259109;
	t09 = s[ 4][ss] + s[27][ss]; t10 = (s[ 4][ss] - s[27][ss]) * 0.553103896034;
	t11 = s[ 5][ss] + s[26][ss]; t12 = (s[ 5][ss] - s[26][ss]) * 0.582934968206;
	t13 = s[ 6][ss] + s[25][ss]; t14 = (s[ 6][ss] - s[25][ss]) * 0.622504123036;
	t15 = s[ 7][ss] + s[24][ss]; t16 = (s[ 7][ss] - s[24][ss]) * 0.674808341455;
	t17 = s[ 8][ss] + s[23][ss]; t18 = (s[ 8][ss] - s[23][ss]) * 0.744536271002;
	t19 = s[ 9][ss] + s[22][ss]; t20 = (s[ 9][ss] - s[22][ss]) * 0.839349645416;
	t21 = s[10][ss] + s[21][ss]; t22 = (s[10][ss] - s[21][ss]) * 0.972568237862;
	t23 = s[11][ss] + s[20][ss]; t24 = (s[11][ss] - s[20][ss]) * 1.16943993343;
	t25 = s[12][ss] + s[19][ss]; t26 = (s[12][ss] - s[19][ss]) * 1.48416461631;
	t27 = s[13][ss] + s[18][ss]; t28 = (s[13][ss] - s[18][ss]) * 2.05778100995;
	t29 = s[14][ss] + s[17][ss]; t30 = (s[14][ss] - s[17][ss]) * 3.40760841847;
	t31 = s[15][ss] + s[16][ss]; t32 = (s[15][ss] - s[16][ss]) * 10.1900081235;

	t33 = t01 + t31; t31 = (t01 - t31) * 0.502419286188;
	t01 = t03 + t29; t29 = (t03 - t29) * 0.52249861494;
	t03 = t05 + t27; t27 = (t05 - t27) * 0.566944034816;
	t05 = t07 + t25; t25 = (t07 - t25) * 0.64682178336;
	t07 = t09 + t23; t23 = (t09 - t23) * 0.788154623451;
	t09 = t11 + t21; t21 = (t11 - t21) * 1.06067768599;
	t11 = t13 + t19; t19 = (t13 - t19) * 1.72244709824;
	t13 = t15 + t17; t17 = (t15 - t17) * 5.10114861869;
	t15 = t33 + t13; t13 = (t33 - t13) * 0.509795579104;
	t33 = t01 + t11; t01 = (t01 - t11) * 0.601344886935;
	t11 = t03 + t09; t09 = (t03 - t09) * 0.899976223136;
	t03 = t05 + t07; t07 = (t05 - t07) * 2.56291544774;
	t05 = t15 + t03; t15 = (t15 - t03) * 0.541196100146;
	t03 = t33 + t11; t11 = (t33 - t11) * 1.30656296488;
	t33 = t05 + t03; t05 = (t05 - t03) * 0.707106781187;
	t03 = t15 + t11; t15 = (t15 - t11) * 0.707106781187;
	t03 += t15;
	t11 = t13 + t07; t13 = (t13 - t07) * 0.541196100146;
	t07 = t01 + t09; t09 = (t01 - t09) * 1.30656296488;
	t01 = t11 + t07; t07 = (t11 - t07) * 0.707106781187;
	t11 = t13 + t09; t13 = (t13 - t09) * 0.707106781187;
	t11 += t13; t01 += t11; 
	t11 += t07; t07 += t13;
	t09 = t31 + t17; t31 = (t31 - t17) * 0.509795579104;
	t17 = t29 + t19; t29 = (t29 - t19) * 0.601344886935;
	t19 = t27 + t21; t21 = (t27 - t21) * 0.899976223136;
	t27 = t25 + t23; t23 = (t25 - t23) * 2.56291544774;
	t25 = t09 + t27; t09 = (t09 - t27) * 0.541196100146;
	t27 = t17 + t19; t19 = (t17 - t19) * 1.30656296488;
	t17 = t25 + t27; t27 = (t25 - t27) * 0.707106781187;
	t25 = t09 + t19; t19 = (t09 - t19) * 0.707106781187;
	t25 += t19;
	t09 = t31 + t23; t31 = (t31 - t23) * 0.541196100146;
	t23 = t29 + t21; t21 = (t29 - t21) * 1.30656296488;
	t29 = t09 + t23; t23 = (t09 - t23) * 0.707106781187;
	t09 = t31 + t21; t31 = (t31 - t21) * 0.707106781187;
	t09 += t31;	t29 += t09;	t09 += t23;	t23 += t31;
	t17 += t29;	t29 += t25;	t25 += t09;	t09 += t27;
	t27 += t23;	t23 += t19; t19 += t31;	
	t21 = t02 + t32; t02 = (t02 - t32) * 0.502419286188;
	t32 = t04 + t30; t04 = (t04 - t30) * 0.52249861494;
	t30 = t06 + t28; t28 = (t06 - t28) * 0.566944034816;
	t06 = t08 + t26; t08 = (t08 - t26) * 0.64682178336;
	t26 = t10 + t24; t10 = (t10 - t24) * 0.788154623451;
	t24 = t12 + t22; t22 = (t12 - t22) * 1.06067768599;
	t12 = t14 + t20; t20 = (t14 - t20) * 1.72244709824;
	t14 = t16 + t18; t16 = (t16 - t18) * 5.10114861869;
	t18 = t21 + t14; t14 = (t21 - t14) * 0.509795579104;
	t21 = t32 + t12; t32 = (t32 - t12) * 0.601344886935;
	t12 = t30 + t24; t24 = (t30 - t24) * 0.899976223136;
	t30 = t06 + t26; t26 = (t06 - t26) * 2.56291544774;
	t06 = t18 + t30; t18 = (t18 - t30) * 0.541196100146;
	t30 = t21 + t12; t12 = (t21 - t12) * 1.30656296488;
	t21 = t06 + t30; t30 = (t06 - t30) * 0.707106781187;
	t06 = t18 + t12; t12 = (t18 - t12) * 0.707106781187;
	t06 += t12;
	t18 = t14 + t26; t26 = (t14 - t26) * 0.541196100146;
	t14 = t32 + t24; t24 = (t32 - t24) * 1.30656296488;
	t32 = t18 + t14; t14 = (t18 - t14) * 0.707106781187;
	t18 = t26 + t24; t24 = (t26 - t24) * 0.707106781187;
	t18 += t24; t32 += t18; 
	t18 += t14; t26 = t14 + t24;
	t14 = t02 + t16; t02 = (t02 - t16) * 0.509795579104;
	t16 = t04 + t20; t04 = (t04 - t20) * 0.601344886935;
	t20 = t28 + t22; t22 = (t28 - t22) * 0.899976223136;
	t28 = t08 + t10; t10 = (t08 - t10) * 2.56291544774;
	t08 = t14 + t28; t14 = (t14 - t28) * 0.541196100146;
	t28 = t16 + t20; t20 = (t16 - t20) * 1.30656296488;
	t16 = t08 + t28; t28 = (t08 - t28) * 0.707106781187;
	t08 = t14 + t20; t20 = (t14 - t20) * 0.707106781187;
	t08 += t20;
	t14 = t02 + t10; t02 = (t02 - t10) * 0.541196100146;
	t10 = t04 + t22; t22 = (t04 - t22) * 1.30656296488;
	t04 = t14 + t10; t10 = (t14 - t10) * 0.707106781187;
	t14 = t02 + t22; t02 = (t02 - t22) * 0.707106781187;
	t14 += t02;	t04 += t14;	t14 += t10;	t10 += t02;
	t16 += t04;	t04 += t08;	t08 += t14;	t14 += t28;
	t28 += t10;	t10 += t20;	t20 += t02;	t21 += t16;
	t16 += t32;	t32 += t04;	t04 += t06;	t06 += t08;
	t08 += t18;	t18 += t14;	t14 += t30;	t30 += t28;
	t28 += t26;	t26 += t10;	t10 += t12;	t12 += t20;
	t20 += t24;	t24 += t02;

	d[dp + 48] = -t33;
	d[dp + 49] = d[dp + 47] = -t21;
	d[dp + 50] = d[dp + 46] = -t17;
	d[dp + 51] = d[dp + 45] = -t16;
	d[dp + 52] = d[dp + 44] = -t01;
	d[dp + 53] = d[dp + 43] = -t32;
	d[dp + 54] = d[dp + 42] = -t29;
	d[dp + 55] = d[dp + 41] = -t04;
	d[dp + 56] = d[dp + 40] = -t03;
	d[dp + 57] = d[dp + 39] = -t06;
	d[dp + 58] = d[dp + 38] = -t25;
	d[dp + 59] = d[dp + 37] = -t08;
	d[dp + 60] = d[dp + 36] = -t11;
	d[dp + 61] = d[dp + 35] = -t18;
	d[dp + 62] = d[dp + 34] = -t09;
	d[dp + 63] = d[dp + 33] = -t14;
	d[dp + 32] = -t05;
	d[dp +  0] = t05; d[dp + 31] = -t30;
	d[dp +  1] = t30; d[dp + 30] = -t27;
	d[dp +  2] = t27; d[dp + 29] = -t28;
	d[dp +  3] = t28; d[dp + 28] = -t07;
	d[dp +  4] = t07; d[dp + 27] = -t26;
	d[dp +  5] = t26; d[dp + 26] = -t23;
	d[dp +  6] = t23; d[dp + 25] = -t10;
	d[dp +  7] = t10; d[dp + 24] = -t15;
	d[dp +  8] = t15; d[dp + 23] = -t12;
	d[dp +  9] = t12; d[dp + 22] = -t19;
	d[dp + 10] = t19; d[dp + 21] = -t20;
	d[dp + 11] = t20; d[dp + 20] = -t13;
	d[dp + 12] = t13; d[dp + 19] = -t24;
	d[dp + 13] = t24; d[dp + 18] = -t31;
	d[dp + 14] = t31; d[dp + 17] = -t02;
	d[dp + 15] = t02; d[dp + 16] =  0.0;
};

MP2.FRAME_SYNC = 0x7ff;

MP2.VERSION = {
	MPEG_2_5: 0x0,
	MPEG_2: 0x2,
	MPEG_1: 0x3
};

MP2.LAYER = {
	III: 0x1,
	II: 0x2,
	I: 0x3
};

MP2.MODE = {
	STEREO: 0x0,
	JOINT_STEREO: 0x1,
	DUAL_CHANNEL: 0x2,
	MONO: 0x3
};

MP2.SAMPLE_RATE = new Uint16Array([
	44100, 48000, 32000, 0, // MPEG-1
	22050, 24000, 16000, 0  // MPEG-2
]);

MP2.BIT_RATE = new Uint16Array([
	32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, // MPEG-1
	 8, 16, 24, 32, 40, 48,  56,  64,  80,  96, 112, 128, 144, 160  // MPEG-2
]);

MP2.SCALEFACTOR_BASE = new Uint32Array([
	0x02000000, 0x01965FEA, 0x01428A30
]);

MP2.SYNTHESIS_WINDOW = new Float32Array([
	     0.0,     -0.5,     -0.5,     -0.5,     -0.5,     -0.5,
	    -0.5,     -1.0,     -1.0,     -1.0,     -1.0,     -1.5,
	    -1.5,     -2.0,     -2.0,     -2.5,     -2.5,     -3.0,
	    -3.5,     -3.5,     -4.0,     -4.5,     -5.0,     -5.5,
	    -6.5,     -7.0,     -8.0,     -8.5,     -9.5,    -10.5,
	   -12.0,    -13.0,    -14.5,    -15.5,    -17.5,    -19.0,
	   -20.5,    -22.5,    -24.5,    -26.5,    -29.0,    -31.5,
	   -34.0,    -36.5,    -39.5,    -42.5,    -45.5,    -48.5,
	   -52.0,    -55.5,    -58.5,    -62.5,    -66.0,    -69.5,
	   -73.5,    -77.0,    -80.5,    -84.5,    -88.0,    -91.5,
	   -95.0,    -98.0,   -101.0,   -104.0,    106.5,    109.0,
	   111.0,    112.5,    113.5,    114.0,    114.0,    113.5,
	   112.0,    110.5,    107.5,    104.0,    100.0,     94.5,
	    88.5,     81.5,     73.0,     63.5,     53.0,     41.5,
	    28.5,     14.5,     -1.0,    -18.0,    -36.0,    -55.5,
	   -76.5,    -98.5,   -122.0,   -147.0,   -173.5,   -200.5,
	  -229.5,   -259.5,   -290.5,   -322.5,   -355.5,   -389.5,
	  -424.0,   -459.5,   -495.5,   -532.0,   -568.5,   -605.0,
	  -641.5,   -678.0,   -714.0,   -749.0,   -783.5,   -817.0,
	  -849.0,   -879.5,   -908.5,   -935.0,   -959.5,   -981.0,
	 -1000.5,  -1016.0,  -1028.5,  -1037.5,  -1042.5,  -1043.5,
	 -1040.0,  -1031.5,   1018.5,   1000.0,    976.0,    946.5,
	   911.0,    869.5,    822.0,    767.5,    707.0,    640.0,
	   565.5,    485.0,    397.0,    302.5,    201.0,     92.5,
	   -22.5,   -144.0,   -272.5,   -407.0,   -547.5,   -694.0,
	  -846.0,  -1003.0,  -1165.0,  -1331.5,  -1502.0,  -1675.5,
	 -1852.5,  -2031.5,  -2212.5,  -2394.0,  -2576.5,  -2758.5,
	 -2939.5,  -3118.5,  -3294.5,  -3467.5,  -3635.5,  -3798.5,
	 -3955.0,  -4104.5,  -4245.5,  -4377.5,  -4499.0,  -4609.5,
	 -4708.0,  -4792.5,  -4863.5,  -4919.0,  -4958.0,  -4979.5,
	 -4983.0,  -4967.5,  -4931.5,  -4875.0,  -4796.0,  -4694.5,
	 -4569.5,  -4420.0,  -4246.0,  -4046.0,  -3820.0,  -3567.0,
	  3287.0,   2979.5,   2644.0,   2280.5,   1888.0,   1467.5,
	  1018.5,    541.0,     35.0,   -499.0,  -1061.0,  -1650.0,
	 -2266.5,  -2909.0,  -3577.0,  -4270.0,  -4987.5,  -5727.5,
	 -6490.0,  -7274.0,  -8077.5,  -8899.5,  -9739.0, -10594.5,
	-11464.5, -12347.0, -13241.0, -14144.5, -15056.0, -15973.5,
	-16895.5, -17820.0, -18744.5, -19668.0, -20588.0, -21503.0,
	-22410.5, -23308.5, -24195.0, -25068.5, -25926.5, -26767.0,
	-27589.0, -28389.0, -29166.5, -29919.0, -30644.5, -31342.0,
	-32009.5, -32645.0, -33247.0, -33814.5, -34346.0, -34839.5,
	-35295.0, -35710.0, -36084.5, -36417.5, -36707.5, -36954.0,
	-37156.5, -37315.0, -37428.0, -37496.0,  37519.0,  37496.0,
	 37428.0,  37315.0,  37156.5,  36954.0,  36707.5,  36417.5,
	 36084.5,  35710.0,  35295.0,  34839.5,  34346.0,  33814.5,
	 33247.0,  32645.0,  32009.5,  31342.0,  30644.5,  29919.0,
	 29166.5,  28389.0,  27589.0,  26767.0,  25926.5,  25068.5,
	 24195.0,  23308.5,  22410.5,  21503.0,  20588.0,  19668.0,
	 18744.5,  17820.0,  16895.5,  15973.5,  15056.0,  14144.5,
	 13241.0,  12347.0,  11464.5,  10594.5,   9739.0,   8899.5,
	  8077.5,   7274.0,   6490.0,   5727.5,   4987.5,   4270.0,
	  3577.0,   2909.0,   2266.5,   1650.0,   1061.0,    499.0,
	   -35.0,   -541.0,  -1018.5,  -1467.5,  -1888.0,  -2280.5,
	 -2644.0,  -2979.5,   3287.0,   3567.0,   3820.0,   4046.0,
	  4246.0,   4420.0,   4569.5,   4694.5,   4796.0,   4875.0,
	  4931.5,   4967.5,   4983.0,   4979.5,   4958.0,   4919.0,
	  4863.5,   4792.5,   4708.0,   4609.5,   4499.0,   4377.5,
	  4245.5,   4104.5,   3955.0,   3798.5,   3635.5,   3467.5,
	  3294.5,   3118.5,   2939.5,   2758.5,   2576.5,   2394.0,
	  2212.5,   2031.5,   1852.5,   1675.5,   1502.0,   1331.5,
	  1165.0,   1003.0,    846.0,    694.0,    547.5,    407.0,
	   272.5,    144.0,     22.5,    -92.5,   -201.0,   -302.5,
	  -397.0,   -485.0,   -565.5,   -640.0,   -707.0,   -767.5,
	  -822.0,   -869.5,   -911.0,   -946.5,   -976.0,  -1000.0,
	  1018.5,   1031.5,   1040.0,   1043.5,   1042.5,   1037.5,
	  1028.5,   1016.0,   1000.5,    981.0,    959.5,    935.0,
	   908.5,    879.5,    849.0,    817.0,    783.5,    749.0,
	   714.0,    678.0,    641.5,    605.0,    568.5,    532.0,
	   495.5,    459.5,    424.0,    389.5,    355.5,    322.5,
	   290.5,    259.5,    229.5,    200.5,    173.5,    147.0,
	   122.0,     98.5,     76.5,     55.5,     36.0,     18.0,
		1.0,    -14.5,    -28.5,    -41.5,    -53.0,    -63.5,
	   -73.0,    -81.5,    -88.5,    -94.5,   -100.0,   -104.0,
	  -107.5,   -110.5,   -112.0,   -113.5,   -114.0,   -114.0,
	  -113.5,   -112.5,   -111.0,   -109.0,    106.5,    104.0,
	   101.0,     98.0,     95.0,     91.5,     88.0,     84.5,
	    80.5,     77.0,     73.5,     69.5,     66.0,     62.5,
	    58.5,     55.5,     52.0,     48.5,     45.5,     42.5,
	    39.5,     36.5,     34.0,     31.5,     29.0,     26.5,
	    24.5,     22.5,     20.5,     19.0,     17.5,     15.5,
	    14.5,     13.0,     12.0,     10.5,      9.5,      8.5,
	     8.0,      7.0,      6.5,      5.5,      5.0,      4.5,
	     4.0,      3.5,      3.5,      3.0,      2.5,      2.5,
	     2.0,      2.0,      1.5,      1.5,      1.0,      1.0,
	     1.0,      1.0,      0.5,      0.5,      0.5,      0.5,
	     0.5,      0.5
]);

// Quantizer lookup, step 1: bitrate classes
MP2.QUANT_LUT_STEP_1 = [
 	// 32, 48, 56, 64, 80, 96,112,128,160,192,224,256,320,384 <- bitrate
	[   0,  0,  1,  1,  1,  2,  2,  2,  2,  2,  2,  2,  2,  2], // mono
	// 16, 24, 28, 32, 40, 48, 56, 64, 80, 96,112,128,160,192 <- bitrate / chan
	[   0,  0,  0,  0,  0,  0,  1,  1,  1,  2,  2,  2,  2,  2] // stereo
];

// Quantizer lookup, step 2: bitrate class, sample rate -> B2 table idx, sblimit
MP2.QUANT_TAB = {
	A: (27 | 64), // Table 3-B.2a: high-rate, sblimit = 27
	B: (30 | 64), // Table 3-B.2b: high-rate, sblimit = 30
	C:   8,       // Table 3-B.2c:  low-rate, sblimit =  8
	D:  12        // Table 3-B.2d:  low-rate, sblimit = 12
};

MP2.QUANT_LUT_STEP_2 = [
	//   44.1 kHz,        48 kHz,          32 kHz
	[MP2.QUANT_TAB.C, MP2.QUANT_TAB.C, MP2.QUANT_TAB.D], // 32 - 48 kbit/sec/ch
	[MP2.QUANT_TAB.A, MP2.QUANT_TAB.A, MP2.QUANT_TAB.A], // 56 - 80 kbit/sec/ch
	[MP2.QUANT_TAB.B, MP2.QUANT_TAB.A, MP2.QUANT_TAB.B]  // 96+	 kbit/sec/ch
];

// Quantizer lookup, step 3: B2 table, subband -> nbal, row index
// (upper 4 bits: nbal, lower 4 bits: row index)
MP2.QUANT_LUT_STEP_3 = [
	// Low-rate table (3-B.2c and 3-B.2d)
	[
		0x44,0x44,
	  	0x34,0x34,0x34,0x34,0x34,0x34,0x34,0x34,0x34,0x34
	],
	// High-rate table (3-B.2a and 3-B.2b)
	[
		0x43,0x43,0x43,
		0x42,0x42,0x42,0x42,0x42,0x42,0x42,0x42,
		0x31,0x31,0x31,0x31,0x31,0x31,0x31,0x31,0x31,0x31,0x31,0x31,
		0x20,0x20,0x20,0x20,0x20,0x20,0x20
	],
	// MPEG-2 LSR table (B.2 in ISO 13818-3)
	[
		0x45,0x45,0x45,0x45,
		0x34,0x34,0x34,0x34,0x34,0x34,0x34,
		0x24,0x24,0x24,0x24,0x24,0x24,0x24,0x24,0x24,0x24,
					   0x24,0x24,0x24,0x24,0x24,0x24,0x24,0x24,0x24	
	]
];

// Quantizer lookup, step 4: table row, allocation[] value -> quant table index
MP2.QUANT_LUT_STEP4 = [
	[0, 1, 2, 17],
	[0, 1, 2, 3, 4, 5, 6, 17],
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
	[0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
	[0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17],
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
];

MP2.QUANT_TAB = [
	{levels:     3, group: 1, bits:  5},  //  1
	{levels:     5, group: 1, bits:  7},  //  2
	{levels:     7, group: 0, bits:  3},  //  3
	{levels:     9, group: 1, bits: 10},  //  4
	{levels:    15, group: 0, bits:  4},  //  5
	{levels:    31, group: 0, bits:  5},  //  6
	{levels:    63, group: 0, bits:  6},  //  7
	{levels:   127, group: 0, bits:  7},  //  8
	{levels:   255, group: 0, bits:  8},  //  9
	{levels:   511, group: 0, bits:  9},  // 10
	{levels:  1023, group: 0, bits: 10},  // 11
	{levels:  2047, group: 0, bits: 11},  // 12
	{levels:  4095, group: 0, bits: 12},  // 13
	{levels:  8191, group: 0, bits: 13},  // 14
	{levels: 16383, group: 0, bits: 14},  // 15
	{levels: 32767, group: 0, bits: 15},  // 16
	{levels: 65535, group: 0, bits: 16}   // 17
];

return MP2;

})();


export const MPEG1Video = JSMpeg.Decoder.MPEG1Video;
export const MP2Audio = JSMpeg.Decoder.MP2Audio;
export const BitBuffer = JSMpeg.BitBuffer;
