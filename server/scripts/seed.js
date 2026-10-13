// Fills the database with demo data so you can try the app.
// Run from the project root:  npm run seed
// Safe to run more than once: it does nothing if the demo owner already exists.
import db from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import { currentPeriod } from '../src/lib/http.js';

const OWNER_EMAIL = 'owner@demo.com';
const OWNER_PASSWORD = 'owner12345';
const TENANT_PASSWORD = 'tenant12345';

if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(OWNER_EMAIL)) {
  console.log('Demo data already exists. Nothing to do.');
  process.exit(0);
}

const ownerHash = await hashPassword(OWNER_PASSWORD);
const tenantHash = await hashPassword(TENANT_PASSWORD);
const period = currentPeriod();
const monthStart = `${period}-01`;

db.transaction(() => {
  const ownerId = db
    .prepare("INSERT INTO users (role, name, email, phone, password_hash) VALUES ('owner', ?, ?, ?, ?)")
    .run('Demo Owner', OWNER_EMAIL, '+91 98765 43210', ownerHash).lastInsertRowid;

  const addProperty = db.prepare('INSERT INTO properties (owner_id, name, address, city, description) VALUES (?, ?, ?, ?, ?)');
  const p1 = addProperty.run(ownerId, 'Sunrise PG', '12 MG Road, Koramangala', 'Bengaluru', 'Boys PG with meals and Wi-Fi').lastInsertRowid;
  const p2 = addProperty.run(ownerId, 'Green Nest Hostel', '45 Park Street', 'Pune', 'Girls hostel near the university').lastInsertRowid;

  const addRoom = db.prepare('INSERT INTO rooms (property_id, room_number, capacity, monthly_rent) VALUES (?, ?, ?, ?)');
  const r101 = addRoom.run(p1, '101', 2, 8000).lastInsertRowid;
  const r102 = addRoom.run(p1, '102', 3, 6500).lastInsertRowid;
  addRoom.run(p1, '201', 1, 12000);
  const g1 = addRoom.run(p2, 'G1', 2, 7500).lastInsertRowid;

  const addTenant = db.prepare(
    "INSERT INTO users (role, name, email, phone, password_hash, owner_id) VALUES ('tenant', ?, ?, ?, ?, ?)",
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
    p1,
    'Water supply maintenance',
    'Water supply will be off on Sunday from 10 AM to 1 PM for tank cleaning.',
  );
})();

console.log('Demo data created.');
console.log(`  Owner login:  ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
console.log(`  Tenant login: rahul@demo.com / ${TENANT_PASSWORD}  (also arjun@, vikram@, priya@demo.com)`);
