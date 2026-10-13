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

          {stay && (
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-indigo-100">Your room</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Room {stay.room_number}</p>
                  <p className="mt-1 break-words text-sm text-indigo-100">
                    {stay.property_name} · {stay.address}, {stay.city}
                  </p>
                </div>
                <div className="rounded-xl bg-white/15 px-4 py-3 ring-1 ring-white/20 sm:text-right">
                  <p className="text-xs font-medium uppercase tracking-wide text-indigo-100">Balance due</p>
                  <p className="text-2xl font-bold">{money(balanceDue)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Stat label="Monthly rent" value={stay ? money(stay.monthly_rent) : '—'} icon="wallet" />
            <Stat
              label={`Rent for ${formatPeriod(thisPeriod())}`}
              icon="card"
              value={thisMonth ? <Badge status={thisMonth.status} /> : '—'}
              sub={
                thisMonth
                  ? thisMonth.status === 'paid'
                    ? `Paid ${money(thisMonth.amount_paid)}`
                    : `${money(thisMonth.amount_due - thisMonth.amount_paid)} due by ${formatDate(thisMonth.due_date)}`
                  : 'Not billed yet'
              }
            />
            <Stat label="Total balance due" value={money(balanceDue)} tone={balanceDue > 0 ? 'red' : 'green'} icon="alertCircle" />
            <Stat label="Open complaints" value={openComplaints} tone={openComplaints ? 'amber' : 'slate'} icon="message" />
          </div>

          {stay && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="My room">
                <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-slate-500">Property</dt>
                  <dd className="break-words font-medium">{stay.property_name}</dd>
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
                <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
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
