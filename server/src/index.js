import app from './app.js';
import db, { dbPath } from './db.js';
import { purgeExpiredSessions } from './lib/auth.js';

const PORT = Number(process.env.PORT) || 3001;

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
