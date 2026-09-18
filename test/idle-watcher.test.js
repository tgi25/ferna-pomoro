'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { IdleWatcher } = require('../src/main/idle-watcher');

function makeWatcher(thresholdSec = 300) {
  let t = 1_700_000_000_000;
  let idleSec = 0;
  const events = [];
  const watcher = new IdleWatcher({
    getIdleSeconds: () => idleSec,
    nowFn: () => t,
    thresholdSec,
    pollMs: 1000,
  });
  ['away-start', 'away-tick', 'away-end'].forEach((name) =>
    watcher.on(name, (payload) => events.push({ name, ...payload }))
  );
  return {
    watcher,
    events,
    /** Move the wall clock forward and set the reported idle seconds. */
    step(seconds, reportedIdle) {
      t += seconds * 1000;
      idleSec = reportedIdle;
      watcher.poll();
    },
    now: () => t,
  };
}

test('nothing fires below the threshold', () => {
  const w = makeWatcher(300);
  w.step(60, 60);
  w.step(60, 120);
  w.step(60, 299);
  assert.equal(w.events.length, 0);
});

test('crossing the threshold reports the away time from the last keystroke', () => {
  const w = makeWatcher(300);
  w.step(300, 300);
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].name, 'away-start');
  // The episode is dated back to the last input, not to the detection moment.
  assert.equal(w.now() - w.events[0].awayStart, 300 * 1000);
});

test('returning ends the episode with the full away duration', () => {
  const w = makeWatcher(300);
  w.step(300, 300); // away-start
  w.step(600, 900); // still away
  w.step(5, 2); // touched the mouse 2s ago

  const end = w.events.find((e) => e.name === 'away-end');
  assert.ok(end);
  // Away from t+0 to t+905-2 = 903 seconds.
  assert.equal(Math.round(end.idleMs / 1000), 903);
  assert.ok(end.returnedAt > end.awayStart);
});

test('a second episode is tracked after the first one closes', () => {
  const w = makeWatcher(300);
  w.step(300, 300);
  w.step(10, 0);
  w.step(400, 400);
  const starts = w.events.filter((e) => e.name === 'away-start');
  assert.equal(starts.length, 2);
});

test('disabling stops reporting', () => {
  const w = makeWatcher(300);
  w.watcher.setEnabled(false);
  w.step(900, 900);
  assert.equal(w.events.length, 0);
});

test('a bad reading is ignored rather than treated as activity', () => {
  let t = 0;
  let value = 400;
  const events = [];
  const watcher = new IdleWatcher({
    getIdleSeconds: () => {
      if (value === 'throw') throw new Error('nope');
      return value;
    },
    nowFn: () => (t += 1000),
    thresholdSec: 300,
  });
  watcher.on('away-end', (e) => events.push(e));
  watcher.poll(); // away-start
  value = 'throw';
  watcher.poll();
  assert.equal(events.length, 0, 'the episode stays open');
  assert.equal(watcher.away, true);
});

test('sleep and lock periods can be reported from outside', () => {
  const w = makeWatcher(300);
  const start = w.now() - 3600 * 1000;
  w.watcher.reportExternalAway(start, w.now());
  assert.deepEqual(
    w.events.map((e) => e.name),
    ['away-start', 'away-end']
  );
  assert.equal(Math.round(w.events[1].idleMs / 1000), 3600);
});
