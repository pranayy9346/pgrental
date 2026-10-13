import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../schema.js';

// SQLite driver (local development and the original database). `better-sqlite3` is an optional dependency and is
// only loaded here, so a PostgreSQL-only host never needs its native module.
export async function open() {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    throw new Error(`The SQLite driver needs the "better-sqlite3" package (${err.message}). Set DATABASE_URL to use PostgreSQL instead.`);
  }

  const serverRoot = path.resolve(import.meta.dirname, '../..');
  const configured = process.env.DB_PATH || 'data/pg-rental.db';
  // ':memory:' gives a throwaway database (used by the automated tests).
  const dbPath = configured === ':memory:' ? configured : path.resolve(serverRoot, configured);
  // Safety net: the test runner (node --test) sets NODE_TEST_CONTEXT. A test must never open a real database file.
  if (process.env.NODE_TEST_CONTEXT && dbPath !== ':memory:' && process.env.ALLOW_TEST_DB_FILE !== 'true') {
    throw new Error(`A test tried to open the database file ${dbPath}. Tests must set DB_PATH=':memory:' before importing the app.`);
  }
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  migrate(raw);

  const cache = new Map();
  const prepare = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) cache.set(sql, (stmt = raw.prepare(sql)));
    return stmt;
  };
  const exec = (method, sql, params) => {
    const stmt = prepare(sql);
    return Array.isArray(params) ? stmt[method](...params) : params ? stmt[method](params) : stmt[method]();
  };

  const queries = {
    async all(sql, params) {
      return exec('all', sql, params);
    },
    async get(sql, params) {
      return exec('get', sql, params);
    },
    async run(sql, params) {
      return { changes: exec('run', sql, params).changes };
    },
    // INSERT that returns the new row's id (SQLite 3.35+ supports RETURNING).
    async insert(sql, params) {
      return exec('get', `${sql} RETURNING id`, params).id;
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };

  // One connection, so transactions are serialised. A transaction body must only await database calls
  // (nothing slow like hashing), otherwise another request could run inside the open transaction.
  let queue = Promise.resolve();
  const transaction = (fn) => {
    const task = async () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(queries);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  return {
    dialect: 'sqlite',
    description: dbPath,
    ...queries,
    transaction,
    async ping() {
      raw.prepare('SELECT 1').get();
    },
    async close() {
      raw.close();
    },
    raw, // for the SQLite-to-PostgreSQL migration script and tests
  };
}
