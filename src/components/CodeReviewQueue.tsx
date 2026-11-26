import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GitPullRequest, Search } from 'lucide-react';
import { GROUP_LABELS, SCM_LABELS, integrationsUrl, pullKey, queueItems, reviewJson, type ProfileData, type PullRef, type QueuePage, type ScmProvider } from '@/lib/code-review/model';
import { useReviewPages } from '@/lib/code-review/resources';

export function ReviewLoadState({ loading, error, stale, partial, next, retry, loadNext }: {
  loading: boolean; error?: string; stale?: boolean; partial?: boolean; next?: number | null; retry: () => void; loadNext: () => void;
}) {
  return <>
    {stale && <div className="review-note flex flex-wrap items-center gap-2">
      <p role="status">Offline · menampilkan data terakhir tersimpan.</p>
      {!loading && !error && <button className="ui-button" type="button" onClick={retry}>Muat ulang</button>}
    </div>}
    {partial && <p className="review-note">Hasil dibatasi oleh cakupan permintaan.</p>}
    {error && <div role="alert" className="review-note flex flex-wrap items-center gap-2">
      <span>{error}</span><button type="button" className="ui-button" onClick={retry}>Coba lagi</button>
    </div>}
    {loading && <p role="status" className="review-muted text-sm">Memuat…</p>}
    {next && !loading && !error && <button type="button" className="ui-button" onClick={loadNext}>Muat berikutnya</button>}
  </>;
}

export function useReviewQueue(fixture: boolean, provider: ScmProvider, profile?: ProfileData) {
  const url = fixture ? '/api/scm/queue?fixture=true' : profile?.profile && !profile.configurationError ? '/api/scm/queue?provider=' + provider : null;
  return useReviewPages<QueuePage>(url);
}

export default function CodeReviewQueue({ data, fixture, provider, enabled, selected, select }: {
  data: ReturnType<typeof useReviewQueue>;
  fixture: boolean; provider: ScmProvider; enabled: boolean; selected?: string; select: (reference: PullRef) => void;
}) {
  const [search, setSearch] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const resolveRequest = useRef<AbortController | null>(null);
  useEffect(() => () => resolveRequest.current?.abort(), []);
  const items = queueItems(data.pages);
  const query = search.trim().toLowerCase();
  const isUrl = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(query);
  const filtered = isUrl ? items : items.filter(item =>
    [item.title, item.owner + '/' + item.repo, '#' + item.number, String(item.number)].some(value => value.toLowerCase().includes(query)),
  );
  const groupErrors = [...new Map(data.pages.flatMap(page => page.groupErrors).map(input => [input.group, input])).values()];
  const groupKeys = Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[];
  const teamCount = data.pages[0]?.teamCount ?? 0;

  async function openUrl(event: FormEvent) {
    event.preventDefault();
    if (!isUrl || !enabled || fixture || resolving) return;
    const controller = new AbortController();
    resolveRequest.current = controller;
    setResolving(true);
    setError('');
    try {
      const result = await reviewJson<{ reference: PullRef }>('/api/scm/resolve', controller.signal, { url: search.trim(), provider });
      if (!controller.signal.aborted) {
        setSearch('');
        select(result.reference);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'URL tidak dapat dibuka.');
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }

  return <div className="space-y-4">
    {(enabled || fixture) ? <>
      <form onSubmit={openUrl} className="space-y-2">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-2.5 review-muted" aria-hidden="true" />
          <span className="sr-only">Cari PR atau tempel URL</span>
          <input value={search} type="search" maxLength={2048} className="ui-field w-full !pl-9"
            placeholder={fixture ? 'Cari PR, repo, atau nomor' : 'Cari atau tempel URL PR'}
            onChange={event => { setSearch(event.target.value); setError(''); }} />
        </label>
        {isUrl && !fixture && <button className="ui-button w-full" disabled={resolving} type="submit">
          {resolving ? 'Memeriksa URL…' : 'Buka pull request'}
        </button>}
        {isUrl && fixture && <p className="review-note">Pilih koneksi SCM untuk membuka URL.</p>}
      </form>
      {error && <p role="alert" className="review-note">{error}</p>}
      <p className="review-muted text-xs">
        {items.length} PR dimuat · pencarian mencakup daftar ini
        {teamCount > 0 && ' · ' + teamCount + ' tim'}
        {data.pages.some(page => page.teamScopeLimited) && ' (sebagian)'}
      </p>
      {groupErrors.map(({ group, message }) => <div key={group} role="alert" className="review-note">
        {GROUP_LABELS[group]} · {message} <button type="button" className="ui-button" onClick={data.reload}>Coba lagi</button>
      </div>)}
      {!filtered.length && !data.loading && !data.error && <p className="review-muted text-sm">{query ? 'Tidak ada hasil dalam daftar yang dimuat.' : 'Antrean PR kosong.'}</p>}
      {groupKeys.map(group => {
        const groupItems = filtered.filter(item => item.group === group);
        return groupItems.length > 0 && <div key={group}>
          <h3 className="mb-2 text-xs font-semibold review-muted">{GROUP_LABELS[group]}</h3>
          <ul className="space-y-1.5">
            {groupItems.map(item => <li key={pullKey(item)}>
              <button type="button" className="review-queue-item" aria-current={selected === pullKey(item) ? 'true' : undefined} onClick={() => select(item)}>
                <span className="flex items-center gap-1.5 review-muted text-xs">
                  <GitPullRequest size={14} aria-hidden="true" />
                  <span className="truncate">{item.repo} #{item.number}</span>
                  {item.draft && <span>· Draf</span>}
                </span>
                <span className="block text-sm font-medium leading-snug break-words">{item.title}</span>
                <span className="review-muted text-xs">{item.author}</span>
              </button>
            </li>)}
          </ul>
        </div>;
      })}
      <ReviewLoadState {...data} />
    </> : <>
      <p className="review-muted text-sm">Aktifkan profil {SCM_LABELS[provider]} untuk memuat antrean.</p>
      <Link className="ui-button" to={integrationsUrl(provider)}>Buka Settings</Link>
    </>}
  </div>;
}
