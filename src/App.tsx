import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import {
  IconBrandTelegram,
  IconChevronRight,
  IconChevronsRight,
  IconCreditCard,
  IconHeadset,
  IconHome,
  IconLayoutGrid,
  IconShoppingCart,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import Auth from './components/Auth';
import type { User } from './components/Auth';
import Avatar from './components/Avatar';
import CartDrawer from './components/CartDrawer';
import Checkout from './components/Checkout';
import { TELEGRAM_URL, useCart } from './cart';
import { supabase } from './supabase';
import FloatingLogos from './components/FloatingLogos';
import Products from './components/Products';
import './App.css';

export default function App() {
  const [view, setView] = useState<'home' | 'auth' | 'checkout'>('home');
  const [cartOpen, setCartOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const { count } = useCart();

  // restore + track the Supabase session
  useEffect(() => {
    if (!supabase) return;
    const toUser = (u: { email?: string; user_metadata?: Record<string, unknown> } | null): User | null =>
      u?.email
        ? {
            name:
              (u.user_metadata?.full_name as string | undefined) ??
              u.email.split('@')[0],
            email: u.email,
          }
        : null;

    supabase.auth.getSession().then(({ data }) => {
      setUser(toUser(data.session?.user ?? null));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(toUser(session?.user ?? null));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  };

  const initials = user
    ? user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '';

  return (
    <div className="page">
      <header className="nav">
        <div className="nav-inner">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setView('home');
            }}
          >
            <span className="brand-mark">B</span>
            Brenstore
          </a>
          <nav className="nav-links">
            <a href="#">
              <IconHome size={18} stroke={2} /> Home
            </a>
            <a href="#products">
              <IconLayoutGrid size={18} stroke={2} /> Products
            </a>
            <a href="#">
              <IconHeadset size={18} stroke={2} /> Support
            </a>
          </nav>
          <button
            className="btn nav-cta nav-cart"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart (${count} items)`}
          >
            <IconShoppingCart size={19} stroke={2.4} />
            {count > 0 && <span className="cart-badge">{count}</span>}
          </button>
          {user ? (
            <button
              className="user-chip"
              onClick={signOut}
              title="Sign out"
            >
              <span className="user-avatar">{initials}</span>
              <span className="user-meta">
                <b>{user.name.split(' ')[0]}</b>
                <small>Sign out</small>
              </span>
            </button>
          ) : (
            <button className="btn nav-cta" onClick={() => setView('auth')}>
              Sign in <IconChevronsRight size={18} stroke={2.6} className="chev" />
            </button>
          )}
        </div>
      </header>

      {view === 'auth' ? (
        <Auth
          onBack={() => setView('home')}
          onAuthed={(u) => {
            setUser(u);
            setView('home');
          }}
        />
      ) : view === 'checkout' ? (
        <Checkout onBack={() => setView('home')} />
      ) : (
        <main>
        <section className="hero">
          <div className="hero-grid">
            <div className="hero-copy">
              <h1 className="hero-title">
                Shop Smart,
                <br />
                Share Plans,
                <br />
                <span className="hero-accent">Save Big</span>
              </h1>
              <p className="hero-sub">
                Brenstore is your everyday shop for shared subscriptions at a
                fraction of the price — and for anything else, just order
                through our Telegram bot.
              </p>
              <div className="hero-actions">
                <button className="btn">
                  Start <IconChevronRight size={20} stroke={2.8} className="chev" />
                </button>
                <a
                  className="btn"
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconBrandTelegram size={20} stroke={2} /> Telegram
                </a>
              </div>
            </div>

            <div className="hero-visual">
              <FloatingLogos />
              <Avatar />
            </div>

            <aside className="hero-side">
              <div className="side-item">
                <h3>
                  <IconBrandTelegram size={20} stroke={2} className="side-icon" />
                  Telegram Bot
                </h3>
                <p>Order anything via @brenstorebot</p>
              </div>
              <div className="side-divider" />
              <div className="side-item">
                <h3>
                  <IconCreditCard size={20} stroke={2} className="side-icon" />
                  Smart Checkout
                </h3>
                <p>Fast, simple and secure</p>
              </div>
              <div className="side-divider" />
              <p className="side-note">
                From shared streaming plans to custom orders on Telegram, every
                step stays simple and transparent.
              </p>
            </aside>
          </div>
        </section>

        <Products />
      </main>
      )}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          setView('checkout');
        }}
      />
    </div>
  );
}
