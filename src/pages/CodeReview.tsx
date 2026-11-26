import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, CircleCheck, CircleMinus, CircleX, Clock3, ExternalLink, FileCode2, FolderGit2, GitBranch, GitPullRequest, ListFilter, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import Select from '@/components/Select';
import Dialog from '@/components/Dialog';
import MarkdownOutput from '@/components/MarkdownOutput';
import CodeReviewQueue, { ReviewLoadState, useReviewQueue } from '@/components/CodeReviewQueue';
import CodeReviewDiff, { diffLineId, ReviewFileList } from '@/components/CodeReviewDiff';
import CodeReviewAsk from '@/components/CodeReviewAsk';
import {
  SCM_LABELS, integrationsUrl, parsePullKey, pullEndpoint, pullKey, pullQuery, reviewJson, showDate,
  type Check, type FileChange, type LineRange, type Page, type ProfileData, type Pull, type PullData,
  type PullRef, type ReviewActivity, type ReviewComment, type ReviewContext, type Reviewer, type ScmProvider,
} from '@/lib/code-review/model';
import { useReviewPages, useReviewResource } from '@/lib/code-review/resources';
import '@/styles/code-review.css';

type ReviewTab = 'summary' | 'changes';
const TABS = { summary: 'Ringkasan', changes: 'Perubahan' } as const;
const PULL_STATUS = { open: 'Terbuka', closed: 'Ditutup', merged: 'Digabung', draft: 'Draf' };
const CHECK_STATUS = {
  success: { label: 'Sukses', Icon: CircleCheck, tone: 'review-positive' },
  failure: { label: 'Gagal', Icon: CircleX, tone: 'review-negative' },
  pending: { label: 'Menunggu', Icon: Clock3, tone: 'review-pending' },
  neutral: { label: 'Netral', Icon: CircleMinus, tone: 'review-muted' },
  unavailable: { label: 'Tidak tersedia', Icon: CircleMinus, tone: 'review-muted' },
};
const REVIEW_STATE: Record<string, string> = {
  APPROVED: 'Disetujui', CHANGES_REQUESTED: 'Perubahan diminta', COMMENTED: 'Komentar',
  DISMISSED: 'Dibatalkan', PENDING: 'Menunggu',
};

