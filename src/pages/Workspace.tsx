'use client';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FolderGit2, ShieldCheck, Undo2 } from 'lucide-react';
import ArtifactPage from '@/pages/Artifacts';
import ChangePreview from '@/components/ChangePreview';
import ToolboxPanel from '@/components/ToolboxPanel';

interface RepoInfo {
  repoPath: string;
  branch: string;
  head: string;
  dirtyFiles: string[];
}

export default function WorkspacePage({ defaultTab = 'changes' }: { defaultTab?: 'changes' | 'artifacts' | 'toolbox' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const artifactName = searchParams.get('name');
  const initialTab = artifactName
    ? 'artifacts'
    : ((searchParams.get('tab') as 'changes' | 'artifacts' | 'toolbox') || defaultTab);
  const [tab, setTab] = useState<'changes' | 'artifacts' | 'toolbox'>(initialTab);

  const caseId = searchParams.get('caseId') || '';
  const [mode, setMode] = useState<'file' | 'diff'>(searchParams.get('diff') ? 'diff' : 'file');
  const [repoPath, setRepoPath] = useState(searchParams.get('repo') || '');
  const [expectedHead, setExpectedHead] = useState(searchParams.get('rev') || '');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repoError, setRepoError] = useState('');
  const [patchPath, setPatchPath] = useState(searchParams.get('patchPath') || '');
  const [patchContent, setPatchContent] = useState(searchParams.get('patchContent') || '');
  const [diffText, setDiffText] = useState(searchParams.get('diff') || '');
  const [testCommand, setTestCommand] = useState('');
  const [worktreeStatus, setWorktreeStatus] = useState<{
    applicable: boolean;
    touchedFiles?: string[];
    testPassed?: boolean | null;
    testOutput?: string;
    error?: string;
  } | null>(null);
  const [previewBefore, setPreviewBefore] = useState('');
  const [applyResult, setApplyResult] = useState<{
    actualDiff: string;
    undoCommand: string;
    appliedFiles: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (artifactName) setTab('artifacts');
  }, [artifactName]);

  async function inspectRepo() {
    setBusy(true);
    setRepoError('');
    try {
      const res = await fetch('/api/workspace/git/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout Git tidak dapat diakses.');
      setRepoInfo(data);
      if (!expectedHead) setExpectedHead(data.head);
    } catch (err) {
      setRepoInfo(null);
      setRepoError(err instanceof Error ? err.message : 'Backend lokal tidak dapat mengakses checkout.');
    } finally {
      setBusy(false);
    }
  }

  async function previewPatch() {
    setBusy(true);
    setRepoError('');
    try {
      const res = await fetch('/api/workspace/git/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath,
          expectedHead,
          files: [{ path: patchPath, content: patchContent }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview patch gagal.');
      setPreviewBefore(data.files?.[0]?.before ?? '');
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Preview patch gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function runWorktreeCheck() {
    setBusy(true);
    setRepoError('');
    setWorktreeStatus(null);
    try {
      const res = await fetch('/api/workspace/git/worktree-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, expectedHead, diffText, testCommand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Worktree check gagal.');
      setWorktreeStatus(data);
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Worktree check gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function applyPatch() {
    setBusy(true);
    setRepoError('');
    try {
      const endpoint = mode === 'diff' ? '/api/workspace/git/apply-diff' : '/api/workspace/git/apply';
      const payload =
        mode === 'diff'
          ? { repoPath, expectedHead, diffText }
          : { repoPath, expectedHead, files: [{ path: patchPath, content: patchContent }] };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Apply lokal gagal.');
      setApplyResult(data);
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Apply lokal gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function undoPatch() {
    if (!applyResult) return;
    setBusy(true);
    setRepoError('');
    try {
      const res = await fetch('/api/workspace/git/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, paths: applyResult.appliedFiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Undo gagal.');
      setApplyResult(null);
      await inspectRepo();
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : 'Undo gagal.');
    } finally {
      setBusy(false);
    }
  }

  function selectTab(next: 'changes' | 'artifacts' | 'toolbox') {
    setTab(next);
    setSearchParams((prev) => {
      prev.set('tab', next);
      return prev;
    });
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Tab Workspace" className="panel-tabs">
          {([
            ['changes', 'Changes'],
            ['artifacts', 'Artifacts'],
            ['toolbox', 'Toolbox'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="panel-tab text-sm"
              onClick={() => selectTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {caseId && (
          <Link to={`/investigate?caseId=${encodeURIComponent(caseId)}`} className="ui-button text-xs">
            Kembali ke Kasus
          </Link>
        )}
      </div>

      {tab === 'artifacts' && (
        <div className="flex-1 min-h-0">
          <ArtifactPage />
        </div>
      )}

      {tab === 'toolbox' && <ToolboxPanel />}

      {tab === 'changes' && (
        <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 space-y-4 overflow-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FolderGit2 size={16} aria-hidden="true" /> Patch Checkout Lokal
            </div>
            <div className="panel-tabs">
              <button type="button" role="tab" aria-selected={mode === 'file'} className="panel-tab text-xs" onClick={() => setMode('file')}>
                Per File
              </button>
              <button type="button" role="tab" aria-selected={mode === 'diff'} className="panel-tab text-xs" onClick={() => setMode('diff')}>
                Unified Diff (Worktree)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              className="ui-field flex-1 min-w-[260px] font-mono text-xs"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="Path checkout Git lokal (mis. C:\repo\service)"
              aria-label="Path checkout Git lokal"
            />
            <input
              className="ui-field w-44 font-mono text-xs"
              value={expectedHead}
              onChange={(e) => setExpectedHead(e.target.value)}
              placeholder="Revisi HEAD (opsional)"
              aria-label="Revisi HEAD"
            />
            <button type="button" className="ui-button" disabled={busy || !repoPath.trim()} onClick={() => void inspectRepo()}>
              Periksa Checkout
            </button>
          </div>

          {repoError && (
            <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              {repoError}
            </div>
          )}

          {repoInfo && (
            <div className="rounded-xl border border-[var(--ui-border)] p-3 text-xs space-y-1">
              <div><strong>Repo:</strong> <span className="font-mono">{repoInfo.repoPath}</span></div>
              <div><strong>Branch:</strong> {repoInfo.branch} · <strong>HEAD:</strong> <span className="font-mono">{repoInfo.head}</span></div>
              <div><strong>Perubahan lokal:</strong> {repoInfo.dirtyFiles.length ? repoInfo.dirtyFiles.join(', ') : 'bersih'}</div>
            </div>
          )}

          {mode === 'file' ? (
            <div className="space-y-2">
              <input
                className="ui-field w-full font-mono text-xs"
                value={patchPath}
                onChange={(e) => setPatchPath(e.target.value)}
                placeholder="Path relatif file dalam repo (mis. src/handler.ts)"
                aria-label="Path file patch"
              />
              <textarea
                className="ui-field w-full h-40 font-mono text-xs"
                value={patchContent}
                onChange={(e) => setPatchContent(e.target.value)}
                placeholder="Isi file hasil proposal…"
                aria-label="Isi file patch"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-button" disabled={busy || !repoPath.trim() || !patchPath.trim()} onClick={() => void previewPatch()}>
                  Preview Diff
                </button>
                <button type="button" className="ui-button" disabled={busy || !repoPath.trim() || !patchPath.trim()} onClick={() => void applyPatch()}>
                  Apply Lokal
                </button>
              </div>
              {previewBefore !== '' && <ChangePreview before={previewBefore} after={patchContent} />}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                className="ui-field w-full h-44 font-mono text-xs"
                value={diffText}
                onChange={(e) => setDiffText(e.target.value)}
                placeholder="--- a/file.ts&#10;+++ b/file.ts&#10;@@ ..."
                aria-label="Unified diff"
              />
              <input
                className="ui-field w-full font-mono text-xs"
                value={testCommand}
                onChange={(e) => setTestCommand(e.target.value)}
                placeholder="Perintah test opsional (harus terdaftar di Settings → Policies)"
                aria-label="Perintah test worktree"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-button inline-flex items-center gap-1" disabled={busy || !repoPath.trim() || !diffText.trim()} onClick={() => void runWorktreeCheck()}>
                  <ShieldCheck size={14} aria-hidden="true" /> Check Worktree
                </button>
                <button type="button" className="ui-button" disabled={busy || !repoPath.trim() || !diffText.trim()} onClick={() => void applyPatch()}>
                  Apply Diff
                </button>
              </div>
              {worktreeStatus && (
                <div className="rounded-xl border border-[var(--ui-border)] p-3 text-xs space-y-1">
                  <div>
                    <strong>Worktree Check:</strong>{' '}
                    {worktreeStatus.applicable ? 'Bersih (dapat diterapkan)' : `Gagal (${worktreeStatus.error || 'konflik'})`}
                  </div>
                  {worktreeStatus.testPassed !== undefined && worktreeStatus.testPassed !== null && (
                    <div><strong>Test:</strong> {worktreeStatus.testPassed ? 'Lulus' : 'Gagal'}</div>
                  )}
                  {worktreeStatus.testOutput && (
                    <pre className="rounded-lg bg-[var(--ui-hover)] p-2 font-mono max-h-40 overflow-auto">{worktreeStatus.testOutput}</pre>
                  )}
                </div>
              )}
            </div>
          )}

          {applyResult && (
            <div className="rounded-xl border border-[var(--ui-border)] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Diff Aktual Setelah Apply</span>
                <button type="button" className="ui-button inline-flex items-center gap-1" onClick={() => void undoPatch()} disabled={busy}>
                  <Undo2 size={13} aria-hidden="true" /> Undo
                </button>
              </div>
              <div className="font-mono opacity-80">Undo CLI: {applyResult.undoCommand}</div>
              <pre className="rounded-lg bg-[var(--ui-hover)] p-2.5 font-mono max-h-48 overflow-auto">
                {applyResult.actualDiff || '(tidak ada diff)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
