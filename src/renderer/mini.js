'use strict';

const el = (id) => document.getElementById(id);
const COLORS = { work: '#e0483f', shortBreak: '#1f9d63', longBreak: '#2f7fd0', idle: '#6b7280' };

let showTask = true;

function render(s) {
  renderCompact(s);
  const color = s.status === 'paused' ? '#b4801f' : COLORS[s.phase] || COLORS.idle;
  document.documentElement.style.setProperty('--accent', color);
  el('clock').textContent = s.overtime ? `+${s.clock}` : s.clock;
  el('phase').textContent =
    s.status === 'awaiting'
      ? 'done — next up'
      : s.awayFrozen
        ? 'frozen · away'
        : s.status === 'paused'
          ? `${s.phaseLabel} · paused`
          : s.phaseLabel;
  el('fill').style.width = `${(s.status === 'awaiting' ? 1 : s.progress) * 100}%`;
  el('toggle').textContent =
    s.status === 'running' ? 'Pause' : s.status === 'awaiting' ? 'Next' : s.status === 'paused' ? 'Resume' : 'Start';

  // What am I meant to be working on?
  const task = el('task');
  task.classList.toggle('hidden', !showTask);
  if (showTask) {
    task.textContent = s.taskTitle || 'No task selected';
    task.title = s.taskTitle || 'No task selected';
  }
}

/** The overlay: the countdown, the time of day, and nothing else. */
function renderCompact(s) {
  el('c-focus').textContent = s.overtime ? `+${s.clock}` : s.clock;
  el('c-toggle').textContent = s.status === 'running' ? '❚❚' : '▶';
  el('c-toggle').title = s.status === 'running' ? 'Pause' : s.status === 'awaiting' ? 'Start the next one' : 'Start';
}

/** The time of day, kept to the minute, in both skins. */
function renderNow() {
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el('now').textContent = now;
  el('c-now').textContent = now;
}

function applySettings(settings) {
  if (!settings) return;
  document.body.dataset.compact = settings.miniCompact ? '1' : '0';
  document.body.dataset.layout =
    settings.miniCompactLayout === 'horizontal' ? 'horizontal' : 'vertical';
  document.body.dataset.size = ['small', 'medium', 'large'].includes(settings.miniSize)
    ? settings.miniSize
    : 'medium';
  showTask = settings.miniShowTask !== false;
  el('now').classList.toggle('hidden', settings.miniShowClock === false);
  // Minimising only makes sense when there is a taskbar button to minimise to.
  el('min').classList.toggle('hidden', !settings.miniInTaskbar);
  renderNow();
}

el('toggle').addEventListener('click', () => window.pomora.send('timer:toggle'));
el('skip').addEventListener('click', () => window.pomora.send('timer:skip'));
el('open').addEventListener('click', () => window.pomora.send('window:show'));
el('close').addEventListener('click', () => window.pomora.send('window:close-mini'));
el('min').addEventListener('click', () => window.pomora.send('window:minimise-mini'));
el('c-toggle').addEventListener('click', () => window.pomora.send('timer:toggle'));
el('c-open').addEventListener('click', () => window.pomora.send('window:show'));
el('c-close').addEventListener('click', () => window.pomora.send('window:close-mini'));
// Double-clicking the overlay opens the full window, as a title bar would.
el('compact').addEventListener('dblclick', () => window.pomora.send('window:show'));

window.pomora.on('state', render);
window.pomora.on('settings', applySettings);
window.pomora.send('state:get').then(render);
window.pomora.send('settings:get').then(applySettings);

renderNow();
setInterval(renderNow, 10000);
