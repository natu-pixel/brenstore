import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconAlertCircle, IconInbox, IconRefresh, IconX } from '@tabler/icons-react';
import type { Action, Input } from '../features/api';
import { useCommand } from '../features/api';
import { useDirtyGuard } from './hooks';
import { message, titleCase } from './utils';

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="admin-page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="admin-notice admin-notice-error" role="alert">
    <IconAlertCircle size={19} aria-hidden="true" /><div><strong>We couldn’t complete that request</strong><p>{message(error)}</p>
      {retry && <button className="admin-button admin-button-small" type="button" onClick={retry}><IconRefresh size={15} />Try again</button>}</div>
  </div>;
}

export function AsyncState({ pending, error, retry, children }: { pending: boolean; error: unknown; retry: () => void; children: ReactNode }) {
  if (pending) return <div className="admin-loading" role="status"><span className="admin-spinner" />Loading records…</div>;
  if (error) return <ErrorNotice error={error} retry={retry} />;
  return <>{children}</>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="admin-empty"><IconInbox size={28} stroke={1.5} aria-hidden="true" /><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Badge({ value }: { value: string }) {
  return <span className={`admin-badge admin-badge-${value}`}>{titleCase(value)}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function CheckField({ label, checked, onChange, required = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; required?: boolean }) {
  return <label className="admin-check"><input type="checkbox" checked={checked} required={required} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export function Dialog({ title, children, onClose, dirty = false, busy = false, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; dirty?: boolean; busy?: boolean; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useDirtyGuard(dirty, busy);
  const close = () => { if (!busy && (!dirty || window.confirm('Discard your unsaved changes?'))) onClose(); };
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      else document.getElementById('admin-main')?.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`admin-dialog${wide ? ' admin-dialog-wide' : ''}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="admin-dialog-heading"><h2 id={titleId}>{title}</h2>
      <button type="button" className="admin-icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><IconX size={20} /></button>
    </div>{children}
  </dialog>;
}

export function FormFooter({ busy, label = 'Save changes', onCancel }: { busy: boolean; label?: string; onCancel?: () => void }) {
  return <div className="admin-form-footer">{onCancel && <button type="button" className="admin-button" disabled={busy} onClick={onCancel}>Cancel</button>}
    <button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button></div>;
}

export function SearchBox({ query, onSearch, placeholder = 'Search records' }: { query: string; onSearch: (query: string) => void; placeholder?: string }) {
  return <SearchInput key={query} query={query} onSearch={onSearch} placeholder={placeholder} />;
}

function SearchInput({ query, onSearch, placeholder }: { query: string; onSearch: (query: string) => void; placeholder: string }) {
  const [value, setValue] = useState(query);
  return <form className="admin-search" role="search" onSubmit={event => { event.preventDefault(); onSearch(value.trim()); }}>
    <input aria-label={placeholder} placeholder={placeholder} type="search" maxLength={200} value={value} onChange={event => setValue(event.target.value)} />
    <button type="submit" className="admin-button">Search</button>
    {query && <button type="button" className="admin-button admin-button-quiet" onClick={() => { setValue(''); onSearch(''); }}>Clear</button>}
  </form>;
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="admin-pagination"><span>{total === 0 ? '0 records' : `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total} records`}</span>
    <nav aria-label="Table pagination"><button className="admin-button admin-button-small" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>Previous</button>
      <span>Page {page} of {pages}</span><button className="admin-button admin-button-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></nav></div>;
}

export function Table({ label, columns, children }: { label: string; columns: string[]; children: ReactNode }) {
  return <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}><table className="admin-table">
    <caption className="admin-sr-only">{label}</caption><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody>
  </table></div>;
}

export function NoteForm({ id, kind }: { id: string; kind: 'order' | 'customer' }) {
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const command = useCommand();
  useDirtyGuard(Boolean(note.trim()), command.isPending);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim() || command.isPending) return;
    try {
      await command.mutateAsync({ action: kind === 'order' ? 'add_order_note' : 'add_customer_note', input: { id, note: note.trim() } });
      setNote(''); setSaved(true);
    } catch { /* Mutation error is rendered below. */ }
  }
  return <form onSubmit={submit} className="admin-note-form"><Field label="Add an internal note" hint="Visible to staff only. Never enter passwords or payment-card details.">
    <textarea required maxLength={2000} rows={3} value={note} onChange={event => { setNote(event.target.value); setSaved(false); }} disabled={command.isPending} /></Field>
    {command.error && <ErrorNotice error={command.error} />}{saved && <p role="status" className="admin-success">Note saved.</p>}
    <FormFooter busy={command.isPending} label="Add note" /></form>;
}

export function ReasonDialog({ title, description, action, input, onClose, label = 'Confirm', acknowledge }: {
  title: string; description: string; action: Action; input: Input; onClose: () => void; label?: string; acknowledge?: string;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const command = useCommand();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || (acknowledge && !confirmed) || command.isPending) return;
    try {
      const field = action === 'release_allocation' ? 'reason' : 'note';
      await command.mutateAsync({ action, input: { ...input, [field]: reason.trim() } });
      onClose();
    } catch { /* Mutation error is rendered below. */ }
  };
  return <Dialog title={title} onClose={onClose} dirty={Boolean(reason) || confirmed} busy={command.isPending}><form onSubmit={submit}>
    <div className="admin-dialog-body"><p>{description}</p><Field label="Reason / staff note"><textarea autoFocus required maxLength={action === 'release_allocation' ? 1000 : 2000} rows={3} value={reason} disabled={command.isPending} onChange={event => setReason(event.target.value)} /></Field>
      {acknowledge && <CheckField label={acknowledge} checked={confirmed} required onChange={setConfirmed} />}{command.error && <ErrorNotice error={command.error} />}</div>
    <FormFooter busy={command.isPending} label={label} /></form></Dialog>;
}

export function AccessDenied() {
  return <><PageHeading title="Restricted area" /><EmptyState title="Your role does not have access">Return to an operational page or contact an owner if your responsibilities have changed.</EmptyState><Link className="admin-button" to="/admin">Back to overview</Link></>;
}
