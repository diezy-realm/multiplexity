'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileCode2,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import AIRunPanel from '@/components/AIRunPanel';
import Dialog from '@/components/Dialog';
import MarkdownOutput from '@/components/MarkdownOutput';
import Select from '@/components/Select';
import { useChatReveal } from '@/hooks/useChatReveal';
import { readChatResponse } from '@/lib/ai/chat-stream-client';
import type { ProgressStage } from '@/lib/ai/stream-events';
import type { RunStep } from '@/components/RunTimeline';

interface EvidenceCase {
  id: string;
  title: string;
  service_name: string;
  environment: string;
  namespace_name: string;
  workload_name: string;
  repo_path: string;
  revision: string;
  evidence_count?: number;
}

interface EvidenceItem {
  id: string;
  case_id: string;
  source_type: string;
  cluster_label: string;
  namespace_name: string;
  pod_name: string;
  source_url: string;
  source_time: string;
  redaction_status: string;
  content: string;
  metadata_json?: string;
}

interface ConnectorSummary {
  id: string;
  kind: 'bamboo' | 'sonarqube' | 'jira' | 'bitbucket' | 'ghes' | 'checkmarx' | 'confluent';
  label: string;
  baseUrl: string;
  enabled: boolean;
  lastStatus: string;
}

interface PreviewData {
  destination: { provider: string; model: string };
  redactedPayload: string;
  totalChars: number;
  promptInjectionGuard: string;
  evidenceRefs: { id: string; sourceType: string; pod: string; sourceTime: string }[];
}

function extractProposal(text: string): { diff?: string; path?: string; content?: string } {
  const diffMatch = text.match(/```diff\s*([\s\S]*?)```/);
  if (diffMatch?.[1]?.trim()) {
    return { diff: diffMatch[1].trim() };
  }
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { patches?: { path?: string; content?: string }[] };
      const first = parsed.patches?.[0];
      if (first?.path && typeof first.content === 'string') {
        return { path: first.path, content: first.content };
      }
    } catch {
      // ignore invalid json block
    }
  }
  return {};
}

