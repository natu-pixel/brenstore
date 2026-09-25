import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import { IconBrandTelegram, IconChevronRight, IconChevronsRight, IconCreditCard, IconHeadset, IconHome, IconLayoutGrid, IconMenu2, IconShoppingCart, IconX } from '@tabler/icons-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Auth from './components/Auth';
import AuthCallback from './auth/AuthCallback';
import { useAuth } from './auth/AuthProvider';
import ProtectedRoute from './auth/ProtectedRoute';
import { safeReturnPath, signInPath } from './auth/redirects';
import CartDrawer from './components/CartDrawer';
import Checkout, { MyOrders, OrderPage } from './components/Checkout';
import { safeTelegramUrl } from './lib/telegram';
import { useCart } from './cart';
import FloatingLogos from './components/FloatingLogos';
import Products from './components/Products';
import LiveSupportChat from './components/LiveSupportChat';
import { useResource } from './features/api';
import './App.css';

const AdminRoutes = lazy(() => import('./admin/AdminRoutes'));
const ModelAvatar = lazy(() => import('./components/ModelAvatar'));

function StoreLayout() {
  const location = useLocation();
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLocation, setMenuLocation] = useState(location.key);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const header = useRef<HTMLElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { user, loading, signOut } = useAuth();
  const { count, error: cartError, dismissError } = useCart();
  const settings = useResource('public_settings');
  const navigate = useNavigate();
  const signInReturn = location.pathname.startsWith('/auth')
    ? safeReturnPath(new URLSearchParams(location.search).get('returnTo'))
    : location.pathname;
  if (menuLocation !== location.key) {
    setMenuLocation(location.key);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (location.hash) {
      const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1021px)');
    const resize = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', resize);
    return () => desktop.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    menuPanel.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  async function logout() {
    if (signingOut) return;
    setMenuOpen(false);
    setSigningOut(true); setSignOutError('');
    try { await signOut(); navigate('/', { replace: true }); }
    catch (cause) { setSignOutError(cause instanceof Error ? cause.message : 'Could not sign out. Please retry.'); }
    finally { setSigningOut(false); }
  }
  return (
    <div className="page">
      <header className="nav" ref={header}><div className="nav-inner">
        <Link className="brand" to="/" onClick={() => setMenuOpen(false)}><span className="brand-mark">B</span><span className="brand-name">{settings.data?.store_name || 'Brenstore'}</span></Link>
        <div id="store-navigation" className={`nav-panel${menuOpen ? ' is-open' : ''}`} ref={menuPanel}>
          <nav className="nav-links" aria-label="Store navigation">
            <Link to="/" onClick={() => setMenuOpen(false)}><IconHome size={18} /> Home</Link>
            <Link to="/#products" onClick={() => setMenuOpen(false)}><IconLayoutGrid size={18} /> Products</Link>
            <Link to="/#support" onClick={() => setMenuOpen(false)}><IconHeadset size={18} /> Support</Link>
          </nav>
          <div className="nav-account">
            {user ? <>
              <Link className="account-link" to="/orders" onClick={() => setMenuOpen(false)}>My orders</Link>
              <button className="user-chip" disabled={signingOut} onClick={() => void logout()} aria-label="Sign out">
                <span className="user-avatar">{(user.email?.[0] ?? 'B').toUpperCase()}</span>
                <span className="user-meta"><b>{user.email?.split('@')[0] ?? 'Account'}</b><small>{signingOut ? 'Signing out…' : 'Sign out'}</small></span>
              </button>
            </> : <Link className="btn nav-cta" to={signInPath(signInReturn)} onClick={() => setMenuOpen(false)}>{loading ? 'Checking account…' : 'Sign in'}<IconChevronsRight size={18} className="chev" /></Link>}
          </div>
        </div>
        <button className="btn nav-cta nav-cart" onClick={() => { setMenuOpen(false); setCartOpen(true); }} aria-label={`Open cart (${count} items)`}><IconShoppingCart size={19} />{count > 0 && <span className="cart-badge">{count}</span>}</button>
        <button className="btn nav-menu-button" ref={menuButton} onClick={() => setMenuOpen(open => !open)}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="store-navigation">
          {menuOpen ? <IconX size={21} /> : <IconMenu2 size={21} />}
        </button>
      </div></header>
      {signOutError && <p className="auth-error store-banner" role="alert">{signOutError}</p>}
      {cartError && <div className="auth-error store-banner" role="alert">{cartError} <button className="auth-switch" onClick={dismissError}>Dismiss</button></div>}
      <Outlet />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onCheckout={() => { setCartOpen(false); navigate('/checkout'); }} />
    </div>
  );
}

