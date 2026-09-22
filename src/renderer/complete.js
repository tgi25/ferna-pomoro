'use strict';

const el = (id) => document.getElementById(id);
const isPrimary = new URLSearchParams(location.search).get('primary') === '1';

if (!isPrimary) {
  document.body.classList.add('secondary-only');
  el('actions').classList.add('hidden');
  el('footnote').classList.add('hidden');
}

let info = null;

window.pomora.on('complete', (data) => {
  info = data;
  const root = document.documentElement.style;
  root.setProperty('--done', data.color || '#e0483f');
  root.setProperty('--next', data.nextColor || '#1f9d63');

  el('kicker').textContent = data.kicker;
  el('headline').textContent = data.headline;
  el('note').textContent = data.note;
  el('primary').textContent = data.primary;
  el('alt').textContent = data.alt;
  el('close').classList.toggle('hidden', data.variant === 'started'); // "Carry on" closes it
  el('today').textContent = data.todayText;

  // One dot per pomodoro of the daily goal, filled for each one done.
  const dots = el('dots');
  dots.innerHTML = '';
  const total = Math.min(16, Math.max(data.goal || 0, data.pomodoros || 0));
  for (let i = 0; i < total; i += 1) {
    const d = document.createElement('span');
    if (i < data.pomodoros) d.className = 'on';
    dots.appendChild(d);
  }
  dots.classList.toggle('hidden', total === 0);
});

// After a focus session the clock keeps counting overtime until you choose.
window.pomora.on('state', (s) => {
  const show = !!(info && info.variant === 'waiting' && s.overtime && s.overtimeMs >= 1000);
  el('overtime').classList.toggle('hidden', !show);
  if (show) el('overtime').textContent = `+${s.clock} since the bell · still counting as work`;
});

el('primary').addEventListener('click', () => window.pomora.send('complete:primary'));
el('alt').addEventListener('click', () => window.pomora.send('complete:alt'));
el('close').addEventListener('click', () => window.pomora.send('complete:close'));

window.addEventListener('keydown', (e) => {
  if (isPrimary && e.key === 'Escape') window.pomora.send('complete:close');
});
