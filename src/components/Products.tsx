import { useState } from 'react';
import {
  IconApps,
  IconBolt,
  IconDeviceGamepad2,
  IconDeviceTv,
  IconFlame,
  IconLayoutGrid,
  IconMusic,
  IconSearch,
  IconShoppingCart,
  IconSparkles,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { useCart } from '../cart';
import { fmtETB } from '../data/currency';
import { CATEGORIES, PRODUCTS } from '../data/products';
import type { Category } from '../data/products';

const fmt = fmtETB;

type Filter = Category | 'All' | 'Hot';

const CAT_ICONS: Record<Filter, React.ReactNode> = {
  All: <IconLayoutGrid size={18} stroke={2} />,
  Hot: <IconFlame size={18} stroke={2} />,
  Streaming: <IconDeviceTv size={18} stroke={2} />,
  Music: <IconMusic size={18} stroke={2} />,
  AI: <IconSparkles size={18} stroke={2} />,
  Software: <IconApps size={18} stroke={2} />,
  Gaming: <IconDeviceGamepad2 size={18} stroke={2} />,
};

export default function Products() {
  const [active, setActive] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const { add } = useCart();

  const q = query.trim().toLowerCase();
  const shown = PRODUCTS.filter((p) => {
    const inFilter =
      active === 'All'
        ? true
        : active === 'Hot'
          ? !!p.hot
          : p.category === active;
    const inSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.plan.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q);
    return inFilter && inSearch;
  });

  return (
    <section className="products" id="products">
      <div className="products-inner">
        <span className="hero-eyebrow">
          <IconSparkles size={18} stroke={2} /> Shared plans · Save up to 75%
        </span>
        <h2 className="products-title">
          Premium Subscriptions,
          <br />
          <span className="hero-accent">Split The Price</span>
        </h2>
        <p className="products-sub">
          Join a shared plan and pay a fraction of the solo price. Cancel
          anytime — no hidden fees.
        </p>

        <div className="product-search">
          <IconSearch size={20} stroke={2.4} className="search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${PRODUCTS.length}+ plans & brands`}
            aria-label="Search plans and brands"
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <IconX size={16} stroke={2.6} />
            </button>
          )}
        </div>

        <div className="cat-filter" role="tablist" aria-label="Product categories">
          {(['All', 'Hot', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={active === c}
              className={
                'cat-pill' +
                (active === c ? ' is-active' : '') +
                (c === 'Hot' ? ' pill-hot' : '')
              }
              onClick={() => setActive(c)}
            >
              {CAT_ICONS[c]}
              {c === 'Hot' ? 'Hot Deals' : c}
            </button>
          ))}
        </div>

        <div className="product-grid">
          {shown.map((p) => {
            const save = Math.round((1 - p.price / p.soloPrice) * 100);
            const low = p.seatsLeft === 1;
            return (
              <article className="product-card" key={p.id}>
                {(p.hot || p.instant) && (
                  <span className={'card-flag' + (p.hot ? ' flag-hot' : '')}>
                    {p.hot ? (
                      <>
                        <IconFlame size={13} stroke={2.6} /> HOT
                      </>
                    ) : (
                      <>
                        <IconBolt size={13} stroke={2.6} /> INSTANT
                      </>
                    )}
                  </span>
                )}
                <div className="card-top">
                  <BrandLogo product={p} />
                  <span className="save-badge">-{save}%</span>
                </div>

                <h3 className="card-name">{p.name}</h3>
                <p className="card-plan">{p.plan}</p>

                <div className="card-seats">
                  <span className={'seat-dot' + (low ? ' seat-low' : '')} />
                  <IconUsers size={16} stroke={2} />
                  {low
                    ? 'Last seat available'
                    : `${p.seatsLeft} of ${p.seatsTotal} seats left`}
                </div>

                <div className="card-bottom">
                  <div className="card-price">
                    <span className="price-now">{fmt(p.price)}</span>
                    <span className="price-per">/mo</span>
                    <span className="price-was">{fmt(p.soloPrice)}</span>
                  </div>
                  <button
                    className="btn btn-cart"
                    aria-label={`Add ${p.name} to cart`}
                    onClick={() => add(p.id)}
                  >
                    <IconShoppingCart size={20} stroke={2.4} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {shown.length === 0 && (
          <div className="no-results">
            <IconSearch size={40} stroke={1.6} />
            <p>No plans match “{query}”.</p>
            <button
              className="btn"
              onClick={() => {
                setQuery('');
                setActive('All');
              }}
            >
              Show all plans
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
