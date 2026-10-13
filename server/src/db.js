import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './schema.js';

const serverRoot = path.resolve(import.meta.dirname, '..');
const configured = process.env.DB_PATH || 'data/pg-rental.db';
// ':memory:' gives a throwaway database (used by the automated tests).
const dbPath = configured === ':memory:' ? configured : path.resolve(serverRoot, configured);

if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

migrate(db);

export { dbPath };
export default db;