export default function InvestigatePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCaseId = searchParams.get('caseId') || '';

  const [cases, setCases] = useState<EvidenceCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<EvidenceCase | null>(null);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [caseError, setCaseError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [environment, setEnvironment] = useState('staging');
  const [namespace, setNamespace] = useState('');
  const [workload, setWorkload] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [revision, setRevision] = useState('');

  const [aiPrompt, setAiPrompt] = useState('Analisa akar masalah dari bukti terpilih, bedakan fakta dan hipotesis, lalu usulkan patch.');
  const [aiProvider, setAiProvider] = useState('openai');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStage, setAiStage] = useState<ProgressStage>('connecting');
  const [aiSteps, setAiSteps] = useState<RunStep[]>([]);
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiArtifact, setAiArtifact] = useState('');
  const aiAbort = useRef<AbortController | null>(null);
  const reveal = useChatReveal();

  const [sarifOpen, setSarifOpen] = useState(false);
  const [sarifText, setSarifText] = useState('');

  const [ciConnectorId, setCiConnectorId] = useState('');
  const [ciRunKey, setCiRunKey] = useState('');

  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraSummary, setJiraSummary] = useState('');
  const [jiraBody, setJiraBody] = useState('');
  const [jiraAc, setJiraAc] = useState('');
  const [jiraConnectorId, setJiraConnectorId] = useState('');

  const [restartPreview, setRestartPreview] = useState<{
    cluster: string;
    namespace: string;
    workload: string;
    kind: string;
    environment: string;
    impact: string;
  } | null>(null);

  const loadList = useCallback(async () => {
    const [casesRes, connRes] = await Promise.all([fetch('/api/cases'), fetch('/api/connectors')]);
    if (casesRes.ok) {
      const data = await casesRes.json();
      setCases(data.cases || []);
    }
    if (connRes.ok) {
      const data = await connRes.json();
      setConnectors(data.connectors || []);
    }
  }, []);

  const loadCase = useCallback(async (id: string) => {
    if (!id) {
      setSelectedCase(null);
      setItems([]);
      setCaseError('');
      return;
    }
    setLoading(true);
    setCaseError('');
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setSelectedCase(null);
        setItems([]);
        setCaseError('Kasus tidak ditemukan atau telah dihapus.');
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setSelectedCase(null);
        setItems([]);
        setCaseError('Akun tidak memiliki izin membuka kasus ini.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Gagal memuat kasus.');
      setSelectedCase(data.case);
      setItems(data.items || []);
      setSelectedIds((data.items || []).slice(0, 3).map((i: EvidenceItem) => i.id));
    } catch (err) {
      setCaseError(err instanceof Error ? err.message : 'Gagal memuat kasus.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList().finally(() => {
      if (!activeCaseId) setLoading(false);
    });
  }, [loadList, activeCaseId]);

  useEffect(() => {
    if (activeCaseId) void loadCase(activeCaseId);
  }, [activeCaseId, loadCase]);

  useEffect(() => () => aiAbort.current?.abort(), []);

  const readConnectors = useMemo(
    () =>
      connectors.filter(
        (c) =>
          c.enabled &&
          ['bamboo', 'sonarqube', 'bitbucket', 'ghes', 'checkmarx'].includes(c.kind),
      ),
    [connectors],
  );
  const activeJiraConnectors = useMemo(
    () => connectors.filter((c) => c.enabled && c.kind === 'jira'),
    [connectors],
  );
  const proposal = useMemo(() => extractProposal(aiAnswer), [aiAnswer]);

  async function createCase(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          serviceName,
          environment,
          namespace,
          workload,
          repoPath,
          revision,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat kasus.');
      setNewOpen(false);
      setTitle('');
      await loadList();
      setSearchParams({ caseId: data.case.id });
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal membuat kasus.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(itemId: string) {
    if (!selectedCase) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/cases/${encodeURIComponent(selectedCase.id)}/evidence/${encodeURIComponent(itemId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Gagal menghapus bukti.');
      await loadCase(selectedCase.id);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal menghapus bukti.');
    } finally {
      setBusy(false);
    }
  }

  async function requestAiPreview() {
    if (!selectedCase) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch('/api/ai/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          caseId: selectedCase.id,
          evidenceIds: selectedIds,
          message: aiPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat preview.');
      setPreviewData(data);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal membuat preview.');
    } finally {
      setBusy(false);
    }
  }

  async function runAiChat() {
    if (!selectedCase || !previewData || aiBusy) return;
    const abort = new AbortController();
    aiAbort.current = abort;
    setPreviewData(null);
    setAiBusy(true);
    setAiAnswer('');
    setAiArtifact('');
    setAiSteps([]);
    reveal.reset();
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          provider: aiProvider,
          message: aiPrompt,
          caseId: selectedCase.id,
          evidenceIds: selectedIds,
          permission: 'ask',
          approved: true,
          sources: [],
          attachments: [],
          skill: 'diagnose',
        }),
      });
      const data = await readChatResponse(res, (event) => {
        if (event.type === 'delta') reveal.append(event.text);
        else {
          setAiStage(event.stage);
          setAiSteps((prev) =>
            [...prev, { stage: event.stage, at: new Date().toISOString() }].slice(-100),
          );
        }
      });
      await reveal.finish(data.message);
      setAiAnswer(data.message);
      setAiArtifact(data.artifact || '');
    } catch (err) {
      setStatusMessage(
        abort.signal.aborted
          ? 'Permintaan AI dibatalkan.'
          : err instanceof Error
            ? err.message
            : 'Analisis AI gagal.',
      );
    } finally {
      setAiBusy(false);
      reveal.reset();
      aiAbort.current = null;
    }
  }

  async function saveSummaryArtifact() {
    if (!selectedCase || !previewData) return;
    setBusy(true);
    try {
      const name = `artifacts/case-${selectedCase.id.slice(0, 8)}-${Date.now()}.md`;
      const content = [
        `# Ringkasan Kasus: ${selectedCase.title}`,
        `- Service: ${selectedCase.service_name || '-'} (${selectedCase.environment || '-'})`,
        `- Evidence: ${previewData.evidenceRefs.map((r) => r.id).join(', ') || '-'}`,
        '',
        '## Cuplikan Teredaksi',
        '```text',
        previewData.redactedPayload.slice(0, 8000),
        '```',
      ].join('\n');
      const res = await fetch('/api/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) throw new Error('Gagal menyimpan Artifact.');
      setPreviewData(null);
      setStatusMessage(`Artifact tersimpan: ${name}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal menyimpan Artifact.');
    } finally {
      setBusy(false);
    }
  }

  async function submitSarif(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCase) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/import-sarif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sarif: sarifText, revision: selectedCase.revision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impor SARIF gagal.');
      setSarifOpen(false);
      setSarifText('');
      setStatusMessage(`Impor SARIF: ${data.imported} baru, ${data.duplicates} duplikat.`);
      await loadCase(selectedCase.id);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Impor SARIF gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function fetchCiRun(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCase || !ciConnectorId || !ciRunKey) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/ci-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: ciConnectorId, runKey: ciRunKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengambil evidence.');
      setCiRunKey('');
      setStatusMessage(`Evidence ditambahkan dari ${data.sourceUrl}`);
      await loadCase(selectedCase.id);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal mengambil evidence.');
    } finally {
      setBusy(false);
    }
  }

  async function saveJiraDraft(submitRemote: boolean) {
    if (!selectedCase) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const links = items.filter((i) => selectedIds.includes(i.id)).map((i) => i.source_url || i.id);
      const res = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/jira-drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: jiraProject,
          summary: jiraSummary,
          body: jiraBody,
          acceptanceCriteria: jiraAc,
          evidenceLinks: links,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan draft Jira.');
      if (submitRemote && jiraConnectorId) {
        const sub = await fetch(
          `/api/cases/${encodeURIComponent(selectedCase.id)}/jira-drafts/${encodeURIComponent(data.draft.id)}/submit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId: jiraConnectorId }),
          },
        );
        const subData = await sub.json();
        if (!sub.ok) throw new Error(subData.error || 'Submit Jira gagal.');
        setStatusMessage(`Jira issue dibuat: ${subData.issueKey}`);
      } else {
        setStatusMessage('Draft Jira disimpan lokal.');
      }
      setJiraOpen(false);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Gagal memproses draft Jira.');
    } finally {
      setBusy(false);
    }
  }

  async function openRestartPreview() {
    if (!selectedCase) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/restart/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: selectedCase.namespace_name || 'default',
          workload: selectedCase.workload_name || selectedCase.service_name || 'app',
          environment: selectedCase.environment,
          kind: 'Deployment',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Target ditolak.');
      setRestartPreview(data.preview);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Preview restart ditolak.');
    } finally {
      setBusy(false);
    }
  }

  async function executeRestart() {
    if (!selectedCase || !restartPreview) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/restart/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterLabel: restartPreview.cluster,
          namespace: restartPreview.namespace,
          workload: restartPreview.workload,
          kind: restartPreview.kind,
          environment: restartPreview.environment,
          simulatedOutcome: 'success',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restart gagal.');
      setRestartPreview(null);
      setStatusMessage(`Receipt tercatat (${data.receipt?.status || 'recorded'}).`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Restart gagal.');
    } finally {
      setBusy(false);
    }
  }

  const workspaceChangeHref = useMemo(() => {
    if (!selectedCase) return '/workspace?tab=changes';
    const p = new URLSearchParams({
      tab: 'changes',
      caseId: selectedCase.id,
      repo: selectedCase.repo_path,
      rev: selectedCase.revision,
    });
    if (proposal.diff) p.set('diff', proposal.diff);
    if (proposal.path) p.set('patchPath', proposal.path);
    if (proposal.content) p.set('patchContent', proposal.content);
    return `/workspace?${p.toString()}`;
  }, [selectedCase, proposal]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Investigate</h1>
        <button type="button" className="ui-button inline-flex items-center gap-1.5" onClick={() => setNewOpen(true)}>
          <Plus size={15} aria-hidden="true" /> Kasus baru
        </button>
      </div>

      {statusMessage && (
        <div role="status" className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[270px,1fr]">
        <aside className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Kasus Lokal</span>
            <button type="button" aria-label="Refresh kasus" className="icon-action" onClick={() => void loadList()}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
          {!cases.length ? (
            <p className="text-xs opacity-70 py-4">Belum ada kasus.</p>
          ) : (
            <ul className="space-y-1.5">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSearchParams({ caseId: c.id })}
                    className={`w-full text-left rounded-xl px-3 py-2 text-xs border transition ${
                      c.id === activeCaseId
                        ? 'bg-[var(--ui-hover)] border-[var(--ui-border)] font-semibold'
                        : 'border-transparent hover:bg-[var(--ui-hover)]'
                    }`}
                  >
                    <div className="truncate">{c.title}</div>
                    <div className="opacity-70 mt-0.5 truncate">
                      {c.service_name || 'service'} · {c.environment || 'env'} · {c.evidence_count ?? 0} bukti
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 space-y-4 min-w-0">
          {loading && <p role="status" className="text-sm opacity-70">Memuat kasus…</p>}
          {!loading && caseError && (
            <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex items-center gap-2">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{caseError}</span>
            </div>
          )}
          {!loading && !caseError && !selectedCase && (
            <p className="text-sm opacity-70 py-8 text-center">Pilih kasus di panel kiri.</p>
          )}
          {!loading && selectedCase && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ui-border)] pb-3">
                <div>
                  <h2 className="text-base font-semibold">{selectedCase.title}</h2>
                  <p className="text-xs opacity-75 mt-0.5">
                    {selectedCase.service_name || '-'} · {selectedCase.environment || '-'} · {selectedCase.namespace_name || '-'} / {selectedCase.workload_name || '-'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => setSarifOpen(true)}>
                    <FileCode2 size={14} aria-hidden="true" /> Impor SARIF
                  </button>
                  <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => { setJiraSummary(selectedCase.title); setJiraOpen(true); }}>
                    <Send size={14} aria-hidden="true" /> Draft Jira
                  </button>
                  <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => void openRestartPreview()} disabled={busy}>
                    <Play size={14} aria-hidden="true" /> Restart
                  </button>
                  <Link to={workspaceChangeHref} className="ui-button inline-flex items-center gap-1">
                    <FolderGit2 size={14} aria-hidden="true" /> Workspace
                  </Link>
                </div>
              </div>

              {readConnectors.length > 0 && (
                <form onSubmit={(e) => void fetchCiRun(e)} className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--ui-border)] p-3 text-xs">
                  <div className="min-w-[180px]">
                    <Select value={ciConnectorId} onChange={(e) => setCiConnectorId(e.target.value)} aria-label="Pilih konektor sumber">
                      <option value="">Pilih sumber enterprise…</option>
                      {readConnectors.map((c) => (
                        <option key={c.id} value={c.id}>{c.label} ({c.kind})</option>
                      ))}
                    </Select>
                  </div>
                  <input
                    className="ui-field flex-1 min-w-[180px]"
                    value={ciRunKey}
                    onChange={(e) => setCiRunKey(e.target.value)}
                    placeholder="Key (PROJ-PLAN-1 / owner/repo / scan-id)"
                    aria-label="Key sumber enterprise"
                  />
                  <button type="submit" className="ui-button" disabled={busy || !ciConnectorId || !ciRunKey}>Ambil</button>
                </form>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Evidence ({items.length})</h3>
                {items.map((item) => {
                  const checked = selectedIds.includes(item.id);
                  return (
                    <article key={item.id} className="rounded-xl border border-[var(--ui-border)] p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked ? [...prev, item.id] : prev.filter((x) => x !== item.id),
                              )
                            }
                          />
                          <span>[{item.source_type}]</span>
                          {item.pod_name && <span>{item.namespace_name}/{item.pod_name}</span>}
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="opacity-70">{item.source_time}</span>
                          <span className="rounded px-1.5 py-0.5 text-[11px] border border-[var(--ui-border)]">{item.redaction_status}</span>
                          <button type="button" aria-label={`Hapus bukti ${item.id}`} className="icon-action" onClick={() => void deleteItem(item.id)}>
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap max-h-36 overflow-auto rounded-lg bg-[var(--ui-hover)] p-2">
                        {item.content}
                      </pre>
                    </article>
                  );
                })}
              </div>

              <div className="rounded-xl border border-[var(--ui-border)] p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot size={15} aria-hidden="true" /> Analisis AI
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} aria-label="Provider AI">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="codex">Codex CLI</option>
                    <option value="claude">Claude CLI</option>
                  </Select>
                  <input className="ui-field flex-1 min-w-[240px]" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} aria-label="Instruksi ringkasan AI" />
                  <button type="button" className="ui-button" disabled={busy || aiBusy || !selectedIds.length} onClick={() => void requestAiPreview()}>
                    Preview ({selectedIds.length})
                  </button>
                </div>
                {(aiBusy || aiAnswer) && (
                  <div className="space-y-2 border-t border-[var(--ui-border)] pt-3">
                    {aiBusy ? (
                      <AIRunPanel text={reveal.text} busy stage={aiStage} steps={aiSteps} />
                    ) : (
                      <MarkdownOutput content={aiAnswer} />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {aiArtifact && (
                        <a className="ui-button text-xs" href={`/artifacts?name=${encodeURIComponent(aiArtifact)}`}>
                          Buka Artifact ↗
                        </a>
                      )}
                      {(proposal.diff || proposal.path) && (
                        <Link to={workspaceChangeHref} className="ui-button text-xs">
                          Buka Patch di Workspace →
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {newOpen && (
        <Dialog title="Kasus Baru" onClose={() => setNewOpen(false)}>
          <form onSubmit={(e) => void createCase(e)} className="space-y-2.5 text-xs">
            <label className="block">Judul *<input className="ui-field w-full mt-1" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Service<input className="ui-field w-full mt-1" value={serviceName} onChange={(e) => setServiceName(e.target.value)} /></label>
              <label className="block">Environment<input className="ui-field w-full mt-1" value={environment} onChange={(e) => setEnvironment(e.target.value)} /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Namespace<input className="ui-field w-full mt-1" value={namespace} onChange={(e) => setNamespace(e.target.value)} /></label>
              <label className="block">Workload<input className="ui-field w-full mt-1" value={workload} onChange={(e) => setWorkload(e.target.value)} /></label>
            </div>
            <label className="block">Repo Lokal<input className="ui-field w-full mt-1 font-mono" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} /></label>
            <label className="block">Revisi<input className="ui-field w-full mt-1 font-mono" value={revision} onChange={(e) => setRevision(e.target.value)} /></label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="ui-button" onClick={() => setNewOpen(false)}>Batal</button>
              <button type="submit" className="ui-button" disabled={busy}>Simpan</button>
            </div>
          </form>
        </Dialog>
      )}

      {previewData && (
        <Dialog title="Preview Pengiriman AI" onClose={() => setPreviewData(null)} className="max-w-2xl">
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-[var(--ui-border)] p-2.5 space-y-1">
              <div><strong>Tujuan:</strong> {previewData.destination.provider} ({previewData.destination.model || 'default'}) · {previewData.totalChars} chars</div>
              <div className="opacity-75">{previewData.promptInjectionGuard}</div>
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--ui-hover)] p-2.5 font-mono whitespace-pre-wrap">
              {previewData.redactedPayload}
            </pre>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setPreviewData(null)}>Batal</button>
              <button type="button" className="ui-button" onClick={() => void saveSummaryArtifact()} disabled={busy}>
                Simpan Artifact Lokal
              </button>
              <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => void runAiChat()} disabled={aiBusy}>
                <CheckCircle2 size={14} aria-hidden="true" /> Kirim ke AI
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {sarifOpen && (
        <Dialog title="Impor SARIF 2.1.0" onClose={() => setSarifOpen(false)}>
          <form onSubmit={(e) => void submitSarif(e)} className="space-y-3 text-xs">
            <input type="file" accept=".json,.sarif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setSarifText); }} />
            <textarea className="ui-field w-full h-48 font-mono" value={sarifText} onChange={(e) => setSarifText(e.target.value)} placeholder="Tempel JSON SARIF 2.1.0…" />
            <div className="flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setSarifOpen(false)}>Batal</button>
              <button type="submit" className="ui-button" disabled={busy || !sarifText.trim()}>Impor</button>
            </div>
          </form>
        </Dialog>
      )}

      {jiraOpen && (
        <Dialog title="Draft Jira" onClose={() => setJiraOpen(false)}>
          <div className="space-y-2.5 text-xs">
            <label className="block">Project Key<input className="ui-field w-full mt-1" value={jiraProject} onChange={(e) => setJiraProject(e.target.value)} /></label>
            <label className="block">Ringkasan<input className="ui-field w-full mt-1" value={jiraSummary} onChange={(e) => setJiraSummary(e.target.value)} /></label>
            <label className="block">Deskripsi<textarea className="ui-field w-full mt-1 h-24" value={jiraBody} onChange={(e) => setJiraBody(e.target.value)} /></label>
            <label className="block">Kriteria Selesai<textarea className="ui-field w-full mt-1 h-20" value={jiraAc} onChange={(e) => setJiraAc(e.target.value)} /></label>
            {activeJiraConnectors.length > 0 && (
              <Select value={jiraConnectorId} onChange={(e) => setJiraConnectorId(e.target.value)} aria-label="Konektor Jira">
                <option value="">Simpan lokal saja</option>
                {activeJiraConnectors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setJiraOpen(false)}>Batal</button>
              <button type="button" className="ui-button" onClick={() => void saveJiraDraft(false)} disabled={busy || !jiraSummary.trim()}>Simpan Lokal</button>
              {jiraConnectorId && <button type="button" className="ui-button" onClick={() => void saveJiraDraft(true)} disabled={busy || !jiraProject.trim()}>Submit</button>}
            </div>
          </div>
        </Dialog>
      )}

      {restartPreview && (
        <Dialog title="Konfirmasi Restart Non-Produksi" onClose={() => setRestartPreview(null)}>
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold"><ShieldAlert size={14} aria-hidden="true" /> Preview</div>
              <div>{restartPreview.cluster} / {restartPreview.namespace} / {restartPreview.kind}/{restartPreview.workload} ({restartPreview.environment})</div>
              <div className="opacity-90">{restartPreview.impact}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setRestartPreview(null)}>Batal</button>
              <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => void executeRestart()} disabled={busy}>
                <GitBranch size={13} aria-hidden="true" /> Jalankan & Catat Receipt
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
