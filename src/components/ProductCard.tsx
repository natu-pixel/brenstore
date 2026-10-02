import { useId, useState } from 'react';
import { IconShoppingCart } from '@tabler/icons-react';
import { MAX_QUANTITY, useCart } from '../cart';
import { billingLabel, billingTerms, comparePrice, planPrice } from '../data/products';
import { optionSummary, planChoices } from '../data/plan-options';
import type { PlanGroup } from '../data/plan-options';
import type { Plan } from '../features/contracts';
import { formatMoney } from '../lib/money';
import BrandLogo from './BrandLogo';

export default function ProductCard({ group }: { group: PlanGroup }) {
  const { add, currency, lines } = useCart();
  const choices = planChoices(group);
  function unavailable(plan: Plan) {
    const qty = lines.find(line => line.product.id === plan.id)?.qty ?? 0;
    return plan.status !== 'active' || planPrice(plan, currency) === null ||
      qty >= (plan.kind === 'topup' ? MAX_QUANTITY : Math.min(MAX_QUANTITY, plan.available ?? 0));
  }
  const [selectedId, setSelectedId] = useState(() => {
    const candidates = choices.length ? choices.flatMap(choice => choice.plans) : group.plans;
    return (candidates.find(plan => !unavailable(plan)) ?? candidates[0])?.id;
  });
  const plan = group.plans.find(plan => plan.id === selectedId);
  const branding = plan ?? group.plans[0];
  const selectedChoice = choices.find(choice => choice.plans.some(plan => plan.id === selectedId));
  const switchHelpId = useId();
  const onMail = selectedChoice?.key === 'On mail';
  const namedSelection = onMail || selectedChoice?.key === '1 user';
  const nextChoice = choices.find(choice => choice.key === (onMail ? '1 user' : 'On mail'));
  const nextPlan = nextChoice?.plans.find(candidate => candidate.billing_days === plan?.billing_days && !unavailable(candidate))
    ?? nextChoice?.plans.find(candidate => !unavailable(candidate));
  const changesTerm = plan && nextPlan && plan.billing_days !== nextPlan.billing_days;
  const durationPlans = selectedChoice?.plans ?? (plan ? [plan] : []);
  const durations = [
    ...billingTerms.map(term => ({ label: term.label, days: term.days, plan: durationPlans.find(candidate => candidate.billing_days === term.days) })),
    ...durationPlans.filter(candidate => !billingTerms.some(term => term.days === candidate.billing_days))
      .map(candidate => ({ label: billingLabel(candidate.billing_days), days: candidate.billing_days, plan: candidate })),
  ];
  const hasOtherPlans = choices.some(choice => choice.key !== '1 user' && choice.key !== 'On mail');
  const price = plan ? planPrice(plan, currency) : null;
  const comparison = plan ? comparePrice(plan, currency) : null;
  const seats = plan?.available ?? 0;
  const stock = !plan ? { cls: 'out', label: 'Select an option' }
    : plan.kind === 'topup' ? { cls: 'in', label: 'Instant top-up' }
    : seats <= 0 ? { cls: 'out', label: 'Out of stock' }
    : seats <= plan.low_stock_threshold ? { cls: 'low', label: `${seats} left` }
    : { cls: 'in', label: `${seats} in stock` };
  const disabled = !plan || unavailable(plan);
  const disabledLabel = !plan ? 'Choose an option' : price === null ? 'Not priced'
    : plan.kind !== 'topup' && seats <= 0 ? 'Out of stock' : 'Quantity limit reached';

  return <article className="product-card">
    <div className="card-media">
      <BrandLogo product={branding} />
      {stock.cls !== 'in' && <span className={`card-stock card-stock-warning ${stock.cls}`}>{stock.label}</span>}
    </div>
    <div className="card-body">
      <h3 className="card-name">{group.name}</h3>
      {choices.length > 0 && <div className="plan-options" role="group" aria-label={`${group.name} options`}>
        <div className="plan-toggle-row">
          <span className={`plan-toggle-label${namedSelection && !onMail ? ' is-selected' : ''}`}>1 user</span>
          <button className="plan-toggle" type="button" role="switch"
            aria-label={`${group.name}: On mail`} aria-checked={onMail} aria-describedby={switchHelpId}
            disabled={!namedSelection || !nextPlan}
            onClick={() => { if (nextPlan) setSelectedId(nextPlan.id); }}>
            <span className="plan-toggle-track" aria-hidden="true"><span className="plan-toggle-thumb" /></span>
          </button>
          <span className={`plan-toggle-label${onMail ? ' is-selected' : ''}`}>On mail</span>
        </div>
        <p className="plan-toggle-help" id={switchHelpId} hidden={namedSelection && Boolean(nextPlan) && !changesTerm}>
          {!namedSelection ? 'Options not set for this plan.'
            : !nextPlan ? `${nextChoice?.label} is not available.`
            : changesTerm ? `${nextChoice?.label} will use ${billingLabel(nextPlan.billing_days)}.`
            : 'Off: 1 user. On: On mail.'}
        </p>
        {(!namedSelection || hasOtherPlans) && (!plan || group.plans.length > 1) && <label className="card-plan-select">{group.name} plan
          <select value={plan?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>
            {!plan && <option value="" disabled>Choose a plan</option>}
            {group.plans.map(option => <option key={option.id} value={option.id} disabled={unavailable(option)}>
              {option.name} · {billingLabel(option.billing_days)}
            </option>)}
          </select>
        </label>}
      </div>}
      {!plan && <p className="card-option-error" role="alert">The selected plan is no longer published. Choose an available option.</p>}
      {plan && <>
        <div className="card-price-row" aria-live="polite" aria-atomic="true">
          <span className="price-now">{price === null ? 'Not priced' : formatMoney(price, currency)}</span>
          {plan.kind === 'topup' ? <span className="price-per">one-time</span> :
            <select className="card-duration-select" aria-label={`${group.name} billing plan`} value={plan.id}
              onChange={event => {
                const selected = durationPlans.find(candidate => candidate.id === event.target.value);
                if (selected && !unavailable(selected)) setSelectedId(selected.id);
              }}>
              {durations.map(duration => <option key={duration.plan?.id ?? `missing-${duration.days}`}
                value={duration.plan?.id ?? `missing-${duration.days}`} disabled={!duration.plan || unavailable(duration.plan)}>
                {duration.label}{!duration.plan || unavailable(duration.plan) ? ' (unavailable)' : ''}
              </option>)}
            </select>}
        </div>
        <details className="card-details" key={plan.id}>
          <summary>Details</summary>
          <div>
            {plan.name !== group.name && <p>{plan.name}</p>}
            {plan.option_code && <p>{optionSummary(plan)}</p>}
            {plan.description && <p>{plan.description}</p>}
            {plan.kind !== 'topup' && <p>Duration: {billingLabel(plan.billing_days)}</p>}
            <p>Availability: {stock.label}</p>
            {comparison !== null && price !== null && comparison > price && <p>Previous price: {formatMoney(comparison, currency)}</p>}
          </div>
        </details>
      </>}
    </div>
    <button className="card-action" disabled={disabled}
      title={disabled ? disabledLabel : 'Add selected plan to cart'}
      aria-label={plan ? `Add ${plan.name} to cart` : `Choose a ${group.name} option`}
      onClick={() => { if (plan) add(plan.id); }}>
      {disabled ? disabledLabel : <><IconShoppingCart size={18} /> Add to cart</>}
    </button>
  </article>;
}
