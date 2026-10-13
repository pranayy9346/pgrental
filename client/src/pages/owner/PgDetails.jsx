import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Async, Button, Card, Field, PageHeader, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';

// Step 1 of 3: PG Details -> Floors & Rooms -> Tenants
function PgForm({ pg, onSaved }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const form = useForm(
    {
      name: pg?.name || '',
      address: pg?.address || '',
      city: pg?.city || '',
      total_floors: String(pg?.total_floors ?? 1),
      description: pg?.description || '',
    },
    async (v) => {
      setSaved(false);
      await api('/owner/pg', { method: 'PUT', body: v });
      if (!pg) return navigate('/owner/rooms'); // first save: continue to step 2
      setSaved(true);
      onSaved();
    },
  );

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
      <Alert>{form.error}</Alert>
      {saved && <Alert tone="success">PG details saved.</Alert>}
      <Field form={form} name="name" label="PG name" placeholder="e.g. Sunrise PG" required />
      <Field form={form} name="address" label="Address" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field form={form} name="city" label="City" required />
        <Field
          form={form}
          name="total_floors"
          label="Number of floors"
          type="number"
          min="1"
          max="50"
          hint="Count the ground floor. You add rooms to each floor in the next step."
          required
        />
      </div>
      <Field form={form} name="description" label="Description" as="textarea" hint="Optional: facilities, rules, food timings…" />
      <Button type="submit" loading={form.submitting}>
        {pg ? 'Save changes' : 'Save and continue to rooms →'}
      </Button>
    </form>
  );
}

export default function PgDetails() {
  const state = useApi('/owner/pg');
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="PG Details"
        subtitle="Step 1 of 3 · You manage one PG. Next: floors & rooms, then tenants."
        actions={
          state.data?.pg && (
            <Link to="/owner/rooms">
              <span className="text-sm font-medium text-indigo-600 hover:underline">Next: Floors & Rooms →</span>
            </Link>
          )
        }
      />
      <Async state={state}>
        {({ pg }) => (
          <Card title={pg ? 'Your PG' : 'Set up your PG'}>
            {!pg && (
              <div className="mb-4">
                <Alert tone="info">Welcome! Start by entering the basic details of your PG.</Alert>
              </div>
            )}
            <PgForm pg={pg} onSaved={state.reload} />
          </Card>
        )}
      </Async>
    </div>
  );
}
