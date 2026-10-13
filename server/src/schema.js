// Database migrations. Each entry runs once, in order, tracked by SQLite's `user_version`.
// To change the schema later, ADD a new entry at the end — never edit one that has already run.
const migrations = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    role          TEXT    NOT NULL CHECK (role IN ('owner', 'tenant')),
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT,
    password_hash TEXT    NOT NULL,
    -- For tenants: the owner who created the account. NULL for owners.
    owner_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK ((role = 'owner' AND owner_id IS NULL) OR (role = 'tenant' AND owner_id IS NOT NULL))
  );
  CREATE INDEX idx_users_owner ON users(owner_id);

  CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE properties (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    address     TEXT    NOT NULL,
    city        TEXT    NOT NULL,
    description TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_properties_owner ON properties(owner_id);

  CREATE TABLE rooms (
    id           INTEGER PRIMARY KEY,
    property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    room_number  TEXT    NOT NULL,
    capacity     INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
    monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
    notes        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (property_id, room_number)
  );

  -- A tenant's stay in a room. History is kept: moving out sets status = 'ended'.
  CREATE TABLE tenancies (
    id           INTEGER PRIMARY KEY,
    tenant_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    start_date   TEXT    NOT NULL,
    end_date     TEXT,
    monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
    deposit      INTEGER NOT NULL DEFAULT 0 CHECK (deposit >= 0),
    status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (end_date IS NULL OR end_date >= start_date)
  );
  CREATE INDEX idx_tenancies_room ON tenancies(room_id);
  CREATE INDEX idx_tenancies_tenant ON tenancies(tenant_id);
  -- A tenant can have at most one active stay.
  CREATE UNIQUE INDEX uq_tenancies_one_active ON tenancies(tenant_id) WHERE status = 'active';

  -- One rent charge per tenancy per month (period = 'YYYY-MM').
  CREATE TABLE payments (
    id          INTEGER PRIMARY KEY,
    tenancy_id  INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
    period      TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    amount_due  INTEGER NOT NULL CHECK (amount_due >= 0),
    amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
    due_date    TEXT    NOT NULL,
    paid_on     TEXT,
    method      TEXT,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenancy_id, period)
  );

  CREATE TABLE complaints (
    id          INTEGER PRIMARY KEY,
    tenancy_id  INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'other'
                CHECK (category IN ('electrical', 'plumbing', 'cleaning', 'internet', 'furniture', 'food', 'other')),
    status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    owner_reply TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_complaints_tenancy ON complaints(tenancy_id);

  CREATE TABLE notices (
    id          INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_notices_property ON notices(property_id);
  `,
  `
  -- Day of the month rent is due (1-28) for this stay.
  ALTER TABLE tenancies ADD COLUMN due_day INTEGER NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 28);

  -- A tenant's request to leave. Only one pending request per stay.
  CREATE TABLE vacate_requests (
    id             INTEGER PRIMARY KEY,
    tenancy_id     INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
    requested_date TEXT    NOT NULL,
    reason         TEXT,
    status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    owner_note     TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    decided_at     TEXT
  );
  CREATE INDEX idx_vacate_tenancy ON vacate_requests(tenancy_id);
  CREATE UNIQUE INDEX uq_vacate_one_pending ON vacate_requests(tenancy_id) WHERE status = 'pending';
  `,
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
