'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, PHASE } = require('../shared/constants');
const { dayKey } = require('../shared/format');

/**
 * Store — a small JSON-file database in the user's app-data folder.
 *
 * Writes go through a temp file and a rename so a crash or a power cut can
 * never leave a half-written file behind, and every write is debounced so a
 * per-second timer does not hammer the disk.
 */
class Store {
  constructor(dir, { debounceMs = 800 } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'pomora-data.json');
    this.debounceMs = debounceMs;
    this._timer = null;
    this.data = this._load();
  }

  /**
   * The app was called "Pomora" up to v1.0; renaming it moves the app-data
   * folder, which would look like losing every statistic. If the new folder is
   * empty and the old one is not, carry the history over once.
   */
  static migrateLegacyFolder(newDir) {
    try {
      const target = path.join(newDir, 'pomora-data.json');
      if (fs.existsSync(target)) return false;
      const legacy = path.join(path.dirname(newDir), 'Pomora', 'pomora-data.json');
      if (!fs.existsSync(legacy)) return false;
      fs.mkdirSync(newDir, { recursive: true });
      fs.copyFileSync(legacy, target);
      return true;
    } catch (err) {
      console.error('[ferna-pomoro] could not carry over previous data:', err.message);
      return false;
    }
  }

  _defaults() {
    return {
      version: 2,
      settings: { ...DEFAULT_SETTINGS },
      tasks: [],
      sessions: [], // append-only log of phases
      days: {}, // dayKey -> aggregates
      cycle: { count: 0, day: dayKey() },
      meta: { createdAt: Date.now(), lastOpenedAt: Date.now() },
    };
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const base = this._defaults();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
        cycle: parsed.cycle || base.cycle,
      };
    } catch {
      return this._defaults();
    }
  }

  save({ immediate = false } = {}) {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const write = () => {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
      } catch (err) {
        console.error('[pomora] could not save data:', err.message);
      }
    };
    if (immediate) write();
    else {
      this._timer = setTimeout(write, this.debounceMs);
      if (this._timer.unref) this._timer.unref();
    }
  }

  // ---------------------------------------------------------------- settings

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  resetSettings() {
    this.data.settings = { ...DEFAULT_SETTINGS };
    this.save({ immediate: true });
    return this.data.settings;
  }

  // ------------------------------------------------------------------- cycle

  getCycleCount() {
    // The long-break counter restarts with each new day.
    if (this.data.cycle.day !== dayKey()) this.data.cycle = { count: 0, day: dayKey() };
    return this.data.cycle.count;
  }

  setCycleCount(count) {
    this.data.cycle = { count, day: dayKey() };
    this.save();
  }

  // ------------------------------------------------------------------- tasks

  addTask({ title, estimate = 1, note = '' }) {
    const task = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: String(title || '').slice(0, 200),
      note: String(note || '').slice(0, 2000),
      estimate: Math.max(0, Math.min(99, Number(estimate) || 0)),
      done: 0, // pomodoros completed
      completed: false,
      createdAt: Date.now(),
      completedAt: null,
      focusMs: 0,
    };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  updateTask(id, patch) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return null;
    Object.assign(task, patch);
    if (patch.completed === true && !task.completedAt) task.completedAt = Date.now();
    if (patch.completed === false) task.completedAt = null;
    this.save();
    return task;
  }

  deleteTask(id) {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.save();
  }

  clearCompletedTasks() {
    this.data.tasks = this.data.tasks.filter((t) => !t.completed);
    this.save();
  }

  reorderTasks(ids) {
    const byId = new Map(this.data.tasks.map((t) => [t.id, t]));
    const next = [];
    ids.forEach((id) => {
      if (byId.has(id)) {
        next.push(byId.get(id));
        byId.delete(id);
      }
    });
    this.data.tasks = next.concat([...byId.values()]);
    this.save();
  }

  // ---------------------------------------------------------------- sessions

  static emptyDay() {
    return {
      focusMs: 0,
      breakMs: 0,
      pomodoros: 0,
      idleRemovedMs: 0,
      interruptions: 0,
      overtimeMs: 0,
      manualMs: 0,
    };
  }

  /**
   * Focus time the user did away from the app — a session they forgot to
   * start, or work done on paper. It is back-dated to the day it happened and
   * marked `manual`, so the statistics stay honest about where the number came
   * from and the entry can be removed again if it was a mistake.
   */
  addManualSession({ startedAt, workedMs, pomodoros = 0, taskId = null, note = '' }) {
    const start = Number(startedAt) || Date.now();
    const worked = Math.max(60 * 1000, Math.min(16 * 3600 * 1000, Number(workedMs) || 0));
    return this.logSession({
      type: 'manual',
      phase: 'work',
      startedAt: start,
      endedAt: start + worked,
      plannedMs: worked,
      workedMs: worked,
      idleRemovedMs: 0,
      reason: 'manual',
      completed: true,
      pomodoros: Math.max(0, Math.min(50, Math.round(Number(pomodoros) || 0))),
      taskId,
      note: String(note || '').slice(0, 300),
    });
  }

  /** Remove a logged session and unwind everything it contributed. */
  deleteSession(id) {
    const index = this.data.sessions.findIndex((s) => s.id === id);
    if (index === -1) return false;
    const entry = this.data.sessions[index];
    const key = dayKey(entry.endedAt || Date.now());
    const day = this.data.days[key];

    if (day) {
      if (entry.type === 'overtime') {
        day.focusMs -= entry.workedMs;
        day.overtimeMs = (day.overtimeMs || 0) - entry.workedMs;
      } else if (entry.type === 'manual') {
        day.focusMs -= entry.workedMs;
        day.manualMs = (day.manualMs || 0) - entry.workedMs;
        day.pomodoros -= entry.pomodoros || 0;
      } else if (entry.phase === 'work') {
        day.focusMs -= entry.workedMs;
        day.idleRemovedMs -= entry.idleRemovedMs || 0;
        if (entry.completed) day.pomodoros -= 1;
        else day.interruptions -= 1;
      } else {
        day.breakMs -= entry.workedMs;
      }
      Object.keys(day).forEach((k) => {
        if (day[k] < 0) day[k] = 0;
      });
    }

    if (entry.taskId) {
      const task = this.data.tasks.find((t) => t.id === entry.taskId);
      if (task) {
        task.focusMs = Math.max(0, (task.focusMs || 0) - entry.workedMs);
        const credited =
          entry.type === 'manual' ? entry.pomodoros || 0 : entry.completed && entry.type === 'phase' ? 1 : 0;
        task.done = Math.max(0, (task.done || 0) - credited);
      }
    }

    this.data.sessions.splice(index, 1);
    this.save();
    return true;
  }

  /** Record a finished phase and fold it into the day's aggregates. */
  logSession(entry) {
    const record = { ...entry, id: `s${Date.now().toString(36)}${this.data.sessions.length}` };
    this.data.sessions.push(record);
    // Keep the log bounded; a year of heavy use is roughly 10k rows.
    if (this.data.sessions.length > 20000) {
      this.data.sessions = this.data.sessions.slice(-15000);
    }

    const key = dayKey(entry.endedAt || Date.now());
    const day = { ...Store.emptyDay(), ...(this.data.days[key] || {}) };

    if (entry.type === 'overtime') {
      day.focusMs += entry.workedMs;
      day.overtimeMs += entry.workedMs;
    } else if (entry.type === 'manual') {
      day.focusMs += entry.workedMs;
      day.manualMs += entry.workedMs;
      day.pomodoros += entry.pomodoros || 0;
    } else if (entry.phase === 'work') {
      day.focusMs += entry.workedMs;
      day.idleRemovedMs += entry.idleRemovedMs || 0;
      if (entry.completed) day.pomodoros += 1;
      else day.interruptions += 1;
    } else {
      day.breakMs += entry.workedMs;
    }

    this.data.days[key] = day;

    if (entry.taskId && (entry.phase === 'work' || entry.type === 'overtime')) {
      const task = this.data.tasks.find((t) => t.id === entry.taskId);
      if (task) {
        task.focusMs = (task.focusMs || 0) + entry.workedMs;
        if (entry.type === 'manual') task.done = (task.done || 0) + (entry.pomodoros || 0);
        else if (entry.completed && entry.type !== 'overtime') task.done = (task.done || 0) + 1;
      }
    }

    this.save();
    return record;
  }

  today() {
    return { ...Store.emptyDay(), ...(this.data.days[dayKey()] || {}) };
  }

  /** Aggregates for the last `n` days, oldest first, with gaps filled in. */
  recentDays(n = 14) {
    const out = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dayKey(d.getTime());
      out.push({ day: key, ...Store.emptyDay(), ...(this.data.days[key] || {}) });
    }
    return out;
  }

  /** Consecutive days up to today with at least one completed pomodoro. */
  streak() {
    let streak = 0;
    const d = new Date();
    for (;;) {
      const key = dayKey(d.getTime());
      const day = this.data.days[key];
      if (day && day.pomodoros > 0) {
        streak += 1;
      } else if (streak > 0 || key !== dayKey()) {
        break;
      }
      d.setDate(d.getDate() - 1);
      if (streak > 3650) break;
    }
    return streak;
  }

  sessionsForDay(key = dayKey()) {
    return this.data.sessions.filter((s) => dayKey(s.endedAt) === key);
  }

  /**
   * Everything the statistics pane shows for one day: the stored aggregates
   * plus what can only be worked out from that day's sessions — how many
   * breaks were actually taken, when the day started and ended, and where the
   * focus time went.
   */
  dayDetail(key = dayKey()) {
    const totals = { ...Store.emptyDay(), ...(this.data.days[key] || {}) };
    const sessions = this.sessionsForDay(key);
    const perTask = new Map();
    const counts = {
      focusSessions: 0, // timed work sessions, completed or not
      completedFocus: 0,
      breaks: 0,
      shortBreaks: 0,
      longBreaks: 0,
      manualEntries: 0,
      endedWhileAway: 0,
    };
    let longestFocusMs = 0;
    let firstAt = null;
    let lastAt = null;

    for (const s of sessions) {
      if (s.startedAt && (firstAt === null || s.startedAt < firstAt)) firstAt = s.startedAt;
      if (s.endedAt && (lastAt === null || s.endedAt > lastAt)) lastAt = s.endedAt;

      if (s.type === 'manual') counts.manualEntries += 1;
      if (s.phase === PHASE.WORK || s.type === 'manual' || s.type === 'overtime') {
        if (s.type !== 'overtime') counts.focusSessions += 1;
        if (s.completed && s.type !== 'manual') counts.completedFocus += 1;
        if (s.reason === 'idle-cut') counts.endedWhileAway += 1;
        longestFocusMs = Math.max(longestFocusMs, s.workedMs || 0);
        if (s.taskId) perTask.set(s.taskId, (perTask.get(s.taskId) || 0) + (s.workedMs || 0));
      } else if (s.phase === PHASE.SHORT_BREAK || s.phase === PHASE.LONG_BREAK) {
        counts.breaks += 1;
        if (s.phase === PHASE.LONG_BREAK) counts.longBreaks += 1;
        else counts.shortBreaks += 1;
      }
    }

    const tasks = [...perTask.entries()]
      .map(([id, focusMs]) => {
        const task = this.data.tasks.find((t) => t.id === id);
        return { id, title: task ? task.title : 'Deleted task', focusMs };
      })
      .sort((a, b) => b.focusMs - a.focusMs);

    return {
      day: key,
      isToday: key === dayKey(),
      totals,
      counts,
      longestFocusMs,
      averageFocusMs: counts.focusSessions ? Math.round(totals.focusMs / counts.focusSessions) : 0,
      firstAt,
      lastAt,
      spanMs: firstAt !== null && lastAt !== null ? Math.max(0, lastAt - firstAt) : 0,
      tasks,
      sessions: sessions.slice().sort((a, b) => b.startedAt - a.startedAt),
    };
  }

  // ----------------------------------------------------------------- backup

  /**
   * Everything worth keeping, in one plain-JSON object: settings, tasks, the
   * session log and the daily aggregates. Written to a file the user keeps, so
   * a new machine (or a reinstall after wiping the app-data folder) can carry
   * on where the old one left off.
   */
  exportBackup({ appVersion = '' } = {}) {
    return {
      app: 'ferna-pomoro',
      kind: 'backup',
      formatVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      dataVersion: this.data.version,
      settings: { ...this.data.settings },
      tasks: this.data.tasks.map((t) => ({ ...t })),
      sessions: this.data.sessions.map((x) => ({ ...x })),
      days: JSON.parse(JSON.stringify(this.data.days)),
      cycle: { ...this.data.cycle },
    };
  }

  /** What a backup file holds, without changing anything. */
  static describeBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'That file is not a Ferna Pomoro backup.' };
    }
    const looksRight =
      data.app === 'ferna-pomoro' ||
      (data.settings && typeof data.settings === 'object' && data.days && typeof data.days === 'object');
    if (!looksRight) {
      return { ok: false, error: 'That file is not a Ferna Pomoro backup.' };
    }
    const days = data.days && typeof data.days === 'object' ? Object.keys(data.days) : [];
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const focusMs = days.reduce((sum, k) => sum + ((data.days[k] || {}).focusMs || 0), 0);
    const pomodoros = days.reduce((sum, k) => sum + ((data.days[k] || {}).pomodoros || 0), 0);
    return {
      ok: true,
      appVersion: data.appVersion || '',
      exportedAt: data.exportedAt || '',
      days: days.length,
      firstDay: days.sort()[0] || '',
      lastDay: days.sort()[days.length - 1] || '',
      sessions: sessions.length,
      tasks: tasks.length,
      focusMs,
      pomodoros,
      hasSettings: !!(data.settings && typeof data.settings === 'object'),
    };
  }

  /**
   * Put a backup back.
   *
   *   replace — settings, tasks and the whole history become the file's
   *   merge   — days, sessions and tasks the machine does not already have are
   *             added, current settings are left alone. Where a day exists on
   *             both sides the one with more recorded focus wins, because a
   *             day cannot be added up twice without inventing time.
   */
  importBackup(data, { mode = 'merge' } = {}) {
    const info = Store.describeBackup(data);
    if (!info.ok) return info;

    const days = data.days && typeof data.days === 'object' ? data.days : {};
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const summary = { ok: true, mode, daysAdded: 0, daysReplaced: 0, daysKept: 0, sessionsAdded: 0, tasksAdded: 0, settingsRestored: false };

    if (mode === 'replace') {
      summary.daysAdded = Object.keys(days).length;
      summary.sessionsAdded = sessions.length;
      summary.tasksAdded = tasks.length;
      this.data.days = JSON.parse(JSON.stringify(days));
      this.data.sessions = sessions.map((x) => ({ ...x }));
      this.data.tasks = tasks.map((t) => ({ ...t }));
      if (data.cycle && typeof data.cycle === 'object') this.data.cycle = { ...data.cycle };
      if (info.hasSettings) {
        this.data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        summary.settingsRestored = true;
      }
      this.save({ immediate: true });
      return summary;
    }

    for (const [key, day] of Object.entries(days)) {
      const mine = this.data.days[key];
      if (!mine) {
        this.data.days[key] = { ...Store.emptyDay(), ...day };
        summary.daysAdded += 1;
      } else if ((day.focusMs || 0) > (mine.focusMs || 0)) {
        this.data.days[key] = { ...Store.emptyDay(), ...day };
        summary.daysReplaced += 1;
      } else {
        summary.daysKept += 1;
      }
    }

    const seen = new Set(this.data.sessions.map((x) => x.id));
    for (const entry of sessions) {
      if (!entry || !entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      this.data.sessions.push({ ...entry });
      summary.sessionsAdded += 1;
    }
    this.data.sessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

    const haveTask = new Set(this.data.tasks.map((t) => t.id));
    const haveTitle = new Set(this.data.tasks.map((t) => String(t.title).toLowerCase()));
    for (const task of tasks) {
      if (!task || haveTask.has(task.id) || haveTitle.has(String(task.title).toLowerCase())) continue;
      haveTask.add(task.id);
      haveTitle.add(String(task.title).toLowerCase());
      this.data.tasks.push({ ...task });
      summary.tasksAdded += 1;
    }

    this.save({ immediate: true });
    return summary;
  }

  exportCsv() {
    const head =
      'started_at,ended_at,type,phase,planned_minutes,worked_minutes,idle_removed_minutes,completed,reason,task,note\n';
    const min = (ms) => (ms / 60000).toFixed(2);
    const taskTitle = (id) => {
      const t = this.data.tasks.find((x) => x.id === id);
      return t ? `"${t.title.replace(/"/g, '""')}"` : '';
    };
    const rows = this.data.sessions.map((s) =>
      [
        new Date(s.startedAt).toISOString(),
        new Date(s.endedAt).toISOString(),
        s.type,
        s.phase,
        min(s.plannedMs || 0),
        min(s.workedMs || 0),
        min(s.idleRemovedMs || 0),
        s.completed ? 'yes' : 'no',
        s.reason,
        taskTitle(s.taskId),
        s.note ? `"${String(s.note).replace(/"/g, '""')}"` : '',
      ].join(',')
    );
    return head + rows.join('\n') + '\n';
  }
}

module.exports = { Store };
