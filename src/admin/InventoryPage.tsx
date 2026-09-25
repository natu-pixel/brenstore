import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Plan, ResourceData } from '../features/api';
import { useCommand, useResource } from '../features/api';
import { AsyncState, Badge, Dialog, EmptyState, ErrorNotice, Field, FormFooter, PageHeading, Pagination, ReasonDialog, SearchBox, Table } from './shared';
import { useListFilters } from './hooks';
import { dateTime } from './utils';
import { integerInput } from './validation';

function CapacityDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [capacity, setCapacity] = useState(String(plan.capacity));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const command = useCommand();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    setError(null);
    try {
      const value = integerInput(capacity, 'Capacity');
      if (value < plan.allocated) throw new Error(`Capacity cannot be lower than the ${plan.allocated} allocated seats. Revoke access and explicitly release allocations first.`);
      if (value === plan.capacity) throw new Error('Enter a different capacity.');
      if (!reason.trim()) throw new Error('Enter a reason for this adjustment.');
      if (!window.confirm(`Change ${plan.name} capacity from ${plan.capacity} to ${value}? This adjustment will be recorded.`)) return;
      await command.mutateAsync({ action: 'adjust_capacity', input: { plan_id: plan.id, capacity: value, reason: reason.trim() } });
      onClose();
    } catch (cause) { setError(cause); }
  }
  return <Dialog title="Adjust seat capacity" onClose={onClose} dirty={capacity !== String(plan.capacity) || Boolean(reason)} busy={command.isPending}>
    <form onSubmit={submit}><fieldset className="admin-dialog-body" disabled={command.isPending}>
      <h3>{plan.name}</h3><p>{plan.allocated} allocated · {plan.available} available · {plan.capacity} total capacity</p>
      <Field label="New total capacity" hint="This is the total, not the number of seats to add."><input autoFocus required type="number" step={1} min={plan.allocated} max={1000000} value={capacity} onChange={event => setCapacity(event.target.value)} /></Field>
      <Field label="Adjustment reason"><textarea required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      <p className="admin-muted">Capacity is checked again on the server against current allocations. Pending orders do not hold seats.</p>
      {Boolean(error) && <ErrorNotice error={error} />}</fieldset><FormFooter busy={command.isPending} label="Record adjustment" /></form></Dialog>;
}

export default function InventoryPage() {
  const filters = useListFilters();
  // Top-up plans are provider-delivered and never hold seat capacity.
  const result = useResource('inventory', { ...filters.args, kind: 'seat' });
  const [selected, setSelected] = useState<Plan | null>(null);
  const [capacityPlan, setCapacityPlan] = useState<Plan | null>(null);
  return <><PageHeading title="Seat inventory" description="Available seats are capacity minus unreleased allocations. Pending orders never reserve seats." />
    <section className="admin-panel"><div className="admin-toolbar">
      <SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search inventory" />
      <label className="admin-inline-field">Status<select value={filters.status} onChange={event => filters.setFilter('status', event.target.value)}>
        <option value="">All plans</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label>
    </div><AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
      {result.data && (result.data.rows.length ? <Table label="Seat inventory" columns={['Plan', 'Capacity', 'Allocated', 'Available', 'Stock level', 'Actions']}>
        {result.data.rows.map(plan => <tr key={plan.id}><td><strong>{plan.name}</strong><small>{plan.status} · alert at {plan.low_stock_threshold} seats</small></td>
          <td className="admin-numeric">{plan.capacity}</td><td className="admin-numeric">{plan.allocated}</td><td className="admin-numeric"><strong>{plan.available ?? 0}</strong></td>
          <td><Badge value={(plan.available ?? 0) === 0 ? 'out_of_stock' : (plan.available ?? 0) <= plan.low_stock_threshold ? 'low_stock' : 'available'} /></td>
          <td><div className="admin-row-actions"><button className="admin-button admin-button-small" onClick={() => setCapacityPlan(plan)} aria-label={`Adjust ${plan.name} capacity`}>Adjust</button>
            <button className="admin-button admin-button-small" onClick={() => setSelected(plan)} aria-label={`View ${plan.name} allocations`}>Allocations & history</button></div></td></tr>)}
      </Table> : <EmptyState title={filters.query || filters.status ? 'No matching inventory' : 'No plans to stock'} action={<Link className="admin-button" to="/admin/plans">Manage plans</Link>}>Create a plan first, then record its actual seat capacity here.</EmptyState>)}
      {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={page => filters.setFilter('page', String(page))} />}
    </AsyncState></section>
    {capacityPlan && <CapacityDialog plan={capacityPlan} onClose={() => setCapacityPlan(null)} />}
    <InventoryHistory key={selected?.id ?? 'all'} plan={selected} onClear={() => setSelected(null)} />
  </>;
}

