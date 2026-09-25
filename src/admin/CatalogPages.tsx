import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import type { Category, Plan, PlanKind } from '../features/api';
import { fetchTopupPackages, readResource, useCommand, useResource } from '../features/api';
import { formatMoney } from '../lib/money';
import BrandLogo from '../components/BrandLogo';
import { resolveService, servicesForCategory, SERVICES } from '../data/logos';
import { AsyncState, Badge, CheckField, Dialog, EmptyState, ErrorNotice, Field, FormFooter, PageHeading, Pagination, SearchBox, Table } from './shared';
import { useListFilters } from './hooks';
import { integerInput, planForm, planInput, validSlug } from './validation';
import type { PlanForm } from './validation';

function useCategories() {
  return useQuery({
    queryKey: ['bren', 'category-options'],
    queryFn: async () => {
      const categories: Category[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await readResource('categories', { page, page_size: 100 });
        categories.push(...result.rows);
        total = result.total;
        if (!result.rows.length) break;
        page++;
      } while (categories.length < total);
      return categories;
    },
    retry: false,
  });
}

export function PlanEditor({ plan, onClose }: { plan?: Plan; onClose: () => void }) {
  const [initial] = useState(() => planForm(plan));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const categories = useCategories();
  const command = useCommand();
  const category = categories.data?.find(item => item.id === form.category_id);
  const services = servicesForCategory(category?.slug);
  const currentService = resolveService(form.brand_key, form.name);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const update = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const packages = useQuery({
    queryKey: ['bren', 'topup-packages'],
    queryFn: fetchTopupPackages,
    enabled: form.kind === 'topup',
    staleTime: 60_000,
    retry: false,
  });
  function selectService(key: string) {
    const service = SERVICES.find(item => item.key === key);
    setForm(previous => {
      if (!service) return { ...previous, brand_key: key };
      const oldService = resolveService(previous.brand_key, previous.name);
      return {
        ...previous, brand_key: service.key, initial: service.initial,
        color_start: service.color_start, color_end: service.color_end,
        name: !previous.name.trim() || previous.name === oldService?.name ? service.name : previous.name,
        slug: !previous.slug.trim() || previous.slug === oldService?.key ? service.key : previous.slug,
      };
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    setError(null);
    try {
      const input = planInput(form, plan?.id);
      if (form.status === 'active' && categories.data?.some(category => category.id === form.category_id && category.archived)) throw new Error('Choose an active category before publishing.');
      if (plan && (form.status === 'archived' || (plan.status === 'active' && form.status !== 'active')) && plan.status !== form.status) {
        if (!window.confirm('Remove this plan from sale? Existing order history and allocations will be preserved.')) return;
      }
      await command.mutateAsync({ action: 'save_plan', input });
      onClose();
    } catch (cause) { setError(cause); }
  }
  return <Dialog title={plan ? `Edit ${plan.name}` : 'Create plan'} onClose={onClose} dirty={dirty} busy={command.isPending} wide>
    <form onSubmit={submit}><fieldset disabled={command.isPending} className="admin-dialog-body">
      <h3>Plan details</h3><div className="admin-form-grid">
        <Field label="Plan name"><input autoFocus required maxLength={160} value={form.name} onChange={event => update('name', event.target.value)} /></Field>
        <Field label="Slug" hint="A stable URL-safe identifier, e.g. premium-monthly."><input required maxLength={120} value={form.slug} onChange={event => update('slug', event.target.value)} /></Field>
      </div>
      <Field label="Description"><textarea rows={3} maxLength={4000} value={form.description} onChange={event => update('description', event.target.value)} /></Field>
      <div className="admin-form-grid">
        <Field label="Category"><select value={form.category_id} onChange={event => update('category_id', event.target.value)} disabled={categories.isPending || Boolean(categories.error)}>
          <option value="">Uncategorized</option>{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}{category.archived ? ' (archived)' : ''}</option>)}</select></Field>
        <Field label="Service / brand" hint="Name and logo shortcuts only. No product, price or stock is created."><select value={form.brand_key} onChange={event => selectService(event.target.value)} disabled={!category || categories.isPending || Boolean(categories.error)}>
          <option value="">Automatic from exact plan name</option>
          <option value="custom">Custom service / fallback initial</option>
          {form.brand_key && form.brand_key !== 'custom' && !services.some(service => service.key === form.brand_key) &&
            <option value={form.brand_key}>{currentService?.name ?? form.brand_key} (current branding)</option>}
          {services.map(service => <option key={service.key} value={service.key}>{service.name}{service.icon ? '' : ' (initials only)'}</option>)}
        </select></Field>
      </div>{categories.isPending && <p role="status">Loading categories…</p>}{categories.error && <ErrorNotice error={categories.error} retry={() => { void categories.refetch(); }} />}
      <div className="admin-brand-preview" aria-label="Brand preview">
        <BrandLogo product={form} size={48} />
        <div><strong>{currentService?.name ?? (form.name || 'Custom service')}</strong><p>{currentService?.icon ? 'Bundled brand logo' : 'Fallback initials; no bundled logo for this service.'}</p></div>
      </div>
      <p className="admin-muted">Choose a category to see its service names. Selecting a service fills blank name/slug fields and applies its branding; custom names, prices and billing terms are kept. Changing category alone keeps existing branding.</p>
      <h3>Fulfillment</h3><div className="admin-form-grid">
        <Field label="Product type" hint="Top-ups are delivered automatically by the provider after payment confirmation; subscriptions keep manual seat fulfillment."><select value={form.kind} onChange={event => update('kind', event.target.value as PlanKind)}>
          <option value="seat">Subscription seats</option><option value="topup">Game top-up</option></select></Field>
        {form.kind === 'topup' && <Field label="Provider package" hint="Live from the top-up provider. The points cost is charged to the store balance on delivery; your sell prices are set below."><select required value={form.provider_package_id} onChange={event => update('provider_package_id', event.target.value)} disabled={packages.isPending || packages.isError}>
          <option value="">Choose a package…</option>
          {packages.data?.map(option => <option key={option.id} value={option.id}>#{option.id} · {option.name} · costs {option.cost_points} points</option>)}
          {form.provider_package_id && !packages.data?.some(option => option.id === form.provider_package_id) &&
            <option value={form.provider_package_id}>#{form.provider_package_id} · current package (not in the latest provider list)</option>}
        </select></Field>}
      </div>
      {form.kind === 'topup' && packages.isPending && <p role="status">Loading provider packages…</p>}
      {form.kind === 'topup' && packages.isError && <ErrorNotice error={packages.error} retry={() => { void packages.refetch(); }} />}
      {form.kind === 'seat' && <Field label="Billing term (days)"><input type="number" min={1} max={3650} step={1} required value={form.billing_days} onChange={event => update('billing_days', event.target.value)} /></Field>}
      <h3>Independent prices</h3><p className="admin-muted">Enter each currency separately. No exchange-rate conversion is used. Publishing requires both prices.</p>
      <div className="admin-form-grid">
        <Field label="USD price" hint="Up to two decimal places."><input inputMode="decimal" placeholder="0.00" value={form.usd} onChange={event => update('usd', event.target.value)} /></Field>
        <Field label="ETB price" hint="Up to two decimal places."><input inputMode="decimal" placeholder="0.00" value={form.etb} onChange={event => update('etb', event.target.value)} /></Field>
        <Field label="USD comparison price (optional)"><input inputMode="decimal" value={form.usdCompare} onChange={event => update('usdCompare', event.target.value)} /></Field>
        <Field label="ETB comparison price (optional)"><input inputMode="decimal" value={form.etbCompare} onChange={event => update('etbCompare', event.target.value)} /></Field>
      </div><h3>Brand appearance</h3><div className="admin-form-grid">
        <Field label="Brand key (optional)" hint="Set by the service selector. Blank detects an exact known plan name; custom forces the fallback initial."><input maxLength={80} value={form.brand_key} onChange={event => update('brand_key', event.target.value)} /></Field>
        <Field label="Fallback initial"><input required maxLength={8} value={form.initial} onChange={event => update('initial', event.target.value)} /></Field>
        <Field label="Start color"><input type="color" value={form.color_start} onChange={event => update('color_start', event.target.value)} /></Field>
        <Field label="End color"><input type="color" value={form.color_end} onChange={event => update('color_end', event.target.value)} /></Field>
      </div><h3>Availability and visibility</h3><div className="admin-form-grid">
        <Field label="Status"><select value={form.status} onChange={event => update('status', event.target.value as Plan['status'])}>
          <option value="draft">Draft</option><option value="active">Active / published</option><option value="archived">Archived</option></select></Field>
        {form.kind === 'seat' && <Field label="Low-stock threshold" hint="Capacity is managed separately in Inventory."><input type="number" min={0} max={1000000} step={1} required value={form.low_stock_threshold} onChange={event => update('low_stock_threshold', event.target.value)} /></Field>}
      </div><CheckField label="Feature this plan on the storefront" checked={form.featured} onChange={value => update('featured', value)} />
      {Boolean(error) && <ErrorNotice error={error} />}
    </fieldset><FormFooter busy={command.isPending} label={plan ? 'Save plan' : 'Create plan'} /></form>
  </Dialog>;
}

export function PlansPage() {
  const filters = useListFilters();
  const result = useResource('plans', filters.args);
  const categories = useCategories();
  const [editor, setEditor] = useState<Plan | 'new' | null>(null);
  return <><PageHeading title="Plans" description="Manage your subscription catalog and independent currency prices."
    action={<button className="admin-button admin-button-primary" onClick={() => setEditor('new')}><IconPlus size={17} />Create plan</button>} />
    <section className="admin-panel"><div className="admin-toolbar">
      <SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search plans" />
      <label className="admin-inline-field">Status<select value={filters.status} onChange={event => filters.setFilter('status', event.target.value)}>
        <option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
      <label className="admin-inline-field">Category<select value={filters.categoryId} disabled={categories.isPending || Boolean(categories.error)} onChange={event => filters.setFilter('category_id', event.target.value)}>
        <option value="">All categories</option>{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    </div>{categories.error && <ErrorNotice error={categories.error} retry={() => { void categories.refetch(); }} />}
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Subscription plans" columns={['Plan', 'Status', 'USD price', 'ETB price', 'Seats', 'Actions']}>
          {result.data.rows.map(plan => <tr key={plan.id}><td><div className="admin-plan-cell"><span className="admin-brand-initial" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${plan.color_start}, ${plan.color_end})` }}>{plan.initial}</span>
            <div><strong>{plan.name}</strong><small>{plan.category_name ?? 'Uncategorized'} · {plan.kind === 'topup' ? `top-up · package #${plan.provider_package_id ?? '?'}` : `${plan.billing_days} days`}{plan.featured ? ' · Featured' : ''}</small></div></div></td>
            <td><Badge value={plan.status} /></td><td className="admin-numeric">{plan.usd_minor === null ? 'Not set' : formatMoney(plan.usd_minor, 'USD')}</td>
            <td className="admin-numeric">{plan.etb_minor === null ? 'Not set' : formatMoney(plan.etb_minor, 'ETB')}</td><td className="admin-numeric">{plan.kind === 'topup' ? 'Provider-delivered' : `${plan.available} available / ${plan.capacity}`}</td>
            <td><button className="admin-button admin-button-small" aria-label={`Edit ${plan.name}`} onClick={() => setEditor(plan)}>Edit</button></td></tr>)}
        </Table> : <EmptyState title={filters.query || filters.status || filters.categoryId ? 'No matching plans' : 'Your catalog is empty'}>Create a draft plan, add both prices, then set its capacity before publishing.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState>
    </section>{editor && <PlanEditor plan={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}</>;
}

function CategoryEditor({ category, onClose }: { category?: Category; onClose: () => void }) {
  const initial = { name: category?.name ?? '', slug: category?.slug ?? '', sort: String(category?.sort_order ?? 0), archived: category?.archived ?? false };
  const [form, setForm] = useState(initial);
  const command = useCommand();
  const [error, setError] = useState<unknown>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    setError(null);
    try {
      if (!form.name.trim()) throw new Error('Enter a category name.');
      validSlug(form.slug.trim());
      const sort = integerInput(form.sort, 'Sort order', -1_000_000);
      if (form.archived && !category?.archived && !window.confirm('Archive this category? Reassign or archive its active plans first. Historical references will remain intact.')) return;
      await command.mutateAsync({ action: 'save_category', input: { ...(category ? { id: category.id } : {}), name: form.name.trim(), slug: form.slug.trim(), sort_order: sort, archived: form.archived } });
      onClose();
    } catch (cause) { setError(cause); }
  }
  return <Dialog title={category ? 'Edit category' : 'Create category'} onClose={onClose} dirty={dirty} busy={command.isPending}>
    <form onSubmit={submit}><fieldset disabled={command.isPending} className="admin-dialog-body">
      <Field label="Category name"><input autoFocus required maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
      <Field label="Slug"><input required maxLength={120} value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} /></Field>
      <Field label="Sort order" hint="Lower numbers appear first."><input type="number" min={-1000000} max={1000000} step={1} required value={form.sort} onChange={event => setForm({ ...form, sort: event.target.value })} /></Field>
      <CheckField label="Archive category" checked={form.archived} onChange={archived => setForm({ ...form, archived })} />
      <p className="admin-muted">Before archiving, reassign active plans using their plan editor. Categories are not deleted, preserving historical references.</p>
      {Boolean(error) && <ErrorNotice error={error} />}</fieldset><FormFooter busy={command.isPending} /></form></Dialog>;
}

export function CategoriesPage() {
  const filters = useListFilters();
  const result = useResource('categories', filters.args);
  const [editor, setEditor] = useState<Category | 'new' | null>(null);
  return <><PageHeading title="Categories" description="Organize plans without changing historical order records."
    action={<button className="admin-button admin-button-primary" onClick={() => setEditor('new')}><IconPlus size={17} />Create category</button>} />
    <section className="admin-panel"><div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search categories" /></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Categories" columns={['Category', 'Slug', 'Sort order', 'Status', 'Actions']}>
          {result.data.rows.map(category => <tr key={category.id}><td><strong>{category.name}</strong></td><td>{category.slug}</td><td className="admin-numeric">{category.sort_order}</td><td><Badge value={category.archived ? 'archived' : 'active'} /></td>
            <td><button className="admin-button admin-button-small" onClick={() => setEditor(category)} aria-label={`Edit ${category.name}`}>Edit</button></td></tr>)}
        </Table> : <EmptyState title={filters.query ? 'No matching categories' : 'No categories yet'}>Add categories to organize your storefront. Uncategorized plans remain manageable.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} pageSize={result.data.page_size} total={result.data.total} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState></section>{editor && <CategoryEditor category={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}</>;
}
