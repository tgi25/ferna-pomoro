'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotStartedNudge } = require('../src/main/nudge');

const MIN = 60000;

function make(settings = {}) {
  const s = { notStartedReminder: true, notStartedAfterMs: 5 * MIN, ...settings };
  const n = new NotStartedNudge({ getSettings: () => s, now: () => 0 });
  return { n, s };
}

const WAITING = { awaitingWork: true, away: false };

test('fires once, at the configured delay after the break ends', () => {
  const { n } = make();
  n.arm(1000);
  assert.equal(n.check(1000 + 5 * MIN - 1, WAITING), false);
  assert.equal(n.check(1000 + 5 * MIN, WAITING), true);
  // Stays up; does not fire again while showing.
  assert.equal(n.check(1000 + 9 * MIN, WAITING), false);
  assert.equal(n.shownCount, 1);
  assert.equal(n.sinceBreakMs(1000 + 7 * MIN), 7 * MIN);
});

test('never fires when the setting is off', () => {
  const { n } = make({ notStartedReminder: false });
  n.arm(0);
  assert.equal(n.check(60 * MIN, WAITING), false);
});

test('starting focus any other way disarms it', () => {
  const { n } = make();
  n.arm(0);
  assert.equal(n.check(2 * MIN, { awaitingWork: false, away: false }), false);
  assert.equal(n.armed, false);
  assert.equal(n.check(10 * MIN, WAITING), false);
});

test('waits while the user is away, then counts the delay from their return', () => {
  const { n } = make();
  n.arm(0);
  assert.equal(n.check(6 * MIN, { awaitingWork: true, away: true }), false);
  n.restartFrom(20 * MIN);
  assert.equal(n.check(24 * MIN, WAITING), false);
  assert.equal(n.check(25 * MIN, WAITING), true);
});

test('a return before the delay is up only ever pushes the reminder later', () => {
  const { n } = make();
  n.arm(0);
  n.restartFrom(1 * MIN); // back after one minute
  assert.equal(n.check(5 * MIN, WAITING), false);
  assert.equal(n.check(6 * MIN, WAITING), true);
});

test('snooze takes the window down and brings it back later', () => {
  const { n } = make();
  n.arm(0);
  assert.equal(n.check(5 * MIN, WAITING), true);
  n.snooze(6 * MIN);
  assert.equal(n.showing, false);
  assert.equal(n.check(10 * MIN, WAITING), false);
  assert.equal(n.check(11 * MIN, WAITING), true);
  assert.equal(n.shownCount, 2);
  assert.equal(n.sinceBreakMs(11 * MIN), 11 * MIN);
});

test('changing the delay in Settings moves an unfired reminder', () => {
  const { n, s } = make();
  n.arm(0);
  s.notStartedAfterMs = 2 * MIN;
  n.refresh();
  assert.equal(n.check(2 * MIN, WAITING), true);
});

test('a snoozed reminder keeps the time the user asked for', () => {
  const { n, s } = make();
  n.arm(0);
  n.check(5 * MIN, WAITING);
  n.snooze(5 * MIN, 10 * MIN);
  s.notStartedAfterMs = 1 * MIN;
  n.refresh();
  assert.equal(n.check(14 * MIN, WAITING), false);
  assert.equal(n.check(15 * MIN, WAITING), true);
});

test('a missing or broken delay falls back to five minutes', () => {
  const { n } = make({ notStartedAfterMs: 'x' });
  n.arm(0);
  assert.equal(n.check(5 * MIN - 1, WAITING), false);
  assert.equal(n.check(5 * MIN, WAITING), true);
});

test('the switch-on reminder reads its own settings', () => {
  const s = {
    notStartedReminder: false,
    notStartedAfterMs: 50 * MIN,
    startupReminder: true,
    startupReminderAfterMs: 3 * MIN,
  };
  const n = new NotStartedNudge({
    getSettings: () => s,
    enabledKey: 'startupReminder',
    delayKey: 'startupReminderAfterMs',
  });
  n.arm(0);
  assert.equal(n.check(3 * MIN - 1, WAITING), false);
  assert.equal(n.check(3 * MIN, WAITING), true);
  s.startupReminder = false;
  n.arm(0);
  assert.equal(n.check(10 * MIN, WAITING), false);
});
