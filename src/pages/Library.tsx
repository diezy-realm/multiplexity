import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Boxes, Check, Plus, Search } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import IntegrationsSettings from '@/components/IntegrationsSettings';
import MarkdownOutput from '@/components/MarkdownOutput';
import { useLibraryApps } from '@/components/LibraryProvider';
import { LIBRARY_APPS, appUrl, launchUrl, libraryRequest, type AppConnection, type AppState, type LibraryApp, type LibrarySkill, type LibrarySkillDetail } from '@/lib/library';
import '@/styles/library.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Permintaan gagal.';
const card = 'library-card';

function Toggle({ enabled, busy, label, change }: { enabled: boolean; busy?: boolean; label: string; change: () => void }) {
  return <button type="button" className="library-switch" role="switch" aria-label={label} aria-checked={enabled}
    disabled={busy} onClick={change}><span aria-hidden="true" /></button>;
}

function Status({ children }: { children: string }) {
  return <span className="library-status">{children}</span>;
}

function AppControl({ app, state, settings, onError }: {
  app: LibraryApp; state: AppState; settings: boolean; onError: (error: string) => void;
}) {
  const { update } = useLibraryApps();
  const [busy, setBusy] = useState(false);
  if (!state.ready) return <Link className="icon-action" to={appUrl(app, settings) + '&connect=1'}
    aria-label={'Hubungkan ' + app.name} title={'Hubungkan ' + app.name}><Plus size={19} aria-hidden="true" /></Link>;
  return <Toggle label={'Enable ' + app.name} enabled={state.enabled} busy={busy} change={() => {
    setBusy(true);
    onError('');
    void update(app.id, !state.enabled).catch(error => onError(errorText(error))).finally(() => setBusy(false));
  }} />;
}

