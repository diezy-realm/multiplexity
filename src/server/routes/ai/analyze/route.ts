import { getServerSession } from '@/server/auth/session';
import { complete } from '@/lib/ai/completion';
import { activeProvider, getConnection } from '@/lib/ai/settings';
import { redactSecrets } from '@/lib/ai/context';
import { saveAnalysis } from '@/lib/ai/workspace';
import { streamResponse } from '@/lib/ai/stream-response';
import type {CompletionObserver} from '@/lib/ai/stream-events';

export async function POST(request: Request) {
  const session = await getServerSession();
  const user = (session?.user as { id?: string } | undefined)?.id;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body.logText !== 'string' || !body.logText.trim() || body.logText.length > 100000 ||
      (body.prompt !== undefined && (typeof body.prompt !== 'string' || body.prompt.length > 4000))) {
    return Response.json({ error: 'Log tidak valid atau terlalu besar.' }, { status: 400 });
  }
  const controller=new AbortController();
  const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(180000)]);
  const execute=async(observe?:CompletionObserver)=>{
    observe?.({type:'status',stage:'connecting'});
    const provider = activeProvider();
    const connection = getConnection(provider);
    const analysis = await complete(provider, connection.model, 'default', [{ role: 'user', content: body.prompt || 'Analisis log ini dan jelaskan bukti, kemungkinan penyebab, dan langkah verifikasi.' }], redactSecrets(body.logText.slice(0, 24000)), signal, 'read-only', user,[],observe);
    if(signal.aborted)throw new Error('Dihentikan.');
    observe?.({type:'status',stage:'saving'});
    const artifact = saveAnalysis(user, analysis);
    return { message:analysis,analysis,artifact,model:connection.model||'CLI default' };
  };
  if(request.headers.get('accept')?.includes('text/event-stream'))return streamResponse(execute,()=>controller.abort());
  try{return Response.json(await execute());}catch(error){
    return Response.json({ error: error instanceof Error ? error.message : 'Analisis gagal.' }, { status: 502 });
  }
}
