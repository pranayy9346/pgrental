import { useState } from 'react';
import { Alert, Async, Badge, Button, Card, Empty, Field, FormModal, PageHeader, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { capitalize, complaintCategories, formatDate } from '../../lib/format.js';

function NewComplaint({ onClose, onSaved }) {
  const form = useForm({ title: '', category: 'other', description: '' }, async (v) => {
    await api('/tenant/complaints', { method: 'POST', body: v });
    onSaved();
  });
  return (
    <FormModal open title="Raise a complaint" onClose={onClose} form={form} submitLabel="Submit">
      <Field form={form} name="title" label="Short title" placeholder="e.g. Tap leaking in bathroom" required />
      <Field
        form={form}
        name="category"
        label="Category"
        as="select"
        options={complaintCategories.map((c) => ({ value: c, label: capitalize(c) }))}
      />
      <Field form={form} name="description" label="Details" as="textarea" required />
    </FormModal>
  );
}

export default function TenantComplaints() {
  const state = useApi('/tenant/complaints');
  const dash = useApi('/tenant/dashboard');
  const [adding, setAdding] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const hasStay = Boolean(dash.data?.stay);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Complaints"
        subtitle="Report maintenance problems to your PG owner and track their status."
        actions={
          <Button onClick={() => setAdding(true)} disabled={!hasStay}>
            + Raise complaint
          </Button>
        }
      />
      {!dash.loading && !hasStay && <Alert tone="info">You can raise complaints while you have an active stay.</Alert>}
      {submitted && <Alert tone="success">Complaint submitted. Your PG owner has been notified on their dashboard.</Alert>}
      <Async state={state}>
        {({ complaints }) =>
          complaints.length === 0 ? (
            <Empty title="You have not raised any complaints." />
          ) : (
            <div className="space-y-3">
              {complaints.map((c) => (
                <Card key={c.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{c.title}</h3>
                    <Badge status={c.status} />
                    <Badge>{capitalize(c.category)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {c.property_name} · Room {c.room_number} · Raised {formatDate(c.created_at)}
                    {c.updated_at !== c.created_at && ` · Updated ${formatDate(c.updated_at)}`}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{c.description}</p>
                  {c.owner_reply && (
                    <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">
                      <b>Owner&apos;s reply:</b> {c.owner_reply}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      {adding && (
        <NewComplaint
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setSubmitted(true);
            state.reload();
          }}
        />
      )}
    </div>
  );
}
