'use strict';
// Console-side screen composition.
//
// ABI 1 gives the app no text renderer, so every glyph the user reads is drawn
// here on the PC into the 1024x576 alpha band the fragment shader samples over
// the whole 1920x1080 canvas. Item rectangles are published alongside so the
// shader can draw focus and badges without knowing anything about the layout.

const { band: bandLayout, screen, key } = require('./layout.cjs');

const COLORS = {
  text: 255,
  dim: 150,
  faint: 90,
  accent: 255,
};

class Screen {
  /**
   * @param {import('./band.cjs').Band} band
   * @param {import('./font.cjs').Font} font
   */
  constructor(band, font) {
    this.band = band;
    this.font = font;
    this.items = [];
  }

  /**
   * @param {{
   *   scene:number, title:string, subtitle?:string, items?:Array<{name:string,detail?:string,flags?:number}>,
   *   selected?:number, footer?:string, toast?:string, status?:string, progress?:string,
   *   stats?:string, stream?:boolean
   * }} view
   */
  draw(view) {
    const surface = this.band;
    surface.clear();
    this.items = [];
    const padding = 72;
    const width = screen.width - padding * 2;

    if (view.stream) {
      // The video occupies the frame; only the overlay furniture is drawn here.
      if (view.toast) this._toast(view.toast);
      if (view.stats) this._stats(view.stats);
      return this.items;
    }

    // Header
    surface.text(padding, 42, view.title || 'Moonlight', { size: key.fontTitle, alpha: COLORS.text });
    if (view.subtitle) {
      surface.text(padding, 108, view.subtitle, { size: key.fontSmall, alpha: COLORS.dim });
    }
    if (view.status) {
      const w = this.band.measure(view.status, key.fontSmall);
      surface.text(screen.width - padding - w, 56, view.status, { size: key.fontSmall, alpha: COLORS.accent });
    }
    surface.hline(padding, 148, width, COLORS.faint);

    // List
    const rows = view.items || [];
    const rowHeight = key.rowHeight;
    const visible = Math.min(rows.length, Math.floor((screen.height - 300) / rowHeight));
    const first = clampWindow(view.selected || 0, visible, rows.length);
    for (let index = 0; index < visible; index++) {
      const item = rows[first + index];
      if (!item) break;
      const y = 188 + index * rowHeight;
      const focused = first + index === view.selected;
      if (focused) {
        surface.rect(padding - 16, y - 12, width + 32, rowHeight - 12, 38);
        surface.rect(padding - 16, y - 12, 8, rowHeight - 12, 235);
      }
      surface.text(padding, y, item.name, {
        size: key.fontItem,
        alpha: focused ? COLORS.text : COLORS.dim,
        maxWidth: width - 320,
      });
      if (item.detail) {
        const detailWidth = this.band.measure(item.detail, key.fontSmall);
        surface.text(screen.width - padding - detailWidth, y + 12, item.detail, {
          size: key.fontSmall,
          alpha: COLORS.faint,
        });
      }
      this.items.push({
        x: padding - 16,
        y: y - 12,
        w: width + 32,
        h: rowHeight - 12,
        flags: focused ? 1 : 0,
      });
    }
    for (let index = rows.length; index < 32; index++) this.items.push({ x: 0, y: 0, w: 0, h: 0, flags: 0 });

    if (!rows.length) {
      const message = view.empty || 'Nothing here yet';
      const w = this.band.measure(message, key.fontBody);
      surface.text((screen.width - w) / 2, 420, message, { size: key.fontBody, alpha: COLORS.faint });
    }

    if (rows.length > visible) {
      const trackHeight = visible * rowHeight - 24;
      surface.rect(screen.width - 28, 188, 4, trackHeight, 60);
      const thumb = Math.max(48, Math.round((trackHeight * visible) / rows.length));
      const offset = Math.round(((trackHeight - thumb) * first) / Math.max(1, rows.length - visible));
      surface.rect(screen.width - 28, 188 + offset, 4, thumb, 200);
    }

    if (view.progress) {
      const w = this.band.measure(view.progress, key.fontBody);
      surface.text((screen.width - w) / 2, 860, view.progress, { size: key.fontBody, alpha: COLORS.text });
    }
    if (view.footer) {
      const w = this.band.measure(view.footer, key.fontSmall);
      surface.text((screen.width - w) / 2, 1010, view.footer, { size: key.fontSmall, alpha: COLORS.faint });
    }
    if (view.toast) this._toast(view.toast);
    if (view.stats) this._stats(view.stats);
    return this.items;
  }

  _toast(message) {
    const size = key.fontBody;
    const width = this.band.measure(message, size);
    const x = (screen.width - width) / 2;
    const y = 940;
    this.band.rect(x - 28, y - 18, width + 56, size + 36, 120);
    this.band.text(x, y, message, { size, alpha: COLORS.text });
  }

  _stats(message) {
    const size = key.fontSmall;
    this.band.rect(24, 24, this.band.measure(message, size) + 40, size + 28, 110);
    this.band.text(44, 36, message, { size, alpha: 225 });
  }
}

function clampWindow(selected, visible, total) {
  if (total <= visible) return 0;
  const half = Math.floor(visible / 2);
  return Math.max(0, Math.min(total - visible, selected - half));
}

module.exports = { Screen, clampWindow };
