'use strict';

const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');

/**
 * ImageFactory — draws small PNGs (taskbar overlay badges, tray icons,
 * thumbnail-toolbar glyphs) at runtime.
 *
 * The main process has no canvas, so a hidden, never-shown window is kept
 * around purely as a drawing surface. Results are cached by key: the taskbar
 * only needs a new image when the number on it actually changes.
 */
class ImageFactory {
  constructor() {
    this.cache = new Map();
    this.win = null;
    this.ready = null;
  }

  _ensure() {
    if (this.ready) return this.ready;
    this.win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      transparent: true,
      frame: false,
      skipTaskbar: true,
      webPreferences: {
        offscreen: false,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    this.ready = this.win.loadFile(path.join(__dirname, '..', 'renderer', 'canvas.html'));
    return this.ready;
  }

  async _draw(key, size, body) {
    if (this.cache.has(key)) return this.cache.get(key);
    await this._ensure();
    if (!this.win || this.win.isDestroyed()) return nativeImage.createEmpty();
    const script = `(() => {
      const c = document.createElement('canvas');
      c.width = ${size}; c.height = ${size};
      const ctx = c.getContext('2d');
      ${body}
      return c.toDataURL('image/png');
    })()`;
    try {
      const dataUrl = await this.win.webContents.executeJavaScript(script, true);
      const img = nativeImage.createFromDataURL(dataUrl);
      this.cache.set(key, img);
      if (this.cache.size > 400) {
        // Bound the cache; the oldest entries are the least likely to recur.
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      return img;
    } catch (err) {
      console.error('[pomora] icon draw failed:', err.message);
      return nativeImage.createEmpty();
    }
  }

  /**
   * Taskbar overlay badge: a filled disc with a short label (a pomodoro count,
   * minutes left, or "||"). Windows renders it at 16x16 in the corner of the
   * app's taskbar button, so the label stays to 1-3 glyphs.
   */
  overlayBadge(label, color, { ring = 0 } = {}) {
    const size = 48;
    const text = String(label);
    const key = `badge:${text}:${color}:${ring.toFixed(2)}`;
    const font = text.length >= 3 ? 22 : text.length === 2 ? 27 : 31;
    return this._draw(
      key,
      size,
      `
      const r = ${size} / 2;
      ctx.beginPath(); ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fillStyle = '${color}'; ctx.fill();
      ${
        ring > 0
          ? `ctx.beginPath(); ctx.arc(r, r, r - 2.5, -Math.PI/2, -Math.PI/2 + Math.PI*2*${ring});
             ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3.5; ctx.stroke();`
          : ''
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 ${font}px "Segoe UI Variable Display", "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(${JSON.stringify(text)}, r, r + 1);
      `
    );
  }

  /**
   * Tray icon: a tomato-red disc with a progress ring and the minutes left in
   * the middle, so the clock is readable without opening the window.
   */
  trayIcon({ label, color, progress = 0, dimmed = false }) {
    const size = 64;
    const text = String(label ?? '');
    const key = `tray:${text}:${color}:${progress.toFixed(2)}:${dimmed}`;
    const font = text.length >= 3 ? 27 : text.length === 2 ? 33 : 38;
    return this._draw(
      key,
      size,
      `
      const r = ${size} / 2;
      ctx.globalAlpha = ${dimmed ? 0.55 : 1};
      ctx.beginPath(); ctx.arc(r, r, r - 3, 0, Math.PI * 2);
      ctx.fillStyle = '${color}'; ctx.fill();
      ctx.beginPath(); ctx.arc(r, r, r - 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
      ${
        progress > 0
          ? `ctx.beginPath(); ctx.arc(r, r, r - 5, -Math.PI/2, -Math.PI/2 + Math.PI*2*${progress});
             ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();`
          : ''
      }
      ${
        text
          ? `ctx.fillStyle = '#ffffff';
             ctx.font = '700 ${font}px "Segoe UI Variable Display", "Segoe UI", sans-serif';
             ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
             ctx.fillText(${JSON.stringify(text)}, r, r + 2);`
          : ''
      }
      `
    );
  }

  /**
   * Live icon in the shape of a cat's face: two ears on a round head, filled
   * with the phase colour, and the minutes left written as large as the head
   * allows. Used for the tray icon and for the taskbar button itself.
   *
   * Windows shrinks a tray icon to 16x16 (more on high-DPI screens) and a
   * taskbar button icon to 24-32, so everything that is not the number is
   * kept to a minimum: no ring, no whiskers, one bold outline. Progress is
   * shown by the face darkening from the top as the phase runs down.
   */
  catIcon({ label, color, progress = 0, dimmed = false }) {
    const size = 64;
    const text = String(label ?? '');
    const key = `cat:${text}:${color}:${progress.toFixed(2)}:${dimmed}`;
    // As large as the face allows: one or two characters nearly fill it.
    const font = text.length >= 3 ? 30 : text.length === 2 ? 41 : 46;
    return this._draw(
      key,
      size,
      `
      const head = new Path2D();
      head.moveTo(3, 33);
      head.lineTo(4, 1);            // left ear tip
      head.lineTo(22, 16);          // left ear, inner side
      head.quadraticCurveTo(32, 13, 42, 16);   // top of the head
      head.lineTo(60, 1);           // right ear tip
      head.lineTo(61, 33);
      head.bezierCurveTo(62, 52, 49, 62, 32, 62);  // right cheek to chin
      head.bezierCurveTo(15, 62, 2, 52, 3, 33);    // chin to left cheek
      head.closePath();

      ctx.globalAlpha = ${dimmed ? 0.6 : 1};
      ctx.fillStyle = '${color}';
      ctx.fill(head);
      ${
        progress > 0
          ? `ctx.save(); ctx.clip(head);
             ctx.fillStyle = 'rgba(0,0,0,0.22)';
             ctx.fillRect(0, 0, ${size}, ${(size * progress).toFixed(1)});
             ctx.restore();`
          : ''
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke(head);
      ctx.globalAlpha = 1;
      ${
        text
          ? `ctx.font = '800 ${font}px "Segoe UI Variable Display", "Segoe UI", "Arial Narrow", sans-serif';
             ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
             // A dark rim under white digits keeps them legible on any colour.
             ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
             ctx.strokeText(${JSON.stringify(text)}, 32, 41);
             ctx.fillStyle = '#ffffff';
             ctx.fillText(${JSON.stringify(text)}, 32, 41);`
          : ''
      }
      `
    );
  }

  /** Glyphs for the taskbar thumbnail toolbar (play / pause / skip / stop). */
  glyph(name) {
    const size = 32;
    const key = `glyph:${name}`;
    const shapes = {
      play: `ctx.beginPath(); ctx.moveTo(10,7); ctx.lineTo(25,16); ctx.lineTo(10,25); ctx.closePath(); ctx.fill();`,
      pause: `ctx.fillRect(9,7,5,18); ctx.fillRect(18,7,5,18);`,
      skip: `ctx.beginPath(); ctx.moveTo(8,7); ctx.lineTo(20,16); ctx.lineTo(8,25); ctx.closePath(); ctx.fill(); ctx.fillRect(22,7,4,18);`,
      stop: `ctx.fillRect(9,9,14,14);`,
    };
    return this._draw(
      key,
      size,
      `ctx.fillStyle = '#ffffff'; ${shapes[name] || shapes.play}`
    );
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
    this.cache.clear();
  }
}

module.exports = { ImageFactory };
