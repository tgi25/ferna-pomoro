'use strict';

const el = (id) => document.getElementById(id);
const isPrimary = new URLSearchParams(location.search).get('primary') === '1';

// Only the primary screen carries the controls; the others just show the count.
if (!isPrimary) {
  document.body.classList.add('secondary-only');
  el('actions').classList.add('hidden');
  el('footnote').classList.add('hidden');
}

let sinceAt = null;
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
  if (sinceAt !== null) el('clock').textContent = clock(Date.now() - sinceAt);
}

// Two reminders share this window: after a break, and after switching on.
window.pomora.on('nudge', (info) => {
  sinceAt = info.sinceAt;
  document.body.dataset.mode = info.mode;
  el('kicker').textContent = info.count > 1 ? `${info.kicker} · reminder ${info.count}` : info.kicker;
  el('headline').textContent = info.headline;
  el('since').textContent = info.sinceText;
  el('next').textContent = info.nextText;
  el('today').textContent = info.todayText;
  el('snooze').textContent = `Remind me in ${info.snoozeMinutes} min`;
  el('stop').textContent = info.stopLabel;
  render();
  if (!timer) timer = setInterval(render, 500);
});

el('start').addEventListener('click', () => window.pomora.send('nudge:start'));
el('snooze').addEventListener('click', () => window.pomora.send('nudge:snooze'));
el('stop').addEventListener('click', () => window.pomora.send('nudge:stop'));

window.addEventListener('keydown', (e) => {
  if (isPrimary && e.key === 'Escape') window.pomora.send('nudge:snooze');
});
