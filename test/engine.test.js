'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PomodoroEngine } = require('../src/main/engine');
const { PHASE, STATUS, END_REASON, MINUTE } = require('../src/shared/constants');

/** A controllable clock, so a 25-minute session takes no real time. */
function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
      return t;
    },
    set: (v) => {
      t = v;
    },
  };
}

function makeEngine(settings = {}) {
  const clock = makeClock();
  const engine = new PomodoroEngine(
    { workMs: 25 * MINUTE, shortBreakMs: 5 * MINUTE, longBreakMs: 15 * MINUTE, ...settings },
    clock.now
  );
  const logged = [];
  engine.on('session-logged', (e) => logged.push(e));
  return { engine, clock, logged };
}

test('counts down and completes exactly at the target', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(10 * MINUTE);
  engine.tick();
  assert.equal(engine.status, STATUS.RUNNING);
  assert.equal(engine.remainingMs(), 15 * MINUTE);

  clock.advance(15 * MINUTE);
  engine.tick();
  assert.equal(engine.phase, PHASE.SHORT_BREAK, 'auto-starts the break');
});

test('a late tick does not steal time from the next phase', () => {
  const { engine, clock } = makeEngine({ autoStartBreaks: true });
  engine.startPhase(PHASE.WORK);
  // The tick arrives 7 seconds after the work phase should have ended.
  clock.advance(25 * MINUTE + 7000);
  engine.tick();
  assert.equal(engine.phase, PHASE.SHORT_BREAK);
  // The break started at the boundary, so 7s of it have already elapsed.
  assert.equal(Math.round(engine.elapsedMs() / 1000), 7);
});

test('pause and resume neither lose nor gain time', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(4 * MINUTE);
  engine.pause();
  clock.advance(60 * MINUTE); // a long interruption
  assert.equal(engine.elapsedMs(), 4 * MINUTE, 'frozen while paused');
  engine.resume();
  clock.advance(MINUTE);
  assert.equal(engine.elapsedMs(), 5 * MINUTE);
  assert.equal(engine.remainingMs(), 20 * MINUTE);
});

test('removing idle time rewinds the clock and is capped at zero', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(12 * MINUTE);
  const removed = engine.removeIdle(5 * MINUTE);
  assert.equal(removed, 5 * MINUTE);
  assert.equal(engine.elapsedMs(), 7 * MINUTE);
  assert.equal(engine.idleRemovedMs, 5 * MINUTE);

  // Time keeps flowing correctly after a rewind.
  clock.advance(MINUTE);
  assert.equal(engine.elapsedMs(), 8 * MINUTE);

  // Over-removal clamps rather than going negative.
  const second = engine.removeIdle(60 * MINUTE);
  assert.equal(second, 8 * MINUTE);
  assert.equal(engine.elapsedMs(), 0);
});

test('idle time can be given back as work', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(10 * MINUTE);
  engine.removeIdle(6 * MINUTE);
  assert.equal(engine.elapsedMs(), 4 * MINUTE);
  engine.addTime(6 * MINUTE);
  assert.equal(engine.elapsedMs(), 10 * MINUTE);
  assert.equal(engine.idleRemovedMs, 0, 'the removal is undone in the stats too');
});

test('the freeze-then-resume flow leaves a pomodoro exactly as it was', () => {
  // This is what happens when the user walks away: the engine rewinds to the
  // moment of the last keystroke and pauses there.
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(8 * MINUTE); // worked
  const awayStart = clock.now();
  clock.advance(45 * MINUTE); // away, detected late by the watcher

  engine.removeIdle(clock.now() - awayStart);
  engine.pause();
  assert.equal(engine.elapsedMs(), 8 * MINUTE);

  clock.advance(10 * MINUTE); // still away, nothing accrues
  engine.resume();
  clock.advance(2 * MINUTE);
  assert.equal(engine.elapsedMs(), 10 * MINUTE);
  assert.equal(engine.remainingMs(), 15 * MINUTE);
});

