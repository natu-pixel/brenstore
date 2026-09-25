import { useState } from 'react';
import { IconFlame, IconLayoutGrid, IconSearch, IconShoppingCart, IconSparkles, IconX } from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { useCart } from '../cart';
import { formatMoney } from '../lib/money';
import { billingLabel, comparePrice, planPrice } from '../data/products';
import { useResource } from '../features/api';
import type { Currency } from '../features/api';

export default function Products() {
  const [active, setActive] = useState('all');
  const [query, setQuery] = useState('');
  const { add, currency, setCurrency, lines } = useCart();
  const catalog = useResource('catalog');
  const categories = useResource('public_categories');
  const q = query.trim().toLowerCase();
  const shown = (catalog.data ?? []).filter((plan) => {
    const matchesCategory = active === 'all' || (active === 'featured' ? plan.featured : plan.category_id === active);
    return matchesCategory && (!q || [plan.name, plan.description, plan.category_name ?? ''].some((value) => value.toLowerCase().includes(q)));
  });

  return (
    <section className="products" id="products">
      <div className="products-inner">
        <span className="hero-eyebrow"><IconSparkles size={18} /> Shared plans · Clear pricing</span>
        <h2 className="products-title">Premium Subscriptions,<br /><span className="hero-accent">Split The Price</span></h2>
        <p className="products-sub">Discover shared plans with independently listed USD and ETB prices. Seats are allocated only after staff confirms payment.</p>
        <label className="currency-selector">Display currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="USD">USD — US Dollar</option><option value="ETB">ETB — Ethiopian Birr</option>
          </select>
        </label>
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
          <div className="product-grid">
            {shown.map((plan) => {
              const price = planPrice(plan, currency);
              const comparison = comparePrice(plan, currency);
              const save = price !== null && comparison !== null && comparison > price ? Math.round((1 - price / comparison) * 100) : null;
              const qty = lines.find((line) => line.product.id === plan.id)?.qty ?? 0;
              const unavailable = plan.status !== 'active' || price === null
                || qty >= (plan.kind === 'topup' ? 9 : Math.min(9, plan.available ?? 0));
              const seats = plan.available ?? 0;
              const stock = plan.kind === 'topup'
                ? { cls: 'in', label: 'Instant top-up' }
                : seats <= 0
                  ? { cls: 'out', label: 'Out of stock' }
                  : seats <= plan.low_stock_threshold
                    ? { cls: 'low', label: `${seats} left` }
                    : { cls: 'in', label: `${seats} in stock` };
              return (
                <article className="product-card" key={plan.id}>
                  {plan.featured && <span className="card-flag flag-hot"><IconFlame size={13} /> FEATURED</span>}
                  <div className="card-media">
                    <BrandLogo product={plan} />
                    {save !== null && <span className="save-badge">-{save}%</span>}
                  </div>
                  <div className="card-meta">
                    <span className="card-category">{plan.category_name ?? 'Plan'}</span>
                    <span className={`card-stock ${stock.cls}`}>{stock.label}</span>
                  </div>
                  <div className="card-body">
                    <h3 className="card-name">{plan.name}</h3>
                    <p className="card-plan">{plan.description}</p>
                    <div className="card-price-row">
                      <span className="price-now">{price === null ? 'Not priced' : formatMoney(price, currency)}</span>
                      <span className="price-per">{plan.kind === 'topup' ? 'one-time' : `/ ${billingLabel(plan.billing_days)}`}</span>
                      {comparison !== null && price !== null && comparison > price && <span className="price-was">{formatMoney(comparison, currency)}</span>}
                    </div>
                  </div>
                  <button className="card-action" disabled={unavailable} title={unavailable ? 'Unavailable, or quantity limit reached' : 'Add to cart'} aria-label={`Add ${plan.name} to cart`} onClick={() => add(plan.id)}>
                    {unavailable ? 'Out of stock' : <><IconShoppingCart size={18} /> Add to cart</>}
                  </button>
                </article>
              );
            })}
          </div>
          {!shown.length && <div className="no-results"><IconSearch size={40} /><p>No plans match your filters.</p><button className="btn" onClick={() => { setQuery(''); setActive('all'); }}>Show all plans</button></div>}
        </>}
      </div>
    </section>
  );
}
