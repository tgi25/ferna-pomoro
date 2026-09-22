'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  powerMonitor,
  dialog,
  shell,
  nativeImage,
} = require('electron');

const { PHASE, STATUS, IDLE_ACTION, END_REASON, MINUTE } = require('../shared/constants');
const { formatClock, formatDuration, dayKey } = require('../shared/format');
const { PomodoroEngine } = require('./engine');
const { IdleWatcher } = require('./idle-watcher');
const { Store } = require('./store');
const { Notifier } = require('./notifier');
const { ImageFactory } = require('./image-factory');
const { NotStartedNudge } = require('./nudge');
const { TaskbarIndicator, COLORS, PHASE_LABEL } = require('./taskbar');
const windows = require('./windows');

const APP_ID = 'lk.ac.sjp.ferna-pomoro';
const TICK_MS = 500;
// A jump larger than this between ticks means the machine slept (or was
// hibernated); it is treated as away-time, not as work.
const TIME_GAP_MS = 60 * 1000;

class PomoraApp {
  constructor() {
    Store.migrateLegacyFolder(app.getPath('userData'));
    this.store = new Store(app.getPath('userData'));
    this.engine = new PomodoroEngine(this.store.settings);
    this.engine.restoreCycle(this.store.getCycleCount());

    this.images = new ImageFactory();
    this.notifier = new Notifier({
      getSettings: () => this.store.settings,
      onAction: (id) => this.handleAction(id),
    });
    this.watcher = new IdleWatcher({
      getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
      thresholdSec: this.store.settings.idleThresholdSec,
    });

    this.win = null;
    this.mini = null;
    this.overlays = [];
    this.nudgeWins = [];
    this.nudge = new NotStartedNudge({ getSettings: () => this.store.settings });
    this.idleWin = null;
    this.tray = null;
    this.taskbar = null;

    this.prevPhase = PHASE.IDLE;
    this.awayState = null; // { awayStart, frozen, phase }
    this.pendingIdle = null; // awaiting the user's answer
    this.snoozeTimer = null;
    this.lastTickAt = Date.now();
    this.lastTrayKey = null;
    this.overlayHidden = false; // curtain closed by the user, break still running
    this.quitting = false;
    this.goalAnnouncedOn = null;
  }

  // ------------------------------------------------------------------ set-up

  start() {
    this.createWindows();
    this.createTray();
    this.bindEngine();
    this.bindIdle();
    this.bindPower();
    this.bindIpc();
    this.registerShortcuts();

    this.watcher.setEnabled(this.store.settings.idleDetection);
    this.watcher.start();

    this.ticker = setInterval(() => this.onTick(), TICK_MS);
    this.broadcastAll();
  }

  createWindows() {
    this.win = windows.createMainWindow({ bounds: this.store.data.meta.bounds });
    this.win.once('ready-to-show', () => {
      if (!this.store.data.meta.startMinimised) this.win.show();
    });

    this.taskbar = new TaskbarIndicator({
      window: this.win,
      imageFactory: this.images,
      settings: this.store.settings,
      getToday: () => this.store.today(),
      onCommand: (cmd) => this.handleAction(cmd),
    });

    this.win.on('close', (event) => {
      if (!this.quitting && this.store.settings.closeToTray) {
        event.preventDefault();
        this.win.hide();
        return;
      }
      this.store.data.meta.bounds = this.win.getNormalBounds();
      this.store.save({ immediate: true });
    });

    this.win.on('minimize', () => {
      if (this.store.settings.minimizeToTray) this.win.hide();
    });
  }

  createTray() {
    const icon = nativeImage.createFromPath(
      path
        .join(__dirname, '..', '..', 'assets', 'icons', 'pomora-32.png')
        .replace('app.asar', 'app.asar.unpacked')
    );
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    this.tray.setToolTip('Ferna Pomoro');
    this.tray.on('click', () => this.showMain());
    this.tray.on('double-click', () => this.showMain());
    this.refreshTrayMenu();
  }

