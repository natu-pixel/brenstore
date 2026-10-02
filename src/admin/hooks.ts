import { createContext, useContext, useEffect, useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { readResource } from '../features/api';
import type { Category } from '../features/api';

export function useCategories() {
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

export type DirtyState = { dirty: boolean; saving: boolean };
export const DirtyContext = createContext<{
  update: (key: string, state: DirtyState | null) => void;
  dirty: boolean;
  saving: boolean;
}>({ update: () => {}, dirty: false, saving: false });

export function useDirtyGuard(dirty: boolean, saving = false) {
  const { update } = useContext(DirtyContext);
  const key = useId();
  useEffect(() => { update(key, { dirty, saving }); return () => update(key, null); }, [key, dirty, saving, update]);
}

export function useListFilters() {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const query = params.get('query') ?? '';
  const status = params.get('status') ?? '';
  const categoryId = params.get('category_id') ?? '';
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  return { page, query, status, categoryId, setFilter, args: { page, page_size: 20, query, status, category_id: categoryId } };
}
