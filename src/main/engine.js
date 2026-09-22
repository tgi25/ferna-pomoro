'use strict';

const { EventEmitter } = require('events');
const { PHASE, STATUS, END_REASON, DEFAULT_SETTINGS } = require('../shared/constants');

/**
 * PomodoroEngine — a pure, dependency-free state machine.
 *
 * Time model
 * ----------
 * Elapsed time inside a phase is `accumulatedMs` (finished segments) plus the
 * live segment `now - startedAt` while the clock is moving. Pausing folds the
 * live segment into `accumulatedMs`; resuming opens a new one. Nothing is
 * derived from tick counts, so a missed or late tick (throttled renderer,
 * laptop sleep, clock jitter) never drifts the clock — every read is computed
 * from wall time.
 *
 * `now` is injected everywhere so the machine can be unit-tested without
 * waiting for real seconds to pass.
 */
class PomodoroEngine extends EventEmitter {
  constructor(settings = {}, nowFn = Date.now) {
    super();
    this.now = nowFn;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };

    this.phase = PHASE.IDLE;
    this.status = STATUS.STOPPED;
    this.targetMs = 0;
    this.accumulatedMs = 0;
    this.startedAt = null; // wall time when the live segment opened
    this.phaseStartedAt = null; // wall time when the phase began
    this.idleRemovedMs = 0; // idle stripped out of the current phase
    this.nextPhase = null; // set while AWAITING
    this.overtimeFrom = null; // wall time the phase hit zero (overtime anchor)
    this.overtimeFrozenMs = null; // set while the user is away mid-overtime

