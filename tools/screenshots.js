'use strict';

/**
 * Capture the four windows to PNGs for a visual once-over:
 *   xvfb-run -a npx electron . --screenshots
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { PHASE, MINUTE } = require('../src/shared/constants');

const OUT = path.join(__dirname, '..', 'docs', 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, name) {
  if (!win || win.isDestroyed()) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`saved ${name}.png`);
}

async function run(pomora) {
  fs.mkdirSync(OUT, { recursive: true });
  const { engine, store } = pomora;

  // Some plausible history so the panes are not empty.
  const day = (offset, focusMin, poms) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    store.data.days[key] = {
      focusMs: focusMin * MINUTE,
      breakMs: poms * 5 * MINUTE,
      pomodoros: poms,
      idleRemovedMs: (offset % 3) * 7 * MINUTE,
      interruptions: offset % 2,
      overtimeMs: 0,
    };
  };
  [175, 0, 100, 140, 210, 60, 125, 190, 95, 0, 150, 205, 80, 120].forEach((m, i) =>
    day(13 - i, m, Math.round(m / 25))
  );

  const t1 = store.addTask({ title: 'Draft NLP II lecture on transformers', estimate: 4 });
  store.addTask({ title: 'Review MSc proposal — swarm routing', estimate: 2 });
  const t3 = store.addTask({ title: 'Mark DSA quiz papers', estimate: 6 });
  store.updateTask(t3.id, { done: 6, completed: true, focusMs: 150 * MINUTE });
  store.updateTask(t1.id, { done: 2, focusMs: 52 * MINUTE });
  store.logSession({
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 80 * MINUTE,
    endedAt: Date.now() - 55 * MINUTE,
    plannedMs: 25 * MINUTE,
    workedMs: 25 * MINUTE,
    idleRemovedMs: 6 * MINUTE,
    reason: 'completed',
    completed: true,
    taskId: t1.id,
  });
  store.logSession({
    type: 'phase',
    phase: PHASE.SHORT_BREAK,
    startedAt: Date.now() - 55 * MINUTE,
    endedAt: Date.now() - 50 * MINUTE,
    plannedMs: 5 * MINUTE,
    workedMs: 5 * MINUTE,
    idleRemovedMs: 0,
    reason: 'completed',
    completed: true,
    taskId: null,
  });
  store.logSession({
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 50 * MINUTE,
    endedAt: Date.now() - 36 * MINUTE,
    plannedMs: 25 * MINUTE,
    workedMs: 14 * MINUTE,
    idleRemovedMs: 11 * MINUTE,
    reason: 'idle-cut',
    completed: false,
    taskId: t1.id,
  });

  engine.setTask(t1.id);
  engine.startPhase(PHASE.WORK);
  engine.accumulatedMs = 9 * MINUTE + 12 * 1000;
  engine.startedAt = Date.now();
  engine.idleRemovedMs = 6 * MINUTE;
  engine.completedWorkInCycle = 2;
  pomora.broadcastAll();
  pomora.win.show();
  await wait(700);
  await shoot(pomora.win, '01-timer');

  pomora.emitAll('navigate', { tab: 'tasks' });
  await wait(350);
  await shoot(pomora.win, '02-tasks');

  pomora.emitAll('navigate', { tab: 'stats' });
  await wait(450);
  await shoot(pomora.win, '03-stats');

  pomora.emitAll('navigate', { tab: 'settings' });
  await wait(350);
  await shoot(pomora.win, '04-settings');

  // Mini timer
  pomora.toggleMini(true);
  await wait(500);
  pomora.broadcastAll();
  await wait(250);
  await shoot(pomora.mini, '05-mini');
  pomora.toggleMini(false);

  // Break curtain
  engine.startPhase(PHASE.SHORT_BREAK);
  engine.accumulatedMs = 96 * 1000;
  engine.startedAt = Date.now();
  pomora.showOverlays(PHASE.SHORT_BREAK);
  await wait(700);
  pomora.broadcastAll();
  await wait(300);
  await shoot(pomora.overlays[0], '06-break');
  pomora.hideOverlays();

  // Break curtain closed, timer pane offering it back
  pomora.command('overlay:hide', { silent: true });
  pomora.emitAll('navigate', { tab: 'timer' });
  pomora.broadcastAll();
  await wait(400);
  await shoot(pomora.win, '08-break-hidden');

  // Idle question
  engine.startPhase(PHASE.WORK);
  engine.accumulatedMs = 8 * MINUTE;
  engine.startedAt = null;
  pomora.pendingIdle = {
    awayStart: Date.now() - 23 * MINUTE,
    returnedAt: Date.now(),
    idleMs: 23 * MINUTE,
    phase: PHASE.WORK,
    elapsedMs: 8 * MINUTE,
    remainingMs: 17 * MINUTE,
    overtimeMs: 0,
    source: 'input',
  };
  pomora.showIdlePrompt();
  await wait(900);
  pomora.sendIdlePrompt();
  await wait(350);
  await shoot(pomora.idleWin, '07-idle');
  pomora.resolveIdle('pause');

  // "You haven't started work yet", seven and a half minutes after a break
  pomora.applySettings({ autoStartWork: false });
  engine.stop();
  engine.startPhase(PHASE.SHORT_BREAK);
  engine.targetMs = 100;
  await wait(200);
  engine.tick();
  pomora.nudge.arm(Date.now() - 7.5 * MINUTE);
  pomora.nudge.dueAt = Date.now() - 1;
  pomora.checkNudge();
  await wait(900);
  pomora.showNudge({ preview: true });
  await wait(400);
  await shoot(pomora.nudgeWins[0], '09-not-started');
  pomora.hideNudge();

  // The timer pane while it waits
  pomora.emitAll('navigate', { tab: 'timer' });
  pomora.broadcastAll();
  await wait(400);
  await shoot(pomora.win, '10-not-started-timer');

  // Its settings card
  pomora.emitAll('navigate', { tab: 'settings' });
  pomora.broadcastAll();
  await wait(300);
  await pomora.win.webContents.executeJavaScript(
    "Array.from(document.querySelectorAll('legend')).find((l) => l.textContent === 'After a break').parentElement.scrollIntoView({ block: 'center' })"
  );
  await wait(300);
  await shoot(pomora.win, '11-not-started-settings');

  console.log('screenshots done');
  app.exit(0);
}

module.exports = { run };
