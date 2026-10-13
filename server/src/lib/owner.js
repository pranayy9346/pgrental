import db from '../db.js';
import { configuredOwnerEmail, hashPassword, verifyPassword } from './auth.js';
import { email, password, str, validate } from './validate.js';

// Makes sure the one owner account named in the server configuration exists and uses the configured password.
// Called when the server starts (and by the seed script).
//
//   OWNER_EMAIL     login email of the owner
//   OWNER_PASSWORD  the owner's password (stored hashed; the plain text is never written to the database)
//   OWNER_NAME      optional display name used when the account is first created
//
// The configuration is the source of truth: change OWNER_PASSWORD, restart, and the old password stops working.
// An existing owner row with the same email is adopted, so its data is kept.
// Returns { status: 'unconfigured' | 'created' | 'updated' | 'unchanged', email, disabledOwners }.
export async function ensureOwner() {
  const rawEmail = process.env.OWNER_EMAIL;
  const rawPassword = process.env.OWNER_PASSWORD;
  if (!rawEmail && !rawPassword) return { status: 'unconfigured', email: null, disabledOwners: countDisabled(null) };

  let config;
  try {
    config = validate(
      { email: rawEmail, password: rawPassword, name: process.env.OWNER_NAME },
      { email: email(), password: password(), name: str({ min: 2, max: 100, optional: true }) },
    );
  } catch (err) {
    const problems = Object.entries(err.details || {}).map(([k, v]) => `OWNER_${k.toUpperCase()}: ${v}`);
    throw new Error(`The owner settings are not valid. ${problems.join('; ') || err.message}`);
  }

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(config.email);
  let status;
  if (!existing) {
    db.prepare(
      `INSERT INTO users (role, name, email, password_hash, registered_at)
       VALUES ('owner', ?, ?, ?, ?)`,
    ).run(config.name ?? 'PG Owner', config.email, await hashPassword(config.password), new Date().toISOString());
    status = 'created';
  } else if (existing.role !== 'owner') {
    throw new Error(`OWNER_EMAIL (${config.email}) already belongs to a tenant account. Choose a different owner email.`);
  } else if (await verifyPassword(config.password, existing.password_hash)) {
    status = 'unchanged';
  } else {
    const hash = await hashPassword(config.password);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id); // log out anyone using the old password
    })();
    status = 'updated';
  }
  return { status, email: config.email, disabledOwners: countDisabled(config.email) };
}

// Owner rows from older databases that are not the configured owner. They are kept but cannot log in.
function countDisabled(keepEmail) {
  const email = keepEmail ?? configuredOwnerEmail() ?? '';
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND lower(email) != ?").get(email).n;
}
