'use strict';

/** Phases of the Pomodoro cycle. `IDLE` means nothing is scheduled. */
const PHASE = {
  IDLE: 'idle',
  WORK: 'work',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak',
};

/**
 * Engine status.
 *  STOPPED  - no phase in progress
 *  RUNNING  - counting down
 *  PAUSED   - frozen by the user (or by the idle watcher)
 *  AWAITING - the phase hit zero and we are waiting for the user to accept the
 *             next phase. Work phases may keep counting up ("overtime").
 */
const STATUS = {
  STOPPED: 'stopped',
  RUNNING: 'running',
  PAUSED: 'paused',
  AWAITING: 'awaiting',
};

/** What to do when the user comes back from being away. */
const IDLE_ACTION = {
  ASK: 'ask',
  DISCARD: 'discard',
  KEEP: 'keep',
  STOP: 'stop',
};

/** Reasons a phase ended, used for the session log. */
const END_REASON = {
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  STOPPED: 'stopped',
  IDLE_CUT: 'idle-cut',
};

const MINUTE = 60 * 1000;

const DEFAULT_SETTINGS = {
  // Durations (minutes in the UI, milliseconds internally).
  workMs: 25 * MINUTE,
  shortBreakMs: 5 * MINUTE,
  longBreakMs: 15 * MINUTE,
  longBreakInterval: 4,

  // Flow
  autoStartBreaks: true,
  autoStartWork: false,
  allowOvertime: true,
  dailyGoal: 8, // pomodoros

  // Idle handling
  idleDetection: true,
  idleThresholdSec: 300,
  idleAction: IDLE_ACTION.ASK,
  idleDuringBreaks: true, // detect "user came back" during a break
  treatSuspendAsIdle: true,

  // Alerts
  notifications: true,
  breakOverlay: true, // full-screen break window
  overlayDismissable: true, // "Back to work now" — ends the break early
  overlayCanHide: true, // "Close window" — leaves the curtain, break continues
  overlayReminder: true, // nudge when the break ends with the curtain closed
  notStartedReminder: true, // full-screen reminder when focus has not started after a break
  notStartedAfterMs: 5 * MINUTE, // …this long after the break ran out
  soundEnabled: true,
  volume: 0.7,
  tickingEnabled: false,
  workSound: 'work-start',
  shortBreakSound: 'short-break',
  longBreakSound: 'long-break',
  backToWorkSound: 'back-to-work',

  // Taskbar / tray
  taskbarProgress: true,
  overlayBadge: 'pomodoros', // 'pomodoros' | 'remaining' | 'focusTime' | 'off'
  titleCountdown: true,
  trayCountdown: true,
  minimizeToTray: true,
  closeToTray: true,

  // Window
  alwaysOnTopMini: true,
  launchOnStartup: false,
  theme: 'dark', // 'dark' | 'light' | 'system'

  // Shortcuts (global)
  shortcutToggle: 'CommandOrControl+Alt+P',
  shortcutSkip: 'CommandOrControl+Alt+S',
  shortcutMini: 'CommandOrControl+Alt+M',
};

module.exports = { PHASE, STATUS, IDLE_ACTION, END_REASON, DEFAULT_SETTINGS, MINUTE };
