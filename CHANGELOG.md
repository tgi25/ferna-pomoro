# Changelog

All notable changes to Ferna Pomoro are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

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
