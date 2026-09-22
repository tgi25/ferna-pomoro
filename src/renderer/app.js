'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const CIRCUMFERENCE = 2 * Math.PI * 108;
const PHASE_COLOR = { work: '#e0483f', shortBreak: '#1f9d63', longBreak: '#2f7fd0', idle: '#6b7280' };

let settings = null;
let state = null;
let tasks = [];
let lastTickSecond = -1;

// --------------------------------------------------------------- navigation

function showTab(tab) {
  $$('.rail__btn[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.pane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === tab));
}

$$('.rail__btn[data-tab]').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
$$('[data-tab-link]').forEach((el) =>
  el.addEventListener('click', () => showTab(el.dataset.tabLink))
);

// -------------------------------------------------------------------- timer

function renderTimer(s) {
  $('#clock').textContent = s.overtime ? `+${s.clock}` : s.clock;
  $('#phase-label').textContent =
    s.status === 'awaiting' ? `${s.phaseLabel} complete` : s.phaseLabel || 'Ready';

  const arc = $('#dial-arc');
  const progress = s.status === 'awaiting' ? 1 : s.progress;
  arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  arc.style.stroke = s.status === 'paused' ? '#b4801f' : PHASE_COLOR[s.phase] || PHASE_COLOR.idle;

  let note = '';
  if (s.status === 'paused') note = s.awayFrozen ? 'Frozen — you were away' : 'Paused';
  else if (s.status === 'awaiting' && s.notStartedSinceMs >= 60000)
    note = `Break ended ${Math.floor(s.notStartedSinceMs / 60000)} min ago`;
  else if (s.status === 'awaiting') note = `Waiting for you · next: ${labelOf(s.nextPhase)}`;
  else if (s.idleRemovedMs > 60000) note = `${Math.round(s.idleRemovedMs / 60000)} min of idle removed`;
  $('#dial-note').textContent = note;

  // Primary button
  const btn = $('#btn-primary');
  if (s.status === 'running') btn.textContent = 'Pause';
  else if (s.status === 'paused') btn.textContent = 'Resume';
  else if (s.status === 'awaiting') btn.textContent = `Start ${labelOf(s.nextPhase).toLowerCase()}`;
  else btn.textContent = 'Start focus';

  $('#btn-skip').disabled = s.phase === 'idle';
  $('#btn-stop').disabled = s.phase === 'idle';
  $('#btn-reset').disabled = s.phase === 'idle';

  $$('.phase-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.phase === s.phase));

  // Cycle dots
  const dots = $('#cycle-dots');
  const total = s.longBreakInterval || 4;
  const done = s.completedWorkInCycle % total;
  if (dots.children.length !== total) {
    dots.innerHTML = '';
    for (let i = 0; i < total; i += 1) {
      const d = document.createElement('span');
      d.className = 'cycle__dot';
      dots.appendChild(d);
    }
  }
  Array.from(dots.children).forEach((d, i) => {
    const filled = i < done || (done === 0 && s.completedWorkInCycle > 0 && total === 0);
    d.classList.toggle('is-done', filled);
  });

  // Today
  $('#chip-focus').textContent = s.today.focusText;
  $('#chip-pom').textContent = s.today.pomodoros;
  $('#chip-idle').textContent = s.today.idleRemovedText;
  $('#chip-streak').textContent = s.streak;

  const goal = s.goal || 0;
  const pct = goal > 0 ? Math.min(100, (s.today.pomodoros / goal) * 100) : 0;
  $('#goal-fill').style.width = `${pct}%`;
  $('#goal-text').textContent = goal > 0
    ? `${s.today.pomodoros} of ${goal} pomodoros today`
    : `${s.today.pomodoros} pomodoros today`;

  // Task strip
  $('#task-strip-title').textContent = s.taskTitle || 'Nothing selected';

  // Break window was closed by hand — offer it back.
  $('#btn-break-screen').classList.toggle('hidden', !s.canReopenOverlay);

  // Away banner
  const banner = $('#away-banner');
  banner.classList.toggle('hidden', !s.awayFrozen);
  if (s.awayFrozen) {
    $('#away-banner-text').textContent =
      'Your focus clock stopped at your last keystroke — resume when you are back at it.';
  }

  // Ticking
  const sec = Math.floor(s.remainingMs / 1000);
  if (settings && settings.tickingEnabled && s.status === 'running' && s.phase === 'work') {
    if (sec !== lastTickSecond) {
      lastTickSecond = sec;
      playSound('tick', (settings.volume || 0.7) * 0.35);
    }
  }
}

function labelOf(phase) {
  return { work: 'Focus', shortBreak: 'Short break', longBreak: 'Long break' }[phase] || 'Focus';
}

$('#btn-primary').addEventListener('click', () => window.pomora.send('timer:toggle'));
$('#btn-skip').addEventListener('click', () => window.pomora.send('timer:skip'));
$('#btn-stop').addEventListener('click', () => window.pomora.send('timer:stop'));
$('#btn-reset').addEventListener('click', () => window.pomora.send('timer:reset'));
$('#btn-mini').addEventListener('click', () => window.pomora.send('window:mini'));
$('#away-banner-resume').addEventListener('click', () => window.pomora.send('timer:start'));
$('#btn-break-screen').addEventListener('click', () => window.pomora.send('overlay:show'));
$$('.phase-tab').forEach((tab) =>
  tab.addEventListener('click', () => window.pomora.send('timer:phase', { phase: tab.dataset.phase }))
);

// -------------------------------------------------------------------- tasks

function renderTasks(list) {
  tasks = list;
  const ul = $('#task-list');
  ul.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'No tasks yet. Add one above and it will collect your focus time.';
    ul.appendChild(li);
    return;
  }
  list.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'task';
    if (state && state.taskId === task.id) li.classList.add('is-current');
    if (task.completed) li.classList.add('is-done');

    const pick = document.createElement('button');
    pick.className = 'task__pick';
    pick.title = 'Work on this task';
    pick.addEventListener('click', () => window.pomora.send('task:select', { id: task.id }));

    const title = document.createElement('span');
    title.className = 'task__title';
    title.textContent = task.title;
    title.title = task.title;

    const count = document.createElement('span');
    count.className = 'task__count';
    count.textContent = `${task.done}/${task.estimate || '–'}`;
    count.title = 'Completed / estimated pomodoros';

    const time = document.createElement('span');
    time.className = 'task__time';
    time.textContent = `${Math.round((task.focusMs || 0) / 60000)}m`;

    const doneBtn = document.createElement('button');
    doneBtn.className = 'task__btn';
    doneBtn.textContent = task.completed ? '↺' : '✓';
    doneBtn.title = task.completed ? 'Reopen' : 'Mark complete';
    doneBtn.addEventListener('click', () =>
      window.pomora.send('task:update', { id: task.id, patch: { completed: !task.completed } })
    );

    const del = document.createElement('button');
    del.className = 'task__btn';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', () => window.pomora.send('task:delete', { id: task.id }));

    li.append(pick, title, count, time, doneBtn, del);
    ul.appendChild(li);
  });
}

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) return;
  window.pomora.send('task:add', { title, estimate: Number($('#task-estimate').value) || 0 });
  $('#task-title').value = '';
  $('#task-estimate').value = '1';
});

