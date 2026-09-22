'use strict';

const { PHASE, STATUS } = require('../shared/constants');
const { formatClock, formatDuration } = require('../shared/format');

const COLORS = {
  [PHASE.WORK]: '#e0483f',
  [PHASE.SHORT_BREAK]: '#1f9d63',
  [PHASE.LONG_BREAK]: '#2f7fd0',
  [PHASE.IDLE]: '#6b7280',
  paused: '#b4801f',
};

const PHASE_LABEL = {
  [PHASE.WORK]: 'Focus',
  [PHASE.SHORT_BREAK]: 'Short break',
  [PHASE.LONG_BREAK]: 'Long break',
  [PHASE.IDLE]: 'Ready',
};

/**
 * What the live icons say: minutes left (rounded up, so "1" in the final
 * minute and never "0" while time remains), or a tick once the phase is done.
 */
function iconLabel(state) {
  if (state.status === STATUS.AWAITING) return '✓';
  return String(Math.max(0, Math.ceil(state.remainingMs / 60000)));
}

/**
 * TaskbarIndicator — everything the Windows taskbar shows about the session:
 *
 *  - the taskbar button fills up as the current phase progresses;
 *  - the button's own icon becomes a cat face with the minutes left on it —
 *    at 24-32 px it is the largest place Windows lets an app put a number;
 *  - an overlay badge in the corner of the button carries today's worked time
 *    (or the pomodoro count / minutes left, per settings);
 *  - the window title counts down, so the time is readable from the taskbar's
 *    hover preview and from Alt-Tab;
 *  - the thumbnail toolbar gets start/pause and skip buttons;
 *  - the thumbnail tooltip spells out today's total.
 *
 * Images are only redrawn when the value on them changes, so this costs
 * nothing on a per-second tick.
 */
class TaskbarIndicator {
  constructor({ window, imageFactory, settings, getToday, onCommand, appIcon = null }) {
    this.appIcon = appIcon; // the normal icon, put back when nothing is running
    this._lastIconKey = 'app';
    this.win = window;
    this.images = imageFactory;
    this.settings = settings;
    this.getToday = getToday;
    this.onCommand = onCommand;
    this.isWindows = process.platform === 'win32';
    this._lastBadgeKey = null;
    this._lastTitle = null;
    this._lastProgress = -1;
    this._lastThumbKey = null;
  }

  setSettings(settings) {
    this.settings = settings;
    this._lastBadgeKey = null; // force a redraw under the new mode
    this._lastThumbKey = null;
    this._lastIconKey = null;
  }

  static colorFor(state) {
    if (state.status === STATUS.PAUSED) return COLORS.paused;
    return COLORS[state.phase] || COLORS[PHASE.IDLE];
  }

  async update(state) {
    if (!this.win || this.win.isDestroyed()) return;
    this._updateTitle(state);
    this._updateProgress(state);
    await this._updateIcon(state);
    await this._updateBadge(state);
    await this._updateThumbar(state);
    this._updateTooltip(state);
  }

  // --------------------------------------------------------------- title bar

  _updateTitle(state) {
    let title = 'Ferna Pomoro';
    if (this.settings.titleCountdown && state.phase !== PHASE.IDLE) {
      const label = PHASE_LABEL[state.phase];
      if (state.status === STATUS.AWAITING) {
        const over = state.overtimeMs > 0 ? ` +${formatClock(state.overtimeMs)}` : '';
        title = `Done${over} · ${label} — Ferna Pomoro`;
      } else {
        const paused = state.status === STATUS.PAUSED ? ' (paused)' : '';
        title = `${formatClock(Math.max(0, state.remainingMs))} · ${label}${paused} — Ferna Pomoro`;
      }
    }
    if (title !== this._lastTitle) {
      this.win.setTitle(title);
      this._lastTitle = title;
    }
  }

  // ------------------------------------------------------- taskbar progress

  _updateProgress(state) {
    if (!this.settings.taskbarProgress || state.phase === PHASE.IDLE) {
      if (this._lastProgress !== -1) {
        this.win.setProgressBar(-1);
        this._lastProgress = -1;
      }
      return;
    }
    let mode = 'normal';
    if (state.status === STATUS.PAUSED) mode = 'paused';
    else if (state.status === STATUS.AWAITING) mode = 'error';
    else if (state.phase !== PHASE.WORK) mode = 'paused';

    const value = state.status === STATUS.AWAITING ? 1 : state.progress;
    // Only redraw on a visible change (the bar is ~200px wide at most).
    if (Math.abs(value - this._lastProgress) < 0.004 && this._lastMode === mode) return;
    this.win.setProgressBar(value, { mode });
    this._lastProgress = value;
    this._lastMode = mode;
  }

  // ------------------------------------------------------ live button icon

  liveIconActive(state) {
    return !!this.settings.taskbarLiveIcon && state.phase !== PHASE.IDLE;
  }

