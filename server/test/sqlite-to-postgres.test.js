// The one-off tool that copies an existing SQLite database into an empty PostgreSQL database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateSqliteToPostgres } from '../src/db/migrate-data.js';
import { open } from '../src/db/pglite.js';
import { migrate } from '../src/schema.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-rental-migrate-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const OWNER_HASH = 'scrypt$0a0b$1c1d';
const TENANT_HASH = 'scrypt$2e2f$3a3b';

// Builds a realistic database file with the real SQLite migrations, like an existing installation.
function buildSource(file, { period = '2026-03' } = {}) {
  const lite = new Database(file);
  lite.pragma('foreign_keys = ON');
  migrate(lite);
  const run = (sql, ...args) => lite.prepare(sql).run(...args);
  run("INSERT INTO users (id, role, name, email, phone, password_hash, registered_at) VALUES (1, 'owner', 'Owner', 'owner@x.com', '+91 90000 00000', ?, '2026-01-01T00:00:00.000Z')", OWNER_HASH);
  run("INSERT INTO users (id, role, name, email, password_hash, owner_id, registered_at) VALUES (2, 'tenant', 'Registered Tenant', 'reg@x.com', ?, 1, '2026-02-01T00:00:00.000Z')", TENANT_HASH);
  run("INSERT INTO users (id, role, name, email, password_hash, owner_id) VALUES (3, 'tenant', 'Invited Tenant', 'invited@x.com', '!', 1)");
  run("INSERT INTO properties (id, owner_id, name, address, city, description, total_floors) VALUES (1, 1, 'Sunrise PG', '12 Road', 'Pune', 'Nice', 3)");
  run("INSERT INTO rooms (id, property_id, room_number, floor, capacity, monthly_rent, notes) VALUES (1, 1, '101', 1, 2, 8000, 'AC')");
  run("INSERT INTO rooms (id, property_id, room_number, floor, capacity, monthly_rent) VALUES (2, 1, 'G1', 0, 1, 6000)");
  run("INSERT INTO tenancies (id, tenant_id, room_id, start_date, end_date, monthly_rent, deposit, status, due_day) VALUES (1, 2, 1, '2026-01-01', '2026-02-15', 8000, 16000, 'ended', 7)");
  run("INSERT INTO tenancies (id, tenant_id, room_id, start_date, monthly_rent, deposit, due_day) VALUES (2, 2, 2, '2026-02-15', 6000, 12000, 10)");
  run('INSERT INTO payments (id, tenancy_id, period, amount_due, amount_paid, status, due_date, paid_on, method, note) VALUES (1, 2, ?, 6000, 2500, ?, ?, ?, ?, ?)', period, 'partial', `${period}-10`, `${period}-11`, 'upi', 'part one');
  run("INSERT INTO payments (id, tenancy_id, period, amount_due, due_date) VALUES (2, 1, '2026-02', 8000, '2026-02-07')");
  run("INSERT INTO complaints (id, tenancy_id, title, description, category, status, owner_reply) VALUES (1, 2, 'Fan', 'Fan broken ₹ é ü 日本', 'electrical', 'resolved', 'Fixed')");
  run("INSERT INTO notices (id, property_id, title, body) VALUES (1, 1, 'Water', 'Off on Sunday')");
  run("INSERT INTO vacate_requests (id, tenancy_id, requested_date, reason, status, owner_note) VALUES (1, 2, '2026-08-01', 'Moving', 'rejected', 'Notice period')");
  run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('abc', 1, '2030-01-01T00:00:00.000Z')");
  return lite;
}

