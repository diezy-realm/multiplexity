import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronRight, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PROVIDERS, validModel, type Connection, type ProviderDefinition, type ProviderModel } from '@/lib/ai/catalog';
import { enabledProvider, mergeModels, providerFetch, providerSettingsEvent, providerWrite, runtimeConfig, type Identity, type ProbeResult, type ProviderSettings } from '@/lib/ai/provider-settings';
import AISettingsModal from './AISettingsModal';
import { IdentityFields, ProviderSwitch, RuntimeFields } from './AIProviderFields';
import ProviderBrandIcon from './ProviderBrandIcon';
import '@/styles/ai-providers.css';

export default function AIProviderSettings() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState<ProviderSettings>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setSettings(await providerFetch<ProviderSettings>('/api/ai/settings', { signal }));
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Provider tidak dapat dimuat.');
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

  const connections = settings?.connections ?? [];
  const saved = connections.filter(item => item.saved ?? item.configured);
  const selected = saved.find(item => item.provider === params.get('provider')) ??
    saved.find(item => item.provider === settings?.provider) ?? saved[0];
  const definition = PROVIDERS.find(item => item.id === selected?.provider);

  function choose(provider?: string) {
    setNotice('');
    setError('');
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (provider) next.set('provider', provider);
      else next.delete('provider');
      return next;
    }, { replace: true });
  }

  async function refresh(message: string) {
    window.dispatchEvent(new Event(providerSettingsEvent));
    await load();
    setNotice(message);
  }

  async function toggle(item: Connection) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const enabled = !enabledProvider(item);
      await providerWrite('/api/ai/settings', { provider: item.provider, enabled }, 'PATCH');
      await refresh(enabled ? 'Provider diaktifkan.' : 'Provider dinonaktifkan.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Status provider gagal disimpan.');
    } finally {
      setPending(false);
    }
  }

  return <section className="ai-provider-settings" aria-label="AI Provider">
    <header className="ai-page-heading">
      <div><h2>AI Provider</h2><p>Kelola koneksi, runtime, dan model untuk Chat dan Code Review.</p></div>
      <button type="button" className="ai-primary" disabled={!settings || saved.length === PROVIDERS.length} onClick={() => setShowWizard(true)}><Plus size={16} /> Tambah provider</button>
    </header>
    {error && <p role="alert" className="ai-error">{error}</p>}
    {notice && <p role="status" className="ai-probe-ok">{notice}</p>}
    {!settings && !error && <p role="status" className="ai-muted">Memuat provider…</p>}
    {!settings && error && <button className="ui-button" type="button" onClick={() => { setError(''); void load(); }}>Coba lagi</button>}
    {settings && !saved.length && <div className="ai-empty"><Bot size={27} /><h3>Belum ada provider</h3><p>Tambahkan provider untuk memilih model di Chat.</p></div>}
    {selected && definition && <div className="ai-provider-layout">
      <aside className="ai-provider-list" aria-label="Provider tersimpan">
        <h3>Provider <span>{saved.length}</span></h3>
        {saved.map(item => {
          const entry = PROVIDERS.find(data => data.id === item.provider);
          if (!entry) return null;
          const label = item.profile?.label || entry.name;
          const on = enabledProvider(item);
          return <div key={item.provider} className="ai-provider-item" data-selected={selected.provider === item.provider}>
            <button type="button" className="ai-provider-entry" aria-current={selected.provider === item.provider ? 'true' : undefined} onClick={() => choose(item.provider)}>
              <span className="ai-provider-glyph" style={item.profile?.color ? { borderInlineStartColor: item.profile.color } : undefined}><ProviderBrandIcon provider={item.provider} size={18} /></span>
              <span><strong>{label}</strong><small>{!on ? 'Nonaktif' : item.profile?.verified && item.configured ? 'Terverifikasi' : item.configured ? 'Konfigurasi tersimpan' : 'Perlu konfigurasi'}</small></span>
              <ChevronRight size={14} />
            </button>
            <ProviderSwitch label={`Aktifkan provider ${label}`} enabled={on} disabled={pending} onChange={() => void toggle(item)} />
          </div>;
        })}
      </aside>
      <ProviderDetail key={selected.provider} definition={definition} item={selected} isDefault={settings?.provider === selected.provider && enabledProvider(selected)}
        onSaved={refresh} onRemove={async () => { choose(); await refresh('Provider dihapus.'); }} />
    </div>}
    {showWizard && <AISettingsModal connections={connections} makeDefault={!saved.some(item => item.configured && enabledProvider(item))} onClose={() => setShowWizard(false)}
      onSaved={provider => { setShowWizard(false); choose(provider); void refresh('Provider ditambahkan.'); }} />}
  </section>;
}

