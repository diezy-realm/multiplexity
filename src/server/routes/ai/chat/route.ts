import { validAttachment } from '@/lib/ai/attachments';
import { getServerSession } from '@/server/auth/session';
import { getDb } from '@/lib/db';
import { conversation, createConversation, chatHistory, regenerationContext, modelHistory } from '@/lib/ai/conversations';
import { complete } from '@/lib/ai/completion';
import { isProvider, validModel, SKILLS, type ChatMessage, type LogSource, type ChatAttachment } from '@/lib/ai/catalog';
import { readSources, validateSource, redactSecrets } from '@/lib/ai/context';
import { chatOperations } from '@/lib/ai/operations';
import { saveAnalysis } from '@/lib/ai/workspace';
import type { CompletionObserver } from '@/lib/ai/stream-events';

async function userId() {
  const session = await getServerSession();
  return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET(request:Request) {
  const user=await userId();if(!user)return Response.json({error:'Unauthorized'},{status:401});
  const id=request?new URL(request.url).searchParams.get('conversation'):null;
  const item=conversation(user,id);
  if(id&&!item)return Response.json({error:'Percakapan tidak ditemukan.'},{status:404});
  return Response.json({conversation:item??null,messages:item?chatHistory(user,item.id):[]},{headers:{'Cache-Control':'no-store'}});
}
export async function DELETE(request:Request) {
  const user=await userId();if(!user)return Response.json({error:'Unauthorized'},{status:401});
  if(chatOperations.has(user))return Response.json({error:'Hentikan respons terlebih dahulu.'},{status:409});
  const item=conversation(user,request?new URL(request.url).searchParams.get('conversation'):null);
  if(item)getDb().prepare('DELETE FROM ai_chat_messages WHERE user_id=? AND conversation_id=?').run(user,item.id);
  return Response.json({success:true});
}

export async function POST(request: Request) {
  const user = await userId();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (Number(request.headers.get('content-length') ?? 0) > 12000000) return Response.json({ error: 'Pesan terlalu besar.' }, { status: 413 });
  let body;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 12000000) return Response.json({ error: 'Pesan terlalu besar.' }, { status: 413 });
    body = JSON.parse(text);
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || (body.historyVersions!==undefined&&(!Array.isArray(body.historyVersions)||body.historyVersions.length>100||!body.historyVersions.every((id:unknown)=>Number.isSafeInteger(id)&&Number(id)>0))) || (body.regenerateFrom!==undefined&&(!Number.isSafeInteger(body.regenerateFrom)||body.regenerateFrom<1)) || (body.conversationId !== undefined && (typeof body.conversationId !== 'string' || body.conversationId.length>80)) || !isProvider(body.provider) || !validModel(body.model) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 16000 ||
      !['default', 'low', 'medium', 'high'].includes(body.effort) || !['read-only', 'ask', 'allow-all'].includes(body.permission) ||
      !Array.isArray(body.sources) || body.sources.length > 4 || !body.sources.every(validateSource) ||
      !Array.isArray(body.attachments) || body.attachments.length > 4 || !body.attachments.every(validAttachment) ||
      (body.skill && !SKILLS.some(skill => skill.id === body.skill)) ||
      (body.diagnostic !== undefined && !['logs', 'status', 'resources'].includes(body.diagnostic)) ||
      (body.includeResources !== undefined && typeof body.includeResources !== 'boolean')) {
    return Response.json({ error: 'Pesan, file, atau sumber tidak valid.' }, { status: 400 });
  }
  const images = (body.attachments as ChatAttachment[]).filter(file=>file.mediaType);
  if (images.length && !['openai','claude','codex','gemini','ollama','custom'].includes(body.provider)) return Response.json({ error:'Provider ini belum mendukung gambar. Gunakan Codex, OpenAI, Claude, Gemini atau model vision Ollama/API.' }, {status:400});
  if (chatOperations.has(user)) return Response.json({ error: 'Respons sebelumnya masih berjalan.' }, { status: 409 });
  const selected=conversation(user,body.conversationId);
  if(body.conversationId && (!selected || selected.archived))return Response.json({error:'Percakapan tidak tersedia.'},{status:404});
  const current=selected??createConversation(user,redactSecrets(body.message.trim()).slice(0,80));
  let regeneration:ReturnType<typeof regenerationContext>|undefined;
  if(body.regenerateFrom!==undefined){try{regeneration=regenerationContext(user,current.id,body.regenerateFrom);body.message=regeneration.message;body.sources=regeneration.sources;body.skill=regeneration.skill;body.diagnostic=regeneration.diagnostic;body.includeResources=regeneration.includeResources;}catch(error){return Response.json({error:error instanceof Error?error.message:'Regenerate gagal.'},{status:400});}}
  if(!Array.isArray(body.sources)||body.sources.length>4||!body.sources.every(validateSource))return Response.json({error:'Sumber tidak valid.'},{status:400});
  if(body.permission==='ask'&&body.sources.length&&body.approved!==true)return Response.json({approvalRequired:true,error:'Izinkan membaca dan mengirim sumber log yang dipilih?'},{status:428});
  const operation = new AbortController();
  const signal = AbortSignal.any([request.signal, operation.signal, AbortSignal.timeout(180000)]);
  chatOperations.set(user, operation);
  const execute = async (observer?:CompletionObserver) => {
    const steps:{stage:string;at:string}[]=[];
    const observe:CompletionObserver=event=>{if(event.type==='status'&&steps.length<100)steps.push({stage:event.stage,at:new Date().toISOString()});observer?.(event);};
    observe?.({type:'status',stage:'sources'});
    const sources = await readSources(body.sources as LogSource[], body.diagnostic ?? 'logs');
    if (body.includeResources && body.diagnostic !== 'resources') {
      const unique = [...new Map((body.sources as LogSource[]).map(source => [source.vmId, source])).values()];
      sources.push(...await readSources(unique, 'resources'));
    }
    if (signal.aborted) throw new Error('Permintaan dibatalkan.');
    const sourceText = sources.map(source => `[${source.label}] ${source.timestamp}\n${source.content}`).join('\n\n');
    const fileText = (body.attachments as ChatAttachment[]).filter(file=>!file.mediaType).map(file => `[Attachment: ${file.name}]\n${redactSecrets(file.content)}`).join('\n\n');
    const skill = SKILLS.find(item => item.id === body.skill);
    const history = regeneration?.history??modelHistory(user,current.id,body.historyVersions??[]) as ChatMessage[];
    const message = redactSecrets(body.message.trim());
    observe?.({type:'status',stage:'connecting'});
    const answer = await complete(body.provider, body.model, body.effort, [...history, { role: 'user', content: message }], `${skill ? `Workflow: ${skill.prompt}\n\n` : ''}${sourceText}\n\n${fileText}`, signal, body.permission, user, images, observe);
    if (signal.aborted) throw new Error('Permintaan dibatalkan.');
    observe?.({type:'status',stage:'saving'});
    const shouldSaveArtifact =
      Boolean(body.skill) ||
      body.sources.length > 0 ||
      Boolean(body.includeResources) ||
      /\b(artifact|artifak|simpan\s+(ke\s+)?(file|dokumen|laporan|artifact)|save\s+(as|to)\s+artifact|buat(kan)?\s+(laporan|audit|riset)|audit|riset|research)\b/i.test(message);
    const artifact = shouldSaveArtifact ? saveAnalysis(user, answer) : undefined;
    const evidence=sources.map(({label,timestamp,content,kind,target,vmId})=>({label,timestamp,kind,target,vmId,excerpt:content.slice(0,2000),truncated:content.length>2000}));
    const metadata={contextSources:body.sources,variantOf:regeneration?.variantOf,steps,diagnostic:body.diagnostic??'logs',includeResources:!!body.includeResources,sources:evidence,artifact,provider:body.provider,model:body.model,effort:body.effort,permission:body.permission,skill:body.skill||'',attachments:body.attachments.map((file:ChatAttachment)=>({name:file.name,mediaType:file.mediaType||'text/plain'}))};
    getDb().transaction(() => {
      const insert=getDb().prepare('INSERT INTO ai_chat_messages (user_id,conversation_id,role,content,metadata) VALUES (?,?,?,?,?)');
      if(!regeneration)insert.run(user,current.id,'user',message,'{}');
      insert.run(user,current.id,'assistant',answer.slice(0,100000),JSON.stringify(metadata));
      getDb().prepare("UPDATE ai_conversations SET title=CASE WHEN title='Chat baru' THEN ? ELSE title END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?").run(message.slice(0,80),current.id,user);
    })();
    return { message: answer, artifact, conversationId:current.id, sources:evidence, variantOf:regeneration?.variantOf,steps, metadata };

  };
  const cleanup = () => { if(chatOperations.get(user)===operation)chatOperations.delete(user); };
  if(request.headers.get('accept')?.includes('text/event-stream')) {
    const encoder=new TextEncoder();let closed=false;
    const stream=new ReadableStream<Uint8Array>({
      start(controller) {
        const send=(event:unknown)=>{if(!closed)controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));};
        const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': ping\n\n'));},15000);
        void execute(send).then(result=>send({type:'done',...result})).catch(error=>send({type:'error',error:error instanceof Error?error.message:'Chat gagal.'})).finally(()=>{clearInterval(heartbeat);cleanup();if(!closed){closed=true;controller.close();}});
      },
      cancel(){closed=true;operation.abort();}
    });
    return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
  }
  try { return Response.json(await execute()); }
  catch(error){return Response.json({error:error instanceof Error?error.message:'Chat gagal.'},{status:502});}
  finally {cleanup();}
}