const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const counts = async (db) => {
  const out = {};
  for (const t of ['users', 'properties', 'rooms', 'tenancies', 'payments', 'complaints', 'notices', 'vacate_requests', 'sessions']) {
    out[t] = (await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n;
  }
  return out;
};

describe('copying an existing database', () => {
  let file;
  let source;
  before(() => {
    file = path.join(tmp, 'source.db');
    buildSource(file).close();
    source = new Database(file, { readonly: true, fileMustExist: true });
  });
  after(() => source.close());

  test('a dry run proves the data loads, then rolls everything back', async () => {
    const target = await open();
    const summary = await migrateSqliteToPostgres({ source, target, commit: false });
    assert.equal(summary.committed, false);
    assert.ok(Object.values(summary.tables).every((t) => t.identical && t.source === t.target));
    assert.equal(summary.tables.users.source, 3);
    assert.ok(Object.values(await counts(target)).every((n) => n === 0), 'the target is still empty');
    await target.close();
  });

  test('a real run copies every table, ids, hashes and text exactly', async () => {
    const before = fileHash(file);
    const target = await open();
    const summary = await migrateSqliteToPostgres({ source, target, commit: true });
    assert.equal(summary.committed, true);

    assert.deepEqual(await counts(target), { users: 3, properties: 1, rooms: 2, tenancies: 2, payments: 2, complaints: 1, notices: 1, vacate_requests: 1, sessions: 0 });
    assert.equal(summary.sessionsSkipped, 1, 'login sessions are not copied');

    const users = await target.all('SELECT id, role, email, password_hash, owner_id, registered_at FROM users ORDER BY id');
    assert.deepEqual(users.map((u) => [u.id, u.role, u.email, u.password_hash]), [
      [1, 'owner', 'owner@x.com', OWNER_HASH],
      [2, 'tenant', 'reg@x.com', TENANT_HASH],
      [3, 'tenant', 'invited@x.com', '!'],
    ]);
    assert.equal(users[2].registered_at, null, 'an invited tenant is still not registered');
    assert.equal((await target.get('SELECT description FROM complaints')).description, 'Fan broken ₹ é ü 日本');
    const stay = await target.get('SELECT * FROM tenancies WHERE id = 2');
    assert.deepEqual([stay.room_id, stay.due_day, stay.monthly_rent, stay.status, stay.end_date], [2, 10, 6000, 'active', null]);
    const pay = await target.get('SELECT * FROM payments WHERE id = 1');
    assert.deepEqual([pay.amount_due, pay.amount_paid, pay.status, pay.method], [6000, 2500, 'partial', 'upi']);

    // relationships still work through joins
    const joined = await target.get(
      `SELECT u.name, r.room_number, p.name AS pg FROM tenancies t JOIN users u ON u.id = t.tenant_id
       JOIN rooms r ON r.id = t.room_id JOIN properties p ON p.id = r.property_id WHERE t.status = 'active'`,
    );
    assert.deepEqual({ ...joined }, { name: 'Registered Tenant', room_number: 'G1', pg: 'Sunrise PG' });

    // new rows get fresh ids after the copied ones (identity counters were moved forward)
    assert.equal(await target.insert("INSERT INTO users (role, name, email, password_hash, owner_id) VALUES ('tenant', 'New', 'new@x.com', '!', 1)"), 4);
    assert.equal(await target.insert("INSERT INTO notices (property_id, title, body) VALUES (1, 'Next', 'b')"), 2);

    assert.equal(fileHash(file), before, 'the SQLite file was not modified');
    await target.close();
  });

  test('a target that already has data is refused and left exactly as it was', async () => {
    const target = await open();
    await target.run("INSERT INTO users (role, name, email, password_hash) VALUES ('owner', 'Existing', 'existing@x.com', 'h')");
    const before = await counts(target);
    await assert.rejects(migrateSqliteToPostgres({ source, target, commit: true }), /not empty/);
    assert.deepEqual(await counts(target), before);
    assert.equal((await target.get('SELECT email FROM users')).email, 'existing@x.com');
    await target.close();
  });

  test('running the real copy twice into the same target is refused the second time', async () => {
    const target = await open();
    await migrateSqliteToPostgres({ source, target, commit: true });
    const after = await counts(target);
    await assert.rejects(migrateSqliteToPostgres({ source, target, commit: true }), /not empty/);
    assert.deepEqual(await counts(target), after);
    await target.close();
  });
});

describe('problems are caught and nothing is half-copied', () => {
  test('a row PostgreSQL rejects (a month "2026-13" that SQLite allowed) rolls everything back', async () => {
    const file = path.join(tmp, 'bad-period.db');
    buildSource(file, { period: '2026-13' }).close();
    const source = new Database(file, { readonly: true });
    const target = await open();
    await assert.rejects(migrateSqliteToPostgres({ source, target, commit: true }), /payments_period_check|check constraint/i);
    assert.ok(Object.values(await counts(target)).every((n) => n === 0), 'not a single row was kept');
    source.close();
    await target.close();
  });

  test('a SQLite database at the wrong schema version is refused before anything is copied', async () => {
    const file = path.join(tmp, 'old.db');
    const lite = new Database(file);
    migrate(lite, 2);
    lite.close();
    const source = new Database(file, { readonly: true });
    const target = await open();
    await assert.rejects(migrateSqliteToPostgres({ source, target }), /schema version 2/);
    source.close();
    await target.close();
  });

  test('an empty SQLite database (just created) copies as empty tables', async () => {
    const file = path.join(tmp, 'empty.db');
    const lite = new Database(file);
    migrate(lite);
    lite.close();
    const source = new Database(file, { readonly: true });
    const target = await open();
    const summary = await migrateSqliteToPostgres({ source, target, commit: true });
    assert.equal(summary.committed, true);
    assert.ok(Object.values(summary.tables).every((t) => t.source === 0 && t.target === 0));
    source.close();
    await target.close();
  });
});
