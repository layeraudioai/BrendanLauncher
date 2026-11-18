'use strict';
// The ABI-1 text band: an 8-bit alpha surface the PC draws into and the
// fragment shader samples at 1/1.875 scale over the whole 1920x1080 canvas.
//
// Band space is 1024x576, which is exactly 1080p/1.875, so screen coordinates
// convert with one multiply. Writes go out as one contiguous row range per
// commit; UI repaints happen at scene changes, not per frame.

const layout = require('./layout.cjs');

const SCALE = layout.band.scale;
const WIDTH = layout.band.width;
const HEIGHT = layout.band.height;

const toBand = value => Math.round(value / SCALE);

class Band {
  constructor(font) {
    this.font = font;
    this.data = new Uint8Array(WIDTH * HEIGHT);
    this.dirtyFrom = HEIGHT;
    this.dirtyTo = -1;
    this.seq = 0;
  }

  clear() {
    this.data.fill(0);
    this.touch(0, HEIGHT - 1);
  }

  touch(from, to) {
    if (from < this.dirtyFrom) this.dirtyFrom = Math.max(0, from);
    if (to > this.dirtyTo) this.dirtyTo = Math.min(HEIGHT - 1, to);
  }

  _row(y) {
    return Math.max(0, Math.min(HEIGHT - 1, y));
  }

  /** Screen-space text. size is in screen pixels. */
  text(x, y, text, { size = 20, alpha = 255, weight = 'normal', maxWidth = 880, align = 'left' } = {}) {
    const bandSize = size * SCALE * (weight === 'bold' ? 1.06 : 1);
    const width = this.font.width(String(text), bandSize);
    let left = x;
    if (align === 'center') left = x - (width * SCALE) / 2;
    else if (align === 'right') left = x - width * SCALE;
    const limit = maxWidth * SCALE;
    const drawn = this.font.draw(
      { data: this.data, width: WIDTH, height: HEIGHT },
      text,
      toBand(left < 0 ? 0 : left),
      toBand(y),
      bandSize,
      alpha,
      limit,
    );
    this.touch(toBand(y) - 4, toBand(y) + this.font.lineHeight(bandSize) + 4);
    return { width: drawn.width * SCALE, clipped: drawn.clipped > 0 };
  }

  /** Width of a screen-space string, in screen pixels. */
  measure(text, size, weight = 'normal') {
    return this.font.width(String(text), size * SCALE * (weight === 'bold' ? 1.06 : 1)) * SCALE;
  }

  /** Filled rectangle in screen space (alias of fill). */
  rect(x, y, w, h, alpha = 40) {
    this.fill(x, y, w, h, alpha);
  }

  /** Horizontal rule in screen space (alias of rule). */
  hline(x, y, w, alpha = 90) {
    this.rule(x, y, w, alpha);
  }

  /** Trim a string with an ellipsis so it fits maxWidth screen pixels. */
  fit(text, maxWidth, size) {
    const bandSize = size * SCALE;
    let value = String(text);
    if (this.font.width(value, bandSize) * SCALE <= maxWidth) return value;
    while (value.length > 1) {
      value = value.slice(0, -1);
      if (this.font.width(value + '…', bandSize) * SCALE <= maxWidth) return value + '…';
    }
    return '…';
  }

  fill(x, y, w, h, alpha = 40) {
    const x0 = Math.max(0, toBand(x));
    const y0 = this._row(toBand(y));
    const x1 = Math.min(WIDTH, toBand(x + w));
    const y1 = this._row(toBand(y + h));
    for (let row = y0; row <= y1; row++) {
      this.data.fill(alpha, row * WIDTH + x0, row * WIDTH + x1);
    }
    this.touch(y0, y1);
  }

  /** Rounded-looking outline drawn as four 1.5 px edges (band has no radius). */
  border(x, y, w, h, alpha = 120, thickness = 2) {
    this.fill(x, y, w, thickness, alpha);
    this.fill(x, y + h - thickness, w, thickness, alpha);
    this.fill(x, y, thickness, h, alpha);
    this.fill(x + w - thickness, y, thickness, h, alpha);
  }

  rule(x, y, w, alpha = 90) {
    this.fill(x, y, w, 1.5, alpha);
  }

  /** Replace band content with a single centred line (used for toasts). */
  message(lines, { width = 1920, height = 1080 } = {}) {
    this.clear();
    let y = height / 2 - (lines.length * 34) / 2;
    for (const line of lines) {
      this.text(width / 2, y, line.text, {
        size: line.size || 24,
        align: 'center',
        alpha: line.alpha === undefined ? 235 : line.alpha,
        maxWidth: width - 240,
      });
      y += (line.gap || 40);
    }
  }

  get dirtyBytes() {
    if (this.dirtyTo < this.dirtyFrom) return 0;
    return (this.dirtyTo - this.dirtyFrom + 1) * WIDTH;
  }

  /**
   * Push the dirty row range to the console buffer.
   * @param {{write:(address:number, bytes:Buffer)=>Promise<void>}} rpc
   */
  async commit(rpc, mapped) {
    if (this.dirtyTo < this.dirtyFrom) return 0;
    const from = this.dirtyFrom;
    const rows = this.dirtyTo - from + 1;
    const bytes = Buffer.from(this.data.buffer, this.data.byteOffset + from * WIDTH, rows * WIDTH);
    await rpc.write(mapped + layout.band.offset + from * WIDTH, bytes);
    this.dirtyFrom = HEIGHT;
    this.dirtyTo = -1;
    this.seq = (this.seq + 1) >>> 0;
    return bytes.length;
  }
}

module.exports = { Band, SCALE, WIDTH, HEIGHT, toBand };
