<div align="center">

<img src="assets/icons/pomora-128.png" width="96" alt="Ferna Pomoro" />

# Ferna Pomoro

**A Pomodoro timer for Windows that refuses to count time you weren't there.**

[![Tests](https://github.com/tgi25/ferna-pomoro/actions/workflows/ci.yml/badge.svg)](https://github.com/tgi25/ferna-pomoro/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/tgi25/ferna-pomoro?label=download)](https://github.com/tgi25/ferna-pomoro/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[**Download for Windows**](https://github.com/tgi25/ferna-pomoro/releases/latest) · [What it does](#what-it-does) · [Build from source](#running-from-source)

</div>

---

Ferna Pomoro watches Windows' idle counter. The moment you stop touching the
keyboard and mouse, it rewinds your focus clock back to your last keystroke and
freezes it there. When you come back it asks what that gap was — and whichever
answer you give, the numbers in your statistics are true.

<div align="center">

<img src="docs/idle-demo.gif" width="720" alt="The timer freezes when you walk away, then asks what the gap was" />

</div>

[**▶ Watch the 70-second demo**](docs/demo.mp4?raw=1) — the whole idea in one video.

![Timer](docs/shots/01-timer.png)

---

## Installing

Download **`Ferna-Pomoro-Setup-<version>.exe`** from the
[latest release](https://github.com/tgi25/ferna-pomoro/releases/latest) and run
it. It installs per-user, so it needs no administrator rights, and it offers to
put Ferna Pomoro in the Start menu and on the desktop.
`Ferna-Pomoro-Portable-<version>.exe` runs from a folder or a USB stick without
installing anything. Windows 10 or 11, 64-bit.

Every release also carries `SHA256SUMS.txt`. To check a download:

```powershell
Get-FileHash .\Ferna-Pomoro-Setup-1.1.1.exe -Algorithm SHA256
```

The installer is not code-signed — a certificate costs more than this project
does — so SmartScreen shows "Windows protected your PC" the first time. Choose
**More info → Run anyway**. The installers are built by
[GitHub Actions](.github/workflows/release.yml) straight from this repository,
so you can see exactly what went into them.

Upgrading from 1.0 ("Pomora"): install this alongside it and your statistics,
tasks and settings are carried over automatically on first launch. The old entry
can then be uninstalled from Apps & features.

Your data lives in `%APPDATA%\Ferna Pomoro\pomora-data.json` and survives
upgrades. Uninstalling leaves it in place; delete the folder to remove it.

---

## What it does

### The Pomodoro cycle

Focus 25 / short break 5 / long break 15 after every 4 pomodoros — all
adjustable. Breaks can start automatically while the next focus session waits
for you to say go (the default), or the other way round, or neither.

When a focus session ends and auto-start is off, the clock keeps counting **up**
in overtime rather than sitting at zero: if you were mid-thought at the bell,
that extra work is recorded too, as a separate overtime entry.

### Idle detection, and taking the idle time back out

This is the part worth reading.

While a **focus** session runs, Ferna Pomoro polls the system idle time once a second.
Cross the threshold (5 minutes by default) and it:

1. rewinds the focus clock by exactly the time since your last input, and
2. pauses the session at that instant.

So the clock stops at your last keystroke, not at the moment of detection, and
nothing accrues while you are gone. A session can never complete, and a break
can never auto-start, while nobody is at the machine.

When you touch the keyboard again, you get the question:

![Idle prompt](docs/shots/07-idle.png)

| Choice | Effect |
| --- | --- |
| **Remove the idle time and carry on** | The pomodoro resumes exactly where you left it. |
| **Count it as work** | The gap is added back — for reading, thinking or a phone call away from the desk. |
| **End the pomodoro where I left** | Logs the focus time up to your departure and stops, with the session marked *ended while away*. |
| **End it and start a break** | Treats the gap as the start of a break. |
| **Leave it paused** | Stays frozen until you say go. |

Tick *Always do this without asking* and the answer becomes the default; you can
also pick the policy up front in Settings (ask / remove silently / always count
as work / end the pomodoro).

**Sleep, hibernation and locking are covered too.** Ferna Pomoro watches for gaps
between its own ticks, so if the laptop lid closes for three hours, that gap is
treated as away-time — the same freeze, the same question on return. It does not
rely on the app being awake.

### Focus time you forgot to track

The timer only knows about sessions you started. For the ones you did not —
marking scripts at the kitchen table, an hour of reading before you opened the
laptop — **Statistics → Forgot to start the timer?** takes the date, the start
time, the length, how many pomodoros to credit, an optional task and a note.

Two things make this trustworthy rather than a way to fool yourself:

- The entry is **back-dated to the day it happened**, so a Tuesday session you
  remember on Thursday lands on Tuesday's bar in the chart, not Thursday's.
- It is stored and shown as **manual**, distinct from timed work, with its own
  "added by hand today" figure and its own tag in the session log and the CSV.
  Nothing pretends a hand-typed hour is the same as a measured one.

Every row in the session log — manual or timed — has a ✕ that removes it and
unwinds everything it contributed: the day's focus time, the pomodoro count, the
task's total. Mistyped entries do not have to live in your history.

### Alerts

Four distinct toasts, each with its own synthesised chime:

| Alert | When | Buttons on the toast |
| --- | --- | --- |
| **Work Alert** 🍅 | a focus session begins | Pause · Skip |
| **Short Break Alert** ☕ | a pomodoro ends, short break next | Start break · +5 min work · Skip |
| **Long Break Alert** 🌿 | the long break is due | Start long break · Skip |
| **Back to work** ⏰ | a break has run out | Start focus · +5 min break |

And the one that most apps miss: **when you actually start working again after a
break**, Ferna Pomoro says so (▶️ *Back at it — focus started*) — a separate alert from
the break-over nudge, because the two are different moments.

If the break runs out while you are away from the desk, the back-to-work nudge
does not fire into an empty room. It waits, and greets you when you return
(👋 *Welcome back*) — or, if auto-start is on, starts the next focus session at
the moment you sit down rather than ten minutes earlier.

Sounds are generated from scratch by `tools/make-assets.py`: a rising fifth for
work, a soft falling third for short breaks, three warm descending tones for the
long one, a lifting arpeggio for back-to-work. Volume is adjustable, and there is
an optional ticking clock.

### The taskbar tells you how long you have worked

Four indicators, all live:

- **The taskbar button fills** with the progress of the current session — green
  while focusing, yellow while paused or on a break, red when in overtime.
- **A badge on the corner of the button** carries today's work. It shows the
  pomodoro count by default, ringed by the progress of the one in flight; you
  can switch it to *time worked today* (`2h`) or *minutes left in this session*.
- **Hovering the taskbar button** gives the full line: `Focus: 17:42 left ·
  Focused 2h 39m today · 6 pomodoros · 17m idle removed`, and the thumbnail
  preview gets **start/pause, skip and stop buttons** you can press without
  opening the window.
- **The window title counts down** (`17:42 · Focus — Ferna Pomoro`), so the time is
  readable from the taskbar and from Alt-Tab.

The tray icon is drawn live too: a tomato-red ring that empties as the session
runs, with the minutes left in the middle, and today's totals in its tooltip.

### The break window, on your terms

The break window covers the screen so a break is actually a break. Three
separate switches in Settings decide how firmly:

| Setting | What it does |
| --- | --- |
| **Show the full-screen break window** | Off means breaks pass quietly, with only the alert and the taskbar. |
| **Let me close it and keep the break running** | Adds **Close this window** (and Esc). The window goes away, **the break carries on** — the tray, taskbar and mini timer keep counting it down, and the break still ends when it ends. Use it when something behind the curtain needs a glance. |
| **Let me end the break early from it** | Adds **Back to work now**, which does end the break and start the next focus session. |

The two are deliberately different actions: closing the window is not skipping
the break. Once closed, **Show break screen** appears on the Timer pane and in
the tray menu to bring it back, and if the break ends while the window is closed
you still get told, so work never resumes silently.

### Tasks, statistics, and the rest

- **Tasks** with estimated pomodoros; the selected task collects the focus time
  and pomodoro count of every session you run against it.
- **Statistics**: today's focus time, pomodoros, idle removed and interruptions;
  a 14-day chart; a day-streak counter; a log of today's sessions showing
  exactly which ones ended while you were away — and **CSV export** of the whole
  history.
- **Full-screen break window** across every monitor, with a rotating suggestion
  (*look 20 feet away for 20 seconds*) — see below.
- **Mini timer**: a small always-on-top clock you can park in a corner.
- **Global shortcuts**: `Ctrl+Alt+P` start/pause, `Ctrl+Alt+S` skip,
  `Ctrl+Alt+M` mini timer.
- Minimise/close to tray, start with Windows, daily goal with its own alert.

![Statistics](docs/shots/03-stats.png)

---

## Running from source

```bash
npm install
npm start          # run the app
npm test           # 39 unit tests: engine, idle watcher, store
npm run dist       # build the Windows installer (needs Wine on Linux)
python3 tools/make-assets.py   # regenerate sounds and icons
```

`npx electron . --selftest` drives the whole app inside Electron — windows, the
canvas-drawn taskbar images, the full idle freeze/return path, the break-window
dismissal, manual time entry and the IPC surface — 43 checks, ending in a
pass/fail summary. `--screenshots` writes `docs/shots/`.

### How it is laid out

```
src/
  shared/      constants and time formatting, used by both processes
  main/
    engine.js        the timer state machine — pure, no Electron, fully tested
    idle-watcher.js  turns idle-second readings into away-episodes
    store.js         atomic JSON persistence, daily aggregates, CSV export
    taskbar.js       progress bar, overlay badge, thumbnail toolbar, title
    image-factory.js draws the badge/tray/glyph PNGs at runtime
    notifier.js      Windows toasts with action buttons
    windows.js       window construction
    main.js          wiring: events, IPC, tray, idle policy, power events
  preload/     the only bridge to the UI (contextIsolation, sandboxed)
  renderer/    timer, tasks, stats, settings, mini, break curtain, idle prompt
```

Two design decisions carry most of the reliability:

**The clock is computed from wall time, never accumulated from ticks.** Elapsed
time is `accumulated + (now - startedAt)`, so a throttled, delayed or skipped
tick cannot make the timer drift. When a phase completes, the end is anchored to
the moment it *should* have ended, so a late tick does not steal seconds from
the next phase.

**The engine knows nothing about Electron.** It takes a clock function, so the
tests run a 4-hour work day in milliseconds, including the awkward paths: a
pomodoro frozen overnight, idle removed past zero, overtime frozen while away.

---

## Releasing

Tag and push; the Windows installer builds on GitHub's runners and attaches
itself to the release:

```bash
npm version patch          # or minor / major — updates package.json
git push && git push --tags
```

The workflow runs the test suite first, so a tag that fails the tests never
produces an installer.

## Contributing

Issues and pull requests are welcome. The engine is covered by unit tests
(`npm test`); anything that touches timing should come with one, because the
whole point of this app is that its numbers can be trusted.

## Credits

Ideas borrowed, and where from: the idle question is Toggl Track's, applied to a
pomodoro instead of a time entry; the break curtain is Stretchly's; overtime
after the bell is Pomotodo's; task-linked pomodoro counts are Focus To-Do's;
the taskbar progress bar is what Windows has always offered and few apps use.

MIT licensed. Built for TGI Fernando.

## Changelog

**1.1.0**
- Renamed to Ferna Pomoro, with the new cat icon; data from Pomora 1.0 is
  carried over on first run.
- Manual focus-time entry, back-dated, marked `manual`, with per-entry deletion
  that unwinds the statistics correctly.
- The break window can be closed without ending the break, reopened from the
  Timer pane or the tray, and each of its two exits is its own setting.

**1.0.0** — first release.