$('#btn-clear-done').addEventListener('click', () => window.pomora.send('task:clear-completed'));

// -------------------------------------------------------------------- stats

let manualPomTouched = false;
let manualDefaults = { workMinutes: 25 };

function renderManualForm(stats) {
  manualDefaults.workMinutes = stats.workMinutes || 25;

  const taskSelect = $('#m-task');
  const chosen = taskSelect.value;
  taskSelect.innerHTML = '<option value="">No task</option>';
  (stats.tasks || []).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.title;
    taskSelect.appendChild(opt);
  });
  if (chosen) taskSelect.value = chosen;

  // Default to "an hour ago, today" — the common case is remembering a session
  // that just went untracked.
  if (!$('#m-date').value) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('#m-date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const start = new Date(now.getTime() - (stats.workMinutes || 25) * 60000);
    $('#m-time').value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    $('#m-min').value = String(stats.workMinutes || 25);
    $('#m-pom').value = '1';
  }
}

function renderStats(stats) {
  renderManualForm(stats);
  const fmt = (ms) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  $('#stat-focus').textContent = fmt(stats.today.focusMs);
  $('#stat-pom').textContent = stats.today.pomodoros;
  $('#stat-idle').textContent = fmt(stats.today.idleRemovedMs);
  $('#stat-streak').textContent = stats.streak;
  $('#stat-int').textContent = stats.today.interruptions;
  $('#stat-manual').textContent = fmt(stats.today.manualMs || 0);
  const week = stats.days.slice(-7).reduce((a, d) => a + d.focusMs, 0);
  $('#stat-week').textContent = fmt(week);

  const chart = $('#chart');
  chart.innerHTML = '';
  const max = Math.max(30 * 60000, ...stats.days.map((d) => d.focusMs));
  stats.days.forEach((d) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'bar__fill' + (d.focusMs === 0 ? ' is-empty' : '');
    fill.style.height = `${Math.max(2, (d.focusMs / max) * 100)}%`;
    fill.title = `${d.day}: ${fmt(d.focusMs)} · ${d.pomodoros} pomodoros`;
    const label = document.createElement('span');
    label.className = 'bar__label';
    label.textContent = d.day.slice(8);
    bar.append(fill, label);
    chart.appendChild(bar);
  });

  const rows = $('#session-rows');
  rows.innerHTML = '';
  if (!stats.sessions.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'Nothing logged today yet.';
    td.style.color = 'var(--muted)';
    tr.appendChild(td);
    rows.appendChild(tr);
    return;
  }
  stats.sessions.forEach((s) => {
    const tr = document.createElement('tr');
    const time = new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isWork = s.phase === 'work';
    const manual = s.type === 'manual';
    const type = manual ? 'Manual' : s.type === 'overtime' ? 'Overtime' : labelOf(s.phase);
    const tagClass = manual ? 'tag--manual' : isWork ? 'tag--work' : 'tag--break';
    const outcome = manual
      ? `<span class="tag tag--manual">added by hand${s.pomodoros ? ` · ${s.pomodoros} 🍅` : ''}</span>`
      : s.completed
        ? '<span class="tag tag--ok">completed</span>'
        : s.reason === 'idle-cut'
          ? '<span class="tag tag--cut">ended while away</span>'
          : `<span class="tag">${s.reason}</span>`;

    const cells = document.createElement('template');
    cells.innerHTML = `
      <td>${time}</td>
      <td><span class="tag ${tagClass}">${type}</span></td>
      <td>${Math.round(s.workedMs / 60000)} min</td>
      <td>${s.idleRemovedMs > 30000 ? `${Math.round(s.idleRemovedMs / 60000)} min` : '—'}</td>
      <td>${outcome}</td>`;
    tr.appendChild(cells.content);
    if (s.note) tr.title = s.note;

    const del = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'row-del';
    btn.textContent = '✕';
    btn.title = 'Remove this entry from the statistics';
    btn.addEventListener('click', () => window.pomora.send('session:delete', { id: s.id }));
    del.appendChild(btn);
    tr.appendChild(del);
    rows.appendChild(tr);
  });
}

