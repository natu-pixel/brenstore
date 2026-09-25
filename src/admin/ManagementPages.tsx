import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthProvider';
import type { ResourceData, Role } from '../features/api';
import { inviteStaff, useCommand, useResource } from '../features/api';
import { safeTelegramUrl } from '../lib/telegram';
import { AsyncState, Badge, CheckField, Dialog, EmptyState, ErrorNotice, Field, FormFooter, PageHeading, Pagination, SearchBox, Table } from './shared';
import { useDirtyGuard, useListFilters } from './hooks';
import { dateTime, shortId, titleCase } from './utils';

type Staff = ResourceData['team']['rows'][number];

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('support');
  const cache = useQueryClient();
  const invitation = useMutation({
    mutationFn: () => inviteStaff(email.trim(), role),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['bren', 'team'] }),
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invitation.isPending) return;
    if (role === 'owner' && !window.confirm('Invite this person as an owner? Owners can manage staff, settings, and all store operations.')) return;
    try { await invitation.mutateAsync(); onClose(); } catch { /* Invitation error is rendered below. */ }
  }
  return <Dialog title="Invite team member" onClose={onClose} dirty={Boolean(email) || role !== 'support'} busy={invitation.isPending}>
    <form onSubmit={submit}><fieldset className="admin-dialog-body" disabled={invitation.isPending}>
      <p>New accounts receive an invitation email. Existing accounts receive staff access without another email; tell that person to sign in. Store registration never grants staff access.</p>
      <Field label="Email address"><input autoFocus required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Field label="Staff role"><RoleSelect role={role} onChange={setRole} /></Field><RoleDescription role={role} />
      {invitation.error && <ErrorNotice error={invitation.error} />}</fieldset><FormFooter busy={invitation.isPending} label="Send invitation" /></form></Dialog>;
}

function RoleSelect({ role, onChange }: { role: Role; onChange: (value: Role) => void }) {
  return <select value={role} onChange={event => onChange(event.target.value as Role)}><option value="support">Support</option><option value="manager">Manager</option><option value="owner">Owner</option></select>;
}

function RoleDescription({ role }: { role: Role }) {
  return <p className="admin-callout">{role === 'owner' ? 'Full operational access, staff management, store settings, and sensitive activity history.' :
    role === 'manager' ? 'Catalog, capacity, orders, payment confirmation, fulfillment, and customer operations. No team or store-setting access.' :
      'Operational overview, orders, customers, and internal notes. No financial summaries, catalog changes, or payment actions.'}</p>;
}

function StaffEditor({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { user, refreshRole } = useAuth();
  const [role, setRole] = useState(staff.role);
  const [active, setActive] = useState(staff.active);
  const command = useCommand();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    if (!window.confirm(`Save ${role} access for ${staff.email || staff.name}, ${active ? 'active' : 'suspended'}?${user?.id === staff.id ? ' You are changing your own access.' : ''}`)) return;
    try {
      await command.mutateAsync({ action: 'update_staff', input: { id: staff.id, role, active } });
      onClose();
      if (user?.id === staff.id) await refreshRole();
    } catch { /* Mutation error is rendered below. */ }
  }
  return <Dialog title="Manage staff access" onClose={onClose} dirty={role !== staff.role || active !== staff.active} busy={command.isPending}>
    <form onSubmit={submit}><fieldset className="admin-dialog-body" disabled={command.isPending}><h3>{staff.name || staff.email}</h3><p className="admin-muted">{staff.email}</p>
      <Field label="Staff role"><RoleSelect role={role} onChange={setRole} /></Field><RoleDescription role={role} />
      <CheckField label="Staff access is active" checked={active} onChange={setActive} />
      <p className="admin-muted">Suspension removes staff access, not the customer account. The last active owner cannot be demoted or suspended.</p>
      {command.error && <ErrorNotice error={command.error} />}</fieldset><FormFooter busy={command.isPending} label="Save staff access" /></form></Dialog>;
}

export function TeamPage() {
  const filters = useListFilters();
  const result = useResource('team', filters.args);
  const [editor, setEditor] = useState<Staff | 'invite' | null>(null);
  return <><PageHeading title="Team" description="Invitation-only staff access, with explicit operational roles." action={
    <button className="admin-button admin-button-primary" onClick={() => setEditor('invite')}><IconPlus size={17} />Invite team member</button>} />
    <section className="admin-panel"><div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search staff" />
      <label className="admin-inline-field">Staff access<select value={filters.status} onChange={event => filters.setFilter('status', event.target.value)}><option value="">All team members</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Team members" columns={['Team member', 'Role', 'Access', 'Access registered', 'Actions']}>
          {result.data.rows.map(staff => <tr key={staff.id}><td><strong>{staff.name || 'Invited account'}</strong><small>{staff.email}</small></td><td><Badge value={staff.role} /></td><td><Badge value={staff.active ? 'active' : 'suspended'} /></td>
            <td>{staff.invited_at ? dateTime(staff.invited_at) : 'Not invited through this store'}</td><td><button className="admin-button admin-button-small" onClick={() => setEditor(staff)} aria-label={`Manage ${staff.email || staff.name}`}>Manage</button></td></tr>)}
        </Table> : <EmptyState title={filters.query ? 'No matching team members' : 'No team members found'}>Only invited staff accounts can access administration.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} total={result.data.total} pageSize={result.data.page_size} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState></section>
    <p className="admin-muted">Registration timestamps record when staff access was added through this store. They do not prove email delivery or invitation acceptance. Existing accounts are not sent another email.</p>
    {editor === 'invite' ? <InviteDialog onClose={() => setEditor(null)} /> : editor && <StaffEditor staff={editor} onClose={() => setEditor(null)} />}
  </>;
}