export function LibraryApps({ settings = false }: { settings?: boolean }) {
  const [params] = useSearchParams();
  const { data, error, loading, refresh } = useLibraryApps();
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState('');
  const app = LIBRARY_APPS.find(item => item.id === params.get('app'));
  const state = app && data?.apps[app.id];
  const items = LIBRARY_APPS.filter(item => [item.name, item.category, item.description].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const back = settings ? '/settings?section=apps' : '/library';

  return <section className="library-surface space-y-4" aria-label="Apps">
    {(error || actionError) && <div className="library-notice" role="alert">
      {error || actionError} {error && <button type="button" className="ui-button" onClick={refresh}>Muat ulang</button>}
    </div>}
    {loading && !data && <p role="status" className="library-muted">Memuat status koneksi…</p>}
    {params.has('app') && !app && <p role="alert">Aplikasi tidak ditemukan. <Link className="ui-button" to={back}>Kembali ke Apps</Link></p>}
    {app && state ? <AppDetail key={app.id} app={app} state={state} settings={settings} back={back}
      onError={setActionError} configure={params.get('connect') === '1'} /> : !params.has('app') && <>
      <div className="library-heading">
        <div><h2>Apps</h2><p>Hubungkan aplikasi dan pilih yang tampil di sidebar.</p></div>
        <SearchField value={search} change={setSearch} label="Cari aplikasi" />
      </div>
      {items.length === 0 && <p role="status">Aplikasi tidak ditemukan.</p>}
      {(['Sistem & Data', 'Developer Tools'] as const).map(category => {
        const group = items.filter(item => item.category === category);
        return group.length > 0 && <section key={category} className="space-y-3">
          <h3 className="library-group">{category}</h3>
          <div className="library-grid">{group.map(item => {
            const state = data?.apps[item.id];
            return <article className={card} key={item.id}>
              <Link className="library-card-main" to={appUrl(item, settings)}>
                <span className="library-icon"><item.Icon size={21} aria-hidden="true" /></span>
                <span className="min-w-0">
                  <strong>{item.name}</strong>
                  <span className="library-muted block text-sm">{item.description}</span>
                </span>
              </Link>
              <div className="library-card-footer">
                <Status>{state ? state.enabled ? 'Di sidebar' : state.ready ? 'Koneksi tersimpan' : 'Perlu koneksi' : 'Status belum dimuat'}</Status>
                {state && <AppControl app={item} state={state} settings={settings} onError={setActionError} />}
              </div>
            </article>;
          })}</div>
        </section>;
      })}
    </>}
  </section>;
}

function SearchField({ value, change, label }: { value: string; change: (value: string) => void; label: string }) {
  return <label className="library-search">
    <Search size={17} aria-hidden="true" />
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={event => change(event.target.value)} />
  </label>;
}

function AppDetail({ app, state, settings, back, onError, configure }: {
  app: LibraryApp; state: AppState; settings: boolean; back: string; onError: (error: string) => void; configure: boolean;
}) {
  return <>
    <Link className="ui-button" to={back}><ArrowLeft size={14} aria-hidden="true" /> Semua Apps</Link>
    <div className="library-detail-header">
      <span className="library-icon"><app.Icon size={26} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">{app.name}</h2><p className="library-muted text-sm">{app.description}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {app.id === 'code-review' && !state.ready && <Link className="ui-button" to="/code-review?source=fixture&pr=demo%2Frelease-notes%2F17">Coba demo</Link>}
        {state.ready && 'href' in app && <Link className="ui-button" to={launchUrl(app, state)}>Buka {app.name}</Link>}
        <Link className="ui-button" to={appUrl(app, !settings)}>{settings ? 'Lihat di Library' : 'Buka di Settings'}</Link>
        {state.ready && <AppControl app={app} state={state} settings={settings} onError={onError} />}
      </div>
    </div>
    <section className="space-y-3" aria-label="Koneksi tersimpan">
      <h3 className="library-group">Koneksi</h3>
      {state.connections.length ? <div className="library-grid">
        {state.connections.map(connection => <ConnectionCard key={connection.id} connection={connection} />)}
      </div> : <p className="library-muted text-sm">Belum ada koneksi tersimpan.</p>}
    </section>
    {'connect' in app && <Link className="ui-button" to={app.connect}>
      <Plus size={15} aria-hidden="true" /> {state.ready ? 'Kelola koneksi' : 'Hubungkan ' + app.name}
    </Link>}
    {'connectors' in app && <details className="library-card p-4" open={configure || settings || !state.ready}>
      <summary className="cursor-pointer text-sm font-semibold">{state.connections.length ? 'Kelola koneksi' : 'Hubungkan ' + app.name}</summary>
      <div className="mt-4"><IntegrationsSettings kinds={app.connectors} onlyMcp={app.id === 'mcp'} /></div>
    </details>}
  </>;
}

function ConnectionCard({ connection }: { connection: AppConnection }) {
  return <article className="library-card space-y-2 p-4">
    <h4 className="font-medium break-words">{connection.label || connection.kind || 'Koneksi tersimpan'}</h4>
    <dl className="library-data">
      {connection.kind && <><dt>Provider</dt><dd>{connection.kind === 'ghes' ? 'GitHub Enterprise' : connection.kind === 'bitbucket' ? 'Bitbucket Data Center' : connection.kind}</dd></>}
      {connection.account && <><dt>Akun</dt><dd>{connection.account}</dd></>}
      {connection.endpoint && <><dt>Alamat</dt><dd className="font-mono">{connection.endpoint}{connection.port ? ':' + connection.port : ''}</dd></>}
      {connection.auth && <><dt>Autentikasi</dt><dd>{connection.auth}</dd></>}
      <dt>Status</dt><dd>{connection.enabled === 0 ? 'Koneksi nonaktif' : connection.status === 'ok' ? 'Uji berhasil' : connection.status === 'denied' ? 'Izin ditolak' : connection.status === 'error' ? 'Uji gagal' : 'Konfigurasi tersimpan'}</dd>
      {connection.version && <><dt>Versi</dt><dd>{connection.version}</dd></>}
      {connection.checked_at && <><dt>Uji terakhir</dt><dd>{connection.checked_at} UTC</dd></>}
    </dl>
  </article>;
}

export function LibrarySkills() {
  const [params, setParams] = useSearchParams();
  const id = params.get('skill') || '';
  const [search, setSearch] = useState('');
  const [skills, setSkills] = useState<LibrarySkill[]>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const filtered = skills?.filter(skill => (skill.name + ' ' + skill.id).toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    void libraryRequest<{ skills: LibrarySkill[] }>('/api/library/skills', 'GET', undefined, abort.signal).then(result => {
      if (!abort.signal.aborted) setSkills(result.skills);
    }, reason => { if (!abort.signal.aborted) setError(errorText(reason)); });
    return () => abort.abort();
  }, [version]);

  return <section className="library-surface space-y-4" aria-label="Skills">
    {id ? <SkillDetail key={id} id={id} close={() => setParams({ section: 'skills' })}
      onChange={() => { setVersion(value => value + 1); window.dispatchEvent(new Event('library-skills-changed')); }} /> : <>
      <div className="library-heading">
        <div><h2>Skills</h2><p>Kelola workflow bawaan dan instruksi workspace agent.</p></div>
        <SearchField label="Cari skill" value={search} change={setSearch} />
      </div>
      {error && <div role="alert" className="library-notice">{error} <button type="button" className="ui-button" onClick={() => setVersion(value => value + 1)}>Coba lagi</button></div>}
      {!skills && !error && <p role="status">Memuat skills…</p>}
      {filtered?.length === 0 && <p role="status">{search ? 'Skill tidak ditemukan.' : 'Belum ada skill.'}</p>}
      <div className="library-grid">
        {filtered?.map(skill => <Link to={'/library?' + new URLSearchParams({ section: 'skills', skill: skill.id })} className="library-card library-skill-card" key={skill.id}>
          <span className="library-icon"><BookOpen size={20} aria-hidden="true" /></span>
          <span className="flex-1 min-w-0"><strong className="break-words">{skill.name}</strong><span className="library-muted block text-sm">{skill.source === 'builtin' ? 'Bawaan' : 'Workspace'}</span></span>
          <Status>{skill.enabled ? 'Aktif' : 'Nonaktif'}</Status>
        </Link>)}
      </div>
    </>}
  </section>;
}

