import { Link, useOutletContext, useParams } from 'react-router-dom';
import { IconAlertTriangle, IconArrowLeft, IconChecks, IconListCheck, IconShoppingCart } from '@tabler/icons-react';
import { MAX_QUANTITY, useCart } from '../cart';
import { groupPlans, optionLabels } from '../data/plan-options';
import { billingLabel, billingTerms, comparePrice, planPrice } from '../data/products';
import { bestValueId, groupKey, purchasable, sortPlans } from '../data/service-view';
import { useResource } from '../features/api';
import type { Plan } from '../features/contracts';
import { formatMoney } from '../lib/money';
import BrandLogo from './BrandLogo';
import { AvailabilityStatus, ServiceBadgePill } from './ServiceCard';

export type StoreOutletContext = { openCart?: () => void } | undefined;

function termLabel(plan: Plan) {
  return plan.kind === 'topup' ? 'One-time top-up'
    : billingTerms.find(term => term.days === plan.billing_days)?.label ?? billingLabel(plan.billing_days);
}

export default function ServiceDetail() {
  const { key = '' } = useParams();
  const outlet = useOutletContext<StoreOutletContext>();
  const { add, currency, lines } = useCart();
  const catalog = useResource('catalog');
  const services = useResource('public_services');
  const group = groupPlans(catalog.data ?? []).find(item => groupKey(item) === key);
  const service = group?.serviceId ? services.data?.find(item => item.id === group.serviceId) : undefined;

  if (catalog.isPending) return <main className="service-detail"><p className="store-state" role="status">Loading service…</p></main>;
  if (catalog.isError) return <main className="service-detail"><div className="store-state">
    <p className="auth-error" role="alert">Service unavailable: {catalog.error.message}</p>
    <button className="btn" onClick={() => void catalog.refetch()}>Retry</button>
  </div></main>;
  if (!group) return <main className="service-detail"><div className="no-results">
    <p>This service is not available.</p><span>It may have been unpublished or sold out.</span>
    <Link className="btn" to="/#products">Back to services</Link>
  </div></main>;

  const plans = sortPlans(group.plans);
  const branding = plans[0];
  const best = bestValueId(plans, currency);
  const available = plans.some(plan => purchasable(plan, currency));
  const description = service?.description || (!group.serviceId ? branding.description : '');
  const features = service?.features ?? [];
  const requirements = service?.requirements ?? [];
  const category = service?.category_name ?? branding.category_name;

  function blocked(plan: Plan) {
    const qty = lines.find(line => line.product.id === plan.id)?.qty ?? 0;
    const price = planPrice(plan, currency);
    if (plan.status !== 'active') return 'Unavailable';
    if (price === null) return 'Not priced';
    if (plan.kind !== 'topup' && (plan.available ?? 0) <= 0) return 'Out of stock';
    if (qty >= (plan.kind === 'topup' ? MAX_QUANTITY : Math.min(MAX_QUANTITY, plan.available ?? 0))) return 'Quantity limit reached';
    return null;
  }

  return <main className="service-detail">
    <div className="service-detail-inner">
      <Link className="service-back" to="/#products"><IconArrowLeft size={18} aria-hidden="true" />Back to services</Link>
      <section className="service-hero" aria-labelledby="service-title">
        <div className="service-hero-media" style={{ background: `linear-gradient(135deg, ${branding.color_start}26, ${branding.color_end}4d)` }}>
          <BrandLogo product={{ ...branding, name: group.name }} size={128} />
        </div>
        <div className="service-hero-copy">
          <div className="service-hero-tags">
            <ServiceBadgePill badge={service?.badge} />
            {category && <span className="service-card-category">{category}</span>}
          </div>
          <h1 id="service-title">{group.name}</h1>
          {service?.tagline && <p className="service-tagline">{service.tagline}</p>}
          <AvailabilityStatus available={available} />
          {description && <p className="service-description">{description}</p>}
        </div>
      </section>

      <section className="service-plans" id="plans" aria-labelledby="plans-title">
        <h2 id="plans-title">Choose a Plan</h2>
        <ul className="service-plan-list">
          {plans.map(plan => {
            const price = planPrice(plan, currency);
            const compare = comparePrice(plan, currency);
            const reason = blocked(plan);
            const title = plan.option_code ? `${optionLabels[plan.option_code]} · ${termLabel(plan)}` : `${plan.name} · ${termLabel(plan)}`;
            const stock = plan.kind === 'topup' ? 'Instant top-up' : (plan.available ?? 0) <= 0 ? 'Out of stock'
              : (plan.available ?? 0) <= plan.low_stock_threshold ? `${plan.available} left` : `${plan.available} in stock`;
            return <li key={plan.id} className={`service-plan${plan.id === best ? ' is-best' : ''}`}>
              {plan.id === best && <span className="service-plan-best">Best value</span>}
              <div className="service-plan-info">
                <p className="service-plan-name">{title}</p>
                {plan.option_code === 'on_mail' && plan.users_included && <p className="service-plan-meta">{plan.users_included} {plan.users_included === 1 ? 'user' : 'users'} per purchase</p>}
                {plan.description && plan.description !== description && <p className="service-plan-meta">{plan.description}</p>}
                <p className="service-plan-price">
                  <strong>{price === null ? 'Not priced' : formatMoney(price, currency)}</strong>
                  {compare !== null && price !== null && compare > price && <s>{formatMoney(compare, currency)}</s>}
                </p>
                <p className={`service-plan-stock${stock === 'Out of stock' ? ' is-out' : ''}`}>{stock}</p>
              </div>
              <button className="service-button service-button-primary" type="button" disabled={reason !== null}
                title={reason ?? undefined} aria-label={`Order ${plan.name} (${termLabel(plan)})`}
                onClick={() => { add(plan.id); outlet?.openCart?.(); }}>
                {reason ?? <><IconShoppingCart size={18} aria-hidden="true" />Order</>}
              </button>
            </li>;
          })}
        </ul>
      </section>

      {(features.length > 0 || requirements.length > 0) && <div className="service-info-grid">
        {features.length > 0 && <section className="service-info" aria-labelledby="features-title">
          <h3 id="features-title"><IconChecks size={20} aria-hidden="true" />Features</h3>
          <ul>{features.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>}
        {requirements.length > 0 && <section className="service-info" aria-labelledby="requirements-title">
          <h3 id="requirements-title"><IconListCheck size={20} aria-hidden="true" />Requirements</h3>
          <ul>{requirements.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>}
      </div>}
      {service?.notes && <section className="service-notes" aria-labelledby="notes-title">
        <h3 id="notes-title"><IconAlertTriangle size={20} aria-hidden="true" />Important Notes</h3>
        <p>{service.notes}</p>
      </section>}
    </div>
  </main>;
}
