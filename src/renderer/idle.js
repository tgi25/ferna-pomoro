'use strict';

const el = (id) => document.getElementById(id);

function render(info) {
  if (!info) return;
  el('title').textContent = `You were away for ${info.awayText}`;
  el('sub').textContent =
    info.source === 'sleep'
      ? 'The machine slept — the focus clock was frozen at that moment.'
      : `Your ${String(info.phaseLabel).toLowerCase()} clock was frozen at your last keystroke.`;
  el('f-left').textContent = info.leftAt;
  el('f-back').textContent = info.backAt;
  el('f-away').textContent = info.awayClock;
  el('e-discard').textContent = `The pomodoro picks up with ${info.remainingText} still to run.`;
  el('e-cut').textContent = `Log the ${info.elapsedText} you worked and stop at ${info.leftAt}.`;
}

document.querySelectorAll('.choice').forEach((btn) =>
  btn.addEventListener('click', () => {
    window.pomora.send('idle:resolve', {
      choice: btn.dataset.choice,
      alsoRemember: el('remember').checked,
    });
  })
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') window.pomora.send('idle:resolve', { choice: 'discard' });
  if (e.key === 'Escape') window.pomora.send('idle:resolve', { choice: 'pause' });
});

window.pomora.on('idle-prompt', render);
window.pomora.send('idle:snapshot').then((info) => {
  if (!info) return;
  render({
    ...info,
    awayText: `${Math.round(info.idleMs / 60000)} minutes`,
    awayClock: `${Math.round(info.idleMs / 60000)}m`,
    leftAt: new Date(info.awayStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    backAt: new Date(info.returnedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    elapsedText: `${Math.round(info.elapsedMs / 60000)}m`,
    remainingText: `${Math.round(Math.max(0, info.remainingMs) / 60000)}m`,
    phaseLabel: 'focus',
  });
});
