'use strict';

const el = (id) => document.getElementById(id);
const isPrimary = new URLSearchParams(location.search).get('primary') === '1';

// Only the primary screen carries the controls; the others just dim and count.
if (!isPrimary) {
  document.body.classList.add('secondary-only');
  el('actions').classList.add('hidden');
}

let canHide = true;

window.pomora.on('overlay', (info) => {
  document.documentElement.style.setProperty('--accent', info.color || '#1f9d63');
  el('kicker').textContent = info.phaseLabel;
  el('suggestion').textContent = info.suggestion;
  el('today').textContent = `${info.today.focusText} focused today · ${info.today.pomodoros} pomodoros`;
  el('done').textContent = info.completedText || '';
  el('done').classList.toggle('hidden', !info.completedText);

  canHide = !!info.canHide;
  // "Close this window" leaves the curtain; "Back to work now" ends the break.
  // They are separate permissions, so each button follows its own setting.
  el('hide').classList.toggle('hidden', !canHide);
  el('back').classList.toggle('hidden', !info.dismissable);
  el('extend').classList.toggle('hidden', !info.dismissable && !canHide);
  const anyAction = (canHide || info.dismissable) && isPrimary;
  el('actions').classList.toggle('hidden', !anyAction);
  el('footnote').classList.toggle('hidden', !canHide || !isPrimary);
});

window.pomora.on('state', (s) => {
  el('clock').textContent = s.clock;
  el('fill').style.width = `${s.progress * 100}%`;
});

el('back').addEventListener('click', () => window.pomora.send('overlay:skip'));
el('hide').addEventListener('click', () => window.pomora.send('overlay:hide'));
el('extend').addEventListener('click', () => window.pomora.send('timer:extend', { ms: 5 * 60000 }));

// Esc closes the window without ending the break — the gentler of the two, and
// what a user reaching for Escape almost always means.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && canHide && isPrimary) window.pomora.send('overlay:hide');
});
