'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeAudioFile, isSupportedAudioFile, SAMPLE_RATE } = require('./audio-decoder.js');

function fakeContext(decoded, onDecode = () => {}) {
  return class {
    constructor(options) {
      assert.equal(options.sampleRate, SAMPLE_RATE);
    }

    async decodeAudioData(bytes) {
      onDecode(bytes);
      return decoded;
    }

    async close() {}
  };
}

function file(name, bytes = new Uint8Array([1, 2, 3, 4]), type = '') {
  return {
    name,
    size: bytes.length,
    type,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

test('audio decoder recognizes common browser-decodable audio extensions and MIME types', () => {
  for (const extension of ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus'])
    assert.equal(isSupportedAudioFile(file(`track.${extension}`)), true, extension);
  assert.equal(isSupportedAudioFile(file('track', new Uint8Array([1]), 'audio/flac')), true);
  assert.equal(isSupportedAudioFile(file('track.bin', new Uint8Array([1]), 'application/octet-stream')), false);
});

test('audio decoder resamples mono audio and emits stereo 48 kHz signed 16-bit PCM', async () => {
  const decoded = {
    length: 3,
    sampleRate: 24000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([-1, 0, 1])
  };
  let decodedBytes;
  const input = file('voice.flac', new Uint8Array([5, 6, 7]));
  const pcm = await decodeAudioFile(input, {
    AudioContextType: fakeContext(decoded, bytes => { decodedBytes = new Uint8Array(bytes); })
  });
  assert.deepEqual([...decodedBytes], [5, 6, 7]);
  assert.equal(pcm.byteLength, 6 * 2 * 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  assert.deepEqual(Array.from({ length: 12 }, (_, index) => view.getInt16(index * 2, true)),
    [-32768, -32768, -16384, -16384, 0, 0, 16384, 16384, 32767, 32767, 32767, 32767]);
});

test('audio decoder rejects unsupported formats and reports codec failures', async () => {
  await assert.rejects(() => decodeAudioFile(file('notes.txt')), /Choose an MP3, WAV/);
  const failingDecoder = class {
    async decodeAudioData() { throw new Error('codec unavailable'); }
    async close() {}
  };
  await assert.rejects(() => decodeAudioFile(file('music.m4a'), {
    AudioContextType: failingDecoder
  }), /could not decode music\.m4a.*codec unavailable/);
});