export default function CodeReview() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source');
  const fixture = source === 'fixture';
  const provider: ScmProvider = source === 'bitbucket' ? 'bitbucket' : 'ghes';
  const reference = parsePullKey(params.get('pr'));
  const tab: ReviewTab = params.get('tab') === 'changes' ? 'changes' : 'summary';
  const profile = useReviewResource<ProfileData>('/api/scm/profile?provider=' + provider);
  const enabled = !!profile.data?.profile && !profile.data.configurationError;
  const queue = useReviewQueue(fixture, provider, profile.data);
  const [queueOpen, setQueueOpen] = useState(false);
  const queueButton = useRef<HTMLButtonElement>(null);

  function changePull(next: PullRef) {
    setParams(current => {
      const updated = new URLSearchParams(current);
      updated.set('pr', pullKey(next));
      updated.set('tab', 'summary');
      return updated;
    });
    closeQueue();
  }

  function closeQueue() {
    setQueueOpen(false);
    requestAnimationFrame(() => queueButton.current?.focus());
  }

  function openDemo() {
    setParams({ source: 'fixture', pr: 'demo/release-notes/17', tab: 'summary' });
  }

  const renderQueue = () => <CodeReviewQueue key={fixture ? 'fixture' : provider} data={queue} fixture={fixture} provider={provider}
    enabled={enabled} selected={reference ? pullKey(reference) : undefined} select={changePull} />;

  return <div className="review-workspace">
    <div className="review-toolbar">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="review-pill"><ShieldCheck size={14} aria-hidden="true" /> Akses baca</span>
        {fixture ? <span className="review-pill review-demo">Fixture sintetis</span> :
          <span className="review-muted truncate text-sm">{profile.data?.profile?.label || (profile.loading ? 'Memuat profil…' : SCM_LABELS[provider])}</span>}
        {!fixture && profile.data?.profile?.version && <span className="review-pill">v{profile.data.profile.version}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button ref={queueButton} type="button" className="ui-button review-open-queue" aria-haspopup="dialog" onClick={() => setQueueOpen(true)}>
          <ListFilter size={15} aria-hidden="true" /> Antrean PR
        </button>
        <Select aria-label="Penyedia Code Review" className="ui-button" value={fixture ? 'fixture' : provider}
          onChange={event => event.target.value === 'fixture' ? openDemo() : setParams({ source: event.target.value })}>
          <option value="ghes">GitHub Enterprise</option>
          <option value="bitbucket">Bitbucket Data Center</option>
          <option value="fixture">Fixture sintetis</option>
        </Select>
        {!fixture && <button type="button" className="ui-button" onClick={() => openDemo()}>Coba demo</button>}
        <Link className="ui-button" to={integrationsUrl(provider)}>Settings</Link>
      </div>
    </div>
    {!fixture && (profile.error || profile.data?.configurationError) && <div role="alert" className="review-note mb-3">
      {profile.error || profile.data?.configurationError}{' '}
      {profile.error && <button className="ui-button" type="button" onClick={profile.refresh}>Coba lagi</button>}
    </div>}
    <div className="review-layout">
      <aside className="review-card review-queue" aria-label="Antrean PR">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 font-semibold"><ListFilter size={17} aria-hidden="true" /> Antrean PR</h2>
          <button type="button" className="icon-action" aria-label="Muat ulang antrean" disabled={queue.loading || (!fixture && !enabled)} onClick={queue.reload}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
        {renderQueue()}
      </aside>
      {queueOpen && <Dialog title="Antrean PR" onClose={closeQueue}>{renderQueue()}</Dialog>}
      {reference && (fixture || enabled) ? <PullReview key={(fixture ? 'fixture' : provider + ':' + profile.data?.profile?.id) + ':' + pullKey(reference)}
        reference={reference} fixture={fixture} provider={provider} desktopOpen={profile.data?.desktopOpen ?? false} tab={tab}
        setTab={next => setParams(current => {
          const updated = new URLSearchParams(current);
          updated.set('tab', next);
          return updated;
        })} />
      : <section className="review-card review-empty">
        <GitPullRequest size={26} aria-hidden="true" />
        <h2 className="text-lg font-semibold">{params.has('pr') && !reference ? 'Deep link PR tidak valid' :
          profile.loading && !fixture ? 'Memuat profil…' : fixture || enabled ? 'Pilih pull request' : 'Siapkan ' + SCM_LABELS[provider]}</h2>
        <p className="max-w-md text-sm review-muted">{fixture || enabled
          ? 'Pilih PR di antrean untuk melihat perubahan dan hasil review.'
          : 'Tambahkan profil koneksi baca di Settings, atau buka demo dengan data sintetis.'}</p>
        {!profile.loading && !fixture && !enabled && <Link className="ui-button" to={integrationsUrl(provider)}>Konfigurasi koneksi</Link>}
      </section>}
    </div>
  </div>;
}

