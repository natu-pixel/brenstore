import { Link } from 'react-router-dom';
import { IconArrowRight, IconArrowUpRight, IconBox, IconChecks, IconClock, IconStack2 } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthProvider';
import { useResource } from '../features/api';
import { formatMoney } from '../lib/money';
import { AsyncState, EmptyState, PageHeading } from './shared';
import { canManage, dateTime, titleCase } from './utils';
import { OrderTable } from './OrderPages';

export default function OverviewPage() {
  const { role } = useAuth();
  const result = useResource('dashboard');
  const activity = useResource('activity', { page: 1, page_size: 5 }, role === 'owner');
  const data = result.data;
  const managing = canManage(role);
  return <><PageHeading title="Overview" description="A current view of orders, catalog availability, and work that needs attention."
    action={<Link className="admin-button" to="/admin/orders">View orders<IconArrowUpRight size={16} /></Link>} />
    <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
      {data && <>
        <div className="admin-stat-grid">
          <div className="admin-stat"><div><span>Pending orders</span><IconClock size={19} /></div><strong>{data.pending_orders}</strong><Link to="/admin/orders?status=pending">Review orders<IconArrowRight size={14} /></Link></div>
          <div className="admin-stat"><div><span>Active plans</span><IconBox size={19} /></div><strong>{data.active_plans}</strong>{managing ? <Link to="/admin/plans?status=active">Manage catalog<IconArrowRight size={14} /></Link> : <small>Published catalog</small>}</div>
          <div className="admin-stat"><div><span>Available seats</span><IconStack2 size={19} /></div><strong>{data.available_seats}</strong><small>Across tracked plans</small></div>
          <div className="admin-stat"><div><span>Low-stock plans</span><IconChecks size={19} /></div><strong>{data.low_stock}</strong>{managing ? <Link to="/admin/inventory">Review inventory<IconArrowRight size={14} /></Link> : <small>At or below threshold</small>}</div>
        </div>
        {managing && <section className="admin-panel admin-financial-summary" aria-labelledby="confirmed-payments-heading">
          <div><h2 id="confirmed-payments-heading">Confirmed payments</h2><p className="admin-muted">All-time received payments, kept separate by currency.</p></div>
          <div><span>USD</span><strong>{data.confirmed_usd_minor === null ? 'Unavailable' : formatMoney(data.confirmed_usd_minor, 'USD')}</strong></div>
          <div><span>ETB</span><strong>{data.confirmed_etb_minor === null ? 'Unavailable' : formatMoney(data.confirmed_etb_minor, 'ETB')}</strong></div>
        </section>}
        <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Recent orders</h2><Link to="/admin/orders">View all<IconArrowRight size={15} /></Link></div>
          {data.recent_orders.length ? <OrderTable orders={data.recent_orders} /> : <EmptyState title="No orders yet">When a customer submits an order, it will appear here. Pending orders do not reserve seats.</EmptyState>}</section>
      </>}
    </AsyncState>
    {role === 'owner' && <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Recent activity</h2><Link to="/admin/activity">Full activity log<IconArrowRight size={15} /></Link></div>
      <AsyncState pending={activity.isPending} error={activity.error} retry={() => { void activity.refetch(); }}>
        {activity.data && (activity.data.rows.length ? <ul className="admin-activity-list">{activity.data.rows.map(entry => <li key={entry.id}><div><strong>{titleCase(entry.action)}</strong><p>{entry.summary}</p></div><time dateTime={entry.created_at}>{dateTime(entry.created_at)}</time></li>)}</ul> :
          <EmptyState title="No recorded activity">Catalog and operational changes will create an audit trail.</EmptyState>)}
      </AsyncState>
    </section>}
  </>;
}
