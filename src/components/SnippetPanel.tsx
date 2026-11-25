'use client';
import { useEffect, useState } from 'react';
import Select from '@/components/Select';
interface Snippet { id: string; title: string; kind: string }
const field = 'w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm';
export default function SnippetPanel() {
  const [items, setItems] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState(''); const [title, setTitle] = useState('');
  const [kind, setKind] = useState('credential'); const [content, setContent] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch('/api/snippets'); const data = await response.json();
    if (!response.ok) throw new Error(data.error); setItems(data.snippets);
  }
  useEffect(() => { void load().catch(() => setMessage('Snipet tidak dapat dimuat.')); }, []);
  function close() { setEditing(false); setId(''); setTitle(''); setContent(''); }
  function create() { close(); setKind('credential'); setEditing(true); setMessage(''); }
  async function open(item: Snippet, edit = false) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/snippets?id=${encodeURIComponent(item.id)}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (edit) { setId(data.id); setTitle(data.title); setKind(data.kind); setContent(data.content); setEditing(true); }
      else { await navigator.clipboard.writeText(data.content); setMessage(`${item.title} disalin`); }
    } catch { setMessage('Tidak dapat membuka atau menyalin snipet.'); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/snippets', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id || undefined,title,kind,content}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await load(); close(); setMessage('Tersimpan');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }
  async function remove(item: Snippet) {
    if (!window.confirm(`Hapus ${item.title}?`)) return;
    setBusy(true);
    try { const response = await fetch(`/api/snippets?id=${encodeURIComponent(item.id)}`,{method:'DELETE'}); if (!response.ok) throw new Error(); await load(); if (id === item.id) close(); }
    catch { setMessage('Snipet belum dapat dihapus.'); } finally { setBusy(false); }
  }
  return <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-gray-900 dark:text-gray-100">
    <div className="flex justify-between items-center"><span className="text-xs text-gray-500">{items.length} tersimpan</span><button type="button" disabled={busy} onClick={create} className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600">Tambah baru</button></div>
    <div className="overflow-auto space-y-1 flex-1 min-h-0">{items.map(item => <div key={item.id} className="group flex items-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
      <button type="button" disabled={busy} onClick={() => void open(item)} aria-label={`Salin ${item.title}`} className="min-w-0 flex-1 p-3 text-left"><span className="block truncate text-sm">{item.title}</span><span className="text-xs text-gray-500">{item.kind === 'credential' ? 'Kredensial' : item.kind === 'script' ? 'Skrip' : 'Path'}</span></button>
      <button type="button" disabled={busy} onClick={() => void open(item,true)} aria-label={`Edit ${item.title}`} className="px-2.5 py-1.5 text-xs text-gray-500">Edit</button><button type="button" disabled={busy} onClick={() => void remove(item)} aria-label={`Hapus ${item.title}`} className="px-2.5 py-1.5 text-xs text-red-400">Hapus</button>
    </div>)}{!items.length && !editing && <p className="text-xs text-gray-500 p-3">Belum ada snipet.</p>}</div>
    {editing && <form onSubmit={save} className="flex flex-col gap-3 border-t border-gray-200 dark:border-gray-700 pt-3">
      <input autoFocus aria-label="Judul snipet" className={field} value={title} maxLength={100} onChange={event=>setTitle(event.target.value)} placeholder="Judul" required />
      <Select aria-label="Jenis snipet" className={field} value={kind} onChange={event=>setKind(event.target.value)}><option value="credential">Kredensial</option><option value="path">Path</option><option value="script">Skrip</option></Select>
      <textarea aria-label="Isi snipet" className={`${field} h-40 resize-y font-mono`} value={content} onChange={event=>setContent(event.target.value)} maxLength={64000} placeholder="Isi" required />
      <div className="flex gap-2"><button disabled={busy || !title.trim() || !content} type="submit" className="bg-blue-600 text-white px-3 py-2 text-xs disabled:opacity-40">Simpan</button><button type="button" onClick={close} className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600">Batal</button></div>
    </form>}
    <p role="status" className="text-xs text-gray-500 min-h-4">{message}</p>
  </div>;
}