  refreshTrayMenu() {
    if (!this.tray) return;
    const s = this.engine.snapshot();
    const today = this.store.today();
    const running = s.status === STATUS.RUNNING;
    const menu = Menu.buildFromTemplate([
      {
        label: `Today: ${formatDuration(today.focusMs)} · ${today.pomodoros} pomodoros`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: running ? 'Pause' : s.phase === PHASE.IDLE ? 'Start focus' : 'Resume',
        click: () => this.handleAction('toggle'),
      },
      { label: 'Skip to next', enabled: s.phase !== PHASE.IDLE, click: () => this.handleAction('skip') },
      { label: 'Stop', enabled: s.phase !== PHASE.IDLE, click: () => this.handleAction('stop') },
      { type: 'separator' },
      {
        label: 'Show break screen',
        visible: this.canReopenOverlay(),
        click: () => this.showOverlays(this.engine.phase, { manual: true }),
      },
      { label: 'Start short break', click: () => this.startPhaseManually(PHASE.SHORT_BREAK) },
      { label: 'Start long break', click: () => this.startPhaseManually(PHASE.LONG_BREAK) },
      { type: 'separator' },
      { label: 'Mini timer', type: 'checkbox', checked: !!(this.mini && this.mini.isVisible()), click: () => this.toggleMini() },
      { label: 'Open Ferna Pomoro', click: () => this.showMain() },
      { label: 'Settings', click: () => this.showMain('settings') },
      { type: 'separator' },
      { label: 'Quit', click: () => this.quit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  // ----------------------------------------------------------------- engine

  bindEngine() {
    this.engine.on('state', () => this.broadcastAll());

    this.engine.on('phase-start', ({ phase, targetMs }) => {
      this.clearNudge();
      const cameFromBreak = this.prevPhase === PHASE.SHORT_BREAK || this.prevPhase === PHASE.LONG_BREAK;
      this.prevPhase = phase;
      const minutes = Math.round(targetMs / MINUTE);

      if (phase === PHASE.WORK) {
        // A work phase must never run while nobody is at the machine.
        if (this.watcher.away && this.store.settings.idleDetection) {
          this.beginAway(this.watcher.awayStart || Date.now(), { force: true });
        }
        if (cameFromBreak) {
          this.notifier.resumedWork({ minutes, taskTitle: this.currentTaskTitle() });
          this.play('back-to-work');
        } else {
          this.notifier.workAlert({
            index: this.engine.completedWorkInCycle + 1,
            total: this.store.settings.dailyGoal,
            minutes,
            taskTitle: this.currentTaskTitle(),
          });
          this.play('work-start');
        }
        this.overlayHidden = false;
        this.hideOverlays();
      } else {
        this.play(phase === PHASE.LONG_BREAK ? 'long-break' : 'short-break');
        this.showOverlays(phase);
      }
      this.refreshTrayMenu();
      this.broadcastAll();
    });

    this.engine.on('phase-complete', ({ phase, next, at, autoStart }) => {
      const minutes = Math.round(this.engine.durationFor(next) / MINUTE);
      const pomodoros = this.store.today().pomodoros;
      if (phase === PHASE.WORK) {
        if (next === PHASE.LONG_BREAK) this.notifier.longBreakAlert({ minutes, pomodoros });
        else this.notifier.shortBreakAlert({ minutes, pomodoros });
        if (!autoStart) {
          this.play(next === PHASE.LONG_BREAK ? 'long-break' : 'short-break');
          this.flashWindow();
        }
      } else if (!autoStart) {
        // Break finished and the user has to say go — this is the back-to-work
        // nudge. If they are away, it waits for them (see endAway).
        if (!this.watcher.away) {
          this.notifier.breakOver({ next: this.currentTaskTitle(), minutes });
          this.play('back-to-work');
          this.flashWindow();
        }
        this.hideOverlays();
        // …and if focus still has not started a while later, say so again,
        // this time in a way that cannot be swiped away.
        if (next === PHASE.WORK) this.nudge.arm(at || Date.now());
      } else if (this.overlayHidden && this.store.settings.overlayReminder) {
        // The curtain was closed, so nothing on screen marked the end of the
        // break. Say so, since work is about to start under the user's hands.
        this.notifier.show({
          title: '⏰ Break over',
          body: `${minutes} minutes of focus starting now.`,
        });
      }
      if (phase !== PHASE.WORK) this.hideOverlays();
      this.emitAll('alert', { phase, next, autoStart });
    });

    this.engine.on('session-logged', (entry) => {
      this.store.logSession(entry);
      this.store.setCycleCount(this.engine.completedWorkInCycle);
      this.checkDailyGoal();
      this.broadcastAll();
    });

    this.engine.on('stopped', () => {
      this.clearNudge();
      this.overlayHidden = false;
      this.hideOverlays();
      this.prevPhase = PHASE.IDLE;
      this.refreshTrayMenu();
    });

    this.engine.on('paused', () => this.refreshTrayMenu());
    this.engine.on('resumed', () => this.refreshTrayMenu());
  }

  onTick() {
    const now = Date.now();
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;

    // Detect sleep/hibernate before advancing the clock, so a phase can never
    // "complete" during hours the machine was off.
    if (gap > TIME_GAP_MS && this.store.settings.idleDetection) {
      const gapStart = now - gap;
      this.beginAway(gapStart);
      this.endAway(gapStart, now, { source: 'sleep' });
    }
    // Whether or not idle detection is on, a machine that has just woken up
    // should not greet its user with "you haven't started yet".
    if (gap > TIME_GAP_MS) this.nudge.restartFrom(now);

    this.engine.tick(now);
    this.checkNudge(now);
    this.updateIndicators();
    this.broadcastTick();
  }

  // ------------------------------------------------------------------- idle

  bindIdle() {
    this.watcher.on('away-start', ({ awayStart }) => this.beginAway(awayStart));
    this.watcher.on('away-end', ({ awayStart, returnedAt }) =>
      this.endAway(awayStart, returnedAt, { source: 'input' })
    );
  }

  bindPower() {
    powerMonitor.on('suspend', () => {
      this.suspendedAt = Date.now();
    });
    powerMonitor.on('resume', () => {
      const from = this.suspendedAt || Date.now();
      this.suspendedAt = null;
      if (Date.now() - from > 30 * 1000) {
        this.beginAway(from);
        this.endAway(from, Date.now(), { source: 'sleep' });
      }
    });
    powerMonitor.on('lock-screen', () => {
      if (this.store.settings.idleDetection) this.beginAway(Date.now());
    });
    powerMonitor.on('unlock-screen', () => {
      if (this.awayState) this.endAway(this.awayState.awayStart, Date.now(), { source: 'unlock' });
    });
  }

  /**
   * The user has left. Rewind the work clock to the moment they stopped
   * touching the machine and freeze it there, so away-time can never be
   * mistaken for focus. Breaks are deliberately left running — being away from
   * the desk is what a break is for.
   */
  beginAway(awayStart, { force = false } = {}) {
    if (!this.store.settings.idleDetection && !force) return;
    if (this.awayState) return; // already frozen
    const s = this.engine.snapshot();
    const isWork = s.phase === PHASE.WORK;
    const inOvertime = s.status === STATUS.AWAITING && s.overtimeMs > 0;
    if (!isWork && !inOvertime) {
      this.awayState = { awayStart, frozen: false, phase: s.phase };
      return;
    }
    if (this.store.settings.idleAction === IDLE_ACTION.KEEP) {
      this.awayState = { awayStart, frozen: false, phase: s.phase };
      return;
    }

    const now = Date.now();
    let rewound = 0;
    if (s.status === STATUS.RUNNING) {
      const counted = Math.max(0, now - awayStart);
      rewound = this.engine.removeIdle(counted, now);
      this.engine.pause(now, 'idle');
    } else if (inOvertime) {
      this.engine.freezeOvertime(awayStart);
    }
    this.awayState = { awayStart, frozen: true, phase: s.phase, rewound };
    this.broadcastAll();
  }

  /** The user is back. Decide what happens to the time they were away. */
  endAway(awayStart, returnedAt, { source } = {}) {
    const away = this.awayState;
    this.awayState = null;
    const idleMs = Math.max(0, returnedAt - awayStart);
    // The not-started reminder counts from the moment they sat back down.
    this.nudge.restartFrom(returnedAt);
    const s = this.engine.snapshot();
    const thresholdMs = this.store.settings.idleThresholdSec * 1000;

    // Coming back to a break that has already run out: this is the moment to
    // say "back to work", not while they were away from the desk.
    if (!away || !away.frozen) {
      if (s.status === STATUS.AWAITING && s.nextPhase === PHASE.WORK) {
        this.play('back-to-work');
        if (this.store.settings.autoStartWork) {
          this.engine.acceptNext(returnedAt);
        } else {
          this.notifier.welcomeBack({
            awayText: formatDuration(idleMs),
            phaseLabel: PHASE_LABEL[away ? away.phase : s.phase] || 'break',
          });
          this.flashWindow();
          this.showMain();
        }
      }
      this.broadcastAll();
      return;
    }

    // Work time was frozen. Short machine-sleeps resolve themselves.
    const action = this.store.settings.idleAction;
    const untallied = Math.max(0, idleMs - (away.rewound || 0));
    if (idleMs < thresholdMs || action === IDLE_ACTION.DISCARD) {
      this.engine.noteIdleExcluded(untallied);
      this.engine.unfreezeOvertime(returnedAt);
      if (this.engine.status === STATUS.PAUSED) this.engine.resume(returnedAt);
      if (idleMs >= thresholdMs) {
        this.notifier.show({
          title: '⏱️ Idle time removed',
          body: `${formatDuration(idleMs)} away — the pomodoro picked up where you left it.`,
        });
      }
      this.broadcastAll();
      return;
    }

    if (action === IDLE_ACTION.STOP) {
      this.engine.noteIdleExcluded(untallied);
      this.engine.stop(awayStart, END_REASON.IDLE_CUT);
      this.notifier.show({
        title: '⏹️ Pomodoro ended',
        body: `You were away ${formatDuration(idleMs)}; the session was closed at ${new Date(
          awayStart
        ).toLocaleTimeString()}.`,
      });
      this.broadcastAll();
      return;
    }

    // Ask.
    this.pendingIdle = {
      awayStart,
      returnedAt,
      idleMs,
      untallied,
      phase: away.phase,
      elapsedMs: s.elapsedMs,
      remainingMs: s.remainingMs,
      overtimeMs: s.overtimeMs,
      source,
    };
    this.showIdlePrompt();
    this.notifier.idleDetected({ awayText: formatDuration(idleMs) });
    this.play('idle-return');
  }

  showIdlePrompt() {
    if (!this.idleWin || this.idleWin.isDestroyed()) {
      this.idleWin = windows.createIdleWindow();
      this.idleWin.on('closed', () => {
        this.idleWin = null;
      });
      this.idleWin.webContents.once('did-finish-load', () => this.sendIdlePrompt());
    } else {
      this.sendIdlePrompt();
    }
    this.idleWin.once('ready-to-show', () => {
      this.idleWin.show();
      this.idleWin.focus();
    });
    if (this.idleWin.isVisible()) this.idleWin.focus();
    else if (!this.idleWin.isDestroyed() && this.idleWin.webContents.isLoading() === false) {
      this.idleWin.show();
      this.idleWin.focus();
    }
  }

  sendIdlePrompt() {
    if (!this.idleWin || this.idleWin.isDestroyed() || !this.pendingIdle) return;
    this.idleWin.webContents.send('pomora:idle-prompt', {
      ...this.pendingIdle,
      phaseLabel: PHASE_LABEL[this.pendingIdle.phase] || 'session',
      awayText: formatDuration(this.pendingIdle.idleMs),
      awayClock: formatDuration(this.pendingIdle.idleMs),
      leftAt: new Date(this.pendingIdle.awayStart).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      backAt: new Date(this.pendingIdle.returnedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      elapsedText: formatDuration(this.pendingIdle.elapsedMs),
      remainingText: formatDuration(Math.max(0, this.pendingIdle.remainingMs)),
    });
  }

  /** Apply the user's answer to "you were away for N minutes". */
  resolveIdle(choice, opts = {}) {
    const pending = this.pendingIdle;
    this.pendingIdle = null;
    if (this.idleWin && !this.idleWin.isDestroyed()) this.idleWin.hide();
    if (!pending) return;
    const now = Date.now();

    // Every outcome but "count it as work" keeps the whole absence out of the
    // session, so the whole absence is what the statistics should report.
    if (choice !== 'keep') this.engine.noteIdleExcluded(pending.untallied || 0);

    switch (choice) {
      case 'keep':
        // Count the away-time as work after all.
        this.engine.addTime(pending.idleMs, now);
        this.engine.unfreezeOvertime(now);
        if (this.engine.status === STATUS.PAUSED) this.engine.resume(now);
        break;

      case 'cut':
        // End the pomodoro at the moment they walked away.
        this.engine.stop(pending.awayStart, END_REASON.IDLE_CUT);
        break;

      case 'break': {
        this.engine.stop(pending.awayStart, END_REASON.IDLE_CUT);
        const next =
          this.engine.completedWorkInCycle > 0 &&
          this.engine.completedWorkInCycle % this.store.settings.longBreakInterval === 0
            ? PHASE.LONG_BREAK
            : PHASE.SHORT_BREAK;
        this.engine.startPhase(next, now);
        break;
      }

      case 'pause':
        this.engine.unfreezeOvertime(now);
        break; // stays frozen/paused

      case 'discard':
      default:
        this.engine.unfreezeOvertime(now);
        if (this.engine.status === STATUS.PAUSED) this.engine.resume(now);
        break;
    }

    if (opts.alsoRemember && choice !== 'cut' && choice !== 'break') {
      const map = { discard: IDLE_ACTION.DISCARD, keep: IDLE_ACTION.KEEP };
      if (map[choice]) this.applySettings({ idleAction: map[choice] });
    }
    this.broadcastAll();
  }

  // -------------------------------------------------------------- overlays

  showOverlays(phase, { manual = false } = {}) {
    if (!this.store.settings.breakOverlay && !manual) return;
    this.overlayHidden = false;
    if (!this.overlays.length || this.overlays.some((w) => w.isDestroyed())) {
      this.overlays.forEach((w) => !w.isDestroyed() && w.destroy());
      this.overlays = windows.createOverlayWindows();
    }
    const payload = this.overlayPayload(phase);
    this.overlays.forEach((w) => {
      if (w.isDestroyed()) return;
      w.showInactive();
      w.setAlwaysOnTop(true, 'screen-saver');
      // A freshly created window may still be loading; wait for it rather than
      // firing the payload into a page that cannot receive it yet.
      const send = () => {
        if (w.isDestroyed()) return;
        w.webContents.send('pomora:overlay', payload);
        w.webContents.send('pomora:state', this.buildState());
      };
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
      else send();
    });
  }

  hideOverlays() {
    this.overlays.forEach((w) => {
      if (!w.isDestroyed() && w.isVisible()) w.hide();
    });
  }

  /**
   * Close the break curtain but stay on the break. The phase keeps running —
   * the tray, the taskbar and the mini timer carry on counting it down — so the
   * user can get at a window behind the curtain without cutting the break short.
   */
  dismissOverlay({ silent = false } = {}) {
    const s = this.engine.snapshot();
    const onBreak = s.phase === PHASE.SHORT_BREAK || s.phase === PHASE.LONG_BREAK;
    this.hideOverlays();
    this.overlayHidden = onBreak;
    if (onBreak && !silent && this.store.settings.notifications) {
      this.notifier.show({
        title: '🫥 Break window closed',
        body: `The ${PHASE_LABEL[s.phase].toLowerCase()} is still running — ${formatClock(
          Math.max(0, s.remainingMs)
        )} left. Reopen it any time from the tray.`,
      });
    }
    this.refreshTrayMenu();
    this.broadcastAll();
  }

  /** Whether a "show the break screen again" control makes sense right now. */
  canReopenOverlay() {
    const s = this.engine.snapshot();
    const onBreak = s.phase === PHASE.SHORT_BREAK || s.phase === PHASE.LONG_BREAK;
    // Once the break has run out there is no break left to show.
    const live = s.status === STATUS.RUNNING || s.status === STATUS.PAUSED;
    return onBreak && live && !this.overlayIsVisible();
  }

  overlayIsVisible() {
    return this.overlays.some((w) => !w.isDestroyed() && w.isVisible());
  }

  overlayPayload(phase) {
    const today = this.store.today();
    return {
      phase,
      phaseLabel: PHASE_LABEL[phase],
      dismissable: this.store.settings.overlayDismissable,
      canHide: this.store.settings.overlayCanHide,
      color: COLORS[phase],
      today: { focusText: formatDuration(today.focusMs), pomodoros: today.pomodoros },
      suggestion: this.breakSuggestion(phase),
    };
  }

  breakSuggestion(phase) {
    const short = [
      'Stand up and roll your shoulders.',
      'Look 20 feet away for 20 seconds.',
      'Refill your water.',
      'Unclench your jaw. Drop your shoulders.',
      'Walk to the window and back.',
      'Three slow breaths, longer out than in.',
    ];
    const long = [
      'Step outside for a few minutes.',
      'Make a proper cup of tea, away from the desk.',
      'Stretch your hips and back — you have been sitting.',
      'Eat something that is not at your desk.',
      'Write down where to pick up when you return.',
    ];
    const list = phase === PHASE.LONG_BREAK ? long : short;
    return list[Math.floor(Math.random() * list.length)];
  }

  // ------------------------------------------------ not started after break

  /** Put the reminder up if a break ended a while ago and focus never began. */
  checkNudge(now = Date.now()) {
    const s = this.engine.snapshot(now);
    const awaitingWork = s.status === STATUS.AWAITING && s.nextPhase === PHASE.WORK;
    const away = !!(this.watcher.away && this.store.settings.idleDetection);
    if (this.nudge.check(now, { awaitingWork, away })) this.showNudge();
  }

  showNudge({ preview = false } = {}) {
    if (!this.nudgeWins.length || this.nudgeWins.some((w) => w.isDestroyed())) {
      this.nudgeWins.forEach((w) => !w.isDestroyed() && w.destroy());
      this.nudgeWins = windows.createNudgeWindows();
    }
    const payload = this.nudgePayload();
    this.nudgeWins.forEach((w, i) => {
      if (w.isDestroyed()) return;
      // The primary screen takes focus so Esc and the buttons work at once.
      if (i === 0) {
        w.show();
        w.focus();
      } else {
        w.showInactive();
      }
      w.setAlwaysOnTop(true, 'screen-saver');
      const send = () => !w.isDestroyed() && w.webContents.send('pomora:nudge', payload);
      if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
      else send();
    });
    this.play('back-to-work');
    if (!preview) {
      this.notifier.show({
        title: "⏳ You haven't started work yet",
        body: `Your break ended ${formatDuration(this.nudge.sinceBreakMs())} ago.`,
        actions: [{ id: 'start-work', label: 'Start focus' }],
      });
    }
    this.broadcastAll();
  }

  hideNudge() {
    this.nudgeWins.forEach((w) => {
      if (!w.isDestroyed() && w.isVisible()) w.hide();
    });
  }

  nudgeIsVisible() {
    return this.nudgeWins.some((w) => !w.isDestroyed() && w.isVisible());
  }

  /** Focus started, the timer stopped: the reminder has nothing left to say. */
  clearNudge() {
    this.nudge.disarm();
    this.hideNudge();
  }

  snoozeNudge(ms) {
    this.nudge.snooze(Date.now(), ms);
    this.hideNudge();
    this.broadcastAll();
  }

  nudgePayload() {
    const today = this.store.today();
    const endedAt = this.nudge.breakEndedAt || Date.now();
    const s = this.engine.snapshot();
    return {
      breakEndedAt: endedAt,
      endedAtText: new Date(endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      breakLabel: s.phase === PHASE.LONG_BREAK ? 'long break' : 'break',
      focusMinutes: Math.round(this.engine.durationFor(PHASE.WORK) / MINUTE),
      taskTitle: this.currentTaskTitle(),
      snoozeMinutes: Math.round(this.nudge.delayMs / MINUTE),
      count: this.nudge.shownCount,
      today: { focusText: formatDuration(today.focusMs), pomodoros: today.pomodoros },
    };
  }

  // ------------------------------------------------------------------ audio

  play(sound) {
    if (!this.store.settings.soundEnabled) return;
    this.emitAll('sound', { sound, volume: this.store.settings.volume });
  }

  // -------------------------------------------------------------- broadcast

  buildState() {
    const s = this.engine.snapshot();
    const today = this.store.today();
    return {
      ...s,
      phaseLabel: PHASE_LABEL[s.phase],
      color: TaskbarIndicator.colorFor(s),
      clock:
        s.status === STATUS.AWAITING
          ? formatClock(s.overtimeMs)
          : formatClock(Math.max(0, s.remainingMs)),
      // Only a finished focus session counts up; a finished break just waits.
      overtime: s.status === STATUS.AWAITING && s.phase === PHASE.WORK,
      today: {
        ...today,
        focusText: formatDuration(today.focusMs),
        idleRemovedText: formatDuration(today.idleRemovedMs),
      },
      goal: this.store.settings.dailyGoal,
      streak: this.store.streak(),
      awayFrozen: !!(this.awayState && this.awayState.frozen),
      taskTitle: this.currentTaskTitle(),
      overlayVisible: this.overlayIsVisible(),
      canReopenOverlay: this.canReopenOverlay(),
      breakOverlayEnabled: this.store.settings.breakOverlay,
      nudgeVisible: this.nudgeIsVisible(),
      notStartedSinceMs:
        s.status === STATUS.AWAITING && s.nextPhase === PHASE.WORK ? this.nudge.sinceBreakMs() : 0,
    };
  }

  emitAll(event, payload) {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send(`pomora:${event}`, payload);
    });
  }

  broadcastTick() {
    this.emitAll('state', this.buildState());
  }

  broadcastAll() {
    this.emitAll('state', this.buildState());
    this.emitAll('tasks', this.store.data.tasks);
    this.emitAll('settings', this.store.settings);
    this.emitAll('stats', this.statsPayload());
    this.refreshTrayMenu();
  }

  statsPayload() {
    return {
      today: this.store.today(),
      days: this.store.recentDays(14),
      streak: this.store.streak(),
      sessions: this.store.sessionsForDay().slice(-60).reverse(),
      goal: this.store.settings.dailyGoal,
      workMinutes: Math.round(this.store.settings.workMs / MINUTE),
      tasks: this.store.data.tasks.filter((t) => !t.completed).map((t) => ({ id: t.id, title: t.title })),
    };
  }

  currentTaskTitle() {
    const id = this.engine.taskId;
    if (!id) return null;
    const task = this.store.data.tasks.find((t) => t.id === id);
    return task ? task.title : null;
  }

  // --------------------------------------------------------- taskbar & tray

  updateIndicators() {
    const state = this.engine.snapshot();
    if (this.taskbar) this.taskbar.update(state).catch(() => {});
    this.updateTray(state);
  }

  async updateTray(state) {
    if (!this.tray || this.tray.isDestroyed()) return;
    const today = this.store.today();
    const settings = this.store.settings;

    let label = '';
    let progress = 0;
    if (settings.trayCountdown && state.phase !== PHASE.IDLE) {
      if (state.status === STATUS.AWAITING) label = '✓';
      else label = String(Math.max(0, Math.ceil(state.remainingMs / MINUTE)));
      progress = state.progress;
    } else {
      label = String(today.pomodoros);
    }
    const color = TaskbarIndicator.colorFor(state);
    const key = `${label}|${color}|${Math.round(progress * 20)}|${state.status}`;
    const tip = [
      state.phase === PHASE.IDLE
        ? 'Ferna Pomoro — ready'
        : `${PHASE_LABEL[state.phase]} · ${formatClock(Math.max(0, state.remainingMs))} left`,
      `Today: ${formatDuration(today.focusMs)} focused · ${today.pomodoros} pomodoros`,
      today.idleRemovedMs > MINUTE ? `Idle removed: ${formatDuration(today.idleRemovedMs)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    this.tray.setToolTip(tip.slice(0, 127));

    if (key === this.lastTrayKey) return;
    this.lastTrayKey = key;
    const img = await this.images.trayIcon({
      label,
      color,
      progress,
      dimmed: state.status === STATUS.PAUSED,
    });
    if (!this.tray.isDestroyed() && !img.isEmpty()) this.tray.setImage(img);
  }

  flashWindow() {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.win.isFocused()) this.win.flashFrame(true);
    setTimeout(() => {
      if (this.win && !this.win.isDestroyed()) this.win.flashFrame(false);
    }, 8000);
  }

  // ---------------------------------------------------------------- actions

  handleAction(id) {
    switch (id) {
      case 'toggle':
        this.engine.toggle();
        break;
      case 'start':
      case 'start-work':
        if (this.engine.status === STATUS.AWAITING) this.engine.acceptNext();
        else if (this.engine.phase === PHASE.IDLE) this.engine.startPhase(PHASE.WORK);
        else this.engine.start();
        break;
      case 'start-break':
        if (this.engine.status === STATUS.AWAITING) this.engine.acceptNext();
        else this.startPhaseManually(PHASE.SHORT_BREAK);
        break;
      case 'pause':
        this.engine.pause();
        break;
      case 'skip':
        this.engine.skip();
        break;
      case 'stop':
        this.engine.stop();
        break;
      case 'reset':
        this.engine.reset();
        break;
      case 'extend-5':
        this.snoozeAlert(5 * MINUTE);
        break;
      case 'extend-break-5':
        // From the break-over toast the break has already ended, so there is
        // nothing to extend: give them a fresh five-minute break instead.
        if (this.engine.status === STATUS.AWAITING && this.engine.nextPhase === PHASE.WORK) {
          const phase =
            this.engine.phase === PHASE.LONG_BREAK ? PHASE.LONG_BREAK : PHASE.SHORT_BREAK;
          this.engine.startPhase(phase, Date.now(), { targetMs: 5 * MINUTE });
        } else {
          this.engine.extend(5 * MINUTE);
        }
        break;
      case 'idle-discard':
        this.resolveIdle('discard');
        break;
      case 'idle-keep':
        this.resolveIdle('keep');
        break;
      case 'mini':
        this.toggleMini();
        break;
      case 'open':
      default:
        this.showMain();
        break;
    }
    this.broadcastAll();
  }

  startPhaseManually(phase) {
    this.overlayHidden = false;
    this.engine.startPhase(phase);
  }

  /** Keep working past the bell; re-raise the break alert after `ms`. */
  snoozeAlert(ms) {
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    this.snoozeTimer = setTimeout(() => {
      const s = this.engine.snapshot();
      if (s.status !== STATUS.AWAITING) return;
      const minutes = Math.round(this.engine.durationFor(s.nextPhase) / MINUTE);
      const pomodoros = this.store.today().pomodoros;
      if (s.nextPhase === PHASE.LONG_BREAK) this.notifier.longBreakAlert({ minutes, pomodoros });
      else this.notifier.shortBreakAlert({ minutes, pomodoros });
      this.play('short-break');
    }, ms);
    if (this.snoozeTimer.unref) this.snoozeTimer.unref();
  }

  checkDailyGoal() {
    const today = this.store.today();
    const goal = this.store.settings.dailyGoal;
    const key = dayKey();
    if (goal > 0 && today.pomodoros >= goal && this.goalAnnouncedOn !== key) {
      this.goalAnnouncedOn = key;
      this.notifier.goalReached({ goal, focusText: formatDuration(today.focusMs) });
    }
  }

  // ------------------------------------------------------------------ IPC

  bindIpc() {
    ipcMain.handle('pomora:cmd', (_event, { type, payload } = {}) => this.command(type, payload));
  }

  command(type, payload = {}) {
    const store = this.store;
    switch (type) {
      // timer -------------------------------------------------------------
      case 'timer:toggle':
      case 'timer:start':
      case 'timer:pause':
      case 'timer:skip':
      case 'timer:stop':
      case 'timer:reset':
        this.handleAction(type.split(':')[1]);
        return this.buildState();
      case 'timer:phase':
        this.startPhaseManually(payload.phase);
        return this.buildState();
      case 'timer:accept':
        this.engine.acceptNext();
        return this.buildState();
      case 'timer:extend':
        this.engine.extend(Number(payload.ms) || 5 * MINUTE);
        return this.buildState();
      case 'timer:snooze':
        this.snoozeAlert(Number(payload.ms) || 5 * MINUTE);
        return this.buildState();

      // tasks -------------------------------------------------------------
      case 'task:add': {
        const task = store.addTask(payload);
        if (!this.engine.taskId) this.engine.setTask(task.id);
        this.broadcastAll();
        return task;
      }
      case 'task:update':
        store.updateTask(payload.id, payload.patch || {});
        this.broadcastAll();
        return store.data.tasks;
      case 'task:delete':
        store.deleteTask(payload.id);
        if (this.engine.taskId === payload.id) this.engine.setTask(null);
        this.broadcastAll();
        return store.data.tasks;
      case 'task:list':
        return store.data.tasks;
      case 'task:select':
        this.engine.setTask(payload.id || null);
        this.broadcastAll();
        return store.data.tasks;
      case 'task:clear-completed':
        store.clearCompletedTasks();
        this.broadcastAll();
        return store.data.tasks;
      case 'task:reorder':
        store.reorderTasks(payload.ids || []);
        this.broadcastAll();
        return store.data.tasks;

      // settings ----------------------------------------------------------
      case 'settings:get':
        return store.settings;
      case 'settings:update':
        return this.applySettings(payload);
      case 'settings:reset': {
        const s = store.resetSettings();
        this.applySettings(s);
        return s;
      }

      // data --------------------------------------------------------------
      case 'stats:get':
        return this.statsPayload();
      case 'state:get':
        return this.buildState();
      case 'data:export-csv':
        return this.exportCsv();
      case 'data:open-folder':
        shell.openPath(app.getPath('userData'));
        return true;

      // idle --------------------------------------------------------------
      case 'idle:resolve':
        this.resolveIdle(payload.choice, payload);
        return true;
      case 'idle:snapshot':
        return this.pendingIdle;

      // windows -----------------------------------------------------------
      case 'window:minimize':
        this.win && this.win.minimize();
        return true;
      case 'window:hide':
        this.win && this.win.hide();
        return true;
      case 'window:mini':
        this.toggleMini(payload.show);
        return true;
      case 'window:close-mini':
        if (this.mini && !this.mini.isDestroyed()) this.mini.hide();
        this.refreshTrayMenu();
        return true;
      case 'window:show':
        this.showMain(payload.tab);
        return true;
      case 'window:quit':
        this.quit();
        return true;
      case 'overlay:skip':
        this.overlayHidden = false;
        this.engine.skip();
        return true;
      case 'overlay:hide':
        this.dismissOverlay({ silent: !!payload.silent });
        return true;
      case 'overlay:show':
        this.showOverlays(this.engine.phase, { manual: true });
        this.broadcastAll();
        return true;

      // not started after a break -----------------------------------------
      case 'nudge:start':
        this.handleAction('start-work');
        return true;
      case 'nudge:snooze':
        this.snoozeNudge(Number(payload.ms) || this.nudge.delayMs);
        return true;
      case 'nudge:stop':
        this.engine.stop();
        this.clearNudge();
        this.broadcastAll();
        return true;
      case 'nudge:show':
        // Preview from Settings. Changes no state: the buttons still work.
        this.showNudge({ preview: true });
        return true;

      case 'session:add-manual': {
        const record = store.addManualSession(payload);
        this.checkDailyGoal();
        this.broadcastAll();
        return record;
      }
      case 'session:delete':
        store.deleteSession(payload.id);
        this.broadcastAll();
        return this.statsPayload();
      case 'sound:test':
        this.emitAll('sound', { sound: payload.sound, volume: store.settings.volume });
        return true;
      default:
        return null;
    }
  }

  applySettings(patch) {
    const settings = this.store.updateSettings(patch);
    this.engine.updateSettings(settings);
    if (!settings.notStartedReminder && this.nudgeIsVisible()) {
      this.hideNudge();
      this.nudge.showing = false;
    }
    this.nudge.refresh();
    this.watcher.setThreshold(settings.idleThresholdSec);
    this.watcher.setEnabled(settings.idleDetection);
    if (this.taskbar) this.taskbar.setSettings(settings);
    this.lastTrayKey = null;
    if (this.mini && !this.mini.isDestroyed()) {
      this.mini.setAlwaysOnTop(!!settings.alwaysOnTopMini, 'screen-saver');
    }
    if ('launchOnStartup' in patch && process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: !!settings.launchOnStartup,
        args: ['--minimised'],
      });
    }
    this.registerShortcuts();
    this.broadcastAll();
    return settings;
  }

  exportCsv() {
    const csv = this.store.exportCsv();
    const file = dialog.showSaveDialogSync(this.win, {
      title: 'Export session history',
      defaultPath: path.join(app.getPath('documents'), `pomora-history-${dayKey()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!file) return null;
    try {
      fs.writeFileSync(file, csv, 'utf8');
      return file;
    } catch (err) {
      dialog.showErrorBox('Export failed', err.message);
      return null;
    }
  }

  // -------------------------------------------------------------- windows

  showMain(tab) {
    if (!this.win || this.win.isDestroyed()) {
      this.win = windows.createMainWindow({ bounds: this.store.data.meta.bounds });
    }
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
    if (tab) this.emitAll('navigate', { tab });
  }

  toggleMini(show) {
    const wantVisible = show === undefined ? !(this.mini && this.mini.isVisible()) : !!show;
    if (wantVisible) {
      if (!this.mini || this.mini.isDestroyed()) {
        this.mini = windows.createMiniWindow({
          alwaysOnTop: this.store.settings.alwaysOnTopMini,
          bounds: this.store.data.meta.miniBounds,
        });
        this.mini.on('moved', () => {
          if (this.mini && !this.mini.isDestroyed()) {
            const [x, y] = this.mini.getPosition();
            this.store.data.meta.miniBounds = { x, y };
            this.store.save();
          }
        });
      }
      this.mini.show();
      this.mini.webContents.send('pomora:state', this.buildState());
    } else if (this.mini && !this.mini.isDestroyed()) {
      this.mini.hide();
    }
    this.refreshTrayMenu();
  }

  registerShortcuts() {
    globalShortcut.unregisterAll();
    const s = this.store.settings;
    const safe = (accel, fn) => {
      if (!accel) return;
      try {
        globalShortcut.register(accel, fn);
      } catch {
        /* a clash with another app is not fatal */
      }
    };
    safe(s.shortcutToggle, () => this.handleAction('toggle'));
    safe(s.shortcutSkip, () => this.handleAction('skip'));
    safe(s.shortcutMini, () => this.toggleMini());
  }

  /** Toast buttons come back as pomora://action/<id> through a second launch. */
  handleProtocolArgv(argv) {
    const url = (argv || []).find((a) => typeof a === 'string' && a.startsWith('pomora://'));
    if (!url) return false;
    const id = url.replace('pomora://action/', '').replace(/\/$/, '');
    this.handleAction(id || 'open');
    return true;
  }

  quit() {
    this.quitting = true;
    this.store.data.meta.lastOpenedAt = Date.now();
    if (this.win && !this.win.isDestroyed()) {
      this.store.data.meta.bounds = this.win.getNormalBounds();
    }
    this.store.setCycleCount(this.engine.completedWorkInCycle);
    this.store.save({ immediate: true });
    app.quit();
  }

  dispose() {
    if (this.ticker) clearInterval(this.ticker);
    this.watcher.stop();
    globalShortcut.unregisterAll();
    if (this.taskbar) this.taskbar.clear();
    this.images.destroy();
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
  }
}

// ---------------------------------------------------------------- bootstrap

const single = app.requestSingleInstanceLock();
let pomora = null;

if (!single) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('pomora', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('pomora');
  }

  app.on('second-instance', (_event, argv) => {
    if (!pomora) return;
    if (!pomora.handleProtocolArgv(argv)) pomora.showMain();
  });

  app.whenReady().then(() => {
    pomora = new PomoraApp();
    if (process.argv.includes('--minimised')) pomora.store.data.meta.startMinimised = true;
    pomora.start();
    pomora.handleProtocolArgv(process.argv);

    // Development aid: `npx electron . --selftest` drives the whole app and
    // exits with a pass/fail summary. Never reached in a packaged build.
    if (process.argv.includes('--demo')) {
      setTimeout(() => {
        require('../../tools/demo')
          .run(pomora)
          .catch((err) => {
            console.error('demo crashed:', err);
            app.exit(1);
          });
      }, 1500);
    }

    if (process.argv.includes('--screenshots')) {
      setTimeout(() => {
        require('../../tools/screenshots')
          .run(pomora)
          .catch((err) => {
            console.error('screenshots crashed:', err);
            app.exit(1);
          });
      }, 1200);
    }

    if (process.argv.includes('--selftest')) {
      setTimeout(() => {
        require('../../tools/selftest')
          .run(pomora)
          .catch((err) => {
            console.error('selftest crashed:', err);
            app.exit(1);
          });
      }, 1200);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) pomora.showMain();
    });
  });

  app.on('window-all-closed', () => {
    // The tray keeps the app alive on Windows; quitting is explicit.
    if (process.platform !== 'win32') app.quit();
  });

  app.on('before-quit', () => {
    if (pomora) {
      pomora.quitting = true;
      pomora.dispose();
    }
  });
}

module.exports = { PomoraApp };
