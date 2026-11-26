'use client';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, RefreshCw } from 'lucide-react';
import Select from '@/components/Select';

interface OperationReceipt {
  id: string;
  case_id: string | null;
  actor: string;
  action_type: string;
  cluster_label: string;
  namespace_name: string;
  workload_name: string;
  workload_kind: string;
  environment: string;
  status: 'success' | 'denied' | 'timeout' | 'unknown';
  summary: string;
  post_check: string;
  created_at: string;
}

const STATUS_META = {
  success: { label: 'Sukses', Icon: CheckCircle2, badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  denied: { label: 'Ditolak', Icon: AlertTriangle, badge: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300' },
  timeout: { label: 'Timeout', Icon: Clock, badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  unknown: { label: 'Belum Diketahui', Icon: HelpCircle, badge: 'border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300' },
};

export default function ActivityPage() {
  const [receipts, setReceipts] = useState<OperationReceipt[]>([]);
  const [selected, setSelected] = useState<OperationReceipt | null>(null);
  const [envFilter, setEnvFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (envFilter) params.set('environment', envFilter);
      if (targetFilter) params.set('target', targetFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReceipts(data.receipts || []);
      }
    } finally {
      setLoading(false);
    }
  }, [envFilter, targetFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Activity</h1>
          <p className="text-xs opacity-70">Riwayat Operation Receipt tersanitasi untuk aksi operasional non-produksi.</p>
        </div>
        <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <input
          className="ui-field flex-1 min-w-[180px] text-xs"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Filter target workload / namespace…"
          aria-label="Filter target"
        />
        <input
          className="ui-field w-40 text-xs"
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          placeholder="Environment"
          aria-label="Filter environment"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter status">
          <option value="">Semua status</option>
          <option value="success">Sukses</option>
          <option value="denied">Ditolak</option>
          <option value="timeout">Timeout</option>
          <option value="unknown">Belum Diketahui</option>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,340px]">
        <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 space-y-2">
          {loading ? (
            <p role="status" className="text-xs opacity-70">Memuat riwayat…</p>
          ) : !receipts.length ? (
            <p className="text-xs opacity-70 py-6 text-center">Belum ada Operation Receipt.</p>
          ) : (
            <ul className="space-y-2">
              {receipts.map((r) => {
                const meta = STATUS_META[r.status] || STATUS_META.unknown;
                const Icon = meta.Icon;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className={`w-full text-left rounded-xl border p-3 text-xs transition ${
                        selected?.id === r.id ? 'bg-[var(--ui-hover)] border-[var(--ui-border)]' : 'border-[var(--ui-border)] hover:bg-[var(--ui-hover)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {r.action_type} · {r.namespace_name}/{r.workload_name}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${meta.badge}`}>
                          <Icon size={12} aria-hidden="true" />
                          <span>{meta.label}</span>
                        </span>
                      </div>
                      <div className="opacity-70 mt-1">
                        Env: {r.environment} · Pelaku: {r.actor} · {r.created_at}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-xs space-y-2">
          <h2 className="text-sm font-semibold">Detail Receipt</h2>
          {!selected ? (
            <p className="opacity-70">Pilih salah satu receipt untuk melihat detail tersanitasi.</p>
          ) : (
            <>
              <div><strong>Status:</strong> {STATUS_META[selected.status]?.label || selected.status}</div>
              <div><strong>Pelaku:</strong> {selected.actor}</div>
              <div><strong>Target:</strong> {selected.cluster_label || 'default'} / {selected.namespace_name} / {selected.workload_kind} {selected.workload_name}</div>
              <div><strong>Environment:</strong> {selected.environment}</div>
              <div><strong>Waktu:</strong> {selected.created_at}</div>
              <div className="pt-1"><strong>Ringkasan:</strong><p className="mt-0.5 opacity-85">{selected.summary}</p></div>
              <div><strong>Pemeriksaan Sesudah Aksi:</strong><p className="mt-0.5 opacity-85">{selected.post_check}</p></div>
              {selected.case_id && (
                <div className="pt-2">
                  <Link to={`/investigate?caseId=${encodeURIComponent(selected.case_id)}`} className="ui-button inline-block">
                    Kembali ke Kasus
                  </Link>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