  async _updateIcon(state) {
    if (!this.liveIconActive(state)) {
      if (this._lastIconKey !== 'app') {
        if (this.appIcon && !this.appIcon.isEmpty()) this.win.setIcon(this.appIcon);
        this._lastIconKey = 'app';
      }
      return;
    }
    const label = iconLabel(state);
    const color = TaskbarIndicator.colorFor(state);
    const progress = state.status === STATUS.AWAITING ? 0 : Math.round(state.progress * 10) / 10;
    const shape = this.settings.iconShape === 'round' ? 'round' : 'cat';
    const key = `${shape}|${label}|${color}|${progress}`;
    if (key === this._lastIconKey) return;
    this._lastIconKey = key;
    const spec = { label, color, progress, dimmed: false };
    const img = shape === 'cat' ? await this.images.catIcon(spec) : await this.images.trayIcon(spec);
    if (!this.win.isDestroyed() && !img.isEmpty()) this.win.setIcon(img);
  }

  // ---------------------------------------------------------- overlay badge

  _badgeSpec(state) {
    const today = this.getToday();
    const mode = this.settings.overlayBadge;
    if (mode === 'off') return null;
    // The button icon already carries the time; a badge would sit on top of it.
    if (this.liveIconActive(state)) return null;

    if (state.status === STATUS.PAUSED) {
      return { label: '॥', color: COLORS.paused, description: 'Paused' };
    }

    if (mode === 'remaining' && state.phase !== PHASE.IDLE) {
      const mins = Math.max(0, Math.ceil(state.remainingMs / 60000));
      return {
        label: String(mins),
        color: TaskbarIndicator.colorFor(state),
        description: `${mins} min left`,
        ring: state.progress,
      };
    }

    if (mode === 'focusTime') {
      const mins = Math.round(today.focusMs / 60000);
      const label = mins >= 60 ? `${Math.floor(mins / 60)}h` : String(mins);
      return {
        label,
        color: TaskbarIndicator.colorFor(state),
        description: `Focused ${formatDuration(today.focusMs)} today`,
      };
    }

    // Default: pomodoros completed today, ringed by progress on the current one.
    return {
      label: String(today.pomodoros),
      color: TaskbarIndicator.colorFor(state),
      description: `${today.pomodoros} pomodoros · ${formatDuration(today.focusMs)} today`,
      ring: state.phase === PHASE.WORK ? state.progress : 0,
    };
  }

  async _updateBadge(state) {
    if (!this.isWindows) return;
    const spec = this._badgeSpec(state);
    if (!spec) {
      if (this._lastBadgeKey !== null) {
        this.win.setOverlayIcon(null, '');
        this._lastBadgeKey = null;
      }
      return;
    }
    // Quantise the ring so it redraws ~20 times per phase, not 1500.
    const ring = spec.ring ? Math.round(spec.ring * 20) / 20 : 0;
    const key = `${spec.label}|${spec.color}|${ring}`;
    if (key === this._lastBadgeKey) return;
    this._lastBadgeKey = key;
    const img = await this.images.overlayBadge(spec.label, spec.color, { ring });
    if (!this.win.isDestroyed()) this.win.setOverlayIcon(img, spec.description);
  }

  // ------------------------------------------------------ thumbnail toolbar

  async _updateThumbar(state) {
    if (!this.isWindows) return;
    const running = state.status === STATUS.RUNNING;
    const key = `${state.status}|${state.phase}`;
    if (key === this._lastThumbKey) return;
    this._lastThumbKey = key;

    const [playPause, skip, stop] = await Promise.all([
      this.images.glyph(running ? 'pause' : 'play'),
      this.images.glyph('skip'),
      this.images.glyph('stop'),
    ]);
    if (this.win.isDestroyed()) return;

    const buttons = [
      {
        tooltip: running ? 'Pause' : state.phase === PHASE.IDLE ? 'Start focus' : 'Resume',
        icon: playPause,
        click: () => this.onCommand('toggle'),
      },
      {
        tooltip: 'Skip to next phase',
        icon: skip,
        flags: state.phase === PHASE.IDLE ? ['disabled'] : [],
        click: () => this.onCommand('skip'),
      },
      {
        tooltip: 'Stop',
        icon: stop,
        flags: state.phase === PHASE.IDLE ? ['disabled'] : [],
        click: () => this.onCommand('stop'),
      },
    ];
    try {
      this.win.setThumbarButtons(buttons);
    } catch (err) {
      console.error('[pomora] thumbar update failed:', err.message);
    }
  }

  _updateTooltip(state) {
    if (!this.isWindows) return;
    const today = this.getToday();
    const parts = [`Focused ${formatDuration(today.focusMs)} today`, `${today.pomodoros} pomodoros`];
    if (today.idleRemovedMs > 60000) parts.push(`${formatDuration(today.idleRemovedMs)} idle removed`);
    if (state.phase !== PHASE.IDLE && state.status !== STATUS.AWAITING) {
      parts.unshift(`${PHASE_LABEL[state.phase]}: ${formatClock(Math.max(0, state.remainingMs))} left`);
    }
    try {
      this.win.setThumbnailToolTip(parts.join(' · ').slice(0, 199));
    } catch {
      /* not fatal */
    }
  }

  clear() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setProgressBar(-1);
    if (this.isWindows) this.win.setOverlayIcon(null, '');
    if (this.appIcon && !this.appIcon.isEmpty()) this.win.setIcon(this.appIcon);
  }
}

module.exports = { TaskbarIndicator, COLORS, PHASE_LABEL, iconLabel };
