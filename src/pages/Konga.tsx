'use client';
import { ArrowUpRight } from 'lucide-react';
import ConfirmDialog,{type Confirmation} from '@/components/ConfirmDialog';
import { PageActions } from '@/components/PageHeader';

import { useCallback, useEffect, useState } from 'react';
import Select from '@/components/Select';
import Dialog from '@/components/Dialog';
type Entity = 'services' | 'routes';
interface Item { id: string; name?: string; protocol?: string; host?: string; port?: number; path?: string; paths?: string[]; hosts?: string[]; strip_path?: boolean; preserve_host?: boolean; service?: {id:string} }
const field = 'w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm';
const button = 'border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-xs disabled:opacity-40';
export default function KongaPage() {
  const [entity,setEntity] = useState<Entity>('services'); const [items,setItems] = useState<Item[]>([]); const [services,setServices] = useState<Item[]>([]);
  const [confirmation,setConfirmation]=useState<Confirmation>();
  const [adminUrl,setAdminUrl] = useState(''); const [token,setToken] = useState(''); const [hasToken,setHasToken] = useState(false); const [clearToken,setClearToken] = useState(false); const [connected,setConnected] = useState(false); const [connectionOpen,setConnectionOpen] = useState(false);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(''); const [offset,setOffset] = useState<string | null>(null);
  const [editing,setEditing] = useState(false); const [id,setId] = useState(''); const [name,setName] = useState(''); const [upstream,setUpstream] = useState(''); const [serviceId,setServiceId] = useState(''); const [paths,setPaths] = useState(''); const [hosts,setHosts] = useState(''); const [stripPath,setStripPath] = useState(true); const [preserveHost,setPreserveHost] = useState(false);
  const [search,setSearch] = useState('');
  const read = useCallback(async (type: Entity, next?: string) => {
    const response = await fetch(`/api/konga?entity=${type}${next ? `&offset=${encodeURIComponent(next)}` : ''}`); const data = await response.json(); if (!response.ok) throw new Error(data.error);
    return data as {data:Item[];offset:string | null};
  }, []);
  const load = useCallback(async () => {
    setBusy(true); setMessage('');
    try { const data = await read(entity); setItems(data.data); setOffset(data.offset); if (entity === 'services') setServices(data.data); }
    catch (error) { setItems([]); setMessage(error instanceof Error ? error.message : 'Gagal memuat.'); } finally { setBusy(false); }
  }, [entity,read]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/konga?entity=connection',{signal:abort.signal}).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setAdminUrl(data.adminUrl); setHasToken(data.hasToken); setConnected(data.connected); setConnectionOpen(!data.connected); }).catch(error=>{if (!abort.signal.aborted) setMessage(error.message);});
    const query = new URLSearchParams(window.location.search); if (query.get('name')) { setName(query.get('name')!.replace(/[^a-zA-Z0-9._~-]/g,'-')); setUpstream(query.get('upstream') || ''); setEditing(true); }
    return () => abort.abort();
  }, []);
  useEffect(() => { if (connected) void load(); }, [connected,load]);
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(''); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Permintaan gagal.'); } finally { setBusy(false); } }
  async function connect() {
    const response = await fetch('/api/konga',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUrl,token,clearToken})}); const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setToken(''); setHasToken(!!token || hasToken && !clearToken); setClearToken(false); setConnected(true); setConnectionOpen(false); setMessage(`Kong ${data.version}`); await load();
  }
  async function edit(item?: Item) {
    setId(item?.id || ''); setName(item?.name || ''); setUpstream(item ? `${item.protocol || 'http'}://${item.host}:${item.port}${item.path || ''}` : ''); setServiceId(item?.service?.id || ''); setPaths(item?.paths?.join('\n') || ''); setHosts(item?.hosts?.join('\n') || ''); setStripPath(item?.strip_path ?? true); setPreserveHost(item?.preserve_host ?? false); setEditing(true);
    if (entity === 'routes') await run(async () => { let next: string | undefined; const all: Item[] = []; do { const result = await read('services',next); all.push(...result.data); next = result.offset || undefined; } while (next && all.length < 1000); setServices(all); });
  }
  async function save() {
    const lines = (value: string) => value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
    const data = entity === 'services' ? {name,url:upstream} : {name,serviceId,paths:lines(paths),hosts:lines(hosts),strip_path:stripPath,preserve_host:preserveHost};
    const response = await fetch('/api/konga',{method:id ? 'PATCH' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity,id,data})}); const result = await response.json(); if (!response.ok) throw new Error(result.error); setEditing(false); await load();
  }
  function remove(item:Item){
    setConfirmation({title:'Hapus '+(entity==='services'?'service':'route'),target:item.name||item.id,description:'Hapus konfigurasi ini dari gateway?',action:async()=>{const response=await fetch('/api/konga',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity,id:item.id})});const data=await response.json();if(!response.ok)throw new Error(data.error);await load();}});
  }
  return <div className="mx-auto max-w-6xl space-y-5">{confirmation&&<ConfirmDialog confirmation={confirmation} onClose={()=>setConfirmation(undefined)}/>}<PageActions><div className="flex gap-2"><a href="http://172.18.136.92/" target="_blank" rel="noopener noreferrer" className={`${button} inline-flex items-center gap-1`}>Buka Konga <ArrowUpRight aria-hidden="true" size={13} /></a><button type="button" className={button} onClick={()=>setConnectionOpen(value=>!value)}>Koneksi</button><button type="button" className={button} disabled={busy || !connected} onClick={()=>void load()}>Refresh</button></div></PageActions>
    {connectionOpen && <form onSubmit={event=>{event.preventDefault();void run(connect);}} className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 grid gap-3 max-w-xl"><label className="text-sm">Kong Admin URL<input aria-label="Kong Admin URL" type="url" required className={`${field} mt-1`} value={adminUrl} onChange={event=>setAdminUrl(event.target.value)} placeholder="http://host:8001" /></label><label className="text-sm">Admin token<input aria-label="Kong Admin token" type="password" autoComplete="off" className={`${field} mt-1`} value={token} onChange={event=>setToken(event.target.value)} placeholder={hasToken ? 'Tersimpan' : 'Opsional'} /></label>{hasToken && <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={clearToken} onChange={event=>setClearToken(event.target.checked)} />Hapus token tersimpan</label>}<button type="submit" disabled={busy} className={`${button} justify-self-start bg-blue-600 text-white`}>Hubungkan</button><p className="text-xs text-gray-500">Gunakan Admin URL dari Connections Konga.</p></form>}
    <div className="flex flex-wrap gap-3 items-center"><div className="flex rounded-xl border border-gray-200 dark:border-gray-700 p-1 gap-1">{(['services','routes'] as const).map(type=><button type="button" key={type} onClick={()=>{setEntity(type);setSearch('');}} className={`px-4 py-2 text-sm ${entity===type ? 'bg-gray-200 dark:bg-gray-700' : ''}`}>{type === 'services' ? 'Services' : 'Routes'}</button>)}</div><input aria-label="Cari gateway" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Cari…" className={`${field} max-w-xs`} /><button type="button" disabled={!connected || busy} onClick={()=>void edit()} className={`${button} ml-auto bg-blue-600 text-white`}>Tambah {entity === 'services' ? 'service' : 'route'}</button></div>
    <p role="status" className="text-sm text-gray-500">{busy ? 'Memuat…' : message}</p>
    <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">{items.filter(item=>JSON.stringify([item.name,item.host,item.paths,item.hosts]).toLowerCase().includes(search.toLowerCase())).map(item=><div key={item.id} className="flex gap-3 p-4 items-center hover:bg-gray-50 dark:hover:bg-gray-800"><div className="flex-1 min-w-0"><h2 className="text-sm font-medium truncate">{item.name || item.id}</h2><p className="text-xs text-gray-500 font-mono break-all mt-1">{entity === 'services' ? `${item.protocol}://${item.host}:${item.port}${item.path || ''}` : [...item.paths || [],...item.hosts || []].join(' · ')}</p></div><button type="button" disabled={busy} onClick={()=>void edit(item)} className={button}>Edit</button><button type="button" disabled={busy} onClick={()=>void remove(item)} className={`${button} text-red-500`}>Hapus</button></div>)}{!items.length && <p className="p-8 text-sm text-gray-500">{connected ? 'Belum ada data.' : 'Hubungkan Kong Admin API.'}</p>}</div>
    {offset && <button type="button" disabled={busy} className={button} onClick={()=>void run(async()=>{const data=await read(entity,offset);setItems(previous=>[...previous,...data.data]);setOffset(data.offset);})}>Muat lagi</button>}
    {editing && <Dialog title={`${id ? 'Edit' : 'Tambah'} ${entity === 'services' ? 'service' : 'route'}`} onClose={()=>{if(!busy)setEditing(false);}}><form onSubmit={event=>{event.preventDefault();void run(save);}} className="space-y-4"><label className="block text-sm">Nama<input aria-label="Nama gateway" required value={name} onChange={event=>setName(event.target.value)} className={`${field} mt-1`} /></label>{entity === 'services' ? <label className="block text-sm">Upstream URL<input aria-label="Upstream URL" type="url" required value={upstream} onChange={event=>setUpstream(event.target.value)} className={`${field} mt-1`} placeholder="http://host:port" /></label> : <><label className="block text-sm">Service<Select aria-label="Route service" value={serviceId} onChange={event=>setServiceId(event.target.value)} className={`${field} mt-1`} required><option value="">Pilih service</option>{services.map(service=><option key={service.id} value={service.id}>{service.name || service.id}</option>)}</Select></label><label className="block text-sm">Paths<textarea aria-label="Route paths" value={paths} onChange={event=>setPaths(event.target.value)} className={`${field} mt-1`} placeholder="/api/example" /></label><label className="block text-sm">Hosts<textarea aria-label="Route hosts" value={hosts} onChange={event=>setHosts(event.target.value)} className={`${field} mt-1`} placeholder="api.example.com" /></label><div className="flex gap-4 text-xs"><label><input type="checkbox" checked={stripPath} onChange={event=>setStripPath(event.target.checked)} /> Strip path</label><label><input type="checkbox" checked={preserveHost} onChange={event=>setPreserveHost(event.target.checked)} /> Preserve host</label></div></>}{message && <p role="alert" className="text-sm text-red-400">{message}</p>}<button type="submit" disabled={busy} className={`${button} bg-blue-600 text-white`}>{busy ? 'Menyimpan…' : 'Simpan'}</button></form></Dialog>}
  </div>;
}
