'use strict';

/**
 * Integration smoke test. Runs inside a real Electron process against the real
 * app object, so it covers the parts unit tests cannot: window creation, the
 * canvas-drawn taskbar/tray images, the idle freeze path end to end, and the
 * IPC command surface.
 *
 *   xvfb-run -a npx electron . --selftest
 *
 * Exits 0 when every check passes, 1 otherwise.
 */
const { app } = require('electron');
const { PHASE, STATUS, MINUTE } = require('../src/shared/constants');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(pomora) {
  const { engine, store } = pomora;

  // --- windows ------------------------------------------------------------
  check('main window created', !!pomora.win && !pomora.win.isDestroyed());
  check('tray created', !!pomora.tray && !pomora.tray.isDestroyed());

  // --- images (canvas drawing in the hidden helper window) ----------------
  const badge = await pomora.images.overlayBadge('3', '#e0483f', { ring: 0.4 });
  check('taskbar badge renders', !badge.isEmpty(), `${badge.getSize().width}px`);
  const tray = await pomora.images.trayIcon({ label: '24', color: '#e0483f', progress: 0.3 });
  check('tray icon renders', !tray.isEmpty(), `${tray.getSize().width}px`);
  const glyph = await pomora.images.glyph('pause');
  check('thumbar glyph renders', !glyph.isEmpty());
  const cat = await pomora.images.catIcon({ label: '24', color: '#e0483f', progress: 0.4 });
  check('cat-face icon renders', !cat.isEmpty(), `${cat.getSize().width}px`);

  // --- timer --------------------------------------------------------------
  pomora.command('timer:start');
  check('work phase starts', engine.phase === PHASE.WORK && engine.status === STATUS.RUNNING);

  const st = pomora.buildState();
  check('state carries a clock and colour', /^\d{2}:\d{2}$/.test(st.clock) && !!st.color, st.clock);

  pomora.command('timer:toggle');
  check('pause works', engine.status === STATUS.PAUSED);
  pomora.command('timer:toggle');
  check('resume works', engine.status === STATUS.RUNNING);

  // --- taskbar indicator --------------------------------------------------
  await pomora.taskbar.update(engine.snapshot());
  check('taskbar updated without throwing', true, pomora.win.getTitle());
  check('window title counts down', /\d\d:\d\d/.test(pomora.win.getTitle()), pomora.win.getTitle());
  pomora.applySettings({ taskbarLiveIcon: true, iconShape: 'cat' });
  await pomora.taskbar.update(engine.snapshot());
  check(
    'the taskbar button icon shows the minutes left',
    /^cat\|\d+\|/.test(pomora.taskbar._lastIconKey),
    pomora.taskbar._lastIconKey
  );
  await pomora.updateTray(engine.snapshot());
  check('the tray icon is a cat face too', /^cat\|/.test(pomora.lastTrayKey), pomora.lastTrayKey);
  pomora.applySettings({ iconShape: 'round' });
  await pomora.taskbar.update(engine.snapshot());
  check('the circle shape can be chosen instead', /^round\|/.test(pomora.taskbar._lastIconKey));
  pomora.applySettings({ iconShape: 'cat' });

  // --- the idle story -----------------------------------------------------
  // Pretend the user worked 8 minutes, then walked away 20 minutes ago.
  const now = Date.now();
  engine.accumulatedMs = 8 * MINUTE;
  engine.startedAt = now;
  const awayStart = now;

  pomora.store.updateSettings({ idleAction: 'ask', idleDetection: true });
  pomora.beginAway(awayStart);
  check('clock freezes when the user leaves', engine.status === STATUS.PAUSED);
  const frozenElapsed = engine.elapsedMs();
  await wait(60);
  check(
    'no time accrues while away',
    Math.abs(engine.elapsedMs() - frozenElapsed) < 5,
    `${Math.round(frozenElapsed / 1000)}s held`
  );

  pomora.endAway(awayStart, Date.now() + 20 * MINUTE, { source: 'input' });
  check('return raises the idle question', !!pomora.pendingIdle, `${pomora.pendingIdle ? Math.round(pomora.pendingIdle.idleMs / MINUTE) : 0} min away`);

  pomora.resolveIdle('discard');
  check('discarding idle resumes the pomodoro', engine.status === STATUS.RUNNING);
  check(
    'discarded idle did not advance the clock',
    Math.abs(engine.elapsedMs() - frozenElapsed) < 2000,
    `${Math.round(engine.elapsedMs() / 1000)}s elapsed`
  );

  // Keeping the idle time instead.
  pomora.beginAway(Date.now());
  pomora.endAway(Date.now(), Date.now() + 10 * MINUTE, { source: 'input' });
  const before = engine.elapsedMs();
  pomora.resolveIdle('keep');
  check(
    'keeping idle adds it back as work',
    engine.elapsedMs() - before >= 9.5 * MINUTE,
    `+${Math.round((engine.elapsedMs() - before) / MINUTE)} min`
  );

  // --- breaks and the back-to-work path -----------------------------------
  pomora.command('timer:stop');
  engine.startPhase(PHASE.SHORT_BREAK);
  await wait(50);
  check('break curtain shows', pomora.overlays.some((w) => !w.isDestroyed() && w.isVisible()));

  engine.updateSettings({ autoStartWork: false });
  engine.targetMs = 200;
  await wait(320);
  engine.tick();
  check('break ends into a waiting state', engine.status === STATUS.AWAITING && engine.nextPhase === PHASE.WORK);

  pomora.watcher.away = true;
  pomora.awayState = { awayStart: Date.now() - MINUTE, frozen: false, phase: PHASE.SHORT_BREAK };
  pomora.endAway(Date.now() - MINUTE, Date.now(), { source: 'input' });
  check('coming back after a break still waits for the user', engine.status === STATUS.AWAITING);
  pomora.watcher.away = false;

  pomora.command('timer:accept');
  check('accepting starts the next work session', engine.phase === PHASE.WORK);

  // --- "you haven't started work yet" after a break -------------------------
  const endBreak = async () => {
    pomora.command('timer:stop');
    engine.startPhase(PHASE.SHORT_BREAK);
    engine.targetMs = 150;
    await wait(250);
    pomora.onTick();
  };
  const nudgeDueNow = async () => {
    pomora.nudge.dueAt = Date.now() - 1;
    pomora.onTick();
    await wait(400);
  };
  pomora.applySettings({ autoStartWork: false, notStartedReminder: true, notStartedAfterMs: 2 * MINUTE });
  await endBreak();
  check(
    'a finished break arms the not-started reminder',
    pomora.nudge.armed && engine.status === STATUS.AWAITING
  );
  check('the reminder waits for its delay', !pomora.nudgeIsVisible());
  await nudgeDueNow();
  check('the not-started window appears after the delay', pomora.nudgeIsVisible(), `${pomora.nudgeWins.length} display(s)`);
  check('the main window reports the wait', pomora.buildState().notStartedSinceMs > 0);

  pomora.command('nudge:snooze');
  await wait(150);
  check('"remind me" takes the window down', !pomora.nudgeIsVisible() && pomora.nudge.armed);
  check(
    'and schedules it for the chosen delay',
    pomora.nudge.dueAt > Date.now() + 1.9 * MINUTE,
    `${Math.round((pomora.nudge.dueAt - Date.now()) / 1000)}s`
  );
  await nudgeDueNow();
  check('the window comes back after the snooze', pomora.nudgeIsVisible() && pomora.nudge.shownCount === 2);

  pomora.command('nudge:start');
  await wait(200);
  check(
    'starting focus from it closes it and starts work',
    !pomora.nudgeIsVisible() && engine.phase === PHASE.WORK && engine.status === STATUS.RUNNING && !pomora.nudge.armed
  );

  await endBreak();
  pomora.watcher.away = true;
  await nudgeDueNow();
  check('it never appears while the user is away', !pomora.nudgeIsVisible());
  pomora.awayState = { awayStart: Date.now() - 10 * MINUTE, frozen: false, phase: PHASE.SHORT_BREAK };
  pomora.watcher.away = false;
  pomora.endAway(Date.now() - 10 * MINUTE, Date.now(), { source: 'input' });
  check(
    'on return the delay starts again',
    pomora.nudge.dueAt >= Date.now() + 1.9 * MINUTE && !pomora.nudgeIsVisible()
  );

  pomora.applySettings({ notStartedReminder: false });
  await nudgeDueNow();
  check('turning the setting off keeps it away', !pomora.nudgeIsVisible());
  pomora.command('nudge:stop');
  check('stopping the timer clears the reminder', !pomora.nudge.armed && engine.status === STATUS.STOPPED);

  pomora.command('nudge:show');
  await wait(300);
  check('the Settings preview opens the window', pomora.nudgeIsVisible());
  pomora.command('nudge:snooze');
  await wait(150);
  check('and closes it without touching the timer', !pomora.nudgeIsVisible() && engine.status === STATUS.STOPPED);
  pomora.applySettings({ notStartedReminder: true, notStartedAfterMs: 5 * MINUTE });

  const extendBefore = engine.status;
  await endBreak();
  pomora.handleAction('extend-break-5');
  check(
    '"+5 min break" on the break-over toast starts a 5-minute break',
    engine.phase === PHASE.SHORT_BREAK && engine.status === STATUS.RUNNING && engine.targetMs === 5 * MINUTE,
    `was ${extendBefore}`
  );
  engine.stop();
  pomora.hideOverlays();

  // --- "session complete" window ---------------------------------------------
  // Every fourth pomodoro earns a long break, so accept either kind.
  const isBreak = (p) => p === PHASE.SHORT_BREAK || p === PHASE.LONG_BREAK;
  const completeWork = async () => {
    engine.stop();
    engine.startPhase(PHASE.WORK);
    engine.targetMs = 150;
    await wait(250);
    pomora.onTick();
    await wait(400);
  };
  pomora.applySettings({ sessionEndWindow: true, autoStartBreaks: false, autoStartWork: false });
  await completeWork();
  check(
    'a finished focus session shows the complete window',
    pomora.completeIsVisible() && engine.status === STATUS.AWAITING && pomora.completeInfo.variant === 'waiting'
  );
  const cp = pomora.completePayload(pomora.completeInfo);
  check('it offers the break and another focus session', /break/i.test(cp.primary) && /focus/i.test(cp.alt), `${cp.primary} | ${cp.alt}`);
  pomora.command('complete:alt');
  await wait(150);
  check(
    '"another focus session" starts focus instead of the break',
    !pomora.completeIsVisible() && engine.phase === PHASE.WORK && engine.status === STATUS.RUNNING
  );

  await completeWork();
  pomora.command('complete:close');
  await wait(150);
  check(
    'closing it leaves the timer waiting',
    !pomora.completeIsVisible() && engine.status === STATUS.AWAITING && isBreak(engine.nextPhase)
  );
  pomora.command('timer:accept'); // the break
  engine.targetMs = 150;
  await wait(250);
  pomora.onTick();
  await wait(400);
  check('a finished break shows the complete window', pomora.completeIsVisible() && isBreak(pomora.completeInfo.phase));
  pomora.command('complete:primary');
  await wait(150);
  check('"Start focus" from it starts focus', engine.phase === PHASE.WORK && !pomora.completeIsVisible());

  pomora.applySettings({ autoStartBreaks: true, breakOverlay: true });
  await completeWork();
  check(
    'when the break starts by itself, the break window says the session is complete',
    isBreak(engine.phase) &&
      !pomora.completeIsVisible() &&
      /complete/.test(pomora.overlayPayload(engine.phase).completedText),
    `${pomora.overlayPayload(engine.phase).completedText} | visible=${pomora.completeIsVisible()} phase=${engine.phase}`
  );
  pomora.applySettings({ breakOverlay: false });
  await completeWork();
  check(
    'without the break window, the complete window says the break has started',
    pomora.completeIsVisible() && pomora.completeInfo.variant === 'started' && isBreak(engine.phase),
    `visible=${pomora.completeIsVisible()} info=${JSON.stringify(pomora.completeInfo && pomora.completeInfo.variant)} phase=${engine.phase}`
  );
  pomora.command('complete:alt'); // skip the break
  await wait(150);
  check('"Skip the break" from it starts focus', engine.phase === PHASE.WORK && !pomora.completeIsVisible());

  pomora.applySettings({ sessionEndWindow: false, autoStartBreaks: false, breakOverlay: true });
  await completeWork();
  check('turning it off keeps it away', !pomora.completeIsVisible() && engine.status === STATUS.AWAITING);
  pomora.applySettings({ sessionEndWindow: true, autoStartBreaks: true });
  engine.stop();
  pomora.hideOverlays();

  // --- "time to start work" after switching on -------------------------------
  pomora.applySettings({ startupReminder: true, startupReminderAfterMs: 5 * MINUTE });
  engine.stop();
  pomora.armStartup(Date.now(), 'launch');
  check('switching on arms the start-work reminder', pomora.startNudge.armed);
  pomora.onTick();
  await wait(100);
  check('it waits for its delay', !pomora.nudgeIsVisible());
  pomora.startNudge.dueAt = Date.now() - 1;
  pomora.onTick();
  await wait(400);
  check(
    'the start-work window appears when nothing has started',
    pomora.nudgeIsVisible() && pomora.nudgeMode === 'startup',
    pomora.nudgePayload('startup').headline
  );
  pomora.command('nudge:stop'); // "Not today"
  await wait(150);
  check(
    '"Not today" closes it and leaves the timer alone',
    !pomora.nudgeIsVisible() && !pomora.startNudge.armed && engine.status === STATUS.STOPPED
  );
  pomora.lastTickAt = Date.now() - 3 * 60 * MINUTE; // the machine slept
  pomora.onTick();
  check('waking the computer arms it again', pomora.startNudge.armed && pomora.startNudgeSource === 'wake');
  pomora.startNudge.dueAt = Date.now() - 1;
  pomora.onTick();
  await wait(300);
  pomora.command('nudge:start');
  await wait(150);
  check(
    '"Start focus now" from it starts work',
    !pomora.nudgeIsVisible() && engine.phase === PHASE.WORK && !pomora.startNudge.armed
  );
  engine.stop();
  pomora.armStartup(Date.now(), 'launch');
  engine.startPhase(PHASE.SHORT_BREAK);
  check('starting anything cancels it', !pomora.startNudge.armed);
  engine.stop();
  pomora.hideOverlays();
  pomora.applySettings({ startupReminder: false });
  pomora.armStartup(Date.now(), 'launch');
  pomora.startNudge.dueAt = Date.now() - 1;
  pomora.onTick();
  await wait(200);
  check('turning it off keeps it away', !pomora.nudgeIsVisible());
  pomora.startNudge.disarm();
  pomora.applySettings({ startupReminder: true });

  // --- the break window can be closed without ending the break ------------
  pomora.command('timer:stop');
  pomora.store.updateSettings({ breakOverlay: true, overlayCanHide: true });
  engine.startPhase(PHASE.SHORT_BREAK);
  await wait(400);
  check('break window opens with the break', pomora.overlayIsVisible());

  pomora.command('overlay:hide', { silent: true });
  await wait(120);
  check('closing the break window hides it', !pomora.overlayIsVisible());
  check(
    'the break keeps running after the window is closed',
    engine.phase === PHASE.SHORT_BREAK && engine.status === STATUS.RUNNING,
    `${Math.round(engine.remainingMs() / 1000)}s left`
  );
  check('the app offers the break window back', pomora.buildState().canReopenOverlay);

  pomora.command('overlay:show');
  await wait(250);
  check('the break window can be reopened', pomora.overlayIsVisible());
  pomora.command('overlay:hide', { silent: true });

  pomora.store.updateSettings({ breakOverlay: false });
  engine.startPhase(PHASE.LONG_BREAK);
  await wait(300);
  check('turning the break window off keeps it off', !pomora.overlayIsVisible());
  pomora.store.updateSettings({ breakOverlay: true });
  engine.stop();

  // --- manual focus time --------------------------------------------------
  const beforeFocus = store.today().focusMs;
  const manual = pomora.command('session:add-manual', {
    startedAt: Date.now() - 45 * MINUTE,
    workedMs: 45 * MINUTE,
    pomodoros: 2,
    note: 'forgot to start the timer',
  });
  check('manual focus time is recorded', !!manual && manual.type === 'manual');
  check(
    'manual time lands in today\'s total',
    store.today().focusMs - beforeFocus === 45 * MINUTE,
    `+${Math.round((store.today().focusMs - beforeFocus) / MINUTE)} min`
  );
  check('manual pomodoros are credited', store.today().pomodoros >= 2);
  check('manual entry shows in the session log', pomora.statsPayload().sessions.some((x) => x.id === manual.id));

  pomora.command('session:delete', { id: manual.id });
  check('deleting a manual entry unwinds it', store.today().focusMs === beforeFocus);

  // Measure the delta: the data folder may already hold history.
  const dayIndex = (list) => list.length - 4; // three days back, today last
  const beforeDay = pomora.statsPayload().days[dayIndex(pomora.statsPayload().days)].focusMs;
  const backDated = pomora.command('session:add-manual', {
    startedAt: Date.now() - 3 * 24 * 3600 * 1000,
    workedMs: 30 * MINUTE,
    pomodoros: 1,
  });
  const days = pomora.statsPayload().days;
  const target = days[dayIndex(days)];
  check(
    'back-dated time lands on the right day, not today',
    target.focusMs - beforeDay === 30 * MINUTE && store.today().focusMs === beforeFocus,
    `${target.day} +${Math.round((target.focusMs - beforeDay) / MINUTE)} min`
  );
  pomora.command('session:delete', { id: backDated.id });
  check(
    'deleting the back-dated entry restores that day',
    pomora.statsPayload().days[dayIndex(days)].focusMs === beforeDay
  );

  // --- tasks, settings, data ---------------------------------------------
  const task = pomora.command('task:add', { title: 'Grade NLP assignments', estimate: 3 });
  check('task added', !!task && task.id);
  pomora.command('task:select', { id: task.id });
  check('task selected', engine.taskId === task.id);

  pomora.command('settings:update', { workMs: 30 * MINUTE });
  check('settings update reaches the engine', engine.settings.workMs === 30 * MINUTE);
  check('settings persisted', store.settings.workMs === 30 * MINUTE);

  engine.stop();
  const stats = pomora.command('stats:get');
  check('stats payload shape', Array.isArray(stats.days) && stats.days.length === 14);
  check('csv export builds', store.exportCsv().split('\n')[0].startsWith('started_at'));

  // --- the normal icon comes back when nothing runs -------------------------
  engine.stop();
  await pomora.taskbar.update(engine.snapshot());
  check('with nothing running the taskbar shows the app icon again', pomora.taskbar._lastIconKey === 'app');

  // --- mini window --------------------------------------------------------
  pomora.toggleMini(true);
  await wait(120);
  check('mini timer opens', !!pomora.mini && pomora.mini.isVisible());
  pomora.toggleMini(false);
  check('mini timer hides', !pomora.mini.isVisible());

  // --- notifications (must not throw even where they cannot display) ------
  let threw = null;
  try {
    pomora.notifier.workAlert({ index: 1, total: 8, minutes: 25, taskTitle: 'Grade NLP assignments' });
    pomora.notifier.shortBreakAlert({ minutes: 5, pomodoros: 1 });
    pomora.notifier.longBreakAlert({ minutes: 15, pomodoros: 4 });
    pomora.notifier.breakOver({ next: null, minutes: 25 });
    pomora.notifier.resumedWork({ minutes: 25, taskTitle: null });
    pomora.notifier.welcomeBack({ awayText: '12m', phaseLabel: 'Short break' });
    pomora.notifier.idleDetected({ awayText: '12m' });
  } catch (err) {
    threw = err.message;
  }
  check('all alert types build without throwing', threw === null, threw || '');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length ? 1 : 0);
}

module.exports = { run };
