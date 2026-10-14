import { useEffect, useId, useRef, useState } from 'react';
import { badgeText, labels } from '../lib/format.js';

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

// ---------- Icons ----------
// Small inline icon set (24x24 outline icons). Decorative by default: pass `label` to make one readable by screen readers.
const iconPaths = {
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  building: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01', 'M9 18v.01'],
  layers: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  card: ['M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M1 10h22'],
  wallet: ['M20 12V8H6a2 2 0 0 1 0-4h12v4', 'M4 6v12a2 2 0 0 0 2 2h14v-4', 'M18 12a2 2 0 0 0 0 4h4v-4z'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z', 'M15.5 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'],
  bed: ['M2 4v16', 'M2 8h18a2 2 0 0 1 2 2v10', 'M2 17h20', 'M6 8v9'],
  menu: ['M3 12h18', 'M3 6h18', 'M3 18h18'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: [
    'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94',
    'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19',
    'M14.12 14.12a3 3 0 1 1-4.24-4.24',
    'M1 1l22 22',
  ],
  checkCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  alertTriangle: ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  alertCircle: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
};

export function Icon({ name, className = 'h-5 w-5', label }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {(iconPaths[name] || []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// ---------- Inputs ----------
// 16px text on phones (smaller text makes iOS zoom the page when a field is focused), 14px from the sm breakpoint up.
const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm transition ' +
  'placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 sm:py-2 sm:text-sm';

export function Field({ form, name, label, type = 'text', as, options, hint, required, ...rest }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const error = form.errors[name];
  const isPassword = type === 'password' && !as;
  const common = {
    id,
    name,
    value: form.values[name] ?? '',
    onChange: (e) => form.setValue(name, e.target.value),
    className: `${inputClass} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''} ${isPassword ? 'pr-11' : ''}`,
    'aria-invalid': Boolean(error),
    'aria-describedby': error || hint ? `${id}-note` : undefined,
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
  } else if (isPassword) {
    control = (
      <div className="relative">
        <input type={reveal ? 'text' : 'password'} {...common} />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-600"
          aria-label={reveal ? 'Hide password' : 'Show password'}
          aria-pressed={reveal}
        >
          <Icon name={reveal ? 'eyeOff' : 'eye'} className="h-5 w-5" />
        </button>
      </div>
    );
  } else {
    control = <input type={type} {...common} />;
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {error ? (
        <p id={`${id}-note`} className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="mt-1.5 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

// ---------- Buttons ----------
const buttonVariants = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800',
  ghost: 'text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100',
};

export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...rest }) {
  // Comfortable tap targets on phones, a little tighter on desktop.
  const sizes = { sm: 'min-h-9 px-3 py-1.5 text-xs sm:min-h-0 sm:px-2.5', md: 'min-h-11 px-4 py-2 text-sm sm:min-h-10' };
  return (
    <button
      type="button"
      className={`inline-flex max-w-full items-center justify-center gap-2 rounded-lg text-center font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${sizes[size]} ${className}`}
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
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500 sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

// `icon` (an Icon name) adds a tinted badge; `progress` (0-100) adds a thin bar, e.g. for occupancy.
export function Stat({ label, value, sub, tone = 'slate', icon, progress }) {
  const tones = {
    slate: ['text-slate-900', 'bg-slate-100 text-slate-600', 'bg-slate-400'],
    green: ['text-emerald-600', 'bg-emerald-50 text-emerald-600', 'bg-emerald-500'],
    red: ['text-red-600', 'bg-red-50 text-red-600', 'bg-red-500'],
    amber: ['text-amber-600', 'bg-amber-50 text-amber-600', 'bg-amber-500'],
    indigo: ['text-indigo-600', 'bg-indigo-50 text-indigo-600', 'bg-indigo-500'],
  };
  const [text, chip, bar] = tones[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 sm:rounded-xl ${chip}`}>
            <Icon name={icon} className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
        )}
      </div>
      <p className={`mt-2 break-words text-xl font-bold tracking-tight min-[400px]:text-2xl sm:text-3xl ${text}`}>{value}</p>
      {typeof progress === 'number' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const badgeTones = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  vacant: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  partial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  pending: 'bg-red-50 text-red-700 ring-red-600/20',
  open: 'bg-red-50 text-red-700 ring-red-600/20',
  ended: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  full: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

export function Badge({ status, children }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[status] || 'bg-slate-100 text-slate-700 ring-slate-500/20'}`}
    >
      {children ?? labels[status] ?? status}
    </span>
  );
}

// Red unread counter. Hidden at 0, "99+" above 99. By default it also adds a visually hidden sentence for screen readers
// ("3 unread"); pass `announce={false}` where the surrounding control already carries its own aria-label (the bell).
export function CountBadge({ count, label = 'unread', announce = true, className = '' }) {
  if (!count || count < 1) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-none text-white ${className}`}
      >
        {badgeText(count)}
      </span>
      {announce && <span className="sr-only">{`, ${count > 99 ? 'more than 99' : count} ${label}`}</span>}
    </>
  );
}

// Small "New" marker for a list item that has an unread notification.
export function NewTag() {
  return <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">New</span>;
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  const tones = {
    error: ['border-red-200 bg-red-50 text-red-800', 'alertCircle', 'text-red-500'],
    success: ['border-emerald-200 bg-emerald-50 text-emerald-900', 'checkCircle', 'text-emerald-500'],
    info: ['border-indigo-200 bg-indigo-50 text-indigo-900', 'info', 'text-indigo-500'],
    warning: ['border-amber-200 bg-amber-50 text-amber-900', 'alertTriangle', 'text-amber-500'],
  };
  const [box, icon, iconColor] = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${box}`}>
      <Icon name={icon} className={`mt-0.5 h-5 w-5 ${iconColor}`} />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
      <Icon name="inbox" className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

// Segmented filter control. tabs = [[value, label], ...]. Scrolls sideways on narrow screens instead of wrapping.
export function Tabs({ tabs, value, onChange, label = 'Filter' }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-scroll>
      <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-xl bg-slate-200/60 p-1">
        {tabs.map(([v, l]) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={value === v}
            onClick={() => onChange(v)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              value === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
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

// A table on wide screens (1024px and up). Below that every row becomes a stacked card, so nothing is squeezed or needs
// sideways scrolling: the first column is the card title, the other columns are "label: value" lines, and a column
// with an empty label (action buttons) is shown as a footer row. Pages only describe `columns`; they do not change.
export function Table({ columns, rows, rowKey = (r) => r.id, empty = 'Nothing here yet.' }) {
  if (!rows.length) return <Empty title={empty} />;
  const cell = (c, i) => {
    const base = 'px-3 py-3 align-top text-slate-700';
    if (i === 0) return `${base} max-lg:block max-lg:px-0 max-lg:pb-2 max-lg:pt-0 max-lg:text-base max-lg:font-semibold max-lg:text-slate-900`;
    if (!c.label)
      return `${base} max-lg:flex max-lg:flex-wrap max-lg:justify-end max-lg:gap-1 max-lg:whitespace-normal max-lg:border-t max-lg:border-slate-100 max-lg:px-0 max-lg:pb-0 max-lg:pt-3`;
    return `${base} max-lg:flex max-lg:items-start max-lg:justify-between max-lg:gap-4 max-lg:px-0 max-lg:py-1.5 max-lg:before:shrink-0 max-lg:before:pt-0.5 max-lg:before:text-xs max-lg:before:font-medium max-lg:before:text-slate-500 max-lg:before:content-[attr(data-label)]`;
  };
  return (
    <div className="lg:overflow-x-auto" data-scroll>
      <table className="w-full text-sm max-lg:block lg:min-w-full">
        <thead className="max-lg:sr-only">
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 first:rounded-tl-lg last:rounded-tr-lg ${c.className || ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 max-lg:block">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-slate-50/70 max-lg:block max-lg:py-4 max-lg:first:pt-0 max-lg:last:pb-0 max-lg:hover:bg-transparent">
              {columns.map((c, i) => {
                const content = c.render ? c.render(row) : row[c.key];
                // In the stacked layout an empty value (e.g. a room without notes) would leave a lonely label, so hide it.
                const blank = i > 0 && c.label && (content === '' || content == null || content === false);
                return (
                  <td key={c.key} data-label={c.label || undefined} className={`${cell(c, i)} ${blank ? 'max-lg:hidden' : ''} ${c.className || ''}`}>
                    <div className={i === 0 || !c.label ? 'contents' : 'max-lg:min-w-0 max-lg:break-words max-lg:text-right'}>{content}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Modal ----------
// A centred dialog on larger screens and a bottom sheet on phones. Escape closes it, the page behind does not scroll.
export function Modal({ open, title, onClose, children, wide }) {
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-[2px] sm:items-start sm:overflow-y-auto sm:p-4 sm:pt-16">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:max-h-none sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <h2 className="min-w-0 truncate font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
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
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
