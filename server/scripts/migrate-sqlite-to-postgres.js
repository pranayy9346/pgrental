// Copies an existing SQLite database into an EMPTY PostgreSQL database.
//
//   DATABASE_URL=postgres://...  npm run migrate:from-sqlite -w server -- --sqlite data/backups/<file>.db
//   ... add --commit to really write the data (without it the tool only rehearses and rolls everything back)
//
// Read the safety rules in src/db/migrate-data.js. The SQLite file is opened read-only and is never modified.
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// Uses DATABASE_URL_UNPOOLED (the direct connection) when it is set, otherwise DATABASE_URL.
if (!(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)) {
  console.error('Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to the (empty) PostgreSQL database you want to copy into.');
  process.exit(1);
}
const sqlitePath = path.resolve(process.cwd(), option('sqlite') || process.env.DB_PATH || 'data/pg-rental.db');
const commit = flag('commit');

const { default: Database } = await import('better-sqlite3');
const { directDatabaseUrl, open } = await import('../src/db/postgres.js');
const { migrateSqliteToPostgres } = await import('../src/db/migrate-data.js');

const host = new URL(directDatabaseUrl()).host; // never print the user name or password
console.log(`Source (read-only): ${sqlitePath}`);
console.log(`Target            : PostgreSQL at ${host}`);
console.log(commit ? 'Mode              : COMMIT (the data will be written)' : 'Mode              : DRY RUN (everything is rolled back at the end; add --commit to keep it)');

const source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const target = await open({ connectionString: directDatabaseUrl() });
try {
  const summary = await migrateSqliteToPostgres({ source, target, commit, log: (m) => console.log(`  ${m}`) });
  console.log('\nVerification (rows in SQLite -> rows in PostgreSQL, content checksum):');
  for (const [table, t] of Object.entries(summary.tables)) {
    console.log(`  ${table.padEnd(16)} ${String(t.source).padStart(4)} -> ${String(t.target).padStart(4)}  ${t.identical ? 'identical' : 'DIFFERENT'}`);
  }
  console.log(`  (${summary.sessionsSkipped} login session(s) were not copied; everyone logs in again)`);
  console.log(summary.committed ? '\nDone: the data is now in PostgreSQL.' : '\nDry run finished: all tables copied and verified, then rolled back. Nothing was written.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  source.close();
  await target.close();
}
