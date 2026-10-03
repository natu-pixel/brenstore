import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconCrown, IconFlame, IconShoppingCart, IconStar } from '@tabler/icons-react';
import { useCart } from '../cart';
import type { PlanGroup } from '../data/plan-options';
import { badgeLabels, fromPrice, purchasable, serviceSummary, servicePath } from '../data/service-view';
import type { Service, ServiceBadge } from '../features/contracts';
import { formatMoney } from '../lib/money';
import BrandLogo from './BrandLogo';
import { PlanSheet } from './PlanPicker';

const badgeIcons: Record<ServiceBadge, typeof IconStar> = { recommended: IconStar, popular: IconFlame, premium: IconCrown };

export function ServiceBadgePill({ badge }: { badge?: ServiceBadge | null }) {
  if (!badge) return null;
  const Icon = badgeIcons[badge];
  return <span className={`service-badge service-badge-${badge}`}><Icon size={14} aria-hidden="true" />{badgeLabels[badge]}</span>;
}

export function AvailabilityStatus({ available }: { available: boolean }) {
  return <span className={`service-status ${available ? 'is-available' : 'is-unavailable'}`}>
    <span className="service-status-dot" aria-hidden="true" />{available ? 'Available' : 'Currently Unavailable'}
  </span>;
}

export default function ServiceCard({ group, service }: { group: PlanGroup; service?: Service }) {
  const { currency } = useCart();
  const [ordering, setOrdering] = useState(false);
  const plans = group.plans;
  const branding = plans[0] ?? group.plans[0];
  const href = servicePath(group);
  const price = fromPrice(plans, currency);
  const available = plans.some(plan => purchasable(plan, currency));
  const summary = serviceSummary(group, service);
  const category = service?.category_name ?? branding.category_name;

  return <article className="service-card">
    <Link className="service-card-media" to={href} tabIndex={-1} aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${branding.color_start}26, ${branding.color_end}4d)` }}>
      <BrandLogo product={{ ...branding, name: group.name }} size={92} />
      <ServiceBadgePill badge={service?.badge} />
    </Link>
    <div className="service-card-body">
      <h3 className="service-card-name"><Link to={href}>{group.name}</Link></h3>
      {category && <span className="service-card-category">{category}</span>}
      {summary && <p className="service-card-summary">{summary}</p>}
      <AvailabilityStatus available={available} />
      <div className="service-card-price">
        <span>From</span>
        <strong>{price === null ? 'Not priced' : formatMoney(price, currency)}</strong>
      </div>
      <div className="service-card-actions">
        <button className="service-button service-button-primary" type="button" disabled={!available} aria-label={`Order ${group.name}`}
          onClick={() => setOrdering(true)}><IconShoppingCart size={18} aria-hidden="true" />Order</button>
      </div>
    </div>
    {ordering && <PlanSheet group={group} onClose={() => setOrdering(false)} />}
  </article>;
}
