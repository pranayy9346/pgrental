import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Async, Badge, Button, Card, Empty, PageHeader, Stat, Table } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate, formatPeriod, money } from '../../lib/format.js';

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const state = useApi('/owner/dashboard');
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null);

  async function generate(period) {
    setGenerating(true);
    setMessage(null);
    try {
      const r = await api('/owner/payments/generate', { method: 'POST', body: { period } });
      setMessage({ tone: 'success', text: `Created ${r.created} rent charge(s) for ${formatPeriod(r.period)}.` });
      state.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Async state={state}>
      {({ period, stats, overdue, recentComplaints }) => {
        const vacant = stats.total_beds - stats.occupied_beds;
        const pct = stats.total_beds ? Math.round((stats.occupied_beds / stats.total_beds) * 100) : 0;
        return (
          <div className="space-y-6">
            <PageHeader
              title="Dashboard"
              subtitle={`Overview for ${formatPeriod(period)}`}
              actions={<Button onClick={() => navigate('/owner/tenants?add=1')}>+ Add Tenant</Button>}
            />

            {stats.properties === 0 ? (
              <Alert tone="info">
                Welcome! Step 1:{' '}
                <Link to="/owner/pg" className="font-semibold underline">
                  set up your PG details
                </Link>
                , then add floors and rooms, then tenants.
              </Alert>
            ) : stats.rooms === 0 ? (
              <Alert tone="info">
                Step 2:{' '}
                <Link to="/owner/rooms" className="font-semibold underline">
                  add rooms to your floors
                </Link>
                , then add tenants.
              </Alert>
            ) : (
              stats.occupied_beds === 0 && (
                <Alert tone="info">
                  Step 3: use <b>+ Add Tenant</b> to add your first tenant. They register themselves with the email you enter.
                </Alert>
              )
            )}

            {stats.missing_charges > 0 && (
              <Alert tone="warning">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    {stats.missing_charges} active tenant(s) have no rent charge for {formatPeriod(period)} yet.
                  </span>
                  <Button size="sm" loading={generating} onClick={() => generate(period)}>
                    Create this month&apos;s rent charges
                  </Button>
                </div>
              </Alert>
            )}
            {stats.pending_vacates > 0 && (
              <Alert tone="warning">
                {stats.pending_vacates} tenant(s) have asked to move out.{' '}
                <Link to="/owner/vacate-requests" className="font-semibold underline">
                  Review move-out requests
                </Link>
              </Alert>
            )}
            {message && <Alert tone={message.tone}>{message.text}</Alert>}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Rooms" value={stats.rooms} sub={`${stats.total_beds} beds`} />
              <Stat
                label="Beds occupied"
                value={`${stats.occupied_beds} / ${stats.total_beds}`}
                sub={`${pct}% occupancy · ${vacant} vacant`}
                tone="indigo"
              />
              <Stat
                label="Collected this month"
                value={money(stats.month_collected)}
                sub={`of ${money(stats.month_due)} due`}
                tone="green"
              />
              <Stat
                label="Total outstanding"
                value={money(stats.total_outstanding)}
                sub={`${stats.open_complaints} open complaint(s)`}
                tone={stats.total_outstanding > 0 ? 'red' : 'green'}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card
                title="Overdue rent"
                actions={
                  <Link to="/owner/payments?period=&status=unpaid" className="text-sm text-indigo-600 hover:underline">
                    View all
                  </Link>
                }
              >
                <Table
                  rows={overdue}
                  empty="No overdue rent. 🎉"
                  columns={[
                    {
                      key: 'tenant',
                      label: 'Tenant',
                      render: (r) => (
                        <Link to={`/owner/tenants/${r.tenant_id}`} className="font-medium text-indigo-600 hover:underline">
                          {r.tenant_name}
                        </Link>
                      ),
                    },
                    { key: 'room', label: 'Room', render: (r) => `${r.property_name} · ${r.room_number}` },
                    { key: 'period', label: 'Month', render: (r) => formatPeriod(r.period) },
                    { key: 'due', label: 'Balance', render: (r) => money(r.amount_due - r.amount_paid) },
                    { key: 'due_date', label: 'Due', render: (r) => formatDate(r.due_date) },
                  ]}
                />
              </Card>

              <Card
                title="Open complaints"
                actions={
                  <Link to="/owner/complaints" className="text-sm text-indigo-600 hover:underline">
                    View all
                  </Link>
                }
              >
                {recentComplaints.length === 0 ? (
                  <Empty title="No open complaints." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {recentComplaints.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div>
                          <p className="font-medium text-slate-800">{c.title}</p>
                          <p className="text-xs text-slate-500">
                            {c.tenant_name} · {c.property_name} {c.room_number} · {formatDate(c.created_at)}
                          </p>
                        </div>
                        <Badge status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
