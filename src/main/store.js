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
