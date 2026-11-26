'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Select from '@/components/Select';

interface ConfluentConnector {
  id: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  lastStatus: string;
}

export default function ConfluentPage() {
  const [connectors, setConnectors] = useState<ConfluentConnector[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadConnectors = useCallback(async () => {
    const res = await fetch('/api/connectors');
    if (res.ok) {
      const data = await res.json();
      const list = (data.connectors || []).filter(
        (c: ConfluentConnector & { kind: string }) => c.kind === 'confluent' && c.enabled,
      );
      setConnectors(list);
      if (list.length && !selectedId) setSelectedId(list[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  async function loadMetadata() {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/connectors/${encodeURIComponent(selectedId)}/confluent-metadata`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat metadata.');
      const raw = data.topics;
      if (Array.isArray(raw)) {
        setTopics(raw.map((t) => (typeof t === 'string' ? t : JSON.stringify(t))));
      } else if (raw && Array.isArray(raw.data)) {
        setTopics(raw.data.map((t: { topic_name?: string }) => t.topic_name || JSON.stringify(t)));
      } else {
        setTopics([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat metadata.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Confluent Metadata</h1>
          <p className="text-xs opacity-70">Read-only topic & schema metadata (tanpa membaca event payload).</p>
        </div>
        <button type="button" className="ui-button inline-flex items-center gap-1" disabled={busy || !selectedId} onClick={() => void loadMetadata()}>
          <RefreshCw size={14} aria-hidden="true" /> Muat Topic
        </button>
      </div>

      {!connectors.length ? (
        <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-xs opacity-80">
          Tambahkan konektor <strong>Confluent</strong> di Settings → Integrations terlebih dahulu.
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 space-y-3 text-xs">
          <div className="max-w-sm">
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} aria-label="Pilih cluster Confluent">
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>{c.label} ({c.baseUrl})</option>
              ))}
            </Select>
          </div>
          {error && <p role="alert" className="text-red-500">{error}</p>}
          {topics.length > 0 && (
            <ul className="divide-y divide-[var(--ui-border)] rounded-xl border border-[var(--ui-border)]">
              {topics.map((topic) => (
                <li key={topic} className="px-3 py-2 font-mono">{topic}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