function SkillDetail({ id, close, onChange }: { id: string; close: () => void; onChange: () => void }) {
  const [skill, setSkill] = useState<LibrarySkillDetail>();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const url = '/api/library/skill?' + new URLSearchParams({ id });
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    void libraryRequest<LibrarySkillDetail>(url, 'GET', undefined, abort.signal).then(result => {
      if (!abort.signal.aborted) { setSkill(result); setDraft(result.content); }
    }, reason => { if (!abort.signal.aborted) setError(errorText(reason)); });
    return () => abort.abort();
  }, [url, version]);

  async function update(patch: { content?: string; enabled?: boolean }) {
    if (!skill || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await libraryRequest<LibrarySkillDetail>('/api/library/skill', 'PATCH', { id, ...patch, hash: skill.hash });
      setSkill(result);
      setDraft(result.content);
      setEditing(false);
      onChange();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="ui-button" onClick={close}><ArrowLeft size={14} aria-hidden="true" /> Semua Skills</button>
    {error && <div role="alert" className="library-notice">{error} <button type="button" className="ui-button" onClick={() => { setEditing(false); setVersion(v => v + 1); }}>Muat ulang</button></div>}
    {!skill && !error && <p role="status">Memuat skill…</p>}
    {skill && <>
      <div className="library-detail-header">
        <span className="library-icon"><BookOpen size={25} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><h2 className="break-words text-xl font-semibold">{skill.name}</h2><p className="font-mono text-xs break-all library-muted">{skill.id}</p></div>
        <div className="flex items-center gap-3">
          <Status>{skill.enabled ? 'Aktif' : 'Nonaktif'}</Status>
          <Toggle label={'Aktifkan skill ' + skill.name} enabled={skill.enabled} busy={busy || editing} change={() => void update({ enabled: !skill.enabled })} />
        </div>
      </div>
      {editing ? <form className="library-card space-y-3 p-4" onSubmit={event => { event.preventDefault(); void update({ content: draft }); }}>
        <label className="block text-sm font-medium">Instruksi skill<textarea className="ui-field mt-2 block w-full font-mono" value={draft}
          onChange={event => setDraft(event.target.value)} rows={16} maxLength={512000} required /></label>
        <button className="ui-button" type="submit" disabled={busy || !draft.trim()}><Check size={15} aria-hidden="true" /> Simpan</button>
        <button className="ui-button ml-2" type="button" disabled={busy} onClick={() => { setEditing(false); setDraft(skill.content); }}>Batal</button>
      </form> : <div className="library-card p-4"><MarkdownOutput content={skill.content} downloadable={false} /></div>}
      {!editing && <div className="flex gap-2"><button type="button" className="ui-button" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="ui-button" onClick={() => setConfirmation(true)}>Hapus</button></div>}
      {confirmation && <ConfirmDialog onClose={() => setConfirmation(false)} confirmation={{
        title: 'Hapus skill', target: skill.name, description: 'Skill akan dihapus dari katalog dan pemilih workflow Chat.',
        action: async () => {
          await libraryRequest(url + '&hash=' + encodeURIComponent(skill.hash), 'DELETE');
          onChange();
          close();
        },
      }} />}
    </>}
  </>;
}

export default function LibraryPage() {
  const [params] = useSearchParams();
  const tab = params.get('section') === 'skills' ? 'skills' : 'apps';
  return <div className="library-shell mx-auto max-w-6xl">
    <nav aria-label="Bagian Library" className="library-nav">
      <Link to="/library" aria-current={tab === 'apps' ? 'page' : undefined}><Boxes size={16} aria-hidden="true" /> Apps</Link>
      <Link to="/library?section=skills" aria-current={tab === 'skills' ? 'page' : undefined}><BookOpen size={16} aria-hidden="true" /> Skills</Link>
    </nav>
    {tab === 'skills' ? <LibrarySkills /> : <LibraryApps />}
  </div>;
}
