'use client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Check, Copy, FileText, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import Dialog from '@/components/Dialog';
import Select from '@/components/Select';
import { formatLogsForCopy, parseLogLineForBeautify } from '@/lib/ocp/log-beautifier';

const AIAnalyzeModal = lazy(() => import('./AIAnalyzeModal'));

interface OpenshiftLogsModalProps {
  clusterId?: string;
  project: string;
  pod: string;
  containers: string[];
  onClose: () => void;
}

export default function OpenshiftLogsModal({
  clusterId,
  project,
  pod,
  containers,
  onClose,
}: OpenshiftLogsModalProps) {
  const [container, setContainer] = useState(containers[0] || '');
  const [tail, setTail] = useState('300');
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [beautify, setBeautify] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [savedCaseId, setSavedCaseId] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  async function saveToCase() {
    if (!logs) return;
    setSavingCase(true);
    try {
      const selected = window.getSelection()?.toString().trim();
      const excerpt = (selected || logs).slice(-16000);
      const created = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Log ${pod}`,
          serviceName: pod,
          environment: project,
          namespace: project,
          workload: pod,
        }),
      });
      const caseData = await created.json();
      if (!created.ok) throw new Error(caseData.error || 'Gagal membuat kasus.');
      const caseId = caseData.case.id as string;
      const ev = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'openshift_log',
          clusterLabel: clusterId || 'default',
          namespace: project,
          pod,
          source: `/openshift/${project}/pods/${pod}/log`,
          sourceTime: new Date().toISOString(),
          content: excerpt,
        }),
      });
      if (!ev.ok) throw new Error('Gagal menyimpan cuplikan ke kasus.');
      setSavedCaseId(caseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan ke kasus.');
    } finally {
      setSavingCase(false);
    }
  }

  const fetchLogs = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          entity: 'logs',
          project,
          pod,
          tail,
        });
        if (clusterId) params.set('clusterId', clusterId);
        if (container) params.set('container', container);
        const res = await fetch(`/api/openshift?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}: Gagal mengambil log.`);
        }
        setLogs(data.logs || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal mengambil log.');
      } finally {
        if (!isSilent) setLoading(false);
      }
    },
    [clusterId, project, pod, container, tail],
  );

  useEffect(() => {
    void fetchLogs(false);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchLogs(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (!loading && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [loading]);

  const filteredLogLines = useMemo(() => {
    if (!logs) return [];
    const allLines = logs.split('\n');
    if (!searchQuery.trim()) return allLines;
    const q = searchQuery.toLowerCase();
    return allLines.filter(line => line.toLowerCase().includes(q));
  }, [logs, searchQuery]);

  const handleCopy = useCallback(() => {
    if (!navigator?.clipboard) return;
    void navigator.clipboard.writeText(formatLogsForCopy(filteredLogLines, beautify));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [filteredLogLines, beautify]);

  return (
    <>
      <Dialog title={`Logs — ${pod}`} onClose={onClose} className="max-w-5xl">
        <div className="flex flex-col h-[74dvh] min-h-0 -mt-2">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 shrink-0">
                <FileText aria-hidden="true" size={18} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm truncate">{pod}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
                    {project}
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-mono truncate">
                  oc logs {pod} -n {project}{container ? ` -c ${container}` : ''} --tail={tail}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                />
                <span>Live (3s)</span>
              </label>

              {containers.length > 1 && (
                <Select
                  aria-label="Container"
                  value={container}
                  onChange={e => setContainer(e.target.value)}
                  className="ui-field text-xs py-1 px-2.5"
                >
                  {containers.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}

              <Select
                aria-label="Jumlah baris log"
                value={tail}
                onChange={e => setTail(e.target.value)}
                className="ui-field text-xs py-1 px-2.5"
              >
                <option value="100">100 baris</option>
                <option value="300">300 baris</option>
                <option value="500">500 baris</option>
                <option value="1000">1000 baris</option>
              </Select>

              <button
                type="button"
                onClick={() => void fetchLogs(false)}
                disabled={loading}
                className="ui-button"
                title="Refresh log"
                aria-label="Refresh log"
              >
                <RefreshCw aria-hidden="true" size={14} className={loading ? 'animate-spin text-blue-400' : ''} />
              </button>

              <button
                type="button"
                aria-pressed={beautify}
                onClick={() => setBeautify(b => !b)}
                className={`ui-button ${beautify ? 'border-blue-500/60 bg-blue-500/15 text-blue-300' : ''}`}
                title="Format JSON logs otomatis"
              >
                <Braces aria-hidden="true" size={13} />
                <span>Beautify</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="ui-button"
                title="Salin seluruh log"
              >
                {copied ? <Check aria-hidden="true" size={13} className="text-emerald-400" /> : <Copy aria-hidden="true" size={13} />}
                <span>{copied ? 'Tersalin' : 'Salin'}</span>
              </button>

              <button
                type="button"
                onClick={() => void saveToCase()}
                disabled={!logs || savingCase}
                className="ui-button"
                title="Simpan cuplikan log ke Evidence Case"
              >
                <FileText aria-hidden="true" size={13} />
                <span>{savingCase ? 'Menyimpan…' : 'Simpan ke Kasus'}</span>
              </button>

              {savedCaseId && (
                <a href={`/investigate?caseId=${encodeURIComponent(savedCaseId)}`} className="ui-button text-emerald-400">
                  Buka Kasus
                </a>
              )}

              <button
                type="button"
                onClick={() => setShowAIModal(true)}
                disabled={!logs}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700 disabled:opacity-40"
                title="Analisis error dengan AI"
              >
                <Sparkles aria-hidden="true" size={13} />
                <span>AI Analyze</span>
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Search aria-hidden="true" size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              aria-label="Cari kata kunci dalam log"
              placeholder="Cari kata kunci dalam log (contoh: error, panic, failed, status)…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs text-gray-400 hover:text-gray-200 shrink-0"
              >
                Clear
              </button>
            )}
          </div>

          {/* Log Viewer */}
          <div
            ref={logContainerRef}
            className="flex-1 min-h-0 overflow-y-auto p-3 my-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-950 font-mono text-xs leading-relaxed select-text"
          >
            {loading && !logs && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
                <Loader2 aria-hidden="true" size={22} className="animate-spin text-blue-400" />
                <span>Mengambil log dari {pod}…</span>
              </div>
            )}

            {!loading && error && (
              <div role="alert" className="p-4 text-red-400 bg-red-950/40 border border-red-900 rounded-lg">
                Gagal memuat log: {error}
              </div>
            )}

            {!loading && !error && filteredLogLines.length === 0 && (
              <div className="text-gray-500 text-center py-10 italic">
                Tidak ada log yang ditemukan.
              </div>
            )}

            {filteredLogLines.map((line, idx) => {
              if (beautify) {
                const parsed = parseLogLineForBeautify(line);
                const color =
                  parsed.level === 'error'
                    ? 'text-red-400 bg-red-950/20'
                    : parsed.level === 'warn'
                      ? 'text-yellow-400'
                      : parsed.level === 'info'
                        ? 'text-sky-300'
                        : 'text-gray-300';

                if (parsed.kind === 'json') {
                  return (
                    <div key={idx} className={`my-1 rounded-lg border border-gray-800 p-2 ${color}`}>
                      {(parsed.prefix || parsed.tags.length > 0) && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-80">
                          {parsed.prefix && <span>{parsed.prefix}</span>}
                          {parsed.tags.map(tag => (
                            <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-200">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <pre className="whitespace-pre-wrap break-all text-gray-200">{parsed.formattedJson}</pre>
                    </div>
                  );
                }
              }

              const isError = /error|fatal|panic|failed|exception/i.test(line);
              const isWarn = /warn|warning/i.test(line);
              return (
                <div
                  key={idx}
                  className={`py-0.5 px-1.5 rounded hover:bg-gray-800/60 whitespace-pre-wrap break-all ${
                    isError ? 'text-red-400 bg-red-950/20' : isWarn ? 'text-yellow-400' : 'text-gray-300'
                  }`}
                >
                  {line}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 flex items-center justify-between">
            <span>Menampilkan {filteredLogLines.length} baris log</span>
            <button type="button" onClick={onClose} className="ui-button">
              Tutup
            </button>
          </div>
        </div>
      </Dialog>

      {showAIModal && (
        <Suspense fallback={null}>
          <AIAnalyzeModal
            isOpen={showAIModal}
            onClose={() => setShowAIModal(false)}
            logText={logs.slice(-4000)}
          />
        </Suspense>
      )}
    </>
  );
}
