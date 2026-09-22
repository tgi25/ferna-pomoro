'use strict';

/**
 * "You haven't started work yet" — the reminder that follows a break.
 *
 * When a break runs out and the next focus session waits for the user to say
 * go, it is easy to drift: the break is over, the alert has been swiped away,
 * and twenty minutes later nothing has started. This decides when to put up a
 * full-screen reminder about it.
 *
 * It holds no timers of its own. The app calls `check()` from its one-per-tick
 * loop, so the reminder follows wall time the same way the pomodoro clock does
 * and cannot fire during hours the machine was asleep.
 *
 * Pure: no Electron, settings and clock are passed in, so it is unit-tested.
 */
class NotStartedNudge {
  constructor({ getSettings, now = Date.now } = {}) {
    this.getSettings = getSettings || (() => ({}));
    this.now = now;
    this.reset();
  }

  reset() {
    this.breakEndedAt = null; // when the break ran out
    this.anchor = null; // the moment the delay is counted from
    this.dueAt = null; // when the reminder should go up
    this.snoozed = false; // dueAt was set by "remind me later"
    this.showing = false;
    this.shownCount = 0;
  }

  get enabled() {
    return !!this.getSettings().notStartedReminder;
  }

  get delayMs() {
    const ms = Number(this.getSettings().notStartedAfterMs);
    return Number.isFinite(ms) && ms > 0 ? ms : 5 * 60 * 1000;
  }

  get armed() {
    return this.breakEndedAt !== null;
  }

  /** A break has just ended and focus is waiting for the user. */
  arm(breakEndedAt = this.now()) {
    this.reset();
    this.breakEndedAt = breakEndedAt;
    this.anchor = breakEndedAt;
    this.dueAt = breakEndedAt + this.delayMs;
  }

  /** Focus started, the timer stopped, or the feature was turned off. */
  disarm() {
    this.reset();
  }

  /**
   * The user has just come back to the machine. Nobody should be scolded for
   * not working while they were not there, so the delay starts again from the
   * moment they return.
   */
  restartFrom(t = this.now()) {
    if (!this.armed || this.showing) return;
    this.anchor = Math.max(this.anchor, t);
    this.dueAt = Math.max(this.dueAt, t + this.delayMs);
  }

  /** Settings changed: re-derive the due time unless the user snoozed it. */
  refresh() {
    if (!this.armed || this.showing || this.snoozed) return;
    this.dueAt = this.anchor + this.delayMs;
  }

  /**
   * Called every tick. Returns true exactly once per reminder, at the moment
   * the window should be shown.
   *
   * @param {object} ctx
   * @param {boolean} ctx.awaitingWork  the engine is waiting to start focus
   * @param {boolean} ctx.away          the user is not at the machine
   */
  check(now = this.now(), { awaitingWork, away } = {}) {
    if (!this.armed) return false;
    if (!awaitingWork) {
      // Focus started some other way (tray, shortcut, toast) — nothing to say.
      this.disarm();
      return false;
    }
    if (!this.enabled || this.showing || away) return false;
    if (now < this.dueAt) return false;
    this.showing = true;
    this.shownCount += 1;
    return true;
  }

  /** "Remind me in N minutes": take the window down and try again later. */
  snooze(now = this.now(), ms = this.delayMs) {
    if (!this.armed) return;
    this.showing = false;
    this.snoozed = true;
    this.dueAt = now + ms;
  }

  /** How long ago the break ended, for the window's counter. */
  sinceBreakMs(now = this.now()) {
    return this.armed ? Math.max(0, now - this.breakEndedAt) : 0;
  }
}

module.exports = { NotStartedNudge };
