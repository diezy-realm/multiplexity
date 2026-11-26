'use client';
import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';
import AIRunPanel from './AIRunPanel';
import { useChatReveal } from '@/hooks/useChatReveal';
import { readChatResponse } from '@/lib/ai/chat-stream-client';
import type { ProgressStage } from '@/lib/ai/stream-events';
import type { RunStep } from './RunTimeline';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  logText: string;
}

export default function AIAnalyzeModal({ isOpen, onClose, logText }: Props) {
  const [prompt, setPrompt] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [artifact, setArtifact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<ProgressStage>('connecting');
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [preview, setPreview] = useState<{ provider: string; model: string; payload: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const reveal = useChatReveal();

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!isOpen) {
      controller.current?.abort();
      setPreview(null);
    }
  }, [isOpen]);

  async function requestPreview() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/ai/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logText,
          prompt: prompt.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyiapkan preview.');
      setPreview({
        provider: data.destination?.provider || 'default',
        model: data.destination?.model || '',
        payload: data.redactedPayload || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setPreview(null);
    setBusy(true);
    setAnalysis('');
    setArtifact('');
    setError('');
    setSteps([]);
    reveal.reset();
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ logText, prompt: prompt.trim() || undefined }),
      });
      const data = await readChatResponse(response, (event) => {
        if (event.type === 'delta') reveal.append(event.text);
        else {
          setStage(event.stage);
          setSteps((previous) =>
            [...previous, { stage: event.stage, at: new Date().toISOString() }].slice(-100),
          );
        }
      });
      await reveal.finish(data.message);
      setAnalysis(data.message);
      setArtifact(data.artifact || '');
    } catch (err) {
      setError(
        abort.signal.aborted
          ? 'Dihentikan.'
          : err instanceof Error
            ? err.message
            : 'Analisis gagal.',
      );
    } finally {
      setBusy(false);
      reveal.reset();
      controller.current = null;
    }
  }

  if (!isOpen) return null;

  return (
    <Dialog
      title="AI Log Analysis"
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        <label className="block text-sm">
          Log ({logText.length} chars)
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-100 dark:bg-gray-900 p-3 text-xs">
            {logText.slice(0, 2000)}
            {logText.length > 2000 ? '\n…' : ''}
          </pre>
        </label>
        <textarea
          aria-label="Prompt analisis"
          rows={2}
          className="ui-field w-full"
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Apa yang ingin diperiksa?"
        />
        <div className="flex flex-wrap gap-2">
          {['Apa penyebab error ini?', 'Berikan solusi', 'Jelaskan log ini'].map((item) => (
            <button
              type="button"
              disabled={busy}
              className="ui-button"
              key={item}
              onClick={() => setPrompt(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {preview ? (
          <div className="rounded-xl border border-[var(--ui-border)] p-3 space-y-2 text-xs">
            <div className="font-semibold">
              Preview Teredaksi → {preview.provider} {preview.model ? `(${preview.model})` : ''}
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--ui-hover)] p-2 font-mono">
              {preview.payload}
            </pre>
            <div className="flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setPreview(null)}>
                Batal
              </button>
              <button type="button" className="ui-button" onClick={() => void analyze()}>
                Kirim ke Provider
              </button>
            </div>
          </div>
        ) : busy ? (
          <button
            type="button"
            className="ui-button"
            onClick={() => {
              controller.current?.abort();
              reveal.reset();
            }}
          >
            Hentikan respons
          </button>
        ) : (
          <button type="button" className="ui-button" onClick={() => void requestPreview()}>
            {error ? 'Preview Ulang' : 'Preview & Analisis'}
          </button>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <AIRunPanel text={busy ? reveal.text : analysis} busy={busy} stage={stage} steps={steps} />
        {artifact && (
          <a className="ui-button" href={'/artifacts?name=' + encodeURIComponent(artifact)}>
            Buka hasil ↗
          </a>
        )}
      </div>
    </Dialog>
  );
}
