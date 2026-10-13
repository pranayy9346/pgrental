// Fills the database with demo data so you can try the app (development only).
// Run from the project root:  npm run seed
// The demo PG, rooms and tenants are attached to the configured owner (OWNER_EMAIL / OWNER_PASSWORD in server/.env).
// Safe to run more than once: it does nothing if that owner already has a PG.
import db from '../src/db.js';
import { configuredOwnerEmail, hashPassword } from '../src/lib/auth.js';
import { currentPeriod } from '../src/lib/http.js';
import { ensureOwner } from '../src/lib/owner.js';

const TENANT_PASSWORD = 'tenant12345'; // demo tenants only

if (process.env.NODE_ENV === 'production') {
  console.error('The seed script adds demo data and must not be run in production.');
  process.exit(1);
}

const owner = await ensureOwner();
if (owner.status === 'unconfigured') {
  console.error('Set OWNER_EMAIL and OWNER_PASSWORD in server/.env first (see server/.env.example), then run the seed again.');
  process.exit(1);
}
const ownerId = db.prepare("SELECT id FROM users WHERE role = 'owner' AND email = ?").get(configuredOwnerEmail()).id;

if (db.prepare('SELECT 1 FROM properties WHERE owner_id = ?').get(ownerId)) {
  console.log('The owner already has a PG, so no demo data was added.');
  process.exit(0);
}
if (db.prepare("SELECT 1 FROM users WHERE email IN ('rahul@demo.com', 'neha@demo.com')").get()) {
  console.error('Demo tenant emails already exist in this database, so no demo data was added.');
  process.exit(1);
}

const tenantHash = await hashPassword(TENANT_PASSWORD);
const period = currentPeriod();
const monthStart = `${period}-01`;

db.transaction(() => {
  const pg = db
    .prepare('INSERT INTO properties (owner_id, name, address, city, description, total_floors) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ownerId, 'Sunrise PG', '12 MG Road, Koramangala', 'Bengaluru', 'PG with meals and Wi-Fi', 3).lastInsertRowid;

  const addRoom = db.prepare(
    'INSERT INTO rooms (property_id, room_number, floor, capacity, monthly_rent) VALUES (?, ?, ?, ?, ?)',
  );
  const g1 = addRoom.run(pg, 'G1', 0, 2, 7500).lastInsertRowid;
  const g2 = addRoom.run(pg, 'G2', 0, 2, 7500).lastInsertRowid;
  const r101 = addRoom.run(pg, '101', 1, 2, 8000).lastInsertRowid;
  const r102 = addRoom.run(pg, '102', 1, 3, 6500).lastInsertRowid;
  addRoom.run(pg, '201', 2, 1, 12000);

  // Demo tenants are already registered (they have a password), so you can log in as them right away.
  const addTenant = db.prepare(
    "INSERT INTO users (role, name, email, phone, password_hash, owner_id, registered_at) VALUES ('tenant', ?, ?, ?, ?, ?, datetime('now'))",
  );
  const addStay = db.prepare(
    'INSERT INTO tenancies (tenant_id, room_id, start_date, monthly_rent, deposit) VALUES (?, ?, ?, ?, ?)',
  );
  const tenants = [
    ['Rahul Sharma', 'rahul@demo.com', '+91 90000 00001', r101, 8000],
    ['Arjun Mehta', 'arjun@demo.com', '+91 90000 00002', r101, 8000],
    ['Vikram Rao', 'vikram@demo.com', '+91 90000 00003', r102, 6500],
    ['Priya Nair', 'priya@demo.com', '+91 90000 00004', g1, 7500],
  ];
  // Added by the owner but not registered yet: they register at /register/tenant with their email and a password.
  const neha = db
    .prepare("INSERT INTO users (role, name, email, phone, password_hash, owner_id) VALUES ('tenant', 'Neha Gupta', 'neha@demo.com', '+91 90000 00005', '!', ?)")
    .run(ownerId).lastInsertRowid;
  addStay.run(neha, g2, monthStart, 7500, 15000);

  const stays = tenants.map(([name, email, phone, room, rent]) => {
    const id = addTenant.run(name, email, phone, tenantHash, ownerId).lastInsertRowid;
    return addStay.run(id, room, monthStart, rent, rent * 2).lastInsertRowid;
  });

  const addPayment = db.prepare(
    `INSERT INTO payments (tenancy_id, period, amount_due, amount_paid, status, due_date, paid_on, method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  addPayment.run(stays[0], period, 8000, 8000, 'paid', `${period}-05`, monthStart, 'upi');
  addPayment.run(stays[1], period, 8000, 3000, 'partial', `${period}-05`, monthStart, 'cash');
  addPayment.run(stays[2], period, 6500, 0, 'pending', `${period}-05`, null, null);

  db.prepare('INSERT INTO complaints (tenancy_id, title, description, category) VALUES (?, ?, ?, ?)').run(
    stays[0],
    'Fan not working',
    'The ceiling fan in room 101 stopped working last night.',
    'electrical',
  );
  db.prepare('INSERT INTO notices (property_id, title, body) VALUES (?, ?, ?)').run(
    pg,
    'Water supply maintenance',
    'Water supply will be off on Sunday from 10 AM to 1 PM for tank cleaning.',
  );
})();

console.log('Demo data created.');
console.log(`  Owner login:  ${owner.email} (with the OWNER_PASSWORD from server/.env)`);
console.log(`  Tenant login: rahul@demo.com / ${TENANT_PASSWORD}  (also arjun@, vikram@, priya@demo.com)`);
console.log('  Not registered yet: neha@demo.com (use it to try the tenant registration page: /register/tenant)');
