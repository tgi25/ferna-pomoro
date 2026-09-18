'use strict';

/**
 * Scripted product demo, recorded as a screen capture.
 *
 *   xvfb-run -s "-screen 0 1280x800x24" npx electron . --demo
 *
 * It drives the real app — no mock-ups — moving a real mouse pointer with
 * xdotool for the visual beat and triggering each action through the same IPC
 * commands the buttons use, so a stray pixel cannot derail the take.
 *
 * Every beat prints "BEAT <name> <seconds>" so the caption track can be built
 * from what actually happened rather than from guessed timings.
 */
const { execFile } = require('child_process');
const { app } = require('electron');
const { PHASE, MINUTE } = require('../src/shared/constants');

const WIN = { x: 150, y: 50, w: 980, h: 700 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let t0 = 0;
const beat = (name) => console.log(`BEAT ${name} ${((Date.now() - t0) / 1000).toFixed(2)}`);

function sh(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, () => resolve()));
}

/** Glide the pointer to a point inside the main window, in window coordinates. */
async function pointTo(x, y, { steps = 26, ms = 420 } = {}) {
  const target = { x: WIN.x + x, y: WIN.y + y };
  const args = [];
  for (let i = 1; i <= steps; i += 1) {
    // Ease-out so the pointer settles rather than stopping dead.
    const p = 1 - Math.pow(1 - i / steps, 3);
    const px = Math.round(cursor.x + (target.x - cursor.x) * p);
    const py = Math.round(cursor.y + (target.y - cursor.y) * p);
    args.push('mousemove', String(px), String(py), 'sleep', (ms / steps / 1000).toFixed(3));
  }
  cursor = target;
  await sh('xdotool', args);
}

/** Absolute screen coordinates (for the break curtain and the idle window). */
async function pointToScreen(x, y, opts) {
  return pointTo(x - WIN.x, y - WIN.y, opts);
}

let cursor = { x: 640, y: 780 };

