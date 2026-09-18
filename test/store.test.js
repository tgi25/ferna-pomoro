'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/main/store');
const { PHASE, MINUTE } = require('../src/shared/constants');
const { formatClock, formatDuration, dayKey } = require('../src/shared/format');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomora-test-'));
  return new Store(dir, { debounceMs: 5 });
}

test('a work session folds into today\'s totals', () => {
  const store = tmpStore();
  store.logSession({
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 25 * MINUTE,
    endedAt: Date.now(),
    plannedMs: 25 * MINUTE,
    workedMs: 25 * MINUTE,
    idleRemovedMs: 4 * MINUTE,
    reason: 'completed',
    completed: true,
    taskId: null,
  });
  const today = store.today();
  assert.equal(today.pomodoros, 1);
  assert.equal(today.focusMs, 25 * MINUTE);
  assert.equal(today.idleRemovedMs, 4 * MINUTE);
  assert.equal(today.interruptions, 0);
});

test('breaks do not count as focus, unfinished work counts as an interruption', () => {
  const store = tmpStore();
  const base = {
    type: 'phase',
    startedAt: Date.now() - MINUTE,
    endedAt: Date.now(),
    plannedMs: 5 * MINUTE,
    idleRemovedMs: 0,
    reason: 'completed',
    taskId: null,
  };
  store.logSession({ ...base, phase: PHASE.SHORT_BREAK, workedMs: 5 * MINUTE, completed: true });
  store.logSession({ ...base, phase: PHASE.WORK, workedMs: 9 * MINUTE, completed: false, reason: 'idle-cut' });
  const today = store.today();
  assert.equal(today.breakMs, 5 * MINUTE);
  assert.equal(today.focusMs, 9 * MINUTE);
  assert.equal(today.pomodoros, 0);
  assert.equal(today.interruptions, 1);
});

test('task focus time and pomodoro counts accumulate', () => {
  const store = tmpStore();
  const task = store.addTask({ title: 'Write the NLP lecture', estimate: 3 });
  store.logSession({
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 25 * MINUTE,
    endedAt: Date.now(),
    plannedMs: 25 * MINUTE,
    workedMs: 25 * MINUTE,
    idleRemovedMs: 0,
    reason: 'completed',
    completed: true,
    taskId: task.id,
  });
  const updated = store.data.tasks[0];
  assert.equal(updated.done, 1);
  assert.equal(updated.focusMs, 25 * MINUTE);
});

test('settings survive a reload from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomora-test-'));
  const a = new Store(dir);
  a.updateSettings({ workMs: 50 * MINUTE, idleThresholdSec: 120 });
  a.save({ immediate: true });

  const b = new Store(dir);
  assert.equal(b.settings.workMs, 50 * MINUTE);
  assert.equal(b.settings.idleThresholdSec, 120);
  assert.equal(b.settings.shortBreakMs, 5 * MINUTE, 'unset values fall back to the defaults');
});

test('a corrupt data file falls back to defaults instead of crashing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomora-test-'));
  fs.writeFileSync(path.join(dir, 'pomora-data.json'), '{ this is not json');
  const store = new Store(dir);
  assert.equal(store.settings.workMs, 25 * MINUTE);
  assert.deepEqual(store.data.tasks, []);
});

test('recentDays fills gaps and ends today', () => {
  const store = tmpStore();
  const days = store.recentDays(14);
  assert.equal(days.length, 14);
  assert.equal(days[13].day, dayKey());
  assert.ok(days.every((d) => typeof d.focusMs === 'number'));
});

test('CSV export has one header and one row per session', () => {
  const store = tmpStore();
  const task = store.addTask({ title: 'Marking, "MSc" batch', estimate: 2 });
  store.logSession({
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 25 * MINUTE,
    endedAt: Date.now(),
    plannedMs: 25 * MINUTE,
    workedMs: 24 * MINUTE,
    idleRemovedMs: MINUTE,
    reason: 'completed',
    completed: true,
    taskId: task.id,
  });
  const lines = store.exportCsv().trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('started_at,ended_at,type,phase'));
  assert.ok(lines[1].includes('"Marking, ""MSc"" batch"'), 'quotes and commas are escaped');
});

test('formatting helpers', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(59_400), '00:59');
  assert.equal(formatClock(25 * MINUTE), '25:00');
  assert.equal(formatClock(-5000), '00:00');
  assert.equal(formatClock(3 * 3600 * 1000 + 4 * MINUTE + 5000), '3:04:05');
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(95 * MINUTE), '1h 35m');
  assert.equal(formatDuration(120 * MINUTE), '2h');
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 30).getTime()), '2026-01-05');
});

// --------------------------------------------------- manual focus time (v1.1)

test('manual focus time lands on the day it happened, not today', () => {
  const store = tmpStore();
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  threeDaysAgo.setHours(9, 0, 0, 0);

  store.addManualSession({
    startedAt: threeDaysAgo.getTime(),
    workedMs: 90 * MINUTE,
    pomodoros: 3,
    note: 'Marked scripts offline',
  });

  assert.equal(store.today().focusMs, 0, 'today is untouched');
  const day = store.data.days[dayKey(threeDaysAgo.getTime())];
  assert.equal(day.focusMs, 90 * MINUTE);
  assert.equal(day.manualMs, 90 * MINUTE);
  assert.equal(day.pomodoros, 3);
});

