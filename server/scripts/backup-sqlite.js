// Makes a verified, consistent copy of the SQLite database (safe while the app is running).
//   npm run backup:sqlite -w server            (from the project root)
// The original is opened read-only and never modified. Backups go to server/data/backups/, which Git ignores.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const serverRoot = path.resolve(import.meta.dirname, '..');
const sourcePath = path.resolve(serverRoot, process.env.DB_PATH || 'data/pg-rental.db');
if (!fs.existsSync(sourcePath)) {
  console.error(`No SQLite database found at ${sourcePath}`);
  process.exit(1);
}
const dir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(serverRoot, 'data', 'backups'); // BACKUP_DIR: used by tests
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const target = path.join(dir, `pg-rental-${stamp}.db`);

const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
await source.backup(target);
source.close();

const copy = new Database(target, { readonly: true });
const integrity = copy.pragma('integrity_check', { simple: true });
console.log(`Backup written: ${target}`);
console.log(`Integrity check: ${integrity}`);
for (const { name } of copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
  console.log(`  ${name.padEnd(18)} ${copy.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n} rows`);
}
copy.close();
if (integrity !== 'ok') process.exit(1);
