// Hosting platforms (Render, etc.) tell the app which port to use through PORT and need it to listen on all network
// interfaces (0.0.0.0), not only on localhost.
const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

async function start() {
  // Imported here (not at the top) so that a database or configuration problem is reported as one clear message.
  const { cookieSettings, purgeExpiredSessions } = await import('./lib/auth.js');
  const { ensureOwner } = await import('./lib/owner.js');
  const { default: db, dbPath } = await import('./db.js');
  const { default: app } = await import('./app.js');

  const cookies = cookieSettings(); // throws on an invalid COOKIE_SAMESITE

  const owner = await ensureOwner();
  if (owner.status === 'unconfigured') {
    console.warn(
      '\nWARNING: no owner account is configured, so nobody can log in as the owner.\n' +
        'Set OWNER_EMAIL and OWNER_PASSWORD (server/.env locally, or the hosting dashboard) and restart.\n',
    );
  } else {
    console.log(`Owner account ${owner.status}: ${owner.email}`);
  }
  if (owner.disabledOwners) {
    console.warn(`Note: ${owner.disabledOwners} other owner account(s) in the database are disabled (only OWNER_EMAIL may log in).`);
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CLIENT_ORIGINS) {
      console.warn('Note: CLIENT_ORIGINS is empty, so browsers on other sites (e.g. your Vercel frontend) are not allowed to call this API.');
    }
    if (!process.env.TRUST_PROXY) {
      console.warn('Note: TRUST_PROXY is not set. Behind a hosting proxy every visitor looks like the same IP address, which makes the login rate limit shared. Set TRUST_PROXY=1 on Render.');
    }
  }

  await purgeExpiredSessions();
  const cleanup = setInterval(() => purgeExpiredSessions().catch((e) => console.error('Session cleanup failed:', e.message)), 60 * 60_000);
  cleanup.unref();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening on ${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
    console.log(`Database: ${dbPath}`);
    console.log(`Cookies: SameSite=${cookies.sameSite}, Secure=${cookies.secure}`);
  });

  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(async () => {
      try {
        await db.close();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // do not hang forever
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error(`\nCannot start: ${err.message}\n`);
  process.exit(1);
});
