'use strict';

const { EventEmitter } = require('events');

/**
 * IdleWatcher — turns a stream of "seconds since last input" readings into
 * discrete away-episodes.
 *
 * Windows reports idle time per session, so this catches walking away, locking
 * the screen and sleep alike. `getIdleSeconds` and `nowFn` are injected so the
 * behaviour can be tested without a real desktop.
 *
 * Events:
 *   away-start { awayStart, idleMs }  - crossed the threshold
 *   away-tick  { awayStart, idleMs }  - still away (once a second)
 *   away-end   { awayStart, returnedAt, idleMs } - input seen again
 */
class IdleWatcher extends EventEmitter {
  constructor({ getIdleSeconds, nowFn = Date.now, thresholdSec = 300, pollMs = 1000 }) {
    super();
    this.getIdleSeconds = getIdleSeconds;
    this.now = nowFn;
    this.thresholdSec = thresholdSec;
    this.pollMs = pollMs;
    this.timer = null;
    this.away = false;
    this.awayStart = null;
    this.enabled = true;
  }

  setThreshold(sec) {
    this.thresholdSec = Math.max(30, sec | 0);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on && this.away) this._reset();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._reset();
  }

  _reset() {
    this.away = false;
    this.awayStart = null;
  }

  /** Exposed for tests and for forcing a check after a wake-from-sleep. */
  poll() {
    if (!this.enabled) return;
    const now = this.now();
    let idleSec;
    try {
      idleSec = this.getIdleSeconds();
    } catch {
      return; // a failed reading is not evidence of anything
    }
    if (!Number.isFinite(idleSec) || idleSec < 0) return;
    const idleMs = idleSec * 1000;

    if (!this.away) {
      if (idleSec >= this.thresholdSec) {
        this.away = true;
        this.awayStart = now - idleMs;
        this.emit('away-start', { awayStart: this.awayStart, idleMs });
      }
      return;
    }

    // Already away: a reading below the threshold means input happened.
    if (idleSec < this.thresholdSec) {
      const returnedAt = now - idleMs;
      const awayStart = this.awayStart;
      this._reset();
      this.emit('away-end', {
        awayStart,
        returnedAt,
        idleMs: Math.max(0, returnedAt - awayStart),
      });
    } else {
      this.emit('away-tick', { awayStart: this.awayStart, idleMs: now - this.awayStart });
    }
  }

  /**
   * Report an away-episode the poller could not see — a suspend/resume pair, or
   * a locked screen. Emits the same start/end pair so callers have one path.
   */
  reportExternalAway(awayStart, returnedAt = this.now()) {
    const idleMs = Math.max(0, returnedAt - awayStart);
    if (idleMs < 1000) return;
    if (this.away) this._reset();
    this.emit('away-start', { awayStart, idleMs });
    this.emit('away-end', { awayStart, returnedAt, idleMs });
  }
}

module.exports = { IdleWatcher };
