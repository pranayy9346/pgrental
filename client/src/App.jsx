import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { AuthProvider, homeFor, useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import TenantRegister from './pages/TenantRegister.jsx';
import OwnerComplaints from './pages/owner/Complaints.jsx';
import OwnerDashboard from './pages/owner/Dashboard.jsx';
import OwnerNotices from './pages/owner/Notices.jsx';
import OwnerPayments from './pages/owner/Payments.jsx';
import PgDetails from './pages/owner/PgDetails.jsx';
import Rooms from './pages/owner/Rooms.jsx';
import TenantDetail from './pages/owner/TenantDetail.jsx';
import Tenants from './pages/owner/Tenants.jsx';
import VacateRequests from './pages/owner/VacateRequests.jsx';
import TenantComplaints from './pages/tenant/Complaints.jsx';
import TenantDashboard from './pages/tenant/Dashboard.jsx';
import TenantNotices from './pages/tenant/Notices.jsx';
import TenantPayments from './pages/tenant/Payments.jsx';
import TenantVacate from './pages/tenant/Vacate.jsx';

function Home() {
  const { user, checking } = useAuth();
  if (checking) return <Loading />;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
      <h1 className="text-2xl font-semibold text-slate-800">Page not found</h1>
      <Link to="/" className="text-indigo-600 hover:underline">
        Go to my dashboard
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register/tenant" element={<TenantRegister />} />

          <Route path="/owner" element={<Layout role="owner" />}>
            <Route index element={<OwnerDashboard />} />
            <Route path="pg" element={<PgDetails />} />
            <Route path="rooms" element={<Rooms />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="tenants/:id" element={<TenantDetail />} />
            <Route path="payments" element={<OwnerPayments />} />
            <Route path="complaints" element={<OwnerComplaints />} />
            <Route path="vacate-requests" element={<VacateRequests />} />
            <Route path="notices" element={<OwnerNotices />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="/tenant" element={<Layout role="tenant" />}>
            <Route index element={<TenantDashboard />} />
            <Route path="payments" element={<TenantPayments />} />
            <Route path="complaints" element={<TenantComplaints />} />
            <Route path="vacate" element={<TenantVacate />} />
            <Route path="notices" element={<TenantNotices />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
