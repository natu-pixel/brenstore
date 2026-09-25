import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { IconActivity, IconArrowUpRight, IconBox, IconBuildingStore, IconChevronRight, IconLayoutDashboard, IconLogout, IconMenu2, IconPackage, IconSettings, IconShoppingBag, IconTag, IconUsers, IconUsersGroup, IconX } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthProvider';
import { AccessDenied, EmptyState, ErrorNotice } from './shared';
import { canManage, isOwner, titleCase } from './utils';
import DirtyProvider from './DirtyProvider';
import { DirtyContext } from './hooks';
import OverviewPage from './OverviewPage';
import { CategoriesPage, PlansPage } from './CatalogPages';
import InventoryPage from './InventoryPage';
import { OrderDetailPage, OrdersPage } from './OrderPages';
import { CustomerDetailPage, CustomersPage } from './CustomerPages';
import { ActivityPage, SettingsPage, TeamPage } from './ManagementPages';
import './admin.css';

function Guard({ level, children }: { level: 'manage' | 'owner'; children: ReactNode }) {
  const { role } = useAuth();
  return (level === 'owner' ? isOwner(role) : canManage(role)) ? children : <AccessDenied />;
}

export default function AdminRoutes() {
  return <DirtyProvider><AdminShell /></DirtyProvider>;
}

function AdminShell() {
  const { role, user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const { dirty, saving } = useContext(DirtyContext);
  const location = useLocation();
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  useEffect(() => { document.getElementById('admin-main')?.focus(); }, [location.pathname]);
  useEffect(() => {
    if (!menu || !mobile) return;
    const element = navigation.current;
    const trigger = menuButton.current;
    element?.querySelector<HTMLElement>('button, a')?.focus();
    return () => { trigger?.focus(); };
  }, [menu, mobile]);
  const managing = canManage(role);
  const links = [
    { path: '', label: 'Overview', icon: IconLayoutDashboard, visible: true },
    { path: 'plans', label: 'Plans', icon: IconBox, visible: managing },
    { path: 'categories', label: 'Categories', icon: IconTag, visible: managing },
    { path: 'inventory', label: 'Seat inventory', icon: IconPackage, visible: managing },
    { path: 'orders', label: 'Orders', icon: IconShoppingBag, visible: true },
    { path: 'customers', label: 'Customers', icon: IconUsers, visible: true },
    { path: 'team', label: 'Team', icon: IconUsersGroup, visible: isOwner(role) },
    { path: 'settings', label: 'Settings', icon: IconSettings, visible: isOwner(role) },
    { path: 'activity', label: 'Activity log', icon: IconActivity, visible: isOwner(role) },
  ];
  async function logout() {
    if (signingOut || saving || !window.confirm(dirty ? 'Discard your unsaved changes and sign out?' : 'Sign out of administration?')) return;
    setSigningOut(true); setSignOutError(null);
    try { await signOut(); } catch (cause) { setSignOutError(cause); } finally { setSigningOut(false); }
  }
  return <div className="admin-root">
    <a className="admin-skip-link" href="#admin-main">Skip to main content</a>
    <aside className={`admin-sidebar${menu ? ' admin-sidebar-open' : ''}`} id="admin-navigation" ref={navigation}
      inert={mobile && !menu} role={mobile && menu ? 'dialog' : undefined} aria-modal={mobile && menu ? true : undefined} aria-label="Admin navigation"
      onKeyDown={event => {
        if (!menu || !mobile) return;
        if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
        if (event.key === 'Tab') {
          const elements = Array.from(navigation.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="admin-wordmark"><IconBuildingStore size={24} stroke={1.6} /><Link to="/admin" onClick={() => setMenu(false)}>brenstore<span>Administration</span></Link>
        <button type="button" className="admin-icon-button admin-mobile-only" aria-label="Close navigation" onClick={() => setMenu(false)}><IconX size={20} /></button></div>
      <span className="admin-nav-label">Workspace</span>
      <nav aria-label="Administration">{links.filter(link => link.visible).map(({ path, label, icon: Icon }) =>
        <NavLink key={path} to={`/admin${path ? `/${path}` : ''}`} end={!path} onClick={() => setMenu(false)}><Icon size={19} stroke={1.7} /><span>{label}</span></NavLink>)}</nav>
      <div className="admin-sidebar-footer"><Link to="/"><IconArrowUpRight size={18} />Visit storefront</Link><div className="admin-user"><span className="admin-avatar">{user?.email?.slice(0, 1).toUpperCase() ?? 'S'}</span><div><strong>{role ? titleCase(role) : 'Staff'}</strong><small title={user?.email}>{user?.email}</small></div></div>
        <button type="button" className="admin-button admin-button-quiet" disabled={signingOut || saving} onClick={() => { void logout(); }}><IconLogout size={17} />{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </aside>
    {menu && <button className="admin-navigation-backdrop" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <div className="admin-workspace" inert={mobile && menu}><header className="admin-topbar"><div><button ref={menuButton} type="button" className="admin-icon-button admin-mobile-only" aria-label="Open navigation" aria-expanded={menu} aria-controls="admin-navigation" onClick={() => setMenu(true)}><IconMenu2 size={21} /></button>
      <span>Brenstore</span><IconChevronRight size={14} aria-hidden="true" /><strong>Administration</strong></div><span className="admin-role-label">{role ? titleCase(role) : 'Staff'} workspace</span></header>
      <main className="admin-main" id="admin-main" tabIndex={-1}>
        {Boolean(signOutError) && <ErrorNotice error={signOutError} />}
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="plans" element={<Guard level="manage"><PlansPage /></Guard>} />
          <Route path="categories" element={<Guard level="manage"><CategoriesPage /></Guard>} />
          <Route path="inventory" element={<Guard level="manage"><InventoryPage /></Guard>} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="team" element={<Guard level="owner"><TeamPage /></Guard>} />
          <Route path="settings" element={<Guard level="owner"><SettingsPage /></Guard>} />
          <Route path="activity" element={<Guard level="owner"><ActivityPage /></Guard>} />
          <Route path="*" element={<EmptyState title="Admin page not found" action={<Link className="admin-button" to="/admin">Back to overview</Link>}>The requested page does not exist.</EmptyState>} />
        </Routes>
      </main><footer className="admin-workspace-footer">Brenstore operations</footer>
    </div>
  </div>;
}

function isMobile() { return window.matchMedia?.('(max-width: 700px)').matches ?? false; }
function subscribeMobile(notify: () => void) {
  const media = window.matchMedia?.('(max-width: 700px)');
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
}
