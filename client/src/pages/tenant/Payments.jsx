import { Async, Badge, Button, Card, NewTag, PageHeader, Table } from '../../components/ui.jsx';
import { useApi } from '../../lib/api.js';
import { formatDate, formatPeriod, labels, money } from '../../lib/format.js';
import { useUnreadEntities } from '../../lib/notifications.jsx';

export default function TenantPayments() {
  const state = useApi('/tenant/payments');
  const unread = useUnreadEntities('payments');
  return (
    <div>
      <PageHeader title="My Payments" subtitle="Your monthly rent charges and what has been paid. Payments are recorded by your PG owner." />
      <Card>
        <Async state={state}>
          {({ payments }) => {
            const balance = payments.reduce((s, p) => s + p.amount_due - p.amount_paid, 0);
            return (
              <>
                <p className="mb-3 text-sm">
                  Total balance due:{' '}
                  <b className={balance > 0 ? 'text-red-600' : 'text-emerald-600'}>{money(balance)}</b>
                </p>
                <Table
                  rows={payments}
                  empty="No rent charges yet."
                  columns={[
                    {
                      key: 'period',
                      label: 'Month',
                      render: (p) => (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {formatPeriod(p.period)}
                          {unread.isUnread('payment', p.id) && <NewTag />}
                        </span>
                      ),
                    },
                    { key: 'room', label: 'Room', render: (p) => `${p.property_name} · ${p.room_number}` },
                    {
                      key: 'amount_due',
                      label: 'Amount',
                      render: (p) => (
                        <div>
                          {money(p.amount_due)}
                          {p.note && <div className="text-xs text-slate-500">{p.note}</div>}
                        </div>
                      ),
                    },
                    { key: 'amount_paid', label: 'Paid', render: (p) => money(p.amount_paid) },
                    { key: 'balance', label: 'Balance', render: (p) => money(p.amount_due - p.amount_paid) },
                    { key: 'status', label: 'Status', render: (p) => <Badge status={p.status} /> },
                    {
                      key: 'date',
                      label: 'Paid on / due',
                      render: (p) =>
                        p.paid_on
                          ? `${formatDate(p.paid_on)}${p.method ? ` · ${labels[p.method]}` : ''}`
                          : `Due ${formatDate(p.due_date)}`,
                    },
                    {
                      // Only shown for a payment with an unread notification; an explicit action, never automatic.
                      key: 'mark_read',
                      label: '',
                      className: 'text-right whitespace-nowrap',
                      render: (p) =>
                        unread.isUnread('payment', p.id) ? (
                          <Button size="sm" variant="secondary" onClick={() => unread.markRead('payment', p.id)}>
                            Mark as read
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              </>
            );
          }}
        </Async>
      </Card>
    </div>
  );
}
