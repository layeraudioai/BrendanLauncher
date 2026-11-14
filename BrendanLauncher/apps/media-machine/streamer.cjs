'use strict';

const { MediaStreamer } = require('../../sdk/host/media-streamer.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

class MediaMachineStreamer extends MediaStreamer {
  constructor(root) {
    super({ frameWidth: 1600, frameHeight: 900 });
    this.root = path.resolve(root);
    this.lastKey = null;
    this.lastFrame = null;
  }

  async getFrame(clipIndex, sourcePath, frameIndex, frameRate = 5) {
    const source = path.resolve(sourcePath);
    if (!source.startsWith(this.root + path.sep))
      throw new Error('Media source must stay inside the app content directory');
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error('Media source is not a file');

    const key = `${source}\0${clipIndex}\0${frameIndex}\0${frameRate}`;
    if (key === this.lastKey && this.lastFrame) return this.lastFrame;
    const time = Math.max(0, frameIndex) / Math.max(1, frameRate);
    const args = [
      '-v', 'error', '-ss', String(time), '-i', source,
      '-map', '0:v:0', '-frames:v', '1',
      '-vf', `scale=${this.frameWidth}:${this.frameHeight}:force_original_aspect_ratio=decrease,pad=${this.frameWidth}:${this.frameHeight}:(ow-iw)/2:(oh-ih)/2`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb565le', 'pipe:1',
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = [];
      const errors = [];
      let length = 0;
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length > this.frameBytes) {
          child.kill('SIGKILL');
          reject(new Error('FFmpeg returned more than one video frame'));
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', chunk => { if (Buffer.concat(errors).length < 8192) errors.push(chunk); });
      child.once('error', reject);
      child.once('close', code => {
        if (code !== 0) {
          const detail = Buffer.concat(errors).toString('utf8').trim().slice(-1000);
          reject(new Error(`FFmpeg could not decode ${path.basename(source)}${detail ? ': ' + detail : ''}`));
          return;
        }
        const frame = Buffer.concat(chunks);
        if (frame.length !== this.frameBytes) {
          reject(new Error(`FFmpeg returned ${frame.length} bytes; expected ${this.frameBytes}`));
          return;
        }
        resolve(frame);
      });
    });

    // Keep only the current frame in RAM; never create hundreds of megabytes
    // of per-frame cache files on the console or PC.
    this.lastKey = key;
    this.lastFrame = result;
    return result;
  }

  async close() {
    this.lastKey = null;
    this.lastFrame = null;
    await super.stop();
  }
}

module.exports = { MediaMachineStreamer };
