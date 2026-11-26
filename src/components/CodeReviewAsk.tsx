import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, LocateFixed, Sparkles, X } from 'lucide-react';
import MarkdownOutput from '@/components/MarkdownOutput';
import { readChatResponse } from '@/lib/ai/chat-stream-client';
import { pullKey, reviewJson, type Preview, type ReviewContext } from '@/lib/code-review/model';

export default function CodeReviewAsk({ context, stale, disabled, onClose, onJump }: {
  context: ReviewContext; stale: boolean; disabled: boolean; onClose: () => void; onJump: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | null>(null);
  const headingId = useId();
  const [question, setQuestion] = useState('Jelaskan dampak perubahan pada baris yang dipilih.');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ message: string; preview: Preview } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'analysis' | null>(null);
  const [saving, setSaving] = useState(false);
  const [artifact, setArtifact] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    heading.current?.focus();
    return () => controller.current?.abort();
  }, []);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (stale) {
      controller.current?.abort();
      setBusy(null);
    }
  }, [stale]);

  async function getPreview(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy || disabled || stale) return;
    const request = new AbortController();
    controller.current = request;
    setBusy('preview');
    setPreview(null);
    setResult(null);
    setArtifact('');
    setMessage('');
    setError('');
    try {
      const data = await reviewJson<Preview>('/api/scm/review/preview', request.signal, { ...context, question });
      if (!request.signal.aborted) setPreview(data);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Preview tidak tersedia.');
    } finally {
      if (controller.current === request) setBusy(null);
    }
  }

  async function analyze() {
    if (!preview || busy || stale || disabled) return;
    const request = new AbortController();
    controller.current = request;
    const approved = preview;
    setBusy('analysis');
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const response = await fetch('/api/scm/review/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: approved.id }), signal: request.signal,
      });
      const answer = await readChatResponse(response, () => {});
      if (!request.signal.aborted) setResult({ message: answer.message, preview: approved });
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Analisis gagal.');
    } finally {
      if (controller.current === request) setBusy(null);
    }
  }

  function cancel() {
    controller.current?.abort();
    setBusy(null);
    setPreview(null);
    setMessage('Dibatalkan.');
  }

  async function saveArtifact() {
    if (!result || saving || stale || disabled || artifact) return;
    setSaving(true);
    setError('');
    const source = result.preview.source;
    const name = 'artifacts/code-review-' + source.reference.number + '-' + result.preview.id + '.md';
    const destination = result.preview.destination;
    const content = [
      '# Code Review · ' + pullKey(source.reference), '',
      '- Profil · ' + source.provider + ' / ' + source.profileId,
      '- Bukti diambil · ' + source.fetchedAt,
      '- Head SHA · ' + source.headSha,
      '- Base SHA · ' + source.baseSha,
      ...(source.comparisonBase ? ['- Diff base SHA · ' + source.comparisonBase] : []),
      '- Sumber · ' + source.path + ' · ' + source.side + ' ' + source.start + '–' + source.end,
      '- Provider · ' + destination.provider + ' / ' + destination.model, '',
      '## Analisis', '', result.message, '',
    ].join('\n');
    try {
      await reviewJson('/api/artifacts', undefined, { name, content });
      setArtifact(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Artifact gagal disimpan.');
    } finally {
      setSaving(false);
    }
  }

  return <aside aria-labelledby={headingId} className="review-card review-ask space-y-3 p-4">
    <div className="flex items-center justify-between gap-2">
      <h3 ref={heading} tabIndex={-1} id={headingId} className="flex items-center gap-2 font-semibold">
        <Sparkles size={17} aria-hidden="true" /> Ask AI
      </h3>
      <button type="button" className="icon-action" aria-label="Tutup Ask AI" onClick={onClose}><X size={17} aria-hidden="true" /></button>
    </div>
    <div aria-label="Konteks sumber" className="flex flex-wrap gap-1.5 text-xs">
      <span className="review-pill">{context.reference.repo} #{context.reference.number}</span>
      <span className="review-pill font-mono break-all" title={context.headSha}>Head {context.headSha.slice(0, 10)}</span>
      <span className="review-pill font-mono break-all">{context.path}</span>
      <span className="review-pill">{context.side === 'left' ? 'Baris lama' : 'Baris baru'} {context.start}{context.end !== context.start && '–' + context.end}</span>
    </div>
    {stale && <p role="status" className="review-note">Konteks basi karena revisi PR berubah. Pilih kembali baris pada revisi terbaru.</p>}
    {disabled && !stale && <p className="review-note">Muat ulang PR hingga revisi aktif dapat diverifikasi sebelum mengirim bukti.</p>}
    {!stale && <button type="button" className="ui-button" onClick={onJump}>
      <LocateFixed size={14} aria-hidden="true" /> Ke baris sumber
    </button>}
    <form className="space-y-2" onSubmit={getPreview}>
      <label className="block text-sm">
        Pertanyaan
        <textarea className="ui-field mt-1 w-full resize-y" rows={3} maxLength={800} required value={question}
          disabled={!!busy || stale}
          onChange={event => { setQuestion(event.target.value); setPreview(null); setMessage(''); }} />
      </label>
      <button className="ui-button" type="submit" disabled={!question.trim() || !!busy || stale || disabled}>Tinjau bukti</button>
    </form>
    {busy && <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-sm">{busy === 'preview' ? 'Menyiapkan bukti…' : 'Analisis berjalan…'}</p>
      <button type="button" className="ui-button" onClick={cancel}>Batalkan</button>
    </div>}
    {preview && <section className="review-well space-y-2 p-3">
      <h4 ref={previewHeading} tabIndex={-1} className="text-sm font-semibold">Preview pengiriman</h4>
      <p className="text-sm">{preview.destination.provider} · {preview.destination.model}</p>
      {preview.destination.endpoint && <p className="review-muted break-all font-mono text-xs">{preview.destination.endpoint}</p>}
      <pre className="review-source" aria-label="Payload teredaksi">{preview.payload}</pre>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-button" disabled={stale || disabled} onClick={() => void analyze()}>
          {context.fixture ? 'Jalankan simulasi' : 'Kirim bukti'}
        </button>
        <button type="button" className="ui-button" onClick={cancel}>Batal</button>
      </div>
    </section>}
    {error && <div role="alert" className="review-note space-y-2">
      <p>{error}</p>
      {error.includes('AI Management') && <Link className="ui-button" to="/settings?section=ai">Buka AI Management</Link>}
    </div>}
    {result && <section className="review-well space-y-3 p-3" aria-label="Analisis AI">
      <h4 className="font-semibold">Analisis</h4>
      <MarkdownOutput content={result.message} downloadable={false} />
      <details>
        <summary className="cursor-pointer text-sm">Sumber yang ditinjau</summary>
        <pre className="review-source mt-2">{result.preview.payload}</pre>
      </details>
      {artifact ? <Link to={'/artifacts?name=' + encodeURIComponent(artifact)} className="ui-button">Buka Artifact</Link> :
        <button type="button" className="ui-button" disabled={saving || stale || disabled} onClick={() => void saveArtifact()}>
          <Bookmark size={14} aria-hidden="true" /> Simpan sebagai Artifact
        </button>}
    </section>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </aside>;
}