function Home() {
  const settings = useResource('public_settings');
  const telegram = safeTelegramUrl(settings.data?.telegram_url);
  return (
    <main>
      <section className="hero"><div className="hero-grid">
        <div className="hero-copy">
          <h1 className="hero-title">Shop Smart,<br />Share Plans,<br /><span className="hero-accent">Save Big</span></h1>
          <p className="hero-sub">Brenstore is your everyday shop for shared subscriptions at a fraction of the price — with a real order reference and personal support.</p>
          <div className="hero-actions">
            <Link className="btn" to="/#products">Start <IconChevronRight size={20} className="chev" /></Link>
            {telegram && <a className="btn" href={telegram} target="_blank" rel="noreferrer"><IconBrandTelegram size={20} /> Telegram</a>}
          </div>
        </div>
        <div className="hero-visual">
          <FloatingLogos />
          <div className="hero-embed">
            <Suspense fallback={<div className="hero-embed-frame hero-embed-placeholder" role="status" aria-label="Loading the 3D model" />}>
              <ModelAvatar />
            </Suspense>
            <p className="hero-embed-credit">
              <a href="https://sketchfab.com/3d-models/female-cowgirl-v4-17950505a83d4c339fd276c6b3a8addc" target="_blank" rel="noreferrer">Female Cowgirl V4</a>
              {' by '}
              <a href="https://sketchfab.com/Fadly.W" target="_blank" rel="noreferrer">Fadly.W</a>
              {' on '}
              <a href="https://sketchfab.com" target="_blank" rel="noreferrer">Sketchfab</a>
              {' · licensed '}
              <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
            </p>
          </div>
        </div>
        <aside className="hero-side">
          <div className="side-item"><h3><IconBrandTelegram size={20} className="side-icon" /> Personal Support</h3><p>Share your saved order reference</p></div>
          <div className="side-divider" />
          <div className="side-item"><h3><IconCreditCard size={20} className="side-icon" /> Clear Checkout</h3><p>Review your plan, currency and total</p></div>
          <div className="side-divider" />
          <p className="side-note">Staff confirms manual payments and arranges access. A pending order does not reserve seats.</p>
        </aside>
      </div></section>
      <Products />
      <section id="support" className="store-support">
        <h2>Need a hand?</h2><p>Use your saved order reference when contacting support. Telegram links do not automatically place orders or verify payments.</p>
        <div className="store-support-actions"><LiveSupportChat />
          {telegram && <a className="btn" href={telegram} target="_blank" rel="noreferrer"><IconBrandTelegram size={20} /> Contact on Telegram</a>}
        </div>
        {settings.isError && <p role="alert">Telegram support information could not be loaded. <button className="auth-switch" onClick={() => void settings.refetch()}>Retry support information</button></p>}
      </section>
    </main>
  );
}

export default function App() {
  return <Suspense fallback={<p className="store-state" role="status">Loading page…</p>}><Routes>
    <Route element={<ProtectedRoute staff />}><Route path="/admin/*" element={<AdminRoutes />} /></Route>
    <Route element={<StoreLayout />}>
      <Route index element={<Home />} />
      <Route path="/auth" element={<Auth key="sign-in" />} />
      <Route path="/auth/recovery" element={<Auth key="recovery" />} />
      <Route path="/auth/update-password" element={<Auth key="new-password" />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders" element={<MyOrders />} />
        <Route path="/orders/:id" element={<OrderPage />} />
      </Route>
      <Route path="*" element={<section className="auth"><div className="auth-card"><h1 className="auth-title">Page not found</h1><Link className="btn" to="/">Back to store</Link></div></section>} />
    </Route>
  </Routes></Suspense>;
}
