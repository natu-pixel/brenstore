import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconCrown,
  IconFlame,
  IconShieldCheck,
  IconShoppingCart,
  IconStar,
} from '@tabler/icons-react';
import { Laptop, Shield, Tv, Zap } from 'lucide-react';
import { useCart } from '../cart';
import type { PlanGroup } from '../data/plan-options';
import {
  badgeLabels,
  durationLabel,
  fromPrice,
  purchasable,
  servicePath,
  serviceSummary,
} from '../data/service-view';
import type { Service, ServiceBadge } from '../features/contracts';
import { formatMoney } from '../lib/money';
import BrandLogo from './BrandLogo';
import { PlanSheet } from './PlanPicker';

const badgeIcons: Record<ServiceBadge, typeof IconStar> = {
  recommended: IconStar,
  popular: IconFlame,
  premium: IconCrown,
};

export function ServiceBadgePill({ badge }: { badge?: ServiceBadge | null }) {
  if (!badge) return null;
  const Icon = badgeIcons[badge];
  return (
    <span className={`service-badge service-badge-${badge}`}>
      <Icon size={14} aria-hidden="true" />
      {badgeLabels[badge]}
    </span>
  );
}

export function AvailabilityStatus({ available }: { available: boolean }) {
  return (
    <span className={`service-status ${available ? 'is-available' : 'is-unavailable'}`}>
      <span className="service-status-dot" aria-hidden="true" />
      {available ? 'Available' : 'Currently Unavailable'}
    </span>
  );
}

export default function ServiceCard({
  group,
  service,
}: {
  group: PlanGroup;
  service?: Service;
}) {
  const { currency } = useCart();
  const [ordering, setOrdering] = useState(false);
  const plans = group.plans;
  const branding = plans[0] ?? group.plans[0];
  const href = servicePath(group);
  const price = fromPrice(plans, currency);
  const available = plans.some((plan) => purchasable(plan, currency));
  const summary = serviceSummary(group, service);
  const category = service?.category_name ?? branding.category_name;

  // Selected duration/billing info for badge
  const lowestPricedPlan = plans.find((p) => purchasable(p, currency)) || plans[0];
  const termBadge = lowestPricedPlan?.billing_days
    ? `${durationLabel(lowestPricedPlan.billing_days)} · ${lowestPricedPlan.users_included ? `${lowestPricedPlan.users_included} User` : '1 User'}`
    : lowestPricedPlan?.kind === 'topup'
      ? 'Instant Top-Up'
      : 'Flexible Plan';

  // Feature highlight chips (admin defined or intelligent defaults tailored to the service)
  const defaultFeatures = [
    { icon: <Zap size={14} />, text: 'Instant Delivery' },
    { icon: <Shield size={14} />, text: lowestPricedPlan?.users_included ? `${lowestPricedPlan.users_included} User Account` : 'Verified Account' },
    { icon: <Tv size={14} />, text: 'Ultra HD 4K Quality' },
    { icon: <Laptop size={14} />, text: 'Works on All Devices' },
  ];

  const displayFeatures = service?.features && service.features.length >= 2
    ? service.features.slice(0, 4).map((f, i) => ({
        icon: i === 0 ? <Zap size={14} /> : i === 1 ? <Shield size={14} /> : i === 2 ? <Tv size={14} /> : <Laptop size={14} />,
        text: f,
      }))
    : defaultFeatures;

  return (
    <article className="service-card attractive-card">
      {/* Top Banner with Badges and Prominent Logo (compact & tight, no wasted space) */}
      <Link
        className="service-card-media"
        to={href}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          background: `radial-gradient(circle at 75% 25%, ${branding.color_start}55 0%, #0d121f 85%)`,
        }}
      >
        <div className="card-banner-backdrop" aria-hidden="true">
          <div className="card-mockup-glow" style={{ background: branding.color_start }} />
        </div>

        {/* Top Badges */}
        <div className="card-top-badges">
          <div className="card-top-badges-left">
            <span className="seller-badge">
              <IconCheck size={11} stroke={3} /> Verified Seller
            </span>
            {service?.badge && <ServiceBadgePill badge={service.badge} />}
          </div>
          <AvailabilityStatus available={available} />
        </div>

        {/* Center Prominent Brand Logo */}
        <div className="card-banner-center">
          <BrandLogo product={{ ...branding, name: group.name }} size={56} />
        </div>
      </Link>

      {/* Main Body */}
      <div className="service-card-body">
        {/* Service Header: Logo avatar + Name + Category + Duration chip */}
        <div className="card-header-row">
          <div className="card-header-brand">
            <BrandLogo product={{ ...branding, name: group.name }} size={36} />
            <div className="card-header-titles">
              <h3 className="service-card-name">
                <Link to={href}>{group.name}</Link>
                <span className="verified-check-pill" title="Verified Service">
                  <IconCheck size={11} stroke={3} />
                </span>
              </h3>
              {category && <span className="service-card-category">{category}</span>}
            </div>
          </div>

          <span className="card-duration-chip">
            <IconClock size={12} /> {termBadge}
          </span>
        </div>

        {summary && <p className="service-card-summary">{summary}</p>}

        {/* 4 Feature Highlights Grid */}
        <div className="card-features-grid">
          {displayFeatures.map((feat, idx) => (
            <div className="feature-item" key={idx}>
              <span className="feature-icon">{feat.icon}</span>
              <span className="feature-text">{feat.text}</span>
            </div>
          ))}
        </div>

        {/* Pricing and Trust Row */}
        <div className="card-pricing-row">
          <div className="service-card-price">
            <div className="price-top-meta">
              <span className="availability-dot-live" />
              <span>From</span>
            </div>
            <div className="price-number-line">
              <strong>{price === null ? 'Not priced' : formatMoney(price, currency)}</strong>
              <small className="billing-unit">/Month</small>
            </div>
          </div>

          <div className="card-trust-pill" title="100% Legit & Protected">
            <IconShieldCheck size={15} className="trust-shield-icon" />
            <div className="trust-pill-text">
              <strong>Safe & Secure</strong>
              <small>100% legit</small>
            </div>
            <IconChevronRight size={12} className="trust-chevron" />
          </div>
        </div>

        {/* Primary Call to Action Button */}
        <div className="service-card-actions">
          <button
            className="service-button service-button-primary"
            type="button"
            disabled={!available}
            aria-label={`Order ${group.name}`}
            onClick={() => setOrdering(true)}
          >
            <IconShoppingCart size={16} aria-hidden="true" />
            Order Now
            <IconChevronRight size={15} className="btn-chevron" />
          </button>
        </div>
      </div>

      {ordering && <PlanSheet group={group} onClose={() => setOrdering(false)} />}
    </article>
  );
}
