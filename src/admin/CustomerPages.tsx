import { Link, useParams } from 'react-router-dom';
import { useResource } from '../features/api';
import { AsyncState, EmptyState, NoteForm, PageHeading, Pagination, SearchBox, Table } from './shared';
import { useListFilters } from './hooks';
import { dateTime, shortId } from './utils';
import { OrderTable } from './OrderPages';

export function CustomersPage() {
  const filters = useListFilters();
  const result = useResource('customers', filters.args);
  return <><PageHeading title="Customers" description="Account contact information, order history, and internal notes." />
    <section className="admin-panel"><div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search name, email or phone" /></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Customers" columns={['Customer', 'Email', 'Phone', 'Telegram', 'Joined']}>
          {result.data.rows.map(customer => <tr key={customer.id}><td><Link to={`/admin/customers/${customer.id}`} className="admin-strong-link">{customer.name || 'Unnamed customer'}</Link><small>Account {shortId(customer.id)}</small></td>
            <td>{customer.email || 'Not provided'}</td><td>{customer.phone || 'Not provided'}</td><td>{customer.telegram || 'Not provided'}</td><td>{dateTime(customer.created_at)}</td></tr>)}
        </Table> : <EmptyState title={filters.query ? 'No matching customers' : 'No customer profiles yet'}>Real customer profiles will appear after account registration.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} total={result.data.total} pageSize={result.data.page_size} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState>
    </section></>;
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const result = useResource('customer', { id }, Boolean(id));
  const detail = result.data;
  return <><Link to="/admin/customers" className="admin-back-link">← All customers</Link><PageHeading title={detail?.customer.name || 'Customer profile'} description="Identity is tied to the customer’s authenticated account and is not editable here." />
    <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
      {detail && <div className="admin-detail-grid"><div>
        <section className="admin-panel"><div className="admin-panel-heading"><h2>Order history</h2><span className="admin-muted">{detail.orders.length} orders</span></div>
          {detail.orders.length ? <OrderTable orders={detail.orders} /> : <EmptyState title="No orders for this customer">Their persisted orders will appear here.</EmptyState>}</section>
        <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Internal notes</h2></div><div className="admin-panel-body">
          <NoteForm kind="customer" id={detail.customer.id} />
          {detail.notes.length ? <ol className="admin-timeline">{detail.notes.map(note => <li key={note.id}><div><strong>Staff note</strong><time dateTime={note.created_at}>{dateTime(note.created_at)}</time></div><p>{note.note}</p><small>{note.actor_id ? `Staff ${shortId(note.actor_id)}` : 'System'}</small></li>)}</ol> :
            <EmptyState title="No internal notes">Use notes to record useful context for the team.</EmptyState>}
        </div></section>
      </div><aside className="admin-panel admin-fit-height"><div className="admin-panel-heading"><h2>Account details</h2></div><div className="admin-panel-body">
        <dl className="admin-description-list"><dt>Name</dt><dd>{detail.customer.name || 'Not provided'}</dd><dt>Email</dt><dd>{detail.customer.email || 'Not provided'}</dd>
          <dt>Phone</dt><dd>{detail.customer.phone || 'Not provided'}</dd><dt>Telegram</dt><dd>{detail.customer.telegram || 'Not provided'}</dd><dt>Joined</dt><dd>{dateTime(detail.customer.created_at)}</dd><dt>Account ID</dt><dd className="admin-code">{detail.customer.id}</dd></dl>
      </div></aside></div>}
    </AsyncState></>;
}
