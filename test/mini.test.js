'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MINI_SIZES, miniSizeName, miniWindowSize, miniOpacity } = require('../src/shared/mini');

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
