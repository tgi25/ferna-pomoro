'use strict';

const path = require('path');
const { BrowserWindow, screen, shell } = require('electron');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const ICON = path
  .join(__dirname, '..', '..', 'assets', 'icons', 'pomora-256.png')
  .replace('app.asar', 'app.asar.unpacked');

const baseWebPrefs = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The timer window must keep rendering and playing alerts while minimised.
  backgroundThrottling: false,
};

function hardenNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createMainWindow({ bounds }) {
  const win = new BrowserWindow({
    width: bounds?.width || 980,
    height: bounds?.height || 700,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Ferna Pomoro',
    backgroundColor: '#14161c',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: baseWebPrefs,
  });
  win.loadFile(path.join(RENDERER, 'index.html'));
  hardenNavigation(win);
  return win;
}

/** Compact always-on-top clock the user can park in a corner. */
function createMiniWindow({ alwaysOnTop = true, bounds } = {}) {
  const display = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: 260,
    height: 116,
    x: bounds?.x ?? display.x + display.width - 288,
    y: bounds?.y ?? display.y + 28,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Ferna Pomoro mini',
    webPreferences: baseWebPrefs,
  });
  if (alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(RENDERER, 'mini.html'));
  hardenNavigation(win);
  return win;
}

/** Full-screen break curtain, one per display. */
function createOverlayWindows() {
  return screen.getAllDisplays().map((display, index) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#0d1117',
      title: 'Ferna Pomoro break',
      webPreferences: baseWebPrefs,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(RENDERER, 'overlay.html'), {
      query: { primary: index === 0 ? '1' : '0' },
    });
    hardenNavigation(win);
    return win;
  });
}

/** "You were away" question, shown the moment the user touches the machine. */
function createIdleWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const width = 460;
  const height = 530;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + (display.height - height) / 2.4),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#161a22',
    title: 'Ferna Pomoro — you were away',
    webPreferences: baseWebPrefs,
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(RENDERER, 'idle.html'));
  hardenNavigation(win);
  return win;
}

module.exports = {
  createMainWindow,
  createMiniWindow,
  createOverlayWindows,
  createIdleWindow,
  ICON,
};
