'use client';
import { PageActions } from '@/components/PageHeader';
import { readChatResponse } from '@/lib/ai/chat-stream-client';
import { useChatReveal } from '@/hooks/useChatReveal';
import AIRunPanel from './AIRunPanel';
import ConfirmDialog,{type Confirmation} from './ConfirmDialog';
import type { ProgressStage } from '@/lib/ai/stream-events';

import { ArrowUpRight, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import ActionIcon from './ActionIcon';
import Select from '@/components/Select';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDERS, SKILLS, supportsEffort, type ProviderId, type Connection, type ChatMessage, type LogSource, type ChatAttachment, type Effort, type Permission } from '@/lib/ai/catalog';
import type { RunningService } from '@/lib/services/service-detector';
import MarkdownOutput from '@/components/MarkdownOutput';
import ConversationPicker from './ConversationPicker';
import RunTimeline,{type RunStep} from './RunTimeline';
import SourceEvidence, {type Evidence} from './SourceEvidence';
import { providerCapabilities } from '@/lib/ai/capabilities';
import ChatComposer from './ChatComposer';
import { composerContext, parseComposerInput, type ComposerMode, type ComposerMenu } from '@/lib/ai/composer';

interface Message extends ChatMessage { id?:number; sources?:Evidence[]; artifact?:string; provider?:string; model?:string; variantOf?:number;steps?:RunStep[];attachments?:{name:string}[];contextSources?:LogSource[] }
interface RunRequest {provider:ProviderId;model:string;effort:Effort;permission:Permission;approved:boolean;message:string;sources:LogSource[];attachments:ChatAttachment[];skill:string;diagnostic:string;includeResources:boolean;conversationId?:string;regenerateFrom?:number;historyVersions?:number[]}
interface VM { id: string; label: string }
const smallControl = 'rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40';
const field = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ChatWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const conversationId=useRef<string>();
  const [conversationTitle,setConversationTitle]=useState('');
  const [failedRequest,setFailedRequest]=useState<RunRequest>();
  const [versionIndex,setVersionIndex]=useState<Record<string,number>>({});
  const [steps,setSteps]=useState<RunStep[]>([]);
  const [selection,setSelection]=useState<{key:string;text:string}>();
  const [failureKind,setFailureKind]=useState('');
  const [confirmation,setConfirmation]=useState<Confirmation>();
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [effort, setEffort] = useState<Effort>('default');
  const [permission, setPermission] = useState<Permission>('read-only');
  const [sources, setSources] = useState<LogSource[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [skill, setSkill] = useState('');
  const [menu, setMenu] = useState<ComposerMenu>(null);
  const [artifactFiles, setArtifactFiles] = useState<{ name:string; size:number }[]>([]);
  const [mode, setMode] = useState<ComposerMode>(null);
  const [attaching,setAttaching] = useState(false);
  const [stopping,setStopping] = useState(false);
  const [composerStatus,setComposerStatus] = useState('');
  const [artifactLoading,setArtifactLoading] = useState(false);
  const attachmentCount=useRef(0);
  attachmentCount.current=attachments.length;
  const [vms, setVms] = useState<VM[]>([]);
  const [vmId, setVmId] = useState('');
  const [services, setServices] = useState<RunningService[]>([]);
  const [sourceKind, setSourceKind] = useState<'service' | 'file'>('service');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage,setStage]=useState<ProgressStage>('connecting');
  const reveal=useChatReveal();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState(false);
  const [modelMessage, setModelMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const followOutput=useRef(true);
  const receivedResult=useRef(false);
  const controller = useRef<AbortController | null>(null);
  const modelController = useRef<AbortController | null>(null);
  const [loadingModels,setLoadingModels] = useState(false);

  const reloadSettings = useCallback(async () => {
    const response = await fetch('/api/ai/settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setConnections(data.connections); setProvider(data.provider); setModel(data.model); setEffort('default'); setModels([]); setApproval(false);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([reloadSettings(), fetch('/api/ai/chat').then(async response => {
      if (!response.ok) throw new Error('Riwayat chat tidak dapat dimuat.');
      const data = await response.json(); if (active) {setMessages(data.messages);conversationId.current=data.conversation?.id;setConversationTitle(data.conversation?.title??'');}
    }), fetch('/api/vms').then(async response => {
      if (!response.ok) throw new Error('Daftar VM tidak dapat dimuat.');
      const data = await response.json(); if (active) setVms(data);
    })]).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    const updated = () => { void reloadSettings().catch(() => setError('AI Management tidak dapat dimuat.')); };
    window.addEventListener('ai-settings-updated', updated);
    const query = new URLSearchParams(window.location.search);
    const sourceVm = query.get('vm'); const kind = query.get('kind'); const sourceTarget = query.get('target');
    if (sourceVm && sourceTarget && (kind === 'systemd' || kind === 'docker' || kind === 'file')) {
      setSources([{ vmId: sourceVm, kind, target: sourceTarget, label: sourceTarget }]); setMode('logs');
    }
    return () => { active = false; window.removeEventListener('ai-settings-updated', updated); controller.current?.abort(); modelController.current?.abort(); };
  }, [reloadSettings]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!followOutput.current || !container) return;
    const behavior = busy || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, [messages, busy, reveal.text]);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => {
      const selected=conversationId.current;
      void fetch(conversationId.current?`/api/ai/chat?conversation=${encodeURIComponent(conversationId.current)}`:'/api/ai/chat', { signal: abort.signal }).then(async response => {
        if (response.ok&&selected===conversationId.current) { const data=await response.json();if(selected!==conversationId.current)return;setMessages(data.messages);setConversationTitle(data.conversation?.title??''); }
      }).catch(() => {});
    };
    window.addEventListener('chat-updated', refresh);
    return () => { abort.abort(); window.removeEventListener('chat-updated', refresh); };
  }, []);
  useEffect(() => {
    if (!vmId || sourceKind !== 'service' || menu !== 'source') return;
    const abort = new AbortController(); setScanning(true); setServices([]); setTarget('');
    fetch(`/api/vms/${vmId}/services`, { signal: abort.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Tidak dapat membaca services.');
      setServices(data.services.filter((item: RunningService) => item.type === 'systemd' || item.type === 'docker' || item.unitFile));
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); }).finally(() => { if (!abort.signal.aborted) setScanning(false); });
    return () => abort.abort();
  }, [vmId, sourceKind, menu]);

  function invalidateApproval(){setApproval(false);}
  function chooseMode(value:ComposerMode){
    setMode(value);setApproval(false);
    setDraft(previous=>previous.replace(/^!(logs|status|resources)(?:\s+|$)/,''));
    setComposerStatus(value?'Mode diperbarui.':'Chat biasa; sumber tidak dikirim.');
  }
  function changeDraft(value:string){
    const parsed=parseComposerInput(value);
    setDraft(parsed.draft);setApproval(false);
    if(parsed.mode){setMode(parsed.mode);setMenu(null);}
    else if(parsed.skill){setSkill(parsed.skill);setMenu(null);}
    else if(/(^|\s)@[^\s]*$/.test(value))setMenu('source');
    else if(/^\/[^\s]*$/.test(value))setMenu('skills');
    else if(/^![^\s]*$/.test(value))setMenu('commands');
  }
  function selectProvider(value: ProviderId) {
    invalidateApproval();
    modelController.current?.abort(); setLoadingModels(false); setProvider(value); setModel(connections.find(item => item.provider === value)?.model ?? ''); setEffort('default'); setModels([]); setModelMessage('');
  }

  function addSource() {
    const vm = vms.find(item => item.id === vmId);
    if (!vm || !target || sources.length >= 4) return;
    const service = services.find(item => item.id === target);
    const kind = sourceKind === 'file' ? 'file' : service?.type === 'docker' ? 'docker' : 'systemd';
    const value = sourceKind === 'file' ? target : service?.unitFile?.split('/').pop() || service?.name || '';
    if (kind === 'file' && (!/^\/[a-zA-Z0-9_./@ -]+\.(log|out|err|txt)(\.[0-9]+)?$/.test(value) || value.split('/').includes('..'))) { setError('Pilih path absolut file .log, .out, .err, atau .txt.'); return; }
    if (!sources.some(source => source.vmId === vmId && source.target === value && source.kind === kind)) setSources(previous => [...previous, { vmId, kind, target: value, label: `${vm.label} · ${value}` }]);
    if(!mode)setMode('logs');setApproval(false);setComposerStatus('Sumber ditambahkan.');
    setMenu(null); setTarget(''); setDraft(value => value.replace(/(^|\s)@[^\s]*$/, '$1')); inputRef.current?.focus();
  }

  async function attach(files: FileList | File[] | null) {
    if (!files || attaching) return;
    setAttaching(true); setError('');
    try {
      if (attachments.length + files.length > 4) throw new Error('Maksimal 4 file.');
      const added: ChatAttachment[] = [];
      for (const file of Array.from(files)) {
        if(file.name.length>200||/^\.env/i.test(file.name)||/^config\.json$/i.test(file.name))throw new Error('File kredensial atau nama file tidak valid.');
        if (['image/png','image/jpeg','image/webp'].includes(file.type)) {
          if(!providerCapabilities(provider,model).images)throw new Error('Adaptor provider ini belum mendukung gambar.');
          if (file.size > 2 * 1024 * 1024) throw new Error('Gambar maksimal 2 MB.');
          const content = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Gambar tidak dapat dibaca.'));reader.readAsDataURL(file);});
          added.push({name:file.name || 'clipboard.png',content,mediaType:file.type}); continue;
        }
        if (file.size > 64000 || /^\.env/i.test(file.name) || /^config\.json$/i.test(file.name) || !/\.(txt|log|out|err|md|json|csv|yaml|yml|sql|ts|tsx|js|go|py)$/i.test(file.name)) throw new Error('Gunakan file teks maksimal 64 KB; file kredensial tidak diterima.');
        const content = await file.text(); if (content.includes('\0')) throw new Error('File biner tidak didukung.');
        if(new TextEncoder().encode(content).length>64000)throw new Error('File teks maksimal 64.000 byte.');
        added.push({ name: file.name, content });
      }
      if(attachmentCount.current+added.length>4)throw new Error('Maksimal 4 file.');
      attachmentCount.current+=added.length;setAttachments(previous => [...previous, ...added]);setApproval(false);setComposerStatus('Lampiran ditambahkan.');
    } catch (error) { setError(error instanceof Error ? error.message : 'File tidak dapat dibaca.'); }
    finally { setAttaching(false); }
  }

  async function loadModels() {
    modelController.current?.abort(); const abort = new AbortController(); modelController.current = abort;
    setLoadingModels(true); setModelMessage(''); setError('');
    try {
      const response = await fetch(`/api/ai/models?provider=${provider}`, {signal:abort.signal}); const data = await response.json();
      if (!response.ok) throw new Error(data.error); setModels(data.models); setModelMessage(data.message || `${data.models.length} model`);
    } catch (error) { if(!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Model tidak dapat dimuat.'); }
    finally {if(!abort.signal.aborted) setLoadingModels(false);}
  }

  async function selectConversation(id:string) {
    setLoading(true);
    try { const response=await fetch('/api/ai/chat?conversation='+encodeURIComponent(id));const data=await response.json();
    if(!response.ok)throw new Error(data.error);
    conversationId.current=id;setConversationTitle(data.conversation?.title??'');setMessages(data.messages);setDraft('');setSources([]);setAttachments([]);setSkill('');setMode(null);setApproval(false);setError('');setFailedRequest(undefined);setMenu(null);setSelection(undefined);
    }finally{setLoading(false);}
  }
  async function runChat(body:RunRequest) {
    if(busy)return;
    if(body.attachments.some(file=>file.mediaType)&&!providerCapabilities(body.provider,body.model).images){setError('Adaptor provider ini belum mendukung gambar.');return;}
    setBusy(true);setError('');setFailureKind('Koneksi / stream');setApproval(false);setMenu(null);setStage('sources');reveal.reset();followOutput.current=true;receivedResult.current=false;setFailedRequest(undefined);setSteps([]);
    const activeController=new AbortController();controller.current=activeController;
    if(!body.regenerateFrom)setMessages(previous=>[...previous,{created_at:new Date().toISOString(),role:'user',content:body.message}]);
    try {
      const response=await fetch('/api/ai/chat',{method:'POST',signal:activeController.signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(body)});
      if(response.status===428){const data=await response.clone().json();if(data.approvalRequired)setApproval(true);}
      if(!response.ok)setFailureKind(response.status===401||response.status===403?'Autentikasi':response.status===409?'Respons lain berjalan':response.status===428?'Izin diperlukan':response.status===400?'Input atau model':'Provider / koneksi');
      const data=await readChatResponse(response,event=>{if(event.type==='delta')reveal.append(event.text);else {setStage(event.stage);setSteps(previous=>[...previous,{stage:event.stage,at:new Date().toISOString()}].slice(-100));}});
      receivedResult.current=true;
      if(data.variantOf)setVersionIndex(previous=>{const next={...previous};delete next[data.variantOf!];return next;});
      if(data.conversationId)conversationId.current=data.conversationId;
      await reveal.finish(data.message);
      if(activeController.signal.aborted)throw new DOMException('Dihentikan.','AbortError');
      setMessages(previous=>[...previous,{created_at:new Date().toISOString(),role:'assistant',content:data.message,sources:data.sources,artifact:data.artifact,provider:body.provider,model:body.model,variantOf:data.variantOf,steps:data.steps}]);
      setDraft('');setAttachments([]);setComposerStatus('Respons selesai.');window.dispatchEvent(new Event('chat-updated'));
    }catch(error){
      const stopped=activeController.signal.aborted;
      if(!body.regenerateFrom)setMessages(previous=>previous.slice(0,-1));
      setError(stopped?'Dihentikan.':error instanceof Error?error.message:'Chat gagal.');
      if(!stopped)setFailedRequest({...body,approved:body.permission==='ask'?false:body.approved});
    }finally{setBusy(false);setStopping(false);reveal.reset();receivedResult.current=false;controller.current=null;inputRef.current?.focus();}
  }
  async function send(approved=false, textOverride?:string, regenerateFrom?:number) {
    const input=textOverride??draft;
    if(busy||attaching||(!input.trim()&&!attachments.length)||loading)return;
    const parsed=parseComposerInput(input);
    if(parsed.error){setError(parsed.error);return;}
    const slash=input.match(/^\/(\S+)/)?.[1];
    if(slash&&!SKILLS.some(item=>item.id===slash)){setError('Pilih skill yang tersedia melalui /.');return;}
    const currentMode=parsed.mode??mode;
    const original=regenerateFrom?messages.find(message=>message.id===regenerateFrom):undefined;
    const context=composerContext(currentMode,sources);
    const activeSources=original?(original.contextSources??(original.sources??[]).filter(source=>source.vmId&&source.kind&&source.target).map(source=>({vmId:source.vmId!,kind:source.kind as LogSource['kind'],target:source.target!,label:source.label}))).slice(0,4):context.sources;
    if(!regenerateFrom&&currentMode&&!activeSources.length){setError('Pilih sumber VM terlebih dahulu.');setMenu('source');return;}
    if(attachments.some(file=>file.mediaType)&&!providerCapabilities(provider,model).images){setError('Adaptor provider ini belum mendukung gambar.');return;}
    const text=parsed.draft.trim()||(parsed.mode||parsed.skill?input.trim():'')||(attachments.some(file=>file.mediaType)?'Analisis gambar terlampir.':'Analisis file terlampir.');
    const body:RunRequest={provider,model,effort:supportsEffort(provider,model)?effort:'default',permission,approved,message:text,sources:activeSources,attachments:[...attachments],skill:parsed.skill||skill,diagnostic:context.diagnostic,includeResources:context.includeResources,conversationId:conversationId.current,regenerateFrom,historyVersions:visibleMessages.filter(message=>message.role==='assistant').map(root=>{const variants=[root,...messages.filter(item=>root.id!==undefined&&item.variantOf===root.id)];return variants[Math.min(versionIndex[root.id!]??variants.length-1,variants.length-1)].id;}).filter((id):id is number=>id!==undefined)};
    if(permission==='ask'&&activeSources.length&&!approved){setFailedRequest(body);setApproval(true);return;}
    await runChat(body);
  }

  async function clear() {

    const response = await fetch(conversationId.current?`/api/ai/chat?conversation=${encodeURIComponent(conversationId.current)}`:'/api/ai/chat', { method: 'DELETE' });
      if (response.ok) { setMessages([]); setError(''); window.dispatchEvent(new Event('chat-updated')); } else setError('Riwayat belum dapat dihapus.');
  }
  async function showArtifacts() {
    setMenu('artifacts');setArtifactLoading(true);
    try { const response = await fetch('/api/artifacts'); const data = await response.json(); if (!response.ok) throw new Error(data.error); setArtifactFiles(data.files.filter((file: {name:string; size:number})=>file.size <= 64000 && /\.(md|txt|json|csv|sql|py|js|ts|yaml|yml|log)$/i.test(file.name)));  }
    catch { setError('Artifact tidak dapat dimuat.'); }finally{setArtifactLoading(false);}
  }
  async function attachArtifact(name: string) {
    if(attaching)return;
    if (attachmentCount.current >= 4) { setError('Maksimal 4 file.'); return; }
    setAttaching(true);
    try { const response = await fetch(`/api/artifacts?name=${encodeURIComponent(name)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); if(typeof data.content!=='string'||new TextEncoder().encode(data.content).length>64000||data.content.includes('\0'))throw new Error('Artifact tidak valid.');if(attachmentCount.current>=4)throw new Error('Maksimal 4 file.');attachmentCount.current++;setAttachments(previous=>[...previous,{name:name.split('/').pop()!,content:data.content}]);setApproval(false); setMenu(null); }
    catch { setError('Artifact tidak dapat dibaca.'); }finally{setAttaching(false);}
  }

  async function stop() {
    if(stopping)return;
    if(receivedResult.current){reveal.reset();return;}
    setStopping(true);
    try { const response=await fetch('/api/ai/chat/cancel', { method: 'POST',signal:AbortSignal.timeout(5000) });if(!response.ok)throw new Error('Cancel failed'); }
    catch { setError('Permintaan penghentian belum terkonfirmasi.'); }
    finally { controller.current?.abort();reveal.reset(); }
  }

  const visibleMessages=messages.filter(message=>!message.variantOf||!messages.some(root=>root.id===message.variantOf));
  return <div className="h-full min-h-0 flex flex-col text-gray-900 dark:text-gray-100" data-testid="chat-page">
    {confirmation&&<ConfirmDialog confirmation={confirmation} onClose={()=>setConfirmation(undefined)}/>}
    <PageActions inline={embedded}><div className="flex flex-wrap items-center gap-2"><ConversationPicker activeId={conversationId.current} disabled={busy||loading} onSelect={selectConversation} /><button type="button" aria-label="Summary" title="Summary" disabled={busy || !messages.length} onClick={()=>{changeDraft('/summarize Ringkas percakapan ini, keputusan, dan tindak lanjut.'); inputRef.current?.focus();}} className={smallControl}><ActionIcon name="summary" /></button><button type="button" onClick={()=>setConfirmation({title:"Hapus pesan",target:conversationTitle,description:"Hapus pesan dalam percakapan ini? Artifact tetap tersimpan.",action:clear})} disabled={busy || !messages.length} aria-label="Hapus riwayat" title="Hapus riwayat" className={smallControl}><ActionIcon name="trash" /></button></div></PageActions>
    <div ref={scrollContainerRef} className={`flex-1 min-h-0 overflow-y-auto ${embedded ? 'px-3' : 'px-4 md:px-8'}`} aria-busy={busy} onScroll={event=>{const node=event.currentTarget;followOutput.current=node.scrollHeight-node.scrollTop-node.clientHeight<160;}}>
      <div className="max-w-3xl mx-auto py-6 space-y-6">{conversationTitle&&<p className="text-xs text-gray-500">{conversationTitle}</p>}
        {loading && <p role="status" className="text-sm text-gray-500">Memuat…</p>}
        {!loading && !messages.length && <div className="py-12 text-center"><h2 className="text-xl font-medium">Apa yang ingin diperiksa?</h2><p className="mt-2 text-xs text-gray-500">@ sumber log · / skill · ! diagnostik</p><div className="flex flex-wrap justify-center gap-2 mt-4">{[{label:'Analisis log',draft:'/diagnose Analisis log dan akar masalah.',mode:'logs'},{label:'Cek resource',draft:'!resources ',mode:'resources'},{label:'Ringkas insiden',draft:'/summarize Ringkas kejadian dari sumber terpilih.',mode:'logs'}].map(item=><button type="button" className="ui-button" key={item.label} onClick={()=>{setDraft(item.draft.replace(/^!(logs|status|resources)\s*/, '').replace(/^\/(diagnose|summarize)\s*/,''));setMode(item.mode as ComposerMode);setSkill(item.label==='Ringkas insiden'?'summarize':item.mode==='logs'?'diagnose':'');setApproval(false);if(!sources.length)setMenu('source');inputRef.current?.focus();}}>{item.label}</button>)}</div></div>}
        {visibleMessages.map((root,index) => { const variants=[root,...messages.filter(item=>item.variantOf===root.id&&root.id!==undefined)];const selected=versionIndex[root.id??index]??variants.length-1;const message=variants[Math.min(selected,variants.length-1)];const selectedText=selection?.key===String(root.id??index)?selection.text:'';return <article key={root.id??index} onMouseUp={event=>{const range=window.getSelection();const text=range?.toString().slice(0,4000);if(text&&range?.anchorNode&&event.currentTarget.contains(range.anchorNode))setSelection({key:String(root.id??index),text});}} aria-label={message.role === 'user' ? 'Pesan Anda' : 'Respons AI'} className={message.role === 'user' ? 'group ml-auto max-w-[85%] rounded-2xl bg-gray-200 dark:bg-gray-800 px-4 py-3' : 'max-w-full'}>
          {message.role === 'assistant' ? <MarkdownOutput content={message.content} timestamp={message.created_at} /> : <div className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</div>}
          {message.role === 'user' && <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"><button type="button" aria-label="Copy message" title="Copy" onClick={()=>void navigator.clipboard.writeText(message.content).catch(()=>setError('Clipboard tidak tersedia.'))} className={smallControl}><ActionIcon name="copy" /></button><button type="button" aria-label="Edit message" title="Edit sebagai pesan baru" disabled={busy} onClick={()=>{setDraft(message.content);inputRef.current?.focus();}} className={smallControl}><ActionIcon name="edit" /></button>{message.created_at && <span title={new Date(message.created_at).toLocaleString()} className="flex items-center gap-1 text-xs"><ActionIcon name="clock" />{new Date(message.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}</div>}
          {message.role==='assistant'&&<div className="flex flex-wrap items-center gap-2 mt-2">{variants.length>1&&<><button type="button" className="ui-button" aria-label="Versi sebelumnya" disabled={selected===0} onClick={()=>setVersionIndex(previous=>({...previous,[root.id??index]:selected-1}))}><ChevronLeft aria-hidden="true" size={14} /></button><span className="text-xs">{selected+1}/{variants.length}</span><button type="button" className="ui-button" aria-label="Versi berikutnya" disabled={selected>=variants.length-1} onClick={()=>setVersionIndex(previous=>({...previous,[root.id??index]:selected+1}))}><ChevronRight aria-hidden="true" size={14} /></button></>}{message.id&&<button type="button" className="ui-button" disabled={busy||!!message.attachments?.length} title="Buat versi baru; sumber log dibaca ulang. File lampiran perlu dikirim ulang." onClick={()=>void send(false,'Regenerate',message.id)}>Regenerate</button>}<button type="button" className="ui-button" disabled={busy} onClick={()=>{changeDraft('/summarize Ringkas kutipan berikut:\n'+(selectedText||message.content).slice(0,8000));inputRef.current?.focus();}}>Ringkas</button>{selectedText&&<button type="button" className="ui-button" disabled={busy} onClick={()=>{changeDraft('/explain Jelaskan kutipan berikut:\n'+selectedText);setSelection(undefined);inputRef.current?.focus();}}>Jelaskan pilihan</button>}</div>}
          <RunTimeline steps={message.steps??[]}/>
          {!!message.sources?.length&&<SourceEvidence sources={message.sources} />}
          {message.artifact&&<a className="ui-button mt-2" href={'/artifacts?name='+encodeURIComponent(message.artifact)}>Buka hasil <ArrowUpRight aria-hidden="true" size={13} /></a>}
          {message.role==='assistant'&&message.provider&&<p className="text-xs text-gray-500 mt-2">{message.provider} · {message.model||'Model default'}</p>}
        </article>;})}
        {busy && <article aria-label="Respons AI berjalan" className="streaming-answer"><AIRunPanel text={reveal.text} busy stage={stage} steps={steps}/></article>}
      </div>
    </div>
    <div className={`shrink-0 pb-4 ${embedded ? 'px-2' : 'px-4 md:px-8'}`}><div className="max-w-3xl mx-auto relative">
      {error&&<div role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{failureKind&&failedRequest&&<strong>{failureKind}: </strong>}{error}{failedRequest&&<button type="button" disabled={busy} className="ui-button ml-2" onClick={()=>{if(failedRequest.permission==='ask'&&failedRequest.sources.length)setApproval(true);else void runChat(failedRequest);}}>Coba lagi</button>}</div>}
      {approval && <div role="alertdialog" aria-label="Izin membaca log" className="mb-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex flex-wrap items-center gap-3"><span className="flex-1">Baca dan kirim {failedRequest?.sources.length??sources.length} sumber ke {PROVIDERS.find(item => item.id === (failedRequest?.provider??provider))?.name}?</span><button type="button" onClick={() => {if(failedRequest)void runChat({...failedRequest,approved:true});else void send(true);}} className="rounded bg-blue-600 text-white px-3 py-1.5">Izinkan</button><button type="button" onClick={() => setApproval(false)} className={smallControl}>Batal</button></div>}
      <ChatComposer embedded={embedded} draft={draft} mode={mode} menu={menu} sources={sources} attachments={attachments} skill={skill}
        provider={provider} model={model} models={models} connections={connections} effort={effort} permission={permission}
        busy={busy} loading={loading} attaching={attaching} stopping={stopping} loadingModels={loadingModels} modelMessage={modelMessage} status={composerStatus} inputRef={inputRef}
        onDraft={changeDraft} onMode={chooseMode} onMenu={setMenu} onProvider={selectProvider}
        onModel={value=>{setModel(value);setEffort('default');setApproval(false);}} onEffort={value=>{setEffort(value);setApproval(false);}} onPermission={value=>{setPermission(value);setApproval(false);}}
        onRemoveSource={index=>{setSources(previous=>previous.filter((_,i)=>i!==index));setApproval(false);}}
        onRemoveAttachment={index=>{setAttachments(previous=>previous.filter((_,i)=>i!==index));setApproval(false);}} onRemoveSkill={()=>{setSkill('');setApproval(false);}}
        onAttach={attach} onArtifacts={()=>void showArtifacts()} onLoadModels={()=>void loadModels()} onSend={()=>void send()} onStop={()=>void stop()}
        panel={<>
          {menu==='artifacts'&&<>{artifactLoading?<p role="status">Memuat Artifact…</p>:!artifactFiles.length?<p className="text-sm">Belum ada Artifact teks.</p>:artifactFiles.map(file=><button type="button" key={file.name} disabled={attaching} onClick={()=>void attachArtifact(file.name)} className="composer-menu-item truncate">{file.name}</button>)}</>}
          {menu==='source'&&<div className="space-y-2">
            <Select aria-label="VM sumber" className={field+' w-full'} value={vmId} onChange={event=>{setVmId(event.target.value);setTarget('');}}><option value="">Pilih VM</option>{vms.map(vm=><option key={vm.id} value={vm.id}>{vm.label}</option>)}</Select>
            {!vms.length&&<p className="text-xs">Belum ada VM. Tambahkan dari VM Machines.</p>}
            <div className="flex gap-2"><button type="button" aria-pressed={sourceKind==='service'} onClick={()=>{setSourceKind('service');setTarget('');}} className="ui-button">Service</button><button type="button" aria-pressed={sourceKind==='file'} onClick={()=>{setSourceKind('file');setTarget('');}} className="ui-button">File log</button></div>
            {sourceKind==='service'?<Select aria-label="Service sumber" className={field+' w-full'} value={target} onChange={event=>setTarget(event.target.value)} disabled={scanning||!vmId}><option value="">{scanning?'Membaca services…':'Pilih service / container'}</option>{services.map(service=><option key={service.id} value={service.id}>{service.name} · {service.type}</option>)}</Select>:<input aria-label="Path log" className={field+' w-full font-mono'} value={target} autoComplete="off" spellCheck={false} onChange={event=>setTarget(event.target.value)} placeholder="/var/log/application.log…"/>}
            <button type="button" disabled={!vmId||!target||sources.length>=4} onClick={addSource} className="ui-button">Tambahkan</button>
          </div>}
          {menu==='skills'&&SKILLS.map(item=><button type="button" key={item.id} onClick={()=>{setSkill(item.id);setApproval(false);setDraft(value=>value.replace(/(^|\s)\/[^\s]*$/,'$1'));setMenu(null);inputRef.current?.focus();}} className="composer-menu-item" aria-pressed={skill===item.id}><span>/{item.id}</span>{skill===item.id&&<Check aria-hidden="true" size={14} />}</button>)}
        </>}/>
    </div></div>
  </div>;
}