function SettingsForm({ settings }: { settings: ResourceData['settings'] }) {
  const [baseline, setBaseline] = useState(settings);
  const [form, setForm] = useState(settings);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const command = useCommand();
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useDirtyGuard(dirty, command.isPending);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending) return;
    setError(null); setSaved(false);
    try {
      if (!form.store_name.trim()) throw new Error('Enter the store name.');
      const telegram = form.telegram_url.trim() ? safeTelegramUrl(form.telegram_url.trim()) : '';
      if (telegram === null) throw new Error('Enter a contact link in the form https://t.me/username. Invite and message links are not supported.');
      const input = { store_name: form.store_name.trim(), telegram_url: telegram, manual_payment_instructions: form.manual_payment_instructions.trim() };
      if (!window.confirm('Save store settings? These instructions affect customers placing orders.')) return;
      await command.mutateAsync({ action: 'save_settings', input });
      setForm(input); setBaseline(input); setSaved(true);
    } catch (cause) { setError(cause); }
  }
  const update = (key: keyof typeof form, value: string) => { setForm({ ...form, [key]: value }); setSaved(false); };
  return <form className="admin-panel admin-settings-form" onSubmit={submit}><fieldset className="admin-panel-body" disabled={command.isPending}>
    <h2>Store identity</h2><Field label="Store name"><input required maxLength={120} value={form.store_name} onChange={event => update('store_name', event.target.value)} /></Field>
    <h2>Manual payment</h2><Field label="Telegram contact URL" hint="Use https://t.me/username. Query parameters and fragments are removed; this is not a bot integration."><input type="url" maxLength={300} placeholder="https://t.me/your_store" value={form.telegram_url} onChange={event => update('telegram_url', event.target.value)} /></Field>
    <Field label="Payment instructions" hint="Shown to signed-in customers during checkout. Do not include secrets or staff credentials."><textarea rows={7} maxLength={8000} value={form.manual_payment_instructions} onChange={event => update('manual_payment_instructions', event.target.value)} /></Field>
    {Boolean(error) && <ErrorNotice error={error} />}{saved && <p className="admin-success" role="status">Store settings saved.</p>}
    <p className="admin-muted">{dirty ? 'You have unsaved changes.' : 'All changes are saved.'}</p>
  </fieldset><div className="admin-form-footer"><button type="button" className="admin-button" disabled={!dirty || command.isPending} onClick={() => { if (window.confirm('Discard your unsaved changes?')) { setForm(baseline); setError(null); } }}>Discard changes</button><button type="submit" className="admin-button admin-button-primary" disabled={!dirty || command.isPending}>{command.isPending ? 'Saving…' : 'Save settings'}</button></div></form>;
}

export function SettingsPage() {
  const result = useResource('settings');
  return <><PageHeading title="Store settings" description="Customer-facing store details and manual payment instructions." />
    <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>{result.data && <SettingsForm settings={result.data} />}</AsyncState></>;
}

export function ActivityPage() {
  const filters = useListFilters();
  const result = useResource('activity', filters.args);
  return <><PageHeading title="Activity log" description="An immutable record of sensitive actions. Entries cannot be edited or removed here." />
    <section className="admin-panel"><div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search actions or summaries" /></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <Table label="Activity log" columns={['Date', 'Action', 'Summary', 'Actor', 'Entity']}>
          {result.data.rows.map(activity => <tr key={activity.id}><td>{dateTime(activity.created_at)}</td><td>{titleCase(activity.action)}</td><td className="admin-wrap">{activity.summary || 'No additional details'}</td>
            <td title={activity.actor_id ?? undefined}>{activity.actor_id ? shortId(activity.actor_id) : 'System'}</td><td title={activity.entity_id ?? undefined}>{activity.entity_id ? shortId(activity.entity_id) : '—'}</td></tr>)}
        </Table> : <EmptyState title={filters.query ? 'No matching activity' : 'No recorded activity'}>Sensitive store operations will appear here after they are performed.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} total={result.data.total} pageSize={result.data.page_size} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState></section></>;
}
