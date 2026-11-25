'use client';
import {useEffect,useRef,useState} from 'react';
import Dialog from './Dialog';
import AIRunPanel from './AIRunPanel';
import {useChatReveal} from '@/hooks/useChatReveal';
import {readChatResponse} from '@/lib/ai/chat-stream-client';
import type {ProgressStage} from '@/lib/ai/stream-events';
import type {RunStep} from './RunTimeline';
interface Props {isOpen:boolean;onClose:()=>void;logText:string}
export default function AIAnalyzeModal({isOpen,onClose,logText}:Props){
 const [prompt,setPrompt]=useState('');const [analysis,setAnalysis]=useState('');const [artifact,setArtifact]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [stage,setStage]=useState<ProgressStage>('connecting');const [steps,setSteps]=useState<RunStep[]>([]);const controller=useRef<AbortController|null>(null);const reveal=useChatReveal();
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{if(!isOpen)controller.current?.abort();},[isOpen]);
 async function analyze(){
  if(busy)return;const abort=new AbortController();controller.current=abort;setBusy(true);setAnalysis('');setArtifact('');setError('');setSteps([]);reveal.reset();
  try{const response=await fetch('/api/ai/analyze',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({logText,prompt:prompt.trim()||undefined})});
   const data=await readChatResponse(response,event=>{if(event.type==='delta')reveal.append(event.text);else{setStage(event.stage);setSteps(previous=>[...previous,{stage:event.stage,at:new Date().toISOString()}].slice(-100));}});
   await reveal.finish(data.message);setAnalysis(data.message);setArtifact(data.artifact||'');
  }catch(error){setError(abort.signal.aborted?'Dihentikan.':error instanceof Error?error.message:'Analisis gagal.');}finally{setBusy(false);reveal.reset();controller.current=null;}
 }
 if(!isOpen)return null;
 return <Dialog title="AI Log Analysis" onClose={()=>{controller.current?.abort();onClose();}} className="max-w-3xl"><div className="space-y-4"><label className="block text-sm">Log yang dipilih ({logText.length} chars)<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-100 dark:bg-gray-900 p-3 text-xs">{logText.slice(0,2000)}{logText.length>2000?'\n…':''}</pre></label><textarea aria-label="Prompt analisis" rows={2} className="ui-field w-full" value={prompt} disabled={busy} onChange={event=>setPrompt(event.target.value)} placeholder="Apa yang ingin diperiksa?"/><div className="flex flex-wrap gap-2">{['Apa penyebab error ini?','Berikan solusi','Jelaskan log ini'].map(item=><button type="button" disabled={busy} className="ui-button" key={item} onClick={()=>setPrompt(item)}>{item}</button>)}</div>{busy?<button type="button" className="ui-button" onClick={()=>{controller.current?.abort();reveal.reset();}}>Hentikan respons</button>:<button type="button" className="ui-button" onClick={()=>void analyze()}>{error?'Coba lagi':'Analisis'}</button>}{error&&<p role="alert" className="text-sm text-red-500">{error}</p>}<AIRunPanel text={busy?reveal.text:analysis} busy={busy} stage={stage} steps={steps}/>{artifact&&<a className="ui-button" href={'/artifacts?name='+encodeURIComponent(artifact)}>Buka hasil ↗</a>}</div></Dialog>;
}
