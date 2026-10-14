// Timing rules for the unread-count refresh: normal interval, error backoff, idle pause, revisit throttle.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { IDLE_AFTER_MS, isIdle, MAX_BACKOFF_MS, MIN_GAP_MS, nextDelay, POLL_MS, shouldRefreshOnWake } from '../src/lib/pollPolicy.js';

describe('polling interval', () => {
  test('normal interval is 60 seconds', () => {
    assert.equal(POLL_MS, 60_000);
  });

  test('an hour of visible, active use costs about 60 requests at most', () => {
    let delay = POLL_MS;
    let elapsed = 0;
    let requests = 0;
    while (elapsed + delay <= 60 * 60_000) {
      elapsed += delay;
      requests++;
      delay = nextDelay(delay, true);
    }
    assert.ok(requests <= 60, `${requests} requests`);
  });
});

describe('error backoff', () => {
  test('the wait doubles after each failure and stops growing at 10 minutes', () => {
    let delay = POLL_MS;
    const seen = [];
    for (let i = 0; i < 7; i++) {
      delay = nextDelay(delay, false);
      seen.push(delay);
    }
    assert.deepEqual(seen, [120_000, 240_000, 480_000, 600_000, 600_000, 600_000, 600_000]);
    assert.equal(MAX_BACKOFF_MS, 600_000);
  });

  test('one success returns to the normal 60 seconds', () => {
    assert.equal(nextDelay(480_000, true), POLL_MS);
  });

  test('while the server keeps failing, an hour costs far fewer requests than normal polling', () => {
    let delay = POLL_MS;
    let elapsed = 0;
    let requests = 0;
    while (elapsed + delay <= 60 * 60_000) {
      elapsed += delay;
      requests++;
      delay = nextDelay(delay, false);
    }
    assert.ok(requests <= 10, `${requests} requests`);
  });
});

describe('idle pause', () => {
  const t0 = 1_000_000;
  test('active within the last 10 minutes is not idle (the boundary itself is not idle)', () => {
    assert.equal(isIdle(t0, t0 + 1000), false);
    assert.equal(isIdle(t0, t0 + IDLE_AFTER_MS), false);
  });
  test('more than 10 minutes without interaction is idle', () => {
    assert.equal(isIdle(t0, t0 + IDLE_AFTER_MS + 1), true);
  });
});

describe('revisiting the tab', () => {
  test('refreshes at most once every 15 seconds', () => {
    assert.equal(MIN_GAP_MS, 15_000);
    assert.equal(shouldRefreshOnWake(1000, 1000 + 14_999), false);
    assert.equal(shouldRefreshOnWake(1000, 1000 + 15_000), true);
    assert.equal(shouldRefreshOnWake(0, Date.now()), true, 'the very first load always fetches');
  });
});
