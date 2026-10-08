'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINI_SIZES,
  miniSizeName,
  miniWindowSize,
  miniOpacity,
  miniScale,
  miniZoom,
} = require('../src/shared/mini');

test('the three sizes get smaller in both directions', () => {
  const { small, medium, large } = MINI_SIZES;
  assert.ok(small.width < medium.width && medium.width < large.width);
  assert.ok(small.height < medium.height && medium.height < large.height);
  assert.ok(small.width < 200, 'the small one is genuinely small');
});

test('an unknown or missing size falls back to medium', () => {
  assert.equal(miniSizeName({}), 'medium');
  assert.equal(miniSizeName({ miniSize: 'enormous' }), 'medium');
  assert.equal(miniSizeName({ miniSize: 'small' }), 'small');
});

test('the window shrinks when the task line is turned off', () => {
  const withTask = miniWindowSize({ miniSize: 'small', miniShowTask: true });
  const without = miniWindowSize({ miniSize: 'small', miniShowTask: false });
  assert.equal(withTask.width, without.width);
  assert.equal(withTask.height - without.height, MINI_SIZES.small.taskRow);
  assert.ok(without.height < 100);
});

test('opacity is clamped to something still readable', () => {
  assert.equal(miniOpacity({}), 1);
  assert.equal(miniOpacity({ miniOpacity: 0.65 }), 0.65);
  assert.equal(miniOpacity({ miniOpacity: 0.05 }), 0.3, 'never invisible');
  assert.equal(miniOpacity({ miniOpacity: 4 }), 1);
  assert.equal(miniOpacity({ miniOpacity: 'x' }), 1);
});

// ------------------------------------------------- the ultra-compact overlay

test('the compact overlay is far smaller than the ordinary mini timer', () => {
  const normal = miniWindowSize({ miniSize: 'medium', miniShowTask: true });
  const compact = miniWindowSize({ miniCompact: true, miniCompactLayout: 'vertical' });
  assert.ok(compact.width < normal.width && compact.height < normal.height,
    `${compact.width}x${compact.height} vs ${normal.width}x${normal.height}`);
});

test('the two layouts have the shapes their names promise', () => {
  const v = miniWindowSize({ miniCompact: true, miniCompactLayout: 'vertical' });
  const h = miniWindowSize({ miniCompact: true, miniCompactLayout: 'horizontal' });
  assert.ok(v.height > h.height, 'stacked is taller');
  assert.ok(h.width > v.width, 'side by side is wider');
  // An unknown layout falls back to stacked rather than breaking.
  assert.deepEqual(miniWindowSize({ miniCompact: true, miniCompactLayout: 'diagonal' }), v);
});

test('scaling grows the window and the page together', () => {
  const one = miniWindowSize({ miniCompact: true, miniScale: 1 });
  const two = miniWindowSize({ miniCompact: true, miniScale: 2 });
  assert.equal(two.width, one.width * 2);
  assert.equal(two.height, one.height * 2);
  assert.equal(miniZoom({ miniCompact: true, miniScale: 2 }), 2);
  // The page is only zoomed in compact mode; the full timer has its own sizes.
  assert.equal(miniZoom({ miniCompact: false, miniScale: 2 }), 1);
});

test('the scale is clamped to something usable', () => {
  assert.equal(miniScale({ miniScale: 0.1 }), 0.6);
  assert.equal(miniScale({ miniScale: 9 }), 2.5);
  assert.equal(miniScale({ miniScale: 'big' }), 1);
  assert.equal(miniScale({}), 1);
});