function PullReview({ reference, fixture, provider, desktopOpen, tab, setTab }: {
  reference: PullRef; fixture: boolean; provider: ScmProvider; desktopOpen: boolean; tab: ReviewTab; setTab: (tab: ReviewTab) => void;
}) {
  const endpoint = pullEndpoint(reference);
  const detail = useReviewResource<PullData>(endpoint + pullQuery(fixture, undefined, provider));
  const [refresh, setRefresh] = useState(0);
  const [changesVisited, setChangesVisited] = useState(tab === 'changes');
  const [selection, setSelection] = useState<{ path: string; revision: string; range: LineRange | null }>();
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [jump, setJump] = useState<number>(0);
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const askButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pull = detail.error ? undefined : detail.data?.pull;
  const visited = changesVisited || tab === 'changes';
  const revision = pull ? pull.headSha + ':' + pull.baseSha : '';
  const revisionQuery = pull ? pullQuery(fixture, pull, provider) : '';
  const tail = revisionQuery + '&refresh=' + refresh;
  const files = useReviewPages<Page<FileChange>>(pull && visited ? endpoint + '/files' + revisionQuery : null);
  const comments = useReviewPages<Page<ReviewComment> & { activities?: ReviewActivity[] }>(pull && (visited || provider === 'bitbucket') ? endpoint + '/comments' + tail : null);
  const reviews = useReviewPages<Page<Reviewer>>(pull ? endpoint + '/reviews' + tail : null);
  const runs = useReviewPages<Page<Check>>(pull && provider === 'ghes' ? endpoint + '/runs' + tail : null);
  const statuses = useReviewPages<Page<Check>>(pull ? endpoint + '/statuses' + tail : null);
  const allFiles = [...new Map(files.pages.flatMap(page => page.items).map(file => [file.path, file])).values()];
  const selected = allFiles.find(item => item.path === selection?.path) ?? allFiles[0];
  const diff = useReviewResource<{ file: FileChange; stale: boolean }>(provider === 'bitbucket' && selected && visited
    ? endpoint + '/diff' + tail + '&' + new URLSearchParams({ file: selected.path, page: String(selected.page) }) : null);
  const file = provider === 'bitbucket' ? diff.data?.file : selected;
  const range = selection?.path === file?.path && selection?.revision === revision ? selection.range : null;
  const staleContext = !!context && !!pull && (context.headSha !== pull.headSha || context.baseSha !== pull.baseSha || context.profileId !== pull.profileId);
  const selectedFileStale = files.pages.some(page => page.stale && page.items.some(item => item.path === file?.path));
  const readonly = detail.loading || !!detail.data?.stale || selectedFileStale || !!diff.data?.stale || !!diff.error;

  useEffect(() => {
    if (tab === 'changes') setChangesVisited(true);
  }, [tab]);

  useEffect(() => {
    if (!context || !jump || tab !== 'changes' || context.path !== file?.path) return;
    const id = requestAnimationFrame(() => {
      const line = document.getElementById(diffLineId(context.side, context.start));
      line?.focus();
      line?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [context, file?.path, jump, tab]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'summary' : event.key === 'End' ? 'changes' : tab === 'summary' ? 'changes' : 'summary';
    setTab(next);
    tabs.current?.querySelector<HTMLButtonElement>('[data-tab="' + next + '"]')?.focus();
  }

  function openAsk() {
    if (!pull || !file || !range || readonly) return;
    setContext({ ...range, reference, fixture, provider, path: file.path, page: file.page,
      headSha: pull.headSha, baseSha: pull.baseSha, profileId: pull.profileId, comparisonBase: file.comparisonBase });
  }

  function jumpToSource() {
    if (!context || staleContext) return;
    setSelection({ path: context.path, revision, range: context });
    setTab('changes');
    setJump(value => value + 1);
  }

  function refreshReview() {
    setOpenError('');
    detail.refresh();
    setRefresh(value => value + 1);
  }

  async function openRemote() {
    if (!pull?.remoteUrl) return;
    setOpenError('');
    setOpening(true);
    try {
      await reviewJson(endpoint + '/open', undefined, { profileId: pull.profileId, remoteUrl: pull.remoteUrl, provider });
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : SCM_LABELS[provider] + ' gagal dibuka.');
    } finally {
      setOpening(false);
    }
  }

  if (!pull) return <section className="review-card review-empty">
    {detail.loading && <p role="status">Memuat pull request…</p>}
    {detail.error && <>
      <p role="alert">{detail.error}</p>
      <button type="button" className="ui-button" onClick={refreshReview}>Coba lagi</button>
    </>}
  </section>;

  return <div className="min-w-0 space-y-4">
    <section className="review-card review-hero">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <FolderGit2 size={16} className="shrink-0" aria-hidden="true" />
            <span className="break-all">{reference.owner}/{reference.repo} #{reference.number}</span>
          </span>
          <span className={'review-pill ' + (pull.status === 'open' ? 'review-positive' : '')}>
            <GitPullRequest size={14} aria-hidden="true" /> {PULL_STATUS[pull.status]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="icon-action" aria-label="Muat ulang PR" disabled={detail.loading} onClick={refreshReview}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          {pull.remoteUrl && (desktopOpen
            ? <button type="button" className="ui-button" disabled={opening} onClick={() => void openRemote()}>Buka di {provider === 'ghes' ? 'GitHub' : 'Bitbucket'} <ExternalLink size={14} aria-hidden="true" /></button>
            : <a className="ui-button" href={pull.remoteUrl} target="_blank" rel="noopener noreferrer">Buka di {provider === 'ghes' ? 'GitHub' : 'Bitbucket'} <ExternalLink size={14} aria-hidden="true" /></a>)}
        </div>
      </div>
      <h2 className="review-title">{pull.title || 'Pull request #' + pull.number}</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm review-muted">
        <span>{pull.author || 'Author tidak tersedia'}</span>
        <span aria-hidden="true">·</span>
        <span>{showDate(pull.updatedAt)}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs">
          <GitBranch size={14} aria-hidden="true" />
          <span className="review-pill break-all" title={pull.headSha}>{pull.headBranch}</span>
          <ArrowRight size={13} aria-hidden="true" /><span className="sr-only">ke</span>
          <span className="review-pill break-all" title={pull.baseSha}>{pull.baseBranch}</span>
        </div>
      </div>
      {openError && <p className="review-note" role="alert">{openError}</p>}
      {detail.data?.stale && <p className="review-note" role="status">Offline · revisi terakhir diambil {showDate(pull.fetchedAt)}.</p>}
      <div ref={tabs} className="panel-tabs" role="tablist" aria-label="Bagian pull request">
        {(Object.keys(TABS) as ReviewTab[]).map(value => <button key={value} id={panelId + '-' + value}
          type="button" role="tab" className="panel-tab text-sm" data-tab={value} tabIndex={tab === value ? 0 : -1}
          aria-selected={tab === value} aria-controls={panelId + '-' + value + '-panel'}
          onKeyDown={handleTabKey} onClick={() => setTab(value)}>
          {TABS[value]} {value === 'changes' && pull.changedFiles !== null && <span className="ml-2 review-muted text-xs">{pull.changedFiles}</span>}
        </button>)}
      </div>
    </section>
    <div className="review-content">
      <div className="review-rail space-y-3">
        {context && <CodeReviewAsk context={context} stale={staleContext} disabled={readonly}
          onClose={() => {
            setContext(null);
            requestAnimationFrame(() => (tab === 'changes' && askButton.current
              ? askButton.current : tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]'))?.focus());
          }}
          onJump={jumpToSource} />}
        <ReviewMetadata provider={provider} pull={pull} reviews={reviews} runs={runs} statuses={statuses} />
      </div>
      <div className="review-main min-w-0">
        <div hidden={tab !== 'summary'} role="tabpanel" id={panelId + '-summary-panel'} aria-labelledby={panelId + '-summary'} className="space-y-4">
          <section className="review-card p-4 md:p-5">
            <h3 className="mb-3 font-semibold">Deskripsi PR</h3>
            {pull.description ? <MarkdownOutput content={pull.description} downloadable={false} /> :
              <p className="review-muted text-sm">Deskripsi kosong.</p>}
            {pull.descriptionTruncated && <p className="review-note mt-3">Deskripsi dipotong pada batas tampilan.</p>}
          </section>
          <section className="review-card p-4 md:p-5">
            <h3 className="mb-3 font-semibold">Aktivitas</h3>
            <ul className="review-timeline">
              {pull.createdAt && <li>PR dibuka · {showDate(pull.createdAt)}</li>}
              {pull.updatedAt && pull.updatedAt !== pull.createdAt && <li>Diperbarui · {showDate(pull.updatedAt)}</li>}
              {pull.mergedAt ? <li>Digabung · {showDate(pull.mergedAt)}</li> :
                pull.closedAt && <li>Ditutup · {showDate(pull.closedAt)}</li>}
              {comments.pages.flatMap(page => page.activities ?? []).map(item => <li key={item.id}>{item.label} · {item.login || 'Bitbucket'} · {showDate(item.createdAt)}</li>)}
            </ul>
            {provider === 'bitbucket' && <div className="mt-3 space-y-2"><ReviewLoadState {...comments} /></div>}
            {reviews.pages.flatMap(page => page.items).filter(item => item.body).map(item => <div key={item.id} className="review-well mt-3 p-3">
              <p className="mb-1 flex flex-wrap gap-x-2 text-sm"><strong>{item.login}</strong><span className="review-muted">{REVIEW_STATE[item.state] || item.state}</span></p>
              <MarkdownOutput content={item.body} downloadable={false} />
            </div>)}
          </section>
          {!fixture && !detail.data?.stale && <WorkspaceCheckout key={revision} provider={provider} pull={pull} endpoint={endpoint} />}
        </div>
        <div hidden={tab !== 'changes'} role="tabpanel" id={panelId + '-changes-panel'} aria-labelledby={panelId + '-changes'} className="space-y-4">
          {visited && <>
            <section className="review-card p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><FileCode2 size={17} aria-hidden="true" /> File berubah</h3>
              {!allFiles.length && !files.loading && !files.error && <p className="text-sm review-muted">Tidak ada file yang tersedia.</p>}
              <ReviewFileList files={allFiles} selected={selected?.path} onSelect={item => setSelection({ path: item.path, revision, range: null })} />
              <div className="mt-2 space-y-2"><ReviewLoadState {...files} /></div>
            </section>
            {diff.loading && <p className="review-note" role="status">Memuat diff Bitbucket…</p>}
            {diff.error && <div className="review-note" role="alert">{diff.error} <button type="button" className="ui-button" onClick={diff.refresh}>Coba lagi</button></div>}
            {diff.data?.stale && <p className="review-note" role="status">Diff tersimpan sedang ditampilkan karena Bitbucket tidak dapat dijangkau.</p>}
            {file && <CodeReviewDiff key={revision + ':' + file.path} file={file} head={pull.headSha} range={range}
              jump={jump && context?.path === file.path && !staleContext ? context : null}
              comments={[...new Map(comments.pages.flatMap(page => page.items).map(comment => [comment.id, comment])).values()]}
              canAsk={!readonly} askButton={askButton}
              onRange={value => setSelection({ path: file.path, revision, range: value })} onAsk={openAsk} />}
            <section className="review-card space-y-2 p-4" aria-label="Status komentar review">
              <h3 className="font-semibold">Komentar review</h3>
              {!comments.loading && !comments.error && <p className="review-muted text-sm">
                {comments.pages.reduce((count, page) => count + page.items.length, 0)} komentar dimuat. Jangkar ditampilkan pada file dan revisi yang cocok.
              </p>}
              {provider === 'bitbucket' && comments.pages.flatMap(page => page.items).filter(item => !item.path).map(item => <div key={item.id} className="review-well p-3">
                <p className="mb-1 text-sm font-semibold">{item.login} · {showDate(item.createdAt)}</p>
                <MarkdownOutput content={item.body} downloadable={false} />
              </div>)}
              <ReviewLoadState {...comments} />
            </section>
          </>}
        </div>
      </div>
    </div>
  </div>;
}

function ReviewMetadata({ provider, pull, reviews, runs, statuses }: {
  provider: ScmProvider;
  pull: Pull; reviews: ReturnType<typeof useReviewPages<Page<Reviewer>>>;
  runs: ReturnType<typeof useReviewPages<Page<Check>>>; statuses: ReturnType<typeof useReviewPages<Page<Check>>>;
}) {
  const visibleReviews = reviews.pages.flatMap(page => page.items);
  return <details className="review-card review-metadata" open={window.matchMedia('(min-width: 1360px)').matches}>
    <summary className="review-metadata-toggle">
      <span className="font-semibold">Checks dan reviewer</span>
      <ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="space-y-4 border-t border-[var(--ui-border)] p-3">
      <p className="review-muted break-all font-mono text-xs" title={pull.headSha}>Head {pull.headSha.slice(0, 12)}</p>
      {provider === 'ghes' && <Checks title="Check runs" data={runs} />}
      <Checks title={provider === 'bitbucket' ? 'Build statuses' : 'Commit statuses'} data={statuses} />
      <section className="space-y-2 border-t border-[var(--ui-border)] pt-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={15} aria-hidden="true" /> Reviewer</h3>
        {[...pull.requestedReviewers, ...pull.requestedTeams].map((name, index) =>
          <p key={index} className="break-all text-sm">{name} <span className="review-muted">· Diminta</span></p>)}
        {visibleReviews.map(item => <p key={item.id} className="break-all text-sm">
          {item.login} <span className="review-muted">· {REVIEW_STATE[item.state] || item.state}
            {item.revision && item.revision !== pull.headSha && ' · revisi lama ' + item.revision.slice(0, 8)}</span>
        </p>)}
        {!pull.requestedReviewers.length && !pull.requestedTeams.length && !visibleReviews.length && !reviews.loading && !reviews.error &&
          <p className="review-muted text-sm">Belum ada reviewer.</p>}
        <ReviewLoadState {...reviews} />
      </section>
    </div>
  </details>;
}

function Checks({ title, data }: { title: string; data: ReturnType<typeof useReviewPages<Page<Check>>> }) {
  const checks = new Map<string | number, Check>();
  for (const page of data.pages) {
    for (const item of page.items) {
      const key = item.source === 'status' ? item.key ?? item.name : item.id;
      if (!checks.has(key)) checks.set(key, item);
    }
  }
  return <section className="space-y-2" aria-label={title}>
    <h3 className="text-sm font-semibold">{title}</h3>
    {!checks.size && !data.loading && !data.error && <p className="review-muted text-sm">Tidak ada hasil.</p>}
    <ul className="space-y-1.5">
      {[...checks.entries()].map(([key, item]) => {
        const { label, Icon, tone } = CHECK_STATUS[item.status];
        return <li key={key} className="flex items-start gap-2 text-sm">
          <Icon size={15} className={'mt-0.5 shrink-0 ' + tone} aria-hidden="true" />
          <div className="min-w-0 break-words">
            <span className="font-medium">{item.name}</span>
            <p className="review-muted text-xs">{label}{item.detail && ' · ' + item.detail}</p>
          </div>
        </li>;
      })}
    </ul>
    <ReviewLoadState {...data} />
  </section>;
}

function WorkspaceCheckout({ provider, pull, endpoint }: { provider: ScmProvider; pull: Pull; endpoint: string }) {
  const [path, setPath] = useState('');
  const [verified, setVerified] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!path.trim() || busy) return;
    setBusy(true);
    setVerified('');
    setError('');
    try {
      const result = await reviewJson<{ repoPath: string }>(endpoint + '/workspace', undefined,
        { path: path.trim(), headSha: pull.headSha, baseSha: pull.baseSha, provider, profileId: pull.profileId });
      setVerified(result.repoPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Checkout tidak dapat diverifikasi.');
    } finally {
      setBusy(false);
    }
  }
  return <details className="review-card p-4">
    <summary className="cursor-pointer font-semibold">Perbaikan lokal di Workspace</summary>
    <form className="mt-3 space-y-2" onSubmit={verify}>
      <label className="block text-sm">Root checkout Git
        <input className="ui-field mt-1 w-full" value={path} disabled={busy}
          onChange={event => { setPath(event.target.value); setVerified(''); }} />
      </label>
      <button className="ui-button" disabled={!path.trim() || busy} type="submit">{busy ? 'Memverifikasi…' : 'Verifikasi repo dan revisi'}</button>
      {error && <p role="alert" className="review-note">{error}</p>}
      {verified && <Link className="ui-button" to={'/workspace?' + new URLSearchParams({ tab: 'changes', repo: verified, rev: pull.headSha })}>
        Buka Workspace
      </Link>}
    </form>
  </details>;
}
