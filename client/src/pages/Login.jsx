import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Alert, Button, Field, Icon, useForm } from '../components/ui.jsx';
import { homeFor, useAuth } from '../lib/auth.jsx';

const highlights = [
  ['card', 'Rent, tracked', 'Monthly charges, part payments and what is still due.'],
  ['message', 'Complaints, handled', 'Tenants report problems; you reply and track them.'],
  ['logout', 'Move-outs, simple', 'Requests, approvals and a clear stay history.'],
];

// Shared by the login and tenant-registration pages: a brand panel on large screens, a compact header on phones.
export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Icon name="building" className="h-6 w-6" />
          </span>
          <p className="text-xl font-bold">PG Manager</p>
        </div>
        <div>
          <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight">Run your PG without the paperwork.</h2>
          <ul className="mt-10 max-w-md space-y-6">
            {highlights.map(([icon, head, text]) => (
              <li key={head} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <Icon name={icon} className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">{head}</p>
                  <p className="text-sm text-indigo-100">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-indigo-200">PG &amp; hostel rental management</p>
      </aside>

      <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4 py-10 sm:px-6 lg:min-h-0 lg:bg-none lg:bg-white">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
              <Icon name="building" className="h-7 w-7" />
            </span>
            <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">PG Manager</p>
            <p className="text-sm text-slate-500">PG &amp; hostel rental management</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ email: '', password: '' }, async (v) => {
    const u = await login(v.email, v.password);
    const from = location.state?.from;
    navigate(from?.startsWith(homeFor(u)) ? from : homeFor(u), { replace: true });
  });

  if (user) return <Navigate to={homeFor(user)} replace />;

  return (
    <AuthShell title="Log in" subtitle="Owner and tenant login.">
      <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
        <Alert>{form.error}</Alert>
        <Field form={form} name="email" label="Email" type="email" autoComplete="email" required />
        <Field form={form} name="password" label="Password" type="password" autoComplete="current-password" required />
        <Button type="submit" className="w-full" loading={form.submitting}>
          Log in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Tenant?{' '}
        <Link to="/register/tenant" className="font-medium text-indigo-600 hover:underline">
          Register here
        </Link>{' '}
        with the email and invite code from your PG owner.
      </p>
    </AuthShell>
  );
}
