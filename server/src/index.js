import app from './app.js';
import db, { dbPath } from './db.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { ensureOwner } from './lib/owner.js';

const PORT = Number(process.env.PORT) || 3001;

try {
  const owner = await ensureOwner();
  if (owner.status === 'unconfigured') {
    console.warn(
      '\nWARNING: no owner account is configured, so nobody can log in as the owner.\n' +
        'Set OWNER_EMAIL and OWNER_PASSWORD in server/.env (see server/.env.example) and restart.\n',
    );
  } else {
    console.log(`Owner account ${owner.status}: ${owner.email}`);
  }
  if (owner.disabledOwners) {
    console.warn(`Note: ${owner.disabledOwners} other owner account(s) in the database are disabled (only OWNER_EMAIL may log in).`);
  }
} catch (err) {
  console.error(`\nCannot start: ${err.message}\n`);
  process.exit(1);
}

purgeExpiredSessions();
const cleanup = setInterval(purgeExpiredSessions, 60 * 60_000);
cleanup.unref();

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
