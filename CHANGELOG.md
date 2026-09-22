# Changelog

All notable changes to Ferna Pomoro are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-09-22

### Added
- **Minutes left on the taskbar button.** The button's own icon becomes a cat face
  in the phase colour (red focus, green short break, blue long break, amber
  paused) with the minutes left in large white digits, and a ✓ when the session
  is done. At 24–32 px it is the largest number Windows lets an app show on the
  taskbar. The normal app icon comes back when nothing is running.
- Settings → Taskbar & tray: **Show the minutes left on the taskbar button**, and
  **Icon shape**: Cat face or Circle.

### Changed
- The tray icon is a cat face with larger digits instead of a ringed circle.
  Progress is shown by the face darkening from the top. The circle is still
  available in Settings.
- While the button icon shows the time, the corner badge is hidden so it doesn't
  cover the digits. It returns when nothing is running or the countdown is off.

## [1.3.0] — 2026-09-22

### Added
- **"Time to start work" window.** When the computer is switched on, wakes from
  sleep, or Ferna Pomoro is opened, and nothing has started after a set time
  (default 5 minutes), a full-screen window like the break window appears. It
  shows **Start focus now**, **Remind me in N min** (or Esc) and **Not today**. It
  waits while you are away. It needs the app to start with Windows, and Settings
  offers a one-click switch for that.
- **"Session complete" window.** At the end of every focus session and break, a
  full-screen window shows what finished and today's progress. It offers the next
  step, the alternative (another focus session instead of the break, or five more
  minutes of break) and **Close**, which leaves the timer waiting. It shows the
  overtime still counting after a focus session. If the next phase starts by
  itself, the break window carries a "✓ Focus session complete" line, or this
  window says what has started and offers the way back.
- **Settings → Reminder windows** gathers all three full-screen reminders, each
  with its own switch, its delay and a preview button.

## [1.2.0] — 2026-09-21

### Added
- **"You haven't started work yet" reminder.** When a break ends and the next
  focus session still hasn't started after a set time, a full-screen window
  like the break window appears on every monitor. It counts up the time since the
  break ended, with **Start focus now**, **Remind me in N min** (or Esc) and
  **Stop the timer**. It waits while you are away from the computer or the
  machine is asleep, and counts the delay again from your return.
- Settings → **After a break**: turn the reminder on or off, choose the delay
  (1–120 minutes, default 5), and preview it.
- The Timer pane shows how long ago the break ended while focus waits.

### Fixed
- "+5 min break" on the break-over alert did nothing, because the break had
  already ended. It now starts a five-minute break.
- The Timer pane no longer offers "Show break screen" after the break has ended.
- A finished break no longer shows as `+00:00` overtime. Only focus sessions
  count overtime.
- The startup setting now says "Ferna Pomoro" instead of the old name.

## [1.1.1] — 2026-09-18

### Fixed
- "Idle removed" now reports the whole time you were away, not only the minutes
  the timer had to rewind. A 23-minute absence used to appear as 5.

## [1.1.0] — 2026-09-18

### Added
- Manual focus-time entry: record sessions you forgot to time, back-dated to the
  day they happened and marked `manual` so they are never confused with timed
  work. Any logged session can be deleted, and the statistics unwind correctly.
- The break window can be closed without ending the break. Closing it and
  skipping the break are now separate actions with separate settings, and the
  window can be reopened from the Timer pane or the tray.
- A reminder when a break ends while the break window is closed.

### Changed
- Renamed from Pomora to **Ferna Pomoro**, with a new icon. Statistics, tasks
  and settings are carried over from a 1.0 installation on first launch.

## [1.0.0] — 2026-09-18

First release.

- Pomodoro cycle with configurable durations, auto-start and overtime.
- Idle detection: the focus clock rewinds to your last keystroke and freezes,
  and on return you choose what happens to the gap. Sleep and hibernation are
  covered by the same mechanism.
- Work, short-break, long-break and back-to-work alerts with action buttons and
  synthesised chimes.
- Taskbar progress, an overlay badge carrying today's work, a thumbnail toolbar
  and a live tray icon.
- Tasks with pomodoro estimates, statistics with a 14-day chart, CSV export,
  full-screen break window, mini timer and global shortcuts.
