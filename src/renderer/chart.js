/**
 * Chart maths for the statistics pane.
 *
 * Kept apart from the drawing code, and free of any DOM, so the axis can be
 * unit-tested: an axis that lies is worse than no axis at all.
 *
 * Loaded as a plain script by index.html (`window.PomoraChart`) and required
 * directly by the tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PomoraChart = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Hours read best on a clock-like ladder: quarters, halves, then whole
  // hours that divide a working day. 2.5h ticks are technically fine and
  // humanly awful.
  const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24];

  /** Round a step up to one people read easily. */
  function niceStep(raw, { integer = false, steps = null } = {}) {
    if (!(raw > 0)) return steps ? steps[0] : integer ? 1 : 0.5;
    if (steps) {
      for (const s of steps) if (s >= raw - 1e-9) return s;
      return Math.ceil(raw / steps[steps.length - 1]) * steps[steps.length - 1];
    }
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const c of [1, 2, 5, 10]) {
      const step = c * pow;
      if (step >= raw - 1e-9) return integer ? Math.max(1, Math.round(step)) : step;
    }
    return pow * 10;
  }

  /**
   * Ticks for the vertical axis: 0 up to a round number at or above the tallest
   * bar, in even steps.
   *
   * @param {number} maxValue  the tallest bar's value
   * @param {object} [opts]
   * @param {number} [opts.count]    how many steps to aim for
   * @param {boolean} [opts.integer] whole numbers only (pomodoro counts)
   * @param {number[]} [opts.steps]  an explicit ladder of allowed steps
   * @param {number} [opts.min]      never scale below this, so an empty
   *                                 fortnight still has a sensible axis
   * @returns {{top: number, step: number, ticks: number[]}}
   */
  function axisTicks(maxValue, { count = 4, integer = false, min = 0, steps = null } = {}) {
    const target = Math.max(Number(maxValue) || 0, min, integer ? 1 : 0.5);
    const step = niceStep(target / Math.max(1, count), { integer, steps });
    const top = Math.ceil(target / step - 1e-9) * step;
    const ticks = [];
    for (let i = 0; i * step <= top + 1e-9; i += 1) {
      ticks.push(Math.round(i * step * 1000) / 1000);
    }
    return { top, step, ticks };
  }

  /** The value a day contributes under the chosen metric. */
  function valueOf(day, metric) {
    if (metric === 'pomodoros') return day.pomodoros || 0;
    return (day.focusMs || 0) / 3600000; // hours
  }

  /** Axis tick label, e.g. "2h", "0.5h", "6". */
  function tickLabel(value, metric) {
    if (metric === 'pomodoros') return String(value);
    if (value === 0) return '0';
    if (value < 1) return `${Math.round(value * 60)}m`;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
  }

  /**
   * Everything the drawing code needs: the ticks, and each bar's height as a
   * percentage of the plot area.
   */
  function buildChart(days, metric, opts = {}) {
    const values = days.map((d) => valueOf(d, metric));
    const axis = axisTicks(Math.max(0, ...values), {
      count: opts.count || 4,
      integer: metric === 'pomodoros',
      steps: metric === 'pomodoros' ? null : HOUR_STEPS,
      min: metric === 'pomodoros' ? 4 : 1,
    });
    const bars = days.map((d, i) => ({
      day: d.day,
      value: values[i],
      percent: axis.top > 0 ? (values[i] / axis.top) * 100 : 0,
      empty: values[i] === 0,
    }));
    return { axis, bars, metric };
  }

  return { niceStep, axisTicks, valueOf, tickLabel, buildChart, HOUR_STEPS };
});
