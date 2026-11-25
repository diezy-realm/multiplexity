'use client';
import { useState, type ReactNode, type ReactElement, isValidElement } from 'react';
import ActionIcon from './ActionIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function codeText(node: ReactNode): string { return typeof node === 'string' ? node : Array.isArray(node) ? node.map(codeText).join('') : isValidElement(node) ? codeText((node as ReactElement<{children?: ReactNode}>).props.children) : ''; }
function CodeBlock({ children }: {children?: ReactNode}) {
  const [status, setStatus] = useState('');
  return <div className="relative"><button type="button" aria-label="Copy code" title={status || 'Copy code'} className="icon-action absolute right-2 top-2 bg-gray-200 dark:bg-gray-700" onClick={async()=>{try { await navigator.clipboard.writeText(codeText(children)); setStatus('Disalin'); } catch { setStatus('Clipboard tidak tersedia'); }}}><ActionIcon name="copy" /></button><pre className="pr-14">{children}</pre><span role="status" className="sr-only">{status}</span></div>;
}
function CopyOutput({ content }: {content:string}) {
 const [status,setStatus]=useState(''); return <><button type="button" aria-label="Copy response" title={status || 'Copy'} className="icon-action" onClick={async()=>{try {await navigator.clipboard.writeText(content);setStatus('Disalin');}catch {setStatus('Clipboard tidak tersedia');}}}><ActionIcon name="copy" /></button><span role="status" className="sr-only">{status}</span></>;
}
export default function MarkdownOutput({ content, filename = 'analysis.md', downloadable = true, timestamp, pending = false }: { content: string; filename?: string; downloadable?: boolean; timestamp?: string; pending?:boolean }) {
  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="min-w-0"><div className="markdown-output"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="text-xs opacity-70">{alt || 'Gambar'}</span> }}>{content}</ReactMarkdown></div>{downloadable && !pending && <div className="response-actions mt-3 flex items-center gap-1 text-gray-500"><button type="button" onClick={download} className="icon-action" aria-label="Unduh Markdown"><ActionIcon name="download" /></button><CopyOutput content={content} />{timestamp && <span title={new Date(timestamp).toLocaleString()} className="inline-flex items-center gap-1 text-xs"><ActionIcon name="clock" />{new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}</div>}</div>;
}