function InventoryHistory({ plan, onClear }: { plan: Plan | null; onClear: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (plan) {
      heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      heading.current?.focus({ preventScroll: true });
    }
  }, [plan]);
  const [tab, setTab] = useState<'allocations' | 'movements'>('allocations');
  const [allocationPage, setAllocationPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const [status, setStatus] = useState('active');
  const [release, setRelease] = useState<ResourceData['allocations']['rows'][number] | null>(null);
  const key = plan?.id ?? '';
  return <section className="admin-panel admin-section-gap" aria-labelledby="inventory-history-heading">
    <div className="admin-panel-heading"><div><h2 id="inventory-history-heading" ref={heading} tabIndex={-1}>{plan ? plan.name : 'All plans'} — allocations & history</h2><p>Expiry is a follow-up date, not an automatic release. Remove access before releasing a seat.</p></div>
      {plan && <button className="admin-button admin-button-small" onClick={onClear}>Show all plans</button>}</div>
    <div className="admin-tabs" role="tablist" aria-label="Inventory records" onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 'allocations' : event.key === 'End' ? 'movements' : tab === 'allocations' ? 'movements' : 'allocations';
        setTab(next);
        document.getElementById(`${next}-tab`)?.focus();
      }
    }}>
      <button role="tab" id="allocations-tab" aria-controls="allocations-panel" tabIndex={tab === 'allocations' ? 0 : -1} aria-selected={tab === 'allocations'} onClick={() => setTab('allocations')}>Seat allocations</button>
      <button role="tab" id="movements-tab" aria-controls="movements-panel" tabIndex={tab === 'movements' ? 0 : -1} aria-selected={tab === 'movements'} onClick={() => setTab('movements')}>Movement history</button>
    </div>
    {tab === 'allocations' ? <div role="tabpanel" id="allocations-panel" aria-labelledby="allocations-tab">
      <div className="admin-toolbar"><label className="admin-inline-field">Allocation status<select value={status} onChange={event => { setStatus(event.target.value); setAllocationPage(1); }}>
        <option value="active">Active allocations</option><option value="released">Released allocations</option><option value="">All allocations</option>
      </select></label></div>
      <AllocationTable key={`allocations-${key}`} planId={plan?.id} page={allocationPage} onPage={setAllocationPage} status={status} onRelease={setRelease} />
    </div> : <div role="tabpanel" id="movements-panel" aria-labelledby="movements-tab">
      <MovementTable key={`movements-${key}`} planId={plan?.id} page={movementPage} onPage={setMovementPage} />
    </div>}
    {release && <ReasonDialog title="Release seat allocation" action="release_allocation" input={{ id: release.id }} onClose={() => setRelease(null)}
      description={`Release ${release.qty} seat(s) for ${release.customer_name} on ${release.plan_name} (${release.order_reference}). This does not cancel a confirmed payment or issue a refund.`}
      acknowledge="I have removed the customer's access before releasing these seats." label="Release allocation" />}
  </section>;
}

function AllocationTable({ planId, page, onPage, status, onRelease }: {
  planId?: string; page: number; onPage: (page: number) => void; status: string; onRelease: (allocation: ResourceData['allocations']['rows'][number]) => void;
}) {
  const result = useResource('allocations', { plan_id: planId, page, page_size: 20, status });
  const [now] = useState(() => Date.now());
  return <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
    {result.data && (result.data.rows.length ? <Table label="Seat allocations" columns={['Plan / customer', 'Order', 'Seats', 'Service dates', 'Status', 'Actions']}>
      {result.data.rows.map(allocation => <tr key={allocation.id}><td><strong>{allocation.plan_name}</strong><small>{allocation.customer_name}</small></td>
        <td><Link to={`/admin/orders/${allocation.order_id}`}>{allocation.order_reference}</Link></td><td className="admin-numeric">{allocation.qty}</td>
        <td><span>{dateTime(allocation.started_at)}</span><small>Until {dateTime(allocation.ends_at)}</small></td>
        <td><Badge value={allocation.released_at ? 'released' : new Date(allocation.ends_at).getTime() < now ? 'review_access' : 'active'} /></td>
        <td>{allocation.released_at ? <><span>{dateTime(allocation.released_at)}</span><small>{allocation.release_reason}</small></> :
          <button className="admin-button admin-button-small admin-button-danger" onClick={() => onRelease(allocation)} aria-label={`Release allocation for ${allocation.customer_name}`}>Release</button>}</td></tr>)}
    </Table> : <EmptyState title="No allocations found">Seats are allocated only after a verified payment is confirmed. Pending orders do not appear here.</EmptyState>)}
    {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={onPage} />}
  </AsyncState>;
}

function MovementTable({ planId, page, onPage }: { planId?: string; page: number; onPage: (page: number) => void }) {
  const result = useResource('movements', { plan_id: planId, page, page_size: 20 });
  return <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
    {result.data && (result.data.rows.length ? <Table label="Inventory movement history" columns={['Date', 'Plan', 'Seat change', 'Reason']}>
      {result.data.rows.map(movement => <tr key={movement.id}><td>{dateTime(movement.created_at)}</td><td>{movement.plan_name}</td><td className="admin-numeric">{movement.delta > 0 ? '+' : ''}{movement.delta}</td><td className="admin-wrap">{movement.reason}</td></tr>)}
    </Table> : <EmptyState title="No inventory movements">Recorded capacity adjustments and allocation releases will appear here.</EmptyState>)}
    {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={onPage} />}
  </AsyncState>;
}
