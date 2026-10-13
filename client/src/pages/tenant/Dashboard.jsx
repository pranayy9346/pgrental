import { Link } from 'react-router';
import { Alert, Async, Badge, Card, Empty, PageHeader, Stat } from '../../components/ui.jsx';
import { useApi } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate, formatPeriod, money, thisPeriod } from '../../lib/format.js';

export default function TenantDashboard() {
  const { user } = useAuth();
  const state = useApi('/tenant/dashboard');

  return (
    <Async state={state}>
      {({ stay, thisMonth, balanceDue, notices, openComplaints, vacateRequest }) => (
        <div className="space-y-6">
          <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Your stay at a glance" />

          {vacateRequest && (
            <Alert tone="info">
              Your move-out request for {formatDate(vacateRequest.requested_date)} is waiting for the owner.{' '}
              <Link to="/tenant/vacate" className="font-semibold underline">
                View
              </Link>
            </Alert>
          )}

          {!stay && (
            <Alert tone="info">
              You do not have an active stay right now. Your past payments are still available under “My Payments”.
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Monthly rent" value={stay ? money(stay.monthly_rent) : '—'} />
            <Stat
              label={`Rent for ${formatPeriod(thisPeriod())}`}
              value={thisMonth ? <Badge status={thisMonth.status} /> : '—'}
              sub={
                thisMonth
                  ? thisMonth.status === 'paid'
                    ? `Paid ${money(thisMonth.amount_paid)}`
                    : `${money(thisMonth.amount_due - thisMonth.amount_paid)} due by ${formatDate(thisMonth.due_date)}`
                  : 'Not billed yet'
              }
            />
            <Stat label="Total balance due" value={money(balanceDue)} tone={balanceDue > 0 ? 'red' : 'green'} />
            <Stat label="Open complaints" value={openComplaints} tone={openComplaints ? 'amber' : 'slate'} />
          </div>

          {stay && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="My room">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <dt className="text-slate-500">Property</dt>
                  <dd className="font-medium">{stay.property_name}</dd>
                  <dt className="text-slate-500">Address</dt>
                  <dd>
                    {stay.address}, {stay.city}
                  </dd>
                  <dt className="text-slate-500">Room</dt>
                  <dd className="font-medium">
                    {stay.room_number} ({stay.capacity}-sharing, {stay.occupied} staying)
                  </dd>
                  {stay.room_notes && (
                    <>
                      <dt className="text-slate-500">Room details</dt>
                      <dd>{stay.room_notes}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">Moved in</dt>
                  <dd>{formatDate(stay.start_date)}</dd>
                  <dt className="text-slate-500">Rent due</dt>
                  <dd>Day {stay.due_day} of each month</dd>
                  <dt className="text-slate-500">Deposit paid</dt>
                  <dd>{money(stay.deposit)}</dd>
                </dl>
              </Card>
              <Card title="PG owner contact">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">{stay.owner_name}</dd>
                  <dt className="text-slate-500">Phone</dt>
                  <dd>{stay.owner_phone ? <a href={`tel:${stay.owner_phone}`} className="text-indigo-600 hover:underline">{stay.owner_phone}</a> : '—'}</dd>
                  <dt className="text-slate-500">Email</dt>
                  <dd className="break-all">
                    <a href={`mailto:${stay.owner_email}`} className="text-indigo-600 hover:underline">
                      {stay.owner_email}
                    </a>
                  </dd>
                </dl>
                <p className="mt-4 text-sm">
                  Something broken?{' '}
                  <Link to="/tenant/complaints" className="font-medium text-indigo-600 hover:underline">
                    Raise a complaint →
                  </Link>
                </p>
              </Card>
            </div>
          )}

          {stay && (
            <Card
              title="Latest notices"
              actions={
                <Link to="/tenant/notices" className="text-sm text-indigo-600 hover:underline">
                  View all
                </Link>
              }
            >
              {notices.length === 0 ? (
                <Empty title="No notices from your PG." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {notices.map((n) => (
                    <li key={n.id} className="py-3">
                      <p className="font-medium text-slate-800">{n.title}</p>
                      <p className="text-xs text-slate-500">{formatDate(n.created_at)}</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </Async>
  );
}
