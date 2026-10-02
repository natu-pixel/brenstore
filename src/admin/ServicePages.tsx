import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCommand, useResource } from '../features/api';
import type { OptionCode, Plan, Service } from '../features/api';
import { SERVICES, servicesForCategory } from '../data/logos';
import { optionLabels, optionSummary } from '../data/plan-options';
import { formatMoney } from '../lib/money';
import { PlanEditor } from './CatalogPages';
import { useCategories, useListFilters } from './hooks';
import { validSlug } from './validation';
import { AsyncState, Badge, Dialog, EmptyState, ErrorNotice, Field, FormFooter, PageHeading, Pagination, SearchBox, Table } from './shared';

function ServiceEditor({ service, onClose }: { service?: Service; onClose: () => void }) {
  const [initial] = useState(() => ({
    name: service?.name ?? '', slug: service?.slug ?? '', category_id: service?.category_id ?? '',
    brand_key: service?.brand_key ?? 'custom', initial: service?.initial ?? '',
    color_start: service?.color_start ?? '#2563eb', color_end: service?.color_end ?? '#1e3a8a',
  }));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const categories = useCategories();
  const command = useCommand();
  const category = categories.data?.find(item => item.id === form.category_id);
  const presets = servicesForCategory(category?.slug);
  const update = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    setError(null);
    try {
      if (!form.name.trim() || !form.initial.trim()) throw new Error('Enter a service name and fallback initial.');
      validSlug(form.slug.trim());
      if (!category || category.archived) throw new Error('Choose an active category.');
      await command.mutateAsync({ action: 'save_service', input: { ...form, ...(service ? { id: service.id } : {}) } });
      onClose();
    } catch (cause) { setError(cause); }
  }
  return <Dialog title={service ? `Edit service ${service.name}` : 'Create service'} onClose={onClose}
    dirty={JSON.stringify(form) !== JSON.stringify(initial)} busy={command.isPending}>
    <form onSubmit={submit}><fieldset disabled={command.isPending} className="admin-dialog-body">
      <Field label="Category"><select required value={form.category_id} disabled={categories.isPending || categories.isError}
        onChange={event => update('category_id', event.target.value)}>
        <option value="">Choose a category</option>{categories.data?.map(item =>
          <option key={item.id} value={item.id} disabled={item.archived}>{item.name}{item.archived ? ' (archived)' : ''}</option>)}
      </select></Field>
      {categories.isError && <ErrorNotice error={categories.error} retry={() => { void categories.refetch(); }} />}
      <Field label="Brand preset"><select value={form.brand_key} onChange={event => {
        const preset = SERVICES.find(item => item.key === event.target.value);
        setForm(previous => preset ? { ...previous, name: previous.name || preset.name, slug: previous.slug || preset.key,
          brand_key: preset.key, initial: preset.initial, color_start: preset.color_start, color_end: preset.color_end }
          : { ...previous, brand_key: event.target.value });
      }}><option value="custom">Custom</option>
        {form.brand_key !== 'custom' && !presets.some(item => item.key === form.brand_key) && <option value={form.brand_key}>{form.brand_key} (current)</option>}
        {presets.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
      </select></Field>
      <Field label="Service name"><input required maxLength={160} value={form.name} onChange={event => update('name', event.target.value)} /></Field>
      <Field label="Service slug"><input required maxLength={120} value={form.slug} onChange={event => update('slug', event.target.value)} /></Field>
      <Field label="Fallback initial"><input required maxLength={8} value={form.initial} onChange={event => update('initial', event.target.value)} /></Field>
      <div className="admin-form-grid">
        <Field label="Start color"><input type="color" value={form.color_start} onChange={event => update('color_start', event.target.value)} /></Field>
        <Field label="End color"><input type="color" value={form.color_end} onChange={event => update('color_end', event.target.value)} /></Field>
      </div>
      <p className="admin-muted">All linked plans use this service's name and branding on their shared card. Existing order snapshots do not change.</p>
      {Boolean(error) && <ErrorNotice error={error} />}
    </fieldset><FormFooter busy={command.isPending} label={service ? 'Save service' : 'Create service'} /></form>
  </Dialog>;
}

