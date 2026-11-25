'use client';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Select from '@/components/Select';
import ModelInput from '@/components/ModelInput';
import ProviderBrandIcon from '@/components/ProviderBrandIcon';
import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';
import { PROVIDERS, type ProviderId, type Connection } from '@/lib/ai/catalog';

const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function AISettingsModal({ isOpen, onClose, initialProvider, onSaved }: { isOpen: boolean; onClose: () => void; initialProvider?: ProviderId; onSaved?: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [endpoint,setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [cliPath, setCliPath] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirtyPath = useRef(false);
  const definition = PROVIDERS.find(item => item.id === provider)!;
  const connection = connections.find(item => item.provider === provider);

  function select(next: ProviderId, values = connections) {
    const item = values.find(value => value.provider === next);
    dirtyPath.current = false;
    setEndpoint(item?.endpoint || (next==='gemini'?'https://generativelanguage.googleapis.com/v1beta/openai':next==='ollama'?'http://127.0.0.1:11434/v1':'')); setProvider(next); setModel(item?.model ?? ''); setCliPath(item?.executable || item?.cliPath || '');
    setApiKey(''); setClearKey(false); setModels([]); setError(''); setMessage('');
  }

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setMessage(''); setApiKey('');
    fetch('/api/ai/settings', { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConnections(data.connections); setDesktop(!!data.desktop || !!data.localCli); select(initialProvider || data.provider, data.connections);
    }).catch(error => { if (error.name !== 'AbortError') setError('AI Management tidak dapat dimuat.'); }).finally(() => setLoading(false));
    return () => controller.abort();
    // Each opening reloads saved credentials without exposing the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialProvider]);

  async function persist() {
      const response = await fetch('/api/ai/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model, apiKey, cliPath, clearKey, endpoint }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const saved = await fetch('/api/ai/settings');
      const result = await saved.json(); if (!saved.ok) throw new Error(result.error || 'Konfigurasi tidak dapat dimuat.');
      setConnections(result.connections); setApiKey(''); setClearKey(false);
      const selected = result.connections.find((item: Connection) => item.provider === provider);
      setCliPath(selected?.executable || selected?.cliPath || ''); dirtyPath.current = false;
      window.dispatchEvent(new Event('ai-settings-updated'));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await persist();
      onSaved?.();
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  async function discover() {
    setBusy(true); setError(''); setMessage('');
    try {
      await persist();
      const response = await fetch(`/api/ai/models?provider=${provider}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setModels(data.models); setMessage(data.message || `${data.models.length} model tersedia`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Gagal membaca model.'); }
    finally { setBusy(false); }
  }

  async function connect() {
    setBusy(true); setError(''); setMessage('');
    try {
      await persist();
      const response = await fetch('/api/ai/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage(data.message);
    } catch (error) { setError(error instanceof Error ? error.message : 'Gagal membuka login.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!isOpen || loading || definition.mode !== 'cli' || !desktop) return;
    const controller = new AbortController();
    fetch('/api/ai/detect', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, path: cliPath }) })
      .then(async response => {
        const result = await response.json(); if (!response.ok || dirtyPath.current) return;
        setConnections(previous => previous.map(item => item.provider === provider ? { ...item, available: result.available, executable: result.executable } : item));
        if (result.executable) setCliPath(result.executable);
      }).catch(() => {});
    return () => controller.abort();
    // Re-scan when opening settings or changing provider; typing preserves the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loading, provider, desktop]);

  async function detect() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/ai/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setConnections(previous => previous.map(item => item.provider === provider ? { ...item, available: result.available, executable: result.executable } : item));
      if (result.executable) { setCliPath(result.executable); dirtyPath.current = false; setMessage('CLI terdeteksi'); }
      else setError('CLI belum ditemukan. Pilih file .exe atau isi folder instalasinya.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Deteksi CLI gagal.'); }
    finally { setBusy(false); }
  }

  if (!isOpen) return null;
  return <Dialog title="AI Management" onClose={onClose}>
    {loading ? <p role="status" className="text-sm text-gray-500">Memuat…</p> : <form onSubmit={save} className="space-y-4">
      <label className="block text-sm"><span className="inline-flex items-center gap-2"><ProviderBrandIcon provider={provider} size={16} />Provider</span><Select aria-label="Provider" className={`${field} mt-1.5`} value={provider} onChange={event => select(event.target.value as ProviderId)} disabled={busy}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><span className={`h-1.5 w-1.5 rounded-full ${definition.mode === 'api' ? (connection?.configured ? 'bg-green-500' : 'bg-gray-400') : (connection?.available ? 'bg-green-500' : 'bg-amber-500')}`} />
        {definition.mode === 'api' ? connection?.configured ? `Key tersimpan ${connection.apiKeyHint}` : 'API key belum diisi' : connection?.available ? 'CLI ditemukan · login dikelola CLI' : 'CLI belum ditemukan'}</p>
      {provider !== 'codex' && <div><label className="block text-sm">{provider === 'kiro' ? 'Kiro API key · opsional' : provider === 'antigravity' ? 'Gemini API key · opsional' : 'API key'}<input aria-label="API key" type="password" autoComplete="off" className={`${field} mt-1.5`} value={apiKey} onChange={event => { setApiKey(event.target.value); setClearKey(false); }} placeholder={clearKey ? 'Key akan dihapus saat disimpan' : connection?.apiKeyHint ? 'Kosongkan untuk mempertahankan key' : definition.mode === 'cli' ? 'Kosongkan untuk memakai login CLI' : 'API key'} /></label>{connection?.apiKeyHint && <button type="button" onClick={() => { setClearKey(true); setApiKey(''); }} className="mt-1 text-xs text-gray-500 hover:text-red-500">Hapus key</button>}</div>}
      {definition.mode === 'cli' && <>
        <div><label htmlFor="cli-executable" className="block text-sm mb-1.5">Executable</label><div className="flex gap-2"><input id="cli-executable" aria-label="CLI executable" disabled={busy} className={`${field} font-mono min-w-0`} value={cliPath} onChange={event => { dirtyPath.current = true; setCliPath(event.target.value); setError(''); setConnections(previous => previous.map(item => item.provider === provider ? { ...item, available: false } : item)); }} placeholder="Deteksi otomatis · file .exe atau folder bin" /><button type="button" onClick={detect} disabled={busy || !desktop} className="shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 px-3 text-xs disabled:opacity-50">Deteksi</button></div></div>
        <button type="button" onClick={connect} disabled={busy || !desktop} className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">Connect melalui CLI</button>
      </>}
      {['gemini','ollama','custom'].includes(provider) && <label className="block text-sm">API endpoint<input aria-label="API endpoint" value={endpoint} onChange={event=>setEndpoint(event.target.value)} className={field} placeholder="https://provider.example/v1" /></label>}
      <label className="block text-sm">Model ID (manual)<input aria-label="Model ID manual" value={model} onChange={event=>setModel(event.target.value)} className={field} /></label>
      <div><label htmlFor="ai-model" className="block text-sm mb-1.5">Model</label><div className="flex gap-2"><ModelInput id="ai-model" className={field} value={model} models={models} onChange={setModel} placeholder={definition.mode === 'cli' ? 'Default CLI' : 'Model ID'} /><button type="button" onClick={discover} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 text-xs disabled:opacity-50"><RefreshCw aria-hidden="true" size={13} className={busy ? 'animate-spin' : ''} />Muat model</button></div><datalist id="ai-models">{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></div>
      {provider === 'claude' && <p className="text-xs text-gray-500 dark:text-gray-400">Koneksi aplikasi memakai API key. Login langganan Claude tidak digunakan sebagai token API.</p>}
      <a href={definition.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">Dokumentasi koneksi <ArrowUpRight aria-hidden="true" size={13} /></a>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-gray-600 dark:text-gray-300">{message}</p>}
      <button disabled={busy} type="submit" className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Memproses…' : 'Simpan'}</button>
    </form>}
  </Dialog>;
}
