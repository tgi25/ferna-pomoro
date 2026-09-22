'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the UI and the main process. Renderers get no Node
 * access: they can send a named command and subscribe to named events, nothing
 * else.
 */
const ALLOWED_EVENTS = new Set([
  'state',
  'settings',
  'tasks',
  'stats',
  'sound',
  'idle-prompt',
  'overlay',
  'nudge',
  'alert',
  'toast',
  'navigate',
]);

contextBridge.exposeInMainWorld('pomora', {
  /** Fire a command at the main process; resolves with whatever it returns. */
  send: (type, payload) => ipcRenderer.invoke('pomora:cmd', { type, payload }),

  /** Subscribe to a push event. Returns an unsubscribe function. */
  on: (event, handler) => {
    if (!ALLOWED_EVENTS.has(event)) throw new Error(`unknown event: ${event}`);
    const listener = (_e, data) => handler(data);
    ipcRenderer.on(`pomora:${event}`, listener);
    return () => ipcRenderer.removeListener(`pomora:${event}`, listener);
  },

  platform: process.platform,
  version: process.versions.electron,
});
