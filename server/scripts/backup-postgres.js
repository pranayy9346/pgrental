// Exports every table of the PostgreSQL database to one JSON file (a portable, readable backup).
//   DATABASE_URL=postgres://...  npm run backup:postgres -w server
// Free database plans often keep little or no history (check your provider), so take your own copies regularly.
// WARNING: the file contains password hashes and personal data. It goes to server/data/backups/ (ignored by Git);
// keep it somewhere private and never commit or share it.
import fs from 'node:fs';
import path from 'node:path';
import { COPY_ORDER } from '../src/db/migrate-data.js';
import { directDatabaseUrl, open } from '../src/db/postgres.js';
// Uses DATABASE_URL_UNPOOLED (the direct connection) when it is set, otherwise DATABASE_URL.

if (!directDatabaseUrl()) {
  console.error('Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to the PostgreSQL database to export.');
  process.exit(1);
}
const db = await open({ connectionString: directDatabaseUrl() });
try {
  const tables = {};
  for (const table of [...COPY_ORDER, 'sessions']) {
    tables[table] = table === 'sessions' ? [] : await db.all(`SELECT * FROM ${table} ORDER BY id`); // sessions are never exported
  }
  const dir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.resolve(import.meta.dirname, '..', 'data', 'backups'); // BACKUP_DIR: used by tests
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `pg-export-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), tables }, null, 2), { mode: 0o600 });
  console.log(`Export written: ${file}`);
  for (const [name, rows] of Object.entries(tables)) if (name !== 'sessions') console.log(`  ${name.padEnd(18)} ${rows.length} rows`);
} finally {
  await db.close();
}
