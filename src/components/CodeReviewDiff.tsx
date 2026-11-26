import { useMemo, useState, type RefObject } from 'react';
import { FileCode2, MessageSquare, Sparkles } from 'lucide-react';
import MarkdownOutput from '@/components/MarkdownOutput';
import { currentAnchor, lineOn, parseDiff, selectLine, type DiffSide, type FileChange, type LineRange, type ReviewComment } from '@/lib/code-review/model';

const INITIAL_ROWS = 160;

export function diffLineId(side: DiffSide, line: number) {
  return 'review-line-' + side + '-' + line;
}

export function DiffCount({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className="inline-flex gap-2 font-mono text-xs whitespace-nowrap">
    <span className="review-positive" aria-label={additions + ' penambahan'}>+{additions}</span>
    <span className="review-negative" aria-label={deletions + ' penghapusan'}>−{deletions}</span>
  </span>;
}

export function ReviewFileList({ files, selected, onSelect }: {
  files: FileChange[]; selected?: string; onSelect: (file: FileChange) => void;
}) {
  return <ul className="review-file-list">
    {files.map(file => <li key={file.path}>
      <button type="button" className="review-file-button" aria-current={selected === file.path ? 'true' : undefined} onClick={() => onSelect(file)}>
        <FileCode2 size={15} className="shrink-0 review-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 break-all text-left font-mono">{file.path}</span>
        {file.patchStatus !== 'not_loaded' && <DiffCount additions={file.additions} deletions={file.deletions} />}
      </button>
    </li>)}
  </ul>;
}

function Comment({ comment, outdated = false }: { comment: ReviewComment; outdated?: boolean }) {
  return <div className="review-diff-comment">
    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs">
      <MessageSquare size={14} aria-hidden="true" />
      <strong>{comment.login}</strong>
      {comment.startLine && comment.startSide && comment.startSide === comment.side && <span>Baris {comment.startLine}–{comment.line}</span>}
      {outdated && <span className="review-pill">Revisi lama · {comment.originalRevision.slice(0, 8) || comment.revision.slice(0, 8) || 'tidak diketahui'}</span>}
    </p>
    <MarkdownOutput content={comment.body} downloadable={false} />
  </div>;
}

export default function CodeReviewDiff({ file, head, comments, range, jump, canAsk, askButton, onRange, onAsk }: {
  file: FileChange; head: string; comments: ReviewComment[]; range: LineRange | null; canAsk: boolean;
  jump: LineRange | null;
  askButton: RefObject<HTMLButtonElement>; onRange: (range: LineRange) => void; onAsk: () => void;
}) {
  const rows = useMemo(() => parseDiff(file.patch ?? ''), [file.patch]);
  const [limit, setLimit] = useState(INITIAL_ROWS);
  const visible = jump ? Math.max(limit, rows.findIndex(row => lineOn(row, jump.side) === jump.start) + 1) : limit;
  const current = comments.filter(comment => currentAnchor(comment, file.path, head, file.comparisonBase));
  const currentByLine = new Map<string, ReviewComment[]>();
  const lineIds = new Set(rows.flatMap(row => [
    ...(row.old === undefined ? [] : [diffLineId('left', row.old)]),
    ...(row.new === undefined ? [] : [diffLineId('right', row.new)]),
  ]));
  const unplaced = comments.filter(comment => comment.path === file.path &&
    (!currentAnchor(comment, file.path, head, file.comparisonBase) || !lineIds.has(diffLineId(comment.side!, comment.line!))));
  for (const comment of current) {
    const key = diffLineId(comment.side!, comment.line!);
    currentByLine.set(key, [...(currentByLine.get(key) ?? []), comment]);
  }

  return <section className="review-card overflow-hidden" aria-label="Unified diff">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--ui-border)] p-3">
      <div className="min-w-0 flex-1">
        <h3 className="break-all font-mono text-sm font-semibold">{file.path}</h3>
        {file.previousPath && <p className="review-muted mt-1 break-all text-xs">Nama sebelumnya · {file.previousPath}</p>}
      </div>
      <DiffCount additions={file.additions} deletions={file.deletions} />
    </div>
    {!rows.length ? <p className="p-3 review-muted text-sm">
      {file.patchStatus === 'binary' ? 'File biner. Diff teks tidak tersedia.' :
        file.previousPath && !file.additions && !file.deletions ? 'Nama file berubah tanpa patch teks.' :
          'Patch teks tidak tersedia dari penyedia SCM. File bisa berupa biner, terlalu besar, atau tanpa perubahan teks.'}
    </p> : <>
      <div className="review-diff-tools">
        <p className="text-xs review-muted">{range
          ? (range.side === 'left' ? 'Baris lama ' : 'Baris baru ') + range.start + (range.end === range.start ? '' : '–' + range.end)
          : 'Pilih nomor baris. Gunakan Shift untuk memilih rentang.'}</p>
        <button ref={askButton} type="button" className="ui-button" disabled={!range || !canAsk} onClick={onAsk}>
          <Sparkles size={14} aria-hidden="true" /> Ask AI
        </button>
      </div>
      {file.patchStatus === 'truncated' && <p className="review-note m-3" role="status">Patch terpotong. Hanya baris yang tersedia ditampilkan.</p>}
      <div className="review-diff-scroll" tabIndex={0} aria-label="Kode diff, dapat digulir horizontal">
        {rows.slice(0, visible).map((row, index) => <div key={index}>
          {row.kind === 'hunk' ? <div className="review-hunk">{row.text}</div> : <>
            <div className="review-diff-row" data-kind={row.kind}>
              {(['left', 'right'] as const).map(side => {
                const line = lineOn(row, side);
                if (line === undefined) return <span key={side} aria-hidden="true" />;
                const pressed = !!range && range.side === side && line >= range.start && line <= range.end;
                return <button key={side} type="button" className="review-gutter" id={diffLineId(side, line)}
                  aria-label={(side === 'left' ? 'Baris lama ' : 'Baris baru ') + line}
                  aria-pressed={pressed} onClick={event => onRange(selectLine(rows, range, side, line, event.shiftKey))}>{line}</button>;
              })}
              <code>{row.text}</code>
            </div>
            {[...(row.old === undefined ? [] : currentByLine.get(diffLineId('left', row.old)) ?? []),
              ...(row.new === undefined ? [] : currentByLine.get(diffLineId('right', row.new)) ?? [])].map(comment =>
                <Comment key={comment.id} comment={comment} />)}
          </>}
        </div>)}
      </div>
      {rows.length > visible && <button type="button" className="ui-button m-3" onClick={() => setLimit(visible + INITIAL_ROWS)}>Tampilkan baris berikutnya</button>}
    </>}
    {unplaced.length > 0 && <details className="m-3">
      <summary className="cursor-pointer text-sm font-medium">Komentar tanpa jangkar di patch ini ({unplaced.length})</summary>
      {unplaced.map(comment => <Comment key={comment.id} comment={comment}
        outdated={comment.revision !== head || (!!comment.comparisonBase && comment.comparisonBase !== file.comparisonBase) || (!!comment.originalRevision && comment.originalRevision !== head)} />)}
    </details>}
  </section>;
}
