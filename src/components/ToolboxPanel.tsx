'use client';
import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import ChangePreview from '@/components/ChangePreview';
import { decodeJwtOffline, filterLinesWithRegex, formatJsonText } from '@/lib/toolbox/utils';

export default function ToolboxPanel() {
  const [tool, setTool] = useState<'json' | 'jwt' | 'regex' | 'diff'>('json');
  const [jsonIn, setJsonIn] = useState('');
  const [jwtIn, setJwtIn] = useState('');
  const [regexPat, setRegexPat] = useState('');
  const [regexText, setRegexText] = useState('');
  const [diffBefore, setDiffBefore] = useState('');
  const [diffAfter, setDiffAfter] = useState('');
  const [copied, setCopied] = useState(false);

  const jsonResult = useMemo(() => formatJsonText(jsonIn), [jsonIn]);
  const jwtResult = useMemo(() => (jwtIn.trim() ? decodeJwtOffline(jwtIn) : {}), [jwtIn]);
  const regexResult = useMemo(() => filterLinesWithRegex(regexText, regexPat), [regexText, regexPat]);

  function copyOutput(text: string) {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 space-y-3 overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Offline Toolbox" className="panel-tabs">
          {([
            ['json', 'JSON'],
            ['jwt', 'JWT'],
            ['regex', 'Regex'],
            ['diff', 'Diff'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tool === id}
              className="panel-tab text-xs"
              onClick={() => setTool(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] opacity-65">Offline · Zero network</span>
      </div>

      {tool === 'json' && (
        <div className="grid gap-3 md:grid-cols-2 text-xs">
          <textarea
            className="ui-field h-72 font-mono"
            value={jsonIn}
            onChange={(e) => setJsonIn(e.target.value)}
            placeholder="Tempel JSON atau nested JSON string…"
            aria-label="Input JSON"
          />
          <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between">
              <span className={jsonResult.error ? 'text-red-500' : 'opacity-70'}>
                {jsonResult.error || 'Hasil format'}
              </span>
              <button
                type="button"
                className="ui-button inline-flex items-center gap-1"
                onClick={() => copyOutput(jsonResult.output)}
              >
                <Copy size={12} aria-hidden="true" /> {copied ? 'Tersalin' : 'Salin'}
              </button>
            </div>
            <pre className="h-64 overflow-auto rounded-xl border border-[var(--ui-border)] bg-[var(--ui-hover)] p-3 font-mono whitespace-pre-wrap">
              {jsonResult.output}
            </pre>
          </div>
        </div>
      )}

      {tool === 'jwt' && (
        <div className="space-y-3 text-xs">
          <textarea
            className="ui-field w-full h-24 font-mono"
            value={jwtIn}
            onChange={(e) => setJwtIn(e.target.value)}
            placeholder="Tempel JWT (header.payload.signature)…"
            aria-label="Input JWT"
          />
          {jwtResult.error && <p className="text-red-500">{jwtResult.error}</p>}
          {(jwtResult.header || jwtResult.payload) && (
            <div className="grid gap-3 md:grid-cols-2">
              <pre className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-hover)] p-3 font-mono overflow-auto max-h-60">
                {JSON.stringify(jwtResult.header, null, 2)}
              </pre>
              <pre className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-hover)] p-3 font-mono overflow-auto max-h-60">
                {JSON.stringify(jwtResult.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {tool === 'regex' && (
        <div className="space-y-2.5 text-xs">
          <input
            className="ui-field w-full font-mono"
            value={regexPat}
            onChange={(e) => setRegexPat(e.target.value)}
            placeholder="Pola regex (contoh: ERROR|timeout|Bearer\s+\S+)"
            aria-label="Pola regex"
          />
          {regexResult.error && <p className="text-red-500">{regexResult.error}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <textarea
              className="ui-field h-60 font-mono"
              value={regexText}
              onChange={(e) => setRegexText(e.target.value)}
              placeholder="Tempel baris log…"
              aria-label="Log untuk filter regex"
            />
            <pre className="h-60 overflow-auto rounded-xl border border-[var(--ui-border)] bg-[var(--ui-hover)] p-3 font-mono whitespace-pre-wrap">
              {regexResult.matches.join('\n')}
            </pre>
          </div>
        </div>
      )}

      {tool === 'diff' && (
        <div className="space-y-3 text-xs">
          <div className="grid gap-3 md:grid-cols-2">
            <textarea
              className="ui-field h-36 font-mono"
              value={diffBefore}
              onChange={(e) => setDiffBefore(e.target.value)}
              placeholder="Teks sebelum…"
              aria-label="Teks sebelum"
            />
            <textarea
              className="ui-field h-36 font-mono"
              value={diffAfter}
              onChange={(e) => setDiffAfter(e.target.value)}
              placeholder="Teks sesudah…"
              aria-label="Teks sesudah"
            />
          </div>
          <ChangePreview before={diffBefore} after={diffAfter} />
        </div>
      )}
    </div>
  );
}