/** Type into a renderer input, one character at a time. */
async function typeInto(win, selector, text, perChar = 45) {
  for (let i = 1; i <= text.length; i += 1) {
    const chunk = JSON.stringify(text.slice(0, i));
    await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (el) { el.value = ${chunk}; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`
    );
    await wait(perChar);
  }
}

/**
 * Run the clock faster than real time for the video, by advancing the elapsed
 * total rather than faking the display: everything downstream — the ring, the
 * taskbar, the phase change — reacts exactly as it would in a real session.
 */
async function fastForward(pomora, ms, overSeconds) {
  const steps = Math.round(overSeconds * 20);
  const per = ms / steps;
  for (let i = 0; i < steps; i += 1) {
    const e = pomora.engine;
    if (e.phase === PHASE.IDLE) break;
    e.accumulatedMs += per;
    e.tick(Date.now());
    pomora.broadcastAll();
    await wait(1000 / 20);
  }
}

async function run(pomora) {
  const { engine, store } = pomora;
  t0 = Date.now();

  // ---------------------------------------------------------------- staging
  store.updateSettings({
    notifications: false, // toasts cannot be recorded off-screen anyway
    soundEnabled: false,
    breakOverlay: true,
    overlayCanHide: true,
    overlayDismissable: true,
    autoStartBreaks: true,
    autoStartWork: false,
    dailyGoal: 8,
  });

  // A plausible fortnight of history behind today.
  const dayKey = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  [150, 0, 95, 130, 205, 65, 120, 185, 90, 0, 145, 200, 75].forEach((m, i) => {
    store.data.days[dayKey(13 - i)] = {
      focusMs: m * MINUTE,
      breakMs: Math.round(m / 5) * MINUTE,
      pomodoros: Math.round(m / 25),
      idleRemovedMs: (i % 3) * 6 * MINUTE,
      interruptions: i % 2,
      overtimeMs: 0,
      manualMs: 0,
    };
  });
  store.data.days[dayKey(0)] = {
    focusMs: 75 * MINUTE,
    breakMs: 15 * MINUTE,
    pomodoros: 3,
    idleRemovedMs: 11 * MINUTE,
    interruptions: 1,
    overtimeMs: 0,
    manualMs: 0,
  };

  pomora.win.setBounds(WIN);
  pomora.win.show();
  pomora.broadcastAll();
  await sh('xdotool', ['mousemove', String(cursor.x), String(cursor.y)]);
  await wait(1200);
  beat('open');

  // ------------------------------------------------------------------ tasks
  await pointTo(41, 147);
  pomora.emitAll('navigate', { tab: 'tasks' });
  await wait(600);
  beat('tasks');

  await pointTo(420, 330, { ms: 350 });
  await typeInto(pomora.win, '#task-title', 'Draft the NLP II lecture on transformers');
  await wait(300);
  await pointTo(880, 330, { ms: 300 });
  const task = pomora.command('task:add', {
    title: 'Draft the NLP II lecture on transformers',
    estimate: 4,
  });
  pomora.command('task:select', { id: task.id });
  await wait(900);
  beat('task-added');

  // ------------------------------------------------------------ focus start
  await pointTo(41, 92);
  pomora.emitAll('navigate', { tab: 'timer' });
  await wait(700);
  await pointTo(413, 435, { ms: 500 });
  await wait(250);
  pomora.command('timer:start');
  await wait(900);
  beat('focus-start');

  // Thirteen minutes of work in five seconds.
  await fastForward(pomora, 13 * MINUTE, 5);
  await wait(900);
  beat('working');

  // ------------------------------------------------------------------- idle
  // The user left five minutes ago; the watcher has just noticed. The clock
  // rewinds those five minutes and stops dead — on screen, visibly.
  const awayStart = Date.now() - 5 * MINUTE;
  pomora.beginAway(awayStart);
  pomora.broadcastAll();
  await wait(2600);
  beat('away');

  await pointTo(560, 260, { ms: 600 });
  await wait(1600);

  // Twenty-three minutes later they are back at the keyboard.
  pomora.endAway(awayStart, awayStart + 23 * MINUTE, { source: 'input' });
  await wait(2600);
  beat('idle-prompt');

  // The prompt window is centred on the 1280x800 screen by createIdleWindow.
  await pointToScreen(640, 290, { ms: 800 });
  await wait(2600);
  pomora.resolveIdle('discard');
  await wait(2000);
  beat('idle-resolved');

  // ------------------------------------------------------------------ break
  await fastForward(pomora, 17 * MINUTE, 4); // finish the pomodoro
  await wait(2000);
  beat('break-window');

  await fastForward(pomora, 90 * 1000, 2);
  await wait(1400);

  // Close the curtain — the break carries on behind it.
  await pointToScreen(463, 513, { ms: 800 });
  await wait(1200);
  pomora.command('overlay:hide', { silent: true });
  pomora.emitAll('navigate', { tab: 'timer' });
  pomora.broadcastAll();
  await wait(1000);
  await fastForward(pomora, 40 * 1000, 2);
  await wait(1800);
  beat('break-running');

  // ---------------------------------------------------------------- manual
  engine.stop();
  await pointTo(41, 202);
  pomora.emitAll('navigate', { tab: 'stats' });
  await wait(900);
  beat('stats');

  await pointTo(463, 337, { ms: 450 });
  await wait(400);
  await typeInto(pomora.win, '#m-min', '', 0);
  await typeInto(pomora.win, '#m-min', '55', 160);
  await wait(200);
  await pointTo(447, 400, { ms: 400 });
  await typeInto(pomora.win, '#m-note', 'Marked DSA scripts at the kitchen table', 38);
  await wait(500);
  await pointTo(843, 400, { ms: 450 });
  await wait(400);
  const manual = pomora.command('session:add-manual', {
    startedAt: Date.now() - 3 * 3600 * 1000,
    workedMs: 55 * MINUTE,
    pomodoros: 2,
    taskId: null,
    note: 'Marked DSA scripts at the kitchen table',
  });
  await pomora.win.webContents.executeJavaScript(
    `(() => { const n = document.querySelector('#m-note'); if (n) n.value = '';
      const b = document.querySelector('#m-add'); if (b) b.textContent = 'Added \\u2713'; })()`
  );
  pomora.broadcastAll();
  await wait(2600);
  beat('manual-added');

  // Scroll down to the log so the manual row and its tag are visible.
  await pomora.win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-pane="stats"]');
      if (p) p.scrollTo({ top: 520, behavior: 'smooth' }); })()`
  );
  await pointTo(600, 620, { ms: 800 });
  await wait(3000);
  beat('log');

  // ------------------------------------------------------------ mini timer
  await pomora.win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-pane="stats"]'); if (p) p.scrollTo({ top: 0 }); })()`
  );
  pomora.emitAll('navigate', { tab: 'timer' });
  engine.startPhase(PHASE.WORK);
  engine.accumulatedMs = 6 * MINUTE;
  engine.startedAt = Date.now();
  pomora.broadcastAll();
  await wait(700);
  await pointTo(41, 660, { ms: 600 });
  pomora.toggleMini(true);
  await wait(400);
  pomora.broadcastAll();
  await pointToScreen(1020, 120, { ms: 700 });
  await wait(2400);
  beat('mini');

  pomora.toggleMini(false);
  await wait(400);
  await fastForward(pomora, 90 * 1000, 1.5);
  await wait(1200);
  beat('end');

  console.log('demo done');
  app.exit(0);
}

module.exports = { run };
