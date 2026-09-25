import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { signInPath } from './redirects';

export default function ProtectedRoute({ staff = false }: { staff?: boolean }) {
  const { user, role, loading, error, refreshRole } = useAuth();
  const location = useLocation();
  if (loading && (!user || staff)) return <p className="store-state" role="status">Checking your account…</p>;
  if (!user) return <Navigate to={signInPath(location.pathname + location.hash)} replace />;
  if (staff && (error || !role)) return (
    <section className="auth">
      <div className="auth-card">
        <h1 className="auth-title">Admin access unavailable</h1>
        <p role="alert">{error ?? 'Only active invited staff can open this area. Your customer account can still shop and view its own orders.'}</p>
        <button className="btn" onClick={() => void refreshRole()}>Check access again</button>
      </div>
    </section>
  );
  return <Outlet />;
}