export function ServicesPage() {
  const filters = useListFilters();
  const result = useResource('services', { page: filters.args.page, query: filters.query });
  const [creating, setCreating] = useState(false);
  return <><PageHeading title="Services" description="Category → Service → Purchase options. Open a service to manage its plans together."
    action={<button className="admin-button admin-button-primary" onClick={() => setCreating(true)}>Create service</button>} />
    <section className="admin-panel">
      <div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search services" /></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Services" columns={['Service', 'Category', 'Options']}>
          {result.data.rows.map(service => <tr key={service.id}><td><strong>{service.name}</strong></td><td>{service.category_name}</td>
            <td><Link className="admin-button" to={`/admin/services/${service.id}`}>Manage {service.name}</Link></td></tr>)}
        </Table> : <EmptyState title="No services yet">Create a service, then link existing plans or add its purchase options.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState>
    </section>{creating && <ServiceEditor onClose={() => setCreating(false)} />}</>;
}

export function ServiceDetailPage() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const result = useResource('services', { id }, Boolean(id));
  const plans = useResource('plans', { service_id: id, page }, Boolean(id));
  const service = result.data?.rows[0];
  const [editingService, setEditingService] = useState(false);
  const [editor, setEditor] = useState<Plan | OptionCode | null>(null);
  return <><Link to="/admin/services">Back to services</Link>
    <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
      {result.data && !service && <EmptyState title="Service not found">Return to the service list.</EmptyState>}
      {service && <>
        <PageHeading title={service.name} description={`${service.category_name} / ${service.name} / Purchase options`}
          action={<button className="admin-button" onClick={() => setEditingService(true)}>Edit service</button>} />
        <section className="admin-panel">
          <div className="admin-toolbar">{(['single_user', 'on_mail'] as const).map(code =>
            <button className="admin-button admin-button-primary" key={code} onClick={() => setEditor(code)}>Add {optionLabels[code]} option</button>)}
            <Link className="admin-button" to="/admin/plans">Link an existing plan</Link>
            <Link className="admin-button" to="/admin/inventory">Manage stock</Link>
          </div>
          <p className="admin-muted">One row is one sellable option and billing term. Stock is independent per plan. Users included is the package size, not available stock. Link existing plans in their plan editor; do not recreate them.</p>
          <AsyncState pending={plans.isPending} error={plans.error} retry={() => { void plans.refetch(); }}>
            {plans.data && (plans.data.rows.length ? <Table label={`${service.name} options`} columns={['Option / plan', 'Term', 'USD', 'ETB', 'Stock', 'Status', 'Actions']}>
              {plans.data.rows.map(plan => <tr key={plan.id}>
                <td><strong>{optionSummary(plan) || 'Unclassified - review required'}</strong><small>{plan.name}</small></td>
                <td>{plan.billing_days} days</td>
                <td>{plan.usd_minor == null ? 'Not set' : formatMoney(plan.usd_minor, 'USD')}</td>
                <td>{plan.etb_minor == null ? 'Not set' : formatMoney(plan.etb_minor, 'ETB')}</td>
                <td>{plan.available} units</td><td><Badge value={plan.status} /></td>
                <td><button className="admin-button" onClick={() => setEditor(plan)}>Edit {plan.name}</button></td>
              </tr>)}
            </Table> : <EmptyState title="No options linked">Add a priced option or link an existing plan. Missing options are never invented.</EmptyState>)}
            {plans.data && <Pagination page={plans.data.page} pageSize={plans.data.page_size} total={plans.data.total} onPage={setPage} />}
          </AsyncState>
        </section>
        {editingService && <ServiceEditor service={service} onClose={() => setEditingService(false)} />}
        {editor && <PlanEditor plan={typeof editor === 'string' ? undefined : editor}
          service={service} option={typeof editor === 'string' ? editor : undefined} onClose={() => setEditor(null)} />}
      </>}
    </AsyncState>
  </>;
}
