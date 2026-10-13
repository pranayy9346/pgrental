import { useState } from 'react';
import { Link } from 'react-router';
import { Async, Button, Empty, Field, FormModal, PageHeader, useForm } from '../../components/ui.jsx';
import { api, useApi } from '../../lib/api.js';

// Add / edit property dialog. Render it only while open so the form starts fresh each time.
export function PropertyForm({ property, onClose, onSaved }) {
  const form = useForm(
    {
      name: property?.name || '',
      address: property?.address || '',
      city: property?.city || '',
      description: property?.description || '',
    },
    async (v) => {
      const d = property
        ? await api(`/owner/properties/${property.id}`, { method: 'PATCH', body: v })
        : await api('/owner/properties', { method: 'POST', body: v });
      onSaved(d.property);
    },
  );
  return (
    <FormModal open title={property ? 'Edit property' : 'Add property'} onClose={onClose} form={form}>
      <Field form={form} name="name" label="Property name" placeholder="e.g. Sunrise PG" required />
      <Field form={form} name="address" label="Address" required />
      <Field form={form} name="city" label="City" required />
      <Field form={form} name="description" label="Description" as="textarea" hint="Optional — facilities, rules, etc." />
    </FormModal>
  );
}

export default function Properties() {
  const state = useApi('/owner/properties');
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        title="Properties & Rooms"
        subtitle="Your PGs and hostels. Open a property to manage its rooms."
        actions={<Button onClick={() => setAdding(true)}>+ Add property</Button>}
      />
      <Async state={state}>
        {({ properties }) =>
          properties.length === 0 ? (
            <Empty title="No properties yet">
              <Button className="mt-2" onClick={() => setAdding(true)}>
                Add your first property
              </Button>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {properties.map((p) => {
                const vacant = p.total_beds - p.occupied_beds;
                return (
                  <Link
                    key={p.id}
                    to={`/owner/properties/${p.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
                  >
                    <h2 className="font-semibold text-slate-900">{p.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {p.address}, {p.city}
                    </p>
                    <div className="mt-4 flex gap-4 text-sm">
                      <span>
                        <b>{p.room_count}</b> rooms
                      </span>
                      <span>
                        <b>
                          {p.occupied_beds}/{p.total_beds}
                        </b>{' '}
                        beds filled
                      </span>
                      <span className={vacant > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                        <b>{vacant}</b> vacant
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )
        }
      </Async>
      {adding && (
        <PropertyForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            state.reload();
          }}
        />
      )}
    </div>
  );
}
