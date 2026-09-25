import { Link, useRouteError } from 'react-router-dom';

export default function RouteError() {
  const error = useRouteError();
  return (
    <main className="auth">
      <section className="auth-card">
        <h1 className="auth-title">This page could not be displayed</h1>
        <p className="auth-error" role="alert">{error instanceof Error ? error.message : 'An unexpected page error occurred.'}</p>
        <p>Your saved orders are not changed by a page error. If checkout was interrupted, reopen it to resolve the saved attempt rather than placing a replacement order.</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
        <Link className="auth-guest" to="/">Return to the store</Link>
      </section>
    </main>
  );
}
