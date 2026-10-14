import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Async, Badge, Button, Card, Empty, Field, FormModal, NewTag, PageHeader, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate, money } from '../../lib/format.js';
import { useNotifications, useUnreadEntities } from '../../lib/notifications.jsx';

const tones = { pending: 'pending', approved: 'paid', rejected: 'ended', cancelled: 'ended' };

function Decide({ request, action, onClose, onSaved }) {
  const approve = action === 'approve';
  const form = useForm({ owner_note: '' }, async (v) => {
    await api(`/owner/vacate-requests/${request.id}/${action}`, { method: 'POST', body: v });
    onSaved();
  });
  return (
    <FormModal
      open
      title={approve ? 'Approve move-out' : 'Reject move-out'}
      onClose={onClose}
      form={form}
      submitLabel={approve ? 'Approve & end stay' : 'Reject request'}
    >
      <p className="text-sm text-slate-700">
        <b>{request.tenant_name}</b> · {request.property_name} · Room {request.room_number}
      </p>
      {approve ? (
        <Alert tone="info">
          Approving ends their stay on <b>{formatDate(request.requested_date)}</b> and frees the bed. Their login and rent history
          are kept.
        </Alert>
      ) : (
        <p className="text-sm text-slate-600">The tenant keeps their room and will see your note.</p>
      )}
      {approve && request.balance_due > 0 && (
        <Alert tone="warning">This tenant still owes {money(request.balance_due)}. It stays on record after they leave.</Alert>
      )}
      <Field form={form} name="owner_note" label="Note to tenant (optional)" as="textarea" />
    </FormModal>
  );
}

export default function VacateRequests() {
  const state = useApi('/owner/vacate-requests');
  const unread = useUnreadEntities('moveout');
  const { refresh: refreshCounts } = useNotifications();
  const [dialog, setDialog] = useState(null); // { request, action }

  return (
    <div>
      <PageHeader title="Move-out Requests" subtitle="Tenants who have asked to leave. Approving ends their stay on the date they chose." />
      <Async state={state}>
        {({ requests }) =>
          requests.length === 0 ? (
            <Empty title="No move-out requests." />
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <Card key={r.id} className={unread.isUnread('vacate_request', r.id) ? 'ring-2 ring-red-500/30' : ''}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/owner/tenants/${r.tenant_id}`} className="font-semibold text-indigo-600 hover:underline">
                          {r.tenant_name}
                        </Link>
                        <Badge status={tones[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
                        {unread.isUnread('vacate_request', r.id) && <NewTag />}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {r.property_name} · Room {r.room_number} · wants to leave on <b>{formatDate(r.requested_date)}</b>
                        <span className="text-slate-400"> (asked {formatDate(r.created_at)})</span>
                      </p>
                      {r.reason && <p className="mt-2 text-sm text-slate-700">Reason: {r.reason}</p>}
                      <p className={`mt-1 text-sm ${r.balance_due > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        Outstanding rent: {money(r.balance_due)}
                      </p>
                      {r.owner_note && <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">Your note: {r.owner_note}</p>}
                    </div>
                    {(r.status === 'pending' || unread.isUnread('vacate_request', r.id)) && (
                      <div className="flex flex-wrap gap-2">
                        {unread.isUnread('vacate_request', r.id) && (
                          <Button size="sm" variant="ghost" onClick={() => unread.markRead('vacate_request', r.id)}>
                            Mark as read
                          </Button>
                        )}
                        {r.status === 'pending' && (
                          <>
                            <Button size="sm" onClick={() => setDialog({ request: r, action: 'approve' })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setDialog({ request: r, action: 'reject' })}>
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      {dialog && (
        <Decide
          {...dialog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            state.reload();
            refreshCounts().catch(() => {}); // deciding a request acknowledges its notification on the server
          }}
        />
      )}
    </div>
  );
}
