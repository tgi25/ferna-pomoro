'use strict';

const el = (id) => document.getElementById(id);
const isPrimary = new URLSearchParams(location.search).get('primary') === '1';

// Only the primary screen carries the controls; the others just show the count.
if (!isPrimary) {
  document.body.classList.add('secondary-only');
  el('actions').classList.add('hidden');
  el('footnote').classList.add('hidden');
}

let breakEndedAt = null;
let timer = null;

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function render() {
  if (breakEndedAt !== null) el('clock').textContent = clock(Date.now() - breakEndedAt);
}

window.pomora.on('nudge', (info) => {
  breakEndedAt = info.breakEndedAt;
  el('since').textContent = `since your ${info.breakLabel} ended at ${info.endedAtText}`;
  el('next').textContent = info.taskTitle
    ? `Next: ${info.focusMinutes} minutes on “${info.taskTitle}”`
    : `Next: a ${info.focusMinutes}-minute focus session`;
  el('today').textContent = `${info.today.focusText} focused today · ${info.today.pomodoros} pomodoros`;
  el('snooze').textContent = `Remind me in ${info.snoozeMinutes} min`;
  el('kicker').textContent = info.count > 1 ? `Break is over · reminder ${info.count}` : 'Break is over';
  render();
  if (!timer) timer = setInterval(render, 500);
});

el('start').addEventListener('click', () => window.pomora.send('nudge:start'));
el('snooze').addEventListener('click', () => window.pomora.send('nudge:snooze'));
el('stop').addEventListener('click', () => window.pomora.send('nudge:stop'));

window.addEventListener('keydown', (e) => {
  if (!isPrimary) return;
  if (e.key === 'Escape') window.pomora.send('nudge:snooze');
});
