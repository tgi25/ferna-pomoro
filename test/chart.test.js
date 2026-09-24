'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { axisTicks, buildChart, tickLabel, valueOf, HOUR_STEPS } = require('../src/renderer/chart');

const HOUR = 3600000;

test('the axis tops out at a round number above the tallest bar', () => {
  const a = axisTicks(3.2, { count: 4, steps: HOUR_STEPS });
  assert.equal(a.step, 1);
  assert.equal(a.top, 4);
  assert.deepEqual(a.ticks, [0, 1, 2, 3, 4]);
});

test('pomodoro counts get whole-number ticks', () => {
  const a = axisTicks(7, { count: 4, integer: true });
  assert.equal(a.step, 2);
  assert.deepEqual(a.ticks, [0, 2, 4, 6, 8]);
  assert.ok(a.ticks.every(Number.isInteger));
});

test('a quiet fortnight still gets a readable axis', () => {
  const hours = axisTicks(0, { count: 4, min: 1 });
  assert.equal(hours.top, 1);
  assert.ok(hours.ticks.length >= 2);
  const poms = axisTicks(0, { count: 4, integer: true, min: 4 });
  assert.equal(poms.top, 4);
  assert.deepEqual(poms.ticks, [0, 1, 2, 3, 4]);
});

test('hours use clock-like steps, never 2.5 of an hour', () => {
  for (const v of [0.3, 1, 2.2, 4.4, 7, 9.9, 12, 23.5]) {
    const a = axisTicks(v, { count: 4, steps: HOUR_STEPS });
    assert.ok(HOUR_STEPS.includes(a.step), `${v}h → step ${a.step}`);
  }
});

test('a long day is covered by the axis, never cut off', () => {
  for (const v of [0.3, 1, 4.4, 9.9, 12, 23.5]) {
    const a = axisTicks(v, { count: 4, steps: HOUR_STEPS });
    assert.ok(a.top >= v, `${v}h fits under ${a.top}h`);
    assert.ok(a.top - v < a.step, 'and without a wasteful amount of headroom');
  }
});

test('bar heights are a percentage of the axis top', () => {
  const days = [
    { day: '2026-09-20', focusMs: 2 * HOUR, pomodoros: 4 },
    { day: '2026-09-21', focusMs: 0, pomodoros: 0 },
    { day: '2026-09-22', focusMs: 3.2 * HOUR, pomodoros: 7 },
  ];
  const { axis, bars } = buildChart(days, 'hours');
  assert.equal(axis.top, 4);
  assert.equal(bars[0].percent, 50);
  assert.equal(bars[1].empty, true);
  assert.ok(Math.abs(bars[2].percent - 80) < 0.001);
  assert.ok(bars.every((b) => b.percent <= 100), 'no bar overflows the plot');

  const counts = buildChart(days, 'pomodoros');
  assert.equal(counts.axis.top, 8);
  assert.equal(counts.bars[2].percent, 87.5);
});

test('values and tick labels follow the chosen metric', () => {
  const day = { focusMs: 1.5 * HOUR, pomodoros: 3 };
  assert.equal(valueOf(day, 'hours'), 1.5);
  assert.equal(valueOf(day, 'pomodoros'), 3);
  assert.equal(tickLabel(2, 'hours'), '2h');
  assert.equal(tickLabel(0.5, 'hours'), '30m');
  assert.equal(tickLabel(1.5, 'hours'), '1.5h');
  assert.equal(tickLabel(0, 'hours'), '0');
  assert.equal(tickLabel(6, 'pomodoros'), '6');
});
