import { useEffect, useId, useState } from 'react';
import { labels } from '../lib/format.js';

// ---------- Form state ----------
// const form = useForm({ name: '' }, async (values) => { await api(...); });
// <Field form={form} name="name" label="Name" />   <form onSubmit={form.handleSubmit}>
export function useForm(initial, onSubmit) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e?.preventDefault();
    setSubmitting(true);
    setErrors({});
    setError('');
    try {
      await onSubmit(values);
    } catch (err) {
      setErrors(err.details || {});
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const setValue = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  return { values, setValues, setValue, errors, error, submitting, handleSubmit, reset: () => setValues(initial) };
}

// ---------- Inputs ----------
const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100';

export function Field({ form, name, label, type = 'text', as, options, hint, required, ...rest }) {
  const id = useId();
  const error = form.errors[name];
  const common = {
    id,
    name,
    value: form.values[name] ?? '',
    onChange: (e) => form.setValue(name, e.target.value),
    className: `${inputClass} ${error ? 'border-red-400' : ''}`,
    'aria-invalid': Boolean(error),
    required,
    ...rest,
  };
  let control;
  if (as === 'select') {
    control = (
      <select {...common}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (as === 'textarea') {
    control = <textarea rows={4} {...common} />;
  } else {
    control = <input type={type} {...common} />;
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

// ---------- Buttons ----------
const buttonVariants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-indigo-600 hover:bg-indigo-50',
};

export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...rest }) {
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

// ---------- Layout pieces ----------
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900',
    green: 'text-emerald-600',
    red: 'text-red-600',
    amber: 'text-amber-600',
    indigo: 'text-indigo-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const badgeTones = {
  paid: 'bg-emerald-100 text-emerald-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  active: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-amber-100 text-amber-700',
  pending: 'bg-red-100 text-red-700',
  open: 'bg-red-100 text-red-700',
  ended: 'bg-slate-100 text-slate-600',
  vacant: 'bg-emerald-100 text-emerald-700',
  full: 'bg-slate-200 text-slate-700',
};

export function Badge({ status, children }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[status] || 'bg-slate-100 text-slate-700'}`}
    >
      {children ?? labels[status] ?? status}
    </span>
  );
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

// Shows loading / error states for a useApi() result, otherwise renders children(data).
export function Async({ state, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error)
    return (
      <div className="space-y-3">
        <Alert>{state.error.message}</Alert>
        <Button variant="secondary" onClick={state.reload}>
          Try again
        </Button>
      </div>
    );
  return children(state.data);
}

export function Table({ columns, rows, rowKey = (r) => r.id, empty = 'Nothing here yet.' }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${c.className || ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 align-top text-slate-700 ${c.className || ''}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, title, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// A modal with a form and Cancel / Save buttons.
export function FormModal({ open, title, onClose, form, submitLabel = 'Save', children, wide }) {
  return (
    <Modal open={open} title={title} onClose={onClose} wide={wide}>
      <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
        <Alert>{form.error}</Alert>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Confirm dialog for destructive actions. Usage: const confirm = useConfirm(); ... {confirm.element}
export function useConfirm() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = (opts) => {
    setError('');
    setState(opts);
  };
  const close = () => setState(null);

  const element = (
    <Modal open={Boolean(state)} title={state?.title || 'Are you sure?'} onClose={close}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="text-sm text-slate-600">{state?.message}</div>
        {state?.children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={state?.variant || 'danger'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await state.onConfirm();
                close();
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {state?.confirmLabel || 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
  return { ask, element };
}
