'use strict';

/**
 * Geometry for the mini timer.
 *
 * The window has no layout engine of its own — the main process has to know how
 * big to make it before the page renders — so the sizes live here, in one
 * place, shared by the window factory and the settings code, and unit-tested.
 *
 * Each size is the outer window size with every row shown. Rows the user has
 * turned off are subtracted, so a small timer with no task line and no clock is
 * genuinely small rather than a big window with a hole in it.
 */
const MINI_SIZES = {
  small: { width: 186, height: 96, taskRow: 15, clockRow: 0 },
  medium: { width: 232, height: 114, taskRow: 17, clockRow: 0 },
  large: { width: 296, height: 138, taskRow: 20, clockRow: 0 },
};

const DEFAULT_MINI_SIZE = 'medium';

/** The size name, with anything unrecognised falling back to medium. */
function miniSizeName(settings = {}) {
  return MINI_SIZES[settings.miniSize] ? settings.miniSize : DEFAULT_MINI_SIZE;
}

/** Outer window size for the current settings. */
function miniWindowSize(settings = {}) {
  const size = MINI_SIZES[miniSizeName(settings)];
  const showTask = settings.miniShowTask !== false;
  return {
    width: size.width,
    height: size.height + (showTask ? size.taskRow : 0),
  };
}

/**
 * Window opacity, 0.3–1. Fully opaque unless the user has asked for less, and
 * never so faint that the timer cannot be read or clicked.
 */
function miniOpacity(settings = {}) {
  const value = Number(settings.miniOpacity);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.3, value));
}

module.exports = { MINI_SIZES, DEFAULT_MINI_SIZE, miniSizeName, miniWindowSize, miniOpacity };
