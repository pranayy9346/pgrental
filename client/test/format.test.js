// Badge text and India-time formatting used by the notification UI.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { badgeText, formatDateTime, timeAgo } from '../src/lib/format.js';

describe('badgeText (the red unread counter)', () => {
  test('shows the number up to 99 and "99+" above', () => {
    assert.equal(badgeText(1), '1');
    assert.equal(badgeText(9), '9');
    assert.equal(badgeText(99), '99');
    assert.equal(badgeText(100), '99+');
    assert.equal(badgeText(2500), '99+');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString().slice(0, 19).replace('T', ' ');
  test('relative wording', () => {
    assert.equal(timeAgo(ago(5_000), now), 'just now');
    assert.equal(timeAgo(ago(5 * 60_000), now), '5 min ago');
    assert.equal(timeAgo(ago(3 * 3_600_000), now), '3 h ago');
    assert.equal(timeAgo(ago(2 * 86_400_000), now), '2 d ago');
  });
  test('older than a week becomes a date (in India time)', () => {
    assert.match(timeAgo(ago(30 * 86_400_000), now), /Sept 2026|Sep 2026/);
  });
  test('a timestamp slightly in the future (clock difference) is just now, never negative', () => {
    assert.equal(timeAgo(ago(-30_000), now), 'just now');
  });
  test('empty input', () => {
    assert.equal(timeAgo(null, now), '');
  });
});

describe('formatDateTime shows India time', () => {
  test('a UTC timestamp is converted to IST (+5:30)', () => {
    assert.match(formatDateTime('2026-10-13 20:30:00'), /14 Oct 2026.*2:00\s?am IST/i);
    assert.match(formatDateTime('2026-10-14 06:00:00'), /14 Oct 2026.*11:30\s?am IST/i);
  });
  test('empty input', () => {
    assert.equal(formatDateTime(null), '—');
  });
});