$('#m-pom').addEventListener('input', () => {
  manualPomTouched = true;
});

$('#m-min').addEventListener('input', () => {
  // Suggest a pomodoro count from the duration until the user overrides it.
  if (manualPomTouched) return;
  const mins = Number($('#m-min').value) || 0;
  const per = manualDefaults.workMinutes || 25;
  $('#m-pom').value = String(Math.max(0, Math.round(mins / per)));
});

$('#manual-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = $('#m-date').value;
  const time = $('#m-time').value;
  const minutes = Number($('#m-min').value) || 0;
  if (!date || !time || minutes < 1) return;

  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const startedAt = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  if (startedAt > Date.now() + 60000) {
    $('#m-hint').textContent = 'That start time is in the future — pick a time that has already passed.';
    return;
  }

  await window.pomora.send('session:add-manual', {
    startedAt,
    workedMs: minutes * 60000,
    pomodoros: Number($('#m-pom').value) || 0,
    taskId: $('#m-task').value || null,
    note: $('#m-note').value,
  });

  $('#m-note').value = '';
  manualPomTouched = false;
  const btn = $('#m-add');
  btn.textContent = 'Added ✓';
  $('#m-hint').textContent = `${minutes} minutes added to ${date}.`;
  setTimeout(() => (btn.textContent = 'Add focus time'), 2000);
});

