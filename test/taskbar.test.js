'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskbarIndicator, iconLabel } = require('../src/main/taskbar');
const { PHASE, STATUS, MINUTE } = require('../src/shared/constants');

test('the live icon shows whole minutes left, rounded up', () => {
  assert.equal(iconLabel({ status: STATUS.RUNNING, remainingMs: 24 * MINUTE + 1 }), '25');
  assert.equal(iconLabel({ status: STATUS.RUNNING, remainingMs: 25 * MINUTE }), '25');
  assert.equal(iconLabel({ status: STATUS.RUNNING, remainingMs: 20 * 1000 }), '1');
  assert.equal(iconLabel({ status: STATUS.PAUSED, remainingMs: 7.5 * MINUTE }), '8');
});

test('a finished phase shows a tick', () => {
  assert.equal(iconLabel({ status: STATUS.AWAITING, remainingMs: 0 }), '✓');
});

test('the corner badge steps aside while the button icon carries the time', () => {
  const settings = { overlayBadge: 'pomodoros', taskbarLiveIcon: true };
  const t = new TaskbarIndicator({
    window: null,
    imageFactory: null,
    settings,
    getToday: () => ({ pomodoros: 3, focusMs: 75 * MINUTE, idleRemovedMs: 0 }),
    onCommand: () => {},
  });
  const running = { phase: PHASE.WORK, status: STATUS.RUNNING, remainingMs: 10 * MINUTE, progress: 0.6 };
  assert.equal(t._badgeSpec(running), null);
  const idle = { phase: PHASE.IDLE, status: STATUS.STOPPED, remainingMs: 0, progress: 0 };
  assert.equal(t._badgeSpec(idle).label, '3', 'with nothing running the badge is back');
  settings.taskbarLiveIcon = false;
  assert.equal(t._badgeSpec(running).label, '3');
});
