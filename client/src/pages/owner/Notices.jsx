import { useState } from 'react';
import { Alert, Async, Button, Card, Empty, Field, FormModal, PageHeader, useConfirm, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

function NewNotice({ pg, onClose, onSaved }) {
  const form = useForm({ title: '', body: '' }, async (v) => {
    await api('/owner/notices', { method: 'POST', body: { ...v, property_id: pg.id } });
    onSaved();
  });
  return (
    <FormModal open title="Post a notice" onClose={onClose} form={form} submitLabel="Post notice">
      <p className="text-sm text-slate-500">All current tenants of {pg.name} will see it.</p>
      <Field form={form} name="title" label="Title" required />
      <Field form={form} name="body" label="Message" as="textarea" required />
    </FormModal>
  );
}

export default function Notices() {
  const state = useApi('/owner/notices');
  const pgState = useApi('/owner/pg');
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();
  const pg = pgState.data?.pg || null;

  return (
    <div>
      <PageHeader
        title="Notices"
        subtitle="Announcements shown on your tenants' dashboards."
        actions={
          <Button onClick={() => setAdding(true)} disabled={!pg}>
            + Post notice
          </Button>
        }
      />
      {!pgState.loading && !pg && <Alert tone="info">Set up your PG details before posting notices.</Alert>}
      <Async state={state}>
        {({ notices }) =>
          notices.length === 0 ? (
            <Empty title="No notices posted yet." />
          ) : (
            <div className="space-y-3">
              {notices.map((n) => (
                <Card key={n.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">{n.title}</h3>
                      <p className="text-xs text-slate-500">
                        {n.property_name} · {formatDate(n.created_at)}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() =>
                        confirm.ask({
                          title: 'Delete notice?',
                          message: n.title,
                          confirmLabel: 'Delete',
                          onConfirm: async () => {
                            await api(`/owner/notices/${n.id}`, { method: 'DELETE' });
                            state.reload();
                          },
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      {adding && pg && (
        <NewNotice
          pg={pg}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            state.reload();
          }}
        />
      )}
      {confirm.element}
    </div>
  );
}
