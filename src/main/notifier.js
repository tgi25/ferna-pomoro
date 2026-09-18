'use strict';

const path = require('path');
const { Notification } = require('electron');

// Windows reads the toast icon with native code, which cannot see inside the
// asar archive — electron-builder unpacks assets/icons for exactly this.
const ICON = path
  .join(__dirname, '..', '..', 'assets', 'icons', 'pomora-256.png')
  .replace('app.asar', 'app.asar.unpacked');

/**
 * Notifier — Windows toast alerts.
 *
 * Electron's `actions` field is macOS-only, so action buttons are built with
 * raw toast XML and a `pomora://` protocol activation; the main process picks
 * the activation up through the single-instance argv. If anything about the XML
 * path fails (older Windows builds, no registered shortcut), this falls back to
 * a plain toast, which always works.
 *
 * The app plays its own audio, so toasts are raised silently when sound is on —
 * otherwise Windows chimes over the top of our alert.
 */
class Notifier {
  constructor({ getSettings, onAction }) {
    this.getSettings = getSettings;
    this.onAction = onAction;
    this.supported = Notification.isSupported();
    this.useXml = process.platform === 'win32';
  }

  _escape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _xml({ title, body, actions = [], longDuration = false }) {
    const buttons = actions
      .map(
        (a) =>
          `<action content="${this._escape(a.label)}" arguments="pomora://action/${this._escape(
            a.id
          )}" activationType="protocol"/>`
      )
      .join('');
    return `<toast activationType="protocol" launch="pomora://action/open"${
      longDuration ? ' duration="long"' : ''
    }>
  <visual>
    <binding template="ToastGeneric">
      <text>${this._escape(title)}</text>
      <text>${this._escape(body)}</text>
    </binding>
  </visual>
  ${buttons ? `<actions>${buttons}</actions>` : ''}
  <audio silent="true"/>
</toast>`;
  }

  show({ title, body, actions = [], longDuration = false, force = false }) {
    const settings = this.getSettings();
    if (!this.supported) return null;
    if (!settings.notifications && !force) return null;

    const silent = true; // our own sound engine handles audio
    let notification;
    if (this.useXml) {
      try {
        notification = new Notification({
          toastXml: this._xml({ title, body, actions, longDuration }),
        });
      } catch {
        notification = null;
      }
    }
    if (!notification) {
      notification = new Notification({ title, body, icon: ICON, silent });
    }
    notification.on('click', () => this.onAction('open'));
    try {
      notification.show();
    } catch (err) {
      console.error('[pomora] notification failed:', err.message);
      return null;
    }
    return notification;
  }

  // ------------------------------------------------------------ alert types

  workAlert({ index, total, minutes, taskTitle }) {
    const ordinal = total > 0 ? ` ${index} of ${total}` : '';
    return this.show({
      title: '🍅 Work Alert — focus time',
      body: taskTitle
        ? `Pomodoro${ordinal} · ${minutes} min on "${taskTitle}". Clear the desk and begin.`
        : `Pomodoro${ordinal} · ${minutes} minutes of deep work. Pick one thing and start.`,
      actions: [
        { id: 'pause', label: 'Pause' },
        { id: 'skip', label: 'Skip' },
      ],
    });
  }

  shortBreakAlert({ minutes, pomodoros }) {
    return this.show({
      title: '☕ Short Break Alert',
      body: `Pomodoro ${pomodoros} done. Stand up, look 20 feet away for 20 seconds — back in ${minutes} min.`,
      actions: [
        { id: 'start-break', label: 'Start break' },
        { id: 'extend-5', label: '+5 min work' },
        { id: 'skip', label: 'Skip break' },
      ],
    });
  }

  longBreakAlert({ minutes, pomodoros }) {
    return this.show({
      title: '🌿 Long Break Alert',
      body: `${pomodoros} pomodoros in a row — take the long one. ${minutes} minutes away from the screen.`,
      longDuration: true,
      actions: [
        { id: 'start-break', label: 'Start long break' },
        { id: 'skip', label: 'Skip' },
      ],
    });
  }

  breakOver({ next, minutes }) {
    return this.show({
      title: '⏰ Break over — back to work',
      body: `Next up: ${minutes} minutes of focus${next ? ` (${next})` : ''}.`,
      actions: [
        { id: 'start-work', label: 'Start focus' },
        { id: 'extend-break-5', label: '+5 min break' },
      ],
      longDuration: true,
    });
  }

  resumedWork({ minutes, taskTitle }) {
    return this.show({
      title: '▶️ Back at it — focus started',
      body: taskTitle
        ? `${minutes} minutes on "${taskTitle}". The clock is running.`
        : `${minutes} minutes on the clock. The timer is running.`,
    });
  }

  welcomeBack({ awayText, phaseLabel }) {
    return this.show({
      title: '👋 Welcome back',
      body: `You were away ${awayText} during your ${phaseLabel}. Ready to start the next focus session?`,
      actions: [
        { id: 'start-work', label: 'Start focus' },
        { id: 'open', label: 'Open Ferna Pomoro' },
      ],
      longDuration: true,
    });
  }

  idleDetected({ awayText }) {
    return this.show({
      title: '⏸️ Timer paused — you were away',
      body: `${awayText} of idle time detected. Open Ferna Pomoro to remove it from this pomodoro or keep it.`,
      actions: [
        { id: 'idle-discard', label: 'Remove idle time' },
        { id: 'idle-keep', label: 'Count it as work' },
      ],
      longDuration: true,
    });
  }

  goalReached({ goal, focusText }) {
    return this.show({
      title: '🎯 Daily goal reached',
      body: `${goal} pomodoros and ${focusText} of focus today. Anything more is a bonus.`,
    });
  }
}

module.exports = { Notifier };
