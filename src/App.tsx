import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import { IconBrandTelegram, IconChevronDown, IconChevronRight, IconChevronsRight, IconCreditCard, IconHeadset, IconHome, IconLayoutGrid, IconLogout, IconMenu2, IconReceipt, IconShoppingCart, IconUser, IconX } from '@tabler/icons-react';
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
import HeroAvatar from './components/HeroAvatar';
import Products from './components/Products';
import RegionPicker from './components/RegionPicker';
import ServiceDetail from './components/ServiceDetail';
import type { StoreOutletContext } from './components/ServiceDetail';
import LiveSupportChat from './components/LiveSupportChat';
import { useResource } from './features/api';
import './App.css';

const AdminRoutes = lazy(() => import('./admin/AdminRoutes'));
const TelegramConnection = lazy(() => import('./components/TelegramConnection'));

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
        <Link className="brand" to="/" onClick={() => setMenuOpen(false)}><img className="brand-mark" src="/brand-mark.png" alt="" width={38} height={38} /><span className="brand-name">{settings.data?.store_name || 'Brenstore'}</span></Link>
        <div id="store-navigation" className={`nav-panel${menuOpen ? ' is-open' : ''}`} ref={menuPanel}>
          <nav className="nav-links" aria-label="Store navigation">
            <Link to="/" onClick={() => setMenuOpen(false)}><IconHome size={18} /> Home</Link>
            <Link to="/services" onClick={() => setMenuOpen(false)}><IconLayoutGrid size={18} /> Products</Link>
            <Link to="/#support" onClick={() => setMenuOpen(false)}><IconHeadset size={18} /> Support</Link>
          </nav>
          <div className="nav-account">
            {user ? <AccountMenu email={user.email ?? ''} signingOut={signingOut} onSignOut={() => void logout()} onNavigate={() => setMenuOpen(false)} />
              : <Link className="btn nav-cta nav-signin" to={signInPath(signInReturn)} onClick={() => setMenuOpen(false)} aria-label={loading ? 'Checking account…' : 'Sign in'} title="Sign in">
                <IconUser size={20} aria-hidden="true" /><span className="nav-signin-text">{loading ? 'Checking account…' : 'Sign in'}</span><IconChevronsRight size={18} className="chev" aria-hidden="true" /></Link>}
          </div>
        </div>
        <RegionPicker />
        <button className="btn nav-cta nav-cart" onClick={() => { setMenuOpen(false); setCartOpen(true); }} aria-label={`Open cart (${count} items)`}><IconShoppingCart size={19} />{count > 0 && <span className="cart-badge">{count}</span>}</button>
        <button className="btn nav-menu-button" ref={menuButton} onClick={() => setMenuOpen(open => !open)}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="store-navigation">
          {menuOpen ? <IconX size={21} /> : <IconMenu2 size={21} />}
        </button>
      </div></header>
      {signOutError && <p className="auth-error store-banner" role="alert">{signOutError}</p>}
      {cartError && <div className="auth-error store-banner" role="alert">{cartError} <button className="auth-switch" onClick={dismissError}>Dismiss</button></div>}
      <Outlet context={{ openCart: () => setCartOpen(true) } satisfies StoreOutletContext} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onCheckout={() => { setCartOpen(false); navigate('/checkout'); }} />
    </div>
  );
}

// Desktop: avatar opens a small menu. Inside the phone navigation panel the items are always listed.
function AccountMenu({ email, signingOut, onSignOut, onNavigate }: {
  email: string; signingOut: boolean; onSignOut: () => void; onNavigate: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(location.key);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = email.split('@')[0] || 'Account';
  if (open && openedAt !== location.key) setOpen(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="account-menu" ref={root}>
    <button ref={trigger} type="button" className="user-chip account-trigger" aria-expanded={open} aria-controls="account-menu-items"
      aria-label={`Account menu for ${name}`} onClick={() => { setOpenedAt(location.key); setOpen(value => !value); }}>
      <span className="user-avatar">{(email[0] ?? 'B').toUpperCase()}</span>
      <span className="user-meta"><b>{name}</b><small>Account</small></span>
      <IconChevronDown size={16} aria-hidden="true" className="account-chevron" />
    </button>
    <div id="account-menu-items" className={`account-dropdown${open ? ' is-open' : ''}`}>
      <span className="account-email" title={email}>{email}</span>
      <Link className="account-link" to="/orders" onClick={() => { setOpen(false); onNavigate(); }}><IconReceipt size={18} aria-hidden="true" />My orders</Link>
      <button type="button" className="account-signout" disabled={signingOut} onClick={() => { setOpen(false); onSignOut(); }}>
        <IconLogout size={18} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  </div>;
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
          <HeroAvatar />
          <FloatingLogos />
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
      <Route path="/services" element={<main><Products page /></main>} />
      <Route path="/services/:key" element={<ServiceDetail />} />
      <Route path="/auth" element={<Auth key="sign-in" />} />
      <Route path="/auth/recovery" element={<Auth key="recovery" />} />
      <Route path="/auth/update-password" element={<Auth key="new-password" />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/account/telegram" element={<TelegramConnection />} />
        <Route path="/account/telegram/link/:token" element={<TelegramConnection />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders" element={<MyOrders />} />
        <Route path="/orders/:id" element={<OrderPage />} />
      </Route>
      <Route path="*" element={<section className="auth"><div className="auth-card"><h1 className="auth-title">Page not found</h1><Link className="btn" to="/">Back to store</Link></div></section>} />
    </Route>
  </Routes></Suspense>;
}
