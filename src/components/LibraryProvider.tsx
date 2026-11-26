import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { libraryRequest, type LibrarySnapshot } from '@/lib/library';

type State = { data?: LibrarySnapshot; loading: boolean; error: string; update: (id: string, enabled: boolean) => Promise<void>; refresh: () => void };
const Context = createContext<State | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [data, setData] = useState<LibrarySnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const request = useRef(0);
  const updates = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const abort = new AbortController();
    const current = ++request.current;
    setLoading(true);
    setError('');
    void libraryRequest<LibrarySnapshot>('/api/library/apps', 'GET', undefined, abort.signal).then(value => {
      if (request.current === current && !abort.signal.aborted) setData(value);
    }, reason => {
      if (request.current === current && !abort.signal.aborted) setError(reason.message);
    }).finally(() => {
      if (request.current === current && !abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [pathname, version]);

  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    window.addEventListener("library-apps-changed", refresh);
    return () => window.removeEventListener("library-apps-changed", refresh);
  }, [refresh]);

  async function update(id: string, enabled: boolean) {
    const running = updates.current.then(async () => {
      const data = await libraryRequest<LibrarySnapshot>('/api/library/apps/' + encodeURIComponent(id), 'PATCH', { enabled });
      request.current++;
      setLoading(false);
      setError('');
      setData(data);
    });
    updates.current = running.catch(() => {});
    return running;
  }

  return <Context.Provider value={{ data, error, loading, update, refresh }}>{children}</Context.Provider>;
}

export function useLibraryApps() {
  const context = useContext(Context);
  if (!context) throw new Error('LibraryProvider is required.');
  return context;
}