test('a phase cannot complete while the clock is frozen', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(20 * MINUTE);
  engine.removeIdle(20 * MINUTE); // walked away right at the start
  engine.pause();
  clock.advance(8 * 60 * MINUTE); // overnight
  engine.tick();
  assert.equal(engine.phase, PHASE.WORK);
  assert.equal(engine.status, STATUS.PAUSED);
});

test('long break arrives on the configured interval', () => {
  const { engine, clock } = makeEngine({
    longBreakInterval: 4,
    autoStartBreaks: true,
    autoStartWork: true,
  });
  engine.startPhase(PHASE.WORK);

  for (let i = 1; i <= 4; i += 1) {
    clock.advance(25 * MINUTE);
    engine.tick(); // work ends, a break auto-starts
    if (i < 4) {
      assert.equal(engine.phase, PHASE.SHORT_BREAK, `pomodoro ${i} leads to a short break`);
      clock.advance(5 * MINUTE);
    } else {
      assert.equal(engine.phase, PHASE.LONG_BREAK, 'the fourth leads to the long break');
      clock.advance(15 * MINUTE);
    }
    engine.tick(); // break ends, work auto-starts again
    assert.equal(engine.phase, PHASE.WORK);
  }
  assert.equal(engine.completedWorkInCycle, 4);

  // The fifth pomodoro starts a fresh cycle.
  clock.advance(25 * MINUTE);
  engine.tick();
  assert.equal(engine.phase, PHASE.SHORT_BREAK);
});

test('without auto-start the engine waits and counts overtime', () => {
  const { engine, clock, logged } = makeEngine({ autoStartBreaks: false, allowOvertime: true });
  engine.startPhase(PHASE.WORK);
  clock.advance(25 * MINUTE);
  engine.tick();

  assert.equal(engine.status, STATUS.AWAITING);
  assert.equal(engine.nextPhase, PHASE.SHORT_BREAK);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].completed, true);
  assert.equal(logged[0].workedMs, 25 * MINUTE);

  clock.advance(3 * MINUTE);
  assert.equal(engine.overtimeMs(), 3 * MINUTE);

  engine.acceptNext();
  assert.equal(engine.phase, PHASE.SHORT_BREAK);
  const overtime = logged.find((e) => e.type === 'overtime');
  assert.ok(overtime, 'overtime is logged separately');
  assert.equal(overtime.workedMs, 3 * MINUTE);
});

test('overtime can be frozen while the user is away', () => {
  const { engine, clock } = makeEngine({ autoStartBreaks: false, allowOvertime: true });
  engine.startPhase(PHASE.WORK);
  clock.advance(25 * MINUTE);
  engine.tick();
  clock.advance(2 * MINUTE);
  engine.freezeOvertime(clock.now());
  clock.advance(90 * MINUTE);
  assert.equal(engine.overtimeMs(), 2 * MINUTE, 'away time is not overtime');
  engine.unfreezeOvertime();
  clock.advance(MINUTE);
  assert.equal(engine.overtimeMs(), 3 * MINUTE);
});

test('ending at the moment the user left logs only the work actually done', () => {
  const { engine, clock, logged } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(9 * MINUTE);
  const awayStart = clock.now();
  clock.advance(30 * MINUTE);

  engine.cutAt(awayStart, clock.now());
  assert.equal(engine.phase, PHASE.IDLE);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].workedMs, 9 * MINUTE);
  assert.equal(logged[0].completed, false);
  assert.equal(logged[0].reason, END_REASON.IDLE_CUT);
  assert.equal(logged[0].idleRemovedMs, 30 * MINUTE);
});

test('skipping logs a partial session and moves on', () => {
  const { engine, clock, logged } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(6 * MINUTE);
  engine.skip();
  assert.equal(engine.phase, PHASE.SHORT_BREAK);
  assert.equal(logged[0].reason, END_REASON.SKIPPED);
  assert.equal(logged[0].workedMs, 6 * MINUTE);
  assert.equal(engine.completedWorkInCycle, 0, 'a skipped pomodoro does not count');
});

