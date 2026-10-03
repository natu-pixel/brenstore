import { useState } from 'react';
import { IconFlame, IconLayoutGrid, IconSearch, IconShoppingCart, IconSparkles, IconX } from '@tabler/icons-react';
import ServiceCard from './ServiceCard';
import { groupPlans, optionSummary } from '../data/plan-options';
import { useResource } from '../features/api';

export default function Products() {
  const [active, setActive] = useState('all');
  const [query, setQuery] = useState('');
  const catalog = useResource('catalog');
  const categories = useResource('public_categories');
  const services = useResource('public_services');
  const serviceById = new Map((services.data ?? []).map(service => [service.id, service]));
  const q = query.trim().toLowerCase();
  const shown = groupPlans(catalog.data ?? []).filter(group => group.plans.some(plan => {
    const matchesCategory = active === 'all' || (active === 'featured' ? plan.featured : plan.category_id === active);
    const service = group.serviceId ? serviceById.get(group.serviceId) : undefined;
    return matchesCategory && (!q || [group.name, plan.name, plan.description, optionSummary(plan), plan.category_name ?? '',
      service?.tagline ?? '', service?.description ?? ''].some(value => value.toLowerCase().includes(q)));
  }));

  return (
    <section className="products" id="products">
      <div className="products-inner">
        <span className="hero-eyebrow"><IconSparkles size={18} /> Shared plans · Clear pricing</span>
        <h2 className="products-title">Premium Subscriptions,<br /><span className="hero-accent">Split The Price</span></h2>
        <p className="products-sub">Discover shared plans with independently listed USD and ETB prices. Seats are allocated only after staff confirms payment.</p>
        <div className="product-search">
          <IconSearch size={20} className="search-icon" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plans & brands" aria-label="Search plans and brands" />
          {query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search"><IconX size={16} /></button>}
        </div>
        <div className="cat-filter" role="group" aria-label="Product categories">
          <button aria-pressed={active === 'all'} className={'cat-pill' + (active === 'all' ? ' is-active' : '')} onClick={() => setActive('all')}><IconLayoutGrid size={18} /> All</button>
          <button aria-pressed={active === 'featured'} className={'cat-pill pill-hot' + (active === 'featured' ? ' is-active' : '')} onClick={() => setActive('featured')}><IconFlame size={18} /> Featured</button>
          {(categories.data ?? []).filter((category) => !category.archived).map((category) => (
            <button key={category.id} aria-pressed={active === category.id} className={'cat-pill' + (active === category.id ? ' is-active' : '')} onClick={() => setActive(category.id)}><IconLayoutGrid size={18} />{category.name}</button>
          ))}
        </div>
        {categories.isError && <p className="store-notice">Categories could not be loaded. You can still browse all plans. <button className="auth-switch" onClick={() => void categories.refetch()}>Retry categories</button></p>}
        {catalog.isPending ? <p className="store-state" role="status">Loading available plans…</p> : catalog.isError ? (
          <div className="store-state"><p className="auth-error" role="alert">Catalog unavailable: {catalog.error.message}</p><p>Ask the store administrator to verify the Supabase connection and deployment if this continues.</p><button className="btn" onClick={() => void catalog.refetch()}>Retry catalog</button></div>
        ) : !catalog.data.length ? (
          <div className="no-results"><IconShoppingCart size={40} /><p>No plans are published yet.</p><span>Check back soon — new plans will appear here when available.</span></div>
        ) : <>
          <div className="product-grid service-grid">
            {shown.map(group => <ServiceCard group={group} service={group.serviceId ? serviceById.get(group.serviceId) : undefined} key={group.id} />)}
          </div>
          {!shown.length && <div className="no-results"><IconSearch size={40} /><p>No plans match your filters.</p><button className="btn" onClick={() => { setQuery(''); setActive('all'); }}>Show all plans</button></div>}
        </>}
      </div>
    </section>
  );
}