$('#btn-export').addEventListener('click', async () => {
  const file = await window.pomora.send('data:export-csv');
  if (file) $('#btn-export').textContent = 'Exported ✓';
  setTimeout(() => ($('#btn-export').textContent = 'Export CSV'), 2200);
});
$('#btn-open-folder').addEventListener('click', () => window.pomora.send('data:open-folder'));

// ----------------------------------------------------------------- settings

const MIN = 60000;

function toForm(s) {
  return {
    ...s,
    workMin: Math.round(s.workMs / MIN),
    shortMin: Math.round(s.shortBreakMs / MIN),
    longMin: Math.round(s.longBreakMs / MIN),
    idleMin: Math.round(s.idleThresholdSec / 60),
    notStartedAfterMin: Math.round((s.notStartedAfterMs || 5 * MIN) / MIN),
    volumePct: Math.round((s.volume || 0) * 100),
  };
}

function fromField(key, value) {
  switch (key) {
    case 'workMin':
      return { workMs: Math.max(1, value) * MIN };
    case 'shortMin':
      return { shortBreakMs: Math.max(1, value) * MIN };
    case 'longMin':
      return { longBreakMs: Math.max(1, value) * MIN };
    case 'idleMin':
      return { idleThresholdSec: Math.max(1, value) * 60 };
    case 'notStartedAfterMin':
      return { notStartedAfterMs: Math.min(120, Math.max(1, value || 1)) * MIN };
    case 'volumePct':
      return { volume: Math.min(1, Math.max(0, value / 100)) };
    default:
      return { [key]: value };
  }
}

function renderSettings(s) {
  settings = s;
  const hint = $('#nudge-hint');
  if (hint) {
    hint.textContent = s.autoStartWork
      ? 'Focus starts by itself after each break (Flow → Start the next focus session automatically), so this reminder has nothing to wait for. Turn that off to use it.'
      : 'A full-screen window, like the break window, appears when a break has ended and the next focus session still hasn\'t started. It waits while you are away from the computer.';
  }
  $$('[data-setting="notStartedAfterMin"]').forEach((el) => (el.disabled = !s.notStartedReminder));
  const form = toForm(s);
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    const value = form[key];
    if (value === undefined) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else if (document.activeElement !== el) el.value = value;
  });
}

$$('[data-setting]').forEach((el) => {
  const commit = () => {
    const key = el.dataset.setting;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number' || el.type === 'range') value = Number(el.value);
    else value = el.value;
    window.pomora.send('settings:update', fromField(key, value));
  };
  el.addEventListener('change', commit);
  if (el.type === 'range') el.addEventListener('input', commit);
});

$('#btn-nudge-preview').addEventListener('click', (e) => {
  e.preventDefault();
  window.pomora.send('nudge:show');
});

$('#btn-reset-settings').addEventListener('click', () => window.pomora.send('settings:reset'));
$$('[data-sound]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.preventDefault();
    window.pomora.send('sound:test', { sound: b.dataset.sound });
  })
);

// -------------------------------------------------------------------- audio

const audio = $('#audio');
const pool = [];

function playSound(name, volume) {
  try {
    const el = pool.find((a) => a.paused) || (() => {
      const a = new Audio();
      pool.push(a);
      return a;
    })();
    el.src = `../../assets/sounds/${name}.wav`;
    el.volume = Math.min(1, Math.max(0, volume));
    el.currentTime = 0;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* audio is a nicety, never a failure */
  }
}

// ------------------------------------------------------------------- wiring

window.pomora.on('state', (s) => {
  state = s;
  renderTimer(s);
  if (tasks.length) renderTasks(tasks); // keep the "current task" ring in sync
});
window.pomora.on('tasks', renderTasks);
window.pomora.on('settings', renderSettings);
window.pomora.on('stats', renderStats);
window.pomora.on('sound', ({ sound, volume }) => playSound(sound, volume));
window.pomora.on('navigate', ({ tab }) => showTab(tab));

(async function init() {
  renderSettings(await window.pomora.send('settings:get'));
  renderTasks((await window.pomora.send('task:list')) || []);
  renderStats(await window.pomora.send('stats:get'));
  renderTimer(await window.pomora.send('state:get'));
  $('#version').textContent = `Ferna Pomoro 1.2.0 · Electron ${window.pomora.version}`;
  audio.remove();
})();
