'use strict';
// PC-side glyph rasteriser for the ABI-1 text band.
//
// The console cannot rasterise text, so the bridge draws every dynamic string
// here into an 8-bit alpha band that the fragment shader samples directly.
// Glyph bitmaps come from host/font.json (baked by assets.py), so the runtime
// needs neither Pillow nor a font file.

const fs = require('node:fs');
const path = require('node:path');

const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, 'font.json'), 'utf8'));

class Font {
  constructor(pack = PACK) {
    this.pack = pack;
    this.sizes = Object.keys(pack.sizes)
      .map(Number)
      .sort((a, b) => a - b);
    if (!this.sizes.length) throw Error('Font pack has no sizes');
  }

  // Nearest available baked size: the pack is generated at build time, so the
  // host can only pick from those.
  resolve(size) {
    let best = this.sizes[0];
    for (const candidate of this.sizes) {
      if (Math.abs(candidate - size) < Math.abs(best - size)) best = candidate;
    }
    return best;
  }

  metrics(size) {
    return this.pack.sizes[String(this.resolve(size))];
  }

  lineHeight(size) {
    return this.metrics(size).lineHeight;
  }

  width(text, size) {
    const metrics = this.metrics(size);
    let total = 0;
    for (const char of String(text)) {
      const glyph = metrics.glyphs[char] || metrics.glyphs['?'];
      total += glyph ? glyph.adv : 0;
    }
    return total;
  }

  /**
   * Draw one line into an 8-bit buffer.
   * @param {{data:Uint8Array,width:number,height:number}} surface
   */
  draw(surface, text, x, y, size, alpha = 255, maxWidth = Infinity) {
    const metrics = this.metrics(size);
    let cursor = Math.round(x);
    const top = Math.round(y);
    let clipped = 0;
    for (const char of String(text)) {
      if (cursor - Math.round(x) > maxWidth) {
        clipped += 1;
        break;
      }
      const glyph = metrics.glyphs[char] || metrics.glyphs['?'];
      if (!glyph) continue;
      if (glyph.w && glyph.h) {
        const bits = glyph.bits ? Buffer.from(glyph.bits, 'base64') : null;
        if (bits) {
          const rowBytes = (glyph.w + 7) >> 3;
          for (let gy = 0; gy < glyph.h; gy++) {
            const py = top + glyph.oy + gy;
            if (py < 0 || py >= surface.height) continue;
            for (let gx = 0; gx < glyph.w; gx++) {
              if (!(bits[gy * rowBytes + (gx >> 3)] & (0x80 >> (gx & 7)))) continue;
              const px = cursor + glyph.ox + gx;
              if (px < 0 || px >= surface.width) continue;
              surface.data[py * surface.width + px] = alpha;
            }
          }
        }
      }
      cursor += glyph.adv;
    }
    return { width: cursor - Math.round(x), clipped };
  }
}

module.exports = { Font, PACK };
