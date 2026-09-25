import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { DirtyContext } from './hooks';
import type { DirtyState } from './hooks';

export default function DirtyProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<Record<string, DirtyState>>({});
  const update = useCallback((key: string, state: DirtyState | null) => setForms(previous => {
    const next = { ...previous };
    if (state) next[key] = state; else delete next[key];
    return next;
  }), []);
  const dirty = Object.values(forms).some(form => form.dirty);
  const saving = Object.values(forms).some(form => form.saving);
  const blocker = useBlocker(dirty || saving);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (!saving && window.confirm('Discard your unsaved changes?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, saving]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving]);
  return <DirtyContext.Provider value={{ update, dirty, saving }}>{children}</DirtyContext.Provider>;
}