function ProviderDetail({ item, definition, isDefault, onSaved, onRemove }: {
  item: Connection;
  definition: ProviderDefinition;
  isDefault: boolean;
  onSaved: (message: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [identity, setIdentity] = useState<Identity>({ label: item.profile?.label || definition.name, color: item.profile?.color || '', description: item.profile?.description || '' });
  const [config, setConfig] = useState(() => runtimeConfig(definition, item));
  const [result, setResult] = useState<ProbeResult>();
  const [models, setModels] = useState<ProviderModel[]>(() => mergeModels(item.profile?.models ?? [], item.model ? [{ id: item.model, name: item.model }] : []));
  const [disabled, setDisabled] = useState(item.profile?.disabledModels ?? []);
  const [model, setModel] = useState(item.model);
  const [manualModel, setManualModel] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'login' | 'remove'>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const settingsRuntime = runtimeConfig(definition, item);
  const runtimeChanged = config.apiKey.trim() !== '' || config.clearKey || config.cliPath !== settingsRuntime.cliPath || config.endpoint !== settingsRuntime.endpoint;
  const removeRequiredKey = config.clearKey && definition.mode === 'api' && !['ollama', 'custom'].includes(item.provider);
  const displayName = item.profile?.label || definition.name;
  const online = enabledProvider(item);

  async function perform(operation: NonNullable<typeof busy>, makeDefault = false) {
    if (controller.current) return;
    if (operation === 'remove' && !window.confirm(`Hapus konfigurasi ${displayName}?`)) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(operation);
    setError('');
    setNotice('');
    const payload = { provider: item.provider, model, ...config };
    try {
      if (operation === 'remove') {
        await providerWrite('/api/ai/settings', { provider: item.provider }, 'DELETE', abort.signal);
        await onRemove();
      } else if (operation === 'test') {
        setResult(undefined);
        const data = await providerWrite<ProbeResult>('/api/ai/probe', payload, 'POST', abort.signal);
        setResult(data);
        setModels(mergeModels(data.models, models));
      } else if (operation === 'login') {
        const data = await providerWrite<{ message: string }>('/api/ai/connect', payload, 'POST', abort.signal);
        setNotice(data.message);
      } else {
        await providerWrite('/api/ai/settings', {
          ...payload, verify: !!result && !removeRequiredKey, makeDefault,
          profile: { ...identity, models, disabledModels: disabled },
        }, 'POST', abort.signal);
        if (config.cliPath && result?.executable) setConfig({ ...config, cliPath: result.executable, apiKey: '', clearKey: false });
        else setConfig({ ...config, apiKey: '', clearKey: false });
        setResult(undefined);
        await onSaved(makeDefault ? 'Provider default diperbarui.' : 'Konfigurasi provider disimpan.');
      }
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Permintaan provider gagal.');
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setBusy(undefined);
    }
  }

  function toggleModel(id: string) {
    if (disabled.includes(id)) {
      setDisabled(disabled.filter(value => value !== id));
      return;
    }
    setDisabled([...disabled, id]);
    if (!model || model === id) setModel(models.find(entry => entry.id !== id && !disabled.includes(entry.id))?.id ?? '');
  }

  function addModel() {
    const id = manualModel.trim();
    if (!id || !validModel(id) || models.length >= 300) return;
    setModels(mergeModels(models, [{ id, name: id }]));
    setDisabled(disabled.filter(value => value !== id));
    if (!model) setModel(id);
    setManualModel('');
  }

  const filtered = models.filter(entry => `${entry.name} ${entry.id}`.toLowerCase().includes(query.toLowerCase().trim()));
  const saveBlocked = !!busy || !identity.label.trim() || (runtimeChanged && !result && !removeRequiredKey);

  return <form className="ai-provider-detail" onSubmit={event => { event.preventDefault(); if (!saveBlocked) void perform('save'); }}>
    <header className="ai-detail-heading">
      <ProviderBrandIcon provider={item.provider} size={28} />
      <div><h3>{displayName}</h3><p>{definition.name} · {definition.mode === 'cli' ? 'CLI lokal' : 'API'}</p></div>
      {isDefault && <span className="ai-badge"><Star size={13} /> Default</span>}
    </header>
    <section className="ai-section" aria-label="Identitas provider">
      <h4>Identitas</h4>
      <IdentityFields value={identity} onChange={setIdentity} />
    </section>
    <section className="ai-section" aria-label="Runtime dan koneksi">
      <div className="ai-section-heading"><h4>Runtime dan koneksi</h4>{item.profile?.version && <code>{item.profile.version}</code>}</div>
      <RuntimeFields definition={definition} connection={item} value={config} onChange={next => { setConfig(next); setResult(undefined); setError(''); setNotice(''); }}
        busy={!!busy} testing={busy === 'test'} result={result} onTest={() => void perform('test')} onLogin={() => void perform('login')} />
    </section>
    <section className="ai-section" aria-label="Model provider">
      <div className="ai-section-heading"><h4>Model</h4><small>{models.length - disabled.filter(id => models.some(entry => entry.id === id)).length} aktif</small></div>
      <label className="ai-field"><span>Model default</span><select className="ai-input" disabled={!!busy} value={model} onChange={event => setModel(event.target.value)}>
        <option value="" disabled={definition.mode === 'cli' && disabled.length > 0 && !!model}>{definition.mode === 'cli' && !disabled.length ? 'Default CLI' : 'Belum dipilih'}</option>
        {models.filter(entry => !disabled.includes(entry.id)).map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
      </select></label>
      <label className="ai-filter"><Search size={15} /><input aria-label="Filter model" placeholder="Filter model" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="ai-models">
        {filtered.length ? filtered.map(entry => <div key={entry.id} className="ai-model-row">
          <div><strong>{entry.name}</strong><code>{entry.id}</code></div>
          <ProviderSwitch label={`Aktifkan model ${entry.id}`} enabled={!disabled.includes(entry.id)} disabled={!!busy} onChange={() => toggleModel(entry.id)} />
        </div>) : <p className="ai-muted">{models.length ? 'Model tidak ditemukan.' : 'Uji koneksi untuk memuat model.'}</p>}
      </div>
      <div className="ai-add-model">
        <input className="ai-input" aria-label="Model ID manual" placeholder="Model ID manual" value={manualModel} maxLength={120} onChange={event => setManualModel(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} />
        <button type="button" className="ui-button" disabled={!!busy || models.length >= 300 || !manualModel.trim() || !validModel(manualModel.trim())} onClick={addModel}><Plus size={15} /> Tambah model</button>
      </div>
    </section>
    <footer className="ai-detail-footer">
      {error && <p role="alert" className="ai-error">{error}</p>}
      {notice && <p role="status" className="ai-muted">{notice}</p>}
      {runtimeChanged && !result && !removeRequiredKey && <p className="ai-muted">Uji koneksi sebelum menyimpan perubahan runtime.</p>}
      <div className="ai-actions">
        <button type="submit" className="ai-primary" disabled={saveBlocked}>Simpan</button>
        {!isDefault && <button type="button" className="ui-button" disabled={saveBlocked || !online || !item.configured} onClick={() => void perform('save', true)}><Star size={14} /> Jadikan default</button>}
        <button type="button" className="ai-text-button ai-danger" disabled={!!busy} onClick={() => void perform('remove')}><Trash2 size={14} /> Hapus provider</button>
      </div>
    </footer>
  </form>;
}
