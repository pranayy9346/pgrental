// Fills the database with demo data so you can try the app (development only).
// Run from the project root:  npm run seed
// The demo PG, rooms and tenants are attached to the configured owner (OWNER_EMAIL / OWNER_PASSWORD in server/.env).
// Safe to run more than once: it does nothing if that owner already has a PG.
import db from '../src/db.js';
import { configuredOwnerEmail, hashPassword, issueInvite } from '../src/lib/auth.js';
import { currentPeriod, nowStamp } from '../src/lib/http.js';
import { ensureOwner } from '../src/lib/owner.js';

const TENANT_PASSWORD = 'tenant12345'; // demo tenants only

if (process.env.NODE_ENV === 'production') {
  console.error('The seed script adds demo data and must not be run in production.');
  process.exit(1);
}
// Demo data must never end up in a real hosted database by accident (for example when DATABASE_URL in your shell
// points at the production database). Seeding PostgreSQL therefore needs an explicit opt-in.
if (db.dialect === 'postgres' && process.env.SEED_ALLOW_POSTGRES !== 'true') {
  console.error(
    `Refusing to seed ${db.description}. Demo users with a known password would be added to that database.\n` +
      'If this really is a throw-away development database, run again with SEED_ALLOW_POSTGRES=true.',
  );
  process.exit(1);
}

const owner = await ensureOwner();
if (owner.status === 'unconfigured') {
  console.error('Set OWNER_EMAIL and OWNER_PASSWORD in server/.env first (see server/.env.example), then run the seed again.');
  process.exit(1);
}
const ownerId = (await db.get("SELECT id FROM users WHERE role = 'owner' AND lower(email) = ?", [configuredOwnerEmail()])).id;

if (await db.get('SELECT 1 AS ok FROM properties WHERE owner_id = ?', [ownerId])) {
  console.log('The owner already has a PG, so no demo data was added.');
  await db.close();
  process.exit(0);
}
if (await db.get("SELECT 1 AS ok FROM users WHERE email IN ('rahul@demo.com', 'neha@demo.com')")) {
  console.error('Demo tenant emails already exist in this database, so no demo data was added.');
  await db.close();
  process.exit(1);
}

const tenantHash = await hashPassword(TENANT_PASSWORD);
const period = currentPeriod();
const monthStart = `${period}-01`;

await db.transaction(async (tx) => {
  const pg = await tx.insert(
    'INSERT INTO properties (owner_id, name, address, city, description, total_floors) VALUES (?, ?, ?, ?, ?, ?)',
    [ownerId, 'Sunrise PG', '12 MG Road, Koramangala', 'Bengaluru', 'PG with meals and Wi-Fi', 3],
  );

  const addRoom = (number, floor, capacity, rent) =>
    tx.insert('INSERT INTO rooms (property_id, room_number, floor, capacity, monthly_rent) VALUES (?, ?, ?, ?, ?)', [
      pg,
      number,
      floor,
      capacity,
      rent,
    ]);
  const g1 = await addRoom('G1', 0, 2, 7500);
  const g2 = await addRoom('G2', 0, 2, 7500);
  const r101 = await addRoom('101', 1, 2, 8000);
  const r102 = await addRoom('102', 1, 3, 6500);
  await addRoom('201', 2, 1, 12000);

  const addStay = (tenantId, roomId, rent, deposit) =>
    tx.insert('INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent, deposit) VALUES (?, ?, ?, ?, ?)', [
      tenantId,
      roomId,
      monthStart,
      rent,
      deposit,
    ]);

  // Demo tenants are already registered (they have a password), so you can log in as them right away.
  const tenants = [
    ['Rahul Sharma', 'rahul@demo.com', '+91 90000 00001', r101, 8000],
    ['Arjun Mehta', 'arjun@demo.com', '+91 90000 00002', r101, 8000],
    ['Vikram Rao', 'vikram@demo.com', '+91 90000 00003', r102, 6500],
    ['Priya Nair', 'priya@demo.com', '+91 90000 00004', g1, 7500],
  ];

  // Added by the owner but not registered yet: they register at /register/tenant with their email and a password.
  const neha = await tx.insert(
    "INSERT INTO users (role, name, email, phone, password_hash, owner_id) VALUES ('tenant', 'Neha Gupta', 'neha@demo.com', '+91 90000 00005', '!', ?)",
    [ownerId],
  );
  await addStay(neha, g2, 7500, 15000);

  const stays = [];
  for (const [name, email, phone, room, rent] of tenants) {
    const id = await tx.insert(
      "INSERT INTO users (role, name, email, phone, password_hash, owner_id, registered_at) VALUES ('tenant', ?, ?, ?, ?, ?, ?)",
      [name, email, phone, tenantHash, ownerId, nowStamp()],
    );
    stays.push(await addStay(id, room, rent, rent * 2));
  }

  const addPayment = (...values) =>
    tx.run(
      `INSERT INTO payments (tenancy_id, period, amount_due, amount_paid, status, due_date, paid_on, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
  await addPayment(stays[0], period, 8000, 8000, 'paid', `${period}-05`, monthStart, 'upi');
  await addPayment(stays[1], period, 8000, 3000, 'partial', `${period}-05`, monthStart, 'cash');
  await addPayment(stays[2], period, 6500, 0, 'pending', `${period}-05`, null, null);

  await tx.run('INSERT INTO complaints (tenancy_id, title, description, category) VALUES (?, ?, ?, ?)', [
    stays[0],
    'Fan not working',
    'The ceiling fan in room 101 stopped working last night.',
    'electrical',
  ]);
  await tx.run('INSERT INTO notices (property_id, title, body) VALUES (?, ?, ?)', [
    pg,
    'Water supply maintenance',
    'Water supply will be off on Sunday from 10 AM to 1 PM for tank cleaning.',
  ]);
});

const nehaId = (await db.get("SELECT id FROM users WHERE email = 'neha@demo.com'")).id;
const nehaInvite = await issueInvite(db, nehaId);

console.log('Demo data created.');
console.log(`  Owner login:  ${owner.email} (with the OWNER_PASSWORD from server/.env)`);
console.log(`  Tenant login: rahul@demo.com / ${TENANT_PASSWORD}  (also arjun@, vikram@, priya@demo.com)`);
console.log(`  Not registered yet: neha@demo.com, invite code ${nehaInvite.code} (try the tenant registration page: /register/tenant)`);
await db.close();
