import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { IconBolt, IconShoppingCart, IconX } from '@tabler/icons-react';
import { useCart } from '../cart';
import type { PlanGroup } from '../data/plan-options';
import { comparePrice, planPrice } from '../data/products';
import { bestValueId, blockedReason, durationLabel, planTypeKey, planTypeLabel, sortPlans } from '../data/service-view';
import type { Plan } from '../features/contracts';
import { formatMoney } from '../lib/money';
import BrandLogo from './BrandLogo';

export type StoreOutletContext = { openCart?: () => void } | undefined;

const isSubscription = (plan: Plan) => plan.kind !== 'topup';

/** GamsGo-style picker: big price for the selection, then duration and type chips, then one purchase action. */
export function PlanPicker({ group, onDone, shownDescription }: { group: PlanGroup; onDone?: () => void; shownDescription?: string }) {
  const { add, currency, lines } = useCart();
  const navigate = useNavigate();
  const outlet = useOutletContext<StoreOutletContext>();
  const plans = sortPlans(group.plans.filter(plan => plan.status === 'active'));
  const reason = (plan: Plan) => blockedReason(plan, currency, lines.find(line => line.product.id === plan.id)?.qty ?? 0);
  const durations = [...new Set(plans.filter(isSubscription).map(plan => plan.billing_days))];
  const types = [...new Map(plans.map(plan => [planTypeKey(plan), planTypeLabel(plan, group.name)])).entries()];
  const firstChoice = plans.find(plan => reason(plan) === null) ?? plans[0];
  const [selection, setSelection] = useState(() => ({ days: firstChoice?.billing_days, type: firstChoice ? planTypeKey(firstChoice) : '' }));
  const best = bestValueId(plans, currency);
  const durationId = useId();
  const typeId = useId();

  const matches = (plan: Plan, days: number | undefined, type: string | null) =>
    (!isSubscription(plan) || days === undefined || plan.billing_days === days) && (type === null || planTypeKey(plan) === type);
  const find = (days: number | undefined, type: string | null) => {
    const candidates = plans.filter(plan => matches(plan, days, type));
    return candidates.find(plan => reason(plan) === null) ?? candidates[0];
  };
  const selected = find(selection.days, selection.type) ?? find(selection.days, null) ?? plans[0];
  if (!selected) return <p className="plan-picker-empty">No plans are available right now.</p>;

  function chooseDuration(days: number) {
    const keep = find(days, selection.type);
    const next = keep ?? find(days, null);
    setSelection({ days, type: next ? planTypeKey(next) : selection.type });
  }
  function chooseType(type: string) {
    const keep = find(selection.days, type);
    const next = keep ?? find(undefined, type);
    setSelection({ days: next?.billing_days ?? selection.days, type });
  }

  const price = planPrice(selected, currency);
  const compare = comparePrice(selected, currency);
  const blocked = reason(selected);
  const seats = selected.available ?? 0;
  const stock = !isSubscription(selected) ? 'Instant top-up' : seats <= 0 ? 'Sold out'
    : seats <= selected.low_stock_threshold ? `Only ${seats} left` : `${seats} in stock`;
  const soldOut = (plan: Plan | undefined) => plan !== undefined && reason(plan) === 'Sold out';

  function purchase(checkout: boolean) {
    if (blocked) return;
    add(selected.id);
    onDone?.();
    if (checkout) navigate('/checkout');
    else outlet?.openCart?.();
  }

  return <div className="plan-picker">
    <div className="plan-picker-summary" aria-live="polite">
      <div className="plan-picker-price">
        <strong>{price === null ? 'Not priced' : formatMoney(price, currency)}</strong>
        {compare !== null && price !== null && compare > price && <s>{formatMoney(compare, currency)}</s>}
      </div>
      <div className="plan-picker-tags">
        <span className="plan-picker-tag">{isSubscription(selected) ? `${planTypeLabel(selected, group.name)} · ${durationLabel(selected.billing_days)}` : 'One-time'}</span>
        {selected.id === best && <span className="plan-picker-tag is-best">Best value</span>}
        <span className={`plan-picker-stock${seats <= 0 && isSubscription(selected) ? ' is-out' : ''}`}>{stock}</span>
      </div>
      {selected.description && selected.description !== shownDescription && <p className="plan-picker-description">{selected.description}</p>}
    </div>

    {durations.length > 0 && <div className="plan-picker-group">
      <h3 id={durationId}>Duration</h3>
      <div className="plan-chips" role="radiogroup" aria-labelledby={durationId}>
        {durations.map(days => {
          const plan = find(days, selection.type) ?? find(days, null);
          const active = selected.billing_days === days;
          return <button key={days} type="button" role="radio" aria-checked={active}
            className={`plan-chip${active ? ' is-active' : ''}${soldOut(plan) ? ' is-sold-out' : ''}`} onClick={() => chooseDuration(days)}>
            {soldOut(plan) && <span className="plan-chip-flag">Sold out</span>}
            {durationLabel(days)}
          </button>;
        })}
      </div>
    </div>}

    {types.length > 1 && <div className="plan-picker-group">
      <h3 id={typeId}>{isSubscription(selected) ? 'Select type' : 'Select package'}</h3>
      <div className="plan-chips" role="radiogroup" aria-labelledby={typeId}>
        {types.map(([type, label]) => {
          const plan = find(selected.billing_days, type) ?? find(undefined, type);
          const active = planTypeKey(selected) === type;
          return <button key={type} type="button" role="radio" aria-checked={active}
            className={`plan-chip${active ? ' is-active' : ''}${soldOut(plan) ? ' is-sold-out' : ''}`} onClick={() => chooseType(type)}>
            {soldOut(plan) && <span className="plan-chip-flag">Sold out</span>}
            {label}
          </button>;
        })}
      </div>
    </div>}

    {blocked && <p className="plan-picker-blocked" role="status">{blocked === 'Sold out' ? 'This option is sold out. Choose another duration or type.' : blocked}</p>}
    <div className="plan-picker-actions">
      <button type="button" className="service-button service-button-outline" disabled={blocked !== null}
        aria-label={`Add ${selected.name} to cart`} onClick={() => purchase(false)}><IconShoppingCart size={18} aria-hidden="true" />Add to cart</button>
      <button type="button" className="service-button service-button-primary" disabled={blocked !== null}
        aria-label={`Buy ${selected.name} now`} onClick={() => purchase(true)}><IconBolt size={18} aria-hidden="true" />Buy now</button>
    </div>
  </div>;
}

/** The picker as a modal sheet over the catalog (bottom sheet on phones). */
export function PlanSheet({ group, onClose }: { group: PlanGroup; onClose: () => void }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const branding = group.plans[0];
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"], button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);
  return createPortal(<div className="plan-sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="plan-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
      <div className="plan-sheet-head">
        <BrandLogo product={{ ...branding, name: group.name }} size={44} />
        <h2 id={titleId}>{group.name}</h2>
        <button type="button" className="plan-sheet-close" aria-label="Close" onClick={onClose}><IconX size={20} /></button>
      </div>
      <PlanPicker group={group} onDone={onClose} />
    </div>
  </div>, document.body);
}
