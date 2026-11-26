import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewJson, type Page } from './model';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Permintaan gagal.';

export function useReviewResource<T>(url: string | null) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ url: string; version: number; data?: T; error?: string }>();
  const relevant = result?.url === url ? result : undefined;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void reviewJson<T>(url, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ url, version, data }); },
      error => {
        if (!controller.signal.aborted) setResult(previous => ({
          url, version, data: previous?.url === url ? previous.data : undefined, error: errorText(error),
        }));
      },
    );
    return () => controller.abort();
  }, [url, version]);
  return {
    data: relevant?.data,
    error: relevant?.version === version ? relevant.error : undefined,
    loading: !!url && relevant?.version !== version,
    refresh: () => setVersion(v => v + 1),
  };
}

type PageState<PageData> = {
  url: string; pages: PageData[]; busy: boolean; error?: string; failedPage?: number;
};

export function useReviewPages<PageData extends Page<unknown>>(url: string | null) {
  const [state, setState] = useState<PageState<PageData>>();
  const request = useRef<AbortController | null>(null);
  const load = useCallback((page: number) => {
    if (!url) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const query = url + (url.includes('?') ? '&page=' : '?page=') + page;
    const previousPages = (previous?: PageState<PageData>) => page !== 1 && previous?.url === url ? previous.pages : [];
    setState(previous => ({ url, pages: previousPages(previous), busy: true }));
    void reviewJson<PageData>(query, controller.signal).then(
      data => {
        if (!controller.signal.aborted) setState(previous => ({ url, pages: [...previousPages(previous), data], busy: false }));
      },
      error => {
        if (!controller.signal.aborted) setState(previous => ({
          url, pages: previousPages(previous), busy: false, error: errorText(error), failedPage: page,
        }));
      },
    );
  }, [url]);

  useEffect(() => {
    if (url) load(1);
    return () => request.current?.abort();
  }, [load, url]);

  const current = state?.url === url ? state : undefined;
  const pages = current?.pages ?? [];
  const next = pages.at(-1)?.nextPage;
  return {
    pages, loading: !!url && (!current || current.busy), error: current?.error,
    stale: pages.some(page => page.stale), partial: pages.some(page => page.partial),
    next, reload: () => load(1), retry: () => load(current?.failedPage ?? 1),
    loadNext: () => { if (next) load(next); },
  };
}