test('manual entries credit the chosen task', () => {
  const store = tmpStore();
  const task = store.addTask({ title: 'Read ACL papers', estimate: 4 });
  store.addManualSession({
    startedAt: Date.now() - 50 * MINUTE,
    workedMs: 50 * MINUTE,
    pomodoros: 2,
    taskId: task.id,
  });
  const updated = store.data.tasks[0];
  assert.equal(updated.focusMs, 50 * MINUTE);
  assert.equal(updated.done, 2);
});

test('manual durations are clamped to something sane', () => {
  const store = tmpStore();
  const a = store.addManualSession({ startedAt: Date.now(), workedMs: 5 });
  assert.equal(a.workedMs, MINUTE, 'a zero-length entry becomes one minute');
  const b = store.addManualSession({ startedAt: Date.now(), workedMs: 48 * 3600 * 1000 });
  assert.equal(b.workedMs, 16 * 3600 * 1000, 'capped at a long working day');
  const c = store.addManualSession({ startedAt: Date.now(), workedMs: MINUTE, pomodoros: 999 });
  assert.equal(c.pomodoros, 50);
});

test('deleting a session unwinds every number it added', () => {
  const store = tmpStore();
  const task = store.addTask({ title: 'Swarm routing draft', estimate: 2 });
  const entry = store.addManualSession({
    startedAt: Date.now() - 40 * MINUTE,
    workedMs: 40 * MINUTE,
    pomodoros: 2,
    taskId: task.id,
  });
  assert.equal(store.today().focusMs, 40 * MINUTE);

  assert.equal(store.deleteSession(entry.id), true);
  const today = store.today();
  assert.equal(today.focusMs, 0);
  assert.equal(today.manualMs, 0);
  assert.equal(today.pomodoros, 0);
  assert.equal(store.data.tasks[0].focusMs, 0);
  assert.equal(store.data.tasks[0].done, 0);
  assert.equal(store.data.sessions.length, 0);
  assert.equal(store.deleteSession('nope'), false);
});

test('deleting a timed pomodoro removes exactly one pomodoro', () => {
  const store = tmpStore();
  const base = {
    type: 'phase',
    phase: PHASE.WORK,
    startedAt: Date.now() - 25 * MINUTE,
    endedAt: Date.now(),
    plannedMs: 25 * MINUTE,
    workedMs: 25 * MINUTE,
    idleRemovedMs: 3 * MINUTE,
    reason: 'completed',
    completed: true,
    taskId: null,
  };
  const first = store.logSession(base);
  store.logSession({ ...base });
  assert.equal(store.today().pomodoros, 2);

  store.deleteSession(first.id);
  const today = store.today();
  assert.equal(today.pomodoros, 1);
  assert.equal(today.focusMs, 25 * MINUTE);
  assert.equal(today.idleRemovedMs, 3 * MINUTE);
});

test('aggregates never go negative even if a day was edited oddly', () => {
  const store = tmpStore();
  const entry = store.addManualSession({ startedAt: Date.now(), workedMs: 30 * MINUTE, pomodoros: 1 });
  store.data.days[dayKey()].focusMs = 5 * MINUTE; // pretend something got out of step
  store.deleteSession(entry.id);
  assert.equal(store.today().focusMs, 0);
  assert.equal(store.today().pomodoros, 0);
});

test('legacy Pomora data is carried over on first run of the renamed app', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pomora-roaming-'));
  const oldDir = path.join(root, 'Pomora');
  const newDir = path.join(root, 'Ferna Pomoro');
  fs.mkdirSync(oldDir, { recursive: true });

  const old = new Store(oldDir);
  old.updateSettings({ workMs: 45 * MINUTE });
  old.addTask({ title: 'Existing task' });
  old.save({ immediate: true });

  assert.equal(Store.migrateLegacyFolder(newDir), true);
  const fresh = new Store(newDir);
  assert.equal(fresh.settings.workMs, 45 * MINUTE);
  assert.equal(fresh.data.tasks[0].title, 'Existing task');

  // Running it again must not clobber data written since the move.
  fresh.addTask({ title: 'Added after the rename' });
  fresh.save({ immediate: true });
  assert.equal(Store.migrateLegacyFolder(newDir), false);
  assert.equal(new Store(newDir).data.tasks.length, 2);
});

test('CSV export carries manual entries and their notes', () => {
  const store = tmpStore();
  store.addManualSession({
    startedAt: Date.now() - MINUTE,
    workedMs: 20 * MINUTE,
    pomodoros: 1,
    note: 'Lecture prep, no laptop',
  });
  const [head, row] = store.exportCsv().trim().split('\n');
  assert.ok(head.endsWith('note'));
  assert.ok(row.includes('manual'));
  assert.ok(row.includes('"Lecture prep, no laptop"'));
});
