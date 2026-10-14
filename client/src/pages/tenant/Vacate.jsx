import { useState } from 'react';
import { Alert, Async, Badge, Button, Card, Empty, Field, NewTag, PageHeader, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate, todayISO } from '../../lib/format.js';
import { useUnreadEntities } from '../../lib/notifications.jsx';

const tones = { pending: 'pending', approved: 'paid', rejected: 'ended', cancelled: 'ended' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function RequestForm({ onDone }) {
  const form = useForm({ requested_date: todayISO(), reason: '' }, async (v) => {
    await api('/tenant/vacate-requests', { method: 'POST', body: v });
    onDone();
  });
  return (
    <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
      <Alert>{form.error}</Alert>
      <Field form={form} name="requested_date" label="Date you want to move out" type="date" min={todayISO()} required />
      <Field form={form} name="reason" label="Reason (optional)" as="textarea" />
      <Button type="submit" loading={form.submitting}>
        Send request to owner
      </Button>
    </form>
  );
}

export default function Vacate() {
  const state = useApi('/tenant/vacate-requests');
  const dash = useApi('/tenant/dashboard');
  const unread = useUnreadEntities('moveout');
  const [sent, setSent] = useState(false);
  const confirm = useConfirm();

  const reload = () => {
    state.reload();
    dash.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Move Out" subtitle="Ask your PG owner to end your stay. Your stay ends only after the owner approves." />
      <Async state={state}>
        {({ requests }) => {
          const pending = requests.find((r) => r.status === 'pending');
          const hasStay = Boolean(dash.data?.stay);
          return (
            <>
              {sent && <Alert tone="success">Request sent. Your owner will approve or reject it.</Alert>}
              {pending ? (
                <Alert tone="info">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      You asked to move out on <b>{formatDate(pending.requested_date)}</b>. Waiting for the owner&apos;s decision.
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        confirm.ask({
                          title: 'Cancel your request?',
                          message: 'You will stay in your room. You can send a new request later.',
                          confirmLabel: 'Cancel request',
                          onConfirm: async () => {
                            await api(`/tenant/vacate-requests/${pending.id}/cancel`, { method: 'POST' });
                            setSent(false);
                            reload();
                          },
                        })
                      }
                    >
                      Cancel request
                    </Button>
                  </div>
                </Alert>
              ) : hasStay ? (
                <Card title="Request to move out">
                  <RequestForm
                    onDone={() => {
                      setSent(true);
                      reload();
                    }}
                  />
                </Card>
              ) : (
                !dash.loading && <Alert tone="info">You do not have an active stay.</Alert>
              )}

              <Card title="Your requests">
                {requests.length === 0 ? (
                  <Empty title="No requests yet." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {requests.map((r) => (
                      <li key={r.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <b>Move out on {formatDate(r.requested_date)}</b>
                          <Badge status={tones[r.status]}>{cap(r.status)}</Badge>
                          {unread.isUnread('vacate_request', r.id) && <NewTag />}
                        </div>
                        <p className="text-xs text-slate-500">
                          {r.property_name} · Room {r.room_number} · Sent {formatDate(r.created_at)}
                        </p>
                        {r.reason && <p className="mt-1 text-sm text-slate-600">Reason: {r.reason}</p>}
                        {r.owner_note && (
                          <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">
                            <b>Owner&apos;s note:</b> {r.owner_note}
                          </p>
                        )}
                        {unread.isUnread('vacate_request', r.id) && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="secondary" onClick={() => unread.markRead('vacate_request', r.id)}>
                              Mark as read
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          );
        }}
      </Async>
      {confirm.element}
    </div>
  );
}