    this.completedWorkInCycle = 0; // work sessions since the last long break
    this.taskId = null;
  }

  // ---------------------------------------------------------------- settings

  updateSettings(patch) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    // Re-target a phase in flight if its duration changed, so a settings edit
    // takes effect immediately rather than at the next phase.
    const map = {
      [PHASE.WORK]: 'workMs',
      [PHASE.SHORT_BREAK]: 'shortBreakMs',
      [PHASE.LONG_BREAK]: 'longBreakMs',
    };
    const key = map[this.phase];
    if (key && this.status !== STATUS.STOPPED && this.settings[key] !== prev[key]) {
      this.targetMs = this.settings[key];
    }
    this._emitState();
  }

  durationFor(phase) {
    switch (phase) {
      case PHASE.WORK:
        return this.settings.workMs;
      case PHASE.SHORT_BREAK:
        return this.settings.shortBreakMs;
      case PHASE.LONG_BREAK:
        return this.settings.longBreakMs;
      default:
        return 0;
    }
  }

  // ------------------------------------------------------------------ clocks

  elapsedMs(now = this.now()) {
    const live = this.startedAt === null ? 0 : Math.max(0, now - this.startedAt);
    return this.accumulatedMs + live;
  }

  remainingMs(now = this.now()) {
    return this.targetMs - this.elapsedMs(now);
  }

  /** Seconds past the end of the phase while the user has not acted yet. */
  overtimeMs(now = this.now()) {
    if (this.status !== STATUS.AWAITING || this.overtimeFrom === null) return 0;
    if (this.overtimeFrozenMs !== null && this.overtimeFrozenMs !== undefined) {
      return this.overtimeFrozenMs;
    }
    return Math.max(0, now - this.overtimeFrom);
  }

  /**
   * Stop overtime accruing as of `at` — used when the user walks away while a
   * finished work session is still counting up. Nothing is lost: the frozen
   * amount is what gets logged if they accept the next phase.
   */
  freezeOvertime(at = this.now()) {
    if (this.status !== STATUS.AWAITING || this.overtimeFrom === null) return;
    this.overtimeFrozenMs = Math.max(0, at - this.overtimeFrom);
    this._emitState();
  }

  /** Resume overtime counting from wherever it was frozen. */
  unfreezeOvertime(now = this.now()) {
    if (this.overtimeFrozenMs === null || this.overtimeFrozenMs === undefined) return;
    this.overtimeFrom = now - this.overtimeFrozenMs;
    this.overtimeFrozenMs = null;
    this._emitState();
  }

  /**
   * Record away-time that was kept out of this phase without the clock ever
   * counting it — the part of an absence that elapsed while the timer was
   * already frozen. The clock does not move; only the "idle removed" tally
   * does, so the statistic reflects the whole gap the app kept out of the
   * session rather than just the few minutes it had to rewind.
   */
  noteIdleExcluded(ms) {
    if (ms <= 0 || this.phase === PHASE.IDLE) return 0;
    this.idleRemovedMs += ms;
    this._emitState();
    return ms;
  }

  /** Give time back to the phase (the user chose to count idle time as work). */
  addTime(ms, now = this.now()) {
    if (ms <= 0 || this.phase === PHASE.IDLE) return 0;
    this.accumulatedMs = this.elapsedMs(now) + ms;
    if (this.startedAt !== null) this.startedAt = now;
    this.idleRemovedMs = Math.max(0, this.idleRemovedMs - ms);
    this._emitState();
    return ms;
  }

  isClockMoving() {
    return this.status === STATUS.RUNNING;
  }

  // ------------------------------------------------------------- transitions

  /** Begin a phase from scratch. */
  startPhase(phase, now = this.now(), { silent = false, targetMs = null } = {}) {
    this.phase = phase;
    this.status = STATUS.RUNNING;
    this.targetMs = targetMs > 0 ? targetMs : this.durationFor(phase);
    this.accumulatedMs = 0;
    this.startedAt = now;
    this.phaseStartedAt = now;
    this.idleRemovedMs = 0;
    this.nextPhase = null;
    this.overtimeFrom = null;
    this.overtimeFrozenMs = null;
    if (!silent) this.emit('phase-start', { phase, at: now, targetMs: this.targetMs });
    this._emitState();
  }

  /** Start work (or resume whatever is paused / awaiting). */
  start(now = this.now()) {
    if (this.status === STATUS.PAUSED) return this.resume(now);
    if (this.status === STATUS.AWAITING) return this.acceptNext(now);
    if (this.status === STATUS.STOPPED) return this.startPhase(PHASE.WORK, now);
  }

  pause(now = this.now(), reason = 'user') {
    if (this.status !== STATUS.RUNNING) return;
    this.accumulatedMs = this.elapsedMs(now);
    this.startedAt = null;
    this.status = STATUS.PAUSED;
    this.emit('paused', { reason, at: now });
    this._emitState();
  }

  resume(now = this.now()) {
    if (this.status !== STATUS.PAUSED) return;
    this.startedAt = now;
    this.status = STATUS.RUNNING;
    this.emit('resumed', { at: now });
    this._emitState();
  }

  toggle(now = this.now()) {
    if (this.status === STATUS.RUNNING) this.pause(now);
    else this.start(now);
  }

  /** Abandon the current phase without counting it as completed. */
  stop(now = this.now(), reason = END_REASON.STOPPED) {
    if (this.status === STATUS.STOPPED) return;
    const entry = this._buildEntry(now, reason, false);
    this.phase = PHASE.IDLE;
    this.status = STATUS.STOPPED;
    this.targetMs = 0;
    this.accumulatedMs = 0;
    this.startedAt = null;
    this.phaseStartedAt = null;
    this.overtimeFrom = null;
    this.overtimeFrozenMs = null;
    this.nextPhase = null;
    if (entry) this.emit('session-logged', entry);
    this.emit('stopped', { at: now, reason });
    this._emitState();
  }

  /** Jump straight to the next phase; the current one is logged as skipped. */
  skip(now = this.now()) {
    if (this.status === STATUS.STOPPED) return;
    if (this.status === STATUS.AWAITING) return this.acceptNext(now);
    const finished = this.phase;
    const entry = this._buildEntry(now, END_REASON.SKIPPED, false);
    if (entry) this.emit('session-logged', entry);
    const next = this._nextPhaseAfter(finished, { counted: false });
    this.startPhase(next, now);
  }

  /**
   * Lengthen (or shorten, with a negative value) the phase in flight. Only
   * meaningful while the clock is live — a finished phase has already been
   * logged, so time after it is recorded as overtime instead.
   */
  extend(ms, now = this.now()) {
    if (this.phase === PHASE.IDLE || this.status === STATUS.AWAITING) return false;
    this.targetMs = Math.max(60 * 1000, this.targetMs + ms);
    this.emit('extended', { ms, at: now, targetMs: this.targetMs });
    this._emitState();
    return true;
  }

  /** Restart the current phase from its full duration. */
  reset(now = this.now()) {
    if (this.phase === PHASE.IDLE) return;
    this.startPhase(this.phase, now);
  }

  /** Accept the phase the engine is waiting on (ends any overtime). */
  /**
   * Start what comes next. `phase` overrides the scheduled next phase — e.g.
   * "another focus session" instead of the break that was due.
   */
  acceptNext(now = this.now(), { phase = null } = {}) {
    if (this.status !== STATUS.AWAITING) return;
    const over = this.overtimeMs(now);
    if (over > 1000 && this.phase === PHASE.WORK) {
      this.emit('session-logged', {
        type: 'overtime',
        phase: PHASE.WORK,
        startedAt: this.overtimeFrom,
        endedAt: now,
        plannedMs: 0,
        workedMs: over,
        idleRemovedMs: 0,
        reason: END_REASON.COMPLETED,
        completed: true,
        taskId: this.taskId,
      });
    }
    const next = phase || this.nextPhase || PHASE.WORK;
    this.startPhase(next, now);
  }

  /** Decline the pending phase and go back to a stopped state. */
  dismissNext(now = this.now()) {
    if (this.status !== STATUS.AWAITING) return;
    this.acceptNext(now);
    this.stop(now, END_REASON.STOPPED);
  }

  /**
   * Advance the clock. Call as often as convenient (a second is plenty);
   * correctness does not depend on the interval.
   */
  tick(now = this.now()) {
    if (this.status === STATUS.RUNNING && this.elapsedMs(now) >= this.targetMs) {
      // Anchor completion at the exact moment the phase should have ended, not
      // at this tick, so a late tick does not steal time from the next phase.
      const endedAt = this.startedAt === null
        ? now
        : Math.min(now, this.startedAt + (this.targetMs - this.accumulatedMs));
      this._complete(endedAt, now);
    }
    this.emit('tick', this.snapshot(now));
  }

  // ---------------------------------------------------------- idle accounting

  /**
   * Strip `ms` of away-time out of the current phase (the timer rewinds).
   * Returns how much was actually removed.
   */
  removeIdle(ms, now = this.now()) {
    if (ms <= 0 || this.phase === PHASE.IDLE) return 0;
    const before = this.elapsedMs(now);
    const after = Math.max(0, before - ms);
    const removed = before - after;
    this.accumulatedMs = after;
    if (this.startedAt !== null) this.startedAt = now;
    this.idleRemovedMs += removed;
    if (this.status === STATUS.AWAITING) {
      // Rewinding out of overtime puts the phase back on the clock.
      this.status = STATUS.PAUSED;
      this.overtimeFrom = null;
    this.overtimeFrozenMs = null;
      this.nextPhase = null;
    }
    this.emit('idle-removed', { ms: removed, at: now });
    this._emitState();
    return removed;
  }

  /**
   * End the current phase as if the user had stopped working when they walked
   * away: everything from `awayStart` onwards is discarded and the phase is
   * logged with the work actually done before that.
   */
  cutAt(awayStart, now = this.now()) {
    if (this.phase === PHASE.IDLE) return null;
    const away = Math.max(0, now - awayStart);
    this.removeIdle(away, now);
    const entry = this._buildEntry(now, END_REASON.IDLE_CUT, false);
    if (entry) this.emit('session-logged', entry);
    this.phase = PHASE.IDLE;
    this.status = STATUS.STOPPED;
    this.targetMs = 0;
    this.accumulatedMs = 0;
    this.startedAt = null;
    this.overtimeFrom = null;
    this.overtimeFrozenMs = null;
    this.nextPhase = null;
    this.emit('stopped', { at: now, reason: END_REASON.IDLE_CUT });
    this._emitState();
    return entry;
  }

  // ----------------------------------------------------------------- internals

  _complete(endedAt, now = this.now()) {
    const finished = this.phase;
    this.accumulatedMs = this.targetMs;
    this.startedAt = null;

    const entry = this._buildEntry(endedAt, END_REASON.COMPLETED, true);
    if (finished === PHASE.WORK) this.completedWorkInCycle += 1;
    if (entry) this.emit('session-logged', entry);

    const next = this._nextPhaseAfter(finished, { counted: true });
    const autoStart =
      next === PHASE.WORK ? this.settings.autoStartWork : this.settings.autoStartBreaks;

    this.emit('phase-complete', {
      phase: finished,
      next,
      at: endedAt,
      autoStart,
      cycleCount: this.completedWorkInCycle,
      entry,
    });

    if (autoStart) {
      this.startPhase(next, endedAt);
    } else {
      this.status = STATUS.AWAITING;
      this.nextPhase = next;
      this.overtimeFrom =
        finished === PHASE.WORK && this.settings.allowOvertime ? endedAt : null;
      this.overtimeFrozenMs = null;
      this._emitState();
    }
  }

  _nextPhaseAfter(finished, { counted }) {
    if (finished !== PHASE.WORK) return PHASE.WORK;
    const done = counted ? this.completedWorkInCycle : this.completedWorkInCycle + 1;
    const every = Math.max(1, this.settings.longBreakInterval);
    return done % every === 0 ? PHASE.LONG_BREAK : PHASE.SHORT_BREAK;
  }

  _buildEntry(endedAt, reason, completed) {
    if (this.phase === PHASE.IDLE || this.phaseStartedAt === null) return null;
    const worked = Math.max(0, Math.min(this.elapsedMs(endedAt), this.targetMs));
    if (worked < 1000 && !completed) return null; // ignore accidental taps
    return {
      type: 'phase',
      phase: this.phase,
      startedAt: this.phaseStartedAt,
      endedAt,
      plannedMs: this.targetMs,
      workedMs: worked,
      idleRemovedMs: this.idleRemovedMs,
      reason,
      completed,
      taskId: this.taskId,
    };
  }

  _emitState() {
    this.emit('state', this.snapshot());
  }

  snapshot(now = this.now()) {
    const elapsed = this.elapsedMs(now);
    const remaining = this.targetMs - elapsed;
    return {
      phase: this.phase,
      status: this.status,
      nextPhase: this.nextPhase,
      targetMs: this.targetMs,
      elapsedMs: elapsed,
      remainingMs: remaining,
      overtimeMs: this.overtimeMs(now),
      progress: this.targetMs > 0 ? Math.min(1, Math.max(0, elapsed / this.targetMs)) : 0,
      idleRemovedMs: this.idleRemovedMs,
      completedWorkInCycle: this.completedWorkInCycle,
      longBreakInterval: this.settings.longBreakInterval,
      taskId: this.taskId,
      phaseStartedAt: this.phaseStartedAt,
    };
  }

  restoreCycle(count) {
    this.completedWorkInCycle = Number.isFinite(count) ? count : 0;
  }

  setTask(taskId) {
    this.taskId = taskId;
    this._emitState();
  }
}

module.exports = { PomodoroEngine };
