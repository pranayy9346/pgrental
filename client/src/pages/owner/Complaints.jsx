import { useState } from 'react';
import { Link } from 'react-router';
import { Async, Badge, Button, Card, Empty, Field, FormModal, PageHeader, Tabs, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { capitalize, formatDate, labels } from '../../lib/format.js';

function UpdateComplaint({ complaint, onClose, onSaved }) {
  const form = useForm({ status: complaint.status, owner_reply: complaint.owner_reply || '' }, async (v) => {
    await api(`/owner/complaints/${complaint.id}`, { method: 'PATCH', body: v });
    onSaved();
  });
  return (
    <FormModal open title={`Update: ${complaint.title}`} onClose={onClose} form={form}>
      <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{complaint.description}</p>
      <Field
        form={form}
        name="status"
        label="Status"
        as="select"
        options={['open', 'in_progress', 'resolved'].map((s) => ({ value: s, label: labels[s] }))}
      />
      <Field form={form} name="owner_reply" label="Reply to tenant" as="textarea" hint="The tenant sees this reply" />
    </FormModal>
  );
}

export default function Complaints() {
  const [filter, setFilter] = useState('');
  const state = useApi(`/owner/complaints${filter ? `?status=${filter}` : ''}`);
  const [editing, setEditing] = useState(null);

  const tabs = [
    ['', 'All'],
    ['open', 'Open'],
    ['in_progress', 'In progress'],
    ['resolved', 'Resolved'],
  ];

  return (
    <div>
      <PageHeader title="Complaints" subtitle="Maintenance requests and complaints raised by your tenants." />
      <Tabs tabs={tabs} value={filter} onChange={setFilter} label="Filter complaints" />
      <Async state={state}>
        {({ complaints }) =>
          complaints.length === 0 ? (
            <Empty title="No complaints here." />
          ) : (
            <div className="space-y-3">
              {complaints.map((c) => (
                <Card key={c.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{c.title}</h3>
                        <Badge status={c.status} />
                        <Badge>{capitalize(c.category)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        <Link to={`/owner/tenants/${c.tenant_id}`} className="text-indigo-600 hover:underline">
                          {c.tenant_name}
                        </Link>
                        {c.tenant_phone && ` (${c.tenant_phone})`} · {c.property_name} · Room {c.room_number} · {formatDate(c.created_at)}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{c.description}</p>
                      {c.owner_reply && (
                        <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">
                          <b>Your reply:</b> {c.owner_reply}
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                      Update
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      {editing && (
        <UpdateComplaint
          complaint={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}
    </div>
  );
}
