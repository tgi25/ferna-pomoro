'use strict';

const el = (id) => document.getElementById(id);
const COLORS = { work: '#e0483f', shortBreak: '#1f9d63', longBreak: '#2f7fd0', idle: '#6b7280' };

function render(s) {
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
}

el('toggle').addEventListener('click', () => window.pomora.send('timer:toggle'));
el('skip').addEventListener('click', () => window.pomora.send('timer:skip'));
el('open').addEventListener('click', () => window.pomora.send('window:show'));
el('close').addEventListener('click', () => window.pomora.send('window:close-mini'));

window.pomora.on('state', render);
window.pomora.send('state:get').then(render);
