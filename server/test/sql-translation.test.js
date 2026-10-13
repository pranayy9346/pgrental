// The placeholder translator that lets one SQL text run on both SQLite and PostgreSQL. No database needed.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toPg } from '../src/db/sql.js';

describe('toPg: ? placeholders', () => {
  test('are numbered in order', () => {
    const q = toPg('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?', [1, 'x', null]);
    assert.equal(q.text, 'SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3');
    assert.deepEqual(q.values, [1, 'x', null]);
  });
  test('undefined becomes null', () => {
    assert.deepEqual(toPg('SELECT ?', [undefined]).values, [null]);
  });
  test('the number of values must match', () => {
    assert.throws(() => toPg('SELECT ?, ?', [1]), /2 placeholders but 1 values/);
    assert.throws(() => toPg('SELECT ?', [1, 2]), /1 placeholders but 2 values/);
  });
  test('no params and no placeholders is fine', () => {
    assert.deepEqual(toPg('SELECT 1'), { text: 'SELECT 1', values: [] });
  });
});

describe('toPg: @name placeholders', () => {
  test('a repeated name reuses the same $n', () => {
    const q = toPg('SELECT @a, @b, @a', { a: 1, b: 2 });
    assert.equal(q.text, 'SELECT $1, $2, $1');
    assert.deepEqual(q.values, [1, 2]);
  });
  test('extra keys are ignored, missing ones are an error', () => {
    assert.deepEqual(toPg('SELECT @a', { a: 1, unused: 9 }).values, [1]);
    assert.throws(() => toPg('SELECT @a, @b', { a: 1 }), /Missing named parameter @b/);
  });
  test('mixing styles is refused', () => {
    assert.throws(() => toPg('SELECT ?', { a: 1 }), /named parameters were given/);
    assert.throws(() => toPg('SELECT @a', [1]), /no named parameters/);
  });
});

describe('toPg: text inside quotes is left alone', () => {
  test('? and @ inside a string literal are not placeholders', () => {
    const q = toPg("SELECT 'what? me@x.com', ? FROM t WHERE b = 'it''s ?' AND c = ?", [1, 2]);
    assert.equal(q.text, "SELECT 'what? me@x.com', $1 FROM t WHERE b = 'it''s ?' AND c = $2");
    assert.deepEqual(q.values, [1, 2]);
  });
  test('an @ that is not followed by a name is kept', () => {
    assert.equal(toPg('SELECT 1 @ 2').text, 'SELECT 1 @ 2');
  });
});
