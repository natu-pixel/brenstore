import { Link, useParams } from 'react-router-dom';
import { IconAlertTriangle, IconArrowLeft, IconChecks, IconListCheck } from '@tabler/icons-react';
import { useCart } from '../cart';
import { groupPlans } from '../data/plan-options';
import { groupKey, purchasable } from '../data/service-view';
import { useResource } from '../features/api';
import BrandLogo from './BrandLogo';
import { PlanPicker } from './PlanPicker';
import { AvailabilityStatus, ServiceBadgePill } from './ServiceCard';

export type { StoreOutletContext } from './PlanPicker';

export default function ServiceDetail() {
  const { key = '' } = useParams();
  const { currency } = useCart();
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
    <Link className="btn" to="/services">Back to services</Link>
  </div></main>;

  const branding = group.plans[0];
  const available = group.plans.some(plan => purchasable(plan, currency));
  const description = service?.description || (!group.serviceId ? branding.description : '');
  const features = service?.features ?? [];
  const requirements = service?.requirements ?? [];
  const category = service?.category_name ?? branding.category_name;

  return <main className="service-detail">
    <div className="service-detail-inner">
      <Link className="service-back" to="/services"><IconArrowLeft size={18} aria-hidden="true" />Back to services</Link>
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
        <PlanPicker group={group} shownDescription={description} />
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
