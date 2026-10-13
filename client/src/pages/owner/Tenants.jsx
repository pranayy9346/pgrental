import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Async, Badge, Button, Card, Field, FormModal, Loading, Modal, PageHeader, Table, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';
import { floorLabel, formatDate, money, todayISO } from '../../lib/format.js';

// Room / start date / rent / deposit fields, shared by "Add tenant" and "Assign / change room".
export function AssignmentFields({ form, currentRoomId, optional }) {
  const rooms = useApi('/owner/rooms');
  if (rooms.loading) return <Loading label="Loading rooms…" />;
  if (rooms.error) return <Alert>{rooms.error.message}</Alert>;
  if (!rooms.data.rooms.length) {
    return (
      <Alert tone="info">
        You have no rooms yet.{' '}
        <Link to="/owner/rooms" className="underline">
          Add floors and rooms
        </Link>{' '}
        first. You can also add the tenant now and assign a room later.
      </Alert>
    );
  }

  const options = [
    { value: '', label: optional ? '— No room yet (assign later) —' : '— Choose a room —' },
    ...rooms.data.rooms.map((r) => {
      const free = r.capacity - r.occupied;
      return {
        value: String(r.id),
        label: `${floorLabel(r.floor)} · Room ${r.room_number} · ${money(r.monthly_rent)} · ${free > 0 ? `${free} bed(s) free` : 'FULL'}`,
        disabled: free <= 0 || r.id === currentRoomId,
      };
    }),
  ];

  const onRoomChange = (value) => {
    form.setValue('room_id', value);
    const room = rooms.data.rooms.find((r) => String(r.id) === value);
    if (room) form.setValue('monthly_rent', String(room.monthly_rent));
  };

  return (
    <>
      <Field form={form} name="room_id" label="Room" as="select" options={options} onChange={(e) => onRoomChange(e.target.value)} />
      {form.values.room_id && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field form={form} name="start_date" label="Move-in date" type="date" required />
          <Field form={form} name="monthly_rent" label="Monthly rent (₹)" type="number" min="0" hint="Defaults to the room rent" />
          <Field form={form} name="deposit" label="Deposit (₹)" type="number" min="0" />
          <Field form={form} name="due_day" label="Rent due day of month" type="number" min="1" max="28" hint="1-28, default 5" />
        </div>
      )}
    </>
  );
}

// Turns form strings into the API body: empty optional numbers are left out.
export function assignmentBody(v) {
  const body = { room_id: Number(v.room_id), start_date: v.start_date };
  if (v.monthly_rent !== '') body.monthly_rent = v.monthly_rent;
  if (v.deposit !== '') body.deposit = v.deposit;
  if (v.due_day !== '') body.due_day = v.due_day;
  return body;
}

function AddTenant({ onClose, onCreated }) {
  const navigate = useNavigate();
  const [created, setCreated] = useState(null);
  const form = useForm(
    { name: '', email: '', phone: '', room_id: '', start_date: todayISO(), monthly_rent: '', deposit: '', due_day: '' },
    async (v) => {
      const body = { name: v.name, email: v.email, phone: v.phone };
      if (v.room_id) Object.assign(body, assignmentBody(v));
      const d = await api('/owner/tenants', { method: 'POST', body });
      setCreated(d);
      onCreated();
    },
  );

  if (created) {
    return (
      <Modal open title="Tenant added" onClose={onClose}>
        <div className="space-y-4">
          <Alert tone="success">
            <b>{created.tenant.name}</b> has been added{created.tenant.room_id ? ` to Room ${created.tenant.room_number}` : ''}.
          </Alert>
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium">Next, ask {created.tenant.name} to register:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open the app and click <b>Tenant? Register here</b> on the login page.</li>
              <li>
                Enter this email: <b>{created.tenant.email}</b>
              </li>
              <li>Choose a password and click <b>Create my account</b>.</li>
            </ol>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate(`/owner/tenants/${created.tenant.id}`)}>
              Open tenant
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <FormModal open wide title="Add tenant" onClose={onClose} form={form} submitLabel="Add tenant">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field form={form} name="name" label="Tenant name" required />
        <Field form={form} name="phone" label="Phone (optional)" type="tel" />
      </div>
      <Field
        form={form}
        name="email"
        label="Email"
        type="email"
        hint="The tenant registers with exactly this email, so type it carefully."
        required
      />
      <AssignmentFields form={form} optional />
    </FormModal>
  );
}

export default function Tenants() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'active';
  const state = useApi(`/owner/tenants?status=${status}`);
  const [adding, setAdding] = useState(params.get('add') === '1');

  const tabs = [
    ['active', 'Current tenants'],
    ['past', 'Past / unassigned'],
    ['all', 'All'],
  ];

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Step 3 of 3 · Add a tenant's name and email, assign a room, and they register themselves."
        actions={<Button onClick={() => setAdding(true)}>+ Add tenant</Button>}
      />
      <div className="mb-4 flex gap-2">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setParams({ status: value })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        <Async state={state}>
          {({ tenants }) => (
            <Table
              rows={tenants}
              empty="No tenants in this list."
              columns={[
                {
                  key: 'name',
                  label: 'Name',
                  render: (t) => (
                    <Link to={`/owner/tenants/${t.id}`} className="font-medium text-indigo-600 hover:underline">
                      {t.name}
                    </Link>
                  ),
                },
                {
                  key: 'contact',
                  label: 'Contact',
                  render: (t) => (
                    <div>
                      <div>{t.phone || '—'}</div>
                      <div className="text-xs text-slate-500">{t.email}</div>
                    </div>
                  ),
                },
                {
                  key: 'room',
                  label: 'Room',
                  render: (t) =>
                    t.room_id ? `Room ${t.room_number}` : <Badge status="ended">Not staying</Badge>,
                },
                { key: 'rent', label: 'Rent', render: (t) => (t.room_id ? money(t.monthly_rent) : '—') },
                { key: 'since', label: 'Since', render: (t) => (t.room_id ? formatDate(t.start_date) : '—') },
                {
                  key: 'account',
                  label: 'Account',
                  render: (t) =>
                    t.registered_at ? <Badge status="paid">Registered</Badge> : <Badge status="partial">Invited, not registered</Badge>,
                },
                {
                  key: 'balance',
                  label: 'Balance due',
                  render: (t) => (
                    <span className={t.balance_due > 0 ? 'font-medium text-red-600' : 'text-slate-500'}>
                      {money(t.balance_due)}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Async>
      </Card>
      {adding && (
        <AddTenant
          onClose={() => {
            setAdding(false);
            if (params.has('add')) {
              const next = new URLSearchParams(params);
              next.delete('add');
              setParams(next, { replace: true });
            }
          }}
          // Show "All" so a tenant added without a room doesn't seem to disappear.
          onCreated={() => (status === 'all' ? state.reload() : setParams({ status: 'all' }))}
        />
      )}
    </div>
  );
}