test('stopping in the first second logs nothing', () => {
  const { engine, clock, logged } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(400);
  engine.stop();
  assert.equal(logged.length, 0);
  assert.equal(engine.phase, PHASE.IDLE);
});

test('changing the duration mid-session applies immediately', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(5 * MINUTE);
  engine.updateSettings({ workMs: 30 * MINUTE });
  assert.equal(engine.remainingMs(), 25 * MINUTE);
});

test('extending adds to the phase in flight but not after the bell', () => {
  const { engine, clock } = makeEngine({ autoStartBreaks: false });
  engine.startPhase(PHASE.SHORT_BREAK);
  clock.advance(2 * MINUTE);
  assert.equal(engine.extend(5 * MINUTE), true);
  assert.equal(engine.remainingMs(), 8 * MINUTE);

  engine.startPhase(PHASE.WORK);
  clock.advance(25 * MINUTE);
  engine.tick();
  assert.equal(engine.extend(5 * MINUTE), false, 'a finished phase is already logged');
});

test('progress and snapshot stay inside sane bounds', () => {
  const { engine, clock } = makeEngine();
  const s0 = engine.snapshot();
  assert.equal(s0.progress, 0);
  assert.equal(s0.phase, PHASE.IDLE);

  engine.startPhase(PHASE.WORK);
  clock.advance(12.5 * MINUTE);
  const s1 = engine.snapshot();
  assert.equal(s1.progress, 0.5);
  assert.equal(s1.status, STATUS.RUNNING);
});

test('away time that never reached the clock is still tallied as removed', () => {
  // The watcher notices five minutes after the user left: those five minutes
  // are rewound off the clock, the remaining eighteen never counted at all,
  // and the statistic should report the whole twenty-three.
  const { engine, clock, logged } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(13 * MINUTE);

  const rewound = engine.removeIdle(5 * MINUTE);
  engine.pause();
  assert.equal(rewound, 5 * MINUTE);
  assert.equal(engine.elapsedMs(), 8 * MINUTE);

  engine.noteIdleExcluded(18 * MINUTE);
  assert.equal(engine.idleRemovedMs, 23 * MINUTE);
  assert.equal(engine.elapsedMs(), 8 * MINUTE, 'the tally does not move the clock');

  engine.resume();
  clock.advance(17 * MINUTE);
  engine.tick();
  assert.equal(logged[0].workedMs, 25 * MINUTE);
  assert.equal(logged[0].idleRemovedMs, 23 * MINUTE);
});

test('counting the idle as work takes it back out of the tally', () => {
  const { engine, clock } = makeEngine();
  engine.startPhase(PHASE.WORK);
  clock.advance(10 * MINUTE);
  engine.removeIdle(5 * MINUTE);
  engine.noteIdleExcluded(18 * MINUTE);
  engine.addTime(23 * MINUTE);
  assert.equal(engine.idleRemovedMs, 0);
  assert.equal(engine.elapsedMs(), 28 * MINUTE);
});

test('a waiting engine can start a different phase than the one scheduled', () => {
  const { engine, clock, logged } = makeEngine({ autoStartBreaks: false, allowOvertime: true });
  engine.startPhase(PHASE.WORK);
  clock.advance(25 * MINUTE);
  engine.tick();
  assert.equal(engine.nextPhase, PHASE.SHORT_BREAK);
  clock.advance(2 * MINUTE);
  engine.acceptNext(clock.now(), { phase: PHASE.WORK });
  assert.equal(engine.phase, PHASE.WORK);
  assert.equal(engine.status, STATUS.RUNNING);
  assert.equal(engine.targetMs, 25 * MINUTE);
  const overtime = logged.find((e) => e.type === 'overtime');
  assert.equal(overtime.workedMs, 2 * MINUTE, 'overtime before the choice is still logged');
});

test('a phase can be started with a one-off length', () => {
  const { engine } = makeEngine();
  engine.startPhase(PHASE.SHORT_BREAK, undefined, { targetMs: 2 * MINUTE });
  assert.equal(engine.targetMs, 2 * MINUTE);
});
