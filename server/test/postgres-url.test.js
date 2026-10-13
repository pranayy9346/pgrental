// How connection strings are prepared for the pg driver. No database needed.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { directDatabaseUrl, normalizeSslMode, refuseRemoteDatabaseInTests } from '../src/db/postgres.js';

describe('refuseRemoteDatabaseInTests', () => {
  const underTest = { NODE_TEST_CONTEXT: 'child-v8' };
  test('under the test runner only a database on this computer is allowed', () => {
    for (const url of ['postgres://u:p@127.0.0.1:5432/db', 'postgres://u:p@localhost/db', 'postgres://u:p@[::1]:5432/db']) {
      assert.doesNotThrow(() => refuseRemoteDatabaseInTests(url, underTest), url);
    }
    for (const url of [
      'postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      'postgresql://u:p@ep-x.aws.neon.tech/neondb',
      'postgres://u:p@localhost.example.com/db',
      'not a url',
      '',
    ]) {
      assert.throws(() => refuseRemoteDatabaseInTests(url, underTest), /Refusing to connect/, url);
    }
  });
  test('the message never contains the address or the password', () => {
    try {
      refuseRemoteDatabaseInTests('postgresql://admin:Sup3rSecret@ep-x.aws.neon.tech/neondb', underTest);
      assert.fail('should have thrown');
    } catch (err) {
      assert.doesNotMatch(err.message, /Sup3rSecret|neon\.tech|admin/);
    }
  });
  test('outside the test runner nothing changes (production keeps working)', () => {
    assert.doesNotThrow(() => refuseRemoteDatabaseInTests('postgresql://u:p@ep-x.aws.neon.tech/neondb', {}));
  });
});

describe('normalizeSslMode', () => {
  test('the aliases that providers hand out become the explicit strict mode', () => {
    for (const mode of ['require', 'prefer', 'verify-ca']) {
      assert.equal(normalizeSslMode(`postgresql://u:p@h/db?sslmode=${mode}`), 'postgresql://u:p@h/db?sslmode=verify-full', mode);
    }
  });
  test('other parameters are kept, in any position', () => {
    assert.equal(
      normalizeSslMode('postgresql://u:p@h/db?channel_binding=require&sslmode=require'),
      'postgresql://u:p@h/db?channel_binding=require&sslmode=verify-full',
    );
    assert.equal(
      normalizeSslMode('postgresql://u:p@h/db?sslmode=require&channel_binding=require'),
      'postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require',
    );
  });
  test('verify-full, disable, libpq-compat strings and strings without sslmode are not touched', () => {
    for (const url of [
      'postgresql://u:p@h/db?sslmode=verify-full',
      'postgresql://u:p@h/db?sslmode=disable',
      'postgresql://u:p@h/db?uselibpqcompat=true&sslmode=require',
      'postgresql://u:p@h/db',
      'postgresql://u:p@h/db?sslmode=requirement-x',
    ]) {
      assert.equal(normalizeSslMode(url), url, url);
    }
  });
  test('special characters in the password survive unchanged', () => {
    const url = 'postgresql://neondb_owner:p%40ss%3Aw%2Frd@ep-x-pooler.aws.neon.tech/neondb?sslmode=require';
    assert.equal(normalizeSslMode(url), url.replace('sslmode=require', 'sslmode=verify-full'));
  });
});

describe('directDatabaseUrl', () => {
  const withEnv = (vars, fn) => {
    const saved = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED };
    for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    }
  };
  test('prefers the direct string, falls back to the pooled one, and may be empty', () => {
    assert.equal(withEnv({ DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' }, directDatabaseUrl), 'direct');
    assert.equal(withEnv({ DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: undefined }, directDatabaseUrl), 'pooled');
    assert.equal(withEnv({ DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined }, directDatabaseUrl), undefined);
  });
});
