// Applies pending PostgreSQL schema migrations and shows which are applied.
//   DATABASE_URL=postgres://...  npm run migrate -w server
// The server also does this by itself at start-up (unless DB_AUTO_MIGRATE=false). This script only adds tables or
// columns that are missing; it never deletes or rewrites existing rows and never seeds demo data.
import { directDatabaseUrl, open } from '../src/db/postgres.js';
// Uses DATABASE_URL_UNPOOLED (the direct connection) when it is set, otherwise DATABASE_URL.

if (!directDatabaseUrl()) {
  console.error('Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to the PostgreSQL database to migrate.');
  process.exit(1);
}
const db = await open({ connectionString: directDatabaseUrl() }); // connecting runs the migrations
try {
  const rows = await db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
  console.log('Applied migrations:');
  for (const r of rows) console.log(`  ${r.version}  ${r.name}  (${r.applied_at})`);
} finally {
  await db.close();
}
