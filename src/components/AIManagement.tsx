'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import AISettingsModal from './AISettingsModal';
import ProviderBrandIcon from './ProviderBrandIcon';
import { PROVIDERS, type Connection, type ProviderId } from '@/lib/ai/catalog';

export default function AIManagement() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<ProviderId | undefined>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/settings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConnections(data.connections);
    } catch {
      setError('Koneksi tidak dapat dimuat.');
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener('ai-settings-updated', load);
    return () => window.removeEventListener('ai-settings-updated', load);
  }, [load]);

  useEffect(() => {
    if (!snackbar) return;
    const timer = window.setTimeout(() => setSnackbar(''), 3500);
    return () => window.clearTimeout(timer);
  }, [snackbar]);

  async function remove(provider: ProviderId) {
    if (!window.confirm('Hapus konfigurasi koneksi ini? Login pada CLI tetap dikelola provider.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new Event('ai-settings-updated'));
      await load();
    } catch {
      setError('Koneksi belum dapat dihapus.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="AI Management">
      <div className="flex justify-between items-center gap-3">
        <h2 className="font-semibold">AI Management</h2>
        <button
          type="button"
          title="AI Management"
          onClick={() => {
            setSelected(undefined);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 hover:bg-blue-700 px-3 py-2 text-white text-sm"
        >
          <Plus aria-hidden="true" size={16} />
          Tambah koneksi
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Konfigurasi tersimpan dan CLI yang terdeteksi. Status login diverifikasi saat koneksi atau pemuatan model.
      </p>
      {connections
        .filter(item => item.configured || (item.available && PROVIDERS.find(p => p.id === item.provider)?.mode === 'cli'))
        .map(item => (
          <div key={item.provider} className="rounded-xl border border-gray-300 dark:border-gray-700 p-4 flex flex-wrap items-center gap-3">
            <ProviderBrandIcon provider={item.provider} size={22} />
            <div className="flex-1 min-w-0">
              <h3 className="font-medium">{PROVIDERS.find(p => p.id === item.provider)?.name}</h3>
              <p className="text-xs text-gray-500 break-all">
                {item.model || 'Model default'} · {item.cliPath || item.endpoint || (item.configured ? 'API key tersimpan' : 'CLI terdeteksi')}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected(item.provider);
                setOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
            >
              <Pencil aria-hidden="true" size={14} />
              Edit / Connect
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(item.provider)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-red-500"
            >
              <Trash2 aria-hidden="true" size={14} />
              Hapus
            </button>
          </div>
        ))}
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <AISettingsModal
        isOpen={open}
        initialProvider={selected}
        onClose={() => setOpen(false)}
        onSaved={() => setSnackbar('Berhasil Disimpan!')}
      />
      {snackbar && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{snackbar}</span>
        </div>
      )}
    </section>
  );
}
