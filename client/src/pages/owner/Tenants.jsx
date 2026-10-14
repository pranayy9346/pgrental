import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Async, Badge, Button, Card, Field, FormModal, Icon, Loading, Modal, PageHeader, Table, Tabs, useForm } from '../../components/ui.jsx';
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

// A tenant who has not registered yet can only do so while their invite code is valid.
export const inviteIsValid = (t) => Boolean(t.invite_expires_at) && new Date(t.invite_expires_at) > new Date();

// Turns form strings into the API body: empty optional numbers are left out.
export function assignmentBody(v) {
  const body = { room_id: Number(v.room_id), start_date: v.start_date };
  if (v.monthly_rent !== '') body.monthly_rent = v.monthly_rent;
  if (v.deposit !== '') body.deposit = v.deposit;
  if (v.due_day !== '') body.due_day = v.due_day;
  return body;
}

// Shows an invite code the server has just issued. This is the only time it can be seen (the server keeps only a
// hash), so the owner copies the code, or a ready-made message with a registration link, and sends it to the tenant.
// The link carries the code after '#', which browsers never send to any server, so it stays out of access logs.
export function InviteCodePanel({ tenant, invite }) {
  const [copied, setCopied] = useState('');
  const validUntil = formatDate(invite.expires_at.slice(0, 10));
  const link = `${window.location.origin}/register/tenant#${new URLSearchParams({ email: tenant.email, code: invite.code })}`;
  const message =
    `Hi ${tenant.name}, please create your PG account: ${link}\n` +
    `Email: ${tenant.email}\nInvite code: ${invite.code} (works once, until ${validUntil}).`;

  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
      <p className="font-medium">Invite code for {tenant.name}</p>
      <p className="select-all font-mono text-2xl font-semibold tracking-widest text-slate-900">{invite.code}</p>
      <p>
        Works once, only together with <b>{tenant.email}</b>, until <b>{validUntil}</b>. Send it to {tenant.name} privately
        (in person, SMS or WhatsApp). <b>It is shown only now</b>: if it gets lost, create a new code from the tenant’s page.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => copy('code', invite.code)}>
          {copied === 'code' ? 'Code copied' : 'Copy code'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => copy('message', message)}>
          {copied === 'message' ? 'Message copied' : 'Copy message with link'}
        </Button>
      </div>
      {copied === 'failed' && <Alert>Copying is not available here. Select the code above and copy it by hand.</Alert>}
    </div>
  );
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
          <InviteCodePanel tenant={created.tenant} invite={created.invite} />
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium">{created.tenant.name} then registers:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Opens the link from your message, or clicks <b>Tenant? Register here</b> on the login page.
              </li>
              <li>
                Enters the email <b>{created.tenant.email}</b> and the invite code.
              </li>
              <li>Chooses a password and clicks <b>Create my account</b>.</li>
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
        subtitle="Step 3 of 3 · Add a tenant's name and email, assign a room, and send them their invite code to register."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Add tenant
          </Button>
        }
      />
      <Tabs tabs={tabs} value={status} onChange={(value) => setParams({ status: value })} label="Show tenants" />
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
                    t.registered_at ? (
                      <Badge status="paid">Registered</Badge>
                    ) : inviteIsValid(t) ? (
                      <Badge status="partial">Invited, not registered</Badge>
                    ) : (
                      <Badge status="ended">Invite code expired</Badge>
                    ),
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
