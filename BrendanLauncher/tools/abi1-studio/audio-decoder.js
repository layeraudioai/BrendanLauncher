'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1AudioDecoder = api;
})(globalThis, function () {
  const SAMPLE_RATE = 48000;
  const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
  const MAX_PCM_BYTES = 64 * 1024 * 1024;
  const EXTENSIONS = new Set([
    '.mp3', '.wav', '.wave', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus'
  ]);
  const MIME_TYPES = new Set([
    'audio/aac', 'audio/flac', 'audio/m4a', 'audio/mp3', 'audio/mp4',
    'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/wave',
    'audio/vnd.wave', 'audio/x-flac', 'audio/x-m4a', 'audio/x-wav',
    'application/ogg'
  ]);

  function isSupportedAudioFile(file) {
    if (!file || typeof file.name !== 'string') return false;
    const extension = file.name.match(/\.[^.]+$/);
    const mimeType = typeof file.type === 'string'
      ? file.type.split(';', 1)[0].trim().toLowerCase() : '';
    return Boolean(extension && EXTENSIONS.has(extension[0].toLowerCase())) ||
      MIME_TYPES.has(mimeType);
  }

  function audioContextConstructor() {
    return globalThis.AudioContext || globalThis.webkitAudioContext || null;
  }

  async function decodeAudioFile(file, options = {}) {
    if (!isSupportedAudioFile(file))
      throw new Error('Choose an MP3, WAV, FLAC, M4A, AAC, Ogg, or Opus audio file.');
    if (!Number.isFinite(file.size) || file.size <= 0)
      throw new Error('Audio file is empty or has an invalid size');
    if (file.size > MAX_SOURCE_BYTES)
      throw new Error('Audio source exceeds the 24 MiB import limit');
    if (typeof file.arrayBuffer !== 'function')
      throw new Error('This browser cannot read the selected audio file');

    const AudioContextType = options.AudioContextType || audioContextConstructor();
    if (!AudioContextType)
      throw new Error('Audio import requires a browser with Web Audio support');

    const decoder = new AudioContextType({ sampleRate: SAMPLE_RATE });
    let decoded;
    try {
      decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    } catch (error) {
      const detail = error && error.message ? ` ${error.message}` : '';
      throw new Error(`This browser could not decode ${file.name}.${detail} Try an up-to-date browser with MP3, WAV, FLAC, M4A, Ogg, and Opus support.`);
    } finally {
      await decoder.close();
    }

    if (!decoded || !Number.isInteger(decoded.length) || decoded.length < 1 ||
        !Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0 ||
        !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1)
      throw new Error(`Decoded audio ${file.name} has invalid sample data`);

    const frameCount = Math.ceil(decoded.length * SAMPLE_RATE / decoded.sampleRate);
    if (!frameCount || frameCount * 4 > MAX_PCM_BYTES)
      throw new Error('Decoded audio exceeds 64 MiB');

    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index));
    if (channels.some(channel => !channel || channel.length !== decoded.length))
      throw new Error(`Decoded audio ${file.name} has inconsistent channels`);

    const pcm = new Int16Array(frameCount * 2);
    for (let frame = 0; frame < frameCount; frame++) {
      const sourcePosition = Math.min(decoded.length - 1, frame * decoded.sampleRate / SAMPLE_RATE);
      const lower = Math.floor(sourcePosition);
      const upper = Math.min(decoded.length - 1, lower + 1);
      const blend = sourcePosition - lower;
      const left = sample(channels[0], lower, upper, blend);
      const rightChannel = channels[1] || channels[0];
      const right = sample(rightChannel, lower, upper, blend);
      pcm[frame * 2] = toPcm16(left);
      pcm[frame * 2 + 1] = toPcm16(right);
    }
    return new Uint8Array(pcm.buffer);
  }

  function sample(channel, lower, upper, blend) {
    return channel[lower] * (1 - blend) + channel[upper] * blend;
  }

  function toPcm16(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
  }

  return { decodeAudioFile, isSupportedAudioFile, SAMPLE_RATE };
});
