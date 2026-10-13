import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Alert, Button, Field, useForm } from '../components/ui.jsx';
import { homeFor, useAuth } from '../lib/auth.jsx';

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold text-indigo-700">PG Manager</p>
          <p className="text-sm text-slate-500">PG &amp; hostel rental management</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
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
    <AuthShell title="Log in" subtitle="Owners and tenants log in here.">
      <form onSubmit={form.handleSubmit} className="space-y-4" noValidate>
        <Alert>{form.error}</Alert>
        <Field form={form} name="email" label="Email" type="email" autoComplete="email" required />
        <Field form={form} name="password" label="Password" type="password" autoComplete="current-password" required />
        <Button type="submit" className="w-full" loading={form.submitting}>
          Log in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        PG owner without an account?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:underline">
          Create an owner account
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-slate-400">Tenants: your PG owner creates your login for you.</p>
    </AuthShell>
  );
}